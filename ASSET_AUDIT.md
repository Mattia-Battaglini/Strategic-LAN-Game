# 📦 ASSET AUDIT & MANIFEST — 4X Lite LAN

**Scope:** scansione completa di `public/index.html`, `public/style.css`, `public/client.js`, `server/*.js` (emoji rilevate anche nei messaggi log inviati al client).
**Metodo:** grep per classi di code-point emoji + inventario esaustivo dei caratteri non-ASCII (inclusa decodifica dei surrogate pair UTF-16).
**Convenzione asset consigliata:** SVG trasparenti 24×24 o 32×32 per icone UI; PNG 64×64 (o 128×128) per tile/sprite mappa, scalati a runtime.

---

## 1️⃣ TABELLA MAPPING EMOJI → SVG

### `public/index.html`
| Emoji | Righe | Contesto / elemento | Asset di rimpiazzo consigliato |
|---|---|---|---|
| ⚔️ (U+2694) | 13, 54 | `<h1>` titolo lobby + topbar partita (logo testuale) | `/assets/icons/icon-logo-swords.svg` |
| ⚠️ (U+26A0) | 16 | `#connStatus` banner "Disconnesso dal server" | `/assets/icons/icon-warning.svg` |
| ⚙️ (U+2699) | 31 | `<h3>` pannello config mondo host | `/assets/icons/icon-gear.svg` |
| 🚀 (U+1F680) | 46 | label `#startBtn` "Avvia Partita" | `/assets/icons/icon-rocket.svg` |
| 🔬 (U+1F52C) | 57 | chip `#tpInfo` iniziale "🔬 0 TP" | `/assets/icons/icon-flask-tp.svg` |
| ↩️ (U+21A9) | 59 | label `#undoBtn` "Annulla Mossa" | `/assets/icons/icon-undo.svg` |
| ⏭ (U+23ED) | 60 | label `#endTurnBtn` "Fine Turno" | `/assets/icons/icon-skip-forward.svg` |
| 🛡️ (U+1F6E1) | 62 | label `#adminBtn` "Admin (Host)" | `/assets/icons/icon-shield-admin.svg` |
| ❓ (U+2753) | 98 | pulsante flottante `#guideBtn` | `/assets/icons/icon-help.svg` |
| 📖 (U+1F4D6) | 102 | `<h2>` header modale guida | `/assets/icons/icon-book.svg` |
| ✕ (U+2715, glifo) | 104 | `#guideCloseBtn` chiudi guida | `/assets/icons/icon-close.svg` |

### `public/client.js`
| Emoji | Righe | Contesto / variabile | Asset di rimpiazzo consigliato |
|---|---|---|---|
| ⚠️ (U+26A0) | 51, 247, 873 | prefisso `showLobbyError()`, prefisso errori in `addLog()`, avviso "Casella occupata" nel buy panel (`span.insp-enemy`) | `/assets/icons/icon-warning.svg` (riuso) |
| 👑 (U+1F451) | 183 | badge host nella lobby: `` `${pl.name} 👑` `` | `/assets/icons/icon-crown.svg` |
| 🛡️ (U+1F6E1) | 217 | prefisso log `kicked_from_game` | `/assets/icons/icon-shield-admin.svg` (riuso) |
| ⭐ (U+2B50) | 385, 877, 988 | chip oro `` `⭐ N oro` ``; bottoni addestramento `${name} — ${cost} ⭐`; colonna costo tabella unità guida | `/assets/icons/icon-gold-coin.svg` |
| 🟢 (U+1F7E2) | 388 | `#turnInfo` "Il tuo turno" | `/assets/icons/icon-turn-active.svg` |
| ⏳ (U+23F3) | 392 | `#turnInfo` "In attesa di X…" | `/assets/icons/icon-hourglass.svg` |
| 🔬 (U+1F52C) | 405 | chip TP dinamico `` `🔬 N TP` `` | `/assets/icons/icon-flask-tp.svg` (riuso) |
| 🏆 (U+1F3C6) | 419 | `#winnerText` vittoria game over | `/assets/icons/icon-trophy.svg` |
| 🤝 (U+1F91D) | 419 | `#winnerText` patta | `/assets/icons/icon-handshake.svg` |
| ✅ (U+2705) | 465 | riga tech posseduta nel `#techList` (`span.tech-owned`) | `/assets/icons/icon-check-circle.svg` |
| 📍 (U+1F4CD) | 800 | header inspector `` `📍 Casella B3` `` (`div.insp-coord`) | `/assets/icons/icon-pin.svg` |
| 🌊 (U+1F30A) | 809, 923 | trait "nuoto" — inspector unità + guida (`TRAIT_LABELS.swim`) | `/assets/icons/trait-swim.svg` |
| ⛰️ (U+26F0) | 810, 924 | trait "montagna" — inspector + guida | `/assets/icons/trait-mountain.svg` |
| ⚔️ (U+2694) | 811, 925, 816 | trait "muovi+attacca" (inspector/guida) **e** label stat ATK nell'inspector | `/assets/icons/trait-strike.svg` + `/assets/icons/icon-atk-sword.svg` (due usi distinti) |
| 🛡️ (U+1F6E1) | 816 | label stat DEF inspector | `/assets/icons/icon-def-shield.svg` |
| ❤️ (U+2764) | 817 | label stat HP inspector | `/assets/icons/icon-hp-heart.svg` |
| 👟 (U+1F45F) | 817 | label stat MOV inspector | `/assets/icons/icon-move-boot.svg` |
| 🎯 (U+1F3AF) | 817 | label stat RNG inspector | `/assets/icons/icon-range-target.svg` |
| 👁️ (U+1F441) | 817 | label stat VISIONE inspector | `/assets/icons/icon-vision-eye.svg` |
| 🏰 (U+1F3F0) | 828 | riga struttura città nell'inspector | `/assets/icons/building-city-icon.svg` |
| 🏘️ (U+1F3D8) | 833 | riga struttura villaggio nell'inspector | `/assets/icons/building-village-icon.svg` |
| ↩️ (U+21A9) | 1009 | testo corpo guida (voce "Annullamento mosse") | `/assets/icons/icon-undo.svg` (riuso, inline nel testo) |

### `server/index.js` (messaggi log renderizzati in `#log`)
| Emoji | Righe | Contesto | Asset di rimpiazzo consigliato |
|---|---|---|---|
| 🛡️ (U+1F6E1) | 256 | `game_log` espulsione dall'host | `/assets/icons/icon-shield-admin.svg` (riuso) |
| ⚠️ (U+26A0) | 296 | `game_log` disconnessione/eliminazione | `/assets/icons/icon-warning.svg` (riuso) |
| 🎮 (U+1F3AE) | 303 | `console.log` avvio server — **solo terminale, nessun asset UI** | n/d |

### Glifi non-emoji da valutare
| Glifo | Dove | Nota |
|---|---|---|
| ✕ (U+2715) | client.js 189 (`kick.textContent='✕'` lobby), 443 ("Espelli ✕" admin) | → `/assets/icons/icon-kick.svg` o `icon-close.svg` |
| × (U+00D7) | index.html 34–37 opzioni "12 × 12" ecc. | testo, si può mantenere |
| « » · — … | testi vari | tipografia, mantenibili |

**Totale: 26 emoji uniche in UI + 1 solo terminale (🎮) = 27 code-point; ~20 asset SVG distinti necessari (con riusi).**

---

## 2️⃣ MAPPA, TERRENO E OVERLAY

### Terreni renderizzati oggi (`client.js` `drawTile`, colori in `BIOME_COLORS` riga 57)
| Biome | Colore base | Rendering attuale (righe client.js) | Generazione (server/mapgen.js) |
|---|---|---|---|
| Acqua `water` | `#2e86de` | 2 onde quadriche bianche `rgba(255,255,255,.30)` sfalsate da hash (≈514–524) | value noise elevazione: `elev < water` |
| Pianura `plains` | `#a3c94a` | 2–3 ciuffi d'erba scuri `rgba(60,100,25,.55)` (≈526–537) | residuo di elev/moisture |
| Foresta `forest` | `#4f8f3b` | 2 alberi (`drawTree`: tronco `#6d4c2f`, chioma a 2 strati `#2e7d32`/`#388e3c`) (≈539–540, 561–566) | `moist > 1 - forest` sulla terra |
| Montagna `mountain` | `#8fa1b3` | triangolo roccia + ombra laterale `rgba(0,0,0,.18)` + cima innevata `#f5f7fa` (`drawMountain`, ≈542, 570–575) | `elev > 1 - mountain` |

Comune a ogni tile: bevel (bordo alto/sx chiaro `rgba(255,255,255,.13)`, basso/dx scuro `rgba(0,0,0,.20)`) + griglia `strokeRect 1px rgba(0,0,0,.28)` (≈546–557). Variazione deterministica per casella: `tileHash(x,y)` (≈493–496).

### Set di tessere da produrre
**Dimensione base:** px dinamico = `floor(640/size)` → **12×12=53px · 16×16=40px · 20×20=32px · 24×24=26px**. Autorizzare a **64×64** (o 128×128) e scalare.

- [ ] `tile/plains-a.png`, `plains-b.png`, `plains-c.png` — 3 varianti (sostituiscono ciuffi procedurali)
- [ ] `tile/forest-a.png`, `forest-b.png`, `forest-c.png` — 3 varianti con alberi posizionati (sostituiscono `drawTree`)
- [ ] `tile/mountain-a.png`, `mountain-b.png`, `mountain-c.png` — 3 varianti (sostituiscono `drawMountain`)
- [ ] `tile/water-a.png` … `water-d.png` — 2–4 frame per animazione onde opzionale (o 1 statica)
- [ ] **Autotiling (opzionale, consigliato):** set edge/corner per foresta e montagna (`forest-edge-n/e/s/w`, `mountain-corner-*`) per transizioni morbide tra biomi; in alternativa mantenere le varianti casuali via `tileHash`
- [ ] `tile/bevel.png` — overlay bevel/griglia 64×64 (sostituisce i 4 fillRect + strokeRect) oppure texture griglia unica
- [ ] Gutter coordinate: oggi testo vettoriale (`fillText`, righe ≈375–381, sfondo `#171d29`); opzionale sprite pre-renderizzato delle etichette o font dedicato

### Overlay e sovrapposizioni (righe client.js)
| Elemento | Implementazione attuale | Asset consigliato |
|---|---|---|
| Caselle raggiungibili (selezione) | `fillRect rgba(80,160,255,.35)` per tile (≈331–332) | `overlay/reachable.png` — highlight blu con bordo/frecce angolari |
| Target di attacco | `fillRect rgba(255,70,70,.45)` (≈333–334) | `overlay/target.png` — mirino/parentesi rosse |
| Anello unità selezionata | cerchio `#ffe14d` lineWidth 3 (vs 2 scuro di default) in `drawUnit` (≈592–593) | `overlay/select-ring.png` (o mantenere vettoriale) |
| Unità esausta (propria, ha agito) | `globalAlpha = 0.45` (≈585) | variante sprite "esausta" desaturata o overlay grigio |
| Barra HP unità | sfondo `rgba(0,0,0,.65)` + fill verde `#6ee76e` / giallo `#ffd166` / rosso `#ff5c5c`, 3px (≈604–607) | `ui/hp-bar.png` — frame vuoto + 3 fill colorati (o sprite a 9-slice) |
| **Fog of War** | caselle non esplorate NON disegnate → sfondo piatto `#10131a` (≈316–317); bordo esplorato/non esplorato netto | `fow/fow-dark.png` — texture scura (nubi/granularità) + opzionale `fow-edge.png` per transizione morbida; la "visione in attesa" (pendingVision) non ha rappresentazione visiva (by design) |
| Griglia caselle | `strokeRect 1px rgba(0,0,0,.28)` (≈555–557) | texture griglia o mantenere vettoriale |
| Confini di fazione / territorio | **assenti nel codice** — nessun shading territoriale oggi | opzionale nuovo asset: `overlay/territory-tint-{valoria,nordmark,saharim,aqualis}.png` (tinte dei 4 colori fazione) se si vuole evidenziare il controllo del territorio |
| Gutter coordinate | sfondo `#171d29` + etichette testo (≈316–320, 375–381) | opzionale: sprite etichette / font game UI |

---

## 3️⃣ FAZIONI, UNITÀ ED EDIFICI

### Fazioni (`server/gameLogic.js` `FACTIONS`, righe 44–89)
| Fazione | Colore (usato per corpi unità, tetti, badge lobby `.faction-dot`) | Asset necessari |
|---|---|---|
| Valoria | `#e74c3c` | [ ] `factions/valoria-emblem.svg` (logo fazione) · [ ] banner game-over |
| Nordmark | `#3b6fd4` | [ ] `factions/nordmark-emblem.svg` · [ ] banner |
| Saharim | `#f0a13a` | [ ] `factions/saharim-emblem.svg` · [ ] banner |
| Aqualis | `#18bfa0` | [ ] `factions/aqualis-emblem.svg` · [ ] banner |

### Unità (16 totali — 4 per fazione)
Rendering attuale: cerchio color-fazione r=0.30·px + icona geometrica classe in `#1c232b` (`drawClassIcon`, ≈612–708) + barra HP. Icone di classe usate: `sword, bow, horseshoe, shield, axe, spear, eye, wave`.

**Per ogni unità servono 3 asset:**
- [ ] **Sprite mappa** — `units/{id}-map.png` (≈48×48 su tile 64px, top-down; base neutra tintabile a runtime col colore fazione oppure 1 variante per fazione)
- [ ] **Ritratto pannello Info** — `units/{id}-portrait.png` (96×96 quadrato, per l'inspector e la guida)
- [ ] **Avatar selezione/roster** — `units/{id}-avatar.svg|png` (32×32 tondo, per bottoni addestramento, lobby, guide)

| ID unità | Nome | Fazione | Icona attuale | Trait | Sprite mappa | Ritratto | Avatar |
|---|---|---|---|---|---|---|---|
| `valoria_warrior` | Guerriero | Valoria | sword | — | [ ] | [ ] | [ ] |
| `valoria_archer` | Archer | Valoria | bow | — | [ ] | [ ] | [ ] |
| `valoria_rider` | Cavaliere | Valoria | horseshoe | strike | [ ] | [ ] | [ ] |
| `valoria_defender` | Difensore | Valoria | shield | mountain | [ ] | [ ] | [ ] |
| `nordmark_berserker` | Berserker | Nordmark | axe | strike | [ ] | [ ] | [ ] |
| `nordmark_shieldwall` | Muro di Scudi | Nordmark | shield | — | [ ] | [ ] | [ ] |
| `nordmark_wolfrider` | Cav. del Lupo | Nordmark | horseshoe | mountain | [ ] | [ ] | [ ] |
| `nordmark_hunter` | Cacciatore | Nordmark | bow | — | [ ] | [ ] | [ ] |
| `saharim_scout` | Scout | Saharim | eye | mountain | [ ] | [ ] | [ ] |
| `saharim_lancer` | Lanciere | Saharim | spear | — | [ ] | [ ] | [ ] |
| `saharim_dunerider` | Cav. di Duna | Saharim | horseshoe | strike | [ ] | [ ] | [ ] |
| `saharim_warden` | Guardiano | Saharim | shield | — | [ ] | [ ] | [ ] |
| `aqualis_corsair` | Corsaro | Aqualis | sword | strike | [ ] | [ ] | [ ] |
| `aqualis_slinger` | Scagliatore | Aqualis | bow | — | [ ] | [ ] | [ ] |
| `aqualis_swimmer` | Nuotatore | Aqualis | wave | swim + mountain | [ ] | [ ] | [ ] |
| `aqualis_tideguard` | Guardia delle Maree | Aqualis | shield | — | [ ] | [ ] | [ ] |

**Totale: 48 asset unità (16 × 3).** Icone di classe da sostituire comunque come fallback/roster: sword, bow, horseshoe, shield, axe, spear, eye, wave → `/assets/icons/class-{name}.svg` (8 SVG).

### Edifici e strutture nel codice
Esistono **solo 2 tipi** di struttura (`db.Cities`, `db.Villages`; nessun porto o altra costruzione — "Porto di Corallo" è solo il nome di una tecnologia Aqualis, non renderizzata):

| Struttura | Rendering attuale (client.js) | Asset necessari |
|---|---|---|
| **Città** (`{name} City`, ≈341–350) | mura rettangolari `#f5f0e6` (0.2–0.8 × 0.38–0.8 px) + tetto triangolare colorato del proprietario | [ ] `buildings/city-base.png` (mura neutre) · [ ] `buildings/city-roof-{valoria,nordmark,saharim,aqualis}.png` (4 varianti tetto) oppure base + tint a runtime · opzionale stato "conquistata" (bandiera/effetto) |
| **Villaggio** (`Villaggio N`, ≈357–365) | capanna: pareti legno `#c9a06b` + tetto color proprietario o neutro `#6b5b4a` se non conquistato | [ ] `buildings/village-neutral.png` · [ ] `buildings/village-{valoria,nordmark,saharim,aqualis}.png` (4 varianti) oppure base + tint |

**Totale edifici: 10 varianti (o 2 base + sistema di tint).**

---

## 4️⃣ COMPONENTI UI E STILI (CSS)

### Pannelli — `public/index.html` + `public/style.css`
| Pannello / sezione | Elementi (id/classi) | Stili attuali da aggiornare (style.css) |
|---|---|---|
| **Schermata Lobby/LAN** (`#lobby`) | `h1`, `.sub`, `#connStatus`, `#nameInput`, `#joinBtn`, `#factionBox` (`#factionSelect`, `#factionDesc`), `#lobbyList li` + `.faction-dot` + `.kickBtn`, `#configPanel` (`h3`, `label`, `select#mapSizeSel`, 4× `input[type=range]` + `.rangeVal`), `#startBtn`, `#lobbyError` | `#lobby` (layout centrato, width 380px) · `#nameInput`, `#factionSelect`, `#configPanel select` (border `#3a4150`, bg `#1d222b`) · `.rangeVal` · `.faction-dot` (cerchio 10px → sostituibile con emblem SVG) · `.lobby-error` |
| **Header Stato / Topbar** (`#topbar`) | `h1`, chip `.hud-chip`: `#roundInfo`, `#goldInfo`, `#tpInfo`, `#turnInfo` (+ stato `.you`), bottoni `#undoBtn`, `#endTurnBtn`, `#techBtn.admin-btn`, `#adminBtn.admin-btn.hidden` | `#topbar` (flex, gap 10px) · `.hud-chip` (bg `#1d222b`, radius 8px → frame game-UI + icone ⭐/🔬 da §1) · `#turnInfo.you` (verde `#7ee787`) |
| **Scheda Info Casella** (`aside#sidePanel > #unitInfo`) | `h3 "Info"`, `#unitInfo` con `.insp-coord` (📍), `.insp-section`, `.insp-title`, `.insp-enemy`; sotto: `#buyPanel` (b + avvisi `.insp-enemy` + bottoni `.buyBtn`) | `#sidePanel` (width 250px) · `#unitInfo` (bg `#1d222b`, min-height 56px → frame pannello + texture sfondo) · `.insp-coord` (chip oro `#ffd76a`) · `.insp-title` (uppercase 10px) · `.insp-enemy` (rosso `#ff8a75`) |
| **Albero Tecnologie** (`#techPanel`) | `b`, `#techTpLabel`, `ul#techList li` con `.tech-owned` (✅), `.tech-desc`, `button.buyBtn "Acquista"` | `#adminPanel, #techPanel` condivisi (bg `#241f33`, border `#4a3f6b`) · `.tech-owned` (verde) · `.tech-desc` — aggiungere: frame slot tech (posseduta/non), icona per effetto (ATK/DEF/MOV/oro/VIS/HP) |
| **Menù Admin Host** (`#adminPanel`) | `b`, `ul#adminList li` + label + `button.kickBtn "Espelli ✕"` | condiviso con `#techPanel` · `.kickBtn` (rosso `#e0533d`) |
| **Log di Gioco** (`#sidePanel > ul#log`) | `h3 "Log"`, `li` (max 12, prepend) | `#log li` (font 12px, border-bottom `#232936`) — icone per tipo evento (⚠️/🛡️ da §1) |
| **Game Over** (`#overlay > #overlayBox`) | `#winnerText`, `#newGameBtn "🔄 Nuova Partita"` (index.html ≈92, emoji 🔄 U+1F504 → `/assets/icons/icon-restart.svg`) | `#overlay` (fixed inset 0, z-10) · `#overlayBox` (bg `#1d222b`, radius 14px) — aggiungere: texture sfondo vittoria + trofeo grande |
| **Guida/Enciclopedia** (`#guideBtn`, `#guideModal > #guideBox`) | header: `h2 📖`, `input#guideSearch`, `#guideCloseBtn ✕`; tab: `.g-tab(.active)` + badge `.g-count`; contenuto: `.g-entry`, `.g-faction` (border-left colore fazione), `.g-sub`, `.g-table th/td`, `.g-loading` | `#guideBtn` (cerchio fisso 46px, z-60) · `#guideModal` (overlay rgba .78, z-55) · `#guideBox` (min(760px,92vw), max-h 86vh) · `.g-tab` / `.g-tab.active` · `.g-entry` (bg `#232936`) · `.g-table` — aggiungere: frame modale game-UI, texture sfondo, stati hover tab |

### Pulsanti da aggiornare (frame + stati hover/active/disabled)
| Bottone | Label attuale | Classe/i CSS | Stato speciale |
|---|---|---|---|
| `#joinBtn` | "Unisciti alla partita" | `button` base | disabled n/d |
| `#startBtn` | "🚀 Avvia Partita (Host)" | `button` base | visibile solo host (`display:none`) |
| `#undoBtn` | "↩️ Annulla Mossa" | `button` base | `disabled` (non è il tuo turno / undo_count=0) |
| `#endTurnBtn` | "Fine Turno ⏭" | `button` base + **`.cancel-mode` definita in CSS ma NON usata dal client** (orphan, pronta per stato revoca) | `disabled` se non è il tuo turno |
| `#techBtn` | "🔬 Tecnologie" | `.admin-btn` (viola `#6c5ce7`) | toggle pannello |
| `#adminBtn` | "🛡️ Admin (Host)" | `.admin-btn`, `.hidden` se non host | toggle pannello |
| `#newGameBtn` | "🔄 Nuova Partita" | `button` base | solo game over |
| `#guideCloseBtn` | "✕" | `#guideCloseBtn` (rosso) | — |
| `.buyBtn` (dinamici, buy panel) | "`{Unità} — {costo} ⭐`" / "Acquista" (tech) | `.buyBtn` (bg `#242b37`, full-width) | `disabled` se casella occupata / oro insufficiente / non è il tuo turno / TP insufficienti |
| `.kickBtn` (dinamici, lobby+admin) | "✕" / "Espelli ✕" | `.kickBtn` (rosso) | — |
| `.g-tab` (guida) | 4 schede | `.g-tab`, `.active` | badge `.g-count` con n. risultati ricerca |

### Checklist classi CSS da rifare in stile Dark Game UI / Material
- [ ] `button` base + `:hover` + `:disabled` (frame, texture, stati click) — style.css 8–19
- [ ] `#endTurnBtn.cancel-mode` (+ hover) — 22–23 (attualmente orfano: collegarlo a uno stato reale o rimuoverlo)
- [ ] `.hud-chip` e varianti (`#turnInfo.you`) — 73–74
- [ ] `#topbar`, `#game` layout — 70–72
- [ ] `#adminPanel, #techPanel` + `.tech-owned`, `.tech-desc` — 79–86
- [ ] `canvas#board` (bg `#10131a`, radius 8px) — 94 → bordo/frame mappa
- [ ] `#sidePanel h3`, `#unitInfo`, `.insp-coord`, `.insp-section`, `.insp-title`, `.insp-enemy` — 88–98
- [ ] `.buyBtn` (+ hover/disabled) — 99–100
- [ ] `#log li` — 102–103
- [ ] `#overlay`, `#overlayBox`, `#winnerText` — 106–108
- [ ] `#connStatus`, `.lobby-error` — 111–117
- [ ] Lobby: `#nameInput`, `#factionSelect`, `#configPanel` (label/select/range/`.rangeVal`), `.kickBtn`, `.faction-dot` — 26–68
- [ ] Guida: `#guideBtn`, `#guideModal`, `#guideBox`, `#guideHeader`, `#guideSearch`, `#guideCloseBtn`, `#guideTabs`, `.g-tab(.active)`, `.g-count`, `#guideContent`, `.g-entry`, `.g-faction`, `.g-sub`, `.g-table th/td`, `.g-loading` — 120–172

---

## 📊 RIEPILOGO QUANTITATIVO
| Categoria | Quantità |
|---|---|
| Emoji uniche in UI (da sostituire con SVG) | **26** (+1 solo terminale) → ~20 asset SVG distinti con riusi |
| Tile terreno da produrre | 12 varianti base + bevel/griglia + set autotiling opzionale |
| Overlay mappa | 8 elementi (reachable, target, select-ring, esausta, HP bar, FOW dark/edge, griglia, territorio opzionale) |
| Asset unità | **48** (16 unità × sprite+ritratto+avatar) + 8 icone classe fallback |
| Emblemi fazioni | 4 (+ banner game-over opzionali) |
| Varianti edifici | 10 (città: base+4 tetti; villaggio: neutro+4) oppure 2 base + tint runtime |
| Componenti UI da rifinire | ~30 classi/elementi CSS in 8 pannelli + 11 famiglie di bottoni |
