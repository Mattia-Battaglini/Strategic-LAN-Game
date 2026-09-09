# ⚔️ 4X Lite — Multiplayer LAN

Gioco 4X lite (eXplore, eXpand, eXploit, eXterminate) ispirato a *The Battle of Polytopia* / *Civilization*, giocabile in multiplayer LAN via browser. Partite veloci su griglia 16×16, turni asincroni per round, nebbia di guerra lato server (anti-cheat).

**Stack:** Node.js + Express · Socket.io · Vanilla JS ES6+ · HTML5 Canvas · DB in-memory a tabelle relazionali (modello identico a SQLite).

## Avvio rapido

```bash
npm install
npm start          # server su http://localhost:3000
# da altre macchine della LAN: http://<IP-host>:3000
npm run smoke      # (server avviato) test end-to-end automatico
```

Apri `http://localhost:3000` in più browser/machine, inserisci un nome, il primo arrivato (host) preme **Avvia Partita**.

## 🗄️ SCHEMA DB — PUNTO DI RIFERIMENTO ASSOLUTO

| Tabella | Attributi |
|---|---|
| **Game** | `id` PK · `map_size` INT · `seed` INT · `round` INT · `phase` ENUM('playing','finished') · `winner_id` FK→Players.id NULL · `spawn_points` JSON |
| **Players** | `id` PK · `name` TEXT · `color` TEXT · `gold` INT · `alive` BOOL · `turn_ended` BOOL · `last_acted_round` INT · `socket_id` TEXT |
| **Tiles** | `id` PK · `x` INT · `y` INT · `biome` ENUM('water','plains','forest','mountain') |
| **TileVisibility** | `tile_id` FK→Tiles.id · `player_id` FK→Players.id — **PK composito (tile_id, player_id)** = nebbia di guerra |
| **Cities** | `id` PK · `name` TEXT · `owner_id` FK→Players.id · `tile_id` FK→Tiles.id |
| **Units** | `id` PK · `type` ENUM('warrior','archer','rider','defender') · `owner_id` FK→Players.id · `x` INT · `y` INT · `hp` INT · `has_moved` BOOL |

### Stat unità (fonte di verità: `server/gameLogic.js → UNIT_TYPES`)

| Tipo | Costo ⭐ | HP | ATK | DEF | MOV | RNG |
|---|---|---|---|---|---|---|
| Warrior  | 20 | 10 | 4 | 1 | 1 | 1 (melee) |
| Archer   | 30 | 8  | 3 | 0 | 1 | 2 (distanza) |
| Rider    | 40 | 9  | 5 | 1 | 2 | 1 (veloce) |
| Defender | 35 | 16 | 2 | 3 | 1 | 1 (alta difesa) |

### Regole chiave
- **Turni asincroni per round (fine turno reversibile):** ogni player agisce quando vuole. `end_turn` mette il player in stato *in sospeso* (`turn_ended=true`, nessuna azione possibile) ma è **annullabile** con `cancel_end_turn` finché l'avversario sta ancora giocando. Quando tutti i giocatori vivi hanno terminato → **commit**: incasso oro (`10 + 5×città`), reset unità, `round++`. Da quel punto la fine turno non è più reversibile.
- **Movimento (BFS):** acqua/montagna inattraversabili, nemici bloccano il percorso, amiche impilabili. Un'unità agisce una volta per round (`has_moved`).
- **Attacco:** distanza Manhattan ≤ RNG; danno = max(1, ATK − DEF − bonus terreno); la foresta dà +1 DEF al difensore.
- **eXterminate:** entrare nella città nemica la conquista; chi resta senza città né unità è eliminato; vince l'ultimo vivo.
- **Nebbia di guerra (anti-cheat):** il server invia a ogni client SOLO le caselle in `TileVisibility` del player (visione: raggio 2 attorno alle unità, raggio 3 permanente attorno alle città).

## 📁 Struttura cartelle

```
Strategic_Game_LAN/
├── package.json
├── server/
│   ├── index.js       # Express + Socket.io: lobby, eventi, broadcast
│   ├── db.js          # DB in-memory a tabelle relazionali (Game/Players/Tiles/...)
│   ├── mapgen.js      # Mappa procedurale: PRNG seedato + value noise + spawn
│   └── gameLogic.js   # Regole e validazione lato server (fonte di verità)
├── public/
│   ├── index.html     # Lobby + HUD + Canvas
│   ├── style.css      # Tema scuro, UI pulita
│   └── client.js      # Socket.io + rendering Canvas + click sulle tiles
└── test/
    └── smoke.js       # Test end-to-end (lobby→start→move→fog of war)
```

## 🔌 Eventi Socket.io

**Client → Server:** `join_game {name}` · `start_game` (solo host) · `select_unit {unitId}` · `move_unit {unitId,toX,toY}` · `attack_unit {unitId,targetX,targetY}` · `buy_unit {cityId,type}` · `end_turn` (fine turno in sospeso, reversibile) · `cancel_end_turn` (revoca la fine turno in sospeso) · `reset_game`

**Server → Client:** `lobby_update {players,canStart}` · `game_started {playerId}` · `state_update <snapshot filtrato fog of war>` · `selection_info {reachable,targets,stats}` · `error_msg` · `back_to_lobby`

## Roadmap (future work)
- Persistenza SQLite reale (`better-sqlite3`, schema identico), reconnection, AI bot, albero tech espanso, unità navi, mappe 32×32.
