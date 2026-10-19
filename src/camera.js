import * as THREE from 'three';
import { toLocal, boreDistance } from './world/tunnel.js';

const MODES = ['chase', 'far', 'hood', 'cockpit'];
const _worldUp = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, 1);
    this.shakeAmt = 0;
    this.t = 0;
    this.orbit = 0;
    this.camUp = new THREE.Vector3(0, 1, 0);
  }
  next() { this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]; return this.mode; }
  shake(a) { this.shakeAmt = Math.min(1.5, this.shakeAmt + a); }

  snap(phys) { this.update(1, phys, true); }

  update(dt, phys, snap = false, opts = {}) {
    this.t += dt;
    const cam = this.camera;
    const p = phys.pos, q = phys.quat;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const speed = phys.vel.length();
    if (window.__cam) { // debug free camera: window.__cam = {pos:[x,y,z], look:[x,y,z]}
      cam.position.set(...window.__cam.pos); cam.up.set(0, 1, 0); cam.lookAt(...window.__cam.look);
      cam.fov = window.__cam.fov || 60; cam.updateProjectionMatrix();
      return;
    }
    if (opts.orbit) {
      // slow orbit around a fixed point (menus, game over)
      this.orbit += dt * 0.12;
      const r = opts.radius || 14;
      const tgt = this.pos.set(p.x + Math.sin(this.orbit) * r, p.y + (opts.height || 4), p.z + Math.cos(this.orbit) * r);
      cam.position.copy(tgt);
      const s = this.world.surfaceAt(cam.position.x, cam.position.z, cam.position.y + 50);
      if (cam.position.y < s.y + 1.2) cam.position.y = s.y + 1.2;
      cam.lookAt(p.x, p.y + 0.6, p.z);
      cam.fov = 55; cam.updateProjectionMatrix();
      return;
    }
    // reference "up": world up normally, the car's up while it rides tunnel walls / ceiling
    const refUp = phys.tunnel && (phys.wallRide || up.y < 0.9) ? up : _worldUp;
    this.camUp.lerp(refUp, snap ? 1 : 1 - Math.exp(-dt * 5)).normalize();
    const cu = this.camUp;
    // heading: car forward (blended with travel direction) projected onto the plane normal to camUp
    const flatF = fwd.clone().addScaledVector(cu, -fwd.dot(cu));
    if (flatF.lengthSq() < 1e-4) flatF.copy(this.heading); else flatF.normalize();
    const vf = phys.vel.clone().addScaledVector(cu, -phys.vel.dot(cu));
    if (vf.length() > 8 && vf.dot(flatF) > 0) flatF.lerp(vf.normalize(), 0.25).normalize();
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.heading.lerp(flatF, k).normalize();
    const flying = phys.flight.active || phys.hAGL > 2.5;
    let desired, look;
    if (this.mode === 'chase' || this.mode === 'far') {
      const far = this.mode === 'far';
      const inTunnel = !!phys.tunnel;
      const dist = (far ? 10.5 : 6.4) * (inTunnel ? 0.85 : 1) + Math.min(speed, 90) * 0.018 + (flying ? 3 : 0);
      const h = (far ? 3.4 : 1.95) * (inTunnel ? 0.8 : 1) + (flying ? 1.6 : 0);
      desired = new THREE.Vector3().copy(p).addScaledVector(this.heading, -dist).addScaledVector(cu, h);
      look = new THREE.Vector3().copy(p).addScaledVector(this.heading, 4).addScaledVector(cu, 0.75);
      const kp = snap ? 1 : 1 - Math.exp(-dt * (far ? 6 : 10));
      this.pos.lerp(desired, kp);
      const off = this.pos.clone().sub(p); const d = off.length();
      if (d > dist * 1.4) this.pos.copy(p).addScaledVector(off.normalize(), dist * 1.4);
      if (phys.tunnel) {
        // keep the camera inside the tunnel bore
        const tc = phys.tunnel, c = this.pos.clone();
        for (let i = 0; i < 8; i++) {
          const [lo, lh] = toLocal(tc, c);
          if (boreDistance(tc.bore, lo, lh).d > 0.4) break;
          c.lerp(p, 0.35);
        }
        this.pos.copy(c);
      } else {
        const sAt = this.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y + 2);
        if (this.pos.y < sAt.y + 0.6) this.pos.y = sAt.y + 0.6;
      }
      cam.position.copy(this.pos);
      this.look.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 14));
      cam.up.copy(cu);
      cam.lookAt(this.look);
    } else {
      // attached cameras follow the full body orientation
      const local = this.mode === 'hood' ? new THREE.Vector3(0, 0.62, 1.1) : new THREE.Vector3(0.36, 0.62, -0.42);
      cam.position.copy(local.applyQuaternion(q).add(p));
      cam.up.copy(up);
      cam.lookAt(cam.position.clone().addScaledVector(fwd, 10).addScaledVector(up, this.mode === 'hood' ? -0.3 : -0.6));
      this.pos.copy(cam.position);
    }
    // shake
    if (this.shakeAmt > 0.001) {
      const a = this.shakeAmt;
      cam.position.x += (Math.random() - 0.5) * a * 0.5; cam.position.y += (Math.random() - 0.5) * a * 0.4; cam.position.z += (Math.random() - 0.5) * a * 0.5;
      this.shakeAmt *= Math.exp(-dt * 5);
    }
    // high-speed buzz
    if (speed > 50 && phys.groundContacts > 0) {
      const b = (speed - 50) * 0.0006;
      cam.position.y += Math.sin(this.t * 61) * b; cam.position.x += Math.sin(this.t * 47) * b;
    }
    const fov = (this.mode === 'cockpit' ? 70 : 60) + Math.min(24, speed * 0.18) + (opts.boost ? 6 : 0);
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 4));
    cam.updateProjectionMatrix();
  }
}
