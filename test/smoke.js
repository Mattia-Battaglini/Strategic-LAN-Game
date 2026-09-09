// ============================================================
// SMOKE TEST end-to-end (richiede il server gia' avviato su :3000)
// Verifica: lobby -> start -> snapshot con fog of war ->
// selezione unita' -> movimento validato dal server ->
// fine turno IN SOSPESO (oro non ancora incassato, azioni rifiutate)
// -> CANCEL end_turn (azioni di nuovo possibili) ->
// end_turn x2 giocatori -> COMMIT round 2 con incasso oro.
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

(async () => {
  // --- Alice entra in lobby ed e' host ---
  const a = io(URL);
  await waitEvent(a, 'connect');
  a.emit('join_game', { name: 'Alice' });
  let lobby = await waitEvent(a, 'lobby_update');
  console.log('Lobby dopo join Alice:', JSON.stringify(lobby));
  if (!lobby.canStart) throw new Error('Alice dovrebbe essere host (canStart=true)');

  // --- Bob entra in lobby (listener registrati PRIMA dello start: socket.io non bufferizza) ---
  const b = io(URL);
  await waitEvent(b, 'connect');
  b.emit('join_game', { name: 'Bob' });
  lobby = await waitEvent(a, 'lobby_update');
  console.log('Lobby dopo join Bob:', JSON.stringify(lobby));
  if (lobby.players.length !== 2) throw new Error('La lobby deve contenere 2 giocatori');

  const pGsB = waitEvent(b, 'game_started');
  const pStB = waitEvent(b, 'state_update'); // primo snapshot di Bob (allo start)

  // --- Host avvia la partita ---
  a.emit('start_game');
  const gsA = await waitEvent(a, 'game_started');
  let stA = await waitEvent(a, 'state_update');
  console.log(`Alice: mappa ${stA.game.map_size}x${stA.game.map_size}, caselle visibili ${stA.tiles.length}/256`);
  if (stA.tiles.length === 0) throw new Error('Alice non vede nessuna casella');
  if (stA.tiles.length >= 256) throw new Error('Fog of war rotto: Alice vede tutta la mappa');

  // --- Seleziona il proprio warrior e ottiene i movimenti dal server ---
  const myUnit = stA.units.find(u => u.owner_id === gsA.playerId);
  a.emit('select_unit', { unitId: myUnit.id });
  const sel = await waitEvent(a, 'selection_info');
  console.log('Caselle raggiungibili:', JSON.stringify(sel.reachable));
  if (sel.reachable.length === 0) throw new Error("Nessuna casella raggiungibile dallo spawn");

  // --- Movimento validato lato server ---
  const dest = sel.reachable[0];
  a.emit('move_unit', { unitId: myUnit.id, toX: dest.x, toY: dest.y });
  stA = await waitEvent(a, 'state_update');
  const moved = stA.units.find(u => u.id === myUnit.id);
  console.log(`Warrior spostato a (${moved.x},${moved.y}), has_moved=${moved.has_moved}`);
  if (moved.x !== dest.x || moved.y !== dest.y) throw new Error('Il movimento non e\' stato applicato');

  // --- FASE 1: fine turno IN SOSPESO — oro NON ancora incassato, azioni bloccate ---
  const goldBefore = stA.self.gold;
  a.emit('end_turn');
  stA = await waitEvent(a, 'state_update');
  console.log(`Dopo end_turn Alice: turn_ended=${stA.self.turn_ended}, can_act=${stA.self.can_act}, oro ${goldBefore} -> ${stA.self.gold}`);
  if (!stA.self.turn_ended) throw new Error('turn_ended dovrebbe essere true dopo end_turn');
  if (stA.self.can_act) throw new Error('can_act dovrebbe essere false dopo end_turn');
  if (stA.self.gold !== goldBefore) throw new Error("L'oro va incassato solo al commit del round");

  // --- Azione rifiutata durante la fase in sospeso ---
  a.emit('move_unit', { unitId: myUnit.id, toX: dest.x, toY: dest.y });
  const err = await waitEvent(a, 'error_msg');
  console.log('Azione rifiutata come atteso:', err);

  // --- CANCEL: Alice revoca la fine turno e puo' agire di nuovo ---
  a.emit('cancel_end_turn');
  stA = await waitEvent(a, 'state_update');
  console.log(`Dopo cancel_end_turn: turn_ended=${stA.self.turn_ended}, can_act=${stA.self.can_act}`);
  if (stA.self.turn_ended) throw new Error('turn_ended dovrebbe essere false dopo cancel');
  if (!stA.self.can_act) throw new Error('can_act dovrebbe tornare true dopo cancel');

  // --- Alice termina di nuovo; Bob termina -> COMMIT: round 2 + incasso oro ---
  a.emit('end_turn');
  stA = await waitEvent(a, 'state_update');
  b.emit('end_turn');
  stA = await waitEvent(a, 'state_update');
  const gsB = await pGsB;
  const bob = stA.players.find(p => p.id === gsB.playerId);
  console.log(`Commit round ${stA.game.round}: oro Alice ${goldBefore} -> ${stA.self.gold}, oro Bob -> ${bob ? bob.gold : '?'}`);
  if (stA.game.round !== 2) throw new Error('Il round non e\' avanzato a 2');
  if (stA.self.gold <= goldBefore) throw new Error("L'oro non e\' stato incassato al commit");
  if (!stA.self.can_act) throw new Error('can_act dovrebbe tornare true nel nuovo round');

  // --- Fog of war di Bob: vede solo l'area attorno al proprio spawn ---
  const stB = await pStB;
  console.log(`Bob (player ${gsB.playerId}): caselle visibili ${stB.tiles.length}/256`);
  if (stB.tiles.length >= 256) throw new Error('Fog of war rotto per Bob');

  console.log('\nSMOKE TEST: PASS ✅');
  process.exit(0);
})().catch(e => {
  console.error('\nSMOKE TEST FAIL ❌', e.message);
  process.exit(1);
});
