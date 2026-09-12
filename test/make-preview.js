// ============================================================
// MAKE-PREVIEW — genera test/render-preview.html: la pagina reale
// (index.html) con un mock socket che riproduce lo snapshot catturato
// (_snapA.json). Dopo il render, uno script di PROVA campiona i pixel
// del canvas in punti chiave (centri tile, centri unita', gutter) e li
// scrive in <title> come base64: leggibile con msedge --dump-dom.
// Uso: node test/make-preview.js
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, '_snapA.json'), 'utf8'));

// Mock socket + probe pixel: riproduce game_started/state_update con dati reali,
// poi campiona il canvas e pubblica i risultati in document.title (base64).
const mock = `
<script>
(function () {
  const SNAP = ${JSON.stringify(snap)};
  window.__MOCK_EMITTED = [];
  window.io = function () {
    return {
      id: 'mock-preview',
      on(evt, cb) {
        if (evt === 'connect') setTimeout(() => cb(), 0);
        else if (evt === 'game_started') setTimeout(() => cb({ playerId: SNAP.self.id }), 10);
        else if (evt === 'state_update') setTimeout(() => cb(SNAP), 30);
      },
      emit(evt, data) { window.__MOCK_EMITTED.push({ evt, data }); }
    };
  };

  // ---- PROBE: dopo il render, campiona pixel in punti chiave ----
  setTimeout(function () {
    try {
      const c = document.getElementById('board');
      const ctx2 = c.getContext('2d');
      const size = SNAP.game.map_size;
      const px = Math.floor(640 / size);
      const LW = 28, LH = 20; // LABEL_W/LABEL_H di client.js
      const rect0 = c.getBoundingClientRect();
      const out = { canvasW: c.width, canvasH: c.height, cssW: rect0.width, cssH: rect0.height, probes: [] };
      function sample(x, y) {
        if (x < 0 || y < 0 || x >= c.width || y >= c.height) return [null];
        const d = ctx2.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        out.probes.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, d[0], d[1], d[2]]);
      }
      // centri di OGNI tile esplorato (dovrebbe essere il colore del biome)
      for (const t of SNAP.tiles) sample(LW + t.x * px + px / 2, LH + t.y * px + px / 2);
      // angoli interni dei tile (verifica che la base copra tutta la cella)
      for (const t of SNAP.tiles) { sample(LW + t.x * px + 3, LH + t.y * px + 3); }
      // centri unita' (dovrebbe essere il colore fazione)
      for (const u of SNAP.units) sample(LW + u.x * px + px / 2, LH + u.y * px + px / 2);
      // gutter sinistro/uperiore (dovrebbe essere acciaio scuro, NON terreno)
      for (let i = 0; i < size; i++) { sample(14, LH + i * px + px / 2); sample(LW + i * px + px / 2, 10); }
      document.title = 'PROBES:' + btoa(JSON.stringify(out));

      // ---- TEST INTERAZIONI (rilevamento freeze): click unita', click citta',
      // selezione testo nell'inspector. Un heartbeat ogni 200ms scrive il conteggio
      // in <title>: se la pagina si blocca, il conteggio resta fermo. ----
      window.__HB = 0;
      setInterval(() => { window.__HB++; document.title = 'PROBES:' + btoa(JSON.stringify(out)) + '|HB:' + window.__HB; }, 200);

      function clickAt(cssX, cssY) {
        const r = c.getBoundingClientRect();
        for (const type of ['mousedown', 'mouseup', 'click']) {
          c.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r.left + cssX, clientY: r.top + cssY }));
        }
      }
      // 1) click sulla propria unita' (selezione -> select_unit emesso dal mock)
      const myU = SNAP.units.find(u => u.owner_id === SNAP.self.id);
      if (myU) setTimeout(() => { window.__STEP = 'clickUnit'; clickAt(LW + myU.x * px + px / 2, LH + myU.y * px + px / 2); }, 600);
      // 2) click sulla propria citta' (pannello addestramento + inspector)
      const myC = SNAP.cities.find(cc => cc.owner_id === SNAP.self.id);
      if (myC) {
        const ct = SNAP.tiles.find(t => t.id === myC.tile_id);
        if (ct) setTimeout(() => { window.__STEP = 'clickCity'; clickAt(LW + ct.x * px + px / 2, LH + ct.y * px + px / 2); }, 1200);
      }
      // 3) selezione del testo dentro l'inspector (Range + Selection API)
      setTimeout(() => {
        window.__STEP = 'selectText';
        const el = document.getElementById('unitInfo');
        if (el && el.firstChild) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const selObj = window.getSelection();
          selObj.removeAllRanges();
          selObj.addRange(range);
          window.__SELLEN = selObj.toString().length;
        }
      }, 1800);
    } catch (e) { document.title = 'PROBE_ERR:' + e.message; }
  }, 400);
})();
</script>
`;

// pattern indipendenti dalla versione di cache-busting (?v=N)
const out = html.replace(/<script src="assets\.js\?v=\d+"><\/script>/, mock + '\n  <script src="../public/assets.js"></script>')
                .replace(/<script src="client\.js\?v=\d+"><\/script>/, '<script src="../public/client.js"></script>')
                .replace('href="style.css?v=', 'href="../public/style.css?v=');

fs.writeFileSync(path.join(__dirname, 'render-preview.html'), out);
console.log('preview scritta: test/render-preview.html (snapshot', snap.tiles.length + ' tile)');
