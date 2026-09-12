// ============================================================
// RENDER HARNESS — verifica empirica del rendering client
// ------------------------------------------------------------
// PARTE A (main): cattura snapshot REALI dal server live
//   (2 giocatori, partita avviata) + selection_info.
// PARTE B (worker con watchdog anti-freeze): riproduce lo
//   snapshot in un sandbox vm con DOM/canvas MOCK strumentati:
//   il ctx traccia la trasformazione affine corrente e risolve
//   OGNI chiamata di disegno in coordinate assolute del canvas.
//   Verifiche:
//     1) base tile (x,y) ESATTAMENTE in (LABEL_W+x*px, LABEL_H+y*px);
//     2) centro unita' = centro della sua casella;
//     3) INVARIANTE CONFINI: nessun punto di disegno esce dalla griglia;
//     4) MAPPING CLICK: click al centro di una casella -> inspector
//        "Casella <coord>" corretta / select_unit con id giusto.
//   Se il worker non risponde in 20s => FREEZE (loop infinito).
// Uso: node test/render-harness.js   (server live su :3000)
// ============================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const ioClient = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const URL = 'http://localhost:3000';

// ================= PARTE A — CATTURA DAL SERVER LIVE =================
function connect() {
  return new Promise((res, rej) => {
    const s = ioClient(URL, { transports: ['websocket'], forceNew: true });
    const t = setTimeout(() => rej(new Error('timeout connessione')), 6000);
    s.on('connect', () => { clearTimeout(t); res(s); });
    s.on('connect_error', e => { clearTimeout(t); rej(e); });
  });
}

// Pattern "ultimo stato": registro handler persistenti e leggo lo stato più
// recente (evita le race degli eventi già consegnati prima del once()).
function track(sock) {
  const st = { lobby: null, state: null, selInfo: null };
  sock.on('lobby_update', d => { st.lobby = d; });
  sock.on('state_update', d => { st.state = d; });
  sock.on('selection_info', d => { st.selInfo = d; });
  return st;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); }
  return false;
}

async function capture() {
  const a = await connect(); // host
  const b = await connect();
  const stA = track(a), stB = track(b);
  a.emit('join_game', { name: 'HostT' });
  b.emit('join_game', { name: 'GuestT' });
  if (!await until(() => stA.lobby && stA.lobby.players.length >= 2)) throw new Error('lobby mai popolata');
  a.emit('choose_faction', { factionId: 'valoria' });
  b.emit('choose_faction', { factionId: 'nordmark' });
  if (!await until(() => stA.lobby && stA.lobby.players.length >= 2 && stA.lobby.players.every(p => p.faction))) throw new Error('fazioni mai confermate');
  const mapSize = Number(process.env.MAP_SIZE) || 12; // dimensione mappa da testare (default 12)
  a.emit('start_game', { mapSize, density: { water: 0.38, mountain: 0.25, forest: 0.4 }, villages: 4 });
  if (!await until(() => stA.state && stB.state)) throw new Error('state_update mai ricevuto');

  let selInfo = null;
  if (stA.state.units.length && stA.state.self.is_current) {
    a.emit('select_unit', { unitId: stA.state.units[0].id });
    await until(() => stA.selInfo !== null, 3000);
    selInfo = stA.selInfo;
  }

  a.close(); b.close();
  return { snapA: stA.state, snapB: stB.state, selInfo };
}

// ================= PARTE B — REPLAY IN SANDBOX (mock DOM+canvas) =================
function makeElement(id) {
  const el = {
    id, _innerHTML: '', textContent: '', value: '', disabled: false, title: '',
    style: {}, dataset: {}, options: [], children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; if (on) this._s.add(c); else this._s.delete(c); return on; },
      contains(c) { return this._s.has(c); },
    },
    set innerHTML(v) { el._innerHTML = String(v); }, get innerHTML() { return el._innerHTML; },
    appendChild(ch) { el.children.push(ch); return ch; },
    insertAdjacentHTML() {}, prepend() {}, remove() {},
    addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
  };
  return el;
}

function makeCtx(canvas, calls) {
  let m = [1, 0, 0, 1, 0, 0]; // affine corrente [a,b,c,d,e,f]
  const stack = [];
  let clip = null;            // regione di clip attiva in coordinate assolute {x0,y0,x1,y1}
  let pendingRects = [];      // rect() in attesa di clip()
  const mul = (m2) => {
    const [a2, b2, c2, d2, e2, f2] = m2;
    return [a2 * m[0] + c2 * m[1], b2 * m[0] + d2 * m[1], a2 * m[2] + c2 * m[3], b2 * m[2] + d2 * m[3], a2 * m[4] + c2 * m[5] + e2, b2 * m[4] + d2 * m[5] + f2];
  };
  const pt = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  // un punto e' "visibile" solo se dentro la clip corrente (come nel browser reale)
  const visible = (x, y) => !clip || (x >= clip.x0 - 0.5 && x <= clip.x1 + 0.5 && y >= clip.y0 - 0.5 && y <= clip.y1 + 0.5);
  let pathPts = [];
  const ctx = {
    canvas,
    save() { stack.push({ m: m.slice(), clip }); },
    restore() { if (stack.length) { const s = stack.pop(); m = s.m; clip = s.clip; } },
    translate(x, y) { m = mul([1, 0, 0, 1, x, y]); },
    scale(sx, sy) { m = mul([sx, 0, 0, sy, 0, 0]); },
    setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; },
    beginPath() { pathPts = []; pendingRects = []; },
    closePath() {},
    rect(x, y, w, h) { const p = pt(x, y); pendingRects.push({ x0: p[0], y0: p[1], x1: p[0] + Math.abs(w * m[0]), y1: p[1] + Math.abs(h * m[3]) }); },
    clip() { for (const r of pendingRects) { if (!clip) clip = r; else clip = { x0: Math.max(clip.x0, r.x0), y0: Math.max(clip.y0, r.y0), x1: Math.min(clip.x1, r.x1), y1: Math.min(clip.y1, r.y1) }; } pendingRects = []; },
    moveTo(x, y) { const p = pt(x, y); if (!visible(p[0], p[1])) return; pathPts.push(p); calls.push({ op: 'moveTo', ax: p[0], ay: p[1] }); },
    lineTo(x, y) { const p = pt(x, y); if (!visible(p[0], p[1])) return; pathPts.push(p); calls.push({ op: 'lineTo', ax: p[0], ay: p[1] }); },
    quadraticCurveTo(cx, cy, x, y) { const p1 = pt(cx, cy), p2 = pt(x, y); if (!visible(p1[0], p1[1]) && !visible(p2[0], p2[1])) return; pathPts.push(p1, p2); calls.push({ op: 'qCurve', ax: p1[0], ay: p1[1], bx: p2[0], by: p2[1] }); },
    arc(cx, cy, r) { const p = pt(cx, cy); if (!visible(p[0], p[1])) return; pathPts.push(p); calls.push({ op: 'arc', ax: p[0], ay: p[1], r: Math.abs(r * m[0]) }); },
    arcTo(x1, y1, x2, y2) { const p = pt(x1, y1); if (!visible(p[0], p[1])) return; pathPts.push(p); calls.push({ op: 'arcTo', ax: p[0], ay: p[1] }); },
    clearRect() {}, drawImage() {}, fillText() {}, strokeText() {}, measureText() { return { width: 0 }; },
    ellipse(cx, cy, rx, ry) { const p = pt(cx, cy); pathPts.push(p); calls.push({ op: 'ellipse', ax: p[0], ay: p[1], rx: Math.abs(rx * m[0]), ry: Math.abs(ry * m[3]) }); },
    fillRect(x, y, w, h) { const p = pt(x, y); calls.push({ op: 'fillRect', ax: p[0], ay: p[1], w: Math.abs(w * m[0]), h: Math.abs(h * m[3]) }); },
    strokeRect(x, y, w, h) { const p = pt(x, y); calls.push({ op: 'strokeRect', ax: p[0], ay: p[1], w: Math.abs(w * m[0]), h: Math.abs(h * m[3]) }); },
    fill() {}, stroke() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
  };
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha', 'shadowColor', 'shadowBlur', 'shadowOffsetY', 'font', 'textAlign', 'textBaseline']) ctx[k] = undefined;
  return ctx;
}

function buildSandbox(snap, selInfo) {
  const calls = [];
  const canvasEl = makeElement('board');
  canvasEl.width = 640; canvasEl.height = 640;
  // proprietà "live" come nel browser: clientWidth/Height seguono il backing store (mock senza bordi/CSS)
  Object.defineProperty(canvasEl, 'clientWidth', { get: () => canvasEl.width });
  Object.defineProperty(canvasEl, 'clientHeight', { get: () => canvasEl.height });
  canvasEl.clientLeft = 0; canvasEl.clientTop = 0;
  const ctx2d = makeCtx(canvasEl, calls);
  canvasEl.getContext = () => ctx2d;
  canvasEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: canvasEl.width, height: canvasEl.height });

  const els = {};
  els['board'] = canvasEl; // il canvas strumentato DEVE essere quello che riceve client.js
  const getEl = (id) => { if (!els[id]) els[id] = makeElement(id); return els[id]; };
  ['waterRange', 'mountainRange', 'forestRange'].forEach(id => { getEl(id).value = '30'; });
  getEl('villageRange').value = '4';
  getEl('mapSizeSel').value = '12';

  const clickHandlers = [];
  canvasEl.addEventListener = (evt, fn) => { if (evt === 'click') clickHandlers.push(fn); };

  const emitted = [];
  const handlers = {};
  const socketMock = {
    id: 'mock-socket',
    on(evt, cb) { handlers[evt] = cb; },
    emit(evt, data) { emitted.push({ evt, data }); },
  };

  const documentMock = {
    getElementById: getEl,
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement(tag) { return makeElement('<' + tag + '>'); },
  };
  const windowMock = { addEventListener() {} };

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: documentMock, window: windowMock,
    io: () => socketMock,
    Path2D: class { constructor(d) { this.d = d; } },
    Date, Math, JSON, Object, Array, String, Number, Boolean, Promise,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const load = (f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'), sandbox, { filename: f });
  load('assets.js');
  load('client.js');

  // stessa sequenza di una sessione reale: game_started (imposta myId) poi snapshot
  handlers['game_started']({ playerId: snap.self.id });
  handlers['state_update'](snap);
  if (selInfo) handlers['selection_info'](selInfo);

  return { els, canvasEl, calls, emitted, clickHandlers };
}

function colLabel(i) { let s = ''; i += 1; while (i > 0) { const mm = (i - 1) % 26; s = String.fromCharCode(65 + mm) + s; i = Math.floor((i - 1) / 26); } return s; }

function verify(snap, env) {
  const LABEL_W = 28, LABEL_H = 20; // devono coincidere con client.js
  const size = snap.game.map_size;
  const px = Math.floor(640 / size);
  const W = size * px + LABEL_W, H = size * px + LABEL_H;
  let fails = [];

  if (env.canvasEl.width !== W || env.canvasEl.height !== H)
    fails.push(`canvas ${env.canvasEl.width}x${env.canvasEl.height} != atteso ${W}x${H}`);

  // 1) base tile esatta
  for (const t of snap.tiles) {
    const ex = LABEL_W + t.x * px, ey = LABEL_H + t.y * px;
    const hit = env.calls.find(c => c.op === 'fillRect' && Math.abs(c.ax - ex) < 0.01 && Math.abs(c.ay - ey) < 0.01 && Math.abs(c.w - px) < 0.01 && Math.abs(c.h - px) < 0.01);
    if (!hit) fails.push(`tile ${t.x},${t.y}: base NON in (${ex},${ey}) lato ${px}`);
  }

  // 2) centro unita' = centro casella
  for (const u of snap.units) {
    const ex = LABEL_W + u.x * px + px / 2, ey = LABEL_H + u.y * px + px / 2;
    const hit = env.calls.find(c => c.op === 'arc' && Math.abs(c.ax - ex) < 0.5 && Math.abs(c.ay - ey) < 0.5);
    if (!hit) fails.push(`unita' ${u.type} @${u.x},${u.y}: arco NON centrato in (${ex},${ey})`);
  }

  // 3) INVARIANTE CONFINI: ogni punto di disegno dentro la griglia mappa.
  //    Eccezione legittima: i fill del fondo/gutter, disegnati in coordinate
  //    assolute PRIMA della translate (origine canvas).
  const eps = 0.6;
  for (const c of env.calls) {
    if (!('ax' in c)) continue;
    if (c.op === 'fillRect' && c.ax <= 0.01 && c.ay <= 0.01) continue; // fondo + gutter: ok
    if (c.ax < LABEL_W - eps || c.ax > W + eps || c.ay < LABEL_H - eps || c.ay > H + eps) {
      fails.push(`FUORI GRIGLIA: ${c.op} in (${c.ax.toFixed(1)},${c.ay.toFixed(1)}) [griglia x:${LABEL_W}..${W}, y:${LABEL_H}..${H}]`);
    }
  }

  // 4) MAPPING CLICK: centro di una casella esplorata vuota -> inspector "Casella X#"
  const emptyTile = snap.tiles.find(t => !snap.units.some(u => u.x === t.x && u.y === t.y));
  if (emptyTile) {
    const cx = LABEL_W + emptyTile.x * px + px / 2, cy = LABEL_H + emptyTile.y * px + px / 2;
    for (const fn of env.clickHandlers) fn({ clientX: cx, clientY: cy });
    const html = env.els['unitInfo'] ? env.els['unitInfo'].innerHTML : '';
    const expected = `Casella ${colLabel(emptyTile.x)}${emptyTile.y + 1}`;
    if (!html.includes(expected)) fails.push(`CLICK MAPPING: click su (${emptyTile.x},${emptyTile.y}) -> inspector "${(html.match(/Casella [A-Z]+\d+/) || ['NESSUNA COORD'])[0]}" (atteso ${expected})`);
  }

  // 4b) click su unita' propria attiva -> select_unit con id corretto
  const myUnit = snap.units.find(u => u.owner_id === snap.self.id && !u.has_moved);
  if (myUnit && snap.self.is_current) {
    const cx = LABEL_W + myUnit.x * px + px / 2, cy = LABEL_H + myUnit.y * px + px / 2;
    for (const fn of env.clickHandlers) fn({ clientX: cx, clientY: cy });
    const sel = env.emitted.find(e => e.evt === 'select_unit');
    if (!sel || sel.data.unitId !== myUnit.id) fails.push(`CLICK UNITA': select_unit emesso ${JSON.stringify(sel && sel.data)} (atteso unitId=${myUnit.id})`);
  }

  return { fails, W, H, px, size };
}

// ================= MAIN / WORKER =================
if (isMainThread) {
  (async () => {
    if (process.env.SKIP_CAPTURE === '1') {
      // Riutilizza gli snapshot esistenti (_snapA.json/_snapB.json), ad es. quelli
      // generati da make-snapshot.js: utile quando il server live ha una partita in corso.
      console.log('--- PARTE A: SKIPPED (SKIP_CAPTURE=1, riutilizzo snapshot esistenti) ---');
    } else {
      console.log('--- PARTE A: cattura snapshot dal server live ---');
      const data = await capture();
      fs.writeFileSync(path.join(__dirname, '_snapA.json'), JSON.stringify(data.snapA));
      fs.writeFileSync(path.join(__dirname, '_snapB.json'), JSON.stringify(data.snapB));
      console.log(`  snapA: ${data.snapA.tiles.length} tile visibili, ${data.snapA.units.length} unita', is_current=${data.snapA.self.is_current}`);
      console.log(`  snapB: ${data.snapB.tiles.length} tile visibili (vista nemica)`);
    }

    // PARTE B in un worker con watchdog anti-freeze
    const w = new Worker(__filename, { workerData: {} });
    const result = await new Promise((res) => {
      const t = setTimeout(() => { try { w.terminate(); } catch (e) {} res({ freeze: true }); }, 20000);
      w.on('message', m => { clearTimeout(t); res(m); });
      w.on('error', e => { clearTimeout(t); res({ error: String(e && e.message || e) }); });
    });

    if (result.freeze) { console.error('\n❌ FREEZE REPRODOTTO: il replay del rendering/click non termina in 20s (loop infinito!)'); process.exit(1); }
    if (result.error) { console.error('Errore worker:', result.error); process.exit(1); }

    let anyFail = false;
    for (const [label, fails, meta] of [[`A (host/valoria)`, result.failsA, result.metaA], [`B (nordmark)`, result.failsB, result.metaB]]) {
      console.log(`\n--- PARTE B: replay ${label} — canvas ${meta.W}x${meta.H}, px=${meta.px}, size=${meta.size} ---`);
      if (!fails.length) console.log('  ✅ tutte le invarianti (coordinate tile/unita, confini griglia, mapping click) PASS');
      else { anyFail = true; for (const f of fails.slice(0, 25)) console.error('  ❌ ' + f); if (fails.length > 25) console.error(`  ... altre ${fails.length - 25} violazioni`); }
    }
    process.exit(anyFail ? 1 : 0);
  })().catch(e => { console.error('ERRORE HARNESS:', e.message); process.exit(1); });
} else {
  const snapA = JSON.parse(fs.readFileSync(path.join(__dirname, '_snapA.json'), 'utf8'));
  const snapB = JSON.parse(fs.readFileSync(path.join(__dirname, '_snapB.json'), 'utf8'));
  const envA = buildSandbox(snapA, null);
  const rA = verify(snapA, envA);
  const envB = buildSandbox(snapB, null);
  const rB = verify(snapB, envB);
  parentPort.postMessage({ failsA: rA.fails, metaA: { W: rA.W, H: rA.H, px: rA.px, size: rA.size }, failsB: rB.fails, metaB: { W: rB.W, H: rB.H, px: rB.px, size: rB.size } });
}
