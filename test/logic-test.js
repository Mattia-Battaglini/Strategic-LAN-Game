// ============================================================
// UNIT TEST LOGICHE DI GIOCO (senza socket): verifica diretta di
// gameLogic per le meccaniche nuove:
//   - modificatori terreno (foresta +1 DEF e meta' danno a distanza, montagna +2 DEF)
//   - ricompensa kill (oro proporzionale al costo + 1 TP)
//   - limite spawn (max 1 unita' per casella con struttura)
//   - nebbia a rilascio ritardato (visione flush solo a fine turno, undo coerente)
//   - albero tecnologie (TP, effetti globali validati server)
//   - trait 'strike' (muovi E attacca nello stesso round)
//   - trait 'mountain' (scavalcare le montagne)
// Uso: node test/logic-test.js
// ============================================================

const { DB } = require('../server/db');
const G = require('../server/gameLogic');

let passed = 0, failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log('  ✅ ' + label); }
  else { failed++; console.error('  ❌ ' + label); }
}

// ---------- helpers di setup ----------
function makeWorld() {
  const db = new DB();
  G.createGame(db, 8, 12345, { density: { water: 0, mountain: 0, forest: 0 }, villages: 0 });
  // forza TUTTE le caselle a pianura per un controllo totale del terreno
  for (const t of db.Tiles.all()) db.Tiles.update(t.id, { biome: 'plains' });
  return db;
}

function addTwo(db) {
  const a = G.addPlayer(db, 'Alice', 'valoria');   // spawn[0]
  const b = G.addPlayer(db, 'Bob', 'nordmark');    // spawn[1]
  G.finalizeTurnOrder(db);
  return [a, b];
}

function tileId(db, x, y) { return db.Tiles.all().find(t => t.x === x && t.y === y).id; }
function cityId(db, playerId) { return db.Cities.all().find(c => c.owner_id === playerId).id; }
function unitOf(db, playerId) { return db.Units.all().filter(u => u.owner_id === playerId); }

// Sposta l'unita' di partenza su una casella raggiungibile (libera la citta').
function freeCity(db, player) {
  const u = unitOf(db, player.id)[0];
  const sel = G.selectionInfo(db, player, u.id);
  const dest = sel.reachable[0];
  if (!dest) throw new Error('setup: nessuna casella raggiungibile per liberare la citta\'');
  const r = G.performMove(db, player, u.id, dest.x, dest.y);
  if (!r.ok) throw new Error('setup: ' + r.error);
}

// Addestra un tipo in citta' e lo rende subito pronto (bypass del "pronto dal round dopo").
function trainReady(db, player, type) {
  freeCity(db, player);
  const r = G.performBuyUnit(db, player, cityId(db, player.id), type);
  if (!r.ok) throw new Error('setup: ' + r.error);
  const u = db.Units.all().find(u => u.type === type && u.owner_id === player.id);
  db.Units.update(u.id, { has_moved: false });
  return u;
}

console.log('--- MODIFICATORI TERRENO ---');
{
  // foresta: +1 DEF al difensore (attacco corpo a corpo)
  const db = makeWorld();
  const [a] = addTwo(db);
  const ua = unitOf(db, a.id)[0]; // Guerriero atk4
  const bobU = db.Units.all().find(u => u.owner_id !== a.id); // Berserker def0 hp8
  db.Units.update(bobU.id, { x: ua.x + (ua.x < 7 ? 1 : -1), y: ua.y }); // porta Bob adiacente (setup)
  db.Tiles.update(tileId(db, bobU.x, bobU.y), { biome: 'forest' });
  const r = G.performAttack(db, a, ua.id, bobU.x, bobU.y);
  check(r.ok && r.damage === 3, `foresta (melee): danno Guerriero su Berserker in foresta = ${r.damage} (atteso 3)`);

  // foresta + attacco a distanza: meta' danno
  const db2 = makeWorld();
  const [a2] = addTwo(db2);
  const archer = trainReady(db2, a2, 'valoria_archer'); // rng 2 atk3
  const bobU2 = db2.Units.all().find(u => u.owner_id !== a2.id);
  const spawnA = db2.Game.all()[0].spawn_points[0];
  db2.Units.update(bobU2.id, { x: spawnA.x + (spawnA.x < 7 ? 1 : -1), y: spawnA.y }); // dist 1 dalla citta' di Alice
  db2.Tiles.update(tileId(db2, bobU2.x, bobU2.y), { biome: 'forest' });
  const r2 = G.performAttack(db2, a2, archer.id, bobU2.x, bobU2.y);
  check(r2.ok && r2.damage === 1, `foresta (distanza): danno Archer base max(1,3-0-1)=2 dimezzato = ${r2.damage} (atteso 1)`);

  // montagna: +2 DEF al difensore che vi sta sopra
  const db3 = makeWorld();
  const [a3] = addTwo(db3);
  const ua3 = unitOf(db3, a3.id)[0];
  const bobU3 = db3.Units.all().find(u => u.owner_id !== a3.id);
  db3.Units.update(bobU3.id, { x: ua3.x + (ua3.x < 7 ? 1 : -1), y: ua3.y }); // porta Bob adiacente (setup)
  db3.Tiles.update(tileId(db3, bobU3.x, bobU3.y), { biome: 'mountain' });
  const r3 = G.performAttack(db3, a3, ua3.id, bobU3.x, bobU3.y);
  check(r3.ok && r3.damage === 2, `montagna: danno Guerriero su Berserker in montagna = ${r3.damage} (atteso max(1,4-0-2)=2)`);
}

console.log('--- RICOMPENSA KILL ---');
{
  const db = makeWorld();
  const [a] = addTwo(db);
  const ua = unitOf(db, a.id)[0]; // Guerriero atk4 (senza strike)
  const bobU = db.Units.all().find(u => u.owner_id !== a.id); // Berserker hp8 cost25
  db.Units.update(bobU.id, { x: ua.x + (ua.x < 7 ? 1 : -1), y: ua.y }); // porta Bob adiacente (setup)
  const goldBefore = a.gold, tpBefore = a.tp;
  G.performAttack(db, a, ua.id, bobU.x, bobU.y); // danno 4 -> hp 4
  const rBlocked = G.performAttack(db, a, ua.id, bobU.x, bobU.y);
  check(!rBlocked.ok && /attaccato/.test(rBlocked.error), 'unita\' senza strike non attacca due volte nello stesso round');
  for (const u of db.Units.all()) db.Units.update(u.id, { has_moved: false, has_attacked: false }); // nuovo round
  const r2 = G.performAttack(db, a, ua.id, bobU.x, bobU.y); // danno 4 -> hp 0 -> KILL
  check(r2.ok && r2.killed === true, 'secondo attacco elimina il Berserker');
  const after = db.Players.get(a.id);
  check(after.gold === goldBefore + Math.ceil(25 / 2), `ricompensa kill: oro ${goldBefore} -> ${after.gold} (atteso +${Math.ceil(25 / 2)})`);
  check(after.tp === tpBefore + 1, `TP per kill: ${tpBefore} -> ${after.tp}`);
}

console.log('--- LIMITE SPAWN (max 1 unita\' per struttura) ---');
{
  const db = makeWorld();
  const [a] = addTwo(db);
  const r = G.performBuyUnit(db, a, cityId(db, a.id), 'valoria_warrior');
  check(!r.ok && /occupata/.test(r.error), `spawn bloccato con casella occupata: "${r.error}"`);
  freeCity(db, a); // l'unita' libera la casella
  const r2 = G.performBuyUnit(db, a, cityId(db, a.id), 'valoria_warrior');
  check(r2.ok, 'spawn riabilitato dopo che l\'unita\' ha liberato la casella');
}

console.log('--- NEBBIA A RILASCIO RITARDATO ---');
{
  const db = makeWorld();
  const [a] = addTwo(db);
  const visCount = () => db.TileVisibility.all().filter(v => v.player_id === a.id).length;
  const u = unitOf(db, a.id)[0];
  const sx = u.x, sy = u.y;
  const visBefore = visCount();
  // due mosse (reset del flag in mezzo): dal corner spawn la prima mossa resta
  // dentro il cerchio iniziale di raggio 3 della citta', la seconda esce
  G.performMove(db, a, u.id, u.x + (u.x < 7 ? 1 : -1), u.y);
  db.Units.update(u.id, { has_moved: false });
  G.performMove(db, a, u.id, u.x + (u.x < 7 ? 1 : -1), u.y); // visione in ATTESA
  check(visCount() === visBefore, `durante il turno la visione NON si rivela (${visCount()} == ${visBefore})`);
  G.performEndTurn(db, a); // conferma fine turno -> flush
  check(visCount() > visBefore, `dopo il fine turno la visione si sblocca (${visBefore} -> ${visCount()})`);

  // undo della mossa: posizione ripristinata e visione in attesa coerente
  const db2 = makeWorld();
  const [a2] = addTwo(db2);
  const u2 = unitOf(db2, a2.id)[0];
  const sx2 = u2.x;
  G.performMove(db2, a2, u2.id, u2.x + (u2.x < 7 ? 1 : -1), u2.y);
  const undo = G.performUndoAction(db2, a2);
  check(undo.ok && db2.Units.get(u2.id).x === sx2, 'undo ripristina la posizione dell\'unita\'');
}

console.log('--- ALBERO TECNOLOGIE ---');
{
  const db = makeWorld();
  const [a] = addTwo(db);
  let r = G.performBuyTech(db, a, 'valoria_militia'); // 0 TP
  check(!r.ok && /tecnologia/i.test(r.error), `acquisto tech senza TP rifiutato: "${r.error}"`);
  db.Players.update(a.id, { tp: 2 });
  r = G.performBuyTech(db, a, 'valoria_militia');
  check(r.ok, 'acquisto Militia con 2 TP riuscito');
  const snap = G.buildSnapshotForPlayer(db, a);
  check(snap.self.techs.includes('valoria_militia') && snap.self.tp === 0, 'tech registrata e TP detratti');
  check(snap.self.mods.atk === 1, `effetto globale applicato: mods.atk = ${snap.self.mods.atk}`);
  r = G.performBuyTech(db, a, 'valoria_militia');
  check(!r.ok && /acquisita/i.test(r.error), 'riacquisto della stessa tech rifiutato');
  db.Players.update(a.id, { tp: 10 });
  r = G.performBuyTech(db, a, 'nordmark_iron');
  check(!r.ok && /sconosciuta/i.test(r.error), 'tech di altra fazione rifiutata');
}

console.log('--- TRAIT STRIKE (muovi E attacca nello stesso round) ---');
{
  const db = makeWorld();
  const [a] = addTwo(db);
  const rider = trainReady(db, a, 'valoria_rider'); // strike: mov2 atk5
  const bobU = db.Units.all().find(u => u.owner_id !== a.id);
  // muovi il Cavaliere di un passo (prima azione del round)
  const sel = G.selectionInfo(db, a, rider.id);
  const dest = sel.reachable[0];
  const mv = G.performMove(db, a, rider.id, dest.x, dest.y);
  check(mv.ok, 'Cavaliere si e\' mosso (azione 1)');
  // porta Bob adiacente al Cavaliere (setup di test)
  db.Units.update(bobU.id, { x: rider.x + (rider.x < 7 ? 1 : -1), y: rider.y });
  const atk = G.performAttack(db, a, rider.id, bobU.x, bobU.y); // azione 2 nello stesso round
  check(atk.ok, 'Cavaliere attacca DOPO aver mosso nello stesso round (strike)');
}

console.log('--- TRAIT MOUNTAIN (scavalcare le montagne) ---');
{
  const db = makeWorld();
  const [a] = addTwo(db);
  const u = unitOf(db, a.id)[0]; // Guerriero (senza trait)
  const wallX = u.x < 7 ? u.x + 1 : u.x - 1;
  db.Tiles.update(tileId(db, wallX, u.y), { biome: 'mountain' });
  const sel = G.selectionInfo(db, a, u.id);
  check(!sel.reachable.some(p => p.x === wallX && p.y === u.y), 'Guerriero (senza trait) non entra in montagna');

  const def = trainReady(db, a, 'valoria_defender'); // trait mountain: sta sulla citta'
  const mX = def.x < 7 ? def.x + 1 : def.x - 1;
  db.Tiles.update(tileId(db, mX, def.y), { biome: 'mountain' });
  const sel2 = G.selectionInfo(db, a, def.id);
  check(sel2.reachable.some(p => p.x === mX && p.y === def.y), 'Difensore (trait mountain) entra in montagna');
}

console.log(`\nLOGIC TEST: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
