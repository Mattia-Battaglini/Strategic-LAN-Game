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
//   - occupazione singola (max 1 unita' per casella: atterraggio e attraversamento bloccati)
//   - spawn villaggio (origine = casella del villaggio, collisione PK citta'/villaggio)
//   - azioni nemiche a rilascio ritardato (stato confermato solo al fine turno)
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

// (setup di test) rende visibili a un player le caselle in cerchio attorno a (x,y):
// serve per isolare la verifica dello stato confermato dalla nebbia di guerra.
function revealFor(db, playerId, x, y, r) {
  const size = db.Game.all()[0].map_size;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const t = db.Tiles.all().find(t => t.x === nx && t.y === ny);
      if (!t) continue;
      const seen = db.TileVisibility.all().some(v => v.tile_id === t.id && v.player_id === playerId);
      if (!seen) db.TileVisibility.insert({ tile_id: t.id, player_id: playerId });
    }
}

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
  const r = G.performBuyUnit(db, player, cityId(db, player.id), type, 'city');
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
  const r = G.performBuyUnit(db, a, cityId(db, a.id), 'valoria_warrior', 'city');
  check(!r.ok && /occupata/.test(r.error), `spawn bloccato con casella occupata: "${r.error}"`);
  freeCity(db, a); // l'unita' libera la casella
  const r2 = G.performBuyUnit(db, a, cityId(db, a.id), 'valoria_warrior', 'city');
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

console.log('--- OCCUPAZIONE SINGOLA (max 1 unita\' per casella) ---');
{
  const db = makeWorld();
  const [a] = addTwo(db);
  const ua = unitOf(db, a.id)[0]; // Guerriero (in citta')
  freeCity(db, a);                 // il Guerriero si sposta: la citta' e' libera
  db.Players.update(a.id, { gold: 200 });
  G.performBuyUnit(db, a, cityId(db, a.id), 'valoria_defender', 'city');
  const def = db.Units.all().find(u => u.type === 'valoria_defender' && u.owner_id === a.id);
  db.Units.update(def.id, { has_moved: false }); // pronto (bypass "pronto dal round dopo")

  // 1) atterraggio sulla casella di un ALLEATO: non raggiungibile + mossa rifiutata
  const sel = G.selectionInfo(db, a, def.id);
  check(!sel.reachable.some(p => p.x === ua.x && p.y === ua.y), 'casella occupata da un alleato NON e\' raggiungibile');
  const rBlock = G.performMove(db, a, def.id, ua.x, ua.y);
  check(!rBlock.ok, `mossa su casella occupata rifiutata: "${rBlock.error}"`);

  // 2) attraversamento: il Cavaliere (MOV 2) non puo' "saltare" la casella di un alleato
  db.Units.update(def.id, { x: 0, y: 5 }); // sposto il Difensore altrove (libera la citta')
  G.performBuyUnit(db, a, cityId(db, a.id), 'valoria_rider', 'city');
  const rider = db.Units.all().find(u => u.type === 'valoria_rider' && u.owner_id === a.id);
  db.Units.update(rider.id, { has_moved: false });
  // disposizione lineare controllata: [rider (2,3)] -> [alleato ua (3,3)] -> (4,3)
  const bobU = db.Units.all().find(u => u.owner_id !== a.id);
  db.Units.update(bobU.id, { x: 7, y: 0 }); // Bob in un angolo: non interferisce
  db.Units.update(ua.id, { x: 3, y: 3 });
  db.Units.update(rider.id, { x: 2, y: 3 });
  const selR = G.selectionInfo(db, a, rider.id);
  check(!selR.reachable.some(p => p.x === 4 && p.y === 3), 'il percorso NON attraversa la casella di un alleato (MOV 2)');
}

console.log('--- SPAWN VILLAGGIO (origine = casella del villaggio, collisione ID) ---');
{
  // mondo con villaggi: i PK sono autoincrement SEPARATI per tabella e i villaggi
  // vengono inseriti PRIMA delle citta' -> l'id del villaggio 1 coincide con la
  // citta' di Alice (caso esatto del bug: spawn sulla base principale)
  const db = new DB();
  G.createGame(db, 8, 12345, { density: { water: 0, mountain: 0, forest: 0 }, villages: 2 });
  for (const t of db.Tiles.all()) db.Tiles.update(t.id, { biome: 'plains' });
  const a = G.addPlayer(db, 'Alice', 'valoria');
  const b = G.addPlayer(db, 'Bob', 'nordmark');
  G.finalizeTurnOrder(db);

  const v = db.Villages.all()[0];
  const cityA = db.Cities.all().find(c => c.owner_id === a.id);
  check(v.id === cityA.id, `precondizione collisione ID: villaggio id=${v.id} == citta' di Alice id=${cityA.id}`);
  const vt = db.Tiles.get(v.tile_id), ct = db.Tiles.get(cityA.tile_id);
  check(!(vt.x === ct.x && vt.y === ct.y), 'il villaggio sta su casella diversa dalla citta\'');

  db.Villages.update(v.id, { owner_id: a.id }); // conquista (setup)
  db.Players.update(a.id, { gold: 200 });
  const startU = unitOf(db, a.id)[0]; // Guerriero iniziale in citta'
  const r = G.performBuyUnit(db, a, v.id, 'valoria_warrior', 'village');
  check(r.ok, `addestramento nel villaggio riuscito (pointKind=village): ${r.error || 'ok'}`);
  const atVillage = db.Units.all().filter(u => u.owner_id === a.id && u.x === vt.x && u.y === vt.y);
  check(atVillage.length === 1 && atVillage[0].id !== startU.id, `unita' spawna nella casella del villaggio (${vt.x},${vt.y}), non sulla base`);

  // controllo negativo: senza kind dichiarato il punto e' rifiutato (niente lookup ambiguo)
  const rNoKind = G.performBuyUnit(db, a, v.id, 'valoria_warrior');
  check(!rNoKind.ok && /non valido/i.test(rNoKind.error), `pointKind mancante: acquisto rifiutato ("${rNoKind.error}")`);
}

console.log('--- AZIONI NEMICHE A RILASCIO RITARDATO ---');
{
  const db = makeWorld();
  const [a, b] = addTwo(db); // current = a (primo in coda)
  const ua = unitOf(db, a.id)[0];
  const x0 = ua.x, y0 = ua.y;
  revealFor(db, b.id, x0, y0, 2); // (setup) Bob vede l'area di Alice: isolo la verifica dalla nebbia

  const nx = x0 + (x0 < 7 ? 1 : -1);
  G.performMove(db, a, ua.id, nx, y0); // Alice si muove (stato LIVE)
  const snapB = G.buildSnapshotForPlayer(db, b); // Bob NON e' corrente -> stato confermato
  const seen = snapB.units.find(u => u.id === ua.id);
  check(!!seen && seen.x === x0 && seen.y === y0, `durante il turno di Alice, Bob vede la posizione CONFERMATA (${x0},${y0}), non quella live (${nx},${y0})`);

  G.performEndTurn(db, a); // conferma: lo stato live diventa confermato
  const snapA2 = G.buildSnapshotForPlayer(db, a); // ora tocca a Bob: Alice vede il confermato
  const seen2 = snapA2.units.find(u => u.id === ua.id);
  check(!!seen2 && seen2.x === nx && seen2.y === y0, `dopo la conferma di fine turno la mossa e' visibile (${nx},${y0})`);

  // undo del turno corrente non tocca lo stato confermato (resta l'ultimo commit):
  // Bob fa una mossa, poi la annulla -> Alice (non corrente) continua a vedere
  // la posizione confermata precedente in entrambi i casi.
  const uB = unitOf(db, b.id)[0];
  revealFor(db, a.id, uB.x, uB.y, 2);
  const bx0 = uB.x;
  G.performMove(db, b, uB.id, bx0 + (bx0 < 7 ? 1 : -1), uB.y); // mossa live di Bob
  let snapA3 = G.buildSnapshotForPlayer(db, a);
  const seenLive = snapA3.units.find(u => u.id === uB.id);
  check(!!seenLive && seenLive.x === bx0, 'durante il turno di Bob, Alice NON vede la sua mossa in corso');
  G.performUndoAction(db, b); // Bob annulla: lo stato live torna indietro...
  snapA3 = G.buildSnapshotForPlayer(db, a); // ...e quello confermato resta intatto
  const seenUndo = snapA3.units.find(u => u.id === uB.id);
  check(!!seenUndo && seenUndo.x === bx0, 'dopo l\'undo di Bob lo stato confermato per Alice non cambia');
}

console.log(`\nLOGIC TEST: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
