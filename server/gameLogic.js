// ============================================================
// CORE GAME LOGIC — il server e' la fonte di verita' (anti-cheat)
// Ogni azione del client viene VALIDATA QUI prima di essere
// applicata. I client ricevono solo snapshot filtrati dalla
// nebbia di guerra (TileVisibility).
//
// Schema di riferimento (vedi README):
//   Game(id, map_size, seed, round, phase, winner_id, spawn_points,
//        turn_queue JSON, current_player_id, round_start_player_id)
//   Players(id, name, color, faction, gold, alive, last_acted_round,
//           socket_id, tp INT (punti tecnologia), techs JSON [])
//   Tiles(id, x, y, biome)
//   TileVisibility(tile_id, player_id)  -- PK composito
//   Cities(id, name, owner_id, tile_id)
//   Villages(id, name, owner_id, tile_id)
//   Units(id, type, owner_id, x, y, hp, has_moved, has_attacked)
//
// MODELLO A TURNI SEQUENZIALI:
//   - La coda dei turni (turn_queue) e' ciclica: gioca il player corrente,
//     tutti gli altri attendono. Il turno passa SOLO quando il player
//     corrente conferma esplicitamente la fine turno (performEndTurn).
//   - Durante il proprio turno le mosse sono ANNULLABILI (undoStack):
//     ogni azione pusha uno snapshot dello stato; performUndoAction lo
//     ripristina. La conferma della fine turno svuota lo stack: da quel
//     punto le mosse non sono piu' reversibili.
//   - Quando il ciclo torna al player che ha aperto il round (round_start)
//     -> COMMIT: incasso oro per tutti, reset unita', round++.
//
// NEBBIA DI GUERRA A RILASCIO RITARDATO:
//   La visione guadagnata muovendo/attaccando durante un turno NON viene
//   rivelata subito: e' accumulata in pendingVision[playerId] e scritta
//   nella TileVisibility SOLO quando il player conferma la fine turno.
//
// AZIONI A RILASCIO RITARDATO (stesso principio, per le unita'):
//   Le mosse/attacchi in corso del giocatore corrente NON sono visibili agli
//   altri player: gli snapshot dei non-correnti usano lo "stato confermato"
//   (confirmedState), una copia di Units/Cities/Villages aggiornata SOLO alla
//   conferma della fine turno. Il player corrente vede sempre lo stato live.
// ============================================================

const { generateMap, findSpawns, findVillages, spawnsConnected, BIOME } = require('./mapgen');

// ---------- FAZIONI (4) — ogni fazione ha un roster di unita' proprio ----------
// Le chiavi delle unita' sono UNICHE GLOBALI (prefisso fazione_) cosi'
// Units.type identifica in modo inequivocabile il tipo. `traits` estende
// le regole:
//   'swim'    = l'unita' puo' attraversare l'acqua
//   'mountain'= l'unita' puo' scavalcare/attraversare le montagne
//   'strike'  = muovere E attaccare nello stesso round (due azioni)
const FACTIONS = {
  valoria: {
    name: 'Valoria', color: '#e74c3c',
    desc: "Impero bilanciato: un ruolo per ogni situazione.",
    startUnit: 'valoria_warrior',
    units: {
      valoria_warrior:  { name: 'Guerriero',   icon: 'sword',     cost: 20, hp: 10, atk: 4, def: 1, mov: 1, rng: 1, vision: 2 },
      valoria_archer:   { name: 'Archer',      icon: 'bow',       cost: 30, hp: 8,  atk: 3, def: 0, mov: 1, rng: 2, vision: 3 },
      valoria_rider:    { name: 'Cavaliere',   icon: 'horseshoe', cost: 40, hp: 9,  atk: 5, def: 1, mov: 2, rng: 1, vision: 3, traits: ['strike'] },
      valoria_defender: { name: 'Difensore',   icon: 'shield',    cost: 35, hp: 16, atk: 2, def: 3, mov: 1, rng: 1, vision: 2, traits: ['mountain'] },
    },
  },
  nordmark: {
    name: 'Nordmark', color: '#3b6fd4',
    desc: "Clan del Nord: pesanti e difensivi, cavalleria fulminea.",
    startUnit: 'nordmark_berserker',
    units: {
      nordmark_berserker:  { name: 'Berserker',     icon: 'axe',       cost: 25, hp: 8,  atk: 6, def: 0, mov: 1, rng: 1, vision: 2, traits: ['strike'] },
      nordmark_shieldwall: { name: 'Muro di Scudi', icon: 'shield',    cost: 35, hp: 20, atk: 2, def: 4, mov: 1, rng: 1, vision: 2 },
      nordmark_wolfrider:  { name: 'Cav. del Lupo', icon: 'horseshoe', cost: 45, hp: 10, atk: 5, def: 1, mov: 3, rng: 1, vision: 3, traits: ['mountain'] },
      nordmark_hunter:     { name: 'Cacciatore',    icon: 'bow',       cost: 30, hp: 9,  atk: 3, def: 1, mov: 2, rng: 2, vision: 4 },
    },
  },
  saharim: {
    name: 'Saharim', color: '#f0a13a',
    desc: "Nomadi del deserto: rapidi e con grande visione.",
    startUnit: 'saharim_scout',
    units: {
      saharim_scout:     { name: 'Scout',        icon: 'eye',       cost: 20, hp: 7,  atk: 2, def: 0, mov: 3, rng: 1, vision: 5, traits: ['mountain'] },
      saharim_lancer:    { name: 'Lanciere',     icon: 'spear',     cost: 35, hp: 9,  atk: 4, def: 1, mov: 2, rng: 2, vision: 3 },
      saharim_dunerider: { name: 'Cav. di Duna', icon: 'horseshoe', cost: 40, hp: 8,  atk: 5, def: 0, mov: 3, rng: 1, vision: 3, traits: ['strike'] },
      saharim_warden:    { name: 'Guardiano',    icon: 'shield',    cost: 30, hp: 12, atk: 2, def: 2, mov: 1, rng: 1, vision: 3 },
    },
  },
  aqualis: {
    name: 'Aqualis', color: '#18bfa0',
    desc: "Popolo delle maree: i suoi Nuotatori attraversano l'acqua.",
    startUnit: 'aqualis_corsair',
    units: {
      aqualis_corsair:   { name: 'Corsaro',             icon: 'sword',  cost: 30, hp: 9,  atk: 5, def: 1, mov: 1, rng: 1, vision: 2, traits: ['strike'] },
      aqualis_slinger:   { name: 'Scagliatore',         icon: 'bow',    cost: 25, hp: 7,  atk: 3, def: 0, mov: 1, rng: 3, vision: 4 },
      aqualis_swimmer:   { name: 'Nuotatore',           icon: 'wave',   cost: 35, hp: 8,  atk: 3, def: 1, mov: 2, rng: 1, vision: 3, traits: ['swim', 'mountain'] },
      aqualis_tideguard: { name: 'Guardia delle Maree', icon: 'shield', cost: 40, hp: 14, atk: 3, def: 3, mov: 1, rng: 1, vision: 2 },
    },
  },
};

// Flat map type -> stat (Units.type e' unico globale)
const UNIT_TYPES = {};
for (const f of Object.values(FACTIONS))
  for (const [tid, s] of Object.entries(f.units)) UNIT_TYPES[tid] = s;

// ---------- ALBERO TECNOLOGICO (perk globali per fazione) ----------
// Effetti: atk/def/mov/income/vision = bonus globali alle unita' del player;
// hpBonus = HP extra applicati alle unita' addestrate. TP: +1 a ogni commit
// di round e +1 per ogni unita' nemica eliminata.
const TECHS = {
  valoria: [
    { id: 'valoria_militia',   name: 'Militia Addestrata',     desc: '+1 ATK a tutte le unità.',            cost: 2, effect: { atk: 1 } },
    { id: 'valoria_logistics', name: 'Logistica Imperiale',    desc: '+3 oro per round.',                    cost: 3, effect: { income: 3 } },
    { id: 'valoria_cavalry',   name: 'Scuola di Cavalleria',   desc: '+1 MOV a tutte le unità.',             cost: 4, effect: { mov: 1 } },
    { id: 'valoria_walls',     name: 'Mura Fortificate',       desc: '+1 DEF a tutte le unità.',             cost: 5, effect: { def: 1 } },
  ],
  nordmark: [
    { id: 'nordmark_runes',   name: 'Rune del Nord',          desc: '+2 oro per round.',                    cost: 2, effect: { income: 2 } },
    { id: 'nordmark_wolf',    name: 'Patto con il Lupo',      desc: '+1 MOV a tutte le unità.',             cost: 3, effect: { mov: 1 } },
    { id: 'nordmark_iron',    name: 'Forgiatura del Ferro',   desc: '+1 ATK e +1 DEF a tutte le unità.',    cost: 4, effect: { atk: 1, def: 1 } },
    { id: 'nordmark_aura',    name: 'Aura del Nord',          desc: '+3 HP alle unità addestrate.',         cost: 5, effect: { hpBonus: 3 } },
  ],
  saharim: [
    { id: 'saharim_eyes',     name: 'Occhi del Deserto',      desc: '+1 VISIONE a tutte le unità.',         cost: 2, effect: { vision: 1 } },
    { id: 'saharim_trade',    name: 'Carovane Nomadi',        desc: '+3 oro per round.',                    cost: 3, effect: { income: 3 } },
    { id: 'saharim_wind',     name: 'Vento di Sabbia',        desc: '+1 MOV a tutte le unità.',             cost: 4, effect: { mov: 1 } },
    { id: 'saharim_blessing', name: "Benedizione del Guardiano", desc: '+1 DEF a tutte le unità.',          cost: 5, effect: { def: 1 } },
  ],
  aqualis: [
    { id: 'aqualis_harbor',   name: 'Porto di Corallo',       desc: '+3 oro per round.',                    cost: 2, effect: { income: 3 } },
    { id: 'aqualis_waves',    name: 'Addestramento delle Onde', desc: '+1 ATK a tutte le unità.',           cost: 3, effect: { atk: 1 } },
    { id: 'aqualis_amphib',   name: 'Tattica Anfibia',        desc: '+1 VISIONE a tutte le unità.',         cost: 4, effect: { vision: 1 } },
    { id: 'aqualis_tide',     name: 'Scudo delle Maree',      desc: '+3 HP alle unità addestrate.',         cost: 5, effect: { hpBonus: 3 } },
  ],
};

const MAX_PLAYERS = Object.keys(FACTIONS).length; // max giocatori = n. fazioni
const VISION_CITY_RADIUS = 3;   // raggio di visione permanente di una citta'/villaggio proprio
const BASE_INCOME = 10;         // oro/round base per giocatore
const CITY_INCOME = 5;          // oro/round per ogni citta' posseduta
const VILLAGE_INCOME = 8;       // oro/round per ogni villaggio conquistato (introito maggiore)

// ---------- UNDO: stack di snapshot dello stato (solo per il turno corrente) ----------
let undoStack = [];            // array di stringhe JSON
const UNDO_CAP = 30;           // limite mosse annullabili per turno

// Visione in attesa di rilascio: playerId -> Set(tile_id). Viene scritta nella
// TileVisibility solo alla conferma della fine turno del player.
let pendingVision = {};

// Stato confermato (azioni a rilascio ritardato): copia profonda di
// Units/Cities/Villages scattata a ogni fine turno confermato. I player NON
// correnti la ricevono negli snapshot; il player corrente vede lo stato live.
let confirmedState = null; // { Units:[...], Cities:[...], Villages:[...] }

function clearUndo() { undoStack.length = 0; }

function snapshotConfirmed(db) {
  confirmedState = JSON.parse(JSON.stringify({
    Units: db.Units.all(),
    Cities: db.Cities.all(),
    Villages: db.Villages.all(),
  }));
}

function pushUndo(db) {
  const pv = {}; // i Set non sono serializzabili in JSON: li converto in array
  for (const [pid, set] of Object.entries(pendingVision)) pv[pid] = [...set];
  const snap = JSON.stringify({
    Game: db.Game.all(), Players: db.Players.all(), TileVisibility: db.TileVisibility.all(),
    Cities: db.Cities.all(), Villages: db.Villages.all(), Units: db.Units.all(),
    pendingVision: pv, // la visione in attesa fa parte dello stato annullabile
  });
  undoStack.push(snap);
  if (undoStack.length > UNDO_CAP) undoStack.shift();
}

function restoreSnapshot(db, snap) {
  const d = JSON.parse(snap);
  db.Game.load(d.Game);
  db.Players.load(d.Players);
  db.TileVisibility.load(d.TileVisibility);
  db.Cities.load(d.Cities);
  db.Villages.load(d.Villages);
  db.Units.load(d.Units);
  pendingVision = {}; // ripristina la visione in attesa dello snapshot
  for (const [pid, tiles] of Object.entries(d.pendingVision || {}))
    pendingVision[pid] = new Set(tiles);
}

// ---------- HELPERS ----------
function currentGame(db) { return db.Game.all()[0] || null; }
function tileAt(db, x, y) { return db.Tiles.all().find(t => t.x === x && t.y === y) || null; }
function aliveQueue(g, db) {
  return (g.turn_queue || []).filter(id => { const p = db.Players.get(id); return p && p.alive; });
}

// Bonus globali di un player derivati dalle tecnologie acquisite.
function playerModifiers(db, playerId) {
  const mods = { atk: 0, def: 0, mov: 0, income: 0, vision: 0, hpBonus: 0 };
  const p = db.Players.get(playerId);
  if (!p || !p.techs) return mods;
  for (const tid of p.techs) {
    const tech = TECHS[p.faction].find(t => t.id === tid);
    if (!tech) continue;
    for (const [k, v] of Object.entries(tech.effect)) mods[k] += v;
  }
  return mods;
}

// La mappa e' giocabile se tutti gli spawn sono sullo stesso pezzo di terra
// (nessuna base isolata: esiste sempre un percorso a piedi tra le basi).
function mapIsPlayable(db) {
  const g = currentGame(db);
  if (!g || !(g.spawn_points || []).length) return false;
  const size = g.map_size;
  const grid = Array.from({ length: size }, () => new Array(size).fill(BIOME.WATER));
  for (const t of db.Tiles.all()) grid[t.y][t.x] = t.biome;
  return spawnsConnected(grid, g.spawn_points);
}

// ---------- CREAZIONE PARTITA / GIOCATORI ----------
// opts: { density:{water,mountain,forest}, villages:n } — configurazione pre-partita
function createGame(db, mapSize, seed, opts = {}) {
  clearUndo();
  pendingVision = {};
  confirmedState = null; // la partita riparte: lo stato confermato si ricalcola in finalizeTurnOrder
  const density = opts.density || {};
  const { tiles } = generateMap(mapSize, seed, density);
  const spawns = findSpawns(tiles, MAX_PLAYERS); // max 4 spawn
  const g = db.Game.insert({
    map_size: mapSize, seed, round: 1, phase: 'playing', winner_id: null, spawn_points: spawns,
    turn_queue: [], current_player_id: null, round_start_player_id: null,
  });
  for (let y = 0; y < mapSize; y++)
    for (let x = 0; x < mapSize; x++)
      db.Tiles.insert({ x, y, biome: tiles[y][x] });

  // Villaggi neutrali sparsi sulla mappa (conquistabili), sempre raggiungibili
  const vCount = Math.max(0, Math.min(12, Number.isFinite(+opts.villages) ? +opts.villages : 4));
  findVillages(tiles, spawns, vCount).forEach((v, i) => {
    db.Villages.insert({ name: `Villaggio ${i + 1}`, owner_id: null, tile_id: tileAt(db, v.x, v.y).id });
  });
  return g;
}

function addPlayer(db, name, factionId) {
  const g = currentGame(db);
  if (!g || g.phase !== 'playing') return null;
  const f = FACTIONS[factionId];
  if (!f) return null; // fazione sconosciuta
  const idx = db.Players.all().length;
  if (idx >= g.spawn_points.length) return null; // lobby piena (>4)
  const spawn = g.spawn_points[idx];

  const p = db.Players.insert({
    name, color: f.color, faction: factionId, gold: 40, alive: true, last_acted_round: 0, socket_id: null,
    tp: 0, techs: [], // punti tecnologia e albero tecnologie
  });
  const tile = tileAt(db, spawn.x, spawn.y);
  db.Cities.insert({ name: `${name} City`, owner_id: p.id, tile_id: tile.id });
  const startStats = UNIT_TYPES[f.startUnit];
  db.Units.insert({ type: f.startUnit, owner_id: p.id, x: spawn.x, y: spawn.y, hp: startStats.hp, has_moved: false, has_attacked: false });
  revealAround(db, p.id, spawn.x, spawn.y, VISION_CITY_RADIUS); // la citta' vede i dintorni (immediato)
  return p;
}

// Dopo tutti gli addPlayer: imposta la coda dei turni (ordine di join) e il primo turno.
function finalizeTurnOrder(db) {
  const g = currentGame(db);
  if (!g) return;
  const ids = db.Players.all().map(p => p.id); // ordine di join
  db.Game.update(g.id, {
    turn_queue: ids,
    current_player_id: ids[0] || null,
    round_start_player_id: ids[0] || null,
  });
  snapshotConfirmed(db); // lo stato iniziale (posizioni spawn) e' gia' confermato
}

// ---------- NEBBIA DI GUERRA (eXplore) ----------
function revealAround(db, playerId, x, y, radius) {
  const g = currentGame(db);
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) continue; // cerchio Chebyshev
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.map_size || ny >= g.map_size) continue;
      const t = tileAt(db, nx, ny);
      if (!t) continue;
      const seen = db.TileVisibility.all().some(v => v.tile_id === t.id && v.player_id === playerId);
      if (!seen) db.TileVisibility.insert({ tile_id: t.id, player_id: playerId });
    }
}

// Stessa geometria di revealAround ma in ATTESA: la casella viene rivelata solo
// quando il player conferma la fine turno (flushPendingVision).
function revealPending(db, playerId, x, y, radius) {
  const g = currentGame(db);
  if (!pendingVision[playerId]) pendingVision[playerId] = new Set();
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) continue; // cerchio Chebyshev
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.map_size || ny >= g.map_size) continue;
      const t = tileAt(db, nx, ny);
      if (!t) continue;
      const seen = db.TileVisibility.all().some(v => v.tile_id === t.id && v.player_id === playerId);
      if (!seen) pendingVision[playerId].add(t.id);
    }
}

// Rilascia la visione in attesa di un player nella TileVisibility (fine turno).
function flushPendingVision(db, playerId) {
  const set = pendingVision[playerId];
  if (!set || !set.size) return;
  for (const tileId of set) {
    const seen = db.TileVisibility.all().some(v => v.tile_id === tileId && v.player_id === playerId);
    if (!seen) db.TileVisibility.insert({ tile_id: tileId, player_id: playerId });
  }
  pendingVision[playerId] = new Set();
}

// ---------- REGOLE BASE ----------
function canAct(db, player) {
  const g = currentGame(db);
  return !!g && g.phase === 'playing' && player.alive && g.current_player_id === player.id;
}

// BFS con punti movimento: acqua inattraversabile salvo trait 'swim', montagne
// inattraversabili salvo trait 'mountain'. OCCUPAZIONE SINGOLA: ogni casella
// con un'unita' (amica o nemica) blocca atterraggio E attraversamento —
// massimo 1 unita' per casella. Il MOV include i bonus delle tecnologie.
function reachableTiles(db, unit) {
  const size = currentGame(db).map_size;
  const stats = UNIT_TYPES[unit.type];
  const mods = playerModifiers(db, unit.owner_id);
  const mov = Math.max(1, stats.mov + mods.mov);
  const canSwim = (stats.traits || []).includes('swim');
  const canClimb = (stats.traits || []).includes('mountain');
  const startId = tileAt(db, unit.x, unit.y).id;
  const dist = new Map([[startId, 0]]);
  const queue = [[unit.x, unit.y]];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    const cd = dist.get(tileAt(db, cx, cy).id);
    if (cd >= mov) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const t = tileAt(db, nx, ny);
      if (!t || dist.has(t.id)) continue;
      if (t.biome === BIOME.MOUNTAIN && !canClimb) continue; // montagne: solo unita' con trait
      if (t.biome === BIOME.WATER && !canSwim) continue;    // acqua: solo i Nuotatori
      const occupied = db.Units.all().some(u => u.x === nx && u.y === ny);
      if (occupied) continue; // OCCUPAZIONE SINGOLA: casella occupata (amica o nemica) = blocco totale
      dist.set(t.id, cd + 1);
      queue.push([nx, ny]);
    }
  }
  return [...dist.entries()]
    .map(([id, cost]) => ({ tile: db.Tiles.get(id), cost }))
    .filter(r => !(r.tile.x === unit.x && r.tile.y === unit.y)); // escludi la casella di partenza
}

// Eliminazione: chi non ha ne' citta' ne' unita' e' fuori. Vince l'ultimo vivo.
function checkGameEnd(db) {
  const g = currentGame(db);
  if (!g) return;
  for (const p of db.Players.all()) {
    if (!p.alive) continue;
    const hasCity = db.Cities.all().some(c => c.owner_id === p.id);
    const hasUnit = db.Units.all().some(u => u.owner_id === p.id);
    if (!hasCity && !hasUnit) db.Players.update(p.id, { alive: false });
  }
  // pulizia coda turni: i morti non devono piu' comparire nella sequenza
  const q0 = g.turn_queue || [];
  const q1 = q0.filter(id => { const p = db.Players.get(id); return p && p.alive; });
  if (q1.length !== q0.length) db.Game.update(g.id, { turn_queue: q1 });

  if (g.phase === 'playing') {
    const alive = db.Players.all().filter(p => p.alive);
    if (alive.length <= 1)
      db.Game.update(g.id, { phase: 'finished', winner_id: alive[0] ? alive[0].id : null });
  }
}

// ---------- AZIONI (tutte validate lato server) ----------
const NOT_YOUR_TURN_ERR = { ok: false, error: "Non è il tuo turno: attendi che finisca il giocatore corrente." };

function performMove(db, player, unitId, toX, toY) {
  if (!canAct(db, player)) return NOT_YOUR_TURN_ERR;
  const unit = db.Units.get(unitId);
  if (!unit || unit.owner_id !== player.id) return { ok: false, error: "Unità non valida." };
  if (unit.has_moved) return { ok: false, error: "Questa unità ha già agito in questo round." };

  const reach = reachableTiles(db, unit).find(r => r.tile.x === toX && r.tile.y === toY);
  if (!reach) return { ok: false, error: 'Destinazione fuori portata o bloccata.' };

  // OCCUPAZIONE SINGOLA (difesa in profondita'): la destinazione deve essere
  // libera da qualsiasi unita' — il BFS gia' lo garantisce, ma il controllo
  // esplicito rende la regola severa anche a fronte di stati anomali.
  if (db.Units.all().some(u => u.x === toX && u.y === toY))
    return { ok: false, error: "La casella è occupata da un'altra unità." };

  pushUndo(db); // la mossa sara' annullabile finche' non confermi il turno
  db.Units.update(unitId, { x: toX, y: toY, has_moved: true });
  const mods = playerModifiers(db, player.id);
  revealPending(db, player.id, toX, toY, UNIT_TYPES[unit.type].vision + mods.vision); // muovere = esplorare (rivelato a fine turno)

  const destTile = tileAt(db, toX, toY);
  // eXterminate/eXpand: entrare nella citta' nemica la conquista
  const cityHere = db.Cities.all().find(c => c.tile_id === destTile.id && c.owner_id !== player.id);
  if (cityHere) {
    db.Cities.update(cityHere.id, { owner_id: player.id });
    revealPending(db, player.id, toX, toY, VISION_CITY_RADIUS); // nuova visione dalla citta' presa
  }
  // Villaggio neutro o nemico -> conquista (introito + punto addestramento)
  const villageHere = db.Villages.all().find(v => v.tile_id === destTile.id && v.owner_id !== player.id);
  if (villageHere) {
    db.Villages.update(villageHere.id, { owner_id: player.id });
    revealPending(db, player.id, toX, toY, VISION_CITY_RADIUS); // il villaggio conquistato vede i dintorni
  }
  checkGameEnd(db);
  return { ok: true };
}

// Modificatori di terreno sul danno (il server calcola tutto):
//   foresta : +1 DEF al difensore; gli attacchi a DISTANZA (rng>1) fanno meta' danno
//   montagna: +2 DEF al difensore che vi sta sopra
function terrainDefense(tile, attackerStats) {
  let def = 0;
  if (tile.biome === BIOME.FOREST) def += 1;
  if (tile.biome === BIOME.MOUNTAIN) def += 2;
  return def;
}

function performAttack(db, player, unitId, targetX, targetY) {
  if (!canAct(db, player)) return NOT_YOUR_TURN_ERR;
  const unit = db.Units.get(unitId);
  if (!unit || unit.owner_id !== player.id) return { ok: false, error: "Unità non valida." };
  const stats = UNIT_TYPES[unit.type];
  const hasStrike = (stats.traits || []).includes('strike'); // muovi E attacca nello stesso round
  if (unit.has_attacked) return { ok: false, error: 'Questa unità ha già attaccato in questo round.' };
  if (!hasStrike && unit.has_moved) return { ok: false, error: "Questa unità ha già agito in questo round." };

  const dist = Math.abs(unit.x - targetX) + Math.abs(unit.y - targetY); // distanza Manhattan
  if (dist < 1 || dist > stats.rng) return { ok: false, error: 'Target fuori dalla portata di attacco.' };
  const target = db.Units.all().find(u => u.owner_id !== player.id && u.x === targetX && u.y === targetY);
  if (!target) return { ok: false, error: "Nessuna unità nemica su quella casella." };

  pushUndo(db); // l'attacco sara' annullabile finche' non confermi il turno
  const tTile = tileAt(db, targetX, targetY);
  const atkMods = playerModifiers(db, player.id);
  const defMods = playerModifiers(db, target.owner_id);
  const terrainBonus = terrainDefense(tTile, stats); // bonus DEF del terreno del difensore
  let dmg = Math.max(1, (stats.atk + atkMods.atk) - (UNIT_TYPES[target.type].def + defMods.def + terrainBonus));
  if (tTile.biome === BIOME.FOREST && stats.rng > 1)
    dmg = Math.max(1, Math.floor(dmg / 2)); // la foresta smorza gli attacchi a distanza

  db.Units.update(target.id, { hp: target.hp - dmg });
  // consuma l'azione: le unita' 'strike' possono comunque muovere dopo l'attacco
  db.Units.update(unitId, hasStrike ? { has_attacked: true } : { has_moved: true, has_attacked: true });

  let killed = false;
  if (db.Units.get(target.id).hp <= 0) {
    db.Units.remove(target.id);
    killed = true;
    // RICOMPENSA KILL: oro proporzionale al costo dell'unita' distrutta + 1 TP
    const reward = Math.ceil(UNIT_TYPES[target.type].cost / 2);
    const owner = db.Players.get(player.id);
    db.Players.update(owner.id, { gold: owner.gold + reward, tp: (owner.tp || 0) + 1 });
  }

  revealPending(db, player.id, targetX, targetY, stats.vision + atkMods.vision); // il combattimento rivela l'area (a fine turno)
  checkGameEnd(db);
  return { ok: true, damage: dmg, killed };
}

// Addestramento in una citta' OPPURE in un villaggio conquistato (punto spawn extra).
// LIMITE SPAWN: massimo 1 unita' per casella con struttura — se la casella e'
// occupata da un'unita', l'addestramento e' disabilitato finche' non si libera.
// ATTENZIONE AI PK: Cities e Villages hanno autoincrement SEPARATI, quindi gli ID
// delle due tabelle POSSONO coincidere (villaggio id=1 == citta' id=1). Per questo
// il client dichiara esplicitamente pointKind ('city'|'village') e qui si consulta
// SOLO la tabella indicata: nessun lookup "a tentativi" che potrebbe risolvere un
// villaggio nella citta' ome (e far spawna l'unita' sulla base principale).
function performBuyUnit(db, player, pointId, type, pointKind) {
  if (!canAct(db, player)) return NOT_YOUR_TURN_ERR;
  const stats = UNIT_TYPES[type];
  if (!stats) return { ok: false, error: "Tipo unità sconosciuto." };
  let point = null;
  if (pointKind === 'city') {
    const city = db.Cities.get(pointId);
    if (city && city.owner_id === player.id) point = city;
  } else if (pointKind === 'village') {
    const village = db.Villages.get(pointId);
    if (village && village.owner_id === player.id) point = village;
  }
  if (!point) return { ok: false, error: 'Punto di addestramento non valido.' };
  const t = db.Tiles.get(point.tile_id);
  if (db.Units.all().some(u => u.x === t.x && u.y === t.y))
    return { ok: false, error: "La casella è occupata da un'unità: sposta l'unità per addestrare qui." };
  if (player.gold < stats.cost) return { ok: false, error: `Oro insufficiente (serve ${stats.cost}).` };

  pushUndo(db); // l'acquisto sara' annullabile finche' non confermi il turno
  const mods = playerModifiers(db, player.id);
  db.Players.update(player.id, { gold: player.gold - stats.cost });
  // l'unita' addestrata e' pronta dal round successivo (has_moved = true)
  db.Units.insert({ type, owner_id: player.id, x: t.x, y: t.y, hp: stats.hp + mods.hpBonus, has_moved: true, has_attacked: false });
  return { ok: true };
}

// Acquisto di una tecnologia della propria fazione (consuma TP).
function performBuyTech(db, player, techId) {
  if (!canAct(db, player)) return NOT_YOUR_TURN_ERR;
  const tree = TECHS[player.faction] || [];
  const tech = tree.find(t => t.id === techId);
  if (!tech) return { ok: false, error: 'Tecnologia sconosciuta per la tua fazione.' };
  if ((player.techs || []).includes(techId)) return { ok: false, error: 'Tecnologia già acquisita.' };
  const tp = player.tp || 0;
  if (tp < tech.cost) return { ok: false, error: `Punti tecnologia insufficienti (${tp}/${tech.cost}).` };

  pushUndo(db); // l'acquisto sara' annullabile finche' non confermi il turno
  db.Players.update(player.id, { tp: tp - tech.cost, techs: [...(player.techs || []), techId] });
  return { ok: true, tech: tech.name };
}

// ANNULLA MOSSA — ripristina lo snapshot precedente (solo nel proprio turno,
// finche' non si conferma la fine turno).
function performUndoAction(db, player) {
  const g = currentGame(db);
  if (!g || g.phase !== 'playing' || !player.alive) return { ok: false, error: 'Partita non in corso.' };
  if (g.current_player_id !== player.id) return NOT_YOUR_TURN_ERR;
  const snap = undoStack.pop();
  if (!snap) return { ok: false, error: 'Nessuna mossa da annullare.' };
  restoreSnapshot(db, snap);
  return { ok: true };
}

// FINE TURNO CONFERMATA — il turno passa subito al giocatore successivo.
// Le mosse di questo turno NON sono piu' annullabili (undoStack svuotato) e la
// visione guadagnata durante il turno viene RIVELATA ora (flush).
function performEndTurn(db, player) {
  const g = currentGame(db);
  if (!g || g.phase !== 'playing' || !player.alive) return { ok: false, error: 'Partita non in corso.' };
  if (g.current_player_id !== player.id) return NOT_YOUR_TURN_ERR;

  flushPendingVision(db, player.id); // la nuova esplorazione si sblocca SOLO ora
  undoStack.length = 0; // conferma esplicita: niente piu' undo per questo turno

  const q = aliveQueue(g, db);
  if (!q.length) return { ok: false, error: 'Nessun giocatore in coda.' };
  let roundStart = g.round_start_player_id;
  if (!q.includes(roundStart)) { // il player che apriva il round e' stato eliminato
    roundStart = player.id;
    db.Game.update(g.id, { round_start_player_id: roundStart });
  }

  const idx = q.indexOf(player.id);
  const nextId = q[(idx + 1) % q.length];
  let committed = false;
  if (nextId === roundStart) {
    // COMMIT: tutti i giocatori vivi hanno giocato -> incasso oro, reset unita', round++
    for (const p of db.Players.all().filter(p => p.alive)) {
      const cities = db.Cities.all().filter(c => c.owner_id === p.id).length;
      const villages = db.Villages.all().filter(v => v.owner_id === p.id).length;
      const mods = playerModifiers(db, p.id);
      const income = BASE_INCOME + cities * CITY_INCOME + villages * VILLAGE_INCOME + mods.income; // eXploit/eXpand
      db.Players.update(p.id, { gold: p.gold + income, tp: (p.tp || 0) + 1, last_acted_round: g.round }); // +1 TP a round
    }
    for (const u of db.Units.all())
      db.Units.update(u.id, { has_moved: false, has_attacked: false }); // tutte le unita' pronte per il round prossimo
    db.Game.update(g.id, { round: g.round + 1 });
    committed = true;
  }
  db.Game.update(g.id, { current_player_id: nextId });
  // Le azioni di questo turno sono ora CONFERMATE: gli altri player le vedranno
  // nello stato confermato (rilascio ritardato delle mosse nemiche).
  snapshotConfirmed(db);
  return { ok: true, committed };
}

// Rimozione immediata di un player (espulso dall'host o disconnesso):
// la coda dei turni viene aggiornata SUBITO cosi' la partita non resta bloccata.
// NB: socket_id NON viene azzerato -> chi viene espulso continua a ricevere
// gli snapshot come spettatore; tutte le sue azioni restano rifiutate (alive=false).
function removePlayerFromGame(db, playerId, reason) {
  const g = currentGame(db);
  if (!g || g.phase !== 'playing') return null;
  const p = db.Players.get(playerId);
  if (!p || !p.alive) return null;

  db.Players.update(p.id, { alive: false });
  undoStack.length = 0; // le mosse del turno interrotto non sono piu' annullabili
  pendingVision[playerId] = new Set(); // la visione in attesa va persa con il player

  const queue = [...(g.turn_queue || [])];
  const idx = queue.indexOf(p.id);
  if (idx !== -1) queue.splice(idx, 1);

  const wasCurrent = g.current_player_id === p.id; // il turno era del player rimosso?
  let current = g.current_player_id;
  let roundStart = g.round_start_player_id;
  if (!queue.length) {
    current = null; roundStart = null;
  } else {
    if (current === p.id) current = queue[idx % queue.length] || queue[0]; // il turno passa subito al successivo
    if (roundStart === p.id) roundStart = current || queue[0]; // chi apre il round diventa l'attuale
  }
  db.Game.update(g.id, { turn_queue: queue, current_player_id: current, round_start_player_id: roundStart });

  // Se il turno e' passato SENZA conferma (espulsione/disconnessione del player
  // corrente), lo stato finale diventa confermato subito: cosi' tutti i client
  // vedono le stesse posizioni delle unita' (niente "mosse fantasma" nascoste).
  if (wasCurrent) snapshotConfirmed(db);

  checkGameEnd(db);
  return { name: p.name, reason };
}

// ---------- SNAPSHOT CON NEBBIA DI GUERRA (anti-cheat) ----------
// Il client riceve SOLO le caselle in TileVisibility del proprio player.
// AZIONI A RILASCIO RITARDATO: i player NON correnti ricevono unita'/citta'/
// villaggi dallo STATO CONFERMATO (ultimo fine turno): le azioni in corso del
// giocatore corrente restano nascoste finche' non conferma la fine turno. Il
// player corrente riceve lo stato live (le sue mosse le vede lui per primo).
function buildSnapshotForPlayer(db, player, opts = {}) {
  const g = currentGame(db);
  const visible = new Set(
    db.TileVisibility.all().filter(v => v.player_id === player.id).map(v => v.tile_id));

  const frozen = !!(confirmedState && g.current_player_id !== player.id);
  const unitsAll = frozen ? confirmedState.Units : db.Units.all();
  const citiesAll = frozen ? confirmedState.Cities : db.Cities.all();
  const villagesAll = frozen ? confirmedState.Villages : db.Villages.all();

  return {
    game: { round: g.round, phase: g.phase, winner_id: g.winner_id, map_size: g.map_size, current_player_id: g.current_player_id },
    players: db.Players.all().map(p => ({ id: p.id, name: p.name, color: p.color, faction: p.faction, gold: p.gold, alive: p.alive })),
    self: {
      id: player.id, gold: player.gold, can_act: canAct(db, player),
      is_current: g.current_player_id === player.id,
      undo_count: undoStack.length,
      is_host: !!opts.isHost,
      tp: player.tp || 0, techs: player.techs || [], mods: playerModifiers(db, player.id), // albero tecnologie
    },
    catalog: FACTIONS[player.faction] ? FACTIONS[player.faction].units : {}, // roster della PROPRIA fazione (pannello addestramento)
    unitTypes: UNIT_TYPES, // stat pubbliche di TUTTE le unita' (icone/HP per il rendering + ispezione nemici)
    techCatalog: TECHS[player.faction] || [], // albero tecnologie della propria fazione
    tiles: db.Tiles.all().filter(t => visible.has(t.id)).map(t => ({ id: t.id, x: t.x, y: t.y, biome: t.biome })),
    cities: citiesAll
      .filter(c => visible.has(c.tile_id))
      .map(c => ({ id: c.id, name: c.name, owner_id: c.owner_id, tile_id: c.tile_id })),
    villages: villagesAll
      .filter(v => visible.has(v.tile_id))
      .map(v => ({ id: v.id, name: v.name, owner_id: v.owner_id, tile_id: v.tile_id })),
    units: unitsAll
      .filter(u => u.owner_id === player.id || (tileAt(db, u.x, u.y) && visible.has(tileAt(db, u.x, u.y).id)))
      .map(u => ({ id: u.id, type: u.type, owner_id: u.owner_id, x: u.x, y: u.y, hp: u.hp, has_moved: u.has_moved, has_attacked: u.has_attacked })),
  };
}

// Info di selezione per il client (calcolate dal server = anti-cheat)
function selectionInfo(db, player, unitId) {
  const unit = db.Units.get(unitId);
  if (!unit || unit.owner_id !== player.id) return null;
  const stats = UNIT_TYPES[unit.type];
  return {
    reachable: reachableTiles(db, unit).map(r => ({ x: r.tile.x, y: r.tile.y })),
    targets: db.Units.all()
      .filter(u => u.owner_id !== player.id && Math.abs(u.x - unit.x) + Math.abs(u.y - unit.y) <= stats.rng)
      .map(u => ({ x: u.x, y: u.y })),
    stats,
  };
}

module.exports = {
  FACTIONS, UNIT_TYPES, TECHS, MAX_PLAYERS, BASE_INCOME, CITY_INCOME, VILLAGE_INCOME,
  createGame, addPlayer, finalizeTurnOrder, canAct, clearUndo, mapIsPlayable,
  performMove, performAttack, performBuyUnit, performBuyTech, performEndTurn,
  performUndoAction, removePlayerFromGame, buildSnapshotForPlayer, selectionInfo, tileAt,
};
