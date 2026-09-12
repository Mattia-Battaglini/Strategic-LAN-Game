// ============================================================
// ASSETS — Iconografia SVG code-driven (FASE 1 del restyling)
// ------------------------------------------------------------
// Dizionario completo di icone vettoriali che sostituisce TUTTE
// le emoji identificate in ASSET_AUDIT.md (§1). Nessuna dipendenza
// da file esterni: ogni icona è un set di path SVG (viewBox 24×24)
// disponibile in due forme:
//   ICONS.svg(nome, size)  -> stringa <svg> inline per l'HTML/DOM
//                             (stroke/fill = currentColor: il colore
//                              si eredita dal CSS del contenitore)
//   ICONS.draw(ctx,nome,cx,cy,size,colore) -> disegno su Canvas via
//                             Path2D (per sprite unità, overlay...)
// Convenzione path: { d } = tratto lineare (stroke currentColor,
// larghezza 2, cap/join arrotondati); { d, f:true } = riempimento.
// ============================================================

const ICONS = (() => {
  const DEFS = {};

  // ---------- helper di definizione ----------
  function def(name, paths) { DEFS[name] = { vb: [0, 0, 24], paths }; }
  function alias(name, target) { DEFS[name] = DEFS[target]; }

  // ================= UI — mappatura 1:1 con le emoji dell'audit §1 =================

  // ⚔️ (U+2694) titolo lobby + topbar -> logo spade incrociate
  def('logo-swords', [
    { d: 'M14.5 17.5 L3 6 L3 3 L6 3 L17.5 14.5' },
    { d: 'M13 19 L19 13' }, { d: 'M16 16 L20 20' }, { d: 'M19 21 L21 19' },
    { d: 'M14.5 6.5 L18 3 L21 3 L21 6 L17.5 9.5' },
    { d: 'M5 14 L9 18' }, { d: 'M7 17 L4 20' }, { d: 'M3 19 L5 21' },
  ]);

  // ⚔️ (U+2694) label stat ATK inspector -> spada singola
  def('atk-sword', [
    { d: 'M14.5 17.5 L3 6 L3 3 L6 3 L17.5 14.5' },
    { d: 'M13 19 L19 13' }, { d: 'M16 16 L20 20' }, { d: 'M19 21 L21 19' },
  ]);

  // ⚔️ (U+2694) trait "muovi+attacca" -> spada-freccia (due azioni)
  def('strike', [
    { d: 'M5 19 L16.5 7.5' },                                   // fusto
    { d: 'M20.5 3.5 L17.8 9.3 L14.7 6.2 Z', f: true },          // punta freccia (attacco)
    { d: 'M5 19 L8.6 17.7' },                                   // piume (movimento)
    { d: 'M6.3 20.3 L4.9 16.8' },
  ]);

  // ⚠️ (U+26A0) errori lobby/log/avvisi -> triangolo esclamativo
  def('warning', [
    { d: 'M12 3.5 L22 20 H2 Z' },
    { d: 'M12 9.5 V14' },
    { d: 'M12 17 h.01', w: 2.8 },
  ]);

  // ⚙️ (U+2699) pannello config mondo host -> ingranaggio
  def('gear', [
    { d: 'M12 3.5 A8.5 8.5 0 1 0 12.01 3.5 Z' },
    { d: 'M12 9 A3 3 0 1 0 12.01 9 Z' },
    { d: 'M16.5 12 H19 M12 16.5 V19 M7.5 12 H5 M12 7.5 V5 M15.2 15.2 L17 17 M8.8 15.2 L7 17 M8.8 8.8 L7 7 M15.2 8.8 L17 7' },
  ]);

  // 🚀 (U+1F680) bottone "Avvia Partita" -> razzo
  def('rocket', [
    { d: 'M12 2 C14.8 4.2 16.2 8 15.6 12.5 H8.4 C7.8 8 9.2 4.2 12 2 Z' },
    { d: 'M12 6.8 A1.7 1.7 0 1 0 12.01 6.8 Z' },
    { d: 'M8.4 12.5 L5.5 16.5 L9 15' },
    { d: 'M15.6 12.5 L18.5 16.5 L15 15' },
    { d: 'M10.3 17 C10.6 18.8 11.2 20.4 12 21.8 C12.8 20.4 13.4 18.8 13.7 17' },
  ]);

  // 🔬 (U+1F52C) chip TP + bottone Tecnologie -> fiala di punti tecnologia
  def('flask-tp', [
    { d: 'M9.5 3 H14.5 M10.5 3 V8 L5.2 17.6 A2.2 2.2 0 0 0 7.2 21 H16.8 A2.2 2.2 0 0 0 18.8 17.6 L13.5 8 V3' },
    { d: 'M7.4 14.5 H16.6' },
    { d: 'M10.5 17 h.01 M13.5 18.5 h.01', w: 2.4 },
  ]);

  // ↩️ (U+21A9) bottone "Annulla Mossa" + testo guida -> freccia undo
  def('undo', [
    { d: 'M9 14 L4 9 L9 4' },
    { d: 'M4 9 H14.5 A5.5 5.5 0 0 1 14.5 20 H11' },
  ]);

  // ⏭ (U+23ED) bottone "Fine Turno" -> skip forward
  def('skip-forward', [
    { d: 'M6 4.5 L16 12 L6 19.5 Z' },
    { d: 'M19.5 5 V19', w: 2.4 },
  ]);

  // 🛡️ (U+1F6E1) bottone Admin + log espulsioni -> scudo con spunta
  def('shield-admin', [
    { d: 'M12 3 L20 6.2 V11 C20 15.8 16.6 19.4 12 21 C7.4 19.4 4 15.8 4 11 V6.2 Z' },
    { d: 'M8.5 11.5 L11 14 L15.5 9', w: 2.2 },
  ]);

  // ❓ (U+2753) pulsante flottante guida -> cerchio punto interrogativo
  def('help', [
    { d: 'M12 3 A9 9 0 1 0 12.01 3 Z' },
    { d: 'M9.2 9.2 A3 3 0 0 1 15 10.4 C15 12.4 12 12.8 12 14.6' },
    { d: 'M12 17.6 h.01', w: 2.8 },
  ]);

  // 📖 (U+1F4D6) header modale guida -> libro aperto
  def('book', [
    { d: 'M2 5 H8 A4 4 0 0 1 12 9 V20 A3 3 0 0 0 9 17 H2 Z' },
    { d: 'M22 5 H16 A4 4 0 0 0 12 9 V20 A3 3 0 0 1 15 17 H22 Z' },
  ]);

  // ✕ (U+2715) chiudi guida + bottoni espelli (audit: icon-kick o icon-close -> riuso close)
  def('close', [
    { d: 'M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5', w: 2.4 },
  ]);

  // 👑 (U+1F451) badge host in lobby -> corona
  def('crown', [
    { d: 'M3.5 7.5 L8 11.5 L12 4.5 L16 11.5 L20.5 7.5 V16.5 A1.5 1.5 0 0 1 19 18 H5 A1.5 1.5 0 0 1 3.5 16.5 Z' },
  ]);

  // ⭐ (U+2B50) chip oro + costi addestramento/guida -> moneta con stella
  def('gold-coin', [
    { d: 'M12 3.5 A8.5 8.5 0 1 0 12.01 3.5 Z' },
    { d: 'M12 7.6 L13.1 9.9 L15.6 10.2 L13.8 11.9 L14.3 14.4 L12 13.1 L9.7 14.4 L10.2 11.9 L8.4 10.2 L10.9 9.9 Z', f: true },
  ]);

  // 🟢 (U+1F7E2) "Il tuo turno" -> cerchio play attivo
  def('turn-active', [
    { d: 'M12 3 A9 9 0 1 0 12.01 3 Z' },
    { d: 'M9.8 8.4 L15.6 12 L9.8 15.6 Z', f: true },
  ]);

  // ⏳ (U+23F3) "In attesa di X…" -> clessidra
  def('hourglass', [
    { d: 'M5 2 H19 M5 22 H19' },
    { d: 'M7 2 V6.2 A2 2 0 0 0 7.6 7.6 L12 12 L16.4 7.6 A2 2 0 0 0 17 6.2 V2' },
    { d: 'M17 22 V17.8 A2 2 0 0 0 16.4 16.4 L12 12 L7.6 16.4 A2 2 0 0 0 7 17.8 V22' },
  ]);

  // 🏆 (U+1F3C6) vittoria game over -> trofeo
  def('trophy', [
    { d: 'M6 9 H4.5 A2.5 2.5 0 0 1 4.5 4 H6' },
    { d: 'M18 9 H19.5 A2.5 2.5 0 0 0 19.5 4 H18' },
    { d: 'M4 22 H20' },
    { d: 'M10 14.7 V17 C10 17.6 9.5 18 9 18.2 C7.7 18.8 7 20.2 7 22' },
    { d: 'M14 14.7 V17 C14 17.6 14.5 18 15 18.2 C16.3 18.8 17 20.2 17 22' },
    { d: 'M18 2 H6 V9 A6 6 0 0 0 18 9 Z' },
  ]);

  // 🤝 (U+1F91D) patta game over -> stretta di mano stilizzata (braccia + nodo centrale)
  def('handshake', [
    { d: 'M2 8.5 H7.5 L11 12' },
    { d: 'M22 15.5 H16.5 L13 12' },
    { d: 'M12 9.8 A2.2 2.2 0 1 0 12.01 9.8 Z' },
  ]);

  // ✅ (U+2705) tecnologia posseduta -> cerchio con spunta
  def('check-circle', [
    { d: 'M12 3 A9 9 0 1 0 12.01 3 Z' },
    { d: 'M8 12.5 L11 15.5 L16.5 9.5', w: 2.4 },
  ]);

  // 📍 (U+1F4CD) header coordinate inspector -> pin mappa
  def('pin', [
    { d: 'M20 10 C20 16 12 21.5 12 21.5 C12 21.5 4 16 4 10 A8 8 0 0 1 20 10 Z' },
    { d: 'M12 7 A3 3 0 1 0 12.01 7 Z' },
  ]);

  // 🌊 (U+1F30A) trait nuoto -> onde
  def('trait-swim', [
    { d: 'M2 9 Q4 6.5 6 9 T10 9 T14 9 T18 9 T22 9' },
    { d: 'M2 15 Q4 12.5 6 15 T10 15 T14 15 T18 15 T22 15' },
  ]);

  // ⛰️ (U+26F0) trait montagna -> profilo montuoso
  def('trait-mountain', [
    { d: 'M3 19 L9.5 7 L13 13 L15.5 9.5 L21 19 Z' },
  ]);

  // ❤️ (U+2764) label stat HP -> cuore
  def('hp-heart', [
    { d: 'M12 20.8 C6.8 16.4 3.2 13 3.2 9.3 C3.2 6.4 5.5 4.2 8.1 4.2 C9.9 4.2 11.3 5.1 12 6.4 C12.7 5.1 14.1 4.2 15.9 4.2 C18.5 4.2 20.8 6.4 20.8 9.3 C20.8 13 17.2 16.4 12 20.8 Z' },
  ]);

  // 👟 (U+1F45F) label stat MOV -> impronta/piede
  def('move-boot', [
    { d: 'M9.5 5 C11.6 5 13 6.9 13 9.3 S11.6 13.5 9.5 13.5 S6 11.4 6 9.3 S7.4 5 9.5 5 Z' },
    { d: 'M15 14.5 C16.7 14.5 18 15.7 18 17.2 S16.7 19.9 15 19.9 S12 18.6 12 17.2 S13.3 14.5 15 14.5 Z' },
    { d: 'M6.2 3.8 h.01 M9 2.6 h.01 M11.8 3.4 h.01', w: 2.4 },
  ]);

  // 🎯 (U+1F3AF) label stat RNG -> bersaglio
  def('range-target', [
    { d: 'M12 3 A9 9 0 1 0 12.01 3 Z' },
    { d: 'M12 7 A5 5 0 1 0 12.01 7 Z' },
    { d: 'M12 12 h.01', w: 3.4 },
  ]);

  // 👁️ (U+1F441) label stat VISIONE -> occhio
  def('vision-eye', [
    { d: 'M2.5 12 C5.5 7.5 8.6 5 12 5 S18.5 7.5 21.5 12 C18.5 16.5 15.4 19 12 19 S5.5 16.5 2.5 12 Z' },
    { d: 'M12 8.8 A3.2 3.2 0 1 0 12.01 8.8 Z' },
  ]);

  // 🏰 (U+1F3F0) riga struttura città inspector -> castello merlato
  // (contenuto centrato nel viewBox: bbox (4,5)-(20,19), centro (12,12))
  def('building-city', [
    { d: 'M4 19 V7 H6 V5 H8 V7 H10 V5 H14 V7 H16 V5 H18 V7 H20 V19 Z' },
    { d: 'M10 19 V14 A2 2 0 0 1 14 14 V19' },
  ]);

  // 🏘️ (U+1F3D8) riga struttura villaggio inspector -> case
  // (contenuto centrato nel viewBox: bbox (2.5,5)-(21.5,19), centro (12,12))
  def('building-village', [
    { d: 'M2.5 19 V9 L8 5 L13.5 9 V19 Z' },
    { d: 'M6.5 19 V14 H9 V19' },
    { d: 'M13.5 19 V11 L17.5 8 L21.5 11 V19' },
  ]);

  // 🔄 (U+1F504) bottone "Nuova Partita" -> freccia ciclica
  def('restart', [
    { d: 'M3 12 A9 9 0 1 0 12 3 A9.75 9.75 0 0 0 5.26 5.74 L3 8' },
    { d: 'M3 3 V8 H8' },
  ]);

  // ================= Icone di CLASSE unità (audit §3, fallback/roster) =================
  // Sostituiscono le icone geometriche di drawClassIcon; usate su Canvas via ICONS.draw.

  alias('class-sword', 'atk-sword');

  def('class-bow', [
    { d: 'M8.5 3 C14.5 7 14.5 17 8.5 21' },   // arco
    { d: 'M8.5 3 V21' },                       // corda
    { d: 'M4 12 H19' },                        // freccia
    { d: 'M20.5 12 L16 9.5 V14.5 Z', f: true },// punta
    { d: 'M4 12 L7 10 M4 12 L7 14' },          // piume
  ]);

  def('class-horseshoe', [
    { d: 'M17.5 9 A5.5 5.5 0 1 1 6.5 9' },     // ferro di cavallo (apertura in alto)
  ]);

  def('class-shield', [
    { d: 'M12 3 L20 6.2 V11 C20 15.8 16.6 19.4 12 21 C7.4 19.4 4 15.8 4 11 V6.2 Z' },
    { d: 'M12 7.5 V15' },
  ]);

  def('class-axe', [
    { d: 'M5 19 L16.5 7.5' },                  // manico
    { d: 'M13 4 A8 8 0 0 1 20 11 Z', f: true },// lama a falce
  ]);

  def('class-spear', [
    { d: 'M4 20 L17.5 6.5' },                  // asta
    { d: 'M21 3 L18.9 7.9 L16 5.1 Z', f: true }// punta a foglia
  ]);

  alias('class-eye', 'vision-eye');
  alias('class-wave', 'trait-swim');

  // ================= EMBLEMI FAZIONI (audit §3) =================
  // Usati in lobby (badge giocatore), game over e come sigillo delle unità.

  def('emb-valoria', [   // spada imperiale nel cerchio
    { d: 'M12 3 A9 9 0 1 0 12.01 3 Z' },
    { d: 'M12 6 V14' },
    { d: 'M8.5 14 H15.5' },
    { d: 'M12 14 V17' },
  ]);

  def('emb-nordmark', [  // scudo con picco montano
    { d: 'M12 3 L20 6.2 V11 C20 15.8 16.6 19.4 12 21 C7.4 19.4 4 15.8 4 11 V6.2 Z' },
    { d: 'M7.5 15.5 L10.5 10 L12.8 13.2 L14.2 11.2 L16.5 15.5' },
  ]);

  def('emb-saharim', [   // sole sulle dune
    { d: 'M12 9 A3 3 0 1 0 12.01 9 Z' },
    { d: 'M12 3.5 V5 M5 9 H6.8 M17.2 9 H19 M7.4 4.4 L8.6 5.6 M16.4 5.6 L17.6 4.4' },
    { d: 'M2.5 16.5 Q7 13.5 12 16.5 T21.5 16.5' },
    { d: 'M4 19.8 Q9 17.3 14 19.8 T22 19.8' },
  ]);

  def('emb-aqualis', [   // tridente delle maree
    { d: 'M12 21 V6' },
    { d: 'M7.5 8 V5 A4.5 4.5 0 0 1 16.5 5 V8' },
    { d: 'M9 13 H15' },
  ]);

  // ================= API PUBBLICA =================

  /** Stringa <svg> inline per iniezione DOM (colore via currentColor). */
  function svg(name, size = 16) {
    const d = DEFS[name];
    if (!d) return '';
    const inner = d.paths.map(p =>
      p.f === true
        ? `<path d="${p.d}" fill="currentColor" stroke="none"/>`
        : `<path d="${p.d}" fill="none" stroke="currentColor" stroke-width="${p.w || 2}" stroke-linecap="round" stroke-linejoin="round"/>`
    ).join('');
    return `<svg class="ic ic-${name}" width="${size}" height="${size}" viewBox="${d.vb.join(' ')}" aria-hidden="true">${inner}</svg>`;
  }

  /** Disegna l'icona su un contesto Canvas, centrata in (cx,cy), lato `size` px. */
  function draw(c, name, cx, cy, size, color = '#ffffff') {
    const d = DEFS[name];
    if (!d) return;
    const [vx, vy, vw] = d.vb;
    c.save();
    c.translate(cx - size / 2, cy - size / 2);
    c.scale(size / vw, size / vw);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const p of d.paths) {
      const path = new Path2D(p.d);
      if (p.f === true) { c.fillStyle = color; c.fill(path); }
      else { c.strokeStyle = color; c.lineWidth = p.w || 2; c.stroke(path); }
    }
    c.restore();
  }

  return Object.freeze({ DEFS, svg, draw });
})();
