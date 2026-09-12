// ============================================================
// MAKE-SNAPSHOT — genera uno snapshot di gioco VALIDO senza socket:
// usa direttamente gameLogic (DB in-memory) per creare una partita,
// due player e qualche mossa, poi scrive test/_snapA.json.
// Non tocca il server live (sicuro da eseguire anche a partita in corso).
// Uso: node test/make-snapshot.js [mapSize]
// ============================================================
const fs = require('fs');
const path = require('path');
const { DB } = require('../server/db');
const G = require('../server/gameLogic');

const size = Number(process.argv[2]) || 16;
const db = new DB();
G.createGame(db, size, 424242, { density: { water: 0.38, mountain: 0.25, forest: 0.4 }, villages: 4 });
const a = G.addPlayer(db, 'MisuraA', 'valoria');
const b = G.addPlayer(db, 'MisuraB', 'nordmark');
G.finalizeTurnOrder(db);

// qualche mossa per avere unita' sparse e caselle esplorate extra
try {
  const ua = db.Units.all().find(u => u.owner_id === a.id);
  const sel = G.selectionInfo(db, a, ua.id);
  if (sel && sel.reachable.length) {
    const dest = sel.reachable[Math.floor(sel.reachable.length / 2)];
    G.performMove(db, a, ua.id, dest.x, dest.y);
  }
} catch (e) { /* setup best-effort */ }

const snapA = G.buildSnapshotForPlayer(db, a, { isHost: true });
fs.writeFileSync(path.join(__dirname, '_snapA.json'), JSON.stringify(snapA));
// vista nemica (per il replay B dell'harness)
const snapB = G.buildSnapshotForPlayer(db, b, { isHost: false });
fs.writeFileSync(path.join(__dirname, '_snapB.json'), JSON.stringify(snapB));
console.log(`snapshot scritto: ${snapA.tiles.length} tile visibili, ${snapA.units.length} unita', is_current=${snapA.self.is_current}`);
