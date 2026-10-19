import * as THREE from 'three';

const VS = `
attribute float aSize; attribute vec4 aColor;
varying vec4 vColor;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main(){
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (900.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const FS = `
varying vec4 vColor;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main(){
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d) * vColor.a;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <fog_fragment>
}`;

class Pool {
  constructor(n, blending) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.grow = new Float32Array(n); this.drag = new Float32Array(n); this.grav = new Float32Array(n);
    this.c0 = new Float32Array(n * 4); this.c1 = new Float32Array(n * 4); this.s0 = new Float32Array(n);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr); g.setAttribute('aColor', this.colAttr); g.setAttribute('aSize', this.sizeAttr);
    const m = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending, fog: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]) });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  emit(p, v, o) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = 0; this.max[i] = o.life; this.s0[i] = o.size; this.grow[i] = o.grow || 0; this.drag[i] = o.drag || 0; this.grav[i] = o.grav || 0;
    this.c0.set(o.c0, i * 4); this.c1.set(o.c1 || o.c0, i * 4);
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.max[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.life[i] += dt;
      const t = this.life[i] / this.max[i];
      if (t >= 1) { this.max[i] = 0; this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      for (let c = 0; c < 4; c++) this.col[i * 4 + c] = this.c0[i * 4 + c] + (this.c1[i * 4 + c] - this.c0[i * 4 + c]) * t;
      this.col[i * 4 + 3] *= Math.min(1, t * 8) * (1 - t);
      this.size[i] = this.s0[i] * (1 + this.grow[i] * t);
    }
    this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true;
  }
  clear() { this.max.fill(0); }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new Pool(3500, THREE.NormalBlending);
    this.glow = new Pool(1800, THREE.AdditiveBlending);
    scene.add(this.smoke.points, this.glow.points);
    this._v = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.flash = new THREE.PointLight(0xff9a40, 0, 120, 1.6);
    scene.add(this.flash);
    this.flashT = 0;
    this.debris = [];
    this.debrisGeo = new THREE.BoxGeometry(0.5, 0.15, 0.4);
    // skid marks
    this.skidN = 1400;
    this.skidPos = new Float32Array(this.skidN * 4 * 3);
    this.skidA = new Float32Array(this.skidN * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.skidA, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < this.skidN; i++) idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3);
    g.setIndex(idx);
    const sm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      vertexShader: `attribute float aA; varying float vA;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `varying float vA;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(0.02,0.02,0.02, vA * 0.55); }`,
    });
    this.skidMesh = new THREE.Mesh(g, sm);
    this.skidMesh.frustumCulled = false;
    scene.add(this.skidMesh);
    this.skidNext = 0;
    this.lastSkid = [null, null, null, null];
  }

  thruster(p, dir, strength, carVel) {
    // cold-gas plume: supersonic air that condenses into a white mist
    const n = Math.ceil(strength * 3);
    for (let k = 0; k < n; k++) {
      const sp = 40 + Math.random() * 30;
      this._v.copy(dir).multiplyScalar(sp).add(carVel);
      this._v.x += (Math.random() - 0.5) * 6; this._v.y += (Math.random() - 0.5) * 6; this._v.z += (Math.random() - 0.5) * 6;
      this._p.copy(p).addScaledVector(dir, Math.random() * 0.4);
      this.smoke.emit(this._p, this._v, { life: 0.35 + Math.random() * 0.35, size: 0.25, grow: 9, drag: 4.5, c0: [0.95, 0.97, 1, 0.55 * strength], c1: [0.85, 0.88, 0.92, 0] });
    }
    if (Math.random() < strength * 0.7) {
      this._v.copy(dir).multiplyScalar(60).add(carVel);
      this.glow.emit(p, this._v, { life: 0.06, size: 0.35, grow: 2, c0: [0.6, 0.75, 1.0, 0.5 * strength], c1: [0.3, 0.4, 0.8, 0] });
    }
  }

  tireSmoke(p, vel, amount) {
    if (Math.random() > amount) return;
    this._v.set((Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2).addScaledVector(vel, 0.3);
    this.smoke.emit(p, this._v, { life: 1.6 + Math.random(), size: 0.6, grow: 6, drag: 1.2, c0: [0.82, 0.82, 0.82, 0.32 * amount], c1: [0.9, 0.9, 0.9, 0] });
  }

  dust(p, vel, amount) {
    if (Math.random() > amount) return;
    this._v.set((Math.random() - 0.5) * 3, 1 + Math.random(), (Math.random() - 0.5) * 3).addScaledVector(vel, 0.2);
    this.smoke.emit(p, this._v, { life: 2, size: 0.8, grow: 5, drag: 1, c0: [0.55, 0.48, 0.38, 0.35 * amount], c1: [0.6, 0.55, 0.45, 0] });
  }

  sparks(p, vel, n = 10) {
    for (let k = 0; k < n; k++) {
      this._v.set((Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8).addScaledVector(vel, 0.6);
      this.glow.emit(p, this._v, { life: 0.3 + Math.random() * 0.5, size: 0.12, grav: 9.8, drag: 0.6, c0: [1, 0.8, 0.35, 1], c1: [1, 0.3, 0.05, 0] });
    }
  }

  damageSmoke(p, vel, hpFrac) {
    if (hpFrac > 0.5 || Math.random() > (0.55 - hpFrac) * 1.2) return;
    const dark = hpFrac < 0.25;
    this._v.set((Math.random() - 0.5), 1.5 + Math.random(), (Math.random() - 0.5)).addScaledVector(vel, 0.85);
    this.smoke.emit(p, this._v, { life: 2.2, size: 0.5, grow: 7, drag: 0.8, c0: dark ? [0.12, 0.12, 0.12, 0.6] : [0.6, 0.6, 0.62, 0.4], c1: [0.3, 0.3, 0.3, 0] });
  }

  splash(p, strength) {
    for (let k = 0; k < 80 * strength; k++) {
      this._v.set((Math.random() - 0.5) * 10, 4 + Math.random() * 9, (Math.random() - 0.5) * 10);
      this.smoke.emit(p, this._v, { life: 1.4, size: 0.5, grow: 3, grav: 9.8, drag: 0.4, c0: [0.85, 0.92, 0.98, 0.8], c1: [0.9, 0.95, 1, 0] });
    }
  }

  explosion(p, paintColor) {
    for (let k = 0; k < 140; k++) {
      this._v.set((Math.random() - 0.5), Math.random() * 0.8, (Math.random() - 0.5)).normalize().multiplyScalar(4 + Math.random() * 14);
      this.glow.emit(p, this._v, { life: 0.6 + Math.random() * 0.9, size: 1.1 + Math.random(), grow: 3, drag: 2.5, grav: -2, c0: [1, 0.6, 0.25, 0.45], c1: [0.7, 0.15, 0.02, 0] });
    }
    for (let k = 0; k < 160; k++) {
      this._v.set((Math.random() - 0.5), Math.random(), (Math.random() - 0.5)).normalize().multiplyScalar(2 + Math.random() * 8);
      this.smoke.emit(p, this._v, { life: 4 + Math.random() * 4, size: 1.6, grow: 6, drag: 1.4, grav: -1.5, c0: [0.08, 0.07, 0.07, 0.9], c1: [0.25, 0.25, 0.25, 0] });
    }
    this.sparks(p, new THREE.Vector3(), 80);
    this.flash.position.copy(p).y += 2;
    this.flash.intensity = 2500; this.flashT = 1.0;
    const mat = new THREE.MeshStandardMaterial({ color: paintColor || 0x551111, roughness: 0.6, metalness: 0.4 });
    for (let k = 0; k < 22; k++) {
      const m = new THREE.Mesh(this.debrisGeo, k % 3 ? mat : new THREE.MeshStandardMaterial({ color: 0x111111 }));
      m.position.copy(p);
      m.scale.setScalar(0.5 + Math.random() * 1.5);
      m.castShadow = true;
      this.scene.add(m);
      this.debris.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 22, 6 + Math.random() * 16, (Math.random() - 0.5) * 22), w: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), t: 0 });
    }
  }

  skid(wheelIndex, p, right, amount) {
    const prev = this.lastSkid[wheelIndex];
    if (amount < 0.15) { this.lastSkid[wheelIndex] = null; return; }
    const w = 0.13;
    const a = p.clone().addScaledVector(right, -w), b = p.clone().addScaledVector(right, w);
    a.y += 0.03; b.y += 0.03;
    if (prev && prev.a.distanceTo(a) < 3 && prev.a.distanceTo(a) > 0.25) {
      const i = this.skidNext; this.skidNext = (this.skidNext + 1) % this.skidN;
      const P = this.skidPos;
      P.set([prev.a.x, prev.a.y, prev.a.z, prev.b.x, prev.b.y, prev.b.z, a.x, a.y, a.z, b.x, b.y, b.z], i * 12);
      this.skidA.fill(Math.min(1, amount), i * 4, i * 4 + 4);
      this.skidMesh.geometry.attributes.position.needsUpdate = true;
      this.skidMesh.geometry.attributes.aA.needsUpdate = true;
      this.lastSkid[wheelIndex] = { a, b };
    } else if (!prev || prev.a.distanceTo(a) >= 3) this.lastSkid[wheelIndex] = { a, b };
  }

  update(dt, groundAt) {
    this.smoke.update(dt); this.glow.update(dt);
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = Math.max(0, this.flashT) * 2500; }
    for (const d of this.debris) {
      d.t += dt;
      d.v.y -= 9.8 * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      const gy = groundAt(d.m.position);
      if (d.m.position.y < gy) { d.m.position.y = gy; d.v.multiplyScalar(0.4); d.v.y = Math.abs(d.v.y) * 0.3; d.w.multiplyScalar(0.5); }
    }
    this.debris = this.debris.filter((d) => { if (d.t > 30) { this.scene.remove(d.m); return false; } return true; });
  }

  clear() {
    this.smoke.clear(); this.glow.clear();
    for (const d of this.debris) this.scene.remove(d.m);
    this.debris = [];
    this.skidA.fill(0); this.skidMesh.geometry.attributes.aA.needsUpdate = true;
    this.lastSkid = [null, null, null, null];
  }
}
