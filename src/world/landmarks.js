import * as THREE from 'three';
import { mergeGeoms } from './roads.js';

function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v) + (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v;
}
function ridged(x, y, oct = 6) { let a = 0.5, s = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(noise(x * f, y * f) * 2 - 1)); f *= 2.03; a *= 0.5; } return s; }

export class Landmarks {
  constructor(world) {
    this.group = new THREE.Group();
    this.hazeUniforms = { uHaze: { value: new THREE.Color(0xa0b0c0) }, uHazeAmt: { value: 0.5 } };
    const needle = world.landmarks.find((l) => l.name === 'Space Needle');
    if (needle) this.group.add(this.spaceNeedle(needle));
    const rainier = world.landmarks.find((l) => l.name === 'Mount Rainier');
    this.distant = new THREE.Group();
    if (rainier) this.distant.add(this.mountain(rainier.x, rainier.z, 4392, 24000, 1));
    this.distant.add(this.ranges());
    this.group.add(this.distant);
  }

  hazeMaterial(params) {
    const m = new THREE.MeshLambertMaterial({ ...params, fog: false });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.hazeUniforms);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze; uniform float uHazeAmt;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, uHazeAmt);');
    };
    return m;
  }

  setHaze(color, amt) { this.hazeUniforms.uHaze.value.set(color); this.hazeUniforms.uHazeAmt.value = amt; }

  spaceNeedle(l) {
    const g = new THREE.Group();
    g.position.set(l.x, l.y, l.z);
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.45, metalness: 0.3 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9772b, roughness: 0.4, metalness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.05, metalness: 0.9 });
    // three pairs of curved legs: wide base, waist at ~113 m, flare under the saucer
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + (k % 2 ? 0.22 : -0.22);
      const pt = (r, y, da = 0) => new THREE.Vector3(Math.cos(a + da) * r, y, Math.sin(a + da) * r);
      const curve = new THREE.CatmullRomCurve3([pt(17, 0), pt(10, 40), pt(5.2, 80), pt(4.2, 113), pt(6.5, 135), pt(10.5, 152)]);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.9, 8), white));
    }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 160, 16).translate(0, 80, 0), white));
    // 100-ft level ring and the waist ring
    g.add(new THREE.Mesh(new THREE.TorusGeometry(11.5, 0.6, 6, 32).rotateX(Math.PI / 2).translate(0, 30, 0), white));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.5, 6, 24).rotateX(Math.PI / 2).translate(0, 113, 0), white));
    // saucer (lathe)
    const prof = [[0, 150], [9, 151], [16.5, 155], [19, 158], [19.4, 160.5], [18.2, 163.5], [14, 166], [8, 168], [0, 169]].map(([r, y]) => new THREE.Vector2(r, y));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 48), gold));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(19.0, 18.6, 3.2, 48, 1, true).translate(0, 160, 0), glass));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 6, 12).translate(0, 172, 0), white));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.7, 12, 8).translate(0, 181, 0), white));
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  mountain(cx, cz, peak, radius, seed) {
    const N = 160, geo = new THREE.PlaneGeometry(radius * 2, radius * 2, N, N).rotateX(-Math.PI / 2);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z) / radius;
      const base = Math.pow(Math.max(0, 1 - r), 1.6);
      const det = ridged(x / 3000 + seed * 10, z / 3000) * 0.35;
      let h = peak * base * (0.78 + det) - 200;
      h = Math.max(-300, h);
      p.setY(i, h);
      const snow = THREE.MathUtils.smoothstep(h, 1500, 2300) * (0.7 + 0.3 * det * 2);
      const c = new THREE.Color(0x3c4a3e).lerp(new THREE.Color(0x6c6a66), THREE.MathUtils.smoothstep(h, 900, 1500)).lerp(new THREE.Color(0xf4f6fa), Math.min(1, snow));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.hazeMaterial({ vertexColors: true }));
    m.position.set(cx, 0, cz);
    m.renderOrder = -5;
    return m;
  }

  ranges() {
    // Olympics to the west, Cascades to the east, low hills elsewhere
    const NA = 360, NR = 14, pos = [], col = [], idx = [];
    for (let i = 0; i <= NA; i++) {
      const az = (i / NA) * Math.PI * 2; // clockwise from north
      const deg = (az * 180) / Math.PI;
      const casc = THREE.MathUtils.smoothstep(deg, 20, 45) * (1 - THREE.MathUtils.smoothstep(deg, 140, 175));
      const oly = THREE.MathUtils.smoothstep(deg, 235, 255) * (1 - THREE.MathUtils.smoothstep(deg, 320, 345));
      const dist = 45000 + casc * 25000 + oly * 30000;
      const amp = 300 + casc * 1500 + oly * 1900;
      for (let j = 0; j <= NR; j++) {
        const t = j / NR, d = dist + t * 40000;
        const x = Math.sin(az) * d, z = -Math.cos(az) * d;
        const env = Math.sin(Math.PI * Math.min(1, t * 1.6));
        const h = Math.max(0, amp * env * (0.35 + 0.9 * ridged(i / 9 + j * 0.7, j / 3 + i * 0.05, 5)) - 50);
        pos.push(x, h, z);
        const snow = THREE.MathUtils.smoothstep(h, 1300, 1900);
        const c = new THREE.Color(0x34443a).lerp(new THREE.Color(0x5d625e), THREE.MathUtils.smoothstep(h, 600, 1300)).lerp(new THREE.Color(0xeef1f5), snow);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) {
      const a = i * (NR + 1) + j, b = a + 1, c = a + NR + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.hazeMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.renderOrder = -5;
    m.frustumCulled = false;
    return m;
  }

  update(camPos) {
    // distant ranges follow the camera horizontally so they stay at the horizon
    this.distant.children[1] && this.distant.children[1].position.set(camPos.x, 0, camPos.z);
  }
}
export { mergeGeoms };
