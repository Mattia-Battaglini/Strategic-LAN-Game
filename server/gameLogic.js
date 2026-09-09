// ============================================================
// CORE GAME LOGIC — il server e' la fonte di verita' (anti-cheat)
// Ogni azione del client viene VALIDATA QUI prima di essere
// applicata. I client ricevono solo snapshot filtrati dalla
// nebbia di guerra (TileVisibility).
//
// Schema di riferimento (vedi README):
//   Game(id, map_size, seed, round, phase, winner_id, spawn_points)
//   Players(id, name, color, gold, alive, turn_ended BOOL, last_acted_round, socket_id)
//   Tiles(id, x, y, biome)
//   TileVisibility(tile_id, player_id)  -- PK composito
//   Cities(id, name, owner_id, tile_id)
//   Units(id, type, owner_id, x, y, hp, has_moved)
// ============================================================

const { generateMap, findSpawns, BIOME } = require('./mapgen');

// ---------- STAT UNITA' (fonte di verita', condivisa con la UI) ----------
const UNIT_TYPES = {
  warrior:  { name: 'Warrior',  cost: 20, hp: 10, atk: 4, def: 1, mov: 1, rng: 1 },
  archer:   { name: 'Archer',   cost: 30, hp: 8,  atk: 3, def: 0, mov: 1, rng: 2 },
  rider:    { name: 'Rider',    cost: 40, hp: 9,  atk: 5, def: 1, mov: 2, rng: 1 },
  defender: { name: 'Defender', cost: 35, hp: 16, atk: 2, def: 3, mov: 1, rng: 1 },
};

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f']; // max 4 giocatori
const VISION_UNIT_RADIUS = 2;   // raggio di visione di un'unita' (Chebyshev)
const VISION_CITY_RADIUS = 3;   // raggio di visione permanente di una citta'
const BASE_INCOME = 10;         // oro/round base per giocatore
const CITY_INCOME = 5;          // oro/round per ogni citta' posseduta

// ---------- HELPERS ----------
function currentGame(db) { return db.Game.all()[0] || null; }
function tileAt(db, x, y) { return db.Tiles.all().find(t => t.x === x && t.y === y) || null; }

// ---------- CREAZIONE PARTITA / GIOCATORI ----------
function createGame(db, mapSize, seed) {
  const { tiles } = generateMap(mapSize, seed);
  const spawns = findSpawns(tiles, PLAYER_COLORS.length); // max 4 spawn
  const g = db.Game.insert({
    map_size: mapSize, seed, round: 1, phase: 'playing', winner_id: null, spawn_points: spawns,
  });
  for (let y = 0; y < mapSize; y++)
    for (let x = 0; x < mapSize; x++)
      db.Tiles.insert({ x, y, biome: tiles[y][x] });
  return g;
}

function addPlayer(db, name) {
  const g = currentGame(db);
  if (!g || g.phase !== 'playing') return null;
  const idx = db.Players.all().length;
  if (idx >= g.spawn_points.length) return null; // lobby piena (>4)
  const spawn = g.spawn_points[idx];

  const p = db.Players.insert({
    name, color: PLAYER_COLORS[idx], gold: 40, alive: true, turn_ended: false, last_acted_round: 0, socket_id: null,
  });
  const tile = tileAt(db, spawn.x, spawn.y);
  db.Cities.insert({ name: `${name} City`, owner_id: p.id, tile_id: tile.id });
  db.Units.insert({ type: 'warrior', owner_id: p.id, x: spawn.x, y: spawn.y, hp: UNIT_TYPES.warrior.hp, has_moved: false });
  revealAround(db, p.id, spawn.x, spawn.y, VISION_CITY_RADIUS); // la citta' vede i dintorni
  return p;
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
  return !!g && g.phase === 'playing' && player.alive && !player.turn_ended && player.last_acted_round < g.round;
}

// BFS con punti movimento: acqua/montagna inattraversabili, i nemici
// bloccano il percorso, le unita' amiche possono impilarsi.
function reachableTiles(db, unit) {
  const size = currentGame(db).map_size;
  const mov = UNIT_TYPES[unit.type].mov;
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
      if (t.biome === BIOME.WATER || t.biome === BIOME.MOUNTAIN) continue; // inattraversabile
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
  for (const p of db.Players.all()) {
    if (!p.alive) continue;
    const hasCity = db.Cities.all().some(c => c.owner_id === p.id);
    const hasUnit = db.Units.all().some(u => u.owner_id === p.id);
    if (!hasCity && !hasUnit) db.Players.update(p.id, { alive: false });
  }
  const g = currentGame(db);
  if (g.phase === 'playing') {
    const alive = db.Players.all().filter(p => p.alive);
    if (alive.length <= 1)
      db.Game.update(g.id, { phase: 'finished', winner_id: alive[0] ? alive[0].id : null });
  }
}

// ---------- AZIONI (tutte validate lato server) ----------
const TURN_ENDED_ERR = { ok: false, error: 'Turno terminato: usa "Annulla Fine Turno" per riprendere ad agire.' };

function performMove(db, player, unitId, toX, toY) {
  if (player.turn_ended) return TURN_ENDED_ERR;
  if (!canAct(db, player)) return { ok: false, error: 'Partita non in corso o giocatore eliminato.' };
  const unit = db.Units.get(unitId);
  if (!unit || unit.owner_id !== player.id) return { ok: false, error: 'Unita\' non valida.' };
  if (unit.has_moved) return { ok: false, error: 'Questa unita\' ha gia\' agito in questo round.' };

  const reach = reachableTiles(db, unit).find(r => r.tile.x === toX && r.tile.y === toY);
  if (!reach) return { ok: false, error: 'Destinazione fuori portata o bloccata.' };

  db.Units.update(unitId, { x: toX, y: toY, has_moved: true });
  revealAround(db, player.id, toX, toY, VISION_UNIT_RADIUS); // muovere = esplorare

  // eXterminate: entrare nella citta' nemica la conquista
  const destTile = tileAt(db, toX, toY);
  const cityHere = db.Cities.all().find(c => c.tile_id === destTile.id && c.owner_id !== player.id);
  if (cityHere) {
    db.Cities.update(cityHere.id, { owner_id: player.id });
    revealAround(db, player.id, toX, toY, VISION_CITY_RADIUS); // nuova visione dalla citta' presa
  }
  checkGameEnd(db);
  return { ok: true };
}

function performAttack(db, player, unitId, targetX, targetY) {
  if (player.turn_ended) return TURN_ENDED_ERR;
  if (!canAct(db, player)) return { ok: false, error: 'Partita non in corso o giocatore eliminato.' };
  const unit = db.Units.get(unitId);
  if (!unit || unit.owner_id !== player.id) return { ok: false, error: 'Unita\' non valida.' };
  if (unit.has_moved) return { ok: false, error: 'Questa unita\' ha gia\' agito in questo round.' };

  const stats = UNIT_TYPES[unit.type];
  const dist = Math.abs(unit.x - targetX) + Math.abs(unit.y - targetY); // distanza Manhattan
  if (dist < 1 || dist > stats.rng) return { ok: false, error: 'Target fuori dalla portata di attacco.' };
  const target = db.Units.all().find(u => u.owner_id !== player.id && u.x === targetX && u.y === targetY);
  if (!target) return { ok: false, error: 'Nessuna unita\' nemica su quella casella.' };

  const tTile = tileAt(db, targetX, targetY);
  const terrainBonus = tTile.biome === BIOME.FOREST ? 1 : 0; // la foresta da +1 DEF al difensore
  const dmg = Math.max(1, stats.atk - (UNIT_TYPES[target.type].def + terrainBonus));

  db.Units.update(target.id, { hp: target.hp - dmg });
  db.Units.update(unitId, { has_moved: true }); // attaccare consuma l'azione del round
  let killed = false;
  if (db.Units.get(target.id).hp <= 0) { db.Units.remove(target.id); killed = true; }

  revealAround(db, player.id, targetX, targetY, VISION_UNIT_RADIUS); // il combattimento rivela l'area
  checkGameEnd(db);
  return { ok: true, damage: dmg, killed };
}

function performBuyUnit(db, player, cityId, type) {
  if (player.turn_ended) return TURN_ENDED_ERR;
  if (!canAct(db, player)) return { ok: false, error: 'Partita non in corso o giocatore eliminato.' };
  const stats = UNIT_TYPES[type];
  if (!stats) return { ok: false, error: 'Tipo unita\' sconosciuto.' };
  const city = db.Cities.get(cityId);
  if (!city || city.owner_id !== player.id) return { ok: false, error: 'Citta\' non valida.' };
  if (player.gold < stats.cost) return { ok: false, error: `Oro insufficiente (serve ${stats.cost}).` };

  const t = db.Tiles.get(city.tile_id);
  db.Players.update(player.id, { gold: player.gold - stats.cost });
  // l'unita' addestrata e' pronta dal round successivo (has_moved = true)
  db.Units.insert({ type, owner_id: player.id, x: t.x, y: t.y, hp: stats.hp, has_moved: true });
  return { ok: true };
}

// FASE 1 — "fine turno in sospeso": il player non puo' piu' agire questo round,
// ma la mossa e' REVERSIBILE (cancel_end_turn) finche' il round non avanza.
function performEndTurn(db, player) {
  if (!canAct(db, player)) return { ok: false, error: 'Hai gia\' agito in questo round.' };
  const g = currentGame(db);
  db.Players.update(player.id, { turn_ended: true });

  // FASE 2 — COMMIT: tutti i giocatori VIVI hanno terminato -> incasso oro,
  // reset unita' e nuovo round globale (da qui la fine turno non e' piu' annullabile).
  let committed = false;
  if (db.Players.all().filter(p => p.alive).every(p => p.turn_ended)) {
    for (const p of db.Players.all().filter(p => p.alive)) {
      const cities = db.Cities.all().filter(c => c.owner_id === p.id);
      const income = BASE_INCOME + cities.length * CITY_INCOME; // eXploit/eXpand
      db.Players.update(p.id, { gold: p.gold + income, last_acted_round: g.round, turn_ended: false });
    }
    for (const u of db.Units.all())
      db.Units.update(u.id, { has_moved: false }); // tutte le unita' pronte per il round prossimo
    db.Game.update(g.id, { round: g.round + 1 });
    committed = true;
  }
  return { ok: true, committed };
}

// Revoca la fine turno in sospeso (valida solo finche' l'avversario sta ancora giocando)
function performCancelEndTurn(db, player) {
  const g = currentGame(db);
  if (!g || g.phase !== 'playing' || !player.alive) return { ok: false, error: 'Partita non in corso.' };
  if (!player.turn_ended) return { ok: false, error: 'Non hai la fine turno in sospeso da annullare.' };
  db.Players.update(player.id, { turn_ended: false }); // il player puo' di nuovo agire questo round
  return { ok: true };
}

// ---------- SNAPSHOT CON NEBBIA DI GUERRA (anti-cheat) ----------
// Il client riceve SOLO le caselle in TileVisibility del proprio player.
function buildSnapshotForPlayer(db, player) {
  const g = currentGame(db);
  const visible = new Set(
    db.TileVisibility.all().filter(v => v.player_id === player.id).map(v => v.tile_id));

  return {
    game: { round: g.round, phase: g.phase, winner_id: g.winner_id, map_size: g.map_size },
    players: db.Players.all().map(p => ({ id: p.id, name: p.name, color: p.color, gold: p.gold, alive: p.alive, turn_ended: p.turn_ended })),
    self: { id: player.id, gold: player.gold, can_act: canAct(db, player), turn_ended: player.turn_ended },
    catalog: UNIT_TYPES, // stat pubbliche per la UI (costi, atk/def...)
    tiles: db.Tiles.all().filter(t => visible.has(t.id)).map(t => ({ id: t.id, x: t.x, y: t.y, biome: t.biome })),
    cities: db.Cities.all()
      .filter(c => visible.has(c.tile_id))
      .map(c => ({ id: c.id, name: c.name, owner_id: c.owner_id, tile_id: c.tile_id })),
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
  UNIT_TYPES, PLAYER_COLORS, createGame, addPlayer, canAct,
  performMove, performAttack, performBuyUnit, performEndTurn, performCancelEndTurn,
  buildSnapshotForPlayer, selectionInfo, tileAt,
};
