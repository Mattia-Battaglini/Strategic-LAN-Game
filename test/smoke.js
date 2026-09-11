// ============================================================
// SMOKE TEST end-to-end (richiede il server gia' avviato su :3000)
// Verifica: lobby -> fazioni -> start con config generazione mondo ->
// turni SEQUENZIALI (Alice prima, Bob in attesa e bloccato) ->
// movimento validato dal server -> UNDO mossa (posizione ripristinata) ->
// end_turn Alice (turno passa a Bob, undo non piu' possibile) ->
// end_turn Bob -> COMMIT round 2 con incasso oro -> fog of war ->
// KICK di Bob DURANTE il suo turno: coda aggiornata subito, partita
// non bloccata, vince l'ultimo vivo.
//
// NOTA: socket.io NON bufferizza gli eventi per listener non ancora
// registrati: ogni wait deve essere registrato PRIMA dell'emit che
// genera l'evento atteso (altrimenti l'evento viene perso).
// Uso: npm run smoke
// ============================================================

const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://127.0.0.1:3000';

function waitEvent(sock, ev, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout in attesa di "${ev}"`)), ms);
    sock.once(ev, (d) => { clearTimeout(t); resolve(d); });
  });
}

// Aspetta un evento che soddisfa il predicato: gli eventi "vecchi" o
// intermedi vengono consumati e scartati (robusto a race di delivery).
function waitFor(sock, ev, pred, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(ev, onEv); reject(new Error(`timeout in attesa di "${ev}" (predicato non soddisfatto)`)); }, ms);
    function onEv(d) {
      if (!pred || pred(d)) { clearTimeout(t); sock.off(ev, onEv); resolve(d); }
    }
    sock.on(ev, onEv);
  });
}

(async () => {
  // --- Alice entra in lobby ed e' host ---
  const a = io(URL);
  await waitEvent(a, 'connect');
  a.emit('join_game', { name: 'Alice' });
  let lobby = await waitFor(a, 'lobby_update', l => l.canStart && l.players.length === 1);
  console.log('Lobby dopo join Alice:', JSON.stringify(lobby));
  if (!lobby.canStart) throw new Error('Alice dovrebbe essere host (canStart=true)');

  // --- Bob entra in lobby ---
  const b = io(URL);
  await waitEvent(b, 'connect');
  b.emit('join_game', { name: 'Bob' });
  lobby = await waitFor(a, 'lobby_update', l => l.players.length === 2);
  console.log('Lobby dopo join Bob:', JSON.stringify(lobby));
  if (lobby.players.length !== 2) throw new Error('La lobby deve contenere 2 giocatori');

  // --- Selezione fazioni pre-partita (una per giocatore, uniche) ---
  a.emit('choose_faction', { factionId: 'valoria' });
  await waitFor(a, 'lobby_update', l => l.players.find(p => p.name === 'Alice')?.faction === 'valoria');
  b.emit('choose_faction', { factionId: 'nordmark' });
  lobby = await waitFor(b, 'lobby_update', l => l.players.find(p => p.name === 'Bob')?.faction === 'nordmark');
  console.log('Lobby con fazioni:', JSON.stringify(lobby.players));
  const facA = lobby.players.find(p => p.name === 'Alice').faction;
  const facB = lobby.players.find(p => p.name === 'Bob').faction;
  if (facA !== 'valoria' || facB !== 'nordmark') throw new Error('Le fazioni non sono state registrate');

  // Bob prova a prendere la fazione gia' scelta da Alice -> rifiuto
  b.emit('choose_faction', { factionId: 'valoria' });
  const dupErr = await waitFor(b, 'error_msg', m => String(m).includes('già scelta'));
  console.log('Fazione duplicata rifiutata come atteso:', dupErr);

  // --- Host avvia la partita con configurazione generazione mondo ---
  // Tutti i wait registrati PRIMA dell'emit (socket.io non bufferizza)
  const pGsA = waitEvent(a, 'game_started');
  const pGsB = waitEvent(b, 'game_started');
  const pStA0 = waitFor(a, 'state_update', s => s.game.map_size === 16);
  const pStB0 = waitFor(b, 'state_update', s => s.game.current_player_id !== null);
  a.emit('start_game', { mapSize: 16, density: { water: 0.38, mountain: 0.25, forest: 0.4 }, villages: 3 });
  const gsA = await pGsA;
  let stA = await pStA0;
  console.log(`Alice: mappa ${stA.game.map_size}x${stA.game.map_size}, caselle visibili ${stA.tiles.length}/256`);
  if (stA.game.map_size !== 16) throw new Error('La dimensione mappa configurata non e\' stata applicata');
  if (!Array.isArray(stA.villages)) throw new Error('Lo snapshot deve contenere i villaggi');
  if (stA.tiles.length === 0) throw new Error('Alice non vede nessuna casella');
  if (stA.tiles.length >= 256) throw new Error('Fog of war rotto: Alice vede tutta la mappa');

  // --- Fazioni applicate ai player + roster proprio nel catalogo ---
  const me = stA.players.find(p => p.id === gsA.playerId);
  if (me.faction !== 'valoria') throw new Error("La fazione di Alice non e' valoria");
  for (const key of Object.keys(stA.catalog))
    if (!key.startsWith('valoria_')) throw new Error('Il catalogo deve contenere solo unita\' della fazione del player');

  // --- TURNI SEQUENZIALI: Alice gioca per prima, Bob e' in attesa ---
  const gsB = await pGsB;
  let stB = await pStB0;
  if (stA.game.current_player_id !== gsA.playerId) throw new Error('Il primo turno deve essere di Alice (prima in lobby)');
  if (!stA.self.is_current || !stA.self.can_act) throw new Error("Alice dovrebbe poter agire per prima");
  if (stB.self.is_current || stB.self.can_act) throw new Error('Bob non deve poter agire durante il turno di Alice');

  // Bob prova a muovere -> rifiutato dal server
  const bobUnit = stB.units.find(u => u.owner_id === gsB.playerId);
  b.emit('move_unit', { unitId: bobUnit.id, toX: bobUnit.x + 1, toY: bobUnit.y });
  const turnErr = await waitFor(b, 'error_msg', m => String(m).includes('turno'));
  console.log("Azione di Bob rifiutata come atteso:", turnErr);

  // --- Alice seleziona il proprio warrior e ottiene i movimenti dal server ---
  const myUnit = stA.units.find(u => u.owner_id === gsA.playerId);
  a.emit('select_unit', { unitId: myUnit.id });
  const sel = await waitEvent(a, 'selection_info');
  console.log('Caselle raggiungibili:', JSON.stringify(sel.reachable));
  if (sel.reachable.length === 0) throw new Error("Nessuna casella raggiungibile dallo spawn");

  // --- Movimento validato lato server ---
  const dest = sel.reachable[0];
  a.emit('move_unit', { unitId: myUnit.id, toX: dest.x, toY: dest.y });
  stA = await waitFor(a, 'state_update', s => {
    const u = s.units.find(u => u.id === myUnit.id);
    return u && u.x === dest.x && u.y === dest.y;
  });
  let moved = stA.units.find(u => u.id === myUnit.id);
  console.log(`Warrior spostato a (${moved.x},${moved.y}), has_moved=${moved.has_moved}, undo_count=${stA.self.undo_count}`);
  if (moved.x !== dest.x || moved.y !== dest.y) throw new Error('Il movimento non e\' stato applicato');
  if (stA.self.undo_count < 1) throw new Error("Dopo una mossa lo stack undo deve essere >= 1");

  // --- UNDO: Alice annulla la mossa, la posizione torna allo spawn ---
  a.emit('undo_action');
  stA = await waitFor(a, 'state_update', s => {
    const u = s.units.find(u => u.id === myUnit.id);
    return u && u.x === myUnit.x && u.y === myUnit.y;
  });
  moved = stA.units.find(u => u.id === myUnit.id);
  console.log(`Dopo undo: unita' a (${moved.x},${moved.y}), has_moved=${moved.has_moved}, undo_count=${stA.self.undo_count}`);
  if (moved.x !== myUnit.x || moved.y !== myUnit.y) throw new Error("L'undo non ha ripristinato la posizione originale");
  if (moved.has_moved) throw new Error("Dopo l'undo l'unita' deve essere di nuovo pronta ad agire");

  // --- Alice conferma il fine turno: il turno passa SUBITO a Bob ---
  const goldBefore = stA.self.gold;
  const pB2 = waitFor(b, 'state_update', s => s.self.is_current && s.self.can_act);
  const pA2 = waitFor(a, 'state_update', s => s.game.current_player_id === gsB.playerId);
  a.emit('end_turn');
  stB = await pB2;
  stA = await pA2;
  console.log(`Dopo end_turn Alice: current=${stA.game.current_player_id}, round=${stA.game.round}, oro ${goldBefore} -> ${stA.self.gold}`);
  if (stA.game.current_player_id !== gsB.playerId) throw new Error('Il turno deve essere passato a Bob');
  if (stA.self.can_act || stA.self.is_current) throw new Error("Alice non deve piu' poter agire");
  if (!stB.self.is_current || !stB.self.can_act) throw new Error('Bob deve poter agire ora');
  if (stA.game.round !== 1) throw new Error("Il round non deve avanzare finche' tutti non hanno giocato");
  if (stA.self.gold !== goldBefore) throw new Error("L'oro va incassato solo al commit del round");

  // --- Undo BLOCCATO: Alice non puo' piu' annullare le mosse del turno passato ---
  a.emit('undo_action');
  const undoErr = await waitFor(a, 'error_msg', m => String(m).includes('turno'));
  console.log("Undo post-fine-turno rifiutato come atteso:", undoErr);

  // --- Bob termina -> COMMIT: round 2 + incasso oro per tutti ---
  const pA3 = waitFor(a, 'state_update', s => s.game.round === 2);
  const pB3 = waitFor(b, 'state_update', s => s.game.round === 2);
  b.emit('end_turn');
  stA = await pA3;
  stB = await pB3;
  console.log(`Commit round ${stA.game.round}: oro Alice ${goldBefore} -> ${stA.self.gold}, round=${stA.game.round}`);
  if (stA.game.round !== 2) throw new Error('Il round non e\' avanzato a 2');
  if (stA.self.gold <= goldBefore) throw new Error("L'oro non e\' stato incassato al commit");
  if (!stA.self.can_act || !stA.self.is_current) throw new Error('Al nuovo round il turno torna ad Alice');

  // --- Fog of war di Bob: vede solo l'area attorno al proprio spawn ---
  console.log(`Bob (player ${gsB.playerId}): caselle visibili ${stB.tiles.length}/256`);
  if (stB.tiles.length >= 256) throw new Error('Fog of war rotto per Bob');

  // ============================================================
  // SCENARIO KICK: Alice finisce il turno (e' di Bob), l'host espelle
  // Bob DURANTE il suo turno -> la coda si aggiorna subito, la partita
  // non resta bloccata e vince l'ultimo vivo.
  // ============================================================
  const pA4 = waitFor(a, 'state_update', s => s.game.current_player_id === gsB.playerId);
  a.emit('end_turn'); // ora tocca di nuovo a Bob (round 2)
  stA = await pA4;
  if (stA.game.current_player_id !== gsB.playerId) throw new Error('Il turno deve essere di Bob prima del kick');

  const pA5 = waitFor(a, 'state_update', s => s.game.phase === 'finished');
  a.emit('kick_player', { target: gsB.playerId }); // solo l'host puo' espellere
  stA = await pA5;
  console.log(`Dopo kick di Bob: phase=${stA.game.phase}, winner_id=${stA.game.winner_id}, current=${stA.game.current_player_id}`);
  const bobAfter = stA.players.find(p => p.id === gsB.playerId);
  if (bobAfter.alive) throw new Error('Bob deve essere eliminato dopo il kick');
  if (stA.game.phase !== 'finished') throw new Error("Con un solo vivo la partita deve finire subito");
  if (stA.game.winner_id !== gsA.playerId) throw new Error('Alice deve essere la vincitrice');

  // Un non-host (Bob) non puo' espellere: il server rifiuta con un errore
  b.emit('kick_player', { target: gsA.playerId });
  const kickErr = await waitFor(b, 'error_msg', m => String(m).includes('host'));
  console.log('Kick non-host rifiutato come atteso:', kickErr);

  a.close(); b.close();
  console.log('\nSMOKE TEST: PASS ✅');
  process.exit(0);
})().catch(e => {
  console.error('\nSMOKE TEST FAIL ❌', e.message);
  process.exit(1);
});
