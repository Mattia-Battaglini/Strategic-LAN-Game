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
| **Players** | `id` PK · `name` TEXT · `color` TEXT · `faction` TEXT · `gold` INT · `alive` BOOL · `last_acted_round` INT · `socket_id` TEXT |
| **Tiles** | `id` PK · `x` INT · `y` INT · `biome` ENUM('water','plains','forest','mountain') |
| **TileVisibility** | `tile_id` FK→Tiles.id · `player_id` FK→Players.id — **PK composito (tile_id, player_id)** = nebbia di guerra |
| **Cities** | `id` PK · `name` TEXT · `owner_id` FK→Players.id · `tile_id` FK→Tiles.id |
| **Villages** | `id` PK · `name` TEXT · `owner_id` FK→Players.id NULL (neutro) · `tile_id` FK→Tiles.id |
| **Units** | `id` PK · `type` TEXT (chiave unica globale, prefisso fazione_) · `owner_id` FK→Players.id · `x` INT · `y` INT · `hp` INT · `has_moved` BOOL |

### Fazioni e unità (fonte di verità: `server/gameLogic.js → FACTIONS`)

Ogni fazione ha un **roster proprio** con statistiche diverse (costo, HP, ATK, DEF, MOV, RNG, VISIONE) e tratti speciali. Il colore del player = colore della fazione; le chiavi unità sono uniche globali (`fazione_tipo`).

| Fazione | Carattere | Unità (costo/HP/ATK/DEF/MOV/RNG/VIS) |
|---|---|---|
| **Valoria** 🔴 | bilanciata | Guerriero 20/10/4/1/1/1/2 · Archer 30/8/3/0/1/2/3 · Cavaliere 40/9/5/1/2/1/3 · Difensore 35/16/2/3/1/1/2 |
| **Nordmark** 🔵 | pesante/difensiva | Berserker 25/8/6/0/1/1/2 · Muro di Scudi 35/20/2/4/1/1/2 · Cav. del Lupo 45/10/5/1/3/1/3 · Cacciatore 30/9/3/1/2/2/4 |
| **Saharim** 🟠 | rapida/scout | Scout 20/7/2/0/3/1/**5** · Lanciere 35/9/4/1/2/2/3 · Cav. di Duna 40/8/5/0/3/1/3 · Guardiano 30/12/2/2/1/1/3 |
| **Aqualis** 🟢 | costiera | Corsaro 30/9/5/1/1/1/2 · Scagliatore 25/7/3/0/1/**3**/4 · Nuotatore 35/8/3/1/2/1/3 (**🌊 swim**: attraversa l'acqua) · Guardia delle Maree 40/14/3/3/1/1/2 |

### Regole chiave
- **Turni strettamente sequenziali:** la coda dei turni (`turn_queue`) è ciclica nell'ordine di join. Gioca il player corrente, tutti gli altri attendono ("In attesa di X…"). Il turno passa al successivo **solo quando il player corrente conferma esplicitamente** la fine turno (con dialog di conferma).
- **Annullamento mosse (undo):** durante il proprio turno ogni azione (muovi/attacca/addestra) pusha uno snapshot dello stato; `undo_action` lo ripristina. La **conferma della fine turno svuota lo stack**: da quel punto le mosse non sono più reversibili. Undo disponibile fino a 30 mosse per turno.
- **Commit di round:** quando il ciclo torna al player che ha aperto il round → incasso oro per tutti i vivi (`10 + 5×città + 8×villaggi`), reset `has_moved`, `round++`.
- **Villaggi:** piazzati a caso sulla mappa (numero configurabile pre-partita). Conquistarli entrando con un'unità dà **+8 oro/round** e li trasforma in **punto di addestramento extra** (come le città).
- **Movimento (BFS):** montagna sempre inattraversabile; acqua inattraversabile salvo trait `swim`; nemici bloccano il percorso, amiche impilabili. Un'unità agisce una volta per round (`has_moved`).
- **Attacco:** distanza Manhattan ≤ RNG; danno = max(1, ATK − DEF − bonus terreno); la foresta dà +1 DEF al difensore.
- **eXterminate/eXpand:** entrare nella città nemica la conquista; chi resta senza città né unità è eliminato; vince l'ultimo vivo.
- **Nebbia di guerra (anti-cheat):** il server invia a ogni client SOLO le caselle in `TileVisibility` del player (visione: raggio = stat VISIONE dell'unità, raggio 3 permanente attorno a città/villaggi propri).

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
    └── smoke.js       # Test end-to-end (lobby→fazioni→start→turni sequenziali→undo→commit→kick)
```

## 🔌 Eventi Socket.io

**Client → Server:** `join_game {name}` · `choose_faction {factionId}` · `start_game {mapSize,density:{water,mountain,forest},villages}` (solo host) · `select_unit {unitId}` · `move_unit {unitId,toX,toY}` · `attack_unit {unitId,targetX,targetY}` · `buy_unit {pointId,type}` (città **o** villaggio proprio) · `undo_action` (annulla l'ultima mossa del turno corrente) · `end_turn` (conferma esplicita: passa il turno, undo non più possibile) · `kick_player {target}` (solo host; in lobby target=socketId, in partita target=playerId) · `reset_game`

**Server → Client:** `lobby_update {players:[{socketId,name,faction,isHost}],canStart}` · `game_started {playerId}` · `state_update <snapshot filtrato fog of war>` (include `self.is_current`, `self.undo_count`, `self.is_host`, `catalog` = roster della propria fazione, `unitTypes` = stat di tutte le unità) · `selection_info {reachable,targets,stats}` · `game_log <msg>` (kick/disconnessioni) · `kicked <msg>` (espulso dalla lobby) · `error_msg` · `back_to_lobby`

## Roadmap (future work)
- Persistenza SQLite reale (`better-sqlite3`, schema identico), reconnection con ripresa turno, AI bot, albero tech espanso, unità navi, più tratti speciali.
