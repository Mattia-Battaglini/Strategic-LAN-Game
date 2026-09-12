// ============================================================
// SERVER — Express (statico) + Socket.io (realtime LAN)
// Il server e' l'unica fonte di verita': i client inviano
// "intenzioni" (move/attack/buy/end_turn/undo...) che vengono
// validate in gameLogic.js prima di essere applicate.
//
// SESSIONE: il primo arrivato in lobby e' l'HOST (puo' configurare
// la generazione del mondo, avviare la partita ed espellere i
// giocatori). Durante la partita l'host resta quello che ha
// avviato; kick/disconnessione aggiornano SUBITO la coda dei turni.
// ============================================================

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { DB } = require('./db');
const G = require('./gameLogic');

const PORT = process.env.PORT || 3000;
const MAP_SIZES = [12, 16, 20, 24]; // dimensioni mappa selezionabili pre-partita

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- GUIDA / ENCICLOPEDIA: dati statici per la wiki in gioco ----------
// Fonte di verita' unica = FACTIONS/TECHS/economia di gameLogic (niente
// duplicazione lato client): il client li scarica da qui al primo apertura.
app.get('/guide.json', (req, res) => {
  const factions = {};
  for (const [id, f] of Object.entries(G.FACTIONS))
    factions[id] = { name: f.name, color: f.color, desc: f.desc, startUnit: f.startUnit, units: f.units };
  res.json({
    factions,
    techs: G.TECHS,
    terrain: {
      plains:   { name: 'Pianura', fx: 'Terreno neutro: nessun bonus né malus.' },
      forest:   { name: 'Foresta', fx: '+1 DEF al difensore; gli attacchi a distanza (RNG > 1) fanno metà danno.' },
      mountain: { name: 'Montagna', fx: '+2 DEF al difensore che vi sta sopra; attraversabile solo da unità con trait montagna.' },
      water:    { name: 'Acqua', fx: 'Inattraversabile, salvo unità con trait nuoto.' },
    },
    economy: { baseIncome: G.BASE_INCOME, cityIncome: G.CITY_INCOME, villageIncome: G.VILLAGE_INCOME, startGold: 40, visionCityRadius: 3, tpPerRound: 1 },
  });
});

const server = http.createServer(app);
const io = new Server(server);

const db = new DB();      // "database" in-memory (sessione singola)
let gameActive = false;
let hostSocketId = null;  // socket dell'host FISSO durante la partita
const joined = new Map(); // socketId -> { name, faction }

// ---------- HELPERS LOBBY ----------
function isHostLobby(socketId) { return [...joined.keys()][0] === socketId; } // primo arrivato = host
function pushLobby() {
  const firstKey = [...joined.keys()][0];
  for (const [sid, j] of joined) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    s.emit('lobby_update', {
      players: [...joined.entries()].map(([id, o]) => ({
        socketId: id, name: o.name, faction: o.faction || null, isHost: id === firstKey,
      })),
      canStart: !gameActive && sid === firstKey, // solo l'host vede il pulsante Avvia + config
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
    if (s) s.emit('state_update', G.buildSnapshotForPlayer(db, p, { isHost: hostSocketId !== null && p.socket_id === hostSocketId }));
  }
}

// Se l'host viene rimosso dalla partita (kick/disconnessione), passa il ruolo
// al primo player vivo ancora connesso cosi' il menù Admin non resta orfano.
function maybeTransferHost(removedPlayer) {
  if (!gameActive || !removedPlayer || removedPlayer.socket_id !== hostSocketId) return;
  const next = db.Players.all().find(pl => pl.alive && pl.socket_id && io.sockets.sockets.get(pl.socket_id));
  hostSocketId = next ? next.socket_id : null;
  if (next) console.log(`[=] Ruolo host passato a ${next.name}`);
}

// ---------- CONNESSIONI ED EVENTI ----------
io.on('connection', (socket) => {
  console.log(`[+] Connesso: ${socket.id}`);

  // ----- LOBBY -----
  socket.on('join_game', ({ name }) => {
    if (gameActive) return socket.emit('error_msg', "Partita già in corso.");
    const n = String(name || '').trim().slice(0, 12);
    if (!n) return socket.emit('error_msg', 'Nome vuoto.');
    // re-join dello stesso socket: aggiorna il nome ma PRESERVA la fazione gia' scelta
    const prev = joined.get(socket.id);
    joined.set(socket.id, { name: n, faction: prev ? prev.faction : null });
    pushLobby();
  });

  // Selezione fazione pre-partita (ogni fazione e' unica per partita)
  socket.on('choose_faction', ({ factionId }) => {
    if (gameActive) return socket.emit('error_msg', "Partita già in corso: la fazione si sceglie prima dell'avvio.");
    const j = joined.get(socket.id);
    if (!j) return socket.emit('error_msg', 'Non sei in lobby.');
    if (!G.FACTIONS[factionId]) return socket.emit('error_msg', 'Fazione sconosciuta.');
    for (const [sid, o] of joined)
      if (sid !== socket.id && o.faction === factionId)
        return socket.emit('error_msg', `La fazione ${G.FACTIONS[factionId].name} è già scelta da un altro giocatore.`);
    j.faction = factionId;
    pushLobby();
  });

  // Avvio partita: solo l'host, con configurazione generazione mondo.
  // cfg: { mapSize, density:{water,mountain,forest}, villages }
  socket.on('start_game', (cfg) => {
    if (gameActive || !isHostLobby(socket.id)) return; // solo l'host avvia
    const players = [...joined.values()];
    if (players.length < 2) return socket.emit('error_msg', 'Servono almeno 2 giocatori per iniziare.');
    if (players.length > G.MAX_PLAYERS) return socket.emit('error_msg', `Massimo ${G.MAX_PLAYERS} giocatori: la lobby è piena.`);
    for (const j of players)
      if (!j.faction) return socket.emit('error_msg', `Il giocatore ${j.name} non ha scelto una fazione.`);
    const chosen = new Set(players.map(j => j.faction));
    if (chosen.size !== players.length) return socket.emit('error_msg', 'Fazioni duplicate: ogni giocatore deve scegliere una fazione diversa.');

    // Validazione/clamping della configurazione (il server decide sempre)
    cfg = cfg || {};
    const mapSize = MAP_SIZES.includes(+cfg.mapSize) ? +cfg.mapSize : 16;
    const clampPct = (v, lo, hi, dflt) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
    };
    const density = {
      water: clampPct(cfg.density && cfg.density.water, 0.05, 0.7, 0.38),
      mountain: clampPct(cfg.density && cfg.density.mountain, 0.05, 0.4, 0.25),
      forest: clampPct(cfg.density && cfg.density.forest, 0.05, 0.8, 0.4),
    };
    const villages = Math.max(0, Math.min(12, Number.isFinite(+cfg.villages) ? +cfg.villages : 4));

    // Generazione mappa: con densità estreme gli spawn potrebbero non bastare
    // oppure le basi finirebbero su isole separate; si riprova fino a 25 volte
    // con seed diversi prima di arrendersi.
    const baseSeed = Date.now() % 1000000;
    let g = null, seed = baseSeed;
    for (let attempt = 0; attempt < 25 && !g; attempt++) {
      db.reset();
      seed = (baseSeed + attempt * 7919) >>> 0;
      G.createGame(db, mapSize, seed, { density, villages });
      g = db.Game.all()[0];
      if (g.spawn_points.length < players.length || !G.mapIsPlayable(db)) g = null; // mappa non giocabile: riprova
    }
    if (!g) return socket.emit('error_msg', 'Mappa non giocabile con questa densità: riduci acqua/montagne o cambia dimensione.');

    for (const [sid, info] of joined) {
      const p = G.addPlayer(db, info.name, info.faction);
      if (!p) continue; // oltre 4 giocatori: non ammesso
      db.Players.update(p.id, { socket_id: sid });
      info.playerId = p.id;
    }
    G.finalizeTurnOrder(db); // coda turni = ordine di join; primo turno al primo arrivato
    gameActive = true;
    hostSocketId = socket.id; // l'host resta fisso per tutta la partita

    for (const p of db.Players.all()) {
      const s = io.sockets.sockets.get(p.socket_id);
      if (!s) continue;
      s.emit('game_started', { playerId: p.id });
      s.emit('state_update', G.buildSnapshotForPlayer(db, p, { isHost: p.socket_id === hostSocketId }));
    }
    console.log(`[=] Partita avviata con ${db.Players.all().length} giocatori (mappa ${mapSize}, seed ${seed})`);
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

  socket.on('buy_unit', ({ pointId, type }) => {
    const player = myPlayer(socket);
    if (!player) return;
    const res = G.performBuyUnit(db, player, pointId, type);
    if (!res.ok) return socket.emit('error_msg', res.error);
    broadcastState();
  });

  // Acquisto tecnologia (albero tech della propria fazione, consuma TP)
  socket.on('buy_tech', ({ techId }) => {
    const player = myPlayer(socket);
    if (!player) return;
    const res = G.performBuyTech(db, player, techId);
    if (!res.ok) return socket.emit('error_msg', res.error);
    broadcastState();
  });

  // ANNULLA MOSSA: ripristina l'ultima azione del turno corrente (reversibile
  // finche' il player non conferma la fine turno).
  socket.on('undo_action', () => {
    const player = myPlayer(socket);
    if (!player) return;
    const res = G.performUndoAction(db, player);
    if (!res.ok) return socket.emit('error_msg', res.error);
    broadcastState();
  });

  // FINE TURNO CONFERMATA: il turno passa subito al giocatore successivo.
  socket.on('end_turn', () => {
    const player = myPlayer(socket);
    if (!player) return;
    const res = G.performEndTurn(db, player);
    if (!res.ok) return socket.emit('error_msg', res.error);
    broadcastState();
  });

  // ----- ADMIN (solo host): espelli dalla stanza o dalla partita in corso -----
  socket.on('kick_player', ({ target }) => {
    if (!gameActive) {
      // In lobby: l'host espelle un giocatore dalla stanza
      if (!isHostLobby(socket.id)) return socket.emit('error_msg', "Solo l'host può espellere giocatori.");
      const t = joined.get(target);
      if (!t || target === socket.id) return;
      joined.delete(target);
      pushLobby();
      io.sockets.sockets.get(target)?.emit('kicked', "Sei stato espulso dalla stanza dall'host.");
      console.log(`[!] ${t.name} espulso dalla lobby dall'host`);
    } else {
      // In partita: l'host elimina un player; la coda dei turni si aggiorna subito
      if (socket.id !== hostSocketId) return socket.emit('error_msg', "Solo l'host può espellere giocatori.");
      const p = db.Players.get(Number(target));
      if (!p || !p.alive) return;
      if (p.socket_id === socket.id) return; // l'host non puo' cacciare se stesso
      const info = G.removePlayerFromGame(db, p.id, 'espulso');
      maybeTransferHost(p);
      broadcastState();
      io.emit('game_log', `🛡️ ${info.name} è stato espulso dall'host.`);
      // avviso diretto al player espulso (resta come spettatore)
      io.sockets.sockets.get(p.socket_id)?.emit('kicked_from_game', "Sei stato espulso dalla partita dall'host.");
      console.log(`[!] ${info.name} espulso dalla partita dall'host`);
    }
  });

  // ----- RESET (torna in lobby) -----
  socket.on('reset_game', () => {
    // In partita: solo l'host puo' azzerare; a gioco finito chiunque puo' ricominciare.
    if (gameActive && hostSocketId !== null && socket.id !== hostSocketId) {
      const g = db.Game.all()[0];
      if (!g || g.phase === 'playing') return socket.emit('error_msg', "Solo l'host può azzerare la partita in corso.");
    }
    db.reset();
    G.clearUndo();
    gameActive = false;
    hostSocketId = null;
    joined.clear();
    io.emit('back_to_lobby');
    console.log('[=] Partita azzerata, ritorno in lobby.');
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnesso: ${socket.id}`);
    if (!gameActive) {
      joined.delete(socket.id); // libera anche la fazione scelta
      pushLobby();
      return;
    }
    // In partita: il player disconnesso viene eliminato SUBITO e la coda dei
    // turni si aggiorna cosi' la partita non resta bloccata in attesa di lui.
    const p = db.Players.all().find(pl => pl.socket_id === socket.id && pl.alive);
    if (p) {
      const info = G.removePlayerFromGame(db, p.id, 'disconnesso');
      // info e' null se la rimozione non ha senso (es. partita gia' finita):
      // in quel caso non c'e' nulla da aggiornare né da annunciare.
      if (!info) return;
      maybeTransferHost(p);
      broadcastState();
      io.emit('game_log', `⚠️ ${info.name} si è disconnesso ed è stato eliminato.`);
      console.log(`[!] ${info.name} disconnesso: eliminato, coda turni aggiornata`);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 4X Lite LAN server su http://localhost:${PORT}`);
  console.log('   Dalla LAN usa l\'IP della macchina host, es. http://192.168.1.50:3000');
});
