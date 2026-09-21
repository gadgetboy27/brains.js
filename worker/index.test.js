import { describe, expect, it } from 'vitest';

import demo from '../src/venues/demo-venue.json';
import { handleRequest } from './index.js';

/** In-memory KV with the subset of the API the worker uses. */
function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async list({ prefix }) {
      return {
        keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      };
    },
  };
}

function env({ token = 'secret' } = {}) {
  return {
    VENUES: fakeKv(),
    ADMIN_TOKEN: token,
    ASSETS: {
      fetch: async (req) => {
        const p = new URL(req.url).pathname;
        if (p === '/venues/static-venue/venue.json') {
          return new Response(JSON.stringify({ ...demo, id: 'static-venue' }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('<html>app</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      },
    },
  };
}

const req = (path, { method = 'GET', body, token } = {}) =>
  new Request(`https://app.test${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

let clock = 1_700_000_000_000;
const opts = { now: () => clock };

describe('worker — public reads', () => {
  it('serves the app for unknown paths', async () => {
    const res = await handleRequest(req('/anything?v=x'), env(), opts);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('app');
  });

  it('serves a static venue file when nothing is published', async () => {
    const res = await handleRequest(req('/venues/static-venue/venue.json'), env(), opts);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('static-venue');
  });

  it('returns 404 for an unknown venue and an empty runtime config', async () => {
    expect((await handleRequest(req('/venues/nope/venue.json'), env(), opts)).status).toBe(404);
    const rt = await handleRequest(req('/venues/nope/runtime.json'), env(), opts);
    expect(rt.status).toBe(200);
    expect(await rt.json()).toEqual({ version: 1, closures: [], hiddenPois: [] });
    expect((await handleRequest(req('/venues/bad%20id/venue.json'), env(), opts)).status).toBe(400);
  });
});

describe('worker — publishing', () => {
  it('refuses without the token, and with a wrong one', async () => {
    const e = env();
    expect(
      (
        await handleRequest(
          req('/api/venues/demo-health-centre', { method: 'PUT', body: demo }),
          e,
          opts
        )
      ).status
    ).toBe(401);
    expect(
      (
        await handleRequest(
          req('/api/venues/demo-health-centre', { method: 'PUT', body: demo, token: 'nope' }),
          e,
          opts
        )
      ).status
    ).toBe(401);
    expect((await handleRequest(req('/api/venues', { token: 'secre' }), e, opts)).status).toBe(401);
  });

  it('answers 503 until ADMIN_TOKEN is configured', async () => {
    const res = await handleRequest(req('/api/venues', { token: 'x' }), env({ token: '' }), opts);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/ADMIN_TOKEN/);
  });

  it('validates and stores a venue, then serves it to visitors from KV', async () => {
    const e = env();
    const put = await handleRequest(
      req('/api/venues/demo-health-centre', { method: 'PUT', body: demo, token: 'secret' }),
      e,
      opts
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      ok: true,
      id: 'demo-health-centre',
      publishedAt: new Date(clock).toISOString(),
    });

    const get = await handleRequest(req('/venues/demo-health-centre/venue.json'), e, opts);
    expect(get.headers.get('x-source')).toBe('kv');
    expect(get.headers.get('cache-control')).toBe('no-cache');
    expect((await get.json()).name).toBe('Demo Health Centre');

    const list = await handleRequest(req('/api/venues', { token: 'secret' }), e, opts);
    expect(await list.json()).toEqual({ venues: ['demo-health-centre'] });
  });

  it('rejects invalid JSON, invalid venues and mismatched ids with the problems named', async () => {
    const e = env();
    const bad = await handleRequest(
      new Request('https://app.test/api/venues/demo-health-centre', {
        method: 'PUT',
        headers: { authorization: 'Bearer secret' },
        body: '{nope',
      }),
      e,
      opts
    );
    expect(bad.status).toBe(400);
    const invalid = await handleRequest(
      req('/api/venues/demo-health-centre', {
        method: 'PUT',
        body: { ...demo, floors: [] },
        token: 'secret',
      }),
      e,
      opts
    );
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).problems[0].path).toBe('floors');
    const mismatch = await handleRequest(
      req('/api/venues/other', { method: 'PUT', body: demo, token: 'secret' }),
      e,
      opts
    );
    expect(mismatch.status).toBe(422);
    expect((await mismatch.json()).error).toMatch(/does not match URL/);
    expect(e.VENUES.store.size).toBe(0);
  });

  it('keeps a bounded history and can roll back', async () => {
    const e = env();
    for (let i = 1; i <= 3; i += 1) {
      clock += 1000;
      const body = { ...demo, name: `Version ${i}` };
      await handleRequest(
        req('/api/venues/demo-health-centre', { method: 'PUT', body, token: 'secret' }),
        e,
        opts
      );
    }
    const history = await (
      await handleRequest(
        req('/api/venues/demo-health-centre/history', { token: 'secret' }),
        e,
        opts
      )
    ).json();
    expect(history.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(history.versions[0]).toMatchObject({ nodes: demo.nodes.length, pois: demo.pois.length });

    const rb = await handleRequest(
      req('/api/venues/demo-health-centre/rollback', {
        method: 'POST',
        body: { version: 1 },
        token: 'secret',
      }),
      e,
      opts
    );
    expect(await rb.json()).toEqual({ ok: true, id: 'demo-health-centre', restored: 1 });
    const now = await (
      await handleRequest(req('/venues/demo-health-centre/venue.json'), e, opts)
    ).json();
    expect(now.name).toBe('Version 1');
    const missing = await handleRequest(
      req('/api/venues/demo-health-centre/rollback', {
        method: 'POST',
        body: { version: 9 },
        token: 'secret',
      }),
      e,
      opts
    );
    expect(missing.status).toBe(404);
  });

  it('publishes and serves a runtime config', async () => {
    const e = env();
    const rt = {
      version: 1,
      closures: [{ from: 'n-lift-g', to: 'n-lift-1', reason: 'Maintenance' }],
      hiddenPois: [],
    };
    const put = await handleRequest(
      req('/api/venues/demo-health-centre/runtime', { method: 'PUT', body: rt, token: 'secret' }),
      e,
      opts
    );
    expect(put.status).toBe(200);
    const get = await (
      await handleRequest(req('/venues/demo-health-centre/runtime.json'), e, opts)
    ).json();
    expect(get.closures).toHaveLength(1);
    expect(get.updatedAt).toBeDefined();
    const invalid = await handleRequest(
      req('/api/venues/demo-health-centre/runtime', {
        method: 'PUT',
        body: { version: 2 },
        token: 'secret',
      }),
      e,
      opts
    );
    expect(invalid.status).toBe(422);
  });

  it('405s unsupported methods on known routes', async () => {
    expect(
      (
        await handleRequest(
          req('/api/venues/demo-health-centre', { method: 'DELETE', token: 'secret' }),
          env(),
          opts
        )
      ).status
    ).toBe(405);
  });
});
