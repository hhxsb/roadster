// Builds all runtime game data from the raw OSM + DEM downloads.
//   node tools/build_world.mjs
// Outputs (public/data):
//   world.json      route, stubs, terrain/landcover grid metadata, streets, landmarks
//   terrain.bin     Int16 heights (decimetres), carved for the freeways
//   landcover.bin   Uint8 landcover classes
//   buildings.json  building footprints with heights
//   trees.bin       Int16 tree positions (x,z in 0.5 m units) + type
// World frame (three.js): x = metres east, z = metres SOUTH (z = -north), y = up.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { project, BBOX } from './geo.mjs';
import { elevation } from './dem.mjs';
import { unproject } from './geo.mjs';

const OUT = 'public/data';
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- constants
export const LANES = 4, LANE_W = 3.7;
const CARRIAGE = LANES * LANE_W;            // 14.8
const R_SHOULDER = 3.0, L_SHOULDER = 1.2, MEDIAN = 1.4;
// offsets relative to the route line (= centre of our carriageway), +right
const OFF_RIGHT = CARRIAGE / 2 + R_SHOULDER;                        // 10.4
const OFF_LEFT = -(CARRIAGE / 2 + L_SHOULDER * 2 + MEDIAN + CARRIAGE + R_SHOULDER); // -28.4
const ROAD_CENTER = (OFF_RIGHT + OFF_LEFT) / 2;
const ROAD_HALF = (OFF_RIGHT - OFF_LEFT) / 2;
const LAKE_LEVEL = 5.1;
const FLOAT_RE = /Floating|Lacey V\. Murrow|Homer M\. Hadley|Hadley/i;

const dem = (x, z) => { const [la, lo] = unproject(x, -z); return elevation(la, lo); };

// ---------------------------------------------------------------- paths
const legsRaw = JSON.parse(fs.readFileSync('rawdata/legs.json', 'utf8'));
const legs = {};
for (const k in legsRaw) legs[k] = withArc(legsRaw[k].map((p) => ({ ...p, z: -p.n, leg: k })));

function withArc(pts) {
  let s = 0;
  pts.forEach((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); p.s = s; });
  return pts;
}
function at(path, s) { // interpolated point + attributes of the segment
  s = Math.max(0, Math.min(path[path.length - 1].s, s));
  let lo = 0, hi = path.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path[m].s <= s) lo = m; else hi = m; }
  const a = path[lo], b = path[hi], t = (s - a.s) / Math.max(1e-6, b.s - a.s);
  return { ...a, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s };
}
function dirAt(path, s) {
  const a = at(path, s - 5), b = at(path, s + 5);
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return [(b.x - a.x) / l, (b.z - a.z) / l];
}
function slice(path, s0, s1, step = 2) {
  const out = [];
  const n = Math.max(1, Math.round(Math.abs(s1 - s0) / step));
  for (let i = 0; i <= n; i++) out.push(at(path, s0 + ((s1 - s0) * i) / n));
  return out;
}
function closestPair(A, B) {
  let best = { d: Infinity };
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    const d = Math.hypot(A[i].x - B[j].x, A[i].z - B[j].z);
    if (d < best.d) best = { d, sa: A[i].s, sb: B[j].s };
  }
  return best;
}
function hermite(p0, d0, p1, d1, maxspeed, name) {
  const chord = Math.hypot(p1.x - p0.x, p1.z - p0.z), m = chord * 1.1;
  const n = Math.max(4, Math.round(chord / 2)), out = [];
  for (let i = 1; i < n; i++) {
    const t = i / n, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    out.push({ x: h00 * p0.x + h10 * m * d0[0] + h01 * p1.x + h11 * m * d1[0],
      z: h00 * p0.z + h10 * m * d0[1] + h01 * p1.z + h11 * m * d1[1],
      lanes: LANES, bridge: null, tunnel: null, layer: 0, maxspeed, name, leg: 'ramp' });
  }
  return out;
}

// Junctions in driving order; lead = how far before/after the closest point the ramp starts/ends.
const ORDER = ['i5', 'i90', 'i405', 'sr520'];
const J = [
  { a: 'i5', b: 'i90', leadA: 420, leadB: 260, name: 'I-5 to I-90 East ramp', speed: 50 },
  { a: 'i90', b: 'i405', leadA: 380, leadB: 320, name: 'I-90 to I-405 North ramp', speed: 50 },
  { a: 'i405', b: 'sr520', leadA: 300, leadB: 320, name: 'I-405 to SR 520 West ramp', speed: 50 },
  { a: 'sr520', b: 'i5', leadA: 0, leadB: 520, name: 'SR 520 to I-5 South ramp', speed: 45 },
];
for (const j of J) {
  const cp = closestPair(legs[j.a], legs[j.b]);
  j.sa = Math.max(0, cp.sa - j.leadA);
  j.sb = Math.min(legs[j.b].at(-1).s, cp.sb + j.leadB);
  console.log('junction', j.a, '->', j.b, 'gap', cp.d.toFixed(0), 'cutA', j.sa.toFixed(0), '/', legs[j.a].at(-1).s.toFixed(0), 'cutB', j.sb.toFixed(0));
}
const legRange = {};
for (let i = 0; i < 4; i++) legRange[ORDER[i]] = { s0: J[(i + 3) % 4].sb, s1: J[i].sa };

// raw loop (starts on I-5 right after the 520 merge)
let loopRaw = [];
for (let i = 0; i < 4; i++) {
  const k = ORDER[i], r = legRange[k], j = J[i];
  loopRaw.push(...slice(legs[k], r.s0, r.s1));
  const p0 = at(legs[j.a], j.sa), p1 = at(legs[j.b], j.sb);
  loopRaw.push(...hermite(p0, dirAt(legs[j.a], j.sa), p1, dirAt(legs[j.b], j.sb), j.speed, j.name));
}

// rotate so the loop starts at the start/finish line on I-5 SB downtown
const START = { x: -5150, z: -950 }; // ~ I-5 at Olive Way / Pine St
{
  let bi = 0, bd = Infinity;
  loopRaw.forEach((p, i) => { const d = Math.hypot(p.x - START.x, p.z - START.z); if (d < bd) { bd = d; bi = i; } });
  loopRaw = loopRaw.slice(bi).concat(loopRaw.slice(0, bi));
}

function resampleClosed(pts, step, closed) {
  const P = withArc(closed ? [...pts, { ...pts[0] }] : pts.map((p) => ({ ...p })));
  const L = P.at(-1).s, n = Math.round(L / step), out = [];
  for (let i = 0; i < (closed ? n : n + 1); i++) out.push(at(P, (i * L) / n));
  return out;
}
function smoothXZ(pts, sigmaPts, closed) {
  const n = pts.length, w = Math.ceil(sigmaPts * 3), K = [];
  for (let k = -w; k <= w; k++) K.push(Math.exp(-(k * k) / (2 * sigmaPts * sigmaPts)));
  const out = pts.map((p) => ({ ...p }));
  for (let i = 0; i < n; i++) {
    let sx = 0, sz = 0, sw = 0;
    for (let k = -w; k <= w; k++) {
      let j = i + k;
      if (closed) j = (j + n) % n; else if (j < 0 || j >= n) continue;
      sx += pts[j].x * K[k + w]; sz += pts[j].z * K[k + w]; sw += K[k + w];
    }
    out[i].x = sx / sw; out[i].z = sz / sw;
  }
  return out;
}

// ---------------------------------------------------------------- landcover raster
const [gx0, gn1] = project(BBOX.n, BBOX.w), [gx1, gn0] = project(BBOX.s, BBOX.e);
const CELL = 10;
const G = { x0: Math.floor(gx0 / CELL) * CELL, z0: Math.floor(-gn1 / CELL) * CELL };
G.nx = Math.ceil((gx1 - G.x0) / CELL) + 1;
G.nz = Math.ceil((-gn0 - G.z0) / CELL) + 1;
G.cell = CELL;
console.log('grid', G.nx, 'x', G.nz);
const LC = { LAND: 0, LAKE: 1, SEA: 2, PARK: 3, FOREST: 4, ROAD: 5, BUILDING: 6, STREET: 7, GOLF: 8 };
const land = new Uint8Array(G.nx * G.nz);

function assembleRings(ways) {
  // ways: arrays of [x,z]; chain by endpoints into closed rings
  const rings = [], pool = ways.map((w) => w.slice());
  const key = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  while (pool.length) {
    let ring = pool.pop();
    let guard = 0;
    while (key(ring[0]) !== key(ring.at(-1)) && guard++ < 5000) {
      const endK = key(ring.at(-1));
      let found = -1, rev = false;
      for (let i = 0; i < pool.length; i++) {
        if (key(pool[i][0]) === endK) { found = i; break; }
        if (key(pool[i].at(-1)) === endK) { found = i; rev = true; break; }
      }
      if (found < 0) break; // open ring (clipped by query) - close it as is
      const w = pool.splice(found, 1)[0];
      ring = ring.concat((rev ? w.reverse() : w).slice(1));
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}
function fillRings(rings, cb) { // even-odd scanline over grid cell centres
  const edges = [];
  let zmin = Infinity, zmax = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    if (a[1] === b[1]) continue;
    edges.push(a, b);
    zmin = Math.min(zmin, a[1]); zmax = Math.max(zmax, a[1]);
  }
  const r0 = Math.max(0, Math.floor((zmin - G.z0) / CELL)), r1 = Math.min(G.nz - 1, Math.ceil((zmax - G.z0) / CELL));
  for (let row = r0; row <= r1; row++) {
    const z = G.z0 + row * CELL, xs = [];
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i], b = edges[i + 1];
      if ((a[1] <= z) !== (b[1] <= z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - G.x0) / CELL)), c1 = Math.min(G.nx - 1, Math.floor((xs[k + 1] - G.x0) / CELL));
      for (let c = c0; c <= c1; c++) cb(row * G.nx + c);
    }
  }
}
const toXZ = (g) => { const [x, n] = project(g.lat, g.lon); return [x, -n]; };
function relationRings(e) {
  const outer = [], inner = [];
  for (const m of e.members || []) if (m.type === 'way' && m.geometry) (m.role === 'inner' ? inner : outer).push(m.geometry.filter(Boolean).map(toXZ));
  return assembleRings(outer).concat(assembleRings(inner));
}

// lakes + bay
const lakes = JSON.parse(fs.readFileSync('rawdata/lakes.json', 'utf8'));
const waterRings = { lake: [], sea: [] };
for (const e of lakes.elements) {
  const rings = relationRings(e);
  const isSea = /Elliott/.test(e.tags.name);
  fillRings(rings, (i) => { land[i] = isSea ? LC.SEA : LC.LAKE; });
  (isSea ? waterRings.sea : waterRings.lake).push(...rings);
}
// small waters (ponds, ship canal)
const water = JSON.parse(fs.readFileSync('rawdata/water.json', 'utf8'));
for (const e of water.elements) {
  if (e.tags.natural === 'coastline') continue;
  const rings = e.type === 'way' ? [e.geometry.map(toXZ)] : relationRings(e);
  fillRings(rings, (i) => { if (land[i] === LC.LAND) land[i] = LC.LAKE; });
}
// green
const green = JSON.parse(fs.readFileSync('rawdata/green.json', 'utf8'));
for (const e of green.elements) {
  const t = e.tags, rings = e.type === 'way' ? [e.geometry.map(toXZ)] : relationRings(e);
  const cls = t.natural === 'wood' || t.landuse === 'forest' ? LC.FOREST : t.leisure === 'golf_course' ? LC.GOLF : LC.PARK;
  fillRings(rings, (i) => { if (land[i] === LC.LAND || (land[i] === LC.PARK && cls === LC.FOREST)) land[i] = cls; });
}

// ---------------------------------------------------------------- terrain
const H = new Float32Array(G.nx * G.nz);
console.time('dem');
for (let r = 0; r < G.nz; r++) for (let c = 0; c < G.nx; c++) H[r * G.nx + c] = dem(G.x0 + c * CELL, G.z0 + r * CELL);
console.timeEnd('dem');
for (let i = 0; i < H.length; i++) {
  if (H[i] < 0.4 && land[i] !== LC.LAKE) land[i] = LC.SEA;
  if (land[i] === LC.SEA) H[i] = Math.min(H[i], -6);
  if (land[i] === LC.LAKE && H[i] < LAKE_LEVEL + 1.5) H[i] = Math.min(H[i], LAKE_LEVEL - 4);
}
function sampleH(x, z) {
  const fx = (x - G.x0) / CELL, fz = (z - G.z0) / CELL;
  const c = Math.max(0, Math.min(G.nx - 2, Math.floor(fx))), r = Math.max(0, Math.min(G.nz - 2, Math.floor(fz)));
  const ax = fx - c, az = fz - r, i = r * G.nx + c;
  return (H[i] * (1 - ax) + H[i + 1] * ax) * (1 - az) + (H[i + G.nx] * (1 - ax) + H[i + G.nx + 1] * ax) * az;
}
function landAt(x, z) {
  const c = Math.round((x - G.x0) / CELL), r = Math.round((z - G.z0) / CELL);
  if (c < 0 || r < 0 || c >= G.nx || r >= G.nz) return LC.LAND;
  return land[r * G.nx + c];
}

// ---------------------------------------------------------------- road profiles
function annotate(pts) {
  for (const p of pts) {
    const lake = landAt(p.x, p.z) === LC.LAKE;
    p.kind = p.tunnel ? 'tunnel' : (p.bridge && lake && FLOAT_RE.test(p.name || '')) ? 'floating' : p.bridge ? 'bridge' : 'ground';
    if (!p.bridge && !p.tunnel && lake) p.kind = 'bridge'; // ramps over water
  }
  // short open gaps between tunnel sections (lids) become tunnel too
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].kind === 'tunnel') continue;
    let j = i; while (j < pts.length && pts[j].kind !== 'tunnel') j++;
    if (i > 0 && j < pts.length && (j - i) * 2 < 80) for (let k = i; k < j; k++) pts[k].kind = 'tunnel';
    i = j;
  }
  // merge tiny ground gaps (<40 m) between bridge spans into bridge to avoid bumps
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].kind !== 'ground') continue;
    let j = i; while (j < pts.length && pts[j].kind === 'ground') j++;
    if (i > 0 && j < pts.length && (j - i) * 2 < 40 && pts[i - 1].kind !== 'tunnel' && pts[j].kind !== 'tunnel') for (let k = i; k < j; k++) pts[k].kind = 'bridge';
    i = j;
  }
}
function profile(pts, closed) {
  const n = pts.length;
  const h = pts.map((p) => (p.kind === 'floating' ? LAKE_LEVEL + (p.leg === 'sr520' ? 5.5 : 3.0) : sampleH(p.x, p.z)));
  // interpolate across bridge/tunnel runs
  const free = (k) => pts[k].kind === 'ground' || pts[k].kind === 'floating';
  for (let i = 0; i < n; i++) {
    if (free(i)) continue;
    let j = i; while (j < n && !free(j)) j++;
    const hi = i > 0 ? h[i - 1] : closed ? h[n - 1] : h[Math.min(j, n - 1)];
    const hj = j < n ? h[j] : closed ? h[0] : hi;
    for (let k = i; k < j; k++) h[k] = hi + ((hj - hi) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  // smoothing (sigma 40 m)
  let cur = h;
  for (const sig of [20, 10]) {
    const w = Math.ceil(sig * 3), K = [];
    for (let k = -w; k <= w; k++) K.push(Math.exp(-(k * k) / (2 * sig * sig)));
    const nxt = new Array(n);
    for (let i = 0; i < n; i++) {
      if (pts[i].kind === 'floating' && pts[Math.max(0, i - w)].kind === 'floating' && pts[Math.min(n - 1, i + w)].kind === 'floating') { nxt[i] = cur[i]; continue; }
      let s = 0, sw = 0;
      for (let k = -w; k <= w; k++) {
        let j = i + k;
        if (closed) j = (j + n) % n; else j = Math.max(0, Math.min(n - 1, j));
        s += cur[j] * K[k + w]; sw += K[k + w];
      }
      nxt[i] = s / sw;
    }
    cur = nxt;
  }
  // grade limit (6 %): relax steep steps by moving both neighbours; floating decks stay put
  // The upper envelope (valleys filled) and lower envelope (peaks cut) are both
  // grade-limited, so their average is too.
  const G_MAX = 0.055 * 2;
  const env = (sign) => {
    const e = cur.map((v) => v * sign), passes = closed ? 2 : 1;
    for (let p = 0; p < passes; p++) {
      for (let i = 1; i < n + (closed ? 1 : 0); i++) { const a = (i - 1) % n, b = i % n; e[b] = Math.max(e[b], e[a] - G_MAX); }
      for (let i = n - 2 + (closed ? 1 : 0); i >= 0; i--) { const a = (i + 1) % n, b = i; e[b] = Math.max(e[b], e[a] - G_MAX); }
    }
    return e.map((v) => v * sign);
  };
  const up = env(1), lo = env(-1);
  for (let i = 0; i < n; i++) cur[i] = (up[i] + lo[i]) / 2;
  for (let i = 0; i < n; i++) if (pts[i].kind === 'floating') cur[i] = Math.max(cur[i], LAKE_LEVEL + 2.5);
  // final light smoothing to round off grade breaks
  const fin = cur.slice();
  for (let i = 0; i < n; i++) {
    if (pts[i].kind === 'floating') continue;
    let s = 0, c = 0;
    for (let k = -10; k <= 10; k++) { let j = i + k; if (closed) j = (j + n) % n; else j = Math.max(0, Math.min(n - 1, j)); s += cur[j]; c++; }
    fin[i] = s / c;
  }
  pts.forEach((p, i) => { p.y = fin[i]; });
}

let loop = smoothXZ(resampleClosed(loopRaw, 2, true), 7, true);
loop = withArc(loop);
annotate(loop);
profile(loop, true);
const LOOP_LEN = loop.at(-1).s + Math.hypot(loop[0].x - loop.at(-1).x, loop[0].z - loop.at(-1).z);
console.log('loop length', (LOOP_LEN / 1000).toFixed(2), 'km', loop.length, 'pts');

// stubs: unused parts of the legs beyond the junctions, extended into the haze
const stubs = [];
function addStub(leg, s0, s1, extendEnd, extendStart) {
  if (s1 - s0 < 300) return;
  let pts = slice(legs[leg], s0, s1);
  const ext = (p, d, len) => { const out = []; for (let k = 2; k <= len; k += 2) out.push({ ...p, x: p.x + d[0] * k, z: p.z + d[1] * k, bridge: null, tunnel: null }); return out; };
  if (extendEnd) pts = pts.concat(ext(pts.at(-1), dirAt(legs[leg], s1 - 1), 1600));
  if (extendStart) { const d = dirAt(legs[leg], s0 + 1); pts = ext(pts[0], [-d[0], -d[1]], 1600).reverse().concat(pts); }
  pts = withArc(smoothXZ(resampleClosed(pts, 2, false), 7, false));
  annotate(pts);
  profile(pts, false);
  stubs.push({ leg, pts });
}
for (let i = 0; i < 4; i++) {
  const k = ORDER[i], r = legRange[k], L = legs[k].at(-1).s;
  addStub(k, r.s1, L, true, false);   // continues past the exit
  addStub(k, 0, r.s0, false, true);   // comes in before the merge
}
console.log('stubs', stubs.map((s) => s.leg + ':' + (s.pts.at(-1).s / 1000).toFixed(1) + 'km').join(' '));

// ---------------------------------------------------------------- carve terrain
const roadDist = new Float32Array(G.nx * G.nz).fill(1e9);
const roadY = new Float32Array(G.nx * G.nz);
const roadKind = new Uint8Array(G.nx * G.nz);
// Ceiling from every open (non-tunnel) road: the nearest road shapes each cell, but where two
// roads at different heights run close (interchanges, stubs splitting off), terrain shaped for
// the higher one would otherwise bury the lower one.
const ROOF = new Float32Array(G.nx * G.nz).fill(1e9);
const SHOULDER = 10;
const KIND = { ground: 0, bridge: 1, tunnel: 2, floating: 3 };
function stamp(pts, closed) {
  const R = ROAD_HALF + 60;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], o = pts[(i - 1 + pts.length) % pts.length];
    let dx = q.x - o.x, dz = q.z - o.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const rx = -dz, rz = dx; // right vector (x east, z south): heading (dx,dz) -> right = (-dz, dx)
    const cx = p.x + rx * ROAD_CENTER, cz = p.z + rz * ROAD_CENTER;
    const c0 = Math.max(0, Math.floor((cx - R - G.x0) / CELL)), c1 = Math.min(G.nx - 1, Math.ceil((cx + R - G.x0) / CELL));
    const r0 = Math.max(0, Math.floor((cz - R - G.z0) / CELL)), r1 = Math.min(G.nz - 1, Math.ceil((cz + R - G.z0) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const ex = G.x0 + c * CELL - cx, ez = G.z0 + r * CELL - cz;
      // distance measured across the road (lateral) - longitudinal handled by neighbour samples
      const lat = Math.abs(ex * rx + ez * rz), lon = Math.abs(ex * dx + ez * dz);
      if (lon > 1.6) continue;
      const idx = r * G.nx + c;
      if (lat < roadDist[idx]) { roadDist[idx] = lat; roadY[idx] = p.y; roadKind[idx] = KIND[p.kind]; }
      if (p.kind !== 'tunnel' && lat < ROAD_HALF + 2 + SHOULDER) {
        // flat under the deck (girder depth below bridges), then a 1:1 cut slope up from the edge
        const under = p.y - (p.kind === 'ground' ? 0.6 : 2.1);
        ROOF[idx] = Math.min(ROOF[idx], under + Math.max(0, lat - ROAD_HALF - 2));
      }
    }
  }
}
stamp(loop, true);
for (const st of stubs) stamp(st.pts, false);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let i = 0; i < H.length; i++) {
  const d = roadDist[i];
  if (d > ROAD_HALF + 60) continue;
  const ry = roadY[i] - 0.6, k = roadKind[i], t = sstep(ROAD_HALF + 4, ROAD_HALF + 55, d), h0 = H[i];
  if (k === KIND.ground) H[i] = ry + (h0 - ry) * t;
  else if (k === KIND.tunnel) { if (h0 - ry < 10) H[i] = d < ROAD_HALF + 4 ? ry : Math.min(h0, ry + (h0 - ry) * t); else if (h0 < ry + 10.5) H[i] = ry + 10.5; }
  else if (d < ROAD_HALF + 2 && h0 > ry - 1.5) H[i] = Math.min(h0, ry - 1.5 + (h0 - ry) * t);
  if (k !== KIND.tunnel) H[i] = Math.min(H[i], ROOF[i]);
  if (d < ROAD_HALF + 2 && (land[i] === LC.LAND || land[i] === LC.PARK || land[i] === LC.FOREST || land[i] === LC.GOLF) && k !== KIND.tunnel) land[i] = LC.ROAD;
}

// ---------------------------------------------------------------- buildings
function polyArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function inside(pt, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function simplifyRing(r, tol) {
  // drop near-duplicate + collinear points
  const out = [];
  for (const p of r) if (!out.length || Math.hypot(p[0] - out.at(-1)[0], p[1] - out.at(-1)[1]) > 0.4) out.push(p);
  if (out.length > 2 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 0.4) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (cross / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1) < tol) { out.splice(i, 1); changed = true; i--; }
    }
  }
  return out;
}
const parseLen = (v) => { if (!v) return NaN; const m = /([\d.]+)\s*(ft|')?/.exec(v); if (!m) return NaN; return parseFloat(m[1]) * (m[2] ? 0.3048 : 1); };
const seen = new Set(), bparts = [], bouts = [];
for (const f of ['bld_seattle', 'bld_bellevue', 'bld_corridor']) {
  const d = JSON.parse(fs.readFileSync(`rawdata/${f}.json`, 'utf8'));
  for (const e of d.elements) {
    const id = e.type + e.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = e.tags || {};
    let rings;
    if (e.type === 'way') { if (!e.geometry || e.geometry.length < 4) continue; rings = [e.geometry.map(toXZ)]; }
    else rings = relationRings(e).slice(0, 1);
    for (const ring0 of rings) {
      const ring = simplifyRing(ring0, 0.25);
      if (ring.length < 3) continue;
      const area = Math.abs(polyArea(ring));
      if (area < 12) continue;
      const rec = { t, ring, area, part: !!t['building:part'] && !t.building };
      (rec.part ? bparts : bouts).push(rec);
    }
  }
}
// outlines that contain parts are replaced by their parts
const PB = 200, pgrid = new Map();
for (const p of bparts) { let cx = 0, cz = 0; for (const q of p.ring) { cx += q[0]; cz += q[1]; } p.c = [cx / p.ring.length, cz / p.ring.length]; const k = Math.floor(p.c[0] / PB) + ',' + Math.floor(p.c[1] / PB); if (!pgrid.has(k)) pgrid.set(k, []); pgrid.get(k).push(p); }
const finalB = [];
for (const b of bouts) {
  let xs = b.ring.map((q) => q[0]), zs = b.ring.map((q) => q[1]);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), bz0 = Math.min(...zs), bz1 = Math.max(...zs);
  let hasPart = false;
  for (let gx = Math.floor(bx0 / PB); gx <= Math.floor(bx1 / PB) && !hasPart; gx++) for (let gz = Math.floor(bz0 / PB); gz <= Math.floor(bz1 / PB) && !hasPart; gz++) {
    for (const p of pgrid.get(gx + ',' + gz) || []) if (inside(p.c, b.ring)) { hasPart = true; break; }
  }
  if (!hasPart) finalB.push(b);
}
finalB.push(...bparts);
function roadAt(x, z) {
  const c = Math.round((x - G.x0) / CELL), r = Math.round((z - G.z0) / CELL);
  if (c < 0 || r < 0 || c >= G.nx || r >= G.nz) return { d: 1e9 };
  const i = r * G.nx + c; return { d: roadDist[i], y: roadY[i], k: roadKind[i] };
}
const TYPE_H = { house: 7, detached: 7, residential: 8, garage: 3, garages: 3, shed: 3, roof: 4, apartments: 14, commercial: 12, retail: 7, office: 25, industrial: 9, warehouse: 9, school: 10, church: 14, hospital: 30, hotel: 40, university: 16, parking: 12, train_station: 12, stadium: 35, construction: 20, yes: 0 };
const buildings = [];
let removed = 0;
const rnd = mulberry(7);
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
for (const b of finalB) {
  const t = b.t;
  let cx = 0, cz = 0; for (const q of b.ring) { cx += q[0]; cz += q[1]; } cx /= b.ring.length; cz /= b.ring.length;
  // remove buildings sitting on the freeway; lift those above tunnels
  let conflict = false, tunnelY = -1e9;
  for (const q of [...b.ring, [cx, cz]]) { const ra = roadAt(q[0], q[1]); if (ra.d < ROAD_HALF + 3) { if (ra.k === KIND.tunnel) tunnelY = Math.max(tunnelY, ra.y + 9); else conflict = true; } }
  if (conflict) { removed++; continue; }
  let h = parseLen(t.height), minH = parseLen(t.min_height) || 0;
  const lv = parseFloat(t['building:levels']), minLv = parseFloat(t['building:min_level']);
  if (isNaN(h) && !isNaN(lv)) h = lv * 3.3 + (lv > 6 ? 2 : 1);
  if (!minH && !isNaN(minLv)) minH = minLv * 3.3;
  const type = t.building || t['building:part'] || 'yes';
  if (isNaN(h)) {
    h = TYPE_H[type] || 0;
    if (!h) h = b.area > 3000 ? 10 + rnd() * 10 : b.area > 600 ? 8 + rnd() * 8 : b.area > 220 ? 7 + rnd() * 3 : 4 + rnd() * 3;
  }
  if (type === 'roof' && !minH) minH = Math.max(0, h - 1.2);
  let base = Infinity;
  for (const q of b.ring) base = Math.min(base, sampleH(q[0], q[1]));
  if (landAt(cx, cz) === LC.LAKE || landAt(cx, cz) === LC.SEA) base = Math.max(base, landAt(cx, cz) === LC.LAKE ? LAKE_LEVEL : 0);
  if (tunnelY > base) { minH = Math.max(minH, tunnelY - base); if (h < minH + 3) h = minH + 3; }
  // mark occupancy for tree placement
  fillRings([b.ring], (i) => { if (land[i] !== LC.LAKE && land[i] !== LC.SEA) land[i] = LC.BUILDING; });
  buildings.push({
    r: b.ring.flatMap((q) => [Math.round(q[0] * 10), Math.round(q[1] * 10)]),
    b: Math.round((base - 0.5) * 10) / 10, h: Math.round(h * 10) / 10, m: Math.round(minH * 10) / 10,
    t: type.slice(0, 12), roof: t['roof:shape'] || undefined,
    c: t['building:colour'] || t['colour'] || undefined, mat: t['building:material'] || undefined,
    n: t.name && h > 60 ? t.name : undefined,
  });
}
console.log('buildings', buildings.length, 'removed on road', removed, 'tallest', buildings.reduce((a, b) => (b.h > a.h ? b : a)).n);

// ---------------------------------------------------------------- streets
const streetsRaw = JSON.parse(fs.readFileSync('rawdata/streets.json', 'utf8'));
const STREET_CLS = { trunk: 0, primary: 0, secondary: 1, tertiary: 1, motorway_link: 1, trunk_link: 1, primary_link: 1, residential: 2, unclassified: 2, service: 3 };
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  let md = 0, mi = 0;
  const a = pts[0], b = pts.at(-1), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L; if (d > md) { md = d; mi = i; } }
  if (md < tol) return [a, b];
  return dp(pts.slice(0, mi + 1), tol).slice(0, -1).concat(dp(pts.slice(mi), tol));
}
const streets = [];
for (const e of streetsRaw.elements) {
  const cls = STREET_CLS[e.tags.highway];
  if (cls === undefined || !e.geometry) continue;
  if (cls === 3 && e.tags.service && e.tags.service !== 'alley') continue;
  const pts = dp(e.geometry.map(toXZ), 1.0);
  const flat = [cls];
  for (const p of pts) flat.push(Math.round(p[0]), Math.round(p[1]));
  streets.push(flat);
  // occupancy
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 5);
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n;
      const c = Math.round((x - G.x0) / CELL), r = Math.round((z - G.z0) / CELL);
      if (c >= 0 && r >= 0 && c < G.nx && r < G.nz) { const i2 = r * G.nx + c; if (land[i2] === LC.LAND || land[i2] === LC.PARK) land[i2] = LC.STREET; }
    }
  }
}
console.log('streets', streets.length);

// ---------------------------------------------------------------- trees
const trees = [];
const trnd = mulberry(99);
const dens = { [LC.LAND]: 0.05, [LC.PARK]: 0.18, [LC.FOREST]: 0.75, [LC.GOLF]: 0.06 };
for (let r = 1; r < G.nz - 1; r++) for (let c = 1; c < G.nx - 1; c++) {
  const i = r * G.nx + c, cl = land[i];
  let p = dens[cl];
  if (!p) continue;
  // residential land near freeway corridor gets a bit more (sound-wall trees)
  if (roadDist[i] < ROAD_HALF + 30) p *= 2.5;
  if (roadDist[i] < ROAD_HALF + 6) continue;
  const cnt = cl === LC.FOREST ? 2 : 1;
  for (let k = 0; k < cnt; k++) {
    if (trnd() > p) continue;
    const x = G.x0 + (c + trnd() - 0.5) * CELL, z = G.z0 + (r + trnd() - 0.5) * CELL;
    // conifers dominate in forests (PNW)
    const type = cl === LC.FOREST ? (trnd() < 0.7 ? 0 : 1) : trnd() < 0.35 ? 0 : trnd() < 0.85 ? 1 : 2;
    trees.push(Math.round(x * 2), Math.round(z * 2), type);
  }
}
console.log('trees', trees.length / 3);

// ---------------------------------------------------------------- landmarks
const lm = (name, lat, lon, extra = {}) => { const [x, n] = project(lat, lon); return { name, x: Math.round(x), z: Math.round(-n), y: Math.round(sampleH(x, -n) * 10) / 10, ...extra }; };
const landmarks = [
  lm('Space Needle', 47.62051, -122.34928),
  lm('Mount Rainier', 46.8523, -121.7603),
  lm('Lumen Field', 47.5952, -122.3316),
  lm('T-Mobile Park', 47.5914, -122.3325),
];

// ---------------------------------------------------------------- write
const enc = (pts) => pts.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100, KIND[p.kind], p.maxspeed || 60, p.leg, p.name || '']);
function compact(arr) { // de-dupe repeated leg/name strings into tables
  const legsT = [], namesT = [];
  const rows = arr.map((r) => {
    let li = legsT.indexOf(r[5]); if (li < 0) { legsT.push(r[5]); li = legsT.length - 1; }
    let ni = namesT.indexOf(r[6]); if (ni < 0) { namesT.push(r[6]); ni = namesT.length - 1; }
    return [r[0], r[1], r[2], r[3], r[4], li, ni];
  });
  return { legs: legsT, names: namesT, pts: rows };
}
const world = {
  version: 1,
  generated: new Date().toISOString(),
  attribution: 'Map data (c) OpenStreetMap contributors (ODbL). Elevation: Mapzen/AWS Terrain Tiles (USGS 3DEP, SRTM).',
  road: { lanes: LANES, laneW: LANE_W, rShoulder: R_SHOULDER, lShoulder: L_SHOULDER, median: MEDIAN, offLeft: OFF_LEFT, offRight: OFF_RIGHT },
  lakeLevel: LAKE_LEVEL,
  grid: G,
  loop: { length: LOOP_LEN, ...compact(enc(loop)) },
  stubs: stubs.map((s) => ({ leg: s.leg, ...compact(enc(s.pts)) })),
  landmarks,
  streets,
  water: { lake: waterRings.lake.map((r) => dp(r, 3).map((p) => [Math.round(p[0]), Math.round(p[1])])), sea: waterRings.sea.map((r) => dp(r, 3).map((p) => [Math.round(p[0]), Math.round(p[1])])) },
};
fs.writeFileSync(`${OUT}/world.json`, JSON.stringify(world));
const Hq = new Int16Array(H.length);
for (let i = 0; i < H.length; i++) Hq[i] = Math.round(Math.max(-3000, Math.min(3000, H[i] * 10)));
fs.writeFileSync(`${OUT}/terrain.bin`, Buffer.from(Hq.buffer));
fs.writeFileSync(`${OUT}/landcover.bin`, Buffer.from(land.buffer));
fs.writeFileSync(`${OUT}/buildings.json`, JSON.stringify(buildings));
fs.writeFileSync(`${OUT}/trees.bin`, Buffer.from(new Int16Array(trees).buffer));
for (const f of fs.readdirSync(OUT)) console.log(f, (fs.statSync(`${OUT}/${f}`).size / 1e6).toFixed(2), 'MB');

// ---------------------------------------------------------------- debug image
{
  const S = 2, W = Math.floor(G.nx / S), Hh = Math.floor(G.nz / S), img = Buffer.alloc(W * Hh * 3);
  const col = { [LC.LAND]: [200, 196, 186], [LC.LAKE]: [70, 110, 160], [LC.SEA]: [50, 90, 140], [LC.PARK]: [120, 170, 100], [LC.FOREST]: [60, 120, 60], [LC.ROAD]: [90, 90, 90], [LC.BUILDING]: [150, 120, 110], [LC.STREET]: [240, 240, 240], [LC.GOLF]: [150, 200, 120] };
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const i = y * S * G.nx + x * S, c = col[land[i]] || [255, 0, 255], shade = 0.75 + 0.25 * Math.min(1, Math.max(0, H[i] / 120));
    img.set(c.map((v) => Math.min(255, v * shade)), (y * W + x) * 3);
  }
  const plot = (pts, rgb) => { for (const p of pts) { const x = Math.round((p.x - G.x0) / CELL / S), y = Math.round((p.z - G.z0) / CELL / S); if (x >= 0 && y >= 0 && x < W && y < Hh) img.set(rgb, (y * W + x) * 3); } };
  plot(loop.filter((p) => p.kind === 'ground'), [255, 0, 0]);
  plot(loop.filter((p) => p.kind === 'bridge'), [255, 160, 0]);
  plot(loop.filter((p) => p.kind === 'floating'), [255, 255, 0]);
  plot(loop.filter((p) => p.kind === 'tunnel'), [255, 0, 255]);
  for (const s of stubs) plot(s.pts, [0, 220, 255]);
  plot(loop.slice(0, 30), [0, 255, 0]);
  writePNG('rawdata/debug_map.png', W, Hh, img);
  // elevation profile
  const PW = 1600, PH = 300, pimg = Buffer.alloc(PW * PH * 3, 255);
  for (let i = 0; i < loop.length; i++) {
    const x = Math.floor((i / loop.length) * PW), y = PH - 1 - Math.round(loop[i].y * 2 + 20), yt = PH - 1 - Math.round(sampleH(loop[i].x, loop[i].z) * 2 + 20);
    const c = { ground: [200, 0, 0], bridge: [255, 140, 0], floating: [0, 0, 255], tunnel: [200, 0, 200] }[loop[i].kind];
    if (y >= 0 && y < PH) pimg.set(c, (y * PW + x) * 3);
    if (yt >= 0 && yt < PH) pimg.set([120, 120, 120], (yt * PW + x) * 3);
  }
  writePNG('rawdata/debug_profile.png', PW, PH, pimg);
}
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
