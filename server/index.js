// ============================================================
// SERVER — Express (statico) + Socket.io (realtime LAN)
// Il server e' l'unica fonte di verita': i client inviano
// "intenzioni" (move/attack/buy/end_turn) che vengono validate
// in gameLogic.js prima di essere applicate.
// ============================================================

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { DB } = require('./db');
const G = require('./gameLogic');

const PORT = process.env.PORT || 3000;
const MAP_SIZE = 16; // griglia 16x16 (configurabile qui)

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
const server = http.createServer(app);
const io = new Server(server);

const db = new DB();      // "database" in-memory (sessione singola)
let gameActive = false;
const joined = new Map(); // socketId -> { name, playerId }

// ---------- HELPERS LOBBY ----------
function isHost(socketId) { return [...joined.keys()][0] === socketId; } // primo arrivato = host
function pushLobby() {
  for (const [sid] of joined) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    s.emit('lobby_update', {
      players: [...joined.values()].map(j => j.name),
      canStart: !gameActive && isHost(sid), // solo l'host vede il pulsante Avvia
    });
  }
}
function myPlayer(socket) {
  const j = joined.get(socket.id);
  return (j && j.playerId) ? db.Players.get(j.playerId) : null;
}
// Invia a OGNI player il suo snapshot filtrato dalla nebbia di guerra
function broadcastState() {
  for (const p of db.Players.all()) {
    const s = io.sockets.sockets.get(p.socket_id);
    if (s) s.emit('state_update', G.buildSnapshotForPlayer(db, p));
  }
}

// ---------- CONNESSIONI ED EVENTI ----------
io.on('connection', (socket) => {
  console.log(`[+] Connesso: ${socket.id}`);

  // ----- LOBBY -----
  socket.on('join_game', ({ name }) => {
    if (gameActive) return socket.emit('error_msg', 'Partita gia\' in corso.');
    const n = String(name || '').trim().slice(0, 12);
    if (!n) return socket.emit('error_msg', 'Nome vuoto.');
    joined.set(socket.id, { name: n });
    pushLobby();
  });

  socket.on('start_game', () => {
    if (gameActive || !isHost(socket.id)) return; // solo l'host avvia
    const seed = Date.now() % 1000000;
    G.createGame(db, MAP_SIZE, seed);
    for (const [sid, info] of joined) {
      const p = G.addPlayer(db, info.name);
      if (!p) continue; // oltre 4 giocatori: non ammesso
      db.Players.update(p.id, { socket_id: sid });
      info.playerId = p.id;
    }
    gameActive = true;
    for (const p of db.Players.all()) {
      const s = io.sockets.sockets.get(p.socket_id);
      if (!s) continue;
      s.emit('game_started', { playerId: p.id });
      s.emit('state_update', G.buildSnapshotForPlayer(db, p));
    }
    console.log(`[=] Partita avviata con ${db.Players.all().length} giocatori (seed ${seed})`);
  });

  // ----- GIOCO (tutte le azioni validate in gameLogic) -----
  socket.on('select_unit', ({ unitId }) => {
    const player = myPlayer(socket);
    if (!player) return;
    socket.emit('selection_info', G.selectionInfo(db, player, unitId));
  });

  socket.on('move_unit', ({ unitId, toX, toY }) => {
    const player = myPlayer(socket);
    if (!player) return;
    const res = G.performMove(db, player, unitId, toX, toY);
    if (!res.ok) return socket.emit('error_msg', res.error);
    broadcastState();
  });

  socket.on('attack_unit', ({ unitId, targetX, targetY }) => {
    const player = myPlayer(socket);
    if (!player) return;
    const res = G.performAttack(db, player, unitId, targetX, targetY);
    if (!res.ok) return socket.emit('error_msg', res.error);
    broadcastState();
  });

  socket.on('buy_unit', ({ cityId, type }) => {
    const player = myPlayer(socket);
    if (!player) return;
    const res = G.performBuyUnit(db, player, cityId, type);
    if (!res.ok) return socket.emit('error_msg', res.error);
    broadcastState();
  });

  socket.on('end_turn', () => {
    const player = myPlayer(socket);
    if (!player) return;
    const res = G.performEndTurn(db, player); // fase 1: fine turno in sospeso (reversibile)
    if (!res.ok) return socket.emit('error_msg', res.error);
    broadcastState();
  });

  socket.on('cancel_end_turn', () => {
    const player = myPlayer(socket);
    if (!player) return;
    const res = G.performCancelEndTurn(db, player); // revoca: il player puo' agire di nuovo
    if (!res.ok) return socket.emit('error_msg', res.error);
    broadcastState();
  });

  // ----- RESET (torna in lobby) -----
  socket.on('reset_game', () => {
    db.reset();
    gameActive = false;
    joined.clear();
    io.emit('back_to_lobby');
    console.log('[=] Partita azzerata, ritorno in lobby.');
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnesso: ${socket.id}`);
    if (!gameActive) { joined.delete(socket.id); pushLobby(); }
    // In partita il player resta nello stato (future work: auto-pass/timeout).
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 4X Lite LAN server su http://localhost:${PORT}`);
  console.log('   Dalla LAN usa l\'IP della macchina host, es. http://192.168.1.50:3000');
});
