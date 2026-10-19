import * as THREE from 'three';
import { CATALOG, buildCatalogGeometry, makeTrafficMaterial } from '../vehicles/carModels.js';
import { MPH, settings, GAME } from '../config.js';

const PAINT = [
  [0xf2f2f0, 22], [0x111214, 20], [0x8a8d90, 14], [0xc0c3c6, 14], [0x1f3c7a, 8], [0x8e1218, 7], [0x2c4a3a, 3],
  [0x5b3a24, 2], [0xc9b28a, 2], [0x6a1a2a, 2], [0x2b6fb3, 3], [0xd86a1a, 1], [0xe0c020, 1], [0x3f4f5f, 4],
];
function pickPaint(r) {
  let tot = 0; for (const [, w] of PAINT) tot += w;
  let x = r * tot; for (const [c, w] of PAINT) { if ((x -= w) <= 0) return c; }
  return PAINT[0][0];
}

// One InstancedMesh per vehicle model (semis per livery)
export class VehicleRenderer {
  constructor(entries, uniforms, capacity) {
    this.group = new THREE.Group();
    this.meshes = new Map();
    const mat = makeTrafficMaterial(uniforms);
    this.material = mat;
    for (const e of entries) {
      const variants = e.variants || [null];
      variants.forEach((col, vi) => {
        const geo = buildCatalogGeometry(e, col ?? undefined);
        const cap = capacity(e);
        const state = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        state.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('iState', state);
        const im = new THREE.InstancedMesh(geo, mat, cap);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.count = 0;
        im.castShadow = true; im.receiveShadow = true;
        im.frustumCulled = false;
        im.setColorAt(0, new THREE.Color(1, 1, 1));
        this.group.add(im);
        this.meshes.set(e.id + ':' + vi, { im, used: 0, cap, state });
      });
    }
  }
  begin() { for (const m of this.meshes.values()) m.used = 0; }
  put(key, matrix, color, brake, siren, phase) {
    const m = this.meshes.get(key);
    if (!m || m.used >= m.cap) return;
    const i = m.used++;
    m.im.setMatrixAt(i, matrix);
    m.im.setColorAt(i, color);
    m.state.setXYZ(i, brake, siren, phase);
  }
  end() {
    for (const m of this.meshes.values()) {
      m.im.count = m.used;
      m.im.instanceMatrix.needsUpdate = true;
      if (m.im.instanceColor) m.im.instanceColor.needsUpdate = true;
      m.state.needsUpdate = true;
    }
  }
}

let nextId = 1;

export class Traffic {
  constructor(world, uniforms) {
    this.world = world;
    this.route = world.loop;
    this.cs = world.cs;
    this.vehicles = [];
    this.renderer = new VehicleRenderer(CATALOG, uniforms, (e) => (e.weight >= 8 ? 70 : e.weight >= 4 ? 36 : 18));
    this.group = this.renderer.group;
    this.rand = Math.random;
    this.weightTotal = CATALOG.reduce((a, e) => a + e.weight, 0);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.ahead = 2300; this.behind = 1300;
  }

  densitySpacing() { return GAME.trafficSpacing * ({ low: 1.8, medium: 1.0, high: 0.65 }[settings.traffic] || 1); }

  pickEntry() {
    let x = this.rand() * this.weightTotal;
    for (const e of CATALOG) { if ((x -= e.weight) <= 0) return e; }
    return CATALOG[0];
  }

  makeVehicle(s, dir, lane) {
    let e = this.pickEntry();
    // heavy vehicles keep to the right two lanes
    const heavy = e.mass > 6000;
    if (heavy && lane < 2) lane = 2 + Math.floor(this.rand() * 2);
    const vi = e.variants ? Math.floor(this.rand() * e.variants.length) : 0;
    const limit = this.route.limit[Math.floor(this.route.index(s))] * MPH;
    const lanePace = [1.12, 1.06, 1.0, 0.95][lane];
    const v0 = limit * (heavy ? 0.92 + this.rand() * 0.06 : (0.95 + this.rand() * 0.22) * lanePace);
    const v = {
      id: nextId++, entry: e, key: e.id + ':' + vi, name: e.names[Math.floor(this.rand() * e.names.length)],
      color: e.fixedColor ? new THREE.Color(1, 1, 1) : new THREE.Color(pickPaint(this.rand())),
      s, dir, lane, off: this.laneOffset(dir, lane), targetLane: lane, laneT: 1, fromOff: 0,
      v: v0 * (0.85 + this.rand() * 0.1), v0, len: e.L, wid: e.W, hgt: e.H, mass: e.mass,
      T: heavy ? 1.8 : 1.0 + this.rand() * 0.8, amax: heavy ? 0.7 : 1.5 + this.rand() * 0.8, b: 2.6,
      state: 'drive', brake: 0, lcTimer: this.rand() * 3, heavy,
      pos: new THREE.Vector3(), yaw: 0, y: 0, vel: new THREE.Vector3(), yawRate: 0, wreckTime: 0, hitByPlayer: false,
    };
    return v;
  }

  laneOffset(dir, lane) { return dir > 0 ? this.cs.ourLane(lane) : this.cs.oppLane(lane); }

  // relative arc distance from a to b along direction dir (wrapping on the loop)
  rel(a, b, dir) { const L = this.route.length; let d = (b - a) * dir; d = ((d % L) + L) % L; if (d > L / 2) d -= L; return d; }

  init(playerS) {
    this.vehicles.length = 0;
    const sp = this.densitySpacing();
    for (const dir of [1, -1]) for (let lane = 0; lane < 4; lane++) {
      let s = playerS - this.behind - this.rand() * sp;
      while (this.rel(playerS, s, 1) < this.ahead) {
        s += sp * (0.5 + this.rand());
        const d = this.rel(playerS, s, 1);
        if (dir > 0 && Math.abs(d) < 60 && lane >= 1) continue; // keep the start area clear-ish
        if (d > -this.behind && d < this.ahead) this.vehicles.push(this.makeVehicle(this.route.wrap(s), dir, lane));
      }
    }
  }

  laneLists() {
    const lists = {};
    for (const v of this.vehicles) {
      if (v.state === 'gone') continue;
      const lanes = v.state === 'drive' ? [v.lane, v.targetLane] : this.lanesAtOffset(v.dir, v.off);
      for (const l of new Set(lanes)) { const k = v.dir + ':' + l; (lists[k] || (lists[k] = [])).push(v); }
    }
    return lists;
  }
  lanesAtOffset(dir, off) {
    const out = [];
    for (let l = 0; l < 4; l++) if (Math.abs(this.laneOffset(dir, l) - off) < 2.6) out.push(l);
    return out;
  }

  leaderOf(v, lane, lists, extra) {
    const arr = lists[v.dir + ':' + lane] || [];
    let best = null, bd = Infinity;
    for (const o of arr) {
      if (o === v) continue;
      const d = this.rel(v.s, o.s, v.dir);
      if (d > 0 && d < bd) { bd = d; best = o; }
    }
    for (const o of extra) {
      if (o.dir !== v.dir && o.dir !== 0) continue;
      if (!o.lanes.includes(lane)) continue;
      const d = this.rel(v.s, o.s, v.dir);
      if (d > 0 && d < bd) { bd = d; best = o; }
    }
    return best ? { o: best, gap: bd - (best.len + v.len) / 2, dv: v.v - (best.vAlong ?? best.v) } : null;
  }
  followerOf(v, lane, lists) {
    const arr = lists[v.dir + ':' + lane] || [];
    let best = null, bd = Infinity;
    for (const o of arr) {
      if (o === v) continue;
      const d = this.rel(o.s, v.s, v.dir);
      if (d > 0 && d < bd) { bd = d; best = o; }
    }
    return best ? { o: best, gap: bd - (best.len + v.len) / 2 } : null;
  }

  idm(v, lead) {
    let acc = v.amax * (1 - Math.pow(v.v / Math.max(1, v.v0), 4));
    if (lead) {
      const ss = 3 + v.v * v.T + (v.v * lead.dv) / (2 * Math.sqrt(v.amax * v.b));
      acc -= v.amax * Math.pow(Math.max(0, ss) / Math.max(0.5, lead.gap), 2);
    }
    return Math.max(-9, acc);
  }

  // obstacles: [{s, dir, lanes, len, v}] e.g. player, police
  update(dt, playerS, obstacles) {
    const lists = this.laneLists();
    const L = this.route.length;
    for (const v of this.vehicles) {
      if (v.state === 'drive') {
        const lead = this.leaderOf(v, v.lane, lists, obstacles);
        const lead2 = v.targetLane !== v.lane ? this.leaderOf(v, v.targetLane, lists, obstacles) : null;
        let acc = this.idm(v, lead);
        if (lead2) acc = Math.min(acc, this.idm(v, lead2));
        v.brake = acc < -1.2 ? 1 : 0;
        v.v = Math.max(0, v.v + acc * dt);
        v.s = this.route.wrap(v.s + v.v * dt * v.dir);
        // lane changes
        v.lcTimer -= dt;
        if (v.laneT >= 1 && v.lcTimer <= 0) {
          v.lcTimer = 1.5 + this.rand() * 2.5;
          this.considerLaneChange(v, lead, lists, obstacles);
        }
        if (v.laneT < 1) {
          v.laneT = Math.min(1, v.laneT + dt / 3.2);
          const t = 0.5 - 0.5 * Math.cos(v.laneT * Math.PI);
          v.off = v.fromOff + (this.laneOffset(v.dir, v.targetLane) - v.fromOff) * t;
          if (v.laneT >= 1) v.lane = v.targetLane;
        } else v.off = this.laneOffset(v.dir, v.lane);
        // limit follows the road
        const lim = this.route.limit[Math.floor(this.route.index(v.s))] * MPH;
        if (Math.abs(lim - v.limitRef) > 1 || v.limitRef === undefined) { v.v0 = v.v0 * (lim / (v.limitRef || lim)); v.limitRef = lim; }
      } else if (v.state === 'crashed') {
        this.crashDynamics(v, dt);
      }
      // recycle vehicles outside the window
      const d = this.rel(playerS, v.s, 1);
      if (d > this.ahead || d < -this.behind || v.state === 'gone') this.recycle(v, playerS, d);
    }
    void L;
  }

  considerLaneChange(v, lead, lists, obstacles) {
    const options = [];
    const wantPass = lead && lead.gap < 90 && (lead.o.vAlong ?? lead.o.v) < v.v0 * 0.92;
    for (const nl of [v.lane - 1, v.lane + 1]) {
      if (nl < 0 || nl > 3) continue;
      if (v.heavy && nl < 2) continue;
      const nlead = this.leaderOf(v, nl, lists, obstacles), nfol = this.followerOf(v, nl, lists);
      if (nfol && (nfol.gap < 8 + nfol.o.v * 0.6 || nfol.o.v - v.v > 6 && nfol.gap < 40)) continue;
      if (nlead && nlead.gap < 10 + v.v * 0.4) continue;
      const gain = (nlead ? Math.min(nlead.gap, 200) : 220) - (lead ? Math.min(lead.gap, 200) : 220);
      options.push({ nl, gain });
    }
    let pick = null;
    if (wantPass) for (const o of options) if (o.nl === v.lane - 1 && o.gain > 25) pick = o.nl;
    if (pick === null && wantPass) for (const o of options) if (o.gain > 40) pick = o.nl;
    // keep right except to pass
    if (pick === null && !wantPass && this.rand() < 0.3) for (const o of options) if (o.nl === v.lane + 1 && o.gain > -20) pick = o.nl;
    if (pick !== null) { v.targetLane = pick; v.laneT = 0; v.fromOff = v.off; }
  }

  recycle(v, playerS, d) {
    // place at the far edge, in a random lane with room
    const sp = this.densitySpacing();
    const ahead = v.state === 'gone' ? this.rand() < 0.6 : d < 0;
    for (let tries = 0; tries < 6; tries++) {
      const dir = this.rand() < 0.5 ? 1 : -1, lane = Math.floor(this.rand() * 4);
      const s = this.route.wrap(playerS + (ahead ? this.ahead - this.rand() * 200 : -this.behind + this.rand() * 200));
      let ok = true;
      for (const o of this.vehicles) if (o !== v && o.dir === dir && o.state !== 'gone' && Math.abs(o.off - this.laneOffset(dir, lane)) < 2 && Math.abs(this.rel(o.s, s, 1)) < sp * 0.45) { ok = false; break; }
      if (!ok) continue;
      Object.assign(v, this.makeVehicle(s, dir, lane));
      return;
    }
    v.state = 'gone';
  }

  // world pose of a vehicle
  pose(v) {
    if (v.state === 'drive') {
      const f = this.route.frame(v.s, this._f || (this._f = {}));
      v.pos.set(f.x + f.rx * v.off, f.y, f.z + f.rz * v.off);
      let yaw = Math.atan2(f.tx * v.dir, f.tz * v.dir);
      if (v.laneT < 1) yaw += (v.targetLane - v.lane) * v.dir * -0.04 * Math.sin(v.laneT * Math.PI);
      v.yaw = yaw; v.y = f.y; v.grade = f.grade * v.dir;
      v.vel.set(Math.sin(yaw) * v.v, 0, Math.cos(yaw) * v.v);
    }
    return v;
  }

  crashDynamics(v, dt) {
    const sp = v.vel.length();
    if (sp > 0.05) {
      const dec = Math.min(sp, 6.5 * dt);
      v.vel.multiplyScalar((sp - dec) / sp);
    }
    v.yawRate *= Math.exp(-1.6 * dt);
    v.yaw += v.yawRate * dt;
    v.pos.addScaledVector(v.vel, dt);
    const q = this.route.nearest(v.pos.x, v.pos.z, this._n || (this._n = {}), 2);
    if (q) {
      // stay inside the barriers
      const cs = this.cs;
      if (q.offset > cs.right - 1 || q.offset < cs.left + 1) {
        const f = this.route.frame(q.s, {});
        const push = q.offset > cs.right - 1 ? -(q.offset - (cs.right - 1)) : cs.left + 1 - q.offset;
        v.pos.x += f.rx * push; v.pos.z += f.rz * push;
        const vn = v.vel.x * f.rx + v.vel.z * f.rz;
        if (vn * Math.sign(-push) > 0) { v.vel.x -= f.rx * vn * 1.3; v.vel.z -= f.rz * vn * 1.3; }
      }
      v.s = q.s; v.off = q.offset; v.y = q.y;
    }
    v.v = 0;
    v.wreckTime += dt;
    if (v.wreckTime > 70) v.state = 'gone';
  }

  crash(v, vel, yawRate) {
    this.pose(v);
    v.state = 'crashed';
    v.vel.copy(vel); v.vel.y = 0;
    v.yawRate = yawRate;
    v.wreckTime = 0;
    v.brake = 1;
  }

  render(night) {
    const r = this.renderer;
    for (const v of this.vehicles) {
      if (v.state === 'gone') continue;
      this.pose(v);
      this._e.set(v.state === 'drive' ? -Math.atan(v.grade || 0) : 0, v.yaw, v.state === 'crashed' ? 0.0 : 0);
      this._q.setFromEuler(this._e);
      this._p.set(v.pos.x, v.y + 0.02, v.pos.z);
      this._m.compose(this._p, this._q, this._s);
      const c = v.state === 'crashed' ? this._c.copy(v.color).multiplyScalar(0.55) : v.color;
      r.put(v.key, this._m, c, v.brake || (v.state === 'crashed' ? 1 : 0), 0, 0);
    }
    void night;
  }
}
