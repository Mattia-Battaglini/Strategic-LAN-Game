// ============================================================
// ANALYZE-PLACEMENT — decodifica i dump PLACE: di icon-placement
// e riporta per ogni contesto lo scostamento icona/centro.
// Uso: node test/analyze-placement.js <dump.html> [etichetta]
// ============================================================
const fs = require('fs');
const file = process.argv[2];
const label = process.argv[3] || file;
if (!file) { console.error('uso: node analyze-placement.js <dump.html>'); process.exit(1); }
const h = fs.readFileSync(file, 'utf8');
const m = h.match(/<title>PLACE:(.*?)<\/title>/s);
if (!m) { console.log(label + ': nessun titolo PLACE (render non avvenuto?)'); process.exit(0); }
let raw;
try { raw = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); }
catch (e) { try { raw = JSON.parse(decodeURIComponent(escape(Buffer.from(m[1], 'base64').toString('binary')))); } catch (e2) { console.log(label + ': decode titolo fallito'); process.exit(1); } }
const errs = Array.isArray(raw) ? [] : (raw.errs || []);
const data = Array.isArray(raw) ? raw : (raw.icons || []);
if (errs.length) { console.log('⚠️ ERRORI JS nella pagina:'); for (const e of errs) console.log('   ' + e); }
console.log(`=== ${label} (${data.length} icone misurate) ===`);
let bad = 0;
for (const [ctx, dx, dy, sz] of data) {
  // dY: scostamento verticale dal centro del contenitore (>0 = in basso).
  // Nei contenitori icon-only e nei chip il centro E' la posizione attesa.
  // Nei bottoni con testo l'icona sta a sinistra per design (dX atteso), ma dY deve restare ~0.
  const flag = Math.abs(dy) > 2 ? '❌' : (Math.abs(dy) > 0.8 ? '⚠️' : '✅');
  if (flag === '❌') bad++;
  console.log(`${flag} ${ctx.padEnd(16)} dX=${String(dx).padStart(7)}  dY=${String(dy).padStart(7)}  size=${sz}`);
}
console.log(bad === 0 ? '✅ nessuna icona verticalmente sfasata' : `❌ ${bad} icone con scostamento verticale >2px`);
