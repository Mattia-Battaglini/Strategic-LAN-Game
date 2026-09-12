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
let prevState = null;      // snapshot precedente (per gli effetti sonori a diff)

// ---------- COORDINATE ALFANUMERICHE (stile Excel: A..Z poi AA, AB, AC...) ----------
function colLabel(i) { // 0 -> A, 25 -> Z, 26 -> AA (scalabile a mappe grandi)
  let s = ''; i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function tileCoord(x, y) { return `${colLabel(x)}${y + 1}`; } // A1 = angolo in alto a sinistra
const LABEL_W = 28;       // gutter sinistro: numeri di riga
const LABEL_H = 20;       // striscia superiore: lettere di colonna
// GEOMETRIA VISTA — UNICA fonte di verita' per rendering E click:
// size/px (dimensione casella) e W/H (canvas completo con gutter).
// render() la ricalcola a ogni snapshot; il handler di click la legge.
const VIEW = { size: 0, px: 40, W: 640, H: 640 };

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
  // .lobby-error e' flex con gap: niente spazi testuali liberi (creerebbero item anonimi extra)
  el.innerHTML = ICONS.svg('warning', 14) + esc(msg);
  clearTimeout(lobbyErrorTimer);
  lobbyErrorTimer = setTimeout(() => { el.innerHTML = ''; }, 8000);
}

// ---------- UTILITY CONDIVISE (icone, colori, escape) ----------
// Escape HTML per i nomi utente prima dell'iniezione in innerHTML (anti-XSS)
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Luminanza relativa di un colore hex (0..1): decide il colore dell'icona
// di classe sopra il corpo unità (scuro su fondo chiaro, bianco su scuro)
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// Schiarisce (f>0) o scurisce (f<0) un colore hex: per i gradienti di volume
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Rettangolo arrotondato (fallback portabile di ctx.roundRect)
function rr(c, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.arcTo(x + w, y, x + w, y + h, rad);
  c.arcTo(x + w, y + h, x, y + h, rad);
  c.arcTo(x, y + h, x, y, rad);
  c.arcTo(x, y, x + w, y, rad);
  c.closePath();
}

// Palette biomi (base; il rendering usa gradienti derivati da questi toni)
const BIOME_COLORS = { water: '#2e86de', plains: '#a3c94a', forest: '#4f8f3b', mountain: '#8fa1b3' };

// Meta fazioni per la UI della lobby (il server resta la fonte di verita')
const FACTION_META = {
  valoria:  { name: 'Valoria',  color: '#e74c3c', desc: "Impero bilanciato: un ruolo per ogni situazione." },
  nordmark: { name: 'Nordmark', color: '#3b6fd4', desc: "Clan del Nord: pesanti e difensivi, cavalleria fulminea." },
  saharim:  { name: 'Saharim',  color: '#f0a13a', desc: "Nomadi del deserto: rapidi e con grande visione." },
  aqualis:  { name: 'Aqualis',  color: '#18bfa0', desc: "Popolo delle maree: i suoi Nuotatori attraversano l'acqua." },
};

// Specchi dei valori di economia del server (solo per le etichette dell'inspector)
const CITY_INCOME_CLIENT = 5;      // oro/round per citta'
const VILLAGE_INCOME_CLIENT = 8;   // oro/round per villaggio

// ================= EFFETTI SONORI (WebAudio sintetizzato, nessun file esterno) =================
const AudioFX = (() => {
  let ctx = null;
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // tono con inviluppo: freq -> slideTo (opz.), durata, tipo d'onda, volume
  function tone(freq, dur, type = 'sine', vol = 0.12, slideTo = null, delay = 0) {
    const c = ensure();
    if (!c) return;
    try {
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* audio non disponibile: ignora */ }
  }
  return {
    ensure, // da chiamare al primo gesto utente per sbloccare l'AudioContext
    playTurnStart()  { tone(392, .12, 'triangle', .14); tone(587, .16, 'triangle', .14, null, .10); },   // salita maggiore
    playTurnEnd()    { tone(587, .12, 'triangle', .12); tone(392, .16, 'triangle', .12, null, .10); },   // discesa
    playMove()       { tone(240, .07, 'sine', .10, 320); },                                               // blip corto
    playAttack()     { tone(880, .09, 'square', .09, 220); tone(160, .12, 'sawtooth', .10, 60, .03); },  // colpo secco
    playDamage()     { tone(140, .18, 'sawtooth', .14, 55); },                                            // tonfo grave
    playCapture()    { tone(523, .10, 'triangle', .13); tone(659, .10, 'triangle', .13, null, .08); tone(784, .16, 'triangle', .13, null, .16); }, // arpeggio
    playElimination(){ tone(330, .14, 'square', .12, 110); tone(110, .30, 'sawtooth', .12, 50, .12); },  // discesa minore
  };
})();
// Sblocco dell'AudioContext al primo gesto utente (richiesto dai browser)
window.addEventListener('pointerdown', () => AudioFX.ensure(), { once: true });

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
    if (pl.faction) {
      // Emblema SVG della fazione (audit §3) al posto del cerchio piatto
      badge.innerHTML = ICONS.svg('emb-' + pl.faction, 14);
      badge.style.color = FACTION_META[pl.faction].color;
    } else {
      badge.style.background = '#555c68';
    }
    badge.title = pl.faction ? FACTION_META[pl.faction].name : 'nessuna fazione';
    li.appendChild(badge);
    const label = document.createElement('span');
    label.innerHTML = esc(pl.name) + (pl.isHost ? ' ' + ICONS.svg('crown', 14) : '');
    li.appendChild(label);
    // Admin: l'host puo' espellere gli altri dalla stanza
    if (canStart && pl.socketId !== socket.id) {
      const kick = document.createElement('button');
      kick.className = 'kickBtn';
      kick.innerHTML = ICONS.svg('close', 12);
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
  addLog(msg, 'shield-admin');
  alert(msg);
});

// ================= AVVIO / RESET PARTITA =================
socket.on('game_started', ({ playerId }) => {
  myId = playerId;
  prevState = null; // niente diff sonori tra una partita e l'altra
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
});

socket.on('back_to_lobby', () => {
  state = null; myId = null; selectedUnitId = null; selectedUnit = null; selection = null;
  lobbyPlayers = []; iAmInLobby = false; buyPoint = null; prevState = null;
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
  if (inGame) addLog(msg, 'warning'); else showLobbyError(msg);
});
socket.on('game_log', (msg) => addLog(msg));
socket.on('selection_info', (info) => { selection = info; renderUnitInfo(); render(); });

// Effetti sonori a diff: confrontando lo stato precedente con quello nuovo
// riconosco gli eventi (inizio turno, mosse, attacchi, danni, conquiste...).
function detectStateChanges(prev) {
  if (!prev || !state || prev === state) return;
  if (state.game.phase !== 'playing') return;
  // inizio del mio turno
  if (!prev.self.is_current && state.self.is_current) AudioFX.playTurnStart();
  // mie unita' spostate
  for (const u of state.units) {
    if (u.owner_id !== myId) continue;
    const p = prev.units.find(p => p.id === u.id);
    if (p && (p.x !== u.x || p.y !== u.y)) AudioFX.playMove();
  }
  // unita' nemiche danneggiate o eliminate -> suono attacco (+ evento eliminazione)
  for (const pu of prev.units) {
    if (pu.owner_id === myId) continue;
    const cu = state.units.find(c => c.id === pu.id);
    if (!cu) { AudioFX.playAttack(); AudioFX.playElimination(); }
    else if (cu.hp < pu.hp) AudioFX.playAttack();
  }
  // mie unita' che subiscono danno -> suono difesa/danno
  for (const u of state.units) {
    if (u.owner_id !== myId) continue;
    const p = prev.units.find(p => p.id === u.id);
    if (p && u.hp < p.hp) AudioFX.playDamage();
  }
  // strutture passate alla mia fazione -> evento conquista
  for (const c of state.cities) {
    const pc = prev.cities.find(pc => pc.id === c.id);
    if (pc && pc.owner_id !== myId && c.owner_id === myId) AudioFX.playCapture();
  }
  for (const v of state.villages) {
    const pv = prev.villages.find(pv => pv.id === v.id);
    if (pv && pv.owner_id !== myId && v.owner_id === myId) AudioFX.playCapture();
  }
  // player eliminato -> evento di sistema
  for (const p of state.players) {
    const pp = prev.players.find(pp => pp.id === p.id);
    if (pp && pp.alive && !p.alive) AudioFX.playElimination();
  }
}

function render() {
  if (!state) return;
  detectStateChanges(prevState); // suoni prima di sovrascrivere prevState
  // Se non e' piu' il mio turno (o la partita e' finita), azzera eventuali
  // selezioni residue: altrimenti resterebbero evidenziate caselle "fantasma".
  if (!state.self.is_current || state.game.phase !== 'playing') {
    selectedUnitId = null; selectedUnit = null; selection = null;
  }
  // ridimensiona il canvas: mappa + gutter coordinate (striscia in alto, colonna a sinistra).
  // VIEW e' l'unica fonte di verita': qui calcolo size/px/W/H una volta sola e
  // TUTTO il resto (disegno, overlay, click) deriva da questi valori.
  const size = state.game.map_size;
  VIEW.size = size;
  VIEW.px = Math.floor(640 / size);
  VIEW.W = size * VIEW.px + LABEL_W;
  VIEW.H = size * VIEW.px + LABEL_H;
  canvas.width = VIEW.W;   // l'assegnazione a width/height resetta anche il contesto
  canvas.height = VIEW.H;
  const px = VIEW.px;
  tileXY = {};
  for (const t of state.tiles) tileXY[t.id] = t;
  const playerById = {};
  state.players.forEach(p => playerById[p.id] = p);

  // --- sfondo + gutter coordinate (striscia in alto + colonna a sinistra) ---
  ctx.fillStyle = '#0a0d13';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const gutL = ctx.createLinearGradient(0, 0, LABEL_W, 0); // gutter sinistro: acciaio scuro
  gutL.addColorStop(0, '#1c2433'); gutL.addColorStop(1, '#121826');
  ctx.fillStyle = gutL;
  ctx.fillRect(0, 0, LABEL_W, canvas.height);
  const gutT = ctx.createLinearGradient(0, 0, 0, LABEL_H); // gutter superiore
  gutT.addColorStop(0, '#1c2433'); gutT.addColorStop(1, '#121826');
  ctx.fillStyle = gutT;
  ctx.fillRect(0, 0, canvas.width, LABEL_H);

  // --- mappa (spostata del gutter coordinate) ---
  ctx.save();
  ctx.translate(LABEL_W, LABEL_H);

  // --- caselle (solo quelle esplorate: nebbia di guerra applicata dal server) ---
  for (const t of state.tiles) drawTile(t, px);

  // --- fog of war migliorato: tessere scure testurizzate + confine morbido ---
  renderFog(size, px);

  // --- overlay di selezione (calcolati dal server): glow tattico ---
  if (selection) {
    for (const p of selection.reachable) drawReachable(p.x, p.y, px);
    for (const p of selection.targets) drawTarget(p.x, p.y, px);
  }

  // --- citta' (mura merlate + porta + tetto fazione + bandiera) ---
  for (const c of state.cities) {
    const t = tileXY[c.tile_id];
    if (!t) continue;
    drawCity(t.x * px, t.y * px, px, playerById[c.owner_id] ? playerById[c.owner_id].color : '#ffffff');
  }

  // --- villaggi (capanna in legno; tetto colorato se conquistato) ---
  for (const v of state.villages) {
    const t = tileXY[v.tile_id];
    if (!t) continue;
    drawVillage(t.x * px, t.y * px, px, v.owner_id && playerById[v.owner_id] ? playerById[v.owner_id].color : null);
  }

  // --- unita' (icona di classe + fazione + barra HP) ---
  for (const u of state.units) drawUnit(u, px, playerById);

  ctx.restore(); // fine offset gutter coordinate

  // --- etichette coordinate: lettere colonne in alto, numeri righe a sinistra ---
  const fs = Math.max(8, Math.min(13, Math.floor(px * 0.32)));
  ctx.font = `600 ${fs}px 'Segoe UI', sans-serif`;
  ctx.fillStyle = 'rgba(190,210,245,0.75)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let x = 0; x < size; x++) ctx.fillText(colLabel(x), LABEL_W + x * px + px / 2, LABEL_H / 2);
  for (let y = 0; y < size; y++) ctx.fillText(String(y + 1), LABEL_W / 2, LABEL_H + y * px + px / 2);

  // --- HUD (icone SVG, zero emoji) ---
  document.getElementById('roundInfo').textContent = `Round ${state.game.round}`;
  // .hud-chip e' flex con gap: il testo va subito dopo l'SVG (niente spazi liberi)
  document.getElementById('goldInfo').innerHTML = ICONS.svg('gold-coin', 14) + `${state.self.gold} oro`;
  const turnEl = document.getElementById('turnInfo');
  if (state.self.is_current) {
    turnEl.innerHTML = ICONS.svg('turn-active', 15) + 'Il tuo turno';
    turnEl.classList.add('you');
  } else {
    const cur = state.players.find(p => p.id === state.game.current_player_id);
    turnEl.innerHTML = ICONS.svg('hourglass', 14) + `In attesa di ${cur ? esc(cur.name) : '…'}…`;
    turnEl.classList.remove('you');
  }

  // --- bottone Annulla Mossa (disponibile solo nel proprio turno, con mosse fatte) ---
  const undoBtn = document.getElementById('undoBtn');
  undoBtn.disabled = !state.self.is_current || state.self.undo_count === 0;

  // --- bottone Fine Turno: attivo solo per chi e' il player corrente ---
  document.getElementById('endTurnBtn').disabled = !state.self.is_current || state.game.phase !== 'playing';

  // --- TP (punti tecnologia) + pannello tecnologie sempre aggiornato ---
  const tpEl = document.getElementById('tpInfo');
  if (tpEl) tpEl.innerHTML = ICONS.svg('flask-tp', 15) + `${state.self.tp} TP`;
  document.getElementById('techTpLabel').textContent = `${state.self.tp} TP disponibili`;
  renderTechPanel();

  // --- menù admin: visibile solo all'host durante la partita ---
  const isAdmin = state.self.is_host && state.game.phase === 'playing';
  document.getElementById('adminBtn').classList.toggle('hidden', !isAdmin);
  if (isAdmin) renderAdminPanel();
  else document.getElementById('adminPanel').classList.add('hidden');

  // --- game over ---
  if (state.game.phase === 'finished') {
    const winner = state.players.find(p => p.id === state.game.winner_id);
    // #winnerText e' flex con gap: niente spazi liberi dopo l'SVG
    document.getElementById('winnerText').innerHTML = winner
      ? ICONS.svg('trophy', 22) + `${esc(winner.name)} vince la partita!`
      : ICONS.svg('handshake', 22) + 'Patta!';
    document.getElementById('overlay').classList.remove('hidden');
  } else {
    document.getElementById('overlay').classList.add('hidden');
  }

  // --- pannello addestramento aperto: aggiorna oro/disponibilita' a ogni stato ---
  if (buyPoint) renderBuyPanel();

  prevState = state; // per il diff dei suoni al prossimo stato
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
    // il bottone e' flex con gap: niente spazio libero tra testo e SVG
    kick.innerHTML = 'Espelli' + ICONS.svg('close', 13);
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

// ================= ALBERO TECNOLOGIE (perk globali della fazione) =================
function renderTechPanel() {
  const ul = document.getElementById('techList');
  if (!state || !ul) return;
  ul.innerHTML = '';
  const owned = state.self.techs || [];
  for (const tech of (state.techCatalog || [])) {
    const li = document.createElement('li');
    if (owned.includes(tech.id)) {
      // .tech-owned e' flex con gap: niente spazio libero tra SVG e nome
      li.innerHTML = `<span class="tech-owned">${ICONS.svg('check-circle', 14)}${esc(tech.name)}</span><span class="tech-desc">${esc(tech.desc)}</span>`;
    } else {
      const label = document.createElement('span');
      label.textContent = tech.name;
      li.appendChild(label);
      const desc = document.createElement('span');
      desc.className = 'tech-desc';
      desc.textContent = `${tech.desc} (${tech.cost} TP)`;
      li.appendChild(desc);
      const btn = document.createElement('button');
      btn.className = 'buyBtn';
      btn.style.width = 'auto';
      btn.textContent = 'Acquista';
      btn.disabled = !state.self.can_act || state.self.tp < tech.cost;
      btn.onclick = () => socket.emit('buy_tech', { techId: tech.id });
      li.appendChild(btn);
    }
    ul.appendChild(li);
  }
}

document.getElementById('techBtn').addEventListener('click', () => {
  document.getElementById('techPanel').classList.toggle('hidden');
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

// ---------- TILES: base a gradiente + dettagli volumetrici per biome ----------
function drawTile(t, px) {
  const X = t.x * px, Y = t.y * px;
  const h = tileHash(t.x, t.y);

  // base biome con gradiente verticale (luce dall'alto) -> volume
  const g = ctx.createLinearGradient(0, Y, 0, Y + px);
  if (t.biome === 'water') { g.addColorStop(0, '#3f97ea'); g.addColorStop(.55, '#2a7cd0'); g.addColorStop(1, '#1e5cab'); }
  else if (t.biome === 'plains') { g.addColorStop(0, '#aed45c'); g.addColorStop(1, '#84ab3a'); }
  else if (t.biome === 'forest') { g.addColorStop(0, '#5d9a4e'); g.addColorStop(1, '#3f7233'); }
  else { g.addColorStop(0, '#9fb0c2'); g.addColorStop(1, '#7c8fa3'); } // mountain
  ctx.fillStyle = g;
  ctx.fillRect(X, Y, px, px);

  if (t.biome === 'water') {
    // onde: due archi chiari sfalsati + fase lenta "viva" senza loop rAF
    const wt = Math.floor(Date.now() / 1500) % 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.lineWidth = Math.max(1, px * 0.04);
    for (let i = 0; i < 2; i++) {
      const wy = Y + px * (0.34 + 0.3 * i) + (h - 0.5) * px * 0.16 + wt * px * 0.02;
      ctx.beginPath();
      ctx.moveTo(X + px * 0.18, wy);
      ctx.quadraticCurveTo(X + px * 0.35, wy - px * 0.09, X + px * 0.52, wy);
      ctx.quadraticCurveTo(X + px * 0.69, wy + px * 0.09, X + px * 0.84, wy);
      ctx.stroke();
    }
    if (h > 0.72) { // scintillio deterministico su ~1/4 delle caselle d'acqua
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(X + px * (0.3 + h * 0.4), Y + px * (0.25 + h * 0.3), Math.max(1, px * 0.06), Math.max(1, px * 0.06));
    }
  } else if (t.biome === 'plains') {
    // macchia di luce centrale radiale + ciuffi d'erba scuri
    const glow = ctx.createRadialGradient(X + px / 2, Y + px / 2, px * 0.1, X + px / 2, Y + px / 2, px * 0.75);
    glow.addColorStop(0, 'rgba(255,255,220,0.10)');
    glow.addColorStop(1, 'rgba(255,255,220,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(X, Y, px, px);
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
    // due alberi di dimensioni diverse (chioma a gradiente radiale)
    drawTree(X + px * (0.32 + h * 0.1), Y + px * 0.62, px * 0.58);
    drawTree(X + px * (0.62 - h * 0.08), Y + px * 0.48, px * 0.46);
  } else { // mountain
    drawMountain(X + px / 2, Y + px * 0.56, px * 0.72);
  }

  // ombreggiatura bevel morbida: luce in alto a sinistra, ombra in basso a destra
  const b = Math.max(1, px * 0.06);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(X, Y, px, b);                       // bordo superiore chiaro
  ctx.fillRect(X, Y, b, px);                       // bordo sinistro chiaro
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(X, Y + px - b, px, b);              // bordo inferiore scuro
  ctx.fillRect(X + px - b, Y, b, px);              // bordo destro scuro

  // griglia caselle sottile
  ctx.strokeStyle = 'rgba(0,0,0,0.32)';
  ctx.lineWidth = 1;
  ctx.strokeRect(X + 0.5, Y + 0.5, px - 1, px - 1);
}

// Albero: ombra a terra + tronco a gradiente + chioma radiale in due strati
function drawTree(x, y, s) { // x,y = base del tronco, s = altezza totale
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; // ombra proiettata
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.04, s * 0.30, s * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();

  const tg = ctx.createLinearGradient(x - s * 0.05, 0, x + s * 0.05, 0);
  tg.addColorStop(0, '#7a5636'); tg.addColorStop(1, '#4e3620');
  ctx.fillStyle = tg; // tronco in volume
  ctx.fillRect(x - s * 0.05, y - s * 0.18, s * 0.1, s * 0.2);

  const cg = ctx.createRadialGradient(x - s * 0.10, y - s * 0.45, s * 0.05, x, y - s * 0.35, s * 0.45);
  cg.addColorStop(0, '#5cb85e'); cg.addColorStop(.6, '#2f8f3a'); cg.addColorStop(1, '#1f6b2a');
  ctx.fillStyle = cg; // chioma: due strati di verde con luce radiale
  tri(x, y - s * 0.62, x - s * 0.30, y - s * 0.14, x + s * 0.30, y - s * 0.14);
  ctx.fillStyle = cg;
  tri(x, y - s * 0.78, x - s * 0.24, y - s * 0.36, x + s * 0.24, y - s * 0.36);
}

// Montagna: corpo scistoso a gradiente + drop shadow + faccia in penombra + cima innevata
function drawMountain(x, y, s) { // x,y = centro della base
  ctx.save();
  ctx.shadowColor = 'rgba(8,12,20,0.45)';
  ctx.shadowBlur = s * 0.22;
  ctx.shadowOffsetY = s * 0.10;

  const rg = ctx.createLinearGradient(x - s * 0.45, y - s * 0.45, x + s * 0.45, y + s * 0.32);
  rg.addColorStop(0, '#c3cfdd'); rg.addColorStop(.55, '#8fa1b3'); rg.addColorStop(1, '#6d7f92');
  ctx.fillStyle = rg; // corpo scistoso in volume
  tri(x - s * 0.45, y + s * 0.32, x, y - s * 0.45, x + s * 0.45, y + s * 0.32);
  ctx.restore();

  ctx.fillStyle = 'rgba(10,16,28,0.22)'; // ombra lato destro (faccia in penombra)
  tri(x, y - s * 0.45, x + s * 0.45, y + s * 0.32, x + s * 0.27, y + s * 0.32);

  const sg = ctx.createLinearGradient(0, y - s * 0.45, 0, y - s * 0.16);
  sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, '#c9d6e4');
  ctx.fillStyle = sg; // cima innevata con sfumatura
  tri(x - s * 0.14, y - s * 0.16, x, y - s * 0.45, x + s * 0.14, y - s * 0.16);
}

// ---------- FOG OF WAR migliorato (audit §2) ----------
// Le caselle non esplorate arrivano assenti dal server: qui le ricostruiamo come
// tessere scure testurizzate e ammorbidiamo il confine con la mappa esplorata.
function renderFog(size, px) {
  const grid = {};
  for (const t of state.tiles) grid[t.x + ',' + t.y] = true;

  // 1) tessere di nebbia: base scura + diagonale testurizzata deterministica.
  //    La diagonale e' CLIPPATA dentro la cella: cosi' le caselle del bordo
  //    (colonna/riga 0) non disegnano oltre il confine della griglia, sui gutter.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[x + ',' + y]) continue;
      const X = x * px, Y = y * px;
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(X, Y, px, px);
      const h = tileHash(x, y);
      ctx.save();
      ctx.beginPath();
      ctx.rect(X, Y, px, px); // clip: la texture resta dentro la casella
      ctx.clip();
      ctx.strokeStyle = 'rgba(148,170,210,0.05)';
      ctx.lineWidth = 1;
      const off = (h * px) % px;
      ctx.beginPath();
      ctx.moveTo(X + off, Y);
      ctx.lineTo(X + off - px, Y + px);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 2) bordo morbido: ombra sfumata che "crepa" dentro le caselle esplorate
  const d = px * 0.45;
  for (const t of state.tiles) {
    const X = t.x * px, Y = t.y * px;
    if (!grid[t.x + ',' + (t.y - 1)]) { // nebbia sopra -> striscia in alto
      const g = ctx.createLinearGradient(0, Y, 0, Y + d);
      g.addColorStop(0, 'rgba(8,10,16,0.5)'); g.addColorStop(1, 'rgba(8,10,16,0)');
      ctx.fillStyle = g; ctx.fillRect(X, Y, px, d);
    }
    if (!grid[t.x + ',' + (t.y + 1)]) { // nebbia sotto -> striscia in basso
      const g = ctx.createLinearGradient(0, Y + px - d, 0, Y + px);
      g.addColorStop(0, 'rgba(8,10,16,0)'); g.addColorStop(1, 'rgba(8,10,16,0.5)');
      ctx.fillStyle = g; ctx.fillRect(X, Y + px - d, px, d);
    }
    if (!grid[(t.x - 1) + ',' + t.y]) { // nebbia a sinistra -> striscia a sinistra
      const g = ctx.createLinearGradient(X, 0, X + d, 0);
      g.addColorStop(0, 'rgba(8,10,16,0.5)'); g.addColorStop(1, 'rgba(8,10,16,0)');
      ctx.fillStyle = g; ctx.fillRect(X, Y, d, px);
    }
    if (!grid[(t.x + 1) + ',' + t.y]) { // nebbia a destra -> striscia a destra
      const g = ctx.createLinearGradient(X + px - d, 0, X + px, 0);
      g.addColorStop(0, 'rgba(8,10,16,0)'); g.addColorStop(1, 'rgba(8,10,16,0.5)');
      ctx.fillStyle = g; ctx.fillRect(X + px - d, Y, d, px);
    }
  }
}

// ---------- OVERLAY DI SELEZIONE (audit §2): glow tattico ----------
// Casella raggiungibile: riempimento blu tenue + parentesi angolari luminose
function drawReachable(x, y, px) {
  const X = x * px, Y = y * px;
  ctx.fillStyle = 'rgba(80,160,255,0.20)';
  ctx.fillRect(X + 1, Y + 1, px - 2, px - 2);
  ctx.save();
  ctx.strokeStyle = '#7cc4ff';
  ctx.lineWidth = Math.max(1.5, px * 0.06);
  ctx.shadowColor = 'rgba(90,170,255,0.8)';
  ctx.shadowBlur = 6;
  const L = Math.max(4, px * 0.18), m = 3;
  ctx.beginPath();
  ctx.moveTo(X + m + L, Y + m); ctx.lineTo(X + m, Y + m); ctx.lineTo(X + m, Y + m + L); // angolo alto-sx
  ctx.moveTo(X + px - m - L, Y + m); ctx.lineTo(X + px - m, Y + m); ctx.lineTo(X + px - m, Y + m + L); // alto-dx
  ctx.moveTo(X + m, Y + px - m - L); ctx.lineTo(X + m, Y + px - m); ctx.lineTo(X + m + L, Y + px - m); // basso-sx
  ctx.moveTo(X + px - m, Y + px - m - L); ctx.lineTo(X + px - m, Y + px - m); ctx.lineTo(X + px - m - L, Y + px - m); // basso-dx
  ctx.stroke();
  ctx.restore();
}

// Target di attacco: riempimento rosso + mirino con alone luminoso
function drawTarget(x, y, px) {
  const X = x * px, Y = y * px;
  ctx.fillStyle = 'rgba(255,70,70,0.28)';
  ctx.fillRect(X + 1, Y + 1, px - 2, px - 2);
  ctx.save();
  ctx.strokeStyle = '#ff6b5c';
  ctx.lineWidth = Math.max(1.5, px * 0.06);
  ctx.shadowColor = 'rgba(255,90,80,0.9)';
  ctx.shadowBlur = 7;
  const cx = X + px / 2, cy = Y + px / 2, r = px * 0.30;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ff6b5c';
  ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, px * 0.07), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------- EDIFICI (audit §3): composizioni vettoriali con volume ----------
// Citta': mura in pietra a gradiente + merli + porta ad arco + tetto fazione + bandiera
function drawCity(X, Y, px, color) {
  // ombra proiettata
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(X + px / 2, Y + px * 0.80, px * 0.36, px * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();

  // mura: gradiente pietra chiara -> scura
  const wg = ctx.createLinearGradient(0, Y + px * 0.40, 0, Y + px * 0.80);
  wg.addColorStop(0, '#efe9db'); wg.addColorStop(1, '#b3a892');
  ctx.fillStyle = wg;
  ctx.fillRect(X + px * 0.20, Y + px * 0.44, px * 0.60, px * 0.34);

  // merli (crenellature) lungo la sommita' delle mura
  ctx.fillStyle = '#e5ddcc';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(X + px * (0.20 + 0.12 * i), Y + px * 0.38, px * 0.07, px * 0.08);
  }

  // porta ad arco scura al centro
  const gw = px * 0.14, gx = X + px / 2 - gw / 2;
  ctx.fillStyle = '#4a4238';
  ctx.beginPath();
  ctx.moveTo(gx, Y + px * 0.78);
  ctx.lineTo(gx, Y + px * 0.66);
  ctx.arc(X + px / 2, Y + px * 0.66, gw / 2, Math.PI, 0);
  ctx.lineTo(gx + gw, Y + px * 0.78);
  ctx.closePath();
  ctx.fill();

  // tetto a gradiente nel colore del proprietario (con spigolo in luce)
  const rg = ctx.createLinearGradient(0, Y + px * 0.12, 0, Y + px * 0.42);
  rg.addColorStop(0, shade(color, 0.35)); rg.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = rg;
  tri(X + px * 0.15, Y + px * 0.42, X + px * 0.5, Y + px * 0.12, X + px * 0.85, Y + px * 0.42);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; // spigolo superiore del tetto
  ctx.lineWidth = Math.max(1, px * 0.03);
  ctx.beginPath();
  ctx.moveTo(X + px * 0.17, Y + px * 0.40);
  ctx.lineTo(X + px * 0.5, Y + px * 0.13);
  ctx.stroke();

  // bandiera del proprietario sulla sommita'
  const fx = X + px / 2, fy = Y + px * 0.12;
  ctx.strokeStyle = '#d8d2c4';
  ctx.lineWidth = Math.max(1, px * 0.035);
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - px * 0.10); ctx.stroke();
  ctx.fillStyle = color;
  tri(fx, fy - px * 0.10, fx + px * 0.12, fy - px * 0.065, fx, fy - px * 0.03);
}

// Villaggio: capanna in legno a gradiente + tetto (colore proprietario o neutro)
function drawVillage(X, Y, px, color) {
  // ombra proiettata
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(X + px / 2, Y + px * 0.76, px * 0.30, px * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();

  // pareti in legno: gradiente caldo
  const wg = ctx.createLinearGradient(0, Y + px * 0.48, 0, Y + px * 0.76);
  wg.addColorStop(0, '#d8b07a'); wg.addColorStop(1, '#96703f');
  ctx.fillStyle = wg;
  ctx.fillRect(X + px * 0.28, Y + px * 0.48, px * 0.44, px * 0.28);

  // porta scura
  ctx.fillStyle = '#5d4630';
  ctx.fillRect(X + px * 0.46, Y + px * 0.60, px * 0.08, px * 0.16);

  // tetto: colore del proprietario (o neutro se non conquistato) con gradiente
  const roof = color || '#7a6a55';
  const rg = ctx.createLinearGradient(0, Y + px * 0.22, 0, Y + px * 0.50);
  rg.addColorStop(0, shade(roof, 0.30)); rg.addColorStop(1, shade(roof, -0.30));
  ctx.fillStyle = rg;
  tri(X + px * 0.18, Y + px * 0.50, X + px * 0.5, Y + px * 0.22, X + px * 0.82, Y + px * 0.50);

  // linea di giunzione del tetto
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = Math.max(1, px * 0.03);
  ctx.beginPath();
  ctx.moveTo(X + px * 0.24, Y + px * 0.47);
  ctx.lineTo(X + px * 0.76, Y + px * 0.47);
  ctx.stroke();
}

// ================= DISEGNO UNITA' — corpo in volume + emblema classe SVG =================
function drawUnit(u, px, playerById) {
  const p = playerById[u.owner_id];
  if (!p) return;
  const cx = u.x * px + px / 2, cy = u.y * px + px / 2;
  const r = px * 0.30;

  // ombra a terra: l'unita' "galleggia" sopra la casella
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.75, r * 0.85, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  // esausta (ha gia' agito): desaturata; le unita' "strike" restano attive finche' non attaccano
  const exhausted = u.owner_id === myId && isExhausted(u);
  if (exhausted) ctx.globalAlpha = 0.5;

  // corpo: gradiente radiale nel colore della FAZIONE del proprietario (volume sferico)
  const bg = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
  bg.addColorStop(0, shade(p.color, 0.5));
  bg.addColorStop(0.55, p.color);
  bg.addColorStop(1, shade(p.color, -0.4));
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = r * 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();

  // anello: selezione luminosa dorata oppure bordo scuro netto
  if (u.id === selectedUnitId) {
    ctx.save();
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = Math.max(2, px * 0.07);
    ctx.shadowColor = 'rgba(255,225,77,0.9)';
    ctx.shadowBlur = 9; // alone della selezione
    ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  } else {
    ctx.lineWidth = Math.max(1.5, px * 0.05);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }

  // riflesso superiore (luce dall'alto a sinistra)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, px * 0.04);
  ctx.beginPath();
  ctx.arc(cx, cy, r - Math.max(1, px * 0.06), Math.PI * 1.15, Math.PI * 1.75);
  ctx.stroke();

  // emblema di classe: SVG di assets.js disegnato via Path2D, in contrasto col corpo
  const stats = state.unitTypes ? state.unitTypes[u.type] : null;
  const iconName = 'class-' + (stats ? stats.icon : 'sword');
  const iconColor = luminance(p.color) > 0.62 ? '#1c232b' : '#ffffff';
  if (ICONS.DEFS[iconName]) {
    ICONS.draw(ctx, iconName, cx, cy, r * 1.35, iconColor);
  } else {
    ctx.fillStyle = iconColor; // fallback: punto centrale
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2); ctx.fill();
  }

  ctx.globalAlpha = 1;

  // barra HP stilizzata: frame scuro arrotondato + riempimento a gradiente verde/giallo/rosso.
  // La barra resta SEMPRE dentro la cella dell'unita': per le unita' della riga 0
  // il clamp evita che il frame invada la striscia delle coordinate in alto.
  const bw = px * 0.56, bh = Math.max(3, px * 0.10);
  const bx = cx - bw / 2;
  let by = cy - r - bh - 4;
  if (by < u.y * px + 1) by = u.y * px + 1; // clamp: mai sopra il bordo superiore della cella
  const maxHp = (state.unitTypes && state.unitTypes[u.type]) ? state.unitTypes[u.type].hp : 10;
  const frac = Math.max(0, Math.min(1, u.hp / maxHp));
  rr(ctx, bx - 1, by - 1, bw + 2, bh + 2, (bh + 2) / 2);
  ctx.fillStyle = 'rgba(8,10,14,0.75)'; // sfondo barra HP
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (frac > 0) {
    const [cA, cB] = frac > 0.5 ? ['#3fae4c', '#7ce07f'] : frac > 0.25 ? ['#d9a520', '#ffd166'] : ['#c0392b', '#ff6b5c'];
    const fg = ctx.createLinearGradient(bx, by, bx + bw, by);
    fg.addColorStop(0, cA); fg.addColorStop(1, cB);
    rr(ctx, bx, by, Math.max(bh - 2, bw * frac), bh, bh / 2);
    ctx.fillStyle = fg;
    ctx.fill();
  }
}

// (Le icone di classe non sono piu' disegnate a mano: vivono in assets.js come
//  SVG `class-*` e vengono renderizzate da ICONS.draw dentro drawUnit.)

// ================= CLICK SULLA TILES =================
// Mappatura pixel->casella ESATTA: getBoundingClientRect() include i bordi CSS
// (clientLeft/clientTop li sottraggono), clientWidth e' il contenuto senza bordi.
// La scala backing-store/CSS tiene conto del responsive (max-width) del canvas.
canvas.addEventListener('click', (e) => {
  if (!state || !VIEW.size || state.game.phase !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const cw = canvas.clientWidth || rect.width;   // contenuto CSS (esclude i bordi)
  const ch = canvas.clientHeight || rect.height;
  if (cw <= 0 || ch <= 0) return;
  const scale = canvas.width / cw;               // px backing store per px CSS
  const cellPx = VIEW.px * scale;                // dimensione casella in px CSS
  const x = Math.floor((e.clientX - rect.left - canvas.clientLeft - LABEL_W * scale) / cellPx);
  const y = Math.floor((e.clientY - rect.top - canvas.clientTop - LABEL_H * scale) / cellPx);
  if (x < 0 || y < 0 || x >= VIEW.size || y >= VIEW.size) return; // click su gutter/bordi: ignora
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
  flushInfoPanel(); // reset completo: nessun dato della casella cliccata prima resta visibile
  const u = unitAt(x, y);

  // 1) seleziona un'unita' propria -> chiedi al server i movimenti validi (anti-cheat)
  if (u && u.owner_id === myId && state.self.can_act && !isExhausted(u)) {
    selectedUnitId = u.id;
    selectedUnit = u;
    selection = null;
    socket.emit('select_unit', { unitId: u.id }); // risposta: 'selection_info'
    renderUnitInfo();
    hideBuyPanel();
    return;
  }

  // 2) con un'unita' selezionata: muoviti o attacca (prima dell'ispezione!)
  if (selectedUnitId && selection) {
    const dest = selection.reachable.find(p => p.x === x && p.y === y);
    const target = selection.targets.find(p => p.x === x && p.y === y);
    if (dest)   { socket.emit('move_unit',   { unitId: selectedUnitId, toX: x, toY: y }); clearSelection(); return; }
    if (target) { socket.emit('attack_unit', { unitId: selectedUnitId, targetX: x, targetY: y }); clearSelection(); return; }
  }

  // 3) INSPECTION: qualsiasi unita' sulla casella (propria esausta o nemica) ->
  //    pannello completo con dati unita' + terreno + struttura sottostante
  if (u) { hideBuyPanel(); clearSelection(); showInspector(x, y); return; }

  // 4) click su citta' o villaggio proprio -> pannello addestramento (+ inspector con coordinate)
  const c = cityAt(x, y);
  if (c && c.owner_id === myId) { showBuyPanel(c.id, c.name); showInspector(x, y); return; }
  const v = villageAt(x, y);
  if (v && v.owner_id === myId) { showBuyPanel(v.id, v.name + ' (villaggio)'); showInspector(x, y); return; }

  // 5) casella vuota: mostra comunque terreno/struttura visibili
  hideBuyPanel();
  clearSelection();
  showInspector(x, y);
}

// Un'unita' e' esausta se non puo' piu' agire questo round. Le unita' con trait
// 'strike' possono fare DUE azioni (muovi + attacca): sono esauste solo quando
// hanno gia' fatto entrambe.
function isExhausted(u) {
  const s = state.unitTypes[u.type];
  if ((s && (s.traits || []).includes('strike'))) return u.has_moved && u.has_attacked;
  return u.has_moved;
}

// ================= INSPECTOR (unita' + terreno + struttura, anche nemici) =================
const TERRAIN_INFO = {
  plains:   { name: 'Pianura', fx: 'terreno neutro' },
  forest:   { name: 'Foresta', fx: '+1 DEF al difensore; gli attacchi a distanza fanno metà danno' },
  mountain: { name: 'Montagna', fx: '+2 DEF al difensore; attraversabile solo da unità con trait montagna' },
  water:    { name: 'Acqua', fx: 'inattraversabile, salvo unità con trait nuoto' },
};

// Flush completo del pannello info: chiamato PRIMA di mostrare una nuova casella
// cosi' non resta alcuna informazione della casella selezionata in precedenza.
function flushInfoPanel() {
  const el = document.getElementById('unitInfo');
  if (el) el.innerHTML = '';
}

function showInspector(x, y) {
  const el = document.getElementById('unitInfo');
  el.innerHTML = ''; // reset forzato: si ricostruisce SOLO il contenuto di questa casella
  // .insp-coord e' flex con gap: niente spazio libero tra SVG e testo
  let html = `<div class="insp-coord">${ICONS.svg('pin', 13)}Casella ${tileCoord(x, y)}</div>`;
  const u = unitAt(x, y);
  if (u) {
    const s = state.unitTypes[u.type];
    const owner = state.players.find(p => p.id === u.owner_id);
    const mine = u.owner_id === myId;
    // per le proprie unità mostro anche i bonus delle tecnologie acquisite
    const mods = (mine && state.self.mods) ? state.self.mods : { atk: 0, def: 0, mov: 0, vision: 0 };
    const traits = [];
    if ((s.traits || []).includes('swim')) traits.push(ICONS.svg('trait-swim', 13) + ' nuoto');
    if ((s.traits || []).includes('mountain')) traits.push(ICONS.svg('trait-mountain', 13) + ' montagna');
    if ((s.traits || []).includes('strike')) traits.push(ICONS.svg('strike', 13) + ' muovi+attacca');
    const modNote = (mods.atk || mods.def || mods.mov || mods.vision)
      ? ` <span class="insp-title">(incluse tech: +${[mods.atk && `${mods.atk} ATK`, mods.def && `${mods.def} DEF`, mods.mov && `${mods.mov} MOV`, mods.vision && `${mods.vision} VIS`].filter(Boolean).join(', ')})</span>` : '';
    html += `<div class="insp-section"><span class="insp-title">Unità ${mine ? '(tua)' : '— nemica'}</span><br>` +
      `<b style="color:${owner ? owner.color : '#fff'}">${s ? esc(s.name) : u.type}</b> di ${owner ? esc(owner.name) : '?'}<br>` +
      // .stat e' flex con gap: niente spazi liberi tra SVG e valore
      `<span class="stat-line">` +
      `<span class="stat">${ICONS.svg('atk-sword', 13)}ATK ${s.atk + mods.atk}</span>` +
      `<span class="stat">${ICONS.svg('class-shield', 13)}DEF ${s.def + mods.def}</span>` +
      `</span><br>` +
      `<span class="stat-line">` +
      `<span class="stat">${ICONS.svg('hp-heart', 13)}HP ${u.hp}/${s.hp}</span>` +
      `<span class="stat">${ICONS.svg('move-boot', 13)}MOV ${s.mov + mods.mov}</span>` +
      `<span class="stat">${ICONS.svg('range-target', 13)}RNG ${s.rng}</span>` +
      `<span class="stat">${ICONS.svg('vision-eye', 13)}VISIONE ${s.vision + mods.vision}</span>` +
      `</span>${modNote}` +
      (traits.length ? `<br>Abilità: ${traits.join(' · ')}` : '') + `</div>`;
  }
  const t = tileXY[Object.keys(tileXY).find(k => { const tt = tileXY[k]; return tt.x === x && tt.y === y; })] || null;
  if (t) {
    const info = TERRAIN_INFO[t.biome] || { name: t.biome, fx: '' };
    html += `<div class="insp-section"><span class="insp-title">Terreno</span><br>${info.name} — ${info.fx}</div>`;
  }
  const c = cityAt(x, y);
  if (c) {
    const owner = state.players.find(p => p.id === c.owner_id);
    html += `<div class="insp-section"><span class="insp-title">Struttura</span><br>${ICONS.svg('building-city', 14)} ${esc(c.name)} — di ${owner ? esc(owner.name) : 'nessuno'} (+${CITY_INCOME_CLIENT} oro/round)</div>`;
  } else {
    const v = villageAt(x, y);
    if (v) {
      const owner = state.players.find(p => p.id === v.owner_id);
      html += `<div class="insp-section"><span class="insp-title">Struttura</span><br>${ICONS.svg('building-village', 14)} ${esc(v.name)} — di ${owner ? esc(owner.name) : 'nessuno (neutro)'} (+${VILLAGE_INCOME_CLIENT} oro/round, punto addestramento)</div>`;
    }
  }
  el.innerHTML = html || "Nessuna informazione su questa casella.";
}

function clearSelection() { selectedUnitId = null; selectedUnit = null; selection = null; renderUnitInfo(); }

// ================= PANNELLO LATERALE (unità selezionata) =================
function renderUnitInfo() {
  const el = document.getElementById('unitInfo');
  if (!selectedUnit || !state) { el.textContent = "Seleziona un'unità o una città."; return; }
  // inspector completo anche per l'unita' selezionata (terreno + struttura inclusi)
  showInspector(selectedUnit.x, selectedUnit.y);
}

// Pannello addestramento: lo stato (oro/disponibilita') si aggiorna a ogni state_update.
// LIMITE SPAWN: se la casella della struttura e' occupata da un'unita', i bottoni
// restano disabilitati finche' la casella non si libera (validato anche dal server).
function showBuyPanel(pointId, pointName) {
  buyPoint = { id: pointId, name: pointName };
  renderBuyPanel();
}

function pointTileOccupied() {
  if (!buyPoint || !state) return false;
  const c = state.cities.find(c => c.id === buyPoint.id);
  const v = state.villages.find(v => v.id === buyPoint.id);
  const pt = c || v;
  if (!pt) return false;
  const t = tileXY[pt.tile_id];
  if (!t) return false;
  return state.units.some(u => u.x === t.x && u.y === t.y);
}

function renderBuyPanel() {
  const panel = document.getElementById('buyPanel');
  if (!buyPoint || !state) return;
  const occupied = pointTileOccupied();
  panel.innerHTML = `<b>Addestra unità — ${esc(buyPoint.name)}</b>` +
    // .insp-enemy e' flex con gap: niente spazio libero tra SVG e testo
    (occupied ? `<br><span class="insp-enemy">${ICONS.svg('warning', 13)}Casella occupata: sposta l'unità per addestrare qui.</span>` : '');
  for (const [key, s] of Object.entries(state.catalog)) {
    const btn = document.createElement('button');
    btn.className = 'buyBtn';
    // il bottone e' flex con gap: niente spazio libero tra costo e SVG
    btn.innerHTML = `${esc(s.name)} — ${s.cost}${ICONS.svg('gold-coin', 13)}`;
    btn.disabled = occupied || state.self.gold < s.cost || !state.self.can_act;
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
  if (ok) { AudioFX.playTurnEnd(); socket.emit('end_turn'); }
});

document.getElementById('undoBtn').addEventListener('click', () => {
  if (!state || state.game.phase !== 'playing') return;
  if (!state.self.is_current || state.self.undo_count === 0) return;
  clearSelection(); // la selezione non e' piu' valida dopo il ripristino
  socket.emit('undo_action');
});

document.getElementById('newGameBtn').addEventListener('click', () => socket.emit('reset_game'));

// Log con icone SVG: accetta un nome icona esplicito oppure rileva e sostituisce
// i prefissi emoji inviati dal server (🛡️ espulsione / ⚠️ disconnessione).
function addLog(msg, iconName = null) {
  const li = document.createElement('li');
  let text = String(msg);
  if (!iconName && /^🛡️\s*/.test(text)) { iconName = 'shield-admin'; text = text.replace(/^🛡️\s*/, ''); }
  else if (!iconName && /^⚠️\s*/.test(text)) { iconName = 'warning'; text = text.replace(/^⚠️\s*/, ''); }
  // #log li e' flex con gap: niente spazio libero tra SVG e testo
  li.innerHTML = (iconName ? ICONS.svg(iconName, 13) : '') + esc(text);
  const logEl = document.getElementById('log');
  logEl.prepend(li);
  while (logEl.children.length > 12) logEl.lastChild.remove();
}

// ================= IDRAZIONE ICONE STATICHE (index.html data-icon) =================
// Gli elementi con attributo data-icon ricevono l'SVG dal dizionario assets.js:
// cosi' il markup HTML resta privo di emoji e le icone hanno una sola fonte.
function hydrateIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    const name = el.dataset.icon;
    if (!ICONS.DEFS[name]) return;
    const size = +(el.dataset.size || (el.classList.contains('icon-only') ? 20 : 15));
    // I contenitori statici con data-icon sono tutti flex con gap: lo spacing
    // icona-testo viene dal gap, quindi NIENTE spazio testuale libero dopo l'SVG
    // (creerebbe un item anonimo extra e uno spacing irregolare).
    if (el.classList.contains('icon-only')) el.innerHTML = ICONS.svg(name, size);
    else el.insertAdjacentHTML('afterbegin', ICONS.svg(name, size));
  });
}
hydrateIcons();

// ================= GUIDA / ENCICLOPEDIA (overlay globale, non distruttivo) =================
// La guida e' un puro overlay: aprirla/chiederla NON tocca lo stato di gioco
// (nessun reset, nessuna uscita dalla lobby/partita). I contenuti arrivano da
// /guide.json (il server resta la fonte di verita' di stat e tecnologie).
const GUIDE_TABS = [
  { id: 'factions', label: 'Fazioni e Unità' },
  { id: 'rules',    label: 'Meccaniche ed Economia' },
  { id: 'terrain',  label: 'Terreni e Modificatori' },
  { id: 'techs',    label: 'Albero Tecnologie' },
];
const TRAIT_LABELS = {
  swim: ICONS.svg('trait-swim', 13) + " nuoto (cammina sull'acqua)",
  mountain: ICONS.svg('trait-mountain', 13) + ' montagna (scavalca le montagne)',
  strike: ICONS.svg('strike', 13) + ' muovi+attacca (due azioni nello stesso round)',
};
let guideData = null;        // payload di /guide.json
let guideActiveTab = 'factions';
const guideEntries = {};     // tabId -> [elementi DOM delle voci]
const guideTabBtns = {};     // tabId -> bottone della scheda

function openGuide() {
  document.getElementById('guideModal').classList.remove('hidden');
  if (!guideData) loadGuide();
}
function closeGuide() { document.getElementById('guideModal').classList.add('hidden'); }

document.getElementById('guideBtn').addEventListener('click', openGuide);
document.getElementById('guideCloseBtn').addEventListener('click', closeGuide);
// click sullo sfondo (fuori dal box) o tasto Esc: chiude senza effetti collaterali
document.getElementById('guideModal').addEventListener('click', (e) => { if (e.target.id === 'guideModal') closeGuide(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('guideModal').classList.contains('hidden')) closeGuide();
});

function loadGuide() {
  const content = document.getElementById('guideContent');
  content.innerHTML = '<p class="g-loading">Caricamento guida…</p>';
  fetch('/guide.json')
    .then(r => r.json())
    .then(d => { guideData = d; renderGuideTabs(); showGuideTab(guideActiveTab); })
    .catch(() => { content.innerHTML = '<p class="g-loading">Impossibile caricare la guida: server non raggiungibile.</p>'; });
}

function renderGuideTabs() {
  const bar = document.getElementById('guideTabs');
  bar.innerHTML = '';
  for (const t of GUIDE_TABS) {
    const b = document.createElement('button');
    b.className = 'g-tab' + (t.id === guideActiveTab ? ' active' : '');
    b.textContent = t.label;
    b.onclick = () => showGuideTab(t.id);
    bar.appendChild(b);
    guideTabBtns[t.id] = b;
  }
}

function entryEl(html, searchText) {
  const div = document.createElement('div');
  div.className = 'g-entry';
  div.dataset.search = (searchText || html).toLowerCase(); // testo indicizzato per la ricerca rapida
  div.innerHTML = html;
  return div;
}

function showGuideTab(tabId) {
  guideActiveTab = tabId;
  for (const t of GUIDE_TABS) if (guideTabBtns[t.id]) guideTabBtns[t.id].classList.toggle('active', t.id === tabId);
  const content = document.getElementById('guideContent');
  if (!guideData) return; // ancora in caricamento: loadGuide riempira' al completamento
  content.innerHTML = '';
  guideEntries[tabId] = buildGuideTab(tabId, content);
  applyGuideSearch();
}

function unitRowHtml(s) {
  const traits = (s.traits || []).map(t => TRAIT_LABELS[t]).filter(Boolean).join(' · ');
  return `<tr><td>${esc(s.name)}</td><td>${s.cost} ${ICONS.svg('gold-coin', 12)}</td><td>${s.hp}</td><td>${s.atk}</td><td>${s.def}</td>` +
         `<td>${s.mov}</td><td>${s.rng}</td><td>${s.vision}</td><td>${traits || '—'}</td></tr>`;
}

function buildGuideTab(tabId, content) {
  const entries = [];
  if (tabId === 'factions') {
    for (const [fid, f] of Object.entries(guideData.factions)) {
      const rows = Object.values(f.units).map(unitRowHtml).join('');
      const searchTxt = `${f.name} ${f.desc} ` + Object.values(f.units)
        .map(s => `${s.name} ${(s.traits || []).join(' ')}`).join(' ');
      entries.push(entryEl(
        `<div class="g-faction" style="border-left:4px solid ${f.color}; padding-left:10px">` +
        `<b style="color:${f.color}">${f.name}</b> <span class="g-sub">— ${f.desc}</span>` +
        `<table class="g-table"><thead><tr><th>Unità</th><th>Costo</th><th>HP</th><th>ATK</th><th>DEF</th><th>MOV</th><th>RNG</th><th>VIS</th><th>Abilità speciali</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>`, searchTxt));
    }
  } else if (tabId === 'rules') {
    const e = guideData.economy;
    const rules = [
      ['Turni sequenziali', "I giocatori giocano uno alla volta nell'ordine di ingresso in lobby. Il turno passa solo quando il giocatore corrente conferma «Fine Turno»; nel frattempo puoi ispezionare qualsiasi casella visibile."],
      ['Annullamento mosse (Undo)', `Durante il tuo turno ogni azione (mossa, attacco, addestramento, tecnologia) è annullabile con «${ICONS.svg('undo', 13)} Annulla Mossa» (fino a 30 per turno). Confermando la fine turno lo stack si svuota: da quel punto le mosse non sono più reversibili.`],
      ['Fog of War', `Le caselle inesplorate restano nascoste. La visione guadagnata muovendo o attaccando durante il tuo turno viene rivelata SOLO quando confermi «Fine Turno». Città e villaggi hanno visione permanente di raggio ${e.visionCityRadius}.`],
      ['Villaggi e limite spawn', `I villaggi neutrali danno +${e.villageIncome} oro/round e diventano punti addestramento se conquistati. Massimo 1 unità per casella con struttura: finché la casella è occupata l'addestramento lì è disabilitato (regola validata anche dal server).`],
      ['Ricompense kill', "Distruggendo un'unità nemica ottieni oro pari a metà del suo costo di addestramento (arrotondato per eccesso) più 1 Punto Tecnologia."],
      ['Economia e incasso', `Introito base ${e.baseIncome} oro/round, +${e.cityIncome} per ogni città posseduta, +${e.villageIncome} per ogni villaggio, più i bonus delle tecnologie. L'incasso avviene quando il ciclo del round torna al primo giocatore.`],
      ['Punti Tecnologia (TP)', `+1 TP a ogni round completato e +1 TP per ogni unità nemica eliminata. I TP servono ad acquistare i perk globali della tua fazione (vedi scheda Albero Tecnologie).`],
      ['Eliminazione e vittoria', "Un giocatore viene eliminato quando non ha più né città né unità. Vince l'ultimo sopravvissuto; se tutti vengono eliminati la partita è patta."],
    ];
    for (const [title, body] of rules) entries.push(entryEl(`<b>${title}</b><br>${body}`, `${title} ${body}`));
  } else if (tabId === 'terrain') {
    const dots = { plains: '#a3c94a', forest: '#4f8f3b', mountain: '#8fa1b3', water: '#2e86de' };
    for (const [id, t] of Object.entries(guideData.terrain)) {
      entries.push(entryEl(
        `<div class="g-faction" style="border-left:4px solid ${dots[id] || '#888'}; padding-left:10px"><b>${t.name}</b><br>${t.fx}</div>`,
        `${t.name} ${t.fx}`));
    }
    entries.push(entryEl(
      '<b>Movimento</b><br>Le unità si muovono a passi ortogonali (niente diagonali) entro il proprio MOV. Le montagne sono attraversabili solo da unità con trait montagna, l\'acqua solo da unità con trait nuoto. Le unità nemiche bloccano il percorso; quelle amiche possono impilarsi.',
      'movimento passi montagne acqua nemici blocchi diagonali'));
  } else if (tabId === 'techs') {
    entries.push(entryEl(
      '<b>Come funziona</b><br>Ogni fazione ha 4 perk globali acquistabili con i Punti Tecnologia (TP): +1 TP a ogni round completato e +1 per ogni unità nemica eliminata. I bonus si applicano a tutte le tue unità (o alle unità addestrate, nel caso degli HP) finché la partita dura.',
      'punti tecnologia tp come funziona perk globali albero'));
    for (const [fid, f] of Object.entries(guideData.factions)) {
      const rows = (guideData.techs[fid] || []).map(t => `<tr><td>${t.name}</td><td>${t.cost} TP</td><td>${t.desc}</td></tr>`).join('');
      entries.push(entryEl(
        `<div class="g-faction" style="border-left:4px solid ${f.color}; padding-left:10px"><b style="color:${f.color}">${f.name}</b> <span class="g-sub">— albero tecnologie</span>` +
        `<table class="g-table"><thead><tr><th>Tecnologia</th><th>Costo</th><th>Effetto</th></tr></thead><tbody>${rows}</tbody></table></div>`,
        `${f.name} ${(guideData.techs[fid] || []).map(t => t.name + ' ' + t.desc).join(' ')}`));
    }
  }
  for (const e of entries) content.appendChild(e);
  return entries;
}

// Ricerca rapida: filtra le voci della scheda attiva e mostra il numero di
// corrispondenze su ogni tab (cosi' si trova subito in quale sezione cercare).
function applyGuideSearch() {
  const q = document.getElementById('guideSearch').value.trim().toLowerCase();
  const content = document.getElementById('guideContent');
  for (const t of GUIDE_TABS) {
    const list = guideEntries[t.id] || [];
    const n = q ? list.filter(e => e.dataset.search.includes(q)).length : 0;
    let badge = guideTabBtns[t.id] && guideTabBtns[t.id].querySelector('.g-count');
    if (q && n > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'g-count'; guideTabBtns[t.id].appendChild(badge); }
      badge.textContent = ` ${n}`;
    } else if (badge) badge.remove();
  }
  let visible = 0;
  for (const e of (guideEntries[guideActiveTab] || [])) {
    const hit = !q || e.dataset.search.includes(q);
    e.classList.toggle('hidden', !hit);
    if (hit) visible++;
  }
  let none = document.getElementById('guideNoResults');
  if (q && visible === 0) {
    if (!none) { none = document.createElement('p'); none.id = 'guideNoResults'; none.className = 'g-loading'; content.appendChild(none); }
    none.textContent = `Nessun risultato per «${document.getElementById('guideSearch').value.trim()}» in questa scheda.`;
  } else if (none) none.remove();
}
document.getElementById('guideSearch').addEventListener('input', applyGuideSearch);
