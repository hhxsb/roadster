import * as THREE from 'three';
import { ROADSTER, MPH, GAME } from './config.js';
import { PAINT } from './vehicles/roadsterModel.js';
import { tunnelContext } from './world/tunnel.js';
import { fmtTime } from './ui.js';

// Run replay: the whole run (countdown to result screen) is sampled at 20 Hz into typed arrays,
// then played back by posing a stand-in physics object that the normal render path draws.
// Clips can be exported as a video file (canvas + game audio via MediaRecorder).

const HZ = 20;
const MAX_SEC = 40 * 60;
const NEAR = 220; // record vehicles within this distance of the player
const VEH_EVERY = 2; // vehicles are sampled at HZ / VEH_EVERY (traffic moves smoothly)
// player sample layout
const P = { t: 0, pos: 1, quat: 4, vel: 8, steer: 11, wheels: 12, flight: 36, misc: 42, size: 56 };
const WF = 6; // per wheel: len, spin, contact, slip, latSlip, terrain
// vehicle record: id, renderer (0 traffic, 1 police), key, x, y, z, yaw, pitch, r, g, b, brake, siren, phase
const V = 14;
const CAMS = ['chase', 'tv', 'far', 'orbit', 'hood', 'cockpit'];
const CAM_LABEL = { chase: 'Chase', tv: 'Trackside', far: 'Far', orbit: 'Orbit', hood: 'Hood', cockpit: 'Cockpit' };
const SPEEDS = [0.25, 0.5, 1, 2, 4];
// one-shot sounds and effects worth replaying
const AUDIO_EVENTS = ['beep', 'crash', 'explosion', 'splash', 'whoosh', 'chime', 'horn'];
const FX_EVENTS = ['sparks', 'explosion', 'splash'];

class FloatLog {
  constructor(n = 1 << 18) { this.a = new Float32Array(n); this.n = 0; }
  push(...v) {
    if (this.n + v.length > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    for (const x of v) this.a[this.n++] = x;
  }
}

const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };

export class Replay {
  constructor(game) {
    this.game = game;
    this.keys = []; this.keyIdx = new Map();
    this.ids = new WeakMap(); this.nextId = 1e6;
    this.recording = false;
    this.cam = 'chase';
    this.speed = 1;
    this.siren = 0;
    this.ghost = this.makeGhost(game.phys);
    this.hookEvents();
    this.buildUi();
  }

  // ------------------------------------------------------------------ recording
  begin() {
    this.player = new FloatLog(P.size * HZ * 120);
    this.veh = new FloatLog(V * 30 * (HZ / VEH_EVERY) * 120);
    this.vOff = []; this.vT = [];
    this.events = [];
    this.t = 0; this.acc = 1 / HZ;
    this.recording = true;
  }
  stop() { this.recording = false; }
  get duration() { return this.player ? this.player.a[(this.count - 1) * P.size] || 0 : 0; }
  get count() { return this.player ? this.player.n / P.size : 0; }
  get available() { return this.count > HZ; }

  record(dt) {
    if (!this.recording) return;
    this.t += dt; this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc %= 1 / HZ;
    if (this.t > MAX_SEC) { this.recording = false; return; }
    const g = this.game, p = g.phys, f = p.flight;
    const row = [this.t, p.pos.x, p.pos.y, p.pos.z, p.quat.x, p.quat.y, p.quat.z, p.quat.w, p.vel.x, p.vel.y, p.vel.z, p.steer];
    for (const w of p.wheels) row.push(w.len, w.spin, w.contact ? 1 : 0, w.slip, w.latSlip, w.surface === 'terrain' ? 1 : 0);
    row.push(f.main, f.lift, f.rcs, f.active ? 1 : 0, f.autoland ? 1 : 0, f.forced ? 1 : 0);
    row.push(p.wallRide ? 1 : 0, p.hAGL || 0, p.groundContacts, p.fans ? 1 : 0, p.motorPower || 0, p.scrape || 0, p.reverse ? 1 : 0,
      p.air, g.hp, g.dead ? 1 : 0, g.time, g.prog, g.cpDone, g.playerS ?? 0);
    // wheel slip is NaN while a wheel is airborne; the live game ignores it there, playback must too
    this.player.push(...row.map((x) => (Number.isFinite(x) ? x : 0)));
    // nearby traffic and police
    if ((this.count - 1) % VEH_EVERY) return;
    this.vOff.push(this.veh.n); this.vT.push(this.t);
    const px = p.pos.x, pz = p.pos.z;
    for (const v of g.traffic.vehicles) {
      if (v.state === 'gone' || Math.abs(v.pos.x - px) > NEAR || Math.abs(v.pos.z - pz) > NEAR) continue;
      g.traffic.pose(v);
      const c = v.state === 'crashed' ? 0.55 : 1;
      this.veh.push(v.id, 0, this.key(v.key), v.pos.x, v.y, v.pos.z, v.yaw, v.state === 'drive' ? -Math.atan(v.grade || 0) : 0, v.color.r * c, v.color.g * c, v.color.b * c, v.brake || (v.state === 'crashed' ? 1 : 0), 0, 0);
    }
    for (const u of g.police.units) {
      if (Math.abs(u.pos.x - px) > NEAR || Math.abs(u.pos.z - pz) > NEAR) continue;
      if (!this.ids.has(u)) this.ids.set(u, this.nextId++);
      const c = u.mode === 'wreck' ? 0.5 : 1;
      this.veh.push(this.ids.get(u), 1, this.key(u.key), u.pos.x, u.y, u.pos.z, u.yaw, 0, c, c, c, u.mode === 'pursuit' && u.v < 5 ? 1 : 0, u.siren, u.phase);
    }
  }
  key(k) { if (!this.keyIdx.has(k)) { this.keyIdx.set(k, this.keys.length); this.keys.push(k); } return this.keyIdx.get(k); }

  // log one-shot sounds and particle bursts while recording; re-fire them during playback
  hookEvents() {
    const g = this.game;
    const wrap = (obj, name, tag) => {
      const orig = obj[name].bind(obj);
      obj[name] = (...args) => {
        if (this.recording && !this.firing) this.events.push({ t: this.t, tag, args: args.map((a) => (a && a.clone ? a.clone() : a)) });
        return orig(...args);
      };
    };
    for (const m of AUDIO_EVENTS) wrap(g.audio, m, 'a:' + m);
    for (const m of FX_EVENTS) wrap(g.fx, m, 'f:' + m);
  }
  fireEvents(t0, t1) {
    const g = this.game;
    this.firing = true;
    for (const e of this.events) {
      if (e.t <= t0 || e.t > t1) continue;
      const [kind, m] = e.tag.split(':');
      // chime() schedules its second note with setTimeout, which is fine in real time
      if (kind === 'a') g.audio[m](...e.args); else g.fx[m](...e.args.map((a) => (a && a.clone ? a.clone() : a)));
    }
    this.firing = false;
  }

  // ------------------------------------------------------------------ playback
  makeGhost(real) {
    const ghost = {
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), steer: 0, speed: 0,
      mountY: real.mountY, air: 0, airMax: real.airMax, reverse: false, fans: true, motorPower: 0, scrape: 0, hAGL: 0, groundContacts: 4, wallRide: false, tunnel: null,
      flight: { main: 0, lift: 0, rcs: 0, active: false, autoland: false, forced: false },
      wheels: real.wheels.map((w) => ({ x: w.x, z: w.z, front: w.front, len: w.len, spin: 0, contact: true, slip: 0, latSlip: 0, surface: 'road', wpos: new THREE.Vector3() })),
      forward(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.quat); },
      up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat); },
      _tc: {},
    };
    return ghost;
  }

  enter() {
    const g = this.game;
    this.stop();
    this.livePhys = g.phys;
    g.phys = this.ghost;
    g.state = 'replay';
    g.ui.hideAll(); g.ui.hud(false);
    this.prevCam = g.rig.mode;
    this.pos = 0; this.paused = false; this.speed = 1;
    this.markIn = Math.max(0, this.duration - 30); this.markOut = this.duration;
    g.fx.clear();
    this.apply(0);
    g.rig.snap(this.ghost);
    this.tvAnchor = null;
    this.bar.classList.add('on');
    this.refreshUi(true);
  }

  exit() {
    const g = this.game;
    if (this.exporting) this.cancelExport();
    this.bar.classList.remove('on');
    g.phys = this.livePhys;
    g.rig.mode = this.prevCam;
    g.state = 'over';
    g.fx.clear();
    g.gates.forEach((gt, i) => { gt.visible = i >= g.cpDone; });
    g.syncModel();
    g.rig.snap(g.phys);
    g.ui.show('result');
  }

  // advances playback; returns the dt the rest of the frame should animate with
  update(dt) {
    const inp = this.game.input;
    if (!this.exporting) {
      if (inp.hit('Escape')) { this.exit(); return 0; }
      if (inp.hit('Space') || inp.hit('KeyK')) this.togglePlay();
      if (inp.hit('ArrowLeft') || inp.hit('KeyJ')) this.seek(this.pos - 5);
      if (inp.hit('ArrowRight') || inp.hit('KeyL')) this.seek(this.pos + 5);
      if (inp.hit('KeyV') || inp.hit('KeyC')) this.nextCam();
      if (inp.hit('KeyH')) this.bar.classList.toggle('min');
      if (inp.hit('KeyI')) this.setIn();
      if (inp.hit('KeyO')) this.setOut();
    } else if (inp.hit('Escape')) { this.cancelExport(); return 0; }
    const rate = this.paused ? 0 : this.exporting ? 1 : this.speed;
    const prev = this.pos;
    this.pos = Math.min(this.duration, this.pos + dt * rate);
    if (rate > 0 && rate <= 2) this.fireEvents(prev, this.pos);
    this.apply(this.pos);
    if (this.exporting && this.pos >= this.exportEnd) this.finishExport();
    else if (this.pos >= this.duration && !this.paused) this.paused = true;
    this.refreshUi();
    return dt * rate;
  }

  seek(t) {
    this.pos = Math.max(0, Math.min(this.duration, t));
    this.game.fx.clear();
    this.apply(this.pos);
    this.game.rig.snap(this.ghost);
    this.tvAnchor = null;
    this.refreshUi(true);
  }
  togglePlay() { if (this.pos >= this.duration - 0.01) this.seek(0); this.paused = !this.paused; this.refreshUi(true); }
  nextCam() { this.cam = CAMS[(CAMS.indexOf(this.cam) + 1) % CAMS.length]; this.tvAnchor = null; this.refreshUi(true); }

  // sample index i and blend k for time t
  locate(t) {
    const n = this.count, a = this.player.a;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m * P.size] <= t) lo = m; else hi = m; }
    const t0 = a[lo * P.size], t1 = a[hi * P.size];
    return { i: lo, j: hi, k: t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0 };
  }

  apply(t) {
    const g = this.game, gh = this.ghost, a = this.player.a;
    const { i, j, k } = this.locate(t);
    const A = i * P.size, B = j * P.size;
    const L = (o) => lerp(a[A + o], a[B + o], k);
    gh.pos.set(L(1), L(2), L(3));
    gh.quat.set(a[A + 4], a[A + 5], a[A + 6], a[A + 7]).slerp(new THREE.Quaternion(a[B + 4], a[B + 5], a[B + 6], a[B + 7]), k);
    gh.vel.set(L(8), L(9), L(10));
    gh.speed = gh.vel.length();
    gh.steer = L(11);
    const up = gh.up(new THREE.Vector3());
    gh.wheels.forEach((w, n) => {
      const o = P.wheels + n * WF;
      w.len = L(o); w.spin = L(o + 1); w.contact = a[A + o + 2] > 0.5; w.slip = L(o + 3); w.latSlip = L(o + 4); w.surface = a[A + o + 5] > 0.5 ? 'terrain' : 'road';
      w.wpos.set(w.x, gh.mountY, w.z).applyQuaternion(gh.quat).add(gh.pos).addScaledVector(up, -(w.len + ROADSTER.wheelRadius));
    });
    const f = gh.flight, F = P.flight;
    f.main = L(F); f.lift = L(F + 1); f.rcs = L(F + 2); f.active = a[A + F + 3] > 0.5; f.autoland = a[A + F + 4] > 0.5; f.forced = a[A + F + 5] > 0.5;
    const M = P.misc;
    gh.wallRide = a[A + M] > 0.5; gh.hAGL = L(M + 1); gh.groundContacts = a[A + M + 2]; gh.fans = a[A + M + 3] > 0.5;
    gh.motorPower = L(M + 4); gh.scrape = L(M + 5); gh.reverse = a[A + M + 6] > 0.5; gh.air = L(M + 7);
    gh.tunnel = g.world.tunnelBores ? tunnelContext(g.world, gh.pos, gh._tc) : null;
    this.hp = L(M + 8); this.dead = a[A + M + 9] > 0.5; this.raceTime = L(M + 10);
    const cpDone = a[A + M + 12];
    g.playerS = a[A + M + 13];
    g.gates.forEach((gt, n) => { gt.visible = n >= cpDone; });
    g.model.userData.paint.color.set(this.dead ? 0x111111 : PAINT).lerp(new THREE.Color(0x221e1c), this.dead ? 0 : 1 - this.hp / GAME.maxHP);
    g.fx.damageSmoke(gh.pos.clone().addScaledVector(gh.forward(new THREE.Vector3()), 1.4).add(new THREE.Vector3(0, 0.6, 0)), gh.vel, this.hp / GAME.maxHP);
  }

  renderVehicles() {
    const g = this.game, va = this.veh.a, T = this.vT;
    let i = 0, j = T.length - 1;
    while (j - i > 1) { const m = (i + j) >> 1; if (T[m] <= this.pos) i = m; else j = m; }
    const k = T[j] > T[i] ? Math.max(0, Math.min(1, (this.pos - T[i]) / (T[j] - T[i]))) : 0;
    const end = (n) => (n + 1 < this.vOff.length ? this.vOff[n + 1] : this.veh.n);
    const next = new Map();
    for (let o = this.vOff[j]; o < end(j); o += V) next.set(va[o], o);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
    const rs = [g.traffic.renderer, g.police.renderer];
    rs.forEach((r) => r.begin());
    let siren = 0;
    for (let o = this.vOff[i]; o < end(i); o += V) {
      const o2 = next.get(va[o]) ?? o;
      const L = (d) => lerp(va[o + d], va[o2 + d], k);
      e.set(L(7), lerpAngle(va[o + 6], va[o2 + 6], k), 0);
      q.setFromEuler(e);
      p.set(L(3), L(4) + 0.02, L(5));
      m.compose(p, q, s);
      c.setRGB(va[o + 8], va[o + 9], va[o + 10]);
      rs[va[o + 1]].put(this.keys[va[o + 2]], m, c, va[o + 11], va[o + 12], va[o + 13]);
      if (va[o + 12] > 0) siren = Math.max(siren, Math.min(1, 160 / Math.max(20, p.distanceTo(this.ghost.pos))));
    }
    rs.forEach((r) => r.end());
    this.siren = siren;
  }

  // trackside camera: parked beside the road ahead, panning and zooming as the car goes by
  camera(dt) {
    const g = this.game, gh = this.ghost, rig = g.rig, cam = g.camera;
    if (this.cam === 'orbit') { rig.update(dt, gh, false, { orbit: true, radius: 11, height: 3 }); return; }
    if (this.cam !== 'tv' || gh.tunnel) {
      rig.mode = this.cam === 'tv' ? 'chase' : this.cam;
      rig.update(dt, gh, false, { boost: gh.flight.main > 0.1 });
      return;
    }
    const loop = g.world.loop, cs = g.world.cs;
    const d = this.tvAnchor ? this.tvAnchor.distanceTo(gh.pos) : Infinity;
    const toCam = this.tvAnchor ? this.tvAnchor.clone().sub(gh.pos) : null;
    const behind = toCam && toCam.dot(gh.vel) < 0;
    if (!this.tvAnchor || d > 160 || (behind && d > 45)) {
      const s = g.playerS + Math.max(45, Math.min(130, gh.speed * 2.2));
      const f = loop.frame(loop.wrap(s), {});
      const off = cs.right + 4 + Math.random() * 6;
      const x = f.x + f.rx * off, z = f.z + f.rz * off;
      const y = Math.max(f.y, g.world.surfaceAt(x, z, f.y + 30).y) + 1.6 + Math.random() * 3 + (gh.hAGL > 3 ? 4 : 0);
      this.tvAnchor = new THREE.Vector3(x, y, z);
    }
    cam.position.copy(this.tvAnchor);
    cam.up.set(0, 1, 0);
    const look = gh.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
    cam.lookAt(look);
    const dist = this.tvAnchor.distanceTo(look);
    cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(7 / dist)), 8, 60);
    cam.updateProjectionMatrix();
    rig.pos.copy(cam.position);
  }

  // ------------------------------------------------------------------ UI
  buildUi() {
    const el = document.createElement('div');
    el.id = 'replay';
    el.innerHTML = `
      <div class="rp-top"><b>Replay</b><span id="rp-info"></span></div>
      <div class="rp-tl"><div class="rp-clip" id="rp-clip"></div><input type="range" id="rp-seek" min="0" max="1000" value="0" step="1" aria-label="Replay position"></div>
      <div class="rp-row">
        <button id="rp-play" title="Play / pause (Space)">Pause</button>
        <span id="rp-time">0:00</span>
        <button id="rp-speed" title="Playback speed">1×</button>
        <button id="rp-cam" title="Camera (V)">Chase</button>
        <span class="rp-gap"></span>
        <button id="rp-in" title="Clip start (I)">Set start</button>
        <button id="rp-out" title="Clip end (O)">Set end</button>
        <select id="rp-fmt" title="Video shape"><option value="v">Vertical 9:16</option><option value="h">Landscape 16:9</option></select>
        <button id="rp-export" class="rp-primary" title="Save the clip as a video file">Save clip</button>
        <button id="rp-exit" title="Back to results (Esc)">Exit</button>
      </div>
      <div class="rp-help">Space play/pause · ←/→ 5 s · V camera · I/O clip start/end · H hide · Esc exit</div>
      <div class="rp-rec" id="rp-rec"></div>`;
    document.getElementById('app').appendChild(el);
    this.bar = el;
    const $ = (id) => el.querySelector('#' + id);
    this.el = { info: $('rp-info'), seek: $('rp-seek'), clip: $('rp-clip'), play: $('rp-play'), time: $('rp-time'), speed: $('rp-speed'), cam: $('rp-cam'), rec: $('rp-rec'), fmt: $('rp-fmt'), exp: $('rp-export') };
    const click = (id, fn) => $(id).addEventListener('click', (e) => { e.currentTarget.blur(); this.game.audio.click(); fn(); });
    click('rp-play', () => this.togglePlay());
    click('rp-speed', () => { this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]; this.refreshUi(true); });
    click('rp-cam', () => this.nextCam());
    click('rp-in', () => this.setIn());
    click('rp-out', () => this.setOut());
    click('rp-export', () => this.startExport());
    click('rp-exit', () => this.exit());
    this.el.seek.addEventListener('input', () => this.seek((this.el.seek.value / 1000) * this.duration));
    this.el.seek.addEventListener('change', () => this.el.seek.blur());
    this.el.fmt.addEventListener('change', () => this.el.fmt.blur());
  }
  setIn() { this.markIn = this.pos; if (this.markOut <= this.markIn + 1) this.markOut = Math.min(this.duration, this.markIn + 30); this.refreshUi(true); }
  setOut() { this.markOut = this.pos; if (this.markIn >= this.markOut - 1) this.markIn = Math.max(0, this.markOut - 30); this.refreshUi(true); }

  refreshUi(force = false) {
    const now = performance.now();
    if (!force && now - (this.uiT || 0) < 100) return;
    this.uiT = now;
    const D = this.duration || 1, e = this.el;
    e.seek.value = Math.round((this.pos / D) * 1000);
    e.time.textContent = `${fmtClock(this.pos)} / ${fmtClock(D)}`;
    e.play.textContent = this.paused ? 'Play' : 'Pause';
    e.speed.textContent = `${this.speed}×`;
    e.cam.textContent = CAM_LABEL[this.cam];
    e.clip.style.left = `${(this.markIn / D) * 100}%`;
    e.clip.style.width = `${((this.markOut - this.markIn) / D) * 100}%`;
    e.exp.textContent = `Save clip (${Math.round(this.markOut - this.markIn)} s)`;
    e.info.textContent = `Race time ${fmtTime(this.raceTime || 0)} · ${Math.round(this.ghost.speed / MPH)} mph`;
  }

  // ------------------------------------------------------------------ video export
  pickMime() {
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  }

  startExport() {
    const mime = this.pickMime();
    if (!mime) { this.flash('Video export is not supported in this browser. Try Chrome or Edge.'); return; }
    const g = this.game;
    const vertical = this.el.fmt.value === 'v';
    const [w, h] = vertical ? [1080, 1920] : [1920, 1080];
    g.viewport.set(w, h);
    this.cv = document.createElement('canvas');
    this.cv.width = w; this.cv.height = h;
    this.cx = this.cv.getContext('2d');
    const stream = this.cv.captureStream(30);
    const aud = g.audio.captureStream();
    if (aud) for (const t of aud.getAudioTracks()) stream.addTrack(t);
    this.chunks = [];
    this.mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6, audioBitsPerSecond: 192e3 });
    this.mr.ondataavailable = (ev) => { if (ev.data.size) this.chunks.push(ev.data); };
    this.mr.onstop = () => this.saveFile(mime);
    this.exportEnd = this.markOut;
    this.exportStart = this.markIn;
    this.exportFmt = { w, h, vertical };
    this.seek(this.markIn);
    this.paused = false;
    this.exporting = true;
    this.cancelled = false;
    this.bar.classList.add('exporting');
    this.mr.start(1000);
  }
  // called by the main loop right after the frame is drawn
  afterRender(glCanvas) {
    if (!this.exporting) return;
    const { w, h, vertical } = this.exportFmt, c = this.cx;
    c.drawImage(glCanvas, 0, 0, w, h);
    // overlay: race clock, speed, title and where to play
    // sizes in units of 1/1000 of the short side, so both shapes look the same on a phone
    const u = Math.min(w, h) / 1000, m = 44 * u;
    const font = (wt, px, fam = 'Rajdhani') => `${wt} ${Math.round(px * u)}px ${fam}, system-ui, sans-serif`;
    c.save();
    c.textBaseline = 'alphabetic';
    // race clock, top left
    c.font = font(700, 64);
    const clock = fmtTime(this.raceTime || 0), cw = c.measureText(clock).width;
    c.fillStyle = 'rgba(8,10,14,0.6)'; c.fillRect(m, m + (vertical ? 120 * u : 0), cw + 40 * u, 84 * u);
    c.fillStyle = '#fff'; c.fillText(clock, m + 20 * u, m + (vertical ? 120 * u : 0) + 64 * u);
    c.shadowColor = 'rgba(0,0,0,0.75)'; c.shadowBlur = 12 * u;
    // speed and flight mode, bottom right; title and link, bottom left
    const by = h - (vertical ? 300 * u : 0) - m;
    c.textAlign = 'right';
    c.font = font(600, 34); c.fillText('MPH', w - m, by);
    const mw = c.measureText('MPH').width;
    c.font = font(700, 130); c.fillText(`${Math.round(this.ghost.speed / MPH)}`, w - m - mw - 12 * u, by);
    const mode = this.ghost.flight.active ? 'FLIGHT' : this.ghost.wallRide ? (this.ghost.up().y < -0.5 ? 'CEILING' : 'WALL RIDE') : '';
    if (mode) { c.fillStyle = '#5cb0ff'; c.font = font(700, 40); c.fillText(mode, w - m, by - 120 * u); }
    c.textAlign = 'left'; c.fillStyle = '#fff';
    c.font = font(700, 44); c.fillText('ROADSTER: SEATTLE LOOP', m, by - 44 * u);
    c.fillStyle = '#e8edf3'; c.font = font(600, 30, 'Inter');
    c.fillText(`Play free · ${location.host}${location.pathname.replace(/\/$/, '')}`, m, by);
    c.restore();
    const left = Math.max(0, this.exportEnd - this.pos);
    this.el.rec.textContent = `● Recording clip · ${Math.ceil(left)} s left · Esc to cancel`;
  }
  finishExport() {
    this.exporting = false;
    this.paused = true;
    this.mr.stop();
    this.endExportView();
  }
  cancelExport() {
    this.cancelled = true;
    this.exporting = false;
    this.mr?.stop();
    this.endExportView();
  }
  endExportView() {
    this.bar.classList.remove('exporting');
    this.game.viewport.reset();
    this.game.audio.captureStream(false);
  }
  saveFile(mime) {
    if (this.cancelled) { this.flash('Export cancelled'); return; }
    const blob = new Blob(this.chunks, { type: mime.split(';')[0] });
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `roadster-${fmtTime(this.raceTime || 0).replace(/[:.]/g, '-')}-${this.exportFmt.vertical ? 'vertical' : 'landscape'}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    this.flash(`Saved ${a.download}${ext === 'webm' ? ' (WebM: most sites accept it, or convert to MP4)' : ''}`);
  }
  flash(msg) {
    this.el.rec.textContent = msg;
    this.bar.classList.add('note');
    clearTimeout(this.noteT);
    this.noteT = setTimeout(() => this.bar.classList.remove('note'), 5000);
  }
}

function fmtClock(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }
