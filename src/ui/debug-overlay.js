/**
 * Debug overlay — a small fixed panel showing the live pose, confidence and
 * provider / chain status. For development and field testing; not part of
 * the user-facing UI.
 *
 * Works with any `PositionProvider`. If the provider is a `ProviderChain` it
 * also shows the active provider, the chain order and why earlier providers
 * fell back. If the provider exposes `onStatus` (Qr, Immersal) the status is
 * shown; if it exposes `fusion` (Immersal) the fusion confidence and
 * distance-since-fix are shown too.
 *
 * ```js
 * const overlay = createDebugOverlay({ provider: chain });
 * // …
 * overlay.destroy();
 * ```
 */

const STYLE_ID = 'brains-debug-overlay-style';

const CSS = `
.bdo { position: fixed; top: 8px; left: 8px; z-index: 9999; min-width: 220px; max-width: 320px;
  padding: 8px 10px; border-radius: 8px; background: rgba(0, 0, 0, 0.72); color: #eee;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; pointer-events: auto; }
.bdo[hidden] { display: none; }
.bdo h4 { margin: 0 0 4px; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: #9cf; }
.bdo dl { display: grid; grid-template-columns: max-content 1fr; gap: 1px 10px; margin: 0; }
.bdo dt { color: #aaa; }
.bdo dd { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bdo .bar { position: relative; height: 6px; margin: 4px 0 6px; border-radius: 3px; background: #444; }
.bdo .bar > i { display: block; height: 100%; border-radius: 3px; background: #4c4; transition: width 120ms; }
.bdo .bar.low > i { background: #e94; }
.bdo .bar.none > i { background: #c33; }
.bdo .status-ok { color: #6d6; } .bdo .status-bad { color: #f66; } .bdo .status-wait { color: #fc6; }
.bdo .failed { margin: 4px 0 0; padding-left: 14px; color: #f99; }
.bdo .rescan { margin-top: 4px; color: #f66; font-weight: 600; }
.bdo button { margin-top: 6px; font: inherit; padding: 2px 8px; border-radius: 4px; border: 1px solid #666;
  background: #222; color: #ddd; cursor: pointer; }
`;

const BAD = new Set([
  'permission-denied',
  'no-camera',
  'unsupported',
  'error',
  'exhausted',
  'lost',
]);
const WAIT = new Set(['idle', 'starting', 'loading-map']);

function fmt(n, digits = 2) {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function statusClass(status) {
  if (BAD.has(status)) return 'status-bad';
  if (WAIT.has(status)) return 'status-wait';
  return 'status-ok';
}

/**
 * @param {Object} options
 * @param {import('../core/positioning.js').PositionProvider} options.provider
 * @param {HTMLElement} [options.mount=document.body]
 * @param {Document} [options.document=globalThis.document]
 * @param {() => number} [options.now=Date.now]
 * @param {number} [options.refreshMs=250]  Interval for the pose-age / fusion fields.
 * @param {number} [options.lowConfidence=0.3]
 * @param {typeof setInterval} [options.setInterval]
 * @param {typeof clearInterval} [options.clearInterval]
 * @returns {{ el: HTMLElement, update(): void, show(): void, hide(): void, toggle(): void, destroy(): void }}
 */
export function createDebugOverlay(options) {
  const {
    provider,
    document: doc = globalThis.document,
    mount = doc?.body,
    now = () => Date.now(),
    refreshMs = 250,
    lowConfidence = 0.3,
    setInterval: setIntervalFn = (...a) => globalThis.setInterval(...a),
    clearInterval: clearIntervalFn = (...a) => globalThis.clearInterval(...a),
  } = options ?? {};

  if (!provider || typeof provider.onPose !== 'function') {
    throw new TypeError('createDebugOverlay requires a PositionProvider');
  }
  if (!doc || !mount)
    throw new TypeError('createDebugOverlay requires a document and mount element');

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const el = doc.createElement('div');
  el.className = 'bdo';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <h4>positioning</h4>
    <dl>
      <dt>provider</dt><dd data-f="provider">—</dd>
      <dt>status</dt><dd data-f="status">—</dd>
      <dt>chain</dt><dd data-f="chain">—</dd>
    </dl>
    <div class="bar" data-f="bar"><i style="width:0%"></i></div>
    <dl>
      <dt>confidence</dt><dd data-f="confidence">—</dd>
      <dt>x / y / z</dt><dd data-f="xyz">—</dd>
      <dt>floor</dt><dd data-f="floor">—</dd>
      <dt>heading</dt><dd data-f="heading">—</dd>
      <dt>pose age</dt><dd data-f="age">—</dd>
      <dt>drift</dt><dd data-f="drift">—</dd>
    </dl>
    <div class="rescan" data-f="rescan" hidden>rescan needed — point the camera at something recognisable</div>
    <ul class="failed" data-f="failed" hidden></ul>
    <button type="button" data-f="hide">hide</button>
  `;
  const f = (name) => el.querySelector(`[data-f="${name}"]`);
  mount.appendChild(el);

  let lastPose = null;
  let lastPoseAt = null;
  let rescanNeeded = false;
  const unsubscribe = [];

  unsubscribe.push(
    provider.onPose((pose) => {
      lastPose = pose;
      lastPoseAt = now();
      rescanNeeded = false;
      update();
    })
  );
  if (typeof provider.onStatus === 'function') unsubscribe.push(provider.onStatus(update));
  if (typeof provider.onChange === 'function') unsubscribe.push(provider.onChange(update));
  if (typeof provider.onRescanNeeded === 'function') {
    unsubscribe.push(
      provider.onRescanNeeded(() => {
        rescanNeeded = true;
        update();
      })
    );
  }
  // Fusion inside a chain's active provider, if any.
  const fusionOf = (p) => p?.fusion ?? null;
  const activeOf = () =>
    typeof provider.onChange === 'function' ? provider.state?.provider : provider;

  function update() {
    const isChain = typeof provider.onChange === 'function';
    const chainState = isChain ? provider.state : null;
    const active = activeOf();
    const activeName = isChain
      ? (chainState.active ?? '—')
      : (active?.constructor?.name ?? 'provider');

    // Provider + status
    f('provider').textContent = activeName;
    const status = isChain
      ? chainState.status === 'active'
        ? (active?.status ?? active?.state ?? 'active')
        : chainState.status
      : (provider.status ?? provider.state ?? 'running');
    const statusEl = f('status');
    statusEl.textContent = String(status);
    statusEl.className = statusClass(String(status));

    // Chain
    if (isChain) {
      f('chain').textContent = chainState.order
        .map((n) => (n === chainState.active ? `[${n}]` : n))
        .join(' → ');
      const failed = f('failed');
      failed.hidden = chainState.failed.length === 0;
      failed.textContent = '';
      for (const fail of chainState.failed) {
        const li = doc.createElement('li');
        li.textContent = `${fail.name}: ${fail.reason}`;
        failed.appendChild(li);
      }
    } else {
      f('chain').textContent = 'n/a';
      f('failed').hidden = true;
    }

    // Pose
    const fusion = fusionOf(active);
    const pose = fusion?.getPose?.() ?? lastPose;
    const confidence = pose?.confidence;
    f('confidence').textContent = fmt(confidence);
    const bar = f('bar');
    bar.firstElementChild.style.width = `${Math.round((confidence ?? 0) * 100)}%`;
    bar.className =
      `bar ${confidence === undefined ? 'none' : confidence < lowConfidence ? 'low' : ''}`.trim();
    f('xyz').textContent = pose ? `${fmt(pose.x)} / ${fmt(pose.y)} / ${fmt(pose.z)}` : '—';
    f('floor').textContent = pose ? String(pose.floor) : '—';
    f('heading').textContent = pose ? `${fmt(pose.heading, 0)}°` : '—';
    f('age').textContent =
      lastPoseAt === null ? '—' : `${((now() - lastPoseAt) / 1000).toFixed(1)} s`;
    f('drift').textContent = fusion ? `${fmt(fusion.distanceSinceFix)} m since fix` : '—';
    f('rescan').hidden = !rescanNeeded;
  }

  const timer = setIntervalFn(update, refreshMs);
  const onHide = () => hide();
  f('hide').addEventListener('click', onHide);

  function show() {
    el.hidden = false;
  }
  function hide() {
    el.hidden = true;
  }
  function toggle() {
    el.hidden = !el.hidden;
  }
  function destroy() {
    clearIntervalFn(timer);
    for (const off of unsubscribe) off();
    f('hide').removeEventListener('click', onHide);
    el.remove();
  }

  update();
  return { el, update, show, hide, toggle, destroy };
}
