// ============================================================
// ICON PREVIEW — genera test/icon-preview.html: una pagina che
// carica assets.js e disegna OGNI icona del dizionario in un <g>,
// poi misura il bbox REALE dei contenuti (curve incluse) con
// getBBox() e pubblica i risultati in <title> (base64).
// Uso: node test/icon-preview.js  ->  dump-dom headless
// ============================================================
const fs = require('fs');
const path = require('path');

const page = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body{background:#111;margin:0}</style></head>
<body>
<div id="host"></div>
<script src="../public/assets.js"></script>
<script>
(function () {
  const host = document.getElementById('host');
  const out = [];
  for (const name of Object.keys(ICONS.DEFS)) {
    // svg 24x24 con i path dentro un <g>: getBBox() sul g = bbox reale dei contenuti
    const d = ICONS.DEFS[name];
    let inner = '';
    for (const p of d.paths) {
      if (p.f === true) inner += '<path d="' + p.d + '" fill="currentColor" stroke="none"/>';
      else inner += '<path d="' + p.d + '" fill="none" stroke="currentColor" stroke-width="' + (p.w || 2) + '"/>';
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '24'); svg.setAttribute('height', '24'); svg.setAttribute('viewBox', '0 0 24 24');
    svg.style.position = 'absolute'; // non influenza il layout
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.innerHTML = inner;
    svg.appendChild(g);
    host.appendChild(svg);
    try {
      const b = g.getBBox();
      out.push([name, +b.x.toFixed(2), +b.y.toFixed(2), +(b.x + b.width).toFixed(2), +(b.y + b.height).toFixed(2)]);
    } catch (e) { out.push([name, null]); }
  }
  document.title = 'ICONS:' + btoa(JSON.stringify(out));
})();
</script>
</body></html>`;

fs.writeFileSync(path.join(__dirname, 'icon-preview.html'), page);
console.log('preview icone scritta: test/icon-preview.html');
