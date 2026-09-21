/**
 * Cloudflare Worker: serves the static app and a small venue-publishing API
 * backed by KV, so what staff build in admin mode is stored centrally and
 * every visitor gets it.
 *
 *   GET  /venues/:id/venue.json     published venue JSON (KV), else the static file
 *   GET  /venues/:id/runtime.json   published runtime config (KV), else static, else {version:1}
 *   PUT  /api/venues/:id            publish venue JSON        (Authorization: Bearer <ADMIN_TOKEN>)
 *   PUT  /api/venues/:id/runtime    publish runtime config    (same)
 *   GET  /api/venues                list published venue ids  (same)
 *   GET  /api/venues/:id/history    previous versions          (same)
 *   POST /api/venues/:id/rollback   { "version": <n> }         (same)
 *   everything else                 static assets (SPA fallback)
 *
 * Bodies are validated with the same validators the app uses before they are
 * stored. ADMIN_TOKEN is a Worker secret (`npx wrangler secret put ADMIN_TOKEN`);
 * until it is set the API answers 503 so nothing can be published by accident.
 */

import { validateRuntimeConfig } from '../src/venues/runtime-config.js';
import { validateVenue } from '../src/venues/schema.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HISTORY_LIMIT = 20;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

/** Constant-time-ish comparison of the bearer token. */
function authorised(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return 'unconfigured';
  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

async function readJson(request) {
  try {
    return { body: await request.json() };
  } catch (err) {
    return { error: `body is not valid JSON: ${err.message}` };
  }
}

/**
 * @param {Request} request
 * @param {{ VENUES: KVNamespace, ASSETS: { fetch: (r: Request) => Promise<Response> }, ADMIN_TOKEN?: string }} env
 */
export async function handleRequest(request, env, { now = () => Date.now() } = {}) {
  const url = new URL(request.url);
  const path = url.pathname;

  // ---- public reads: KV first, then the static file
  const venueFile = /^\/venues\/([^/]+)\/(venue|runtime)\.json$/.exec(path);
  if (venueFile && request.method === 'GET') {
    const [, id, kind] = venueFile;
    if (!ID.test(id)) return json({ error: 'invalid venue id' }, 400);
    const stored = await env.VENUES.get(`${kind}:${id}`, 'text');
    if (stored !== null) {
      return new Response(stored, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-cache',
          'x-source': 'kv',
        },
      });
    }
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 200 && (asset.headers.get('content-type') ?? '').includes('json'))
      return asset;
    if (kind === 'runtime')
      return json({ version: 1, closures: [], hiddenPois: [] }, 200, {
        'cache-control': 'no-cache',
      });
    return json({ error: `venue ${id} not found` }, 404);
  }

  // ---- admin API
  if (path.startsWith('/api/')) {
    const auth = authorised(request, env);
    if (auth === 'unconfigured')
      return json({ error: 'publishing is not configured (ADMIN_TOKEN not set)' }, 503);
    if (!auth) return json({ error: 'unauthorised' }, 401, { 'www-authenticate': 'Bearer' });

    if (path === '/api/venues' && request.method === 'GET') {
      const list = await env.VENUES.list({ prefix: 'venue:' });
      const ids = list.keys.map((k) => k.name.slice('venue:'.length));
      return json({ venues: ids });
    }

    const m = /^\/api\/venues\/([^/]+)(?:\/(runtime|history|rollback))?$/.exec(path);
    if (!m) return json({ error: 'not found' }, 404);
    const [, id, sub] = m;
    if (!ID.test(id)) return json({ error: 'invalid venue id' }, 400);

    if (!sub && request.method === 'PUT') {
      const { body, error } = await readJson(request);
      if (error) return json({ error }, 400);
      const problems = validateVenue(body);
      if (problems.length) return json({ error: 'invalid venue JSON', problems }, 422);
      if (body.id !== id)
        return json({ error: `venue id in body (${body.id}) does not match URL (${id})` }, 422);
      await publish(env, `venue:${id}`, body, now());
      return json({ ok: true, id, publishedAt: new Date(now()).toISOString() });
    }

    if (sub === 'runtime' && request.method === 'PUT') {
      const { body, error } = await readJson(request);
      if (error) return json({ error }, 400);
      const problems = validateRuntimeConfig(body);
      if (problems.length) return json({ error: 'invalid runtime config', problems }, 422);
      await env.VENUES.put(
        `runtime:${id}`,
        JSON.stringify({ ...body, updatedAt: new Date(now()).toISOString() })
      );
      return json({ ok: true, id });
    }

    if (sub === 'history' && request.method === 'GET') {
      const history = (await env.VENUES.get(`history:${id}`, 'json')) ?? [];
      return json({
        id,
        versions: history.map(({ version, publishedAt, nodes, pois }) => ({
          version,
          publishedAt,
          nodes,
          pois,
        })),
      });
    }

    if (sub === 'rollback' && request.method === 'POST') {
      const { body, error } = await readJson(request);
      if (error) return json({ error }, 400);
      const history = (await env.VENUES.get(`history:${id}`, 'json')) ?? [];
      const entry = history.find((h) => h.version === body?.version);
      if (!entry) return json({ error: `version ${body?.version} not found` }, 404);
      await publish(env, `venue:${id}`, entry.json, now());
      return json({ ok: true, id, restored: entry.version });
    }

    return json({ error: 'method not allowed' }, 405);
  }

  // ---- everything else: the static app
  return env.ASSETS.fetch(request);
}

/** Store the venue and append to its history (bounded). */
async function publish(env, key, body, at) {
  const id = key.slice('venue:'.length);
  const historyKey = `history:${id}`;
  const history = (await env.VENUES.get(historyKey, 'json')) ?? [];
  const version = (history[0]?.version ?? 0) + 1;
  history.unshift({
    version,
    publishedAt: new Date(at).toISOString(),
    nodes: body.nodes.length,
    pois: body.pois.length,
    json: body,
  });
  await env.VENUES.put(key, JSON.stringify(body));
  await env.VENUES.put(historyKey, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
}

export default {
  fetch: (request, env) => handleRequest(request, env),
};
