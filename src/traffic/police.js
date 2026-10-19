import * as THREE from 'three';
import { POLICE } from '../vehicles/carModels.js';
import { VehicleRenderer } from './traffic.js';
import { GAME, MPH, settings } from '../config.js';
import { KIND } from '../data.js';

const VMAX = 68; // m/s (~152 mph) pursuit top speed

export class Police {
  constructor(world, uniforms) {
    this.world = world;
    this.route = world.loop;
    this.cs = world.cs;
    this.renderer = new VehicleRenderer(POLICE, uniforms, () => 24);
    this.group = new THREE.Group();
    this.group.add(this.renderer.group);
    this.units = [];
    this.spikes = [];
    this.spikeMat = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.6, metalness: 0.6 });
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this.white = new THREE.Color(1, 1, 1);
    this.reset();
  }

  aggr() { return { relaxed: 0.7, normal: 1, aggressive: 1.35 }[settings.police] || 1; }

  reset() {
    for (const s of this.spikes) this.group.remove(s.mesh);
    this.spikes = [];
    this.units = [];
    this.heat = 0;
    this.pursuitTime = 0;
    this.lostTimer = 0;
    this.bust = 0;
    this.roadblockTimer = 20;
    this.cooldown = 0;
    this.events = [];
    // ambush spots: right shoulder, hidden behind curves / after overpasses
    const r = this.route, L = r.length;
    const n = 9;
    for (let k = 0; k < n; k++) {
      let s = ((k + 0.55) / n) * L + (Math.random() - 0.5) * 900;
      for (let t = 0; t < 40; t++) {
        const i = Math.floor(r.index(s));
        if (r.kind[i] !== KIND.TUNNEL && r.barR[i] && r.legs[r.legIdx[i]] !== 'ramp') break;
        s += 50;
      }
      this.units.push(this.makeUnit(r.wrap(s), this.cs.right - 1.6, 'parked'));
    }
  }

  makeUnit(s, off, mode, dir = 1) {
    const e = POLICE[Math.random() < 0.6 ? 0 : 1];
    const f = this.route.frame(s, {});
    const u = {
      entry: e, key: e.id + ':0', name: e.names[0], mode, s, off, dir,
      pos: new THREE.Vector3(f.x + f.rx * off, f.y, f.z + f.rz * off), y: f.y, yaw: Math.atan2(f.tx * dir, f.tz * dir),
      v: 0, len: e.L, wid: e.W, hgt: e.H, mass: e.mass, vel: new THREE.Vector3(), siren: mode !== 'parked' ? 1 : 0,
      phase: Math.random(), spot: mode === 'parked' ? { s, off } : null, crashT: 0, yawRate: 0, triggered: false,
    };
    return u;
  }

  get pursuing() { return this.heat > 0; }

  startPursuit(reason) {
    if (this.heat === 0) {
      this.heat = 1; this.pursuitTime = 0; this.lostTimer = 0; this.roadblockTimer = 25;
      this.events.push({ type: 'pursuit', reason });
    }
  }

  playerObstacle() { return null; }

  update(dt, player, playerS, playerOff, playerLimit, traffic) {
    const ppos = player.pos, pv = player.vel, speed = pv.length();
    const flying = player.flight.active || player.hAGL > 3;
    const nearestDist = { d: Infinity, u: null };
    const ag = this.aggr();
    // detection by parked units
    for (const u of this.units) {
      const d = u.pos.distanceTo(ppos);
      if (u.mode !== 'wreck' && d < nearestDist.d) { nearestDist.d = d; nearestDist.u = u; }
      if (u.mode === 'parked' && d < GAME.detectRange * ag && Math.abs(ppos.y - u.y) < 40 && this.units.filter((x) => x.mode === 'pursuit').length < [3, 3, 4, 6][this.heat]) {
        const over = speed - (playerLimit + GAME.speedTolMph) * MPH;
        if (over > 0) { u.mode = 'pursuit'; u.siren = 1; this.startPursuit(`Speeding: ${Math.round(speed / MPH)} mph in a ${Math.round(playerLimit)} zone`); }
        else if (flying && d < 120) { u.mode = 'pursuit'; u.siren = 1; this.startPursuit('Unauthorized flight over a freeway'); }
      }
      // parked units reset once the player is far away and nothing is going on
      if (u.mode === 'idle' && this.heat === 0 && d > 2500 && u.spot) { Object.assign(u, this.makeUnit(u.spot.s, u.spot.off, 'parked')); }
    }
    this.nearest = nearestDist;

    if (this.heat > 0) {
      this.pursuitTime += dt;
      const newHeat = Math.min(3, 1 + Math.floor(this.pursuitTime / (38 / ag)) + (this.rammed ? 1 : 0));
      if (newHeat > this.heat) { this.heat = newHeat; this.events.push({ type: 'heat', heat: newHeat }); }
      // reinforcements
      const want = [0, 2, 3, 5][this.heat];
      const active = this.units.filter((u) => u.mode === 'pursuit').length;
      if (active < want && Math.random() < dt * 0.25) this.spawnReinforcement(playerS);
      // roadblocks
      if (this.heat >= 2) {
        this.roadblockTimer -= dt;
        if (this.roadblockTimer <= 0) { this.roadblockTimer = 55 / ag; this.spawnRoadblock(playerS); }
      }
      // evasion
      let closest = Infinity;
      for (const u of this.units) if (u.mode === 'pursuit') closest = Math.min(closest, u.pos.distanceTo(ppos));
      if (closest > 420) this.lostTimer += dt; else this.lostTimer = Math.max(0, this.lostTimer - dt * 2);
      if (this.lostTimer > GAME.evadeTime) this.evade();
      // bust meter
      let pinned = false;
      for (const u of this.units) if ((u.mode === 'pursuit' || u.mode === 'block') && u.pos.distanceTo(ppos) < GAME.bustRadius) pinned = true;
      if (pinned && speed < 4 && !flying) this.bust = Math.min(GAME.bustTime, this.bust + dt);
      else this.bust = Math.max(0, this.bust - dt * 1.5);
    } else this.bust = 0;

    for (const u of this.units) {
      if (u.mode === 'pursuit') this.drive(u, dt, player, playerS, traffic);
      else if (u.mode === 'return' || u.mode === 'idle') { u.v = Math.max(0, u.v - 6 * dt); this.advance(u, dt); }
      else if (u.mode === 'wreck') this.wreckDynamics(u, dt);
    }
    // police vs traffic: pursuit cars shove traffic out of the way
    for (const u of this.units) {
      if (u.mode !== 'pursuit') continue;
      for (const v of traffic.vehicles) {
        if (v.state === 'gone') continue;
        const dx = v.pos.x - u.pos.x, dz = v.pos.z - u.pos.z;
        const rr = (v.len + u.len) / 2 * 0.6;
        if (dx * dx + dz * dz < rr * rr && Math.abs(v.y - u.y) < 3) {
          if (v.state === 'drive') traffic.crash(v, new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(6).add(u.vel.clone().multiplyScalar(0.5)), (Math.random() - 0.5) * 2);
          u.v *= 0.6;
        }
      }
    }
    // spike strips
    for (const sp of this.spikes) {
      sp.age += dt;
      if (!sp.hit && sp.box.containsPoint(this._p.set(ppos.x, sp.box.min.y + 0.1, ppos.z)) && ppos.y - sp.y < 1.2) { sp.hit = true; this.events.push({ type: 'spikes' }); }
    }
    this.spikes = this.spikes.filter((sp) => { const keep = sp.age < 150 && sp.mesh.position.distanceTo(ppos) < 2200; if (!keep) this.group.remove(sp.mesh); return keep; });
    // remove units far behind / done
    this.units = this.units.filter((u) => !(u.mode === 'block' && u.pos.distanceTo(ppos) > 2600) && !(u.mode === 'return' && u.pos.distanceTo(ppos) > 900) && !(u.mode === 'wreck' && u.crashT > 60));
    this.lastPlayerOff = playerOff;
  }

  advance(u, dt) {
    u.pos.x += Math.sin(u.yaw) * u.v * dt; u.pos.z += Math.cos(u.yaw) * u.v * dt;
    const q = this.route.nearest(u.pos.x, u.pos.z, {}, 2);
    if (q) { u.s = q.s; u.off = q.offset; u.y = q.y; }
    u.vel.set(Math.sin(u.yaw) * u.v, 0, Math.cos(u.yaw) * u.v);
  }

  drive(u, dt, player, playerS, traffic) {
    const r = this.route, cs = this.cs;
    const toP = player.pos.clone().sub(u.pos); toP.y = 0;
    const dist = toP.length();
    const relS = ((playerS - u.s) % r.length + r.length * 1.5) % r.length - r.length / 2; // >0: player ahead
    const fr = r.frame(u.s, {});
    const routeYaw = Math.atan2(fr.tx, fr.tz);
    const pSpeed = player.vel.length();
    let target, vTarget;
    if (relS > -6) {
      if (dist < 220 && Math.abs(player.pos.y - u.y) < 15) {
        const lead = Math.min(1.2, dist / Math.max(10, u.v));
        target = player.pos.clone().addScaledVector(player.vel, lead);
      } else {
        const off = THREE.MathUtils.clamp(player.flight.active ? cs.ourLane(1) : this.lastPlayerOff ?? cs.ourLane(1), cs.ourL + 1, cs.ourR - 1);
        const f = r.frame(u.s + Math.min(70, Math.max(20, relS)), {});
        target = new THREE.Vector3(f.x + f.rx * off, 0, f.z + f.rz * off);
      }
      vTarget = dist > 70 ? VMAX * this.aggr() : dist > 14 ? Math.max(pSpeed + 6, 12) : Math.max(0, pSpeed - 1);
    } else {
      // the speeder is still behind: pull out and pace in the lane so they come alongside
      const off = THREE.MathUtils.clamp(u.off, cs.ourL + 1.5, cs.ourR - 1.5);
      const f = r.frame(u.s + 40, {});
      target = new THREE.Vector3(f.x + f.rx * off, 0, f.z + f.rz * off);
      vTarget = THREE.MathUtils.clamp(pSpeed - 3 + relS * 0.05, 0, VMAX);
      // they stopped behind us: back up along the shoulder towards them
      if (pSpeed < 6) { vTarget = -Math.min(12, Math.max(2, -relS * 0.25)); target = new THREE.Vector3(fr.x + fr.rx * u.off, 0, fr.z + fr.rz * u.off).addScaledVector(new THREE.Vector3(fr.tx, 0, fr.tz), 30); }
    }
    // avoid traffic ahead
    const fwd = new THREE.Vector3(Math.sin(u.yaw), 0, Math.cos(u.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    let avoid = 0;
    for (const v of traffic.vehicles) {
      if (v.state === 'gone') continue;
      const d = v.pos.clone().sub(u.pos);
      const ahead = d.dot(fwd);
      if (ahead < 0 || ahead > 45) continue;
      const lat = d.dot(right);
      if (Math.abs(lat) < 2.6) avoid += (lat >= 0 ? -1 : 1) * (1 - ahead / 45) * 3.5;
    }
    target.addScaledVector(right, avoid * 2.0);
    let want = Math.atan2(target.x - u.pos.x, target.z - u.pos.z);
    // never turn against the direction of travel (no U-turns on a divided freeway)
    let dw = want - routeYaw; dw = Math.atan2(Math.sin(dw), Math.cos(dw));
    want = routeYaw + THREE.MathUtils.clamp(dw, -0.55, 0.55);
    let err = want - u.yaw; err = Math.atan2(Math.sin(err), Math.cos(err));
    const maxYawRate = Math.min(1.6, (1.15 * 9.81) / Math.max(4, u.v));
    u.yaw += THREE.MathUtils.clamp(err * 3, -maxYawRate, maxYawRate) * dt;
    // speed
    if (Math.abs(err) > 0.6) vTarget = Math.min(vTarget, 18);
    if (vTarget > u.v) u.v = Math.min(vTarget, u.v + 7.5 * dt);
    else u.v = Math.max(vTarget, u.v - 11 * dt);
    this.advance(u, dt);
    // keep on our carriageway (cannot cross the median barrier or exterior barriers)
    const q = r.nearest(u.pos.x, u.pos.z, {}, 2);
    if (q) {
      const side = q.offset > cs.medianCenter ? 1 : -1;
      const lo = side > 0 ? cs.medianCenter + 1.2 : cs.left + 1.2, hi = side > 0 ? cs.right - 1.2 : cs.medianCenter - 1.2;
      const c = THREE.MathUtils.clamp(q.offset, lo, hi);
      if (c !== q.offset) {
        const f = r.frame(q.s, {});
        u.pos.x += f.rx * (c - q.offset); u.pos.z += f.rz * (c - q.offset);
        u.v *= 0.995;
      }
      u.y = q.y;
    }
    u.vel.set(Math.sin(u.yaw) * u.v, 0, Math.cos(u.yaw) * u.v);
  }

  wreckDynamics(u, dt) {
    u.crashT += dt;
    const sp = u.vel.length();
    if (sp > 0.05) u.vel.multiplyScalar(Math.max(0, sp - 7 * dt) / sp);
    u.yawRate *= Math.exp(-1.5 * dt);
    u.yaw += u.yawRate * dt;
    u.pos.addScaledVector(u.vel, dt);
    const q = this.route.nearest(u.pos.x, u.pos.z, {}, 2);
    if (q) u.y = q.y;
    u.siren = 0;
  }

  spawnReinforcement(playerS) {
    const r = this.route, cs = this.cs;
    // behind the player, out of sight, joining from the shoulder
    const s = r.wrap(playerS - 380 - Math.random() * 200);
    const i = Math.floor(r.index(s));
    if (r.kind[i] === KIND.TUNNEL) return;
    const u = this.makeUnit(s, cs.ourLane(Math.floor(Math.random() * 4)), 'pursuit');
    u.v = 45;
    this.units.push(u);
  }

  spawnRoadblock(playerS) {
    const r = this.route, cs = this.cs;
    let s = r.wrap(playerS + 950 + Math.random() * 300);
    for (let t = 0; t < 30; t++) { const i = Math.floor(r.index(s)); if (r.kind[i] === KIND.GROUND || r.kind[i] === KIND.BRIDGE) break; s = r.wrap(s + 60); }
    const gap = Math.floor(Math.random() * 4);
    const f = r.frame(s, {});
    for (let lane = 0; lane < 4; lane++) {
      if (lane === gap) continue;
      const u = this.makeUnit(s + (lane % 2) * 2, cs.ourLane(lane), 'block');
      u.yaw += (lane % 2 ? 1 : -1) * 1.15;
      u.siren = 1;
      this.units.push(u);
    }
    // spike strip across the gap lane, 25 m before the block
    const sf = r.frame(s - 25, {});
    const off = cs.ourLane(gap);
    const mesh = new THREE.Group();
    const strip = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.06, 0.45), this.spikeMat);
    mesh.add(strip);
    for (let k = -1.9; k <= 1.9; k += 0.25) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), this.spikeMat); sp.position.set(k, 0.08, 0); mesh.add(sp); }
    mesh.position.set(sf.x + sf.rx * off, sf.y + 0.03, sf.z + sf.rz * off);
    mesh.rotation.y = Math.atan2(sf.rx, sf.rz);
    this.group.add(mesh);
    const box = new THREE.Box3().setFromObject(mesh).expandByScalar(0.4);
    this.spikes.push({ mesh, box, s: s - 25, y: sf.y, age: 0, hit: false });
    this.events.push({ type: 'roadblock', s });
    void f;
  }

  evade() {
    this.events.push({ type: 'evaded' });
    this.heat = 0; this.pursuitTime = 0; this.lostTimer = 0; this.rammed = false;
    for (const u of this.units) if (u.mode === 'pursuit' || u.mode === 'block') { u.mode = 'return'; u.siren = 0; }
  }

  crashUnit(u, vel) {
    u.mode = 'wreck'; u.vel.copy(vel); u.vel.y = 0; u.yawRate = (Math.random() - 0.5) * 3; u.crashT = 0; u.siren = 0;
  }

  render() {
    const r = this.renderer;
    r.begin();
    for (const u of this.units) {
      this._e.set(0, u.yaw, 0);
      this._q.setFromEuler(this._e);
      this._p.set(u.pos.x, u.y + 0.02, u.pos.z);
      this._m.compose(this._p, this._q, this._s);
      r.put(u.key, this._m, u.mode === 'wreck' ? new THREE.Color(0.5, 0.5, 0.5) : this.white, u.mode === 'pursuit' && u.v < 5 ? 1 : 0, u.siren, u.phase);
    }
    r.end();
  }

  // police units as lane obstacles for the traffic model
  obstacles() {
    const out = [];
    for (const u of this.units) {
      if (u.mode === 'pursuit' && u.v > 10) continue;
      const lanes = [];
      for (let l = 0; l < 4; l++) if (Math.abs(this.cs.ourLane(l) - u.off) < 2.8) lanes.push(l);
      if (lanes.length) out.push({ s: u.s, dir: 1, lanes, len: u.len, v: u.v, vAlong: u.v });
    }
    return out;
  }
}
