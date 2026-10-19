// Runtime world data: loads the prebuilt data files and answers spatial queries
// (route projection, road / terrain / water surfaces).

export const KIND = { GROUND: 0, BRIDGE: 1, TUNNEL: 2, FLOATING: 3 };
export const LC = { LAND: 0, LAKE: 1, SEA: 2, PARK: 3, FOREST: 4, ROAD: 5, BUILDING: 6, STREET: 7, GOLF: 8 };

export class Route {
  constructor(src, closed, road) {
    const n = src.pts.length;
    this.closed = closed;
    this.n = n;
    this.road = road;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.kind = new Uint8Array(n); this.limit = new Uint8Array(n);
    this.legIdx = new Uint8Array(n); this.nameIdx = new Uint16Array(n);
    this.s = new Float64Array(n + 1);
    this.legs = src.legs; this.names = src.names; this.leg = src.leg;
    src.pts.forEach((p, i) => {
      this.x[i] = p[0]; this.y[i] = p[1]; this.z[i] = p[2]; this.kind[i] = p[3]; this.limit[i] = p[4];
      this.legIdx[i] = p[5]; this.nameIdx[i] = p[6];
    });
    for (let i = 0; i < n; i++) {
      const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      let dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      if (i > 0) this.s[i] = this.s[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1]);
    }
    this.s[n] = this.s[n - 1] + (closed ? Math.hypot(this.x[0] - this.x[n - 1], this.z[0] - this.z[n - 1]) : 0);
    this.length = closed ? this.s[n] : this.s[n - 1];
    this.step = this.length / (closed ? n : n - 1);
    // spatial hash of sample indices
    this.cell = 24;
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const k = this.key(Math.floor(this.x[i] / this.cell), Math.floor(this.z[i] / this.cell));
      let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(i);
    }
  }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  wrap(s) { if (!this.closed) return Math.max(0, Math.min(this.length, s)); s %= this.length; return s < 0 ? s + this.length : s; }
  index(s) { // fractional index for arc length s
    s = this.wrap(s);
    let i = Math.min(this.n - 1, Math.floor(s / this.step));
    while (i > 0 && this.s[i] > s) i--;
    while (i < this.n - 1 && this.s[i + 1] <= s) i++;
    const s1 = this.s[i + 1] ?? this.s[i];
    return i + (s1 > this.s[i] ? (s - this.s[i]) / (s1 - this.s[i]) : 0);
  }
  // fills `out` with interpolated frame at arc length s
  frame(s, out = {}) {
    const f = this.index(s), i = Math.floor(f), t = f - i;
    const j = this.closed ? (i + 1) % this.n : Math.min(this.n - 1, i + 1);
    out.x = this.x[i] + (this.x[j] - this.x[i]) * t;
    out.y = this.y[i] + (this.y[j] - this.y[i]) * t;
    out.z = this.z[i] + (this.z[j] - this.z[i]) * t;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t, tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.tx = tx; out.tz = tz; out.rx = -tz; out.rz = tx;
    out.grade = (this.y[j] - this.y[i]) / Math.max(0.1, (this.s[i + 1] ?? this.s[i] + 2) - this.s[i]);
    out.i = i;
    out.kind = this.kind[t < 0.5 ? i : j];
    out.limit = this.limit[i];
    return out;
  }
  point(s, offset, out = {}) {
    this.frame(s, out);
    out.x += out.rx * offset; out.z += out.rz * offset;
    return out;
  }
  legAt(s) { return this.legs[this.legIdx[Math.floor(this.index(s))]]; }
  nameAt(s) { return this.names[this.nameIdx[Math.floor(this.index(s))]]; }
  // projection of (x,z) onto the route. Returns null when far from the route.
  nearest(x, z, out = {}, radius = 1) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let a = -radius; a <= radius; a++) for (let b = -radius; b <= radius; b++) {
      const arr = this.grid.get(this.key(cx + a, cz + b));
      if (!arr) continue;
      for (const i of arr) { const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    if (best < 0) return null;
    // refine on the neighbouring segments
    let bs = this.s[best], bo = 0, bdist = Infinity;
    for (const k of [best - 1, best]) {
      let i = k, j = k + 1;
      if (this.closed) { i = (i + this.n) % this.n; j = (j + this.n) % this.n; } else if (i < 0 || j >= this.n) continue;
      const ax = this.x[i], az = this.z[i], dx = this.x[j] - ax, dz = this.z[j] - az, L2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < bdist) {
        bdist = d;
        const segLen = (j === 0 ? this.s[this.n] : this.s[j]) - this.s[i];
        bs = this.s[i] + segLen * t;
        // signed lateral offset (+right)
        const l = Math.sqrt(L2), rx = -dz / l, rz = dx / l;
        bo = (x - ax) * rx + (z - az) * rz;
      }
    }
    out.s = this.wrap(bs); out.offset = bo; out.dist = bdist;
    out.y = this.frame(out.s, _tmpF).y;
    out.kind = _tmpF.kind;
    return out;
  }
}
const _tmpF = {};

export class World {
  async load(onProgress) {
    const files = ['world.json', 'terrain.bin', 'landcover.bin', 'buildings.json', 'trees.bin'];
    let done = 0;
    const get = async (f, type) => {
      const r = await fetch(`./data/${f}`);
      if (!r.ok) throw new Error(`Failed to load ${f}: ${r.status}`);
      const v = type === 'json' ? await r.json() : await r.arrayBuffer();
      onProgress?.(++done / files.length, f);
      return v;
    };
    const [w, terr, land, bld, trees] = await Promise.all([
      get('world.json', 'json'), get('terrain.bin'), get('landcover.bin'), get('buildings.json', 'json'), get('trees.bin'),
    ]);
    this.meta = w;
    this.grid = w.grid;
    const hq = new Int16Array(terr);
    this.H = new Float32Array(hq.length);
    for (let i = 0; i < hq.length; i++) this.H[i] = hq[i] / 10;
    this.land = new Uint8Array(land);
    this.buildingsRaw = bld;
    this.trees = new Int16Array(trees);
    this.road = w.road;
    this.lakeLevel = w.lakeLevel;
    this.loop = new Route(w.loop, true, w.road);
    this.stubs = w.stubs.map((s) => new Route(s, false, w.road));
    this.routes = [this.loop, ...this.stubs];
    this.landmarks = w.landmarks;
    this.streets = w.streets;
    this.bounds = { x0: this.grid.x0, z0: this.grid.z0, x1: this.grid.x0 + (this.grid.nx - 1) * this.grid.cell, z1: this.grid.z0 + (this.grid.nz - 1) * this.grid.cell };
    return this;
  }

  heightAt(x, z) {
    const g = this.grid, fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
    const c = Math.max(0, Math.min(g.nx - 2, Math.floor(fx))), r = Math.max(0, Math.min(g.nz - 2, Math.floor(fz)));
    const ax = Math.max(0, Math.min(1, fx - c)), az = Math.max(0, Math.min(1, fz - r)), i = r * g.nx + c, H = this.H;
    // triangle-consistent interpolation (matches the terrain mesh diagonal)
    if (ax + az <= 1) return H[i] + (H[i + 1] - H[i]) * ax + (H[i + g.nx] - H[i]) * az;
    return H[i + g.nx + 1] + (H[i + g.nx] - H[i + g.nx + 1]) * (1 - ax) + (H[i + 1] - H[i + g.nx + 1]) * (1 - az);
  }
  landAt(x, z) {
    const g = this.grid, c = Math.round((x - g.x0) / g.cell), r = Math.round((z - g.z0) / g.cell);
    if (c < 0 || r < 0 || c >= g.nx || r >= g.nz) return LC.LAND;
    return this.land[r * g.nx + c];
  }
  isWater(x, z) { const l = this.landAt(x, z); return l === LC.LAKE || l === LC.SEA; }
  waterLevelAt(x, z) { return this.landAt(x, z) === LC.SEA ? 0 : this.lakeLevel; }

  // Highest drivable surface at (x,z) whose height is <= yTop.
  // Returns a shared object: { y, type, route, s, offset, kind }
  surfaceAt(x, z, yTop, out = _surf) {
    out.y = -Infinity; out.type = 'none'; out.route = null; out.nx = 0; out.ny = 1; out.nz = 0;
    for (const r of this.routes) {
      const p = r.nearest(x, z, _near, 2);
      if (!p || p.dist > 40) continue;
      if (p.offset < this.road.offLeft - 0.2 || p.offset > this.road.offRight + 0.2) continue;
      if (!r.closed && (p.s <= 0.01 || p.s >= r.length - 0.01)) continue;
      if (p.y <= yTop + 0.05 && p.y > out.y) {
        out.y = p.y; out.type = 'road'; out.route = r; out.s = p.s; out.offset = p.offset; out.kind = p.kind;
        const f = r.frame(p.s, _tmpF2), g = f.grade;
        // normal from grade along the tangent
        const inv = 1 / Math.hypot(1, g);
        out.nx = -f.tx * g * inv; out.ny = inv; out.nz = -f.tz * g * inv;
      }
    }
    const th = this.heightAt(x, z);
    // under a road deck the terrain is carved away; anything above it belongs to tunnels/portals
    const inTunnel = out.type === 'road';
    if (!inTunnel && th <= yTop + 0.05 && th > out.y) {
      out.y = th; out.type = 'terrain'; out.route = null;
      const e = 2, hx = this.heightAt(x + e, z) - this.heightAt(x - e, z), hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
      const l = Math.hypot(hx, 2 * e, hz); out.nx = -hx / l; out.ny = (2 * e) / l; out.nz = -hz / l;
    }
    if (this.buildings) {
      const roof = this.buildings.roofAt(x, z, yTop);
      if (roof > out.y) { out.y = roof; out.type = 'roof'; out.route = null; out.nx = 0; out.ny = 1; out.nz = 0; }
    }
    if (this.isWater(x, z)) {
      const wl = this.waterLevelAt(x, z);
      if (wl > out.y && wl <= yTop + 2) { out.y = wl; out.type = 'water'; out.route = null; out.nx = 0; out.ny = 1; out.nz = 0; }
    }
    return out;
  }

  // Projection onto any road (preferring the one closest in height to y)
  roadAt(x, z, y, out = {}) {
    let best = null, bscore = Infinity;
    for (const r of this.routes) {
      const p = r.nearest(x, z, _near2, 2);
      if (!p) continue;
      const score = Math.max(0, p.dist - 20) + Math.abs(p.y - y) * 2;
      if (score < bscore) { bscore = score; best = r; Object.assign(out, p); }
    }
    out.route = best;
    return best ? out : null;
  }
}
const _surf = {}, _near = {}, _near2 = {}, _tmpF2 = {};
