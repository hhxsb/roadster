import * as THREE from 'three';
import { LC } from '../data.js';

// Tileable wave normal map built from integer-frequency sine waves.
function waveNormalMap(size = 256) {
  const hgt = new Float32Array(size * size);
  const waves = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 28; k++) {
    const fx = Math.round((rnd() - 0.5) * 2 * (2 + k * 0.9)), fy = Math.round((rnd() - 0.5) * 2 * (2 + k * 0.9));
    if (!fx && !fy) continue;
    waves.push([fx, fy, 1 / Math.pow(Math.hypot(fx, fy), 1.2), rnd() * 6.28]);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let h = 0;
    for (const [fx, fy, a, p] of waves) h += a * Math.sin(((fx * x + fy * y) / size) * Math.PI * 2 + p);
    hgt[y * size + x] = h;
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = hgt[y * size + ((x + 1) % size)] - hgt[y * size + ((x - 1 + size) % size)];
    const hy = hgt[((y + 1) % size) * size + x] - hgt[((y - 1 + size) % size) * size + x];
    const s = 2.2, l = Math.hypot(hx * s, hy * s, 1);
    const i = (y * size + x) * 4;
    data[i] = ((-hx * s) / l * 0.5 + 0.5) * 255; data[i + 1] = ((-hy * s) / l * 0.5 + 0.5) * 255; data[i + 2] = (1 / l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export class Water {
  constructor(world) {
    this.group = new THREE.Group();
    const g = world.grid;
    // mask texture: R = lake, G = sea (dilated by two cells so it tucks under the shore)
    const mask = new Uint8Array(g.nx * g.nz * 4);
    const isL = (c, r) => world.land[r * g.nx + c] === LC.LAKE, isS = (c, r) => world.land[r * g.nx + c] === LC.SEA;
    for (let r = 0; r < g.nz; r++) for (let c = 0; c < g.nx; c++) {
      let l = 0, s = 0;
      for (let dr = -2; dr <= 2 && !(l && s); dr++) for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= g.nz || cc >= g.nx) continue;
        if (isL(cc, rr)) l = 255; if (isS(cc, rr)) s = 255;
      }
      const i = (r * g.nx + c) * 4; mask[i] = l; mask[i + 1] = s; mask[i + 3] = 255;
    }
    const maskTex = new THREE.DataTexture(mask, g.nx, g.nz, THREE.RGBAFormat);
    maskTex.magFilter = THREE.LinearFilter; maskTex.minFilter = THREE.LinearFilter; maskTex.needsUpdate = true;
    this.normal = waveNormalMap();
    this.uniforms = { uTime: { value: 0 }, uMask: { value: maskTex }, uGrid: { value: new THREE.Vector4(g.x0, g.z0, (g.nx - 1) * g.cell, (g.nz - 1) * g.cell) } };
    const W = (g.nx - 1) * g.cell, H = (g.nz - 1) * g.cell;
    for (const [level, channel, color] of [[world.lakeLevel, 0, 0x16303a], [0.0, 1, 0x13303d]]) {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.06, metalness: 0.0, normalMap: this.normal, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.25 });
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.uniforms);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec3 vWP; uniform float uTime; uniform sampler2D uMask; uniform vec4 uGrid;`)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
            vec2 muv = (vWP.xz - uGrid.xy) / uGrid.zw;
            float m = texture2D(uMask, muv)[${channel}];
            if (m < 0.5) discard;`)
          .replace('#include <normal_fragment_maps>', `
            vec2 wuv = vWP.xz;
            vec3 n1 = texture2D(normalMap, wuv * 0.021 + vec2(uTime * 0.011, uTime * 0.006)).xyz * 2.0 - 1.0;
            vec3 n2 = texture2D(normalMap, wuv * 0.057 - vec2(uTime * 0.017, -uTime * 0.013)).xyz * 2.0 - 1.0;
            vec3 n3 = texture2D(normalMap, wuv * 0.0045 + vec2(uTime * 0.003, 0.0)).xyz * 2.0 - 1.0;
            vec3 wn = normalize(vec3(n1.xy * 0.5 + n2.xy * 0.35 + n3.xy * 0.6, 1.0));
            // tangent space (x,y) -> world (x,z); then into view space
            normal = normalize((viewMatrix * vec4(wn.x, wn.z, wn.y, 0.0)).xyz);`);
      };
      const geo = new THREE.PlaneGeometry(W, H, 1, 1).rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(g.x0 + W / 2, level, g.z0 + H / 2);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // far ocean/lake beyond the grid is not needed: terrain grid covers the play area
  }
  update(dt) { this.uniforms.uTime.value += dt; }
}
