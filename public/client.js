// ============================================================
// CLIENT — Socket.io + HTML5 Canvas (top-down 2D)
// Il client NON contiene regole di gioco: renderizza lo snapshot
// ricevuto dal server e invia "intenzioni" (move/attack/buy...).
// La nebbia di guerra e' gia' applicata dal server: le caselle
// non esplorate semplicemente non arrivano nel payload.
// ============================================================

const socket = io();

let state = null;          // ultimo snapshot del server (fog of war applicato)
let myId = null;           // id del mio player
let selectedUnitId = null; // unita' selezionata
let selectedUnit = null;   // oggetto unita' selezionata
let selection = null;      // { reachable:[{x,y}], targets:[{x,y}], stats } dal server
let tileXY = {};           // tile_id -> tile (ricostruito a ogni state_update)

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// Palette biomi vividi + stile per classe unita'
const BIOME_COLORS = { water: '#2e86de', plains: '#a3c94a', forest: '#4f8f3b', mountain: '#8fa1b3' };
const CLASS_STYLE = {
  warrior:  { body: '#5d6d7e' }, // acciaio (spada)
  archer:   { body: '#ca6f1e' }, // ambra (arco)
  rider:    { body: '#8e44ad' }, // viola (velocita')
  defender: { body: '#0e7c6b' }, // verde acqua (scudo)
};

// ================= LOBBY =================
document.getElementById('joinBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) return alert('Inserisci un nome');
  socket.emit('join_game', { name });
});

socket.on('lobby_update', ({ players, canStart }) => {
  renderLobby(players);
  document.getElementById('startBtn').style.display = canStart ? 'inline-block' : 'none';
});

document.getElementById('startBtn').addEventListener('click', () => socket.emit('start_game'));

function renderLobby(names) {
  const ul = document.getElementById('lobbyList');
  ul.innerHTML = '';
  names.forEach(n => {
    const li = document.createElement('li');
    li.textContent = n;
    ul.appendChild(li);
  });
}

// ================= AVVIO / RESET PARTITA =================
socket.on('game_started', ({ playerId }) => {
  myId = playerId;
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
});

socket.on('back_to_lobby', () => {
  state = null; myId = null; selectedUnitId = null; selectedUnit = null; selection = null;
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('game').classList.add('hidden');
  document.getElementById('lobby').classList.remove('hidden');
});

// ================= STATO E RENDERING =================
socket.on('state_update', (s) => { state = s; render(); });
socket.on('error_msg', (msg) => addLog('⚠️ ' + msg));
socket.on('selection_info', (info) => { selection = info; renderUnitInfo(); render(); });

function tilePx() { return Math.floor(Math.min(canvas.width, canvas.height) / state.game.map_size); }

function render() {
  if (!state) return;
  const size = state.game.map_size;
  const px = tilePx();
  tileXY = {};
  for (const t of state.tiles) tileXY[t.id] = t;
  const playerById = {};
  state.players.forEach(p => playerById[p.id] = p);

  // --- sfondo + caselle (solo quelle esplorate: nebbia di guerra) ---
  ctx.fillStyle = '#10131a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const t of state.tiles) drawTile(t, px);

  // --- overlay di selezione (calcolati dal server) ---
  if (selection) {
    ctx.fillStyle = 'rgba(80,160,255,0.35)';
    for (const p of selection.reachable) ctx.fillRect(p.x * px, p.y * px, px - 1, px - 1);
    ctx.fillStyle = 'rgba(255,70,70,0.45)';
    for (const p of selection.targets) ctx.fillRect(p.x * px, p.y * px, px - 1, px - 1);
  }

  // --- citta' ---
  for (const c of state.cities) {
    const t = tileXY[c.tile_id];
    if (!t) continue;
    const X = t.x * px, Y = t.y * px;
    ctx.fillStyle = '#f5f0e6'; // mura
    ctx.fillRect(X + px * 0.2, Y + px * 0.38, px * 0.6, px * 0.42);
    ctx.beginPath(); // tetto colorato del proprietario
    ctx.moveTo(X + px * 0.15, Y + px * 0.4);
    ctx.lineTo(X + px * 0.5, Y + px * 0.12);
    ctx.lineTo(X + px * 0.85, Y + px * 0.4);
    ctx.closePath();
    ctx.fillStyle = playerById[c.owner_id] ? playerById[c.owner_id].color : '#fff';
    ctx.fill();
  }

  // --- unita' (icona di classe + fazione + barra HP) ---
  for (const u of state.units) drawUnit(u, px, playerById);

  // --- HUD ---
  document.getElementById('roundInfo').textContent = `Round ${state.game.round}`;
  document.getElementById('goldInfo').textContent = `⭐ ${state.self.gold} oro`;
  const turnEl = document.getElementById('turnInfo');
  if (state.self.turn_ended) {
    turnEl.textContent = '⏳ In attesa degli avversari…';
    turnEl.classList.remove('you');
  } else if (state.self.can_act) {
    turnEl.textContent = '🟢 Il tuo turno';
    turnEl.classList.add('you');
  } else {
    turnEl.textContent = '⏳ In attesa…';
    turnEl.classList.remove('you');
  }

  // --- bottone Fine Turno / Annulla Fine Turno (stato dal server) ---
  const btn = document.getElementById('endTurnBtn');
  if (state.self.turn_ended) {
    btn.textContent = 'Annulla Fine Turno ⏪';
    btn.classList.add('cancel-mode');
  } else {
    btn.textContent = 'Fine Turno ⏭';
    btn.classList.remove('cancel-mode');
  }

  // --- game over ---
  if (state.game.phase === 'finished') {
    const winner = state.players.find(p => p.id === state.game.winner_id);
    document.getElementById('winnerText').textContent =
      winner ? `🏆 ${winner.name} vince la partita!` : '🤝 Patta!';
    document.getElementById('overlay').classList.remove('hidden');
  } else {
    document.getElementById('overlay').classList.add('hidden');
  }
}

// ================= DISEGNO TILES (biomi vividi + ombreggiatura) =================
// Hash deterministico per casella: variazioni non casuali a ogni frame
function tileHash(x, y) {
  let h = (x * 73856093) ^ (y * 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function tri(x1, y1, x2, y2, x3, y3) {
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
  ctx.closePath(); ctx.fill();
}

function drawTile(t, px) {
  const X = t.x * px, Y = t.y * px;
  const h = tileHash(t.x, t.y);

  // base biome vivida
  ctx.fillStyle = BIOME_COLORS[t.biome];
  ctx.fillRect(X, Y, px, px);

  if (t.biome === 'water') {
    // onde: due archi chiari sfalsati in modo deterministico
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = Math.max(1, px * 0.04);
    for (let i = 0; i < 2; i++) {
      const wy = Y + px * (0.34 + 0.3 * i) + (h - 0.5) * px * 0.16;
      ctx.beginPath();
      ctx.moveTo(X + px * 0.18, wy);
      ctx.quadraticCurveTo(X + px * 0.35, wy - px * 0.09, X + px * 0.52, wy);
      ctx.quadraticCurveTo(X + px * 0.69, wy + px * 0.09, X + px * 0.84, wy);
      ctx.stroke();
    }
  } else if (t.biome === 'plains') {
    // ciuffi d'erba scuri
    ctx.strokeStyle = 'rgba(60,100,25,0.55)';
    ctx.lineWidth = Math.max(1, px * 0.035);
    const n = 2 + Math.floor(h * 2); // 2-3 ciuffi
    for (let i = 0; i < n; i++) {
      const gx = X + px * (0.2 + 0.6 * ((h * (i + 1) * 7919) % 1));
      const gy = Y + px * (0.35 + 0.4 * ((h * (i + 3) * 6871) % 1));
      ctx.beginPath();
      ctx.moveTo(gx, gy); ctx.lineTo(gx - px * 0.05, gy - px * 0.12);
      ctx.moveTo(gx, gy); ctx.lineTo(gx + px * 0.03, gy - px * 0.14);
      ctx.stroke();
    }
  } else if (t.biome === 'forest') {
    // due alberi di dimensioni diverse
    drawTree(X + px * (0.32 + h * 0.1), Y + px * 0.62, px * 0.58);
    drawTree(X + px * (0.62 - h * 0.08), Y + px * 0.48, px * 0.46);
  } else { // mountain
    drawMountain(X + px / 2, Y + px * 0.56, px * 0.72);
  }

  // ombreggiatura bevel: luce in alto a sinistra, ombra in basso a destra
  const b = Math.max(1, px * 0.06);
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.fillRect(X, Y, px, b);                       // bordo superiore chiaro
  ctx.fillRect(X, Y, b, px);                       // bordo sinistro chiaro
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.fillRect(X, Y + px - b, px, b);              // bordo inferiore scuro
  ctx.fillRect(X + px - b, Y, b, px);              // bordo destro scuro

  // bordo casella netto
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(X + 0.5, Y + 0.5, px - 1, px - 1);
}

function drawTree(x, y, s) { // x,y = base del tronco, s = altezza totale
  ctx.fillStyle = '#6d4c2f'; // tronco
  ctx.fillRect(x - s * 0.05, y - s * 0.18, s * 0.1, s * 0.2);
  ctx.fillStyle = '#2e7d32'; // chioma: due strati di verde
  tri(x, y - s * 0.62, x - s * 0.30, y - s * 0.14, x + s * 0.30, y - s * 0.14);
  ctx.fillStyle = '#388e3c';
  tri(x, y - s * 0.78, x - s * 0.24, y - s * 0.36, x + s * 0.24, y - s * 0.36);
}

function drawMountain(x, y, s) { // x,y = centro della base
  ctx.fillStyle = '#8fa1b3'; // corpo scistoso
  tri(x - s * 0.45, y + s * 0.32, x, y - s * 0.45, x + s * 0.45, y + s * 0.32);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; // ombra lato destro
  tri(x, y - s * 0.45, x + s * 0.45, y + s * 0.32, x + s * 0.27, y + s * 0.32);
  ctx.fillStyle = '#f5f7fa'; // cima innevata
  tri(x - s * 0.14, y - s * 0.16, x, y - s * 0.45, x + s * 0.14, y - s * 0.16);
}

// ================= DISEGNO UNITA' (icona composita di classe) =================
function drawUnit(u, px, playerById) {
  const p = playerById[u.owner_id];
  if (!p) return;
  const cx = u.x * px + px / 2, cy = u.y * px + px / 2;
  const r = px * 0.30;

  ctx.globalAlpha = (u.owner_id === myId && u.has_moved) ? 0.45 : 1; // opaca se ha gia' agito

  // corpo: cerchio con palette specifica della classe
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = CLASS_STYLE[u.type].body;
  ctx.fill();
  ctx.lineWidth = u.id === selectedUnitId ? 3 : 2;
  ctx.strokeStyle = u.id === selectedUnitId ? '#ffe14d' : 'rgba(0,0,0,0.55)'; // anello giallo se selezionata
  ctx.stroke();

  // icona geometrica composita della classe
  drawClassIcon(u.type, cx, cy, r);

  // indicatore fazione (striscia colorata) + barra HP sopra l'unita'
  const bw = px * 0.52;
  ctx.fillStyle = p.color; // striscia fazione
  ctx.fillRect(cx - bw / 2, cy - r - 6, bw, 2);
  const maxHp = state.catalog[u.type] ? state.catalog[u.type].hp : 10;
  const frac = Math.max(0, Math.min(1, u.hp / maxHp));
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; // sfondo barra HP
  ctx.fillRect(cx - bw / 2, cy - r - 3, bw, 4);
  ctx.fillStyle = frac > 0.5 ? '#6ee76e' : frac > 0.25 ? '#ffd166' : '#ff5c5c'; // verde/giallo/rosso
  ctx.fillRect(cx - bw / 2 + 0.5, cy - r - 2.5, (bw - 1) * frac, 3);

  ctx.globalAlpha = 1;
}

function drawClassIcon(type, cx, cy, r) {
  const s = r * 0.62; // semidimensione dell'icona
  if (type === 'warrior') {
    // spada: punta + lama + guardia dorata + impugnatura
    ctx.fillStyle = '#e8edf2';
    tri(cx, cy - s * 1.15, cx - s * 0.32, cy - s * 0.45, cx + s * 0.32, cy - s * 0.45);
    ctx.fillRect(cx - s * 0.16, cy - s * 0.5, s * 0.32, s * 1.0);
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(cx - s * 0.55, cy + s * 0.42, s * 1.1, s * 0.22);
    ctx.fillStyle = '#6d4c2f';
    ctx.fillRect(cx - s * 0.12, cy + s * 0.64, s * 0.24, s * 0.5);
  } else if (type === 'archer') {
    // arco: curva + corda + freccia con punta
    const ax = cx - s * 0.25, ar = s * 0.95, th = Math.PI / 2.6;
    ctx.strokeStyle = '#e8c39e';
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.beginPath();
    ctx.arc(ax, cy, ar, -th, th); // arco che apre a destra
    ctx.stroke();
    const ex = ax + ar * Math.cos(th);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ex, cy - ar * Math.sin(th)); ctx.lineTo(ex, cy + ar * Math.sin(th)); ctx.stroke(); // corda
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, r * 0.1);
    ctx.beginPath(); ctx.moveTo(cx - s * 0.8, cy); ctx.lineTo(cx + s * 0.75, cy); ctx.stroke(); // freccia
    ctx.fillStyle = '#fff';
    tri(cx + s * 1.05, cy, cx + s * 0.62, cy - s * 0.3, cx + s * 0.62, cy + s * 0.3); // punta
  } else if (type === 'rider') {
    // ferro di cavallo dorato (simbolo equestre/velocita')
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = Math.max(2, r * 0.2);
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.15, s * 0.7, Math.PI * 0.08, Math.PI * 0.92); // "U" con apertura in alto
    ctx.stroke();
  } else if (type === 'defender') {
    // scudo: spalla dritta + punta arrotondata + linea centrale
    ctx.fillStyle = '#e8edf2';
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.75, cy - s * 0.6);
    ctx.lineTo(cx + s * 0.75, cy - s * 0.6);
    ctx.lineTo(cx + s * 0.75, cy + s * 0.1);
    ctx.quadraticCurveTo(cx + s * 0.75, cy + s * 0.75, cx, cy + s * 0.95);
    ctx.quadraticCurveTo(cx - s * 0.75, cy + s * 0.75, cx - s * 0.75, cy + s * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0e7c6b';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.45); ctx.lineTo(cx, cy + s * 0.7); ctx.stroke();
  }
}

// ================= CLICK SULLA TILES =================
canvas.addEventListener('click', (e) => {
  if (!state || state.game.phase !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const px = tilePx() * (canvas.width / rect.width); // scala per CSS responsive
  const x = Math.floor((e.clientX - rect.left) / px);
  const y = Math.floor((e.clientY - rect.top) / px);
  handleTileClick(x, y);
});

function unitAt(x, y) { return state.units.find(u => u.x === x && u.y === y); }
function cityAt(x, y) {
  const t = Object.values(tileXY).find(t => t.x === x && t.y === y);
  if (!t) return null;
  return state.cities.find(c => c.tile_id === t.id) || null;
}

function handleTileClick(x, y) {
  const u = unitAt(x, y);

  // 1) seleziona un'unita' propria -> chiedi al server i movimenti validi (anti-cheat)
  if (u && u.owner_id === myId && state.self.can_act) {
    selectedUnitId = u.id;
    selectedUnit = u;
    selection = null;
    socket.emit('select_unit', { unitId: u.id }); // risposta: 'selection_info'
    renderUnitInfo();
    hideBuyPanel();
    return;
  }

  // 2) con un'unita' selezionata: muoviti o attacca
  if (selectedUnitId && selection) {
    const dest = selection.reachable.find(p => p.x === x && p.y === y);
    const target = selection.targets.find(p => p.x === x && p.y === y);
    if (dest)   { socket.emit('move_unit',   { unitId: selectedUnitId, toX: x, toY: y }); clearSelection(); return; }
    if (target) { socket.emit('attack_unit', { unitId: selectedUnitId, targetX: x, targetY: y }); clearSelection(); return; }
  }

  // 3) click su citta' propria -> pannello addestramento
  const c = cityAt(x, y);
  if (c && c.owner_id === myId) showBuyPanel(c.id);
  else hideBuyPanel();

  clearSelection();
}

function clearSelection() { selectedUnitId = null; selectedUnit = null; selection = null; renderUnitInfo(); }

// ================= PANNELLO LATERALE =================
function renderUnitInfo() {
  const el = document.getElementById('unitInfo');
  if (!selectedUnit || !selection) { el.textContent = "Seleziona un'unità o una città."; return; }
  const s = selection.stats;
  el.innerHTML =
    `<b>${s.name}</b> (tua)<br>` +
    `⚔️ ATK ${s.atk} · 🛡️ DEF ${s.def}<br>` +
    `❤️ HP ${selectedUnit.hp}/${s.hp} · 👟 MOV ${s.mov} · 🎯 RNG ${s.rng}`;
}

function showBuyPanel(cityId) {
  const panel = document.getElementById('buyPanel');
  panel.innerHTML = '<b>Addestra unità</b>';
  for (const [key, s] of Object.entries(state.catalog)) {
    const btn = document.createElement('button');
    btn.className = 'buyBtn';
    btn.textContent = `${s.name} — ${s.cost} ⭐`;
    btn.disabled = state.self.gold < s.cost || !state.self.can_act;
    btn.onclick = () => socket.emit('buy_unit', { cityId, type: key });
    panel.appendChild(btn);
  }
  panel.classList.remove('hidden');
}

function hideBuyPanel() { document.getElementById('buyPanel').classList.add('hidden'); }

// ================= FINE TURNO / ANNULLA (stato dal server) =================
document.getElementById('endTurnBtn').addEventListener('click', () => {
  if (!state || state.game.phase !== 'playing') return;
  // lo stato "in sospeso" vive nel server: il bottone e' solo uno specchio di state.self.turn_ended
  if (state.self.turn_ended) socket.emit('cancel_end_turn');
  else socket.emit('end_turn');
});

document.getElementById('newGameBtn').addEventListener('click', () => socket.emit('reset_game'));

function addLog(msg) {
  const li = document.createElement('li');
  li.textContent = msg;
  const logEl = document.getElementById('log');
  logEl.prepend(li);
  while (logEl.children.length > 12) logEl.lastChild.remove();
}
