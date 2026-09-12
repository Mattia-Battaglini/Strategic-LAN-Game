// ============================================================
// ICON AUDIT — verifica che ogni icona di assets.js sia DISEGNATA
// centrata nel suo viewBox 24x24 (con padding coerente). Se i path
// occupano una zona spostata della scatola, l'icona appare "messa male"
// in OGNI contesto. Per ogni definizione calcola:
//   - bbox dei punti endpoint dei path (M/L/H/V/C/Q/A)
//   - centro del contenuto vs centro viewBox (12,12)
//   - padding minimo sui 4 lati
// Uso: node test/icon-audit.js
// ============================================================
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(__dirname + '/../public/assets.js', 'utf8');
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src + '\n;globalThis.__ICONS = ICONS;', sandbox, { filename: 'assets.js' });
const ICONS = sandbox.__ICONS;

// parser minimale dei path SVG: estrae i punti endpoint (x,y) di ogni segmento
function pathPoints(d) {
  const pts = [];
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let i = 0, cmd = '', x = 0, y = 0;
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) { cmd = t; i++; }
    switch (cmd) {
      case 'M': x = num(); y = num(); pts.push([x, y]); cmd = 'L'; break; // dopo M implicito = L
      case 'm': x += num(); y += num(); pts.push([x, y]); cmd = 'l'; break;
      case 'L': x = num(); y = num(); pts.push([x, y]); break;
      case 'l': x += num(); y += num(); pts.push([x, y]); break;
      case 'H': x = num(); pts.push([x, y]); break;
      case 'h': x += num(); pts.push([x, y]); break;
      case 'V': y = num(); pts.push([x, y]); break;
      case 'v': y += num(); pts.push([x, y]); break;
      case 'C': for (let k = 0; k < 4; k++) num(); x = num(); y = num(); pts.push([x, y]); break; // cx1 cy1 cx2 cy2 x y
      case 'c': { for (let k = 0; k < 4; k++) num(); const dx = num(), dy = num(); x += dx; y += dy; pts.push([x, y]); } break;
      case 'S': for (let k = 0; k < 2; k++) num(); x = num(); y = num(); pts.push([x, y]); break; // smooth cubic: cx2 cy2 x y
      case 's': { for (let k = 0; k < 2; k++) num(); const dx = num(), dy = num(); x += dx; y += dy; pts.push([x, y]); } break;
      case 'Q': num(); num(); x = num(); y = num(); pts.push([x, y]); break; // cx cy x y
      case 'q': { const dx1 = num(), dy1 = num(); x += dx1; y += dy1; pts.push([x, y]); } break;
      case 'T': x = num(); y = num(); pts.push([x, y]); break; // smooth quadratic: x y
      case 't': { const dx = num(), dy = num(); x += dx; y += dy; pts.push([x, y]); } break;
      case 'A': num(); num(); num(); num(); num(); x = num(); y = num(); pts.push([x, y]); break;
      case 'a': { for (let k = 0; k < 5; k++) num(); x += num(); y += num(); pts.push([x, y]); } break; // rx ry rot laf sf dx dy
      case 'Z': case 'z': break;
      default: i++; // safety
    }
  }
  return pts;
}

let issues = 0;
console.log('icona'.padEnd(18) + 'bbox (minX,minY)-(maxX,maxY)'.padEnd(34) + 'centro contenuto'.padEnd(20) + 'offset da (12,12)'.padEnd(18) + 'padding lati');
for (const [name, d] of Object.entries(ICONS.DEFS)) {
  const pts = [];
  for (const p of d.paths) pts.push(...pathPoints(p.d));
  if (!pts.length) continue;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const dx = +(cx - 12).toFixed(2), dy = +(cy - 12).toFixed(2);
  const padL = minX, padT = minY, padR = 24 - maxX, padB = 24 - maxY;
  const off = Math.hypot(dx, dy);
  // soglie: offset centro > 1.5u o padding asimmetrico > 3u => icona "messa male"
  const bad = off > 1.5 || padL < 0.8 || padT < 0.8 || padR < 0.8 || padB < 0.8;
  if (bad) issues++;
  console.log(
    (bad ? '❌' : '✅') + ' ' + name.padEnd(17) +
    `(${minX.toFixed(1)},${minY.toFixed(1)})-(${maxX.toFixed(1)},${maxY.toFixed(1)})`.padEnd(34) +
    `(${cx.toFixed(1)},${cy.toFixed(1)})`.padEnd(20) +
    `${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy}`.padEnd(18) +
    `L${padL.toFixed(1)} T${padT.toFixed(1)} R${padR.toFixed(1)} B${padB.toFixed(1)}`
  );
}
console.log(`\n${issues === 0 ? '✅ tutte le icone sono centrate nel viewBox' : `❌ ${issues} icone fuori centro/padding`}`);
process.exit(issues ? 1 : 0);
