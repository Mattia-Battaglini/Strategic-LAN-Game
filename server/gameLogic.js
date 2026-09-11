// ============================================================
// CORE GAME LOGIC — il server e' la fonte di verita' (anti-cheat)
// Ogni azione del client viene VALIDATA QUI prima di essere
// applicata. I client ricevono solo snapshot filtrati dalla
// nebbia di guerra (TileVisibility).
//
// Schema di riferimento (vedi README):
//   Game(id, map_size, seed, round, phase, winner_id, spawn_points,
//        turn_queue JSON, current_player_id, round_start_player_id)
//   Players(id, name, color, faction, gold, alive, last_acted_round, socket_id)
//   Tiles(id, x, y, biome)
//   TileVisibility(tile_id, player_id)  -- PK composito
//   Cities(id, name, owner_id, tile_id)
//   Villages(id, name, owner_id, tile_id)
//   Units(id, type, owner_id, x, y, hp, has_moved)
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
// ============================================================

const { generateMap, findSpawns, findVillages, BIOME } = require('./mapgen');

// ---------- FAZIONI (4) — ogni fazione ha un roster di unita' proprio ----------
// Le chiavi delle unita' sono UNICHE GLOBALI (prefisso fazione_) cosi'
// Units.type identifica in modo inequivocabile il tipo. `traits` estende
// le regole: 'swim' = l'unita' puo' attraversare l'acqua.
const FACTIONS = {
  valoria: {
    name: 'Valoria', color: '#e74c3c',
    desc: "Impero bilanciato: un ruolo per ogni situazione.",
    startUnit: 'valoria_warrior',
    units: {
      valoria_warrior:  { name: 'Guerriero',   icon: 'sword',     cost: 20, hp: 10, atk: 4, def: 1, mov: 1, rng: 1, vision: 2 },
      valoria_archer:   { name: 'Archer',      icon: 'bow',       cost: 30, hp: 8,  atk: 3, def: 0, mov: 1, rng: 2, vision: 3 },
      valoria_rider:    { name: 'Cavaliere',   icon: 'horseshoe', cost: 40, hp: 9,  atk: 5, def: 1, mov: 2, rng: 1, vision: 3 },
      valoria_defender: { name: 'Difensore',   icon: 'shield',    cost: 35, hp: 16, atk: 2, def: 3, mov: 1, rng: 1, vision: 2 },
    },
  },
  nordmark: {
    name: 'Nordmark', color: '#3b6fd4',
    desc: "Clan del Nord: pesanti e difensivi, cavalleria fulminea.",
    startUnit: 'nordmark_berserker',
    units: {
      nordmark_berserker:  { name: 'Berserker',     icon: 'axe',       cost: 25, hp: 8,  atk: 6, def: 0, mov: 1, rng: 1, vision: 2 },
      nordmark_shieldwall: { name: 'Muro di Scudi', icon: 'shield',    cost: 35, hp: 20, atk: 2, def: 4, mov: 1, rng: 1, vision: 2 },
      nordmark_wolfrider:  { name: 'Cav. del Lupo', icon: 'horseshoe', cost: 45, hp: 10, atk: 5, def: 1, mov: 3, rng: 1, vision: 3 },
      nordmark_hunter:     { name: 'Cacciatore',    icon: 'bow',       cost: 30, hp: 9,  atk: 3, def: 1, mov: 2, rng: 2, vision: 4 },
    },
  },
  saharim: {
    name: 'Saharim', color: '#f0a13a',
    desc: "Nomadi del deserto: rapidi e con grande visione.",
    startUnit: 'saharim_scout',
    units: {
      saharim_scout:     { name: 'Scout',        icon: 'eye',       cost: 20, hp: 7,  atk: 2, def: 0, mov: 3, rng: 1, vision: 5 },
      saharim_lancer:    { name: 'Lanciere',     icon: 'spear',     cost: 35, hp: 9,  atk: 4, def: 1, mov: 2, rng: 2, vision: 3 },
      saharim_dunerider: { name: 'Cav. di Duna', icon: 'horseshoe', cost: 40, hp: 8,  atk: 5, def: 0, mov: 3, rng: 1, vision: 3 },
      saharim_warden:    { name: 'Guardiano',    icon: 'shield',    cost: 30, hp: 12, atk: 2, def: 2, mov: 1, rng: 1, vision: 3 },
    },
  },
  aqualis: {
    name: 'Aqualis', color: '#18bfa0',
    desc: "Popolo delle maree: i suoi Nuotatori attraversano l'acqua.",
    startUnit: 'aqualis_corsair',
    units: {
      aqualis_corsair:   { name: 'Corsaro',             icon: 'sword',  cost: 30, hp: 9,  atk: 5, def: 1, mov: 1, rng: 1, vision: 2 },
      aqualis_slinger:   { name: 'Scagliatore',         icon: 'bow',    cost: 25, hp: 7,  atk: 3, def: 0, mov: 1, rng: 3, vision: 4 },
      aqualis_swimmer:   { name: 'Nuotatore',           icon: 'wave',   cost: 35, hp: 8,  atk: 3, def: 1, mov: 2, rng: 1, vision: 3, traits: ['swim'] },
      aqualis_tideguard: { name: 'Guardia delle Maree', icon: 'shield', cost: 40, hp: 14, atk: 3, def: 3, mov: 1, rng: 1, vision: 2 },
    },
  },
};

// Flat map type -> stat (Units.type e' unico globale)
const UNIT_TYPES = {};
for (const f of Object.values(FACTIONS))
  for (const [tid, s] of Object.entries(f.units)) UNIT_TYPES[tid] = s;

const MAX_PLAYERS = Object.keys(FACTIONS).length; // max giocatori = n. fazioni
const VISION_CITY_RADIUS = 3;   // raggio di visione permanente di una citta'/villaggio proprio
const BASE_INCOME = 10;         // oro/round base per giocatore
const CITY_INCOME = 5;          // oro/round per ogni citta' posseduta
const VILLAGE_INCOME = 8;       // oro/round per ogni villaggio conquistato (introito maggiore)

// ---------- UNDO: stack di snapshot dello stato (solo per il turno corrente) ----------
let undoStack = [];            // array di stringhe JSON
const UNDO_CAP = 30;           // limite mosse annullabili per turno

function clearUndo() { undoStack.length = 0; }

function pushUndo(db) {
  const snap = JSON.stringify({
    Game: db.Game.all(), Players: db.Players.all(), TileVisibility: db.TileVisibility.all(),
    Cities: db.Cities.all(), Villages: db.Villages.all(), Units: db.Units.all(),
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
}

// ---------- HELPERS ----------
function currentGame(db) { return db.Game.all()[0] || null; }
function tileAt(db, x, y) { return db.Tiles.all().find(t => t.x === x && t.y === y) || null; }
function aliveQueue(g, db) {
  return (g.turn_queue || []).filter(id => { const p = db.Players.get(id); return p && p.alive; });
}

// ---------- CREAZIONE PARTITA / GIOCATORI ----------
// opts: { density:{water,mountain,forest}, villages:n } — configurazione pre-partita
function createGame(db, mapSize, seed, opts = {}) {
  clearUndo();
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

  // Villaggi neutrali sparsi sulla mappa (conquistabili)
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
  });
  const tile = tileAt(db, spawn.x, spawn.y);
  db.Cities.insert({ name: `${name} City`, owner_id: p.id, tile_id: tile.id });
  const startStats = UNIT_TYPES[f.startUnit];
  db.Units.insert({ type: f.startUnit, owner_id: p.id, x: spawn.x, y: spawn.y, hp: startStats.hp, has_moved: false });
  revealAround(db, p.id, spawn.x, spawn.y, VISION_CITY_RADIUS); // la citta' vede i dintorni
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

// ---------- REGOLE BASE ----------
function canAct(db, player) {
  const g = currentGame(db);
  return !!g && g.phase === 'playing' && player.alive && g.current_player_id === player.id;
}

// BFS con punti movimento: acqua/montagna inattraversabili (salvo trait 'swim'),
// i nemici bloccano il percorso, le unita' amiche possono impilarsi.
function reachableTiles(db, unit) {
  const size = currentGame(db).map_size;
  const stats = UNIT_TYPES[unit.type];
  const mov = stats.mov;
  const canSwim = (stats.traits || []).includes('swim');
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
      if (t.biome === BIOME.MOUNTAIN) continue; // montagne sempre inattraversabili
      if (t.biome === BIOME.WATER && !canSwim) continue; // acqua: solo i Nuotatori
      const enemy = db.Units.all().find(u => u.x === nx && u.y === ny && u.owner_id !== unit.owner_id);
      if (enemy) continue; // i nemici bloccano il passaggio
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

  pushUndo(db); // la mossa sara' annullabile finche' non confermi il turno
  db.Units.update(unitId, { x: toX, y: toY, has_moved: true });
  revealAround(db, player.id, toX, toY, UNIT_TYPES[unit.type].vision); // muovere = esplorare

  const destTile = tileAt(db, toX, toY);
  // eXterminate/eXpand: entrare nella citta' nemica la conquista
  const cityHere = db.Cities.all().find(c => c.tile_id === destTile.id && c.owner_id !== player.id);
  if (cityHere) {
    db.Cities.update(cityHere.id, { owner_id: player.id });
    revealAround(db, player.id, toX, toY, VISION_CITY_RADIUS); // nuova visione dalla citta' presa
  }
  // Villaggio neutro o nemico -> conquista (introito + punto addestramento)
  const villageHere = db.Villages.all().find(v => v.tile_id === destTile.id && v.owner_id !== player.id);
  if (villageHere) {
    db.Villages.update(villageHere.id, { owner_id: player.id });
    revealAround(db, player.id, toX, toY, VISION_CITY_RADIUS); // il villaggio conquistato vede i dintorni
  }
  checkGameEnd(db);
  return { ok: true };
}

function performAttack(db, player, unitId, targetX, targetY) {
  if (!canAct(db, player)) return NOT_YOUR_TURN_ERR;
  const unit = db.Units.get(unitId);
  if (!unit || unit.owner_id !== player.id) return { ok: false, error: "Unità non valida." };
  if (unit.has_moved) return { ok: false, error: "Questa unità ha già agito in questo round." };

  const stats = UNIT_TYPES[unit.type];
  const dist = Math.abs(unit.x - targetX) + Math.abs(unit.y - targetY); // distanza Manhattan
  if (dist < 1 || dist > stats.rng) return { ok: false, error: 'Target fuori dalla portata di attacco.' };
  const target = db.Units.all().find(u => u.owner_id !== player.id && u.x === targetX && u.y === targetY);
  if (!target) return { ok: false, error: "Nessuna unità nemica su quella casella." };

  pushUndo(db); // l'attacco sara' annullabile finche' non confermi il turno
  const tTile = tileAt(db, targetX, targetY);
  const terrainBonus = tTile.biome === BIOME.FOREST ? 1 : 0; // la foresta da +1 DEF al difensore
  const dmg = Math.max(1, stats.atk - (UNIT_TYPES[target.type].def + terrainBonus));

  db.Units.update(target.id, { hp: target.hp - dmg });
  db.Units.update(unitId, { has_moved: true }); // attaccare consuma l'azione del round
  let killed = false;
  if (db.Units.get(target.id).hp <= 0) { db.Units.remove(target.id); killed = true; }

  revealAround(db, player.id, targetX, targetY, stats.vision); // il combattimento rivela l'area
  checkGameEnd(db);
  return { ok: true, damage: dmg, killed };
}

// Addestramento in una citta' OPPURE in un villaggio conquistato (punto spawn extra)
function performBuyUnit(db, player, pointId, type) {
  if (!canAct(db, player)) return NOT_YOUR_TURN_ERR;
  const stats = UNIT_TYPES[type];
  if (!stats) return { ok: false, error: "Tipo unità sconosciuto." };
  // il punto di addestramento puo' essere una citta' OPPURE un villaggio (id separati per tabella)
  const city = db.Cities.get(pointId);
  const village = db.Villages.get(pointId);
  let point = null;
  if (city && city.owner_id === player.id) point = city;
  else if (village && village.owner_id === player.id) point = village;
  if (!point) return { ok: false, error: 'Punto di addestramento non valido.' };
  if (player.gold < stats.cost) return { ok: false, error: `Oro insufficiente (serve ${stats.cost}).` };

  pushUndo(db); // l'acquisto sara' annullabile finche' non confermi il turno
  const t = db.Tiles.get(point.tile_id);
  db.Players.update(player.id, { gold: player.gold - stats.cost });
  // l'unita' addestrata e' pronta dal round successivo (has_moved = true)
  db.Units.insert({ type, owner_id: player.id, x: t.x, y: t.y, hp: stats.hp, has_moved: true });
  return { ok: true };
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
// Le mosse di questo turno NON sono piu' annullabili (undoStack svuotato).
function performEndTurn(db, player) {
  const g = currentGame(db);
  if (!g || g.phase !== 'playing' || !player.alive) return { ok: false, error: 'Partita non in corso.' };
  if (g.current_player_id !== player.id) return NOT_YOUR_TURN_ERR;

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
      const income = BASE_INCOME + cities * CITY_INCOME + villages * VILLAGE_INCOME; // eXploit/eXpand
      db.Players.update(p.id, { gold: p.gold + income, last_acted_round: g.round });
    }
    for (const u of db.Units.all())
      db.Units.update(u.id, { has_moved: false }); // tutte le unita' pronte per il round prossimo
    db.Game.update(g.id, { round: g.round + 1 });
    committed = true;
  }
  db.Game.update(g.id, { current_player_id: nextId });
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

  const queue = [...(g.turn_queue || [])];
  const idx = queue.indexOf(p.id);
  if (idx !== -1) queue.splice(idx, 1);

  let current = g.current_player_id;
  let roundStart = g.round_start_player_id;
  if (!queue.length) {
    current = null; roundStart = null;
  } else {
    if (current === p.id) current = queue[idx % queue.length] || queue[0]; // il turno passa subito al successivo
    if (roundStart === p.id) roundStart = current || queue[0]; // chi apre il round diventa l'attuale
  }
  db.Game.update(g.id, { turn_queue: queue, current_player_id: current, round_start_player_id: roundStart });

  checkGameEnd(db);
  return { name: p.name, reason };
}

// ---------- SNAPSHOT CON NEBBIA DI GUERRA (anti-cheat) ----------
// Il client riceve SOLO le caselle in TileVisibility del proprio player.
function buildSnapshotForPlayer(db, player, opts = {}) {
  const g = currentGame(db);
  const visible = new Set(
    db.TileVisibility.all().filter(v => v.player_id === player.id).map(v => v.tile_id));

  return {
    game: { round: g.round, phase: g.phase, winner_id: g.winner_id, map_size: g.map_size, current_player_id: g.current_player_id },
    players: db.Players.all().map(p => ({ id: p.id, name: p.name, color: p.color, faction: p.faction, gold: p.gold, alive: p.alive })),
    self: {
      id: player.id, gold: player.gold, can_act: canAct(db, player),
      is_current: g.current_player_id === player.id,
      undo_count: undoStack.length,
      is_host: !!opts.isHost,
    },
    catalog: FACTIONS[player.faction] ? FACTIONS[player.faction].units : {}, // roster della PROPRIA fazione (pannello addestramento)
    unitTypes: UNIT_TYPES, // stat pubbliche di TUTTE le unita' (icone/HP per il rendering)
    tiles: db.Tiles.all().filter(t => visible.has(t.id)).map(t => ({ id: t.id, x: t.x, y: t.y, biome: t.biome })),
    cities: db.Cities.all()
      .filter(c => visible.has(c.tile_id))
      .map(c => ({ id: c.id, name: c.name, owner_id: c.owner_id, tile_id: c.tile_id })),
    villages: db.Villages.all()
      .filter(v => visible.has(v.tile_id))
      .map(v => ({ id: v.id, name: v.name, owner_id: v.owner_id, tile_id: v.tile_id })),
    units: db.Units.all()
      .filter(u => u.owner_id === player.id || (tileAt(db, u.x, u.y) && visible.has(tileAt(db, u.x, u.y).id)))
      .map(u => ({ id: u.id, type: u.type, owner_id: u.owner_id, x: u.x, y: u.y, hp: u.hp, has_moved: u.has_moved })),
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
  FACTIONS, UNIT_TYPES, MAX_PLAYERS, BASE_INCOME, CITY_INCOME, VILLAGE_INCOME,
  createGame, addPlayer, finalizeTurnOrder, canAct, clearUndo,
  performMove, performAttack, performBuyUnit, performEndTurn, performUndoAction, removePlayerFromGame,
  buildSnapshotForPlayer, selectionInfo, tileAt,
};
