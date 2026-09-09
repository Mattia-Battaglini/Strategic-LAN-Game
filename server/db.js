// ============================================================
// DB IN-MEMORY — tabelle "relazionali" (stesso modello di SQLite)
// TABELLE: Game, Players, Tiles, TileVisibility, Cities, Units
// Ogni tabella ha PK autoincrement `id`. Per passare a SQLite reale
// basta sostituire questa classe con better-sqlite3: lo schema
// delle tabelle resta identico (vedi README).
// ============================================================

class Table {
  constructor(name) {
    this.name = name;
    this.rows = new Map();
    this._seq = 0;
  }
  insert(data) {
    const id = ++this._seq;
    const row = Object.assign({ id }, data);
    this.rows.set(id, row);
    return row;
  }
  get(id) { return this.rows.get(id) || null; }
  all() { return [...this.rows.values()]; }
  where(fn) { return this.all().filter(fn); }
  update(id, patch) {
    const r = this.rows.get(id);
    if (!r) return null;
    Object.assign(r, patch);
    return r;
  }
  remove(id) { return this.rows.delete(id); }
}

class DB {
  constructor() { this.reset(); }
  reset() {
    this.Game           = new Table('Game');            // stato partita (1 riga)
    this.Players        = new Table('Players');         // giocatori
    this.Tiles          = new Table('Tiles');           // caselle mappa
    this.TileVisibility = new Table('TileVisibility');  // nebbia di guerra (tile_id, player_id)
    this.Cities         = new Table('Cities');          // città
    this.Units          = new Table('Units');           // unità militari
  }
}

module.exports = { DB };
