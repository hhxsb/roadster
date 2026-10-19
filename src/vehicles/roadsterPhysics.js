import * as THREE from 'three';
import { ROADSTER as R, MPH, settings } from '../config.js';
import { tunnelContext, toLocal, dirToLocal, boreRay, boreDistance, normalToWorld } from '../world/tunnel.js';

const G = 9.81, RHO = 1.225;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _m3 = new THREE.Matrix3();
const _near = {}, _fr = {}, _ra = {}, _right = new THREE.Vector3();

// Magic-formula lateral force shape (normalised, peak 1 around 6-7 degrees slip)
function mf(alpha) {
  const B = 12, C = 1.62, E = 0.6, x = B * alpha;
  return Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

export class RoadsterPhysics {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.airMax = R.airMassKg;
    this.air = this.airMax;
    this.inertia = new THREE.Vector3(); // body-frame diagonal (x pitch, y yaw, z roll)
    this.updateMass();
    this.mountY = -R.cgHeight + R.wheelRadius + (R.restLength - (this.mass * G / 4) / R.springK);
    this.wheels = [
      { x: R.trackF / 2, z: R.wheelbase / 2, front: true }, { x: -R.trackF / 2, z: R.wheelbase / 2, front: true },
      { x: R.trackR / 2, z: -R.wheelbase / 2, front: false }, { x: -R.trackR / 2, z: -R.wheelbase / 2, front: false },
    ].map((w) => ({ ...w, comp: 0, prevComp: 0, contact: false, fz: 0, slip: 0, spin: 0, len: R.restLength, surface: null, longSlip: 0, latSlip: 0, wpos: new THREE.Vector3() }));
    this.steer = 0;
    this.flight = { active: false, autoland: false, forced: false, lift: 0, main: 0, rcs: 0, altTarget: 0 };
    this.fans = true;
    this.reverse = false;
    this.events = [];
    this.groundContacts = 0;
    this.airTime = 0;
    this.thrustVec = new THREE.Vector3();
    this.liftPorts = new Float32Array(6);
    this.sinking = false;
    this.gripMul = 1;
  }

  get gasScale() { return settings.air === 'extended' ? 3.5 : 1; }
  updateMass() {
    this.mass = R.dryMassKg + this.air;
    const m = this.mass * 0.85;
    this.inertia.set((m / 12) * (R.height ** 2 + R.length ** 2), (m / 12) * (R.width ** 2 + R.length ** 2), (m / 12) * (R.width ** 2 + R.height ** 2) * 0.8);
  }

  reset(x, y, z, heading) {
    this.pos.set(x, y + R.cgHeight + 0.05, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.flight.active = false; this.flight.autoland = false; this.flight.forced = false;
    this.steer = 0;
    this.sinking = false;
    for (const w of this.wheels) { w.comp = w.prevComp = 0.1; }
  }

  // world-space helpers
  forward(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.quat); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  left(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.quat); }
  local(p, out) { return out.copy(p).applyQuaternion(this.quat).add(this.pos); }
  get speed() { return this.vel.length(); }
  get forwardSpeed() { return this.vel.dot(this.forward(_v3)); }

  pointVelocity(p, out) { return out.copy(this.angVel).cross(_v.copy(p).sub(this.pos)).add(this.vel); }

  invInertiaWorld(out) {
    const m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.quat));
    const d = new THREE.Matrix3().set(1 / this.inertia.x, 0, 0, 0, 1 / this.inertia.y, 0, 0, 0, 1 / this.inertia.z);
    const mt = m.clone().transpose();
    return out.copy(m).multiply(d).multiply(mt);
  }

  // Impulse at a world point (used for collisions)
  applyImpulse(point, J) {
    this.vel.addScaledVector(J, 1 / this.mass);
    const r = _v2.copy(point).sub(this.pos);
    const t = r.cross(J);
    this.invInertiaWorld(_m3);
    this.angVel.add(t.applyMatrix3(_m3));
  }

  // Resolve a penetrating contact: point, outward normal, depth. Returns impact speed.
  contact(point, n, depth, restitution = 0.15, friction = 0.35, maxCorr = 0.5) {
    const corr = Math.min(depth, maxCorr);
    this.pos.addScaledVector(n, corr * 0.8);
    const vp = this.pointVelocity(point, new THREE.Vector3());
    const vn = vp.dot(n);
    if (vn >= 0) return 0;
    this.invInertiaWorld(_m3);
    const r = new THREE.Vector3().copy(point).sub(this.pos);
    const rn = new THREE.Vector3().copy(r).cross(n).applyMatrix3(_m3).cross(r);
    const k = 1 / this.mass + n.dot(rn);
    const jn = (-(1 + restitution) * vn) / k;
    const J = n.clone().multiplyScalar(jn);
    // friction impulse (Coulomb, clamped)
    const vt = vp.clone().addScaledVector(n, -vn);
    const vtl = vt.length();
    if (vtl > 1e-3) {
      const t = vt.multiplyScalar(1 / vtl);
      const rt = new THREE.Vector3().copy(r).cross(t).applyMatrix3(_m3).cross(r);
      const kt = 1 / this.mass + t.dot(rt);
      const jt = Math.min(vtl / kt, friction * jn);
      J.addScaledVector(t, -jt);
    }
    this.applyImpulse(point, J);
    return -vn;
  }

  step(dt, input) {
    const fwd = this.forward(new THREE.Vector3()), up = this.up(new THREE.Vector3()), left = this.left(new THREE.Vector3());
    const force = new THREE.Vector3(0, -G * this.mass, 0);
    const torque = new THREE.Vector3();
    const _r = new THREE.Vector3();
    const addForceAt = (F, p) => { force.add(F); torque.add(_r.subVectors(p, this.pos).cross(F)); };
    const speed = this.vel.length();
    const vF = this.vel.dot(fwd);

    // ---------------------------------------------------------------- suspension + tyres
    let contacts = 0, fzTotal = 0;
    const mu = R.tireMu * this.gripMul;
    // steering: speed-sensitive lock so full input gives ~1.3 g at speed
    const vAbs = Math.max(1, Math.abs(vF));
    const lock = Math.min(R.maxSteer, (R.wheelbase * 1.35 * G) / (vAbs * vAbs) + 0.055);
    const target = -input.steer * lock;
    const rate = 2.6 * lock + 0.4;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -rate * dt, rate * dt);

    const drive = this.driveForce(input, vF);
    const s = this.world.surfaceAt.bind(this.world);
    // inside a tunnel the wheels ray-cast against the bore walls, so the car can ride walls and ceiling
    const tc = this.world.tunnelBores ? tunnelContext(this.world, this.pos, this._tc || (this._tc = {})) : null;
    this.tunnel = tc;
    const downDir = up.clone().negate();
    let nearSurface = false;
    for (const w of this.wheels) {
      const mount = this.local(_v2.set(w.x, this.mountY, w.z), new THREE.Vector3());
      w.contact = false; w.fz = 0;
      let d, n, stype;
      if (tc) {
        const [lo, lh] = toLocal(tc, mount), [dO, dH] = dirToLocal(tc, downDir);
        const hit = boreRay(tc.bore, lo, lh, dO, dH);
        if (hit && hit.t < R.restLength + R.wheelRadius + 0.45) nearSurface = true; // fans still seal within ~0.45 m
        if (!hit || hit.t > R.restLength + R.wheelRadius + 0.2) { w.len = R.restLength; w.comp = 0; w.prevComp = 0; w.surface = 'none'; continue; }
        d = hit.t; n = normalToWorld(tc, hit.edge.nx, hit.edge.ny, new THREE.Vector3()); stype = 'road';
      } else {
        const upY = up.y;
        if (upY < 0.25) { w.len = R.restLength; continue; }
        const surf = s(mount.x, mount.z, mount.y + 0.2);
        if (surf.type === 'water' || surf.type === 'none') { w.surface = surf.type; w.len = R.restLength; continue; }
        d = (mount.y - surf.y) / upY;               // distance along -up to the surface
        n = new THREE.Vector3(surf.nx, surf.ny, surf.nz); stype = surf.type;
      }
      w.surface = stype;
      const len = d - R.wheelRadius;
      w.len = Math.min(R.restLength, Math.max(R.restLength - R.maxTravel, len));
      if (len >= R.restLength) { w.comp = 0; w.prevComp = 0; continue; }
      const comp = R.restLength - len;
      // damper velocity from the actual approach speed of the wheel mount (stable on first contact)
      const compVel = THREE.MathUtils.clamp(-this.pointVelocity(mount, _v3).dot(up), -8, 8);
      w.comp = comp;
      let fz = R.springK * Math.min(comp, R.maxTravel) + R.damperC * compVel;
      if (comp > R.maxTravel) {
        fz += 350000 * (comp - R.maxTravel) + 9000 * Math.max(0, compVel);
        if (compVel > 6.5 && w.prevComp < R.maxTravel) this.events.push({ type: 'bottom', v: compVel });
      }
      fz = Math.max(0, Math.min(fz, 60000));
      w.contact = true; w.fz = fz; w.prevComp = comp; contacts++; fzTotal += fz;
      const cp = _v2.copy(mount).addScaledVector(up, -(len + R.wheelRadius));
      w.wpos.copy(cp);
      addForceAt(_v.copy(up).multiplyScalar(fz), cp.clone());
      // tyre frame
      const steerA = w.front ? this.steer : 0;
      const wf = fwd.clone().applyAxisAngle(up, steerA);
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const ws = new THREE.Vector3().crossVectors(n, wf).normalize(); // points left
      const vc = this.pointVelocity(cp, new THREE.Vector3());
      const vl = vc.dot(wf), vs = vc.dot(ws);
      const surfMu = stype === 'road' ? mu : stype === 'roof' ? mu * 0.9 : mu * 0.7;
      // staggered tyres: 265 front / 325 rear -> more rear lateral grip (stable, slight understeer)
      let latMu = surfMu * (w.front ? 0.97 : 1.12) * (input.handbrake && !w.front ? 0.45 : 1);
      const alpha = Math.atan2(vs, Math.max(Math.abs(vl), 4.0));
      let fy = -latMu * fz * mf(alpha);
      // longitudinal
      let fx = 0;
      const share = w.front ? 0.35 / 2 : 0.65 / 2;
      fx += drive.motor * share;
      // braking
      const bshare = w.front ? 0.6 / 2 : 0.4 / 2;
      let fb = drive.brake * bshare;
      if (input.handbrake && !w.front) fb += 0.9 * this.mass * G * 0.25;
      if (Math.abs(vl) < 0.6) fx -= THREE.MathUtils.clamp(vl * 3000, -fb, fb);
      else fx -= Math.sign(vl) * fb;
      fx -= Math.sign(vl) * 0.012 * fz * Math.min(1, Math.abs(vl)); // rolling resistance
      // friction circle (traction control / ABS keep it at the limit)
      const lim = surfMu * fz;
      const tot = Math.hypot(fx, fy);
      w.slip = 0;
      if (tot > lim) {
        w.slip = (tot - lim) / lim;
        // longitudinal priority below the limit, lateral loses grip first when sliding
        const fxL = THREE.MathUtils.clamp(fx, -lim * 0.98, lim * 0.98);
        const fyMax = Math.sqrt(Math.max(0, lim * lim - fxL * fxL));
        fx = fxL; fy = THREE.MathUtils.clamp(fy, -fyMax, fyMax);
      }
      w.latSlip = Math.abs(vs) > 1.5 && Math.abs(alpha) > 0.16 ? Math.min(1, (Math.abs(alpha) - 0.16) * 3) : 0;
      if (input.handbrake && !w.front && Math.abs(vl) > 3) w.latSlip = Math.max(w.latSlip, 0.6);
      addForceAt(wf.multiplyScalar(fx).add(ws.multiplyScalar(fy)), cp.clone());
      w.spin += (vl / R.wheelRadius) * dt;
    }
    // anti-roll bars
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const wa = this.wheels[a], wb = this.wheels[b];
      if (!wa.contact && !wb.contact) continue;
      const diff = (wa.comp - wb.comp) * 26000;
      const pa = this.local(_v2.set(wa.x, this.mountY, wa.z), new THREE.Vector3()), pb = this.local(_v2.set(wb.x, this.mountY, wb.z), new THREE.Vector3());
      if (wa.contact) addForceAt(up.clone().multiplyScalar(diff), pa);
      if (wb.contact) addForceAt(up.clone().multiplyScalar(-diff), pb);
    }
    const grounded = contacts > 0;
    this.groundContacts = contacts;
    // electronic stability control: limit yaw rate to what the tyres can sustain and
    // counter large body slip angles (disabled with the handbrake for drifting)
    if (contacts >= 3 && !input.handbrake && Math.abs(vF) > 6) {
      const yawRate = this.angVel.dot(up);
      const vLat = this.vel.dot(left);
      const beta = Math.atan2(vLat, Math.abs(vF));
      const rKin = (vF * this.steer) / R.wheelbase;
      const rMax = (R.tireMu * G * 1.05) / Math.abs(vF);
      const rRef = THREE.MathUtils.clamp(rKin, -rMax, rMax);
      let corr = 0;
      const err = yawRate - rRef;
      if (Math.abs(yawRate) > Math.abs(rRef) + 0.05 || (Math.sign(yawRate) !== Math.sign(rRef) && Math.abs(yawRate) > 0.08)) corr -= err * 14000;
      // body slip beyond ~6 degrees: yaw back towards the direction of travel
      if (Math.abs(beta) > 0.1) corr += (beta - Math.sign(beta) * 0.1) * Math.sign(vF) * 30000;
      corr = THREE.MathUtils.clamp(corr, -14000, 14000);
      torque.addScaledVector(up, corr);
      this.esc = Math.abs(corr) > 1500;
    } else this.esc = false;

    // ---------------------------------------------------------------- aero
    const dragF = this.vel.clone().multiplyScalar(-0.5 * RHO * R.cdA * speed);
    force.add(dragF);
    const down = 0.5 * RHO * R.clA * vF * vF;
    let fanF = 0;
    if (this.fans && ((grounded && up.y > 0.7) || (tc && (grounded || nearSurface)))) {
      fanF = R.fanDownforceN * Math.min(1, 0.4 + speed / 30);
      // multi-mode suction: on tunnel walls / ceiling the fans spool up to hold the car on
      if (tc) fanF = Math.min(R.fanMaxN, fanF + this.mass * G * (1 - up.y) * 0.8);
    }
    this.wallRide = !!tc && (grounded || nearSurface) && up.y < 0.8;
    force.addScaledVector(up, -(down + fanF));
    this.fanForce = fanF;
    // aerodynamic damping of rotation (so tumbling cars don't spin forever)
    torque.addScaledVector(this.angVel, -900 - speed * 25);

    // ---------------------------------------------------------------- thrusters
    this.flightControl(dt, input, grounded, up, fwd, left, force, torque);

    // ---------------------------------------------------------------- integrate
    this.vel.addScaledVector(force, dt / this.mass);
    this.invInertiaWorld(_m3);
    this.angVel.add(torque.applyMatrix3(_m3).multiplyScalar(dt));
    this.pos.addScaledVector(this.vel, dt);
    const wq = new THREE.Quaternion(this.angVel.x * dt * 0.5, this.angVel.y * dt * 0.5, this.angVel.z * dt * 0.5, 0).multiply(this.quat);
    this.quat.x += wq.x; this.quat.y += wq.y; this.quat.z += wq.z; this.quat.w += wq.w;
    this.quat.normalize();

    // ---------------------------------------------------------------- body collisions with the world
    this.bodyCollisions();

    // air recharge from the onboard compressor (only while driving on the ground)
    if (grounded && !this.flight.active && input.boost < 0.05) this.air = Math.min(this.airMax, this.air + R.compressorKgPerSec * (settings.air === 'extended' ? 2.5 : 1) * dt);
    this.updateMass();
    this.airTime = grounded ? 0 : this.airTime + dt;
  }

  driveForce(input, vF) {
    const v = Math.abs(vF);
    let motor = 0, brake = 0;
    if (input.hold) { this.reverse = false; this.revTimer = 0; return { motor: 0, brake: 1.2 * this.mass * G }; }
    // automatic reverse when stopped and holding brake
    if (input.brake > 0.1 && vF < 0.8 && input.throttle < 0.05) { this.revTimer = (this.revTimer || 0) + 1; if (this.revTimer > 18) this.reverse = true; }
    else this.revTimer = 0;
    if (input.throttle > 0.05 && this.reverse && vF > -0.5) this.reverse = false;
    const peakF = R.wheelTorqueNm / R.wheelRadius;
    const Fp = Math.min(peakF, R.motorPowerW / Math.max(v, 1));
    if (this.reverse) {
      if (input.brake > 0.05) motor = -Math.min(peakF * 0.25, 60000 / Math.max(v, 1)) * input.brake * (vF > -12 ? 1 : 0);
      if (input.throttle > 0.05) brake = input.throttle * 1.1 * this.mass * G;
    } else {
      motor = Fp * input.throttle;
      if (vF > R.topSpeedMph * MPH) motor = 0;               // electronic limiter
      brake = input.brake * 1.15 * this.mass * G;
      if (input.throttle < 0.05 && input.brake < 0.05 && v > 2) brake += 0.1 * this.mass * G; // regen coast
    }
    this.motorPower = Math.abs(motor * vF);
    return { motor, brake };
  }

  flightControl(dt, input, grounded, up, fwd, left, force, torque) {
    const f = this.flight;
    const thrustScale = Math.min(1, this.air / (this.airMax * 0.06));
    const ve = R.exhaustVel * this.gasScale;
    let gas = 0;
    // engage
    if (input.lift > 0.1 && !f.active && this.air > 2) { f.active = true; f.autoland = false; f.forced = false; }
    if (input.land && f.active) f.autoland = true;
    // surface height below for altitude logic
    const below = this.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y);
    const hAGL = this.pos.y - R.cgHeight - (below.type === 'none' ? -1e3 : below.y);
    this.hAGL = hAGL;
    // reserve: enough air to descend at ~3 m/s from here and touch down softly
    const hoverFlow = (this.mass * G) / ve;
    const reserve = (Math.max(0, hAGL) / 4.5 + 1.6) * hoverFlow;
    if (f.active && !f.autoland && this.air < reserve) { f.autoland = true; f.forced = true; this.events.push({ type: 'lowair' }); }

    let lift = 0, main = 0;
    const tq = new THREE.Vector3();
    if (f.active) {
      let vsCmd;
      if (f.autoland) vsCmd = -THREE.MathUtils.clamp(0.6 * hAGL, 1.6, 8);
      else vsCmd = input.lift > 0.1 ? 7 * input.lift : input.descend > 0.1 ? -6 * input.descend : 0;
      const aCmd = THREE.MathUtils.clamp(2.2 * (vsCmd - this.vel.y), -G, 9) + G;
      lift = THREE.MathUtils.clamp((this.mass * aCmd) / Math.max(0.5, up.y), 0, R.liftThrustN) * thrustScale;
      // last few centimetres: let the suspension take it
      if (f.autoland && hAGL < 0.35) lift *= 0.3;
      // finished landing
      if (grounded && this.groundContacts >= 3 && (f.autoland || input.descend > 0.1) && Math.abs(this.vel.y) < 1.5) { f.active = false; f.autoland = false; this.events.push({ type: 'landed' }); }
    }
    // attitude control: active in flight, and automatically when airborne & tumbling
    const tumble = !grounded && (up.y < 0.85 || this.angVel.length() > 1.2) && this.airTime > 0.15;
    if ((f.active || tumble) && this.air > 0.5) {
      // desired orientation: level, tilted by the pilot (W/S pitch, A/D yaw)
      const pitchCmd = f.active && !f.autoland ? (input.throttle - input.brake) * 0.2 : 0; // + = nose down
      const yawRateCmd = f.active ? -input.steer * 1.1 : 0;
      let yawFix = 0;
      if (f.autoland && this.alignHeading !== undefined) {
        const cur = Math.atan2(fwd.x, fwd.z);
        let d = this.alignHeading - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
        yawFix = THREE.MathUtils.clamp(d * 1.2, -0.8, 0.8);
      }
      // desired up vector: world up tilted forward by pitchCmd about the left axis
      const flatF = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      const upDes = new THREE.Vector3(0, 1, 0).addScaledVector(flatF, Math.tan(pitchCmd)).normalize();
      const err = new THREE.Vector3().crossVectors(up, upDes); // axis * sin(angle)
      const Kp = 9.0 * this.inertia.x, Kd = 4.2;
      const tqLevel = err.multiplyScalar(Kp);
      const yawErr = (yawRateCmd + yawFix) - this.angVel.dot(up);
      tq.copy(tqLevel).addScaledVector(up, yawErr * 3.0 * this.inertia.y);
      // rate damping on the non-yaw axes
      const angNoYaw = this.angVel.clone().addScaledVector(up, -this.angVel.dot(up));
      tq.addScaledVector(angNoYaw, -Kd * this.inertia.x);
      const maxT = 14000;
      if (tq.length() > maxT) tq.setLength(maxT);
      torque.add(tq);
      gas += tq.length() / 1.3 / ve;
      f.rcs = tq.length() / maxT;
    } else f.rcs = 0;
    // main rear thrusters (boost) - ground or air
    if (input.boost > 0.05 && this.air > 0.5) main = R.rearThrustN * input.boost * thrustScale;
    force.addScaledVector(up, lift);
    force.addScaledVector(fwd, main);
    gas += (lift + main) / ve;
    this.air = Math.max(0, this.air - gas * dt);
    f.lift = lift / R.liftThrustN; f.main = main / R.rearThrustN;
    this.gasFlow = gas;
  }

  bodyCollisions() {
    const w = this.world;
    const hw = R.width / 2 - 0.02, hl = R.length / 2 - 0.05;
    const corners = this._corners || (this._corners = [
      [hw - 0.15, -0.26, hl - 0.15], [-hw + 0.15, -0.26, hl - 0.15], [hw - 0.15, -0.26, -hl + 0.15], [-hw + 0.15, -0.26, -hl + 0.15],
      [hw, 0.35, hl - 0.3], [-hw, 0.35, hl - 0.3], [hw, 0.35, -hl + 0.2], [-hw, 0.35, -hl + 0.2],
      [0.6, 0.72, 0.0], [-0.6, 0.72, 0.0], [0, 0.72, -0.4], [hw, 0.1, 0], [-hw, 0.1, 0],
    ].map((c) => new THREE.Vector3(...c)));
    const p = new THREE.Vector3();
    let maxImpact = 0, scrape = 0;
    const cs = w.cs;
    const ra = w.roadAt(this.pos.x, this.pos.z, this.pos.y, _ra);
    const road = ra && ra.dist < 45 && Math.abs(ra.y - this.pos.y) < 12 ? ra.route : null;
    const centerOff = road ? ra.offset : 0;
    const hitWall = (n, depth) => {
      const imp = this.contact(p.clone(), n, depth, 0.12, 0.25);
      maxImpact = Math.max(maxImpact, imp);
      if (depth > 0.03 || imp > 0.6) scrape = Math.max(scrape, this.vel.length());
    };
    if (this.tunnel) {
      const tc = this.tunnel;
      for (const c of corners) {
        this.local(c, p);
        const [lo, lh] = toLocal(tc, p);
        const bd = boreDistance(tc.bore, lo, lh);
        if (bd.d < 0) {
          const imp = this.contact(p.clone(), normalToWorld(tc, bd.edge.nx, bd.edge.ny, new THREE.Vector3()), Math.min(0.6, -bd.d), 0.12, 0.3);
          maxImpact = Math.max(maxImpact, imp);
          if (-bd.d > 0.03 || imp > 0.6) scrape = Math.max(scrape, this.vel.length());
        }
      }
      if (maxImpact > 0.1) this.events.push({ type: 'impact', v: maxImpact });
      this.scrape = scrape;
      return;
    }
    for (const c of corners) {
      this.local(c, p);
      // ground / roads / roofs
      const surf = w.surfaceAt(p.x, p.z, p.y + 1.2);
      if (surf.type !== 'none' && surf.type !== 'water' && p.y < surf.y) {
        const n = new THREE.Vector3(surf.nx, surf.ny, surf.nz);
        const depth = (surf.y - p.y) * n.y;
        const imp = this.contact(p.clone(), n, depth, 0.1, 0.5);
        maxImpact = Math.max(maxImpact, imp);
        if (depth > 0.03 || imp > 0.6) scrape = Math.max(scrape, this.vel.length());
      }
      // barriers and tunnel walls of the road under the car
      if (road) {
        const q = road.nearest(p.x, p.z, _near, 1);
        if (q) {
          const i = Math.floor(road.index(q.s)), rel = p.y - q.y;
          const tunnel = road.kind[i] === 2, barH = tunnel ? 7.2 : 0.9;
          const f = road.frame(q.s, _fr), right = _right.set(f.rx, 0, f.rz);
          if (rel > -0.6 && rel < barH) {
            if ((road.barR[i] || tunnel) && q.offset > cs.right && q.offset < cs.right + 1.6) hitWall(right.clone().negate(), q.offset - cs.right);
            if ((road.barL[i] || tunnel) && q.offset < cs.left && q.offset > cs.left - 1.6) hitWall(right.clone(), cs.left - q.offset);
            const mw = tunnel ? 0.45 : 0.32;
            if ((road.barM[i] || tunnel) && Math.abs(q.offset - cs.medianCenter) < mw) {
              const side = centerOff - cs.medianCenter >= 0 ? 1 : -1;
              hitWall(right.clone().multiplyScalar(side), Math.min(0.6, mw - (q.offset - cs.medianCenter) * side));
            }
          }
          if (tunnel && rel > 6.9 && rel < 9 && q.offset > cs.left && q.offset < cs.right) {
            maxImpact = Math.max(maxImpact, this.contact(p.clone(), new THREE.Vector3(0, -1, 0), rel - 6.9, 0.1, 0.3));
          }
        }
      }
      // buildings
      if (w.buildings) {
        const hit = w.buildings.resolvePoint(p.x, p.y, p.z, this._bhit || (this._bhit = {}));
        if (hit) {
          maxImpact = Math.max(maxImpact, this.contact(p.clone(), new THREE.Vector3(hit.nx, 0, hit.nz), hit.depth + 0.02, 0.1, 0.3, 1.5));
          scrape = Math.max(scrape, this.vel.length());
        }
      }
    }
    // world bounds
    const b = w.bounds, m = 150;
    if (this.pos.x < b.x0 + m) { this.pos.x = b.x0 + m; this.vel.x = Math.abs(this.vel.x) * 0.3; }
    if (this.pos.x > b.x1 - m) { this.pos.x = b.x1 - m; this.vel.x = -Math.abs(this.vel.x) * 0.3; }
    if (this.pos.z < b.z0 + m) { this.pos.z = b.z0 + m; this.vel.z = Math.abs(this.vel.z) * 0.3; }
    if (this.pos.z > b.z1 - m) { this.pos.z = b.z1 - m; this.vel.z = -Math.abs(this.vel.z) * 0.3; }
    if (this.pos.y > 1500) { this.pos.y = 1500; this.vel.y = Math.min(0, this.vel.y); }
    // water
    if (w.isWater(this.pos.x, this.pos.z) && this.pos.y < w.waterLevelAt(this.pos.x, this.pos.z) + 0.25) {
      if (!this.sinking) this.events.push({ type: 'splash', v: this.vel.length() });
      this.sinking = true;
    }
    if (this.sinking) { this.vel.multiplyScalar(0.9); this.angVel.multiplyScalar(0.9); }
    if (maxImpact > 0.1) this.events.push({ type: 'impact', v: maxImpact });
    this.scrape = scrape;
  }
}
