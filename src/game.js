import * as THREE from 'three';
import { ROADSTER, GAME, MPH, settings } from './config.js';
import { RoadsterPhysics } from './vehicles/roadsterPhysics.js';
import { buildRoadster, setWing, PAINT } from './vehicles/roadsterModel.js';
import { Traffic } from './traffic/traffic.js';
import { Police } from './traffic/police.js';
import { collidePlayer } from './traffic/collisions.js';
import { CameraRig } from './camera.js';
import { Minimap } from './minimap.js';
import { fmtTime } from './ui.js';
import { KIND } from './data.js';
import { Replay } from './replay.js';

const DT = 1 / GAME.physicsHz;
const LEG_LABEL = { i5: 'I-5 South', i90: 'I-90 East', i405: 'I-405 North', sr520: 'SR 520 West' };

export class Game {
  constructor(o) {
    Object.assign(this, o); // renderer, scene, camera, world, ui, audio, input, sys, fx
    const w = this.world;
    this.state = 'menu';
    this.phys = new RoadsterPhysics(w);
    this.model = buildRoadster();
    this.scene.add(this.model);
    this.trafficUniforms = { uNight: { value: 0 }, uTime: { value: 0 } };
    this.traffic = new Traffic(w, this.trafficUniforms);
    this.scene.add(this.traffic.group);
    this.police = new Police(w, this.trafficUniforms);
    this.scene.add(this.police.group);
    this.rig = new CameraRig(this.camera, w);
    this.minimap = new Minimap(this.ui.map, w);
    // headlamps: dipped by default; B toggles high beams, which dip automatically for nearby traffic
    this.headlight = new THREE.SpotLight(0xfff4e0, 0, 75, 0.55, 0.6, 1.2);
    this.headlight.position.set(0, 0.45, 2.3); // ahead of the nose so it doesn't light our own hood
    this.headlight.target.position.set(0, -1.2, 22);
    this.highBeam = false; this.beamK = 0; this.lampBase = 0;
    this.model.add(this.headlight, this.headlight.target);
    // checkpoints along the loop (last one = finish line)
    const L = w.loop.length;
    this.cps = [];
    for (let k = 1; k <= GAME.checkpoints; k++) {
      const s = k === GAME.checkpoints ? L : (L * k) / GAME.checkpoints;
      const f = w.loop.frame(s % L, {});
      this.cps.push({ s, x: f.x, z: f.z, y: f.y });
    }
    this.makeGates();
    this.replay = new Replay(this);
    this.acc = 0;
    this.best = this.loadBest();
    this.ui.setMenuBest(this.best);
    this.applyTime();
    this.resetRun(true);
  }

  // ------------------------------------------------------------------ setup
  makeGates() {
    // vertical light curtains marking the checkpoints
    this.gates = [];
    const cs = this.world.cs;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: this.trafficUniforms.uTime, uColor: { value: new THREE.Color(0xffd23e) } },
      vertexShader: `varying vec2 vUv;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
        #include <logdepthbuf_fragment>
        float a = (1.0 - vUv.y) * 0.35 * (0.6 + 0.4 * sin(vUv.y * 30.0 - uTime * 6.0));
        a *= smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
        gl_FragColor = vec4(uColor, a); }`,
    });
    for (const cp of this.cps) {
      const f = this.world.loop.frame(cp.s % this.world.loop.length, {});
      const w = cs.right - cs.ourL + 1.2;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 6), mat.clone());
      m.material.uniforms.uTime = this.trafficUniforms.uTime;
      if (cp === this.cps.at(-1)) m.material.uniforms.uColor.value.set(0xffffff);
      const mid = (cs.right + cs.ourL) / 2;
      m.position.set(f.x + f.rx * mid, f.y + 3, f.z + f.rz * mid);
      m.rotation.y = Math.atan2(f.rx, f.rz);
      m.renderOrder = 4;
      this.scene.add(m);
      this.gates.push(m);
    }
  }

  applyTime() {
    const t = settings.time;
    this.sys.sky.setTime(t);
    const night = t === 'night' ? 1 : t === 'sunset' ? 0.25 : 0;
    this.night = night;
    this.sys.roads.setNight(night);
    this.sys.buildings.setNight(night >= 0.5 ? 1 : night * 0.3);
    this.trafficUniforms.uNight.value = night;
    this.lampBase = night > 0.5 ? 1 : night > 0 ? 0.3 : 0;
    const preset = this.sys.sky.preset;
    this.sys.landmarks.setHaze(preset.fog, t === 'overcast' ? 0.85 : t === 'night' ? 0.9 : t === 'sunset' ? 0.45 : 0.38);
  }

  loadBest() {
    try { const l = JSON.parse(localStorage.getItem('roadster.records') || '[]'); return l.length ? l[0].time : null; } catch { return null; }
  }
  saveRecord(time) {
    let l = [];
    try { l = JSON.parse(localStorage.getItem('roadster.records') || '[]'); } catch { l = []; }
    l.push({ time, top: Math.round(this.topSpeed / MPH), hp: Math.ceil(this.hp), date: Date.now() });
    l.sort((a, b) => a.time - b.time);
    l = l.slice(0, 10);
    try { localStorage.setItem('roadster.records', JSON.stringify(l)); } catch { /* storage unavailable */ }
    const rank = l.findIndex((r) => r.time === time);
    this.best = l[0].time;
    return rank;
  }

  resetRun(menu = false) {
    const w = this.world, cs = w.cs;
    const s0 = 12;
    const f = w.loop.frame(s0, {});
    const off = cs.ourLane(2);
    this.phys.air = this.phys.airMax;
    this.phys.reset(f.x + f.rx * off, f.y, f.z + f.rz * off, Math.atan2(f.tx, f.tz));
    this.phys.fans = true;
    this.phys.gripMul = 1;
    this.phys.events.length = 0;
    this.hp = GAME.maxHP;
    this.time = 0;
    this.penalty = 0;
    this.prog = s0;
    this.lastS = s0;
    this.cpDone = 0;
    this.topSpeed = 0;
    this.hurt = 0;
    this.spikeT = 0;
    this.dead = false;
    this.overT = 0;
    this.hitCooldown = new Map();
    this.nearMiss = new Map();
    this.collisions = 0;
    this.tunnelHint = false;
    this.ui.countdown('');
    if (menu) this.replay.stop(); else this.replay.begin();
    this.model.userData.paint.color.set(PAINT);
    this.model.visible = true;
    this.traffic.init(s0);
    this.police.reset();
    this.fx.clear();
    for (let i = 0; i < 30; i++) this.physicsStep(DT, { throttle: 0, brake: 0, hold: true, steer: 0, boost: 0, lift: 0, descend: 0, handbrake: false, land: false });
    this.syncModel();
    this.rig.mode = this.rig.mode || 'chase';
    this.rig.snap(this.phys);
    this.gates.forEach((g, i) => { g.visible = true; g.material.uniforms.uColor.value.set(i === this.gates.length - 1 ? 0xffffff : 0xffd23e); });
    if (!menu) {
      this.state = 'countdown';
      this.countT = 3.6;
      this.ui.hud(true);
      this.ui.el['h-help'].style.opacity = 1;
    }
  }

  start() {
    this.audio.init();
    this.applyTime();
    this.ui.hideAll();
    this.resetRun(false);
  }
  pause() { if (this.state === 'playing' || this.state === 'countdown') { this.prevState = this.state; this.state = 'paused'; this.ui.show('pause'); } }
  resume() { if (this.state === 'paused') { this.state = this.prevState || 'playing'; this.ui.hideAll(); } }
  toMenu() { this.state = 'menu'; this.ui.hud(false); this.ui.show('menu'); this.ui.setMenuBest(this.best); this.resetRun(true); }

  // ------------------------------------------------------------------ main update
  update(dt) {
    if (window.__timescale) dt *= window.__timescale;
    const inp = this.input;
    if (this.state === 'replay') {
      const rdt = this.replay.update(dt);
      this.trafficUniforms.uTime.value += rdt;
      this.render(rdt);
      inp.endFrame();
      return;
    }
    this.trafficUniforms.uTime.value += dt;
    if (inp.hit('Escape') || inp.hit('KeyP')) {
      if (this.state === 'paused') this.resume();
      else if (this.state === 'playing' || this.state === 'countdown') this.pause();
      else if (['controls', 'specs', 'settings', 'records'].includes(this.ui.current)) this.ui.show(this.prevScreen || 'menu');
    }
    if (inp.hit('KeyM')) this.ui.feed(this.audio.toggleMute() ? 'Audio muted' : 'Audio on', '#888');
    if (inp.hit('KeyV')) this.ui.feed(`Camera: ${this.rig.next()}`, '#888');

    const live = this.state === 'playing' || this.state === 'countdown' || this.state === 'over';
    let control = inp.update(dt);
    if (this.state === 'countdown') {
      this.countT -= dt;
      const n = Math.ceil(this.countT - 0.6);
      if (n !== this.lastCount) { this.lastCount = n; if (n > 0) { this.ui.countdown(n); this.audio.beep(660, 0.12, 0.2); } else { this.ui.countdown('GO'); this.audio.beep(1320, 0.3, 0.25); } }
      if (this.countT <= 0.6) { this.state = 'playing'; setTimeout(() => this.ui.countdown(''), 700); }
      control = { ...control, throttle: 0, brake: 0, hold: true, boost: 0, lift: 0 };
    }
    if (this.state === 'playing') {
      if (inp.hit('KeyF')) { this.phys.fans = !this.phys.fans; this.ui.feed(`Suction fans ${this.phys.fans ? 'on' : 'off'}`, '#3e9bff'); }
      if (inp.hit('KeyL')) control.land = true;
      if (inp.hit('KeyH')) this.audio.horn();
      if (inp.hit('KeyB')) { this.highBeam = !this.highBeam; this.ui.feed(this.highBeam ? 'High beams (auto-dip)' : 'Low beams', '#888'); }
      if (inp.hit('KeyR')) this.resetToRoad();
    }
    if (this.state === 'over' || this.dead) control = { throttle: 0, brake: 0, hold: !this.dead, steer: 0, boost: 0, lift: 0, descend: 0, handbrake: false, land: true };

    if (window.__autopilot && this.state === 'playing') control = this.autopilot(window.__autopilot);
    if (live && this.state !== 'paused') {
      this.simulate(dt, control);
      if (this.state === 'playing') this.time += dt;
      this.replay.record(dt);
    } else if (this.state === 'menu') {
      // idle traffic in the background of the menu
      this.traffic.update(dt, this.prog, []);
    }
    this.render(dt);
    inp.endFrame();
  }

  simulate(dt, control) {
    const w = this.world, phys = this.phys;
    // projection on the loop
    const q = w.loop.nearest(phys.pos.x, phys.pos.z, this._q || (this._q = {}), 3);
    const onRoute = q && q.dist < 70;
    if (q) {
      let ds = q.s - this.lastS;
      const L = w.loop.length;
      if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L;
      if (onRoute && Math.abs(ds) < 250) this.prog += ds;
      this.lastS = q.s;
      this.playerS = q.s; this.playerOff = q.offset;
    }
    const limit = q ? w.loop.limit[Math.floor(w.loop.index(q.s))] : 60;
    this.limit = limit;
    // heading for the auto-land yaw alignment
    if (q) { const f = w.loop.frame(q.s, {}); const side = q.offset < w.cs.medianCenter ? -1 : 1; phys.alignHeading = Math.atan2(f.tx * side, f.tz * side); }
    // nearby vehicles for collision tests
    const near = [];
    for (const v of this.traffic.vehicles) if (v.state !== 'gone' && Math.abs(v.pos.x - phys.pos.x) < 90 && Math.abs(v.pos.z - phys.pos.z) < 90) near.push(v);
    for (const u of this.police.units) if (Math.abs(u.pos.x - phys.pos.x) < 90 && Math.abs(u.pos.z - phys.pos.z) < 90) near.push(u);
    // physics substeps
    this.acc += Math.min(dt, 0.1 * (window.__timescale || 1));
    while (this.acc >= DT) {
      this.acc -= DT;
      this.physicsStep(DT, control);
      if (!window.__ghost) for (const o of near) this.vehicleCollision(o);
    }
    this.handleEvents();
    // traffic + police
    const obstacles = this.police.obstacles();
    if (q && Math.abs(phys.pos.y - q.y) < 3 && onRoute) {
      const f = w.loop.frame(q.s, {});
      const vS = phys.vel.x * f.tx + phys.vel.z * f.tz;
      const lanesF = [], lanesB = [];
      for (let l = 0; l < 4; l++) { if (Math.abs(w.cs.ourLane(l) - q.offset) < 2.6) lanesF.push(l); if (Math.abs(w.cs.oppLane(l) - q.offset) < 2.6) lanesB.push(l); }
      if (lanesF.length) obstacles.push({ s: q.s, dir: 1, lanes: lanesF, len: 4.3, v: Math.max(0, vS), vAlong: vS });
      if (lanesB.length) obstacles.push({ s: q.s, dir: -1, lanes: lanesB, len: 4.3, v: Math.max(0, -vS), vAlong: -vS });
    }
    this.traffic.update(dt, this.playerS ?? this.prog, obstacles);
    if (this.state === 'playing') this.police.update(dt, phys, this.playerS ?? 0, this.playerOff ?? 0, limit, this.traffic);
    for (const e of this.police.events) this.policeEvent(e);
    this.police.events.length = 0;
    if (this.police.bust >= GAME.bustTime && this.state === 'playing') this.gameOver('busted');
    // checkpoints & finish
    if (this.state === 'playing') {
      while (this.cpDone < this.cps.length && this.prog >= this.cps[this.cpDone].s) {
        const cp = this.cps[this.cpDone];
        this.gates[this.cpDone].visible = false;
        this.cpDone++;
        if (this.cpDone === this.cps.length) { this.finish(); break; }
        this.audio.chime();
        this.ui.toast(`Checkpoint ${this.cpDone}/${this.cps.length - 1}`, `${fmtTime(this.time + this.penalty)} · ${this.locationName(cp.s)}`, '#ffd23e');
      }
    }
    if (phys.tunnel && !this.tunnelHint && this.state === 'playing') {
      this.tunnelHint = true;
      this.ui.toast('Tunnel', phys.fans ? 'Fans at full suction: steer into the wall to ride the walls and ceiling' : 'Turn the fans on (F) to ride the walls', '#3e9bff');
    }
    // spike-damaged tyres recover slowly (run-flat)
    if (this.spikeT > 0) { this.spikeT -= dt; phys.gripMul = this.spikeT > 0 ? 0.62 : 1; }
    this.topSpeed = Math.max(this.topSpeed, phys.speed);
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    if (this.state === 'over') { this.overT += dt; if (this.overT > this.overDelay && !this.resultShown) this.showResult(); }
    // low HP smoke / fire
    const fwd = phys.forward(new THREE.Vector3());
    this.fx.damageSmoke(phys.pos.clone().addScaledVector(fwd, 1.4).add(new THREE.Vector3(0, 0.6, 0)), phys.vel, this.hp / GAME.maxHP);
  }

  // debug helper: follows the loop in a given lane at a target speed (m/s)
  autopilot(o) {
    const p = this.phys, w = this.world;
    const s = this.playerS ?? 0;
    const look = 18 + p.speed * 0.9;
    const f = w.loop.frame(s + look, {});
    const off = o.off ?? w.cs.ourLane(o.lane ?? 2);
    const tx = f.x + f.rx * off - p.pos.x, tz = f.z + f.rz * off - p.pos.z;
    const fwd = p.forward(new THREE.Vector3());
    const cross = fwd.x * tz - fwd.z * tx; // >0: target to the right (x east, z south)
    const ang = Math.atan2(cross, fwd.x * tx + fwd.z * tz);
    const v = o.speed ?? 35;
    return { throttle: p.speed < v ? 1 : 0, brake: p.speed > v + 5 ? 0.5 : 0, steer: THREE.MathUtils.clamp(ang * 4, -1, 1), boost: 0, lift: 0, descend: 0, handbrake: false, land: false };
  }

  physicsStep(dt, control) {
    this.phys.step(dt, control);
  }

  vehicleCollision(o) {
    const phys = this.phys;
    if (o.state === 'gone') return;
    const other = o.state !== undefined ? this.traffic.pose(o) : o;
    if (o.state === 'drive') other.vel.set(Math.sin(o.yaw) * o.v, 0, Math.cos(o.yaw) * o.v);
    const res = collidePlayer(phys, other);
    if (!res || res.j <= 0) return;
    const key = o.id ?? o;
    const now = this.time;
    const isPolice = o.mode !== undefined;
    // the other vehicle reacts
    const push = res.n.clone().multiplyScalar(-res.dvOther);
    if (isPolice) {
      if (res.dvOther > 5 || res.roof) this.police.crashUnit(o, o.vel.clone().add(push));
      else { o.v = Math.max(0, o.v - res.dvOther); }
      if (res.relSpeed > 6) { if (!this.police.pursuing) this.police.startPursuit('Ramming a patrol car'); else this.police.rammed = true; }
    } else {
      if (res.dvOther > 1.2 || res.roof) {
        if (o.state === 'drive') this.traffic.crash(o, other.vel.clone().add(push), (Math.random() - 0.5) * res.dvOther * 0.5);
        else o.vel.add(push);
      } else if (o.state === 'drive') o.v = Math.max(0, o.v - res.dvOther * 2);
    }
    // damage to the player (once per contact event)
    if ((this.hitCooldown.get(key) ?? -9) > now - 0.4) return;
    this.hitCooldown.set(key, now);
    let dmg = Math.max(0, res.dvPlayer - 1.6) * 3.4;
    if (res.roof) dmg += 8 + Math.max(0, -phys.vel.y) * 2.5;
    if (dmg > 0.5) {
      this.damage(dmg, res.point || phys.pos);
      this.collisions++;
      const what = o.name || 'vehicle';
      this.ui.feed(`${res.roof ? 'Landed on' : 'Hit'} a ${what}  −${Math.round(dmg)} HP`);
    } else if (res.relSpeed > 1) this.audio.crash(res.relSpeed * 0.5);
  }

  damage(d, point) {
    if (this.dead || this.state !== 'playing' || window.__god) return;
    this.hp = Math.max(0, this.hp - d);
    this.hurt = Math.min(1, this.hurt + d / 25);
    this.rig.shake(Math.min(1.2, d / 15));
    this.audio.crash(d);
    if (point) this.fx.sparks(point.clone ? point.clone() : point, this.phys.vel, Math.min(60, 6 + d * 2));
    const paint = this.model.userData.paint;
    paint.color.set(PAINT).lerp(new THREE.Color(0x221e1c), 1 - this.hp / GAME.maxHP);
    if (this.hp <= 0) this.explode();
  }

  explode() {
    this.dead = true;
    this.fx.explosion(this.phys.pos.clone(), 0x7a0a0a);
    this.audio.explosion();
    this.rig.shake(1.5);
    this.model.userData.paint.color.set(0x111111);
    this.phys.applyImpulse(this.phys.pos.clone().add(new THREE.Vector3(0.4, -0.3, 0.6)), new THREE.Vector3(0, 9000, 0));
    this.gameOver('destroyed');
  }

  handleEvents() {
    const phys = this.phys;
    for (const e of phys.events) {
      if (e.type === 'impact' && this.state === 'playing') {
        const d = Math.max(0, e.v - 4.5) * 2.6;
        if (d > 0.5) { this.damage(d, phys.pos.clone()); this.ui.feed(`Impact −${Math.round(d)} HP`); }
        else if (e.v > 1.5) this.audio.crash(e.v * 0.3);
      } else if (e.type === 'bottom' && this.state === 'playing') {
        const d = Math.max(0, e.v - 7) * 3.2;
        if (d > 0.5) { this.damage(d, phys.pos.clone()); this.ui.feed(`Hard landing −${Math.round(d)} HP`); }
        this.rig.shake(0.4);
      } else if (e.type === 'splash') {
        this.fx.splash(phys.pos.clone(), 1.5);
        this.audio.splash();
        if (this.state === 'playing') this.gameOver('splash');
      } else if (e.type === 'lowair') {
        this.ui.toast('Low air', 'Reserve reached. Auto-landing.', '#ffb020');
      } else if (e.type === 'landed') {
        this.ui.feed('Touchdown', '#3e9bff');
      }
    }
    phys.events.length = 0;
    if (phys.scrape > 6 && Math.random() < 0.5) {
      const fwd = phys.forward(new THREE.Vector3());
      this.fx.sparks(phys.pos.clone().addScaledVector(fwd, (Math.random() - 0.5) * 3), phys.vel, 2);
    }
  }

  policeEvent(e) {
    if (e.type === 'pursuit') { this.ui.toast('Pursuit!', e.reason, '#ff4a4a'); this.audio.beep(520, 0.4, 0.2); }
    else if (e.type === 'heat') { this.ui.toast(`Heat level ${e.heat}`, e.heat >= 2 ? 'Roadblocks ahead' : 'More units responding', '#ffb020'); }
    else if (e.type === 'roadblock') this.ui.feed('Roadblock reported ahead', '#ffb020');
    else if (e.type === 'evaded') { this.ui.toast('Evaded', 'The patrol lost you', '#38d39f'); this.audio.chime(); }
    else if (e.type === 'spikes') { this.spikeT = 25; this.damage(10, this.phys.pos.clone()); this.ui.toast('Spike strip!', 'Tyres punctured. Grip reduced.', '#ff4a4a'); }
  }

  resetToRoad() {
    const w = this.world, cs = w.cs;
    const s = w.loop.wrap(this.playerS ?? this.prog);
    const f = w.loop.frame(s, {});
    // pick the emptiest lane
    let lane = 1;
    for (const l of [1, 2, 0, 3]) {
      const off = cs.ourLane(l);
      if (!this.traffic.vehicles.some((v) => v.dir === 1 && Math.abs(v.off - off) < 2 && Math.abs(this.traffic.rel(s, v.s, 1)) < 25)) { lane = l; break; }
    }
    const off = cs.ourLane(lane);
    this.phys.reset(f.x + f.rx * off, f.y, f.z + f.rz * off, Math.atan2(f.tx, f.tz));
    this.penalty += 5;
    this.time += 5;
    this.ui.feed('Reset to road  +5 s', '#888');
    this.rig.snap(this.phys);
  }

  finish() {
    this.state = 'over';
    this.overDelay = 2.2;
    this.outcome = 'finish';
    const rank = this.saveRecord(this.time);
    this.finishRank = rank;
    this.ui.toast('Loop complete!', fmtTime(this.time), '#ffffff');
    this.audio.chime();
  }

  gameOver(kind) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.outcome = kind;
    this.overDelay = kind === 'destroyed' ? 3.5 : kind === 'splash' ? 2.8 : 1.6;
    this.resultShown = false;
    if (kind === 'busted') this.ui.toast('Busted', '', '#ff4a4a');
  }

  showResult() {
    this.resultShown = true;
    this.replay.stop();
    document.getElementById('res-replay').style.display = this.replay.available ? '' : 'none';
    const stats = [['Time', fmtTime(this.time)], ['Distance', `${(Math.max(0, this.prog) / 1609.34).toFixed(1)} mi`], ['Top speed', `${Math.round(this.topSpeed / MPH)} mph`], ['Collisions', this.collisions]];
    this.ui.hud(false);
    if (this.outcome === 'finish') {
      this.ui.result('good', 'Loop complete', this.finishRank === 0 ? 'New personal best!' : `Ranked #${this.finishRank + 1} in your records.`, [...stats, ['HP left', Math.ceil(this.hp)]]);
    } else if (this.outcome === 'busted') {
      this.ui.result('bad', 'Busted', 'Washington State Patrol boxed you in. The Roadster is impounded.', stats);
    } else if (this.outcome === 'destroyed') {
      this.ui.result('bad', 'Destroyed', 'Integrity hit zero and the battery pack went up. Drive cleaner, or fly over the jams.', stats);
    } else if (this.outcome === 'splash') {
      this.ui.result('bad', 'Splashdown', `You went into ${this.locationName(this.playerS ?? 0).includes('520') ? 'Lake Washington off SR 520' : 'the water'}. Cold-gas thrusters don't help much once you're submerged.`, stats);
    }
    if (this.outcome === 'finish') this.ui.setMenuBest(this.best);
  }

  locationName(s) {
    const r = this.world.loop;
    const leg = r.legAt(s), name = r.nameAt(s);
    if (leg === 'ramp') return name || 'Interchange';
    const base = LEG_LABEL[leg] || leg;
    if (name && !/^(I-|SR )/.test(name)) return `${base} · ${name}`;
    const f = r.frame(s, {});
    if (leg === 'i5') return `${base} · ${f.z > -300 && f.z < 900 ? 'Downtown Seattle' : f.z < -300 ? 'Capitol Hill' : 'SoDo'}`;
    if (leg === 'i90') return `${base} · ${f.x < -1500 ? 'Mount Baker' : f.x < 3800 ? 'Mercer Island' : 'Factoria'}`;
    if (leg === 'i405') return `${base} · ${f.z > -1300 && f.z < 600 ? 'Downtown Bellevue' : 'Bellevue'}`;
    if (leg === 'sr520') return `${base} · ${f.x > 3000 ? 'Bellevue' : f.x > -1000 ? 'Medina' : 'Montlake'}`;
    return base;
  }

  // ------------------------------------------------------------------ rendering
  syncModel() {
    const p = this.phys, m = this.model;
    m.quaternion.copy(p.quat);
    m.position.copy(new THREE.Vector3(0, -ROADSTER.cgHeight, 0).applyQuaternion(p.quat).add(p.pos));
    const wheels = m.userData.wheels;
    p.wheels.forEach((w, i) => {
      const vw = wheels[i];
      vw.pivot.position.y = p.mountY - w.len + ROADSTER.cgHeight + (vw.radius - ROADSTER.wheelRadius);
      vw.pivot.rotation.y = w.front ? p.steer : 0;
      vw.spin.rotation.x = w.spin;
    });
    if (m.userData.steeringWheel) m.userData.steeringWheel.rotation.z = -p.steer * 6;
    // active wing: flush below ~55 mph, fully raised by ~130 mph
    this.wingK = (this.wingK ?? 0) + (Math.min(1, Math.max(0, (p.speed - 25) / 33)) - (this.wingK ?? 0)) * 0.06;
    setWing(m, this.wingK);
    if (this.sinking) m.position.y -= 0;
  }

  updateHeadlights(dt, fwd) {
    let high = this.highBeam && this.lampBase > 0;
    if (high) {
      // auto-dip: any car in front of us within 160 m (oncoming or ahead) gets low beams
      const p = this.phys.pos;
      for (const v of this.traffic.vehicles) {
        if (v.state === 'gone') continue;
        const dx = v.pos.x - p.x, dz = v.pos.z - p.z, d2 = dx * dx + dz * dz;
        if (d2 < 160 * 160 && dx * fwd.x + dz * fwd.z > 0) { high = false; break; }
      }
    }
    this.beamK += ((high ? 1 : 0) - this.beamK) * Math.min(1, dt * 8);
    const h = this.headlight, k = this.beamK;
    h.intensity = this.lampBase * (150 + 300 * k);
    h.distance = 75 + 85 * k;
    h.angle = 0.55 - 0.13 * k;
    h.target.position.set(0, -1.2 + 0.6 * k, 22 + 10 * k);
  }

  render(dt) {
    const p = this.phys;
    this.syncModel();
    const fwd = p.forward(new THREE.Vector3()), up = p.up(new THREE.Vector3());
    this.updateHeadlights(dt, fwd);
    // thruster plumes
    const f = p.flight;
    if (f.main > 0.02 || f.lift > 0.02 || f.rcs > 0.05) {
      for (const n of this.model.userData.nozzles) {
        const wp = n.obj.getWorldPosition(new THREE.Vector3());
        if (n.type === 'main' && f.main > 0.02) this.fx.thruster(wp, fwd.clone().negate(), f.main, p.vel);
        if (n.type === 'lift' && (f.lift > 0.02 || f.rcs > 0.05)) this.fx.thruster(wp, up.clone().negate(), Math.min(1, f.lift * 0.9 + f.rcs * 0.3), p.vel);
      }
    }
    // tyre smoke / dust / skid marks
    const right = new THREE.Vector3().crossVectors(fwd, up);
    p.wheels.forEach((w, i) => {
      if (!w.contact) { this.fx.skid(i, w.wpos, right, 0); return; }
      const slip = Math.max(w.latSlip, Math.min(1, w.slip));
      if (w.surface === 'terrain') this.fx.dust(w.wpos.clone(), p.vel, Math.min(1, p.speed / 25));
      else { if (slip > 0.25) this.fx.tireSmoke(w.wpos.clone(), p.vel, slip); this.fx.skid(i, w.wpos, right, slip); }
    });
    // camera
    if (this.state === 'replay') this.replay.camera(dt);
    else if (this.state === 'menu' || (this.state === 'over' && this.outcome !== 'finish' && this.overT > 0.4)) this.rig.update(dt, p, false, { orbit: true, radius: this.state === 'menu' ? 9 : 16, height: this.state === 'menu' ? 2.2 : 5 });
    else this.rig.update(dt, p, false, { boost: f.main > 0.1 });
    // world systems
    const cp = this.camera.position;
    this.sys.sky.update(dt, p.pos, this.camera);
    this.sys.water.update(dt);
    this.sys.buildings.update(cp);
    this.sys.vegetation.update(cp);
    this.sys.landmarks.update(cp);
    this.fx.update(dt, (pos) => this.world.surfaceAt(pos.x, pos.z, pos.y + 2).y);
    // vehicles
    if (this.state === 'replay') this.replay.renderVehicles();
    else {
      this.traffic.renderer.begin();
      this.traffic.render(this.night);
      this.traffic.renderer.end();
      this.police.render();
    }
    // audio
    let siren = 0, radar = 0;
    if (this.state === 'replay') siren = this.replay.siren;
    else for (const u of this.police.units) {
      const d = u.pos.distanceTo(p.pos);
      if (u.siren) siren = Math.max(siren, Math.min(1, 160 / Math.max(20, d)));
      if (u.mode === 'parked') radar = Math.max(radar, 1 - d / GAME.radarRange);
    }
    const slip = Math.max(...p.wheels.map((w) => (w.contact && w.surface !== 'terrain' ? Math.max(w.latSlip, Math.min(1, w.slip)) : 0)));
    this.audio.update({ dt, speed: p.speed, power: p.motorPower || 0, slip, thrust: f.main + f.lift * 0.7 + f.rcs * 0.15, fans: p.fans && p.groundContacts > 0 ? 1 : 0, siren, scrape: p.scrape || 0, grounded: p.groundContacts > 0, radar: this.state === 'playing' ? radar : 0, paused: this.state === 'paused' || this.state === 'menu' || (this.state === 'replay' && this.replay.paused) });
    // near misses
    if (this.state === 'playing') {
      for (const v of this.traffic.vehicles) {
        if (v.state !== 'drive') continue;
        const d = v.pos.distanceTo(p.pos);
        if (d < 4.2 && d > 2.2) {
          const rel = v.vel.distanceTo(p.vel);
          if (rel > 16 && (this.nearMiss.get(v.id) ?? -10) < this.time - 5) { this.nearMiss.set(v.id, this.time); this.audio.whoosh(rel); if (rel > 30) this.ui.feed(`Near miss · ${v.name}`, '#38d39f'); }
        }
      }
    }
    // HUD
    if (this.state === 'playing' || this.state === 'countdown' || this.state === 'over') this.updateHud(radar);
  }

  updateHud(radar) {
    const p = this.phys, w = this.world;
    const L = w.loop.length;
    const fwd = p.forward(new THREE.Vector3());
    const heading = Math.atan2(fwd.x, -fwd.z);
    const mode = p.flight.active ? (p.flight.autoland ? (p.flight.forced ? 'LOW AIR' : 'AUTO-LAND') : 'FLIGHT') : p.wallRide ? (p.up().y < -0.5 ? 'CEILING' : 'WALL RIDE') : p.groundContacts === 0 && p.hAGL > 1 ? 'AIRBORNE' : 'DRIVE';
    let arrow = null;
    const q = this._q;
    if (q && q.dist > 45) {
      const f = w.loop.frame(q.s, {});
      const toward = Math.atan2(f.x - p.pos.x, -(f.z - p.pos.z));
      arrow = toward - heading;
    }
    this.ui.update({
      time: this.time, best: this.best, progress: Math.max(0, Math.min(1, this.prog / L)), remaining: Math.max(0, L - this.prog), cpDone: this.cpDone,
      speed: p.speed, limit: this.limit ?? 60, reverse: p.reverse, power: (p.motorPower || 0) / ROADSTER.motorPowerW,
      hp: this.hp, air: p.air, airFrac: p.air / p.airMax, pressure: ROADSTER.tankRatedBar * (p.air / p.airMax),
      mode, fans: p.fans, boost: p.flight.main > 0.05, rcs: p.flight.rcs > 0.05, alt: p.hAGL || 0, vs: p.vel.y, wall: !!p.wallRide, spikes: this.spikeT > 0,
      location: this.locationName(this.playerS ?? 0), heat: this.police.heat, bust: this.police.bust / GAME.bustTime, evade: this.police.lostTimer / GAME.evadeTime,
      units: this.police.units.filter((u) => u.mode === 'pursuit').length, radar: Math.max(0, radar), arrow, hurt: this.hurt,
    });
    const dots = [];
    for (const u of this.police.units) if (u.mode !== 'wreck' && (u.mode !== 'parked' || u.pos.distanceTo(p.pos) < GAME.radarRange)) dots.push({ x: u.pos.x, z: u.pos.z, color: u.siren && Math.floor(this.time * 4) % 2 ? '#3e7bff' : '#ff3b3b', big: true });
    for (const v of this.traffic.vehicles) if (v.state !== 'gone' && Math.abs(v.pos.x - p.pos.x) < 400 && Math.abs(v.pos.z - p.pos.z) < 400) dots.push({ x: v.pos.x, z: v.pos.z, color: v.state === 'crashed' ? '#ff9a3e' : 'rgba(230,230,230,0.7)' });
    this.minimap.draw(p.pos, heading, dots, this.cps, this.cpDone);
    if (this.time > 25 && this.ui.el['h-help'].style.opacity !== '0') this.ui.el['h-help'].style.opacity = 0;
    void KIND;
  }
}
