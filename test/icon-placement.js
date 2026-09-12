// ============================================================
// ICON PLACEMENT — misura nel browser reale lo scostamento di OGNI
// svg.ic rispetto al centro del box contenuto (padding esclusi) del
// suo contenitore. Genera due pagine: lobby (icone statiche) e gioco
// (icone dinamiche da snapshot + click simulati su unita'/citta' per
// far apparire inspector e pannello addestramento).
// Uso: node test/icon-placement.js [snapshot.json]
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const snapFile = process.argv[2];
const hasSnap = !!snapFile && fs.existsSync(snapFile);
const snap = hasSnap ? JSON.parse(fs.readFileSync(snapFile, 'utf8')) : null;

// Mock socket (risponde a select_unit per far partire l'inspector) + click
// simulati + probe di misurazione di ogni svg.ic.
const mock = `
<script>
(function () {
  window.__errs = [];
  window.addEventListener('error', function (e) { window.__errs.push(String(e.message) + ' @' + (e.filename || '') + ':' + e.lineno); });
  const SNAP = ${snap ? JSON.stringify(snap) : 'null'};
  const handlers = {};
  window.io = function () {
    return {
      id: 'mock-measure',
      on(evt, cb) {
        handlers[evt] = cb;
        if (evt === 'connect') setTimeout(() => cb(), 0);
        else if (SNAP && evt === 'game_started') setTimeout(() => cb({ playerId: SNAP.self.id }), 10);
        else if (SNAP && evt === 'state_update') setTimeout(() => cb(SNAP), 30);
      },
      emit(evt, data) {
        // risposta sintetica a select_unit: fa partire l'inspector con le stat
        if (evt === 'select_unit' && SNAP && handlers['selection_info']) {
          const u = SNAP.units.find(u => u.id === data.unitId);
          if (u) setTimeout(() => handlers['selection_info']({ reachable: [], targets: [], stats: SNAP.unitTypes[u.type] }), 20);
        }
      }
    };
  };

  function clickAt(cssX, cssY) {
    const c = document.getElementById('board');
    const r = c.getBoundingClientRect();
    for (const type of ['mousedown', 'mouseup', 'click'])
      c.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r.left + cssX, clientY: r.top + cssY }));
  }

  // click simulati per far apparire inspector/pannello addestramento (solo in gioco)
  if (SNAP) {
    const size = SNAP.game.map_size, px = Math.floor(640 / size), LW = 28, LH = 20;
    setTimeout(function () {
      const myU = SNAP.units.find(u => u.owner_id === SNAP.self.id);
      if (myU) clickAt(LW + myU.x * px + px / 2, LH + myU.y * px + px / 2); // -> inspector unita'
    }, 400);
    setTimeout(function () {
      const myC = SNAP.cities.find(c => c.owner_id === SNAP.self.id);
      if (myC) {
        const t = SNAP.tiles.find(t => t.id === myC.tile_id);
        if (t) clickAt(LW + t.x * px + px / 2, LH + t.y * px + px / 2); // -> inspector citta' + pannello addestramento
      }
    }, 800);
  }

  // Dopo tutto: per ogni svg.ic visibile misura lo scostamento del centro icona
  // dal centro del box contenuto (padding esclusi) del genitore.
  setTimeout(function () {
    const out = [];
    document.querySelectorAll('svg.ic').forEach(function (svg) {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return; // nascosto
      const p = svg.parentElement;
      if (!p) return;
      const pr = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      const cx0 = pr.left + parseFloat(cs.paddingLeft), cy0 = pr.top + parseFloat(cs.paddingTop);
      const cw = pr.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ch = pr.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (cw <= 0 || ch <= 0) return;
      const dX = +(r.left + r.width / 2 - (cx0 + cw / 2)).toFixed(1); // >0 = a DESTRA del centro contenitore
      const dY = +(r.top + r.height / 2 - (cy0 + ch / 2)).toFixed(1);  // >0 = in BASSO
      const ctxName = p.id ? ('#' + p.id) : (p.className && String(p.className).trim() ? '.' + String(p.className).trim().split(/\\s+/)[0] : p.tagName.toLowerCase());
      out.push([ctxName, dX, dY, Math.round(r.width)]);
    });
    const payload = { icons: out, errs: window.__errs || [] };
    document.title = 'PLACE:' + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }, ${snap ? 1400 : 300});
})();
</script>
`;

const out = html.replace(/<script src="assets\.js\?v=\d+"><\/script>/, mock + '\n  <script src="../public/assets.js"></script>')
                .replace(/<script src="client\.js\?v=\d+"><\/script>/, '<script src="../public/client.js"></script>')
                .replace('href="style.css?v=', 'href="../public/style.css?v=');

const name = hasSnap ? 'icon-place-game.html' : 'icon-place-lobby.html';
fs.writeFileSync(path.join(__dirname, name), out);
console.log('scritta: test/' + name + (hasSnap ? ' (con snapshot)' : ' (solo lobby)'));
