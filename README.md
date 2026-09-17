# ⚔️ 4X Lite — Multiplayer LAN

Gioco 4X lite (eXplore, eXpand, eXploit, eXterminate) ispirato a *The Battle of Polytopia* / *Civilization*, giocabile in multiplayer LAN via browser. Partite su griglia configurabile (12×12 → 24×24), **turni strettamente sequenziali con annullamento mosse**, 4 fazioni con roster propri, villaggi conquistabili e nebbia di guerra lato server (anti-cheat).

**Stack:** Node.js + Express · Socket.io · Vanilla JS ES6+ · HTML5 Canvas · DB in-memory a tabelle relazionali (modello identico a SQLite).

## Avvio rapido

```bash
npm install
npm start          # server su http://localhost:3000
# da altre macchine della LAN: http://<IP-host>:3000
npm run smoke      # (server avviato) test end-to-end automatico
```

Apri `http://localhost:3000` in più browser/machine, inserisci un nome, scegli la **fazione**, il primo arrivato (host 👑) configura la generazione del mondo e preme **Avvia Partita**.

## 🗄️ SCHEMA DB — PUNTO DI RIFERIMENTO ASSOLUTO

| Tabella | Attributi |
|---|---|
| **Game** | `id` PK · `map_size` INT · `seed` INT · `round` INT · `phase` ENUM('playing','finished') · `winner_id` FK→Players.id NULL · `spawn_points` JSON · `turn_queue` JSON (array id) · `current_player_id` FK→Players.id · `round_start_player_id` FK→Players.id |
| **Players** | `id` PK · `name` TEXT · `color` TEXT · `faction` TEXT · `gold` INT · `alive` BOOL · `last_acted_round` INT · `socket_id` TEXT · `tp` INT (punti tecnologia) · `techs` JSON [] (id tecnologie acquisite) |
| **Tiles** | `id` PK · `x` INT · `y` INT · `biome` ENUM('water','plains','forest','mountain') |
| **TileVisibility** | `tile_id` FK→Tiles.id · `player_id` FK→Players.id — **PK composito (tile_id, player_id)** = nebbia di guerra |
| **Cities** | `id` PK · `name` TEXT · `owner_id` FK→Players.id · `tile_id` FK→Tiles.id |
| **Villages** | `id` PK · `name` TEXT · `owner_id` FK→Players.id NULL (neutro) · `tile_id` FK→Tiles.id |
| **Units** | `id` PK · `type` TEXT (chiave unica globale, prefisso fazione_) · `owner_id` FK→Players.id · `x` INT · `y` INT · `hp` INT · `has_moved` BOOL · `has_attacked` BOOL |

### Fazioni e unità (fonte di verità: `server/gameLogic.js → FACTIONS`)

Ogni fazione ha un **roster proprio** con statistiche diverse (costo, HP, ATK, DEF, MOV, RNG, VISIONE) e abilità speciali. Il colore del player = colore della fazione; le chiavi unità sono uniche globali (`fazione_tipo`).

| Fazione | Carattere | Unità (costo/HP/ATK/DEF/MOV/RNG/VIS) |
|---|---|---|
| **Valoria** 🔴 | bilanciata | Guerriero 20/10/4/1/1/1/2 · Archer 30/8/3/0/1/2/3 · Cavaliere 40/9/5/1/2/1/3 (**⚔️ strike**) · Difensore 35/16/2/3/1/1/2 (**⛰️ mountain**) |
| **Nordmark** 🔵 | pesante/difensiva | Berserker 25/8/6/0/1/1/2 (**⚔️ strike**) · Muro di Scudi 35/20/2/4/1/1/2 · Cav. del Lupo 45/10/5/1/3/1/3 (**⛰️ mountain**) · Cacciatore 30/9/3/1/2/2/4 |
| **Saharim** 🟠 | rapida/scout | Scout 20/7/2/0/3/1/**5** (**⛰️ mountain**) · Lanciere 35/9/4/1/2/2/3 · Cav. di Duna 40/8/5/0/3/1/3 (**⚔️ strike**) · Guardiano 30/12/2/2/1/1/3 |
| **Aqualis** 🟢 | costiera | Corsaro 30/9/5/1/1/1/2 (**⚔️ strike**) · Scagliatore 25/7/3/0/1/**3**/4 · Nuotatore 35/8/3/1/2/1/3 (**🌊 swim + ⛰️ mountain**) · Guardia delle Maree 40/14/3/3/1/1/2 |

**Abilità speciali (trait):**
- **⚔️ strike** — muovere *e* attaccare nello stesso round (due azioni invece di una).
- **⛰️ mountain** — scavalcare e attraversare le montagne (altrimenti inattraversabili).
- **🌊 swim** — camminare sull'acqua.

### Regole chiave
- **Turni strettamente sequenziali:** la coda dei turni (`turn_queue`) è ciclica nell'ordine di join. Gioca il player corrente, tutti gli altri attendono ("In attesa di X…"). Il turno passa al successivo **solo quando il player corrente conferma esplicitamente** la fine turno (con dialog di conferma).
- **Annullamento mosse (undo):** durante il proprio turno ogni azione (muovi/attacca/addestra/acquista tech) pusha uno snapshot dello stato; `undo_action` lo ripristina. La **conferma della fine turno svuota lo stack**: da quel punto le mosse non sono più reversibili. Undo disponibile fino a 30 mosse per turno.
- **Commit di round:** quando il ciclo torna al player che ha aperto il round → incasso oro per tutti i vivi (`10 + 5×città + 8×villaggi` + bonus tech), reset `has_moved`/`has_attacked`, **+1 TP** a ogni vivo, `round++`.
- **Villaggi:** piazzati sulla mappa (numero configurabile pre-partita), sempre raggiungibili. Conquistarli entrando con un'unità dà **+8 oro/round** e li trasforma in **punto di addestramento extra** (come le città).
- **Limite spawn:** massimo **1 unità per casella con struttura** — se la casella della città/villaggio è occupata, l'addestramento si disabilita (client + server) finché un'unità non libera la casella.
- **Movimento (BFS):** montagna inattraversabile salvo trait `mountain`; acqua inattraversabile salvo trait `swim`. Un'unità agisce una volta per round (`has_moved`), tranne le unità `strike` che possono anche attaccare dopo la mossa.
- **Occupazione singola:** ogni casella può contenere al massimo **1 unità (amica o nemica)** — le caselle occupate bloccano atterraggio E attraversamento nel pathfinding, e lo spawn su struttura occupata resta vietato (controllo severo client + server).
- **Attacco e modificatori di terreno:** distanza Manhattan ≤ RNG; danno = max(1, ATK+bonus tech − DEF−bonus tech−bonus terreno). Terreno del **difensore**: foresta +1 DEF (e gli attacchi a distanza, RNG>1, fanno **metà danno**); montagna **+2 DEF**.
- **Ricompensa kill:** eliminare un'unità nemica dà oro proporzionale al suo costo (`⌈costo/2⌉`) e **+1 TP** al player che l'ha eliminata.
- **eXterminate/eXpand:** entrare nella città nemica la conquista; chi resta senza città né unità è eliminato; vince l'ultimo vivo.
- **Nebbia di guerra a rilascio ritardato (anti-cheat):** il server invia a ogni client SOLO le caselle in `TileVisibility` del player. La visione guadagnata muovendo/attaccando durante un turno **non si rivela subito**: è accumulata e si sblocca **solo quando il player conferma la fine turno** (così l'esplorazione "scatta" a turno chiuso). Visione: raggio = stat VISIONE dell'unità (+bonus tech), raggio 3 permanente attorno a città/villaggi propri.
- **Azioni nemiche a rilascio ritardato:** le mosse/attacchi in corso del giocatore corrente non sono visibili agli altri player — gli snapshot dei non-correnti usano lo "stato confermato" (`confirmedState`), una copia di Units/Cities/Villages aggiornata SOLO alla conferma della fine turno (e all'avvio). Il player corrente vede sempre lo stato live; l'undo del turno corrente non tocca lo stato confermato.
- **UI Inspector:** cliccando qualsiasi casella visibile si vedono nel pannello Info i dati completi — unità (proprie o **nemiche**, con HP/ATK/DEF/abilità e bonus tech per le proprie), tipo di terreno con i suoi effetti, e struttura presente (città/villaggio con proprietario e introito).

### 🔬 Albero tecnologie
Ogni fazione ha un albero di 4 perk globali (`server/gameLogic.js → TECHS`), acquistabili durante il proprio turno consumando **TP** (punti tecnologia): +1 TP a ogni commit di round e +1 per ogni unità nemica eliminata.

| Fazione | Tech (costo TP) |
|---|---|
| Valoria | Militia Addestrata (+1 ATK, 2) · Logistica Imperiale (+3 oro/round, 3) · Scuola di Cavalleria (+1 MOV, 4) · Mura Fortificate (+1 DEF, 5) |
| Nordmark | Rune del Nord (+2 oro/round, 2) · Patto con il Lupo (+1 MOV, 3) · Forgiatura del Ferro (+1 ATK/+1 DEF, 4) · Aura del Nord (+3 HP alle unità addestrate, 5) |
| Saharim | Occhi del Deserto (+1 VISIONE, 2) · Carovane Nomadi (+3 oro/round, 3) · Vento di Sabbia (+1 MOV, 4) · Benedizione del Guardiano (+1 DEF, 5) |
| Aqualis | Porto di Corallo (+3 oro/round, 2) · Addestramento delle Onde (+1 ATK, 3) · Tattica Anfibia (+1 VISIONE, 4) · Scudo delle Maree (+3 HP alle unità addestrate, 5) |

Gli effetti sono applicati **lato server** (danno, movimento, visione, incasso, HP addestramento) e mostrati nel client (chip TP in topbar + pannello "🔬 Tecnologie").

### Sessione e permessi host
- Il **primo arrivato** in lobby è l'**host** 👑: configura la generazione mondo, avvia la partita ed espelle i giocatori (menù Admin in lobby e in partita).
- In partita l'host resta quello che ha avviato. **Kick o disconnessione di un player lo eliminano subito e aggiornano immediatamente la coda dei turni**: se era il turno del player rimosso, passa al successivo senza bloccare la partita; con un solo vivo la partita finisce (vince l'ultimo).
- Se l'**host** viene rimosso a gioco in corso, il ruolo 👑 passa automaticamente al primo player vivo ancora connesso (il menù Admin non resta orfano).
- Il player **espulso** continua a ricevere gli snapshot come **spettatore** (vede la partita finire); tutte le sue azioni restano rifiutate dal server.

### Robustezza client (feedback immediato, niente "niente succede")
- **Stato connessione**: se il socket non è connesso (server spento/riavviato) la lobby mostra un banner rosso "Disconnesso dal server — ricarica la pagina".
- **Errori lobby visibili**: i messaggi di errore del server in fase pre-partita ("Servono almeno 2 giocatori", "X non ha scelto una fazione", "Mappa non giocabile…") appaiono in un banner sotto il pulsante Avvia, non nel log nascosto della partita.
- Il selettore fazioni è disabilitato finché il server non conferma l'ingresso in lobby; il pannello addestramento si aggiorna a ogni stato (oro/bottoni); le selezioni residue vengono azzerate quando il turno passa.

## ⚙️ Generazione mondo (pre-partita, menù host)
- **Dimensione mappa:** 12×12 · 16×16 · 20×20 · 24×24.
- **Densità territorio** (slider): acqua 5–70% (default 38%), montagne 5–40% (25%), foresta 5–80% (40%) — la pianura è il residuo; **villaggi** 0–12 (default 4).
- Il server valida/clampa ogni valore: la configurazione inviata dal client non è mai fidata.
- **Connettività garantita:** al creation il server verifica che tutte le basi siano sullo stesso pezzo di terra raggiungibile a piedi (nessuna base isolata o circondata d'acqua); se la mappa generata non lo soddisfa, rigenera con un nuovo seed (fino a 25 tentativi) prima di rifiutare l'avvio. I villaggi sono piazzati solo su caselle raggiungibili dalle basi.

## 📁 Struttura cartelle

```
Strategic_Game_LAN/
├── package.json
├── server/
│   ├── index.js       # Express + Socket.io: lobby, fazioni, config mondo, eventi, admin/kick
│   ├── db.js          # DB in-memory a tabelle relazionali (Game/Players/Tiles/Villages/...)
│   ├── mapgen.js      # Mappa procedurale parametrizzata: PRNG seedato + value noise + spawn/villaggi
│   └── gameLogic.js   # Regole e validazione lato server (fonte di verità): fazioni, turni, undo
├── public/
│   ├── index.html     # Lobby (fazioni+config) + HUD (turno/undo/admin) + Canvas
│   ├── style.css      # Tema scuro, UI pulita
│   └── client.js      # Socket.io + rendering Canvas + click sulle tiles
└── test/
    ├── logic-test.js  # Unit test logiche (terreno, kill reward, spawn limit, fog ritardato, tech, trait)
    └── smoke.js       # Test end-to-end (lobby→fazioni→start→turni sequenziali→undo→commit→kick)
```

## 🔌 Eventi Socket.io

**Client → Server:** `join_game {name}` · `choose_faction {factionId}` · `start_game {mapSize,density:{water,mountain,forest},villages}` (solo host) · `select_unit {unitId}` · `move_unit {unitId,toX,toY}` · `attack_unit {unitId,targetX,targetY}` · `buy_unit {pointId,pointKind:'city'|'village',type}` (punto di addestramento proprio — il kind è obbligatorio perché i PK di Cities e Villages sono autoincrement separati e gli ID possono coincidere; rifiutato se la casella è occupata) · `buy_tech {techId}` (albero tech della propria fazione, consuma TP) · `undo_action` (annulla l'ultima mossa del turno corrente) · `end_turn` (conferma esplicita: passa il turno, rivela la visione accumulata, undo non più possibile) · `kick_player {target}` (solo host; in lobby target=socketId, in partita target=playerId) · `reset_game`

**Server → Client:** `lobby_update {players:[{socketId,name,faction,isHost}],canStart}` · `game_started {playerId}` · `state_update <snapshot filtrato fog of war>` (include `self.is_current`, `self.undo_count`, `self.is_host`, `self.tp`/`self.techs`/`self.mods` = albero tech, `catalog` = roster della propria fazione, `unitTypes` = stat di tutte le unità, `techCatalog` = albero tech della fazione) · `selection_info {reachable,targets,stats}` · `game_log <msg>` (kick/disconnessioni) · `kicked <msg>` (espulso dalla lobby) · `error_msg` · `back_to_lobby`

## 🔊 Effetti sonori
Sintetizzati in tempo reale con WebAudio (nessun file esterno), scattano a diff dello stato: inizio turno, fine turno, movimento unità, attacco, danno subito, conquista di struttura, eliminazione di unità/player. L'`AudioContext` si sblocca al primo click del browser.

## 📖 Guida / Enciclopedia in gioco
- Pulsante **❓** sempre visibile (lobby e partita): apre un overlay modale non distruttivo — non interrompe la partita, non esce dalla lobby; si chiude con ✕, Esc o click sullo sfondo.
- 4 schede: **Fazioni e Unità** (schede fazione + tabella stat/abilità di ogni unità), **Meccaniche ed Economia** (turni, undo, fog of war, villaggi/spawn limit, ricompense kill, TP, vittoria), **Terreni e Modificatori**, **Albero Tecnologie**.
- **Ricerca rapida testuale**: filtra le voci della scheda attiva e mostra il numero di corrispondenze su ogni tab.
- I dati arrivano da `GET /guide.json` (endpoint Express): fonte di verità unica = `FACTIONS`/`TECHS`/economia di `gameLogic.js`, nessuna duplicazione lato client.

## 🧭 Coordinate caselle (stile Excel)
- Ogni casella ha una coordinata alfanumerica: lettere per le colonne (`A..Z`, poi `AA, AB, …` — scalabile a mappe grandi), numeri per le righe da 1; `A1` = angolo in alto a sinistra.
- Le etichette sono disegnate sul canvas in un gutter dedicato (striscia superiore + colonna sinistra); i click sulle etichette sono ignorati.
- Il pannello Info mostra **sempre** la coordinata della casella cliccata/sezionata in cima (`📍 Casella B3`).

## Roadmap (future work)
- Persistenza SQLite reale (`better-sqlite3`, schema identico), reconnection con ripresa turno, AI bot, albero tech espanso, unità navi, più tratti speciali.
