// ============================================================
// GENERAZIONE PROCEDURALE DELLA MAPPA
// PRNG seedato (mulberry32) + value noise bilineare su griglia
// grossolana -> campi elevazione/umidita' in [0,1] -> biomi.
// Biomi: water | plains | forest | mountain
// ============================================================

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise: griglia casuale grossolana interpolata bilineamente
function valueNoise(size, seed, coarse = 5) {
  const rnd = mulberry32(seed);
  const grid = Array.from({ length: coarse + 1 }, () =>
    Array.from({ length: coarse + 1 }, () => rnd()));
  const out = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    const gy = (y / (size - 1)) * coarse;
    const y0 = Math.floor(gy), fy = gy - y0, y1 = Math.min(y0 + 1, coarse);
    for (let x = 0; x < size; x++) {
      const gx = (x / (size - 1)) * coarse;
      const x0 = Math.floor(gx), fx = gx - x0, x1 = Math.min(x0 + 1, coarse);
      const top = grid[y0][x0] * (1 - fx) + grid[y0][x1] * fx;
      const bot = grid[y1][x0] * (1 - fx) + grid[y1][x1] * fx;
      row.push(top * (1 - fy) + bot * fy);
    }
    out.push(row);
  }
  return out;
}

const BIOME = { WATER: 'water', PLAINS: 'plains', FOREST: 'forest', MOUNTAIN: 'mountain' };

function generateMap(size, seed) {
  const elev = valueNoise(size, (seed * 7 + 1) >>> 0);
  const moist = valueNoise(size, (seed * 13 + 5) >>> 0);
  const tiles = []; // [y][x] -> biome
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      if (elev[y][x] < 0.38) row.push(BIOME.WATER);
      else if (elev[y][x] > 0.75) row.push(BIOME.MOUNTAIN);
      else if (moist[y][x] > 0.62) row.push(BIOME.FOREST);
      else row.push(BIOME.PLAINS);
    }
    tiles.push(row);
  }
  return { tiles };
}

// Uno spawn e' valido se ha almeno un vicino ortogonale camminabile
function hasWalkableNeighbor(tiles, x, y) {
  const size = tiles.length;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    if (tiles[ny][nx] === BIOME.PLAINS || tiles[ny][nx] === BIOME.FOREST) return true;
  }
  return false;
}

// Punti spawn: caselle terrestri che massimizzano la distanza minima
// reciproca (fino a `count` giocatori), mai isolate.
function findSpawns(tiles, count) {
  const size = tiles.length;
  const candidates = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if ((tiles[y][x] === BIOME.PLAINS || tiles[y][x] === BIOME.FOREST) && hasWalkableNeighbor(tiles, x, y))
        candidates.push({ x, y });

  const spawns = [];
  let guard = count * 5000;
  while (spawns.length < count && guard-- > 0) {
    let best = null, bestScore = -1;
    for (const c of candidates) {
      if (spawns.some(s => s.x === c.x && s.y === c.y)) continue;
      const dMin = spawns.length
        ? Math.min(...spawns.map(s => Math.abs(s.x - c.x) + Math.abs(s.y - c.y)))
        : 999;
      if (dMin > bestScore) { bestScore = dMin; best = c; }
    }
    if (!best) break;
    spawns.push(best);
  }
  return spawns;
}

module.exports = { generateMap, findSpawns, BIOME };
