// ============================================================
// ANALYZE-PROBES — decodifica i pixel campionati dal preview headless
// e li confronta con le attese derivate dallo snapshot:
//   - centro tile esplorato  -> colore del biome (famiglia)
//   - angolo interno tile    -> stesso biome (la base copre la cella)
//   - centro unita'          -> colore fazione (o icona scura al centro)
//   - gutter sx/su           -> acciaio scuro, MAI terreno
// Uso: node test/analyze-probes.js <dom.html>
// ============================================================
const fs = require('fs');

const domFile = process.argv[2];
if (!domFile) { console.error('uso: node analyze-probes.js <dom.html>'); process.exit(1); }
const html = fs.readFileSync(domFile, 'utf8');
const m = html.match(/<title>PROBES:(.*?)<\/title>/s);
if (!m) { console.error('Nessun titolo PROBES nel dump (render non avvenuto?)'); process.exit(1); }
// il titolo puo' contenere "|HB:n" (heartbeat dei test interazioni): lo scarto prima del decode
const data = JSON.parse(Buffer.from(m[1].split('|')[0], 'base64').toString('utf8'));
const snap = JSON.parse(fs.readFileSync(__dirname + '/_snapA.json', 'utf8'));

console.log(`canvas ${data.canvasW}x${data.canvasH}, cssBox=${data.cssW}x${data.cssH}`);
// il box CSS include i bordi (1px per lato): contenuto = box - 2
const contentW = data.cssW - 2, contentH = data.cssH - 2;
if (Math.abs(contentW - data.canvasW) > 1.5 || Math.abs(contentH - data.canvasH) > 1.5) {
  const expectedH = contentW * data.canvasH / data.canvasW;
  console.log(`⚠️  CANVAS SCALATO IN CSS: contenuto ${contentW}x${contentH} != backing ${data.canvasW}x${data.canvasH}` + (Math.abs(contentH - expectedH) > 2 ? ` — ASPECT RATIO ROTTO (altezza attesa ${expectedH.toFixed(1)})` : ' (scala uniforme, ok)'));
}

const size = snap.game.map_size;
const px = Math.floor(640 / size);
const LW = 28, LH = 20;

// famiglie colore attese per biome (dai gradienti reali di drawTile)
function familyOf(r, g, b) {
  if (r > 230 && g > 230 && b > 230) return 'white'; // highlight/onde/snowcap: accettato ovunque
  if (b - r > 50 && b >= g + 20) return 'water';     // dominanza blu forte (#3f97ea..#1e5cab, anche scurita dal bordo nebbia)
  if (g - b > 30 && g >= r * 0.9) return 'green';    // plains/forest/chiome (anche scure)
  if (r > g && g >= b && r < 200 && r - b < 90) return 'brown'; // tronco albero
  if (Math.abs(r - g) < 45 && Math.abs(g - b) < 45 && b >= r - 10) return 'gray'; // pietra montagna
  return `rgb(${r},${g},${b})`;
}
const biomeFamily = { water: ['water', 'white'], plains: ['green', 'white'], forest: ['green', 'brown', 'white'], mountain: ['gray', 'white'] };

let fails = 0;
function bad(msg) { fails++; if (fails <= 30) console.error('  ❌ ' + msg); }

// tile con struttura: la probe centra le mura/legno, non il biome -> si saltano
const hasStructure = (t) => snap.cities.some(c => c.tile_id === t.id) || snap.villages.some(v => v.tile_id === t.id);

// 1) centri tile (salta i tile occupati da unita' o strutture: la probe colpisce il corpo/edificio)
for (const t of snap.tiles) {
  if (snap.units.some(u => u.x === t.x && u.y === t.y)) continue;
  if (hasStructure(t)) continue;
  const ex = LW + t.x * px + px / 2, ey = LH + t.y * px + px / 2;
  const p = data.probes.find(p => Math.abs(p[0] - ex) < 0.6 && Math.abs(p[1] - ey) < 0.6);
  if (!p) { bad(`tile ${t.x},${t.y}: probe centro mancante`); continue; }
  const fam = familyOf(p[2], p[3], p[4]);
  if (!biomeFamily[t.biome].includes(fam)) bad(`tile ${t.x},${t.y} (${t.biome}): pixel centrale rgb(${p[2]},${p[3]},${p[4]}) famiglia "${fam}" inattesa`);
}

// 2) angoli interni tile (X+3,Y+3): stessa famiglia biome (salta unita' e strutture)
for (const t of snap.tiles) {
  if (snap.units.some(u => u.x === t.x && u.y === t.y)) continue;
  if (hasStructure(t)) continue;
  const ex = LW + t.x * px + 3, ey = LH + t.y * px + 3;
  const p = data.probes.find(p => Math.abs(p[0] - ex) < 0.6 && Math.abs(p[1] - ey) < 0.6);
  if (!p) continue;
  const fam = familyOf(p[2], p[3], p[4]);
  if (!biomeFamily[t.biome].includes(fam)) bad(`tile ${t.x},${t.y} (${t.biome}): angolo rgb(${p[2]},${p[3]},${p[4]}) famiglia "${fam}" inattesa`);
}

// 3) centri unita': colore fazione (o scuro per l'icona al centro)
for (const u of snap.units) {
  const pl = snap.players.find(p => p.id === u.owner_id);
  const ex = LW + u.x * px + px / 2, ey = LH + u.y * px + px / 2;
  const p = data.probes.find(p => Math.abs(p[0] - ex) < 0.6 && Math.abs(p[1] - ey) < 0.6);
  if (!p) { bad(`unita' ${u.type}: probe centro mancante`); continue; }
  const [r, g, b] = [p[2], p[3], p[4]];
  const dark = r + g + b < 150; // icona di classe scura al centro: accettabile
  if (!dark && Math.abs(r - parseInt(pl.color.slice(1, 3), 16)) > 90) bad(`unita' ${u.type} @${u.x},${u.y}: pixel rgb(${r},${g},${b}) != fazione ${pl.color}`);
}

// 4) gutter: acciaio scuro (blu-grigio scuro, mai verde/terreno)
for (const p of data.probes) {
  const inLeftGutter = Math.abs(p[0] - LW / 2) < 1;      // x=14
  const inTopGutter = Math.abs(p[1] - LH / 2) < 1;       // y=10
  if (!inLeftGutter && !inTopGutter) continue;
  const [r, g, b] = [p[2], p[3], p[4]];
  const isTerrainGreen = g > r + 25 && g > 90 && b < 140;
  if (isTerrainGreen) bad(`GUTTER CONTAMINATO: (${p[0]},${p[1]}) rgb(${r},${g},${b}) sembra terreno!`);
}

console.log(fails === 0 ? '\n✅ ANALISI PIXEL: tutte le attese rispettate' : `\n❌ ${fails} violazioni pixel`);
process.exit(fails ? 1 : 0);
