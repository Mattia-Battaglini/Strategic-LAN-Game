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
let lobbyPlayers = [];     // ultimo payload lobby_update.players
let iAmInLobby = false;    // il mio socket e' presente nella lista lobby
let buyPoint = null;       // { id, name } del punto di addestramento con pannello aperto

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// ---------- STATO CONNESSIONE (se il server non risponde lo mostro subito) ----------
let connected = false;
function updateConnStatus() {
  document.getElementById('connStatus').classList.toggle('hidden', connected);
}
socket.on('connect', () => { connected = true; updateConnStatus(); });
socket.on('disconnect', () => { connected = false; updateConnStatus(); });
// Se la connessione iniziale non riesce (server spento), socket.io ritenta in
// silenzio: dopo 3s senza mai essere connessi mostro l'avviso comunque.
setTimeout(() => { if (!connected) updateConnStatus(); }, 3000);

// ---------- ERRORI LOBBY VISIBILI (prima finivano nel log nascosto del gioco) ----------
let lobbyErrorTimer = null;
function showLobbyError(msg) {
  const el = document.getElementById('lobbyError');
  el.textContent = '⚠️ ' + msg;
  clearTimeout(lobbyErrorTimer);
  lobbyErrorTimer = setTimeout(() => { el.textContent = ''; }, 8000);
}

// Palette biomi vividi
const BIOME_COLORS = { water: '#2e86de', plains: '#a3c94a', forest: '#4f8f3b', mountain: '#8fa1b3' };

// Meta fazioni per la UI della lobby (il server resta la fonte di verita')
const FACTION_META = {
  valoria:  { name: 'Valoria',  color: '#e74c3c', desc: "Impero bilanciato: un ruolo per ogni situazione." },
  nordmark: { name: 'Nordmark', color: '#3b6fd4', desc: "Clan del Nord: pesanti e difensivi, cavalleria fulminea." },
  saharim:  { name: 'Saharim',  color: '#f0a13a', desc: "Nomadi del deserto: rapidi e con grande visione." },
  aqualis:  { name: 'Aqualis',  color: '#18bfa0', desc: "Popolo delle maree: i suoi Nuotatori attraversano l'acqua." },
};

// ================= LOBBY =================
document.getElementById('joinBtn').addEventListener('click', () => {
  if (!connected) return showLobbyError('Non sei connesso al server: ricarica la pagina.');
  const name = document.getElementById('nameInput').value.trim();
  if (!name) return alert('Inserisci un nome');
  socket.emit('join_game', { name });
});

// Popola il selettore fazioni (disabilitato finche' non sei in lobby)
(function initFactionSelect() {
  const sel = document.getElementById('factionSelect');
  for (const [id, f] of Object.entries(FACTION_META)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${f.name}`;
    sel.appendChild(opt);
  }
  sel.disabled = true; // si sblocca quando il server conferma l'ingresso in lobby
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    socket.emit('choose_faction', { factionId: sel.value });
    document.getElementById('factionDesc').textContent = FACTION_META[sel.value].desc;
  });
})();

// Slider densita': mostra il valore corrente
for (const [id, valId] of [['waterRange','waterVal'],['mountainRange','mountainVal'],['forestRange','forestVal'],['villageRange','villageVal']]) {
  const el = document.getElementById(id);
  const show = () => document.getElementById(valId).textContent = el.value + (id === 'villageRange' ? '' : '%');
  el.addEventListener('input', show);
  show();
}

socket.on('lobby_update', ({ players, canStart }) => {
  lobbyPlayers = players;
  iAmInLobby = players.some(pl => pl.socketId === socket.id);
  document.getElementById('factionSelect').disabled = !iAmInLobby; // fazione solo dopo l'ingresso in lobby
  renderLobby(players, canStart);
  document.getElementById('startBtn').style.display = canStart ? 'inline-block' : 'none';
  document.getElementById('configPanel').classList.toggle('hidden', !canStart);
});

// L'host avvia con la configurazione della generazione mondo
document.getElementById('startBtn').addEventListener('click', () => {
  if (!connected) return showLobbyError('Non sei connesso al server: ricarica la pagina.');
  socket.emit('start_game', {
    mapSize: +document.getElementById('mapSizeSel').value,
    density: {
      water: +document.getElementById('waterRange').value / 100,
      mountain: +document.getElementById('mountainRange').value / 100,
      forest: +document.getElementById('forestRange').value / 100,
    },
    villages: +document.getElementById('villageRange').value,
  });
});

function renderLobby(players, canStart) {
  const ul = document.getElementById('lobbyList');
  ul.innerHTML = '';
  players.forEach(pl => {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'faction-dot';
    badge.style.background = pl.faction ? FACTION_META[pl.faction].color : '#555c68';
    badge.title = pl.faction ? FACTION_META[pl.faction].name : 'nessuna fazione';
    li.appendChild(badge);
    const label = document.createElement('span');
    label.textContent = ` ${pl.name}${pl.isHost ? ' 👑' : ''}`;
    li.appendChild(label);
    // Admin: l'host puo' espellere gli altri dalla stanza
    if (canStart && pl.socketId !== socket.id) {
      const kick = document.createElement('button');
      kick.className = 'kickBtn';
      kick.textContent = '✕';
      kick.title = `Espelli ${pl.name}`;
      kick.onclick = () => socket.emit('kick_player', { target: pl.socketId });
      li.appendChild(kick);
    }
    ul.appendChild(li);
  });

  // Disabilita le fazioni gia' prese da altri giocatori
  const sel = document.getElementById('factionSelect');
  for (const opt of sel.options) {
    if (!opt.value) continue;
    const takenByOther = players.some(pl => pl.faction === opt.value && pl.socketId !== socket.id);
    opt.disabled = takenByOther;
  }
}

// Espulso dalla lobby dall'host: resetta la UI locale
socket.on('kicked', (msg) => {
  alert(msg);
  iAmInLobby = false;
  document.getElementById('factionSelect').value = '';
  document.getElementById('factionSelect').disabled = true;
  document.getElementById('factionDesc').textContent = '';
});

// Espulso dalla partita in corso: resta come spettatore (continua a ricevere snapshot)
socket.on('kicked_from_game', (msg) => {
  addLog('🛡️ ' + msg);
  alert(msg);
});

// ================= AVVIO / RESET PARTITA =================
socket.on('game_started', ({ playerId }) => {
  myId = playerId;
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
});

socket.on('back_to_lobby', () => {
  state = null; myId = null; selectedUnitId = null; selectedUnit = null; selection = null;
  lobbyPlayers = []; iAmInLobby = false; buyPoint = null;
  // resetta la scelta fazione (il server l'ha azzerata: va ricompilata)
  document.getElementById('factionSelect').value = '';
  document.getElementById('factionSelect').disabled = true;
  document.getElementById('factionDesc').textContent = '';
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('adminPanel').classList.add('hidden');
  document.getElementById('game').classList.add('hidden');
  document.getElementById('lobby').classList.remove('hidden');
});

// ================= STATO E RENDERING =================
socket.on('state_update', (s) => { state = s; render(); });
// Gli errori in lobby vanno nel banner visibile, non nel log nascosto del gioco
socket.on('error_msg', (msg) => {
  const inGame = !document.getElementById('game').classList.contains('hidden');
  if (inGame) addLog('⚠️ ' + msg); else showLobbyError(msg);
});
socket.on('game_log', (msg) => addLog(msg));
socket.on('selection_info', (info) => { selection = info; renderUnitInfo(); render(); });

function tilePx() { return Math.floor(Math.min(canvas.width, canvas.height) / state.game.map_size); }

function render() {
  if (!state) return;
  // Se non e' piu' il mio turno (o la partita e' finita), azzera eventuali
  // selezioni residue: altrimenti resterebbero evidenziate caselle "fantasma".
  if (!state.self.is_current || state.game.phase !== 'playing') {
    selectedUnitId = null; selectedUnit = null; selection = null;
  }
  // ridimensiona il canvas alla dimensione esatta della mappa (niente margini scuri)
  const size = state.game.map_size;
  const px0 = Math.floor(Math.min(640, 640) / size);
  canvas.width = size * px0;
  canvas.height = size * px0;
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

  // --- villaggi (capanna; tetto colorato se conquistato) ---
  for (const v of state.villages) {
    const t = tileXY[v.tile_id];
    if (!t) continue;
    const X = t.x * px, Y = t.y * px;
    ctx.fillStyle = '#c9a06b'; // pareti in legno
    ctx.fillRect(X + px * 0.28, Y + px * 0.45, px * 0.44, px * 0.3);
    ctx.beginPath(); // tetto
    ctx.moveTo(X + px * 0.18, Y + px * 0.47);
    ctx.lineTo(X + px * 0.5, Y + px * 0.2);
    ctx.lineTo(X + px * 0.82, Y + px * 0.47);
    ctx.closePath();
    ctx.fillStyle = v.owner_id && playerById[v.owner_id] ? playerById[v.owner_id].color : '#6b5b4a'; // neutro se non conquistato
    ctx.fill();
  }

  // --- unita' (icona di classe + fazione + barra HP) ---
  for (const u of state.units) drawUnit(u, px, playerById);

  // --- HUD ---
  document.getElementById('roundInfo').textContent = `Round ${state.game.round}`;
  document.getElementById('goldInfo').textContent = `⭐ ${state.self.gold} oro`;
  const turnEl = document.getElementById('turnInfo');
  if (state.self.is_current) {
    turnEl.textContent = '🟢 Il tuo turno';
    turnEl.classList.add('you');
  } else {
    const cur = state.players.find(p => p.id === state.game.current_player_id);
    turnEl.textContent = `⏳ In attesa di ${cur ? cur.name : '…'}…`;
    turnEl.classList.remove('you');
  }

  // --- bottone Annulla Mossa (disponibile solo nel proprio turno, con mosse fatte) ---
  const undoBtn = document.getElementById('undoBtn');
  undoBtn.disabled = !state.self.is_current || state.self.undo_count === 0;

  // --- bottone Fine Turno: attivo solo per chi e' il player corrente ---
  document.getElementById('endTurnBtn').disabled = !state.self.is_current || state.game.phase !== 'playing';

  // --- menù admin: visibile solo all'host durante la partita ---
  const isAdmin = state.self.is_host && state.game.phase === 'playing';
  document.getElementById('adminBtn').classList.toggle('hidden', !isAdmin);
  if (isAdmin) renderAdminPanel();
  else document.getElementById('adminPanel').classList.add('hidden');

  // --- game over ---
  if (state.game.phase === 'finished') {
    const winner = state.players.find(p => p.id === state.game.winner_id);
    document.getElementById('winnerText').textContent =
      winner ? `🏆 ${winner.name} vince la partita!` : '🤝 Patta!';
    document.getElementById('overlay').classList.remove('hidden');
  } else {
    document.getElementById('overlay').classList.add('hidden');
  }

  // --- pannello addestramento aperto: aggiorna oro/disponibilita' a ogni stato ---
  if (buyPoint) renderBuyPanel();
}

// ================= MENÙ ADMIN (HOST) =================
function renderAdminPanel() {
  const ul = document.getElementById('adminList');
  ul.innerHTML = '';
  for (const p of state.players) {
    if (!p.alive || p.id === myId) continue;
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = p.name;
    li.appendChild(label);
    const kick = document.createElement('button');
    kick.className = 'kickBtn';
    kick.textContent = 'Espelli ✕';
    kick.onclick = () => {
      if (confirm(`Espellere ${p.name} dalla partita?`)) socket.emit('kick_player', { target: p.id });
    };
    li.appendChild(kick);
    ul.appendChild(li);
  }
}

document.getElementById('adminBtn').addEventListener('click', () => {
  document.getElementById('adminPanel').classList.toggle('hidden');
});

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

// ================= DISEGNO UNITA' (corpo color fazione + icona di tipo) =================
function drawUnit(u, px, playerById) {
  const p = playerById[u.owner_id];
  if (!p) return;
  const cx = u.x * px + px / 2, cy = u.y * px + px / 2;
  const r = px * 0.30;

  ctx.globalAlpha = (u.owner_id === myId && u.has_moved) ? 0.45 : 1; // opaca se ha gia' agito

  // corpo: cerchio colorato della FAZIONE del proprietario
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.lineWidth = u.id === selectedUnitId ? 3 : 2;
  ctx.strokeStyle = u.id === selectedUnitId ? '#ffe14d' : 'rgba(0,0,0,0.55)'; // anello giallo se selezionata
  ctx.stroke();

  // icona geometrica del tipo unita' (definita dal server via unitTypes)
  const stats = state.unitTypes ? state.unitTypes[u.type] : null;
  drawClassIcon(stats ? stats.icon : 'sword', cx, cy, r);

  // barra HP sopra l'unita'
  const bw = px * 0.52;
  const maxHp = (state.unitTypes && state.unitTypes[u.type]) ? state.unitTypes[u.type].hp : 10;
  const frac = Math.max(0, Math.min(1, u.hp / maxHp));
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; // sfondo barra HP
  ctx.fillRect(cx - bw / 2, cy - r - 4, bw, 4);
  ctx.fillStyle = frac > 0.5 ? '#6ee76e' : frac > 0.25 ? '#ffd166' : '#ff5c5c'; // verde/giallo/rosso
  ctx.fillRect(cx - bw / 2 + 0.5, cy - r - 3.5, (bw - 1) * frac, 3);

  ctx.globalAlpha = 1;
}

// Icone per tipo di unita' (chiave `icon` inviata dal server)
function drawClassIcon(icon, cx, cy, r) {
  const s = r * 0.62; // semidimensione dell'icona
  if (icon === 'sword') {
    // spada: punta + lama + guardia dorata + impugnatura
    ctx.fillStyle = '#1c232b';
    tri(cx, cy - s * 1.15, cx - s * 0.32, cy - s * 0.45, cx + s * 0.32, cy - s * 0.45);
    ctx.fillRect(cx - s * 0.16, cy - s * 0.5, s * 0.32, s * 1.0);
    ctx.fillStyle = '#ffd76a';
    ctx.fillRect(cx - s * 0.55, cy + s * 0.42, s * 1.1, s * 0.22);
    ctx.fillStyle = '#3d2c1e';
    ctx.fillRect(cx - s * 0.12, cy + s * 0.64, s * 0.24, s * 0.5);
  } else if (icon === 'bow') {
    // arco: curva + corda + freccia con punta
    const ax = cx - s * 0.25, ar = s * 0.95, th = Math.PI / 2.6;
    ctx.strokeStyle = '#1c232b';
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.beginPath();
    ctx.arc(ax, cy, ar, -th, th); // arco che apre a destra
    ctx.stroke();
    const ex = ax + ar * Math.cos(th);
    ctx.strokeStyle = 'rgba(28,35,43,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ex, cy - ar * Math.sin(th)); ctx.lineTo(ex, cy + ar * Math.sin(th)); ctx.stroke(); // corda
    ctx.strokeStyle = '#1c232b';
    ctx.fillStyle = '#1c232b';
    ctx.lineWidth = Math.max(1.5, r * 0.1);
    ctx.beginPath(); ctx.moveTo(cx - s * 0.8, cy); ctx.lineTo(cx + s * 0.75, cy); ctx.stroke(); // freccia
    tri(cx + s * 1.05, cy, cx + s * 0.62, cy - s * 0.3, cx + s * 0.62, cy + s * 0.3); // punta
  } else if (icon === 'horseshoe') {
    // ferro di cavallo (simbolo equestre/velocita')
    ctx.strokeStyle = '#1c232b';
    ctx.lineWidth = Math.max(2, r * 0.2);
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.15, s * 0.7, Math.PI * 0.08, Math.PI * 0.92); // "U" con apertura in alto
    ctx.stroke();
  } else if (icon === 'shield') {
    // scudo: spalla dritta + punta arrotondata + linea centrale
    ctx.fillStyle = '#1c232b';
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.75, cy - s * 0.6);
    ctx.lineTo(cx + s * 0.75, cy - s * 0.6);
    ctx.lineTo(cx + s * 0.75, cy + s * 0.1);
    ctx.quadraticCurveTo(cx + s * 0.75, cy + s * 0.75, cx, cy + s * 0.95);
    ctx.quadraticCurveTo(cx - s * 0.75, cy + s * 0.75, cx - s * 0.75, cy + s * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.45); ctx.lineTo(cx, cy + s * 0.7); ctx.stroke();
  } else if (icon === 'axe') {
    // ascia: manico + testa curva
    ctx.strokeStyle = '#1c232b';
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.beginPath(); ctx.moveTo(cx - s * 0.5, cy + s * 0.9); ctx.lineTo(cx + s * 0.45, cy - s * 0.75); ctx.stroke(); // manico
    ctx.fillStyle = '#1c232b';
    ctx.beginPath();
    ctx.arc(cx + s * 0.35, cy - s * 0.6, s * 0.55, Math.PI * 0.9, Math.PI * 1.9); // lama curva
    ctx.closePath();
    ctx.fill();
  } else if (icon === 'spear') {
    // lancia: asta lunga + punta a foglia
    ctx.strokeStyle = '#1c232b';
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.beginPath(); ctx.moveTo(cx - s * 0.75, cy + s * 0.85); ctx.lineTo(cx + s * 0.6, cy - s * 0.6); ctx.stroke(); // asta
    ctx.fillStyle = '#1c232b';
    tri(cx + s * 0.95, cy - s * 1.0, cx + s * 0.35, cy - s * 0.45, cx + s * 0.85, cy - s * 0.2); // punta
  } else if (icon === 'eye') {
    // occhio (scout/visione): contorno + pupilla
    ctx.strokeStyle = '#1c232b';
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.9, cy);
    ctx.quadraticCurveTo(cx, cy - s * 0.85, cx + s * 0.9, cy);
    ctx.quadraticCurveTo(cx, cy + s * 0.85, cx - s * 0.9, cy);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#1c232b';
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2); ctx.fill(); // pupilla
  } else if (icon === 'wave') {
    // onda (nuotatore): due archi sovrapposti
    ctx.strokeStyle = '#1c232b';
    ctx.lineWidth = Math.max(2, r * 0.16);
    for (let i = 0; i < 2; i++) {
      const wy = cy - s * 0.25 + i * s * 0.55;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.8, wy);
      ctx.quadraticCurveTo(cx - s * 0.4, wy - s * 0.45, cx, wy);
      ctx.quadraticCurveTo(cx + s * 0.4, wy + s * 0.45, cx + s * 0.8, wy);
      ctx.stroke();
    }
  } else {
    // fallback: punto centrale
    ctx.fillStyle = '#1c232b';
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.35, 0, Math.PI * 2); ctx.fill();
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
function villageAt(x, y) {
  const t = Object.values(tileXY).find(t => t.x === x && t.y === y);
  if (!t) return null;
  return state.villages.find(v => v.tile_id === t.id) || null;
}

function handleTileClick(x, y) {
  const u = unitAt(x, y);

  // 1) seleziona un'unita' propria -> chiedi al server i movimenti validi (anti-cheat)
  if (u && u.owner_id === myId && state.self.can_act) {
    if (u.has_moved) {
      // ha gia' agito questo round: mostra l'info ma niente selezione fantasma
      const s = state.unitTypes[u.type];
      document.getElementById('unitInfo').innerHTML =
        `<b>${s ? s.name : u.type}</b> (tua)<br>Questa unità ha già agito in questo round.`;
      hideBuyPanel(); clearSelection(); return;
    }
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

  // 3) click su citta' o villaggio proprio -> pannello addestramento
  const c = cityAt(x, y);
  if (c && c.owner_id === myId) { showBuyPanel(c.id, c.name); return; }
  const v = villageAt(x, y);
  if (v && v.owner_id === myId) { showBuyPanel(v.id, v.name + ' (villaggio)'); return; }

  hideBuyPanel();
  clearSelection();
}

function clearSelection() { selectedUnitId = null; selectedUnit = null; selection = null; renderUnitInfo(); }

// ================= PANNELLO LATERALE =================
function renderUnitInfo() {
  const el = document.getElementById('unitInfo');
  if (!selectedUnit || !selection) { el.textContent = "Seleziona un'unità o una città."; return; }
  const s = selection.stats;
  const traits = (s.traits || []).includes('swim') ? ' · 🌊 attraversa l\'acqua' : '';
  el.innerHTML =
    `<b>${s.name}</b> (tua)<br>` +
    `⚔️ ATK ${s.atk} · 🛡️ DEF ${s.def}<br>` +
    `❤️ HP ${selectedUnit.hp}/${s.hp} · 👟 MOV ${s.mov} · 🎯 RNG ${s.rng} · 👁️ VISIONE ${s.vision}${traits}`;
}

// Pannello addestramento: lo stato (oro/disponibilita') si aggiorna a ogni state_update
function showBuyPanel(pointId, pointName) {
  buyPoint = { id: pointId, name: pointName };
  renderBuyPanel();
}

function renderBuyPanel() {
  const panel = document.getElementById('buyPanel');
  if (!buyPoint || !state) return;
  panel.innerHTML = `<b>Addestra unità — ${buyPoint.name}</b>`;
  for (const [key, s] of Object.entries(state.catalog)) {
    const btn = document.createElement('button');
    btn.className = 'buyBtn';
    btn.textContent = `${s.name} — ${s.cost} ⭐`;
    btn.disabled = state.self.gold < s.cost || !state.self.can_act;
    btn.onclick = () => socket.emit('buy_unit', { pointId: buyPoint.id, type: key });
    panel.appendChild(btn);
  }
  panel.classList.remove('hidden');
}

function hideBuyPanel() { buyPoint = null; document.getElementById('buyPanel').classList.add('hidden'); }

// ================= TURNI SEQUENZIALI / UNDO (stato dal server) =================
document.getElementById('endTurnBtn').addEventListener('click', () => {
  if (!state || state.game.phase !== 'playing') return;
  // Conferma ESPLICITA: da questo momento le mosse del turno non sono piu' annullabili
  const ok = confirm('Confermi la fine del turno? Le mosse fatte non saranno più annullabili.');
  if (ok) socket.emit('end_turn');
});

document.getElementById('undoBtn').addEventListener('click', () => {
  if (!state || state.game.phase !== 'playing') return;
  if (!state.self.is_current || state.self.undo_count === 0) return;
  clearSelection(); // la selezione non e' piu' valida dopo il ripristino
  socket.emit('undo_action');
});

document.getElementById('newGameBtn').addEventListener('click', () => socket.emit('reset_game'));

function addLog(msg) {
  const li = document.createElement('li');
  li.textContent = msg;
  const logEl = document.getElementById('log');
  logEl.prepend(li);
  while (logEl.children.length > 12) logEl.lastChild.remove();
}
