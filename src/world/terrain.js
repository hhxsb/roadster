import * as THREE from 'three';
import { LC, KIND } from '../data.js';

const CHUNK = 64;

// Builds the ground colour map from landcover, streets and building footprints.
function buildGroundTexture(world, renderer) {
  const g = world.grid;
  const small = document.createElement('canvas');
  small.width = g.nx; small.height = g.nz;
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(g.nx, g.nz);
  const COL = {
    [LC.LAND]: [148, 146, 128], [LC.LAKE]: [70, 80, 70], [LC.SEA]: [60, 70, 70], [LC.PARK]: [92, 122, 62],
    [LC.FOREST]: [52, 76, 40], [LC.ROAD]: [96, 94, 88], [LC.BUILDING]: [128, 126, 120], [LC.STREET]: [140, 138, 126], [LC.GOLF]: [104, 140, 70],
  };
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < g.nx * g.nz; i++) {
    const c = COL[world.land[i]] || COL[0];
    const j = (rnd() - 0.5) * 14;
    // urban land: mix of lawns and pavement
    const lawn = world.land[i] === LC.LAND && rnd() < 0.45;
    img.data[i * 4] = (lawn ? 102 : c[0]) + j; img.data[i * 4 + 1] = (lawn ? 124 : c[1]) + j; img.data[i * 4 + 2] = (lawn ? 70 : c[2]) + j; img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const maxTex = Math.min(renderer.capabilities.maxTextureSize, 8192);
  const scale = Math.min(maxTex / g.nx, maxTex / g.nz, 4.8); // px per cell
  const W = Math.floor(g.nx * scale), H = Math.floor(g.nz * scale);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, W, H);
  const px = scale / g.cell; // px per metre
  const tx = (x) => (x - g.x0) * px, tz = (z) => (z - g.z0) * px;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const WID = [16, 12, 9, 5];
  // sidewalks then asphalt
  for (const pass of [0, 1]) {
    for (const st of world.streets) {
      const cls = st[0];
      ctx.beginPath();
      for (let k = 1; k < st.length; k += 2) { const X = tx(st[k]), Z = tz(st[k + 1]); if (k === 1) ctx.moveTo(X, Z); else ctx.lineTo(X, Z); }
      if (pass === 0) { ctx.strokeStyle = cls === 3 ? '#77756c' : '#a9a69c'; ctx.lineWidth = (WID[cls] + (cls < 3 ? 5 : 0)) * px; }
      else { ctx.strokeStyle = cls === 0 ? '#3b3b3c' : cls === 1 ? '#424243' : '#4a4a4a'; ctx.lineWidth = WID[cls] * px; }
      ctx.stroke();
    }
  }
  // centre lines on major streets
  ctx.setLineDash([3 * px, 6 * px]);
  ctx.strokeStyle = 'rgba(220,190,60,0.55)'; ctx.lineWidth = Math.max(1, 0.3 * px);
  for (const st of world.streets) {
    if (st[0] > 1) continue;
    ctx.beginPath();
    for (let k = 1; k < st.length; k += 2) { const X = tx(st[k]), Z = tz(st[k + 1]); if (k === 1) ctx.moveTo(X, Z); else ctx.lineTo(X, Z); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // building footprints (pavement / shadowed ground around walls)
  ctx.fillStyle = 'rgba(70,68,64,0.9)';
  for (const b of world.buildingsRaw) {
    const r = b.r;
    ctx.beginPath();
    for (let k = 0; k < r.length; k += 2) { const X = tx(r[k] / 10), Z = tz(r[k + 1] / 10); if (k === 0) ctx.moveTo(X, Z); else ctx.lineTo(X, Z); }
    ctx.closePath(); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, canvas: cv, scale: px };
}

export class Terrain {
  constructor(world, renderer, quality) {
    this.world = world;
    this.group = new THREE.Group();
    const g = world.grid;
    const ground = buildGroundTexture(world, renderer);
    this.groundCanvas = ground.canvas;
    this.material = new THREE.MeshStandardMaterial({ map: ground.tex, roughness: 0.95, metalness: 0 });
    const tunnelTex = this.tunnelMask(world);
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.uTunnel = { value: tunnelTex };
      sh.uniforms.uTGrid = { value: new THREE.Vector4(g.x0, g.z0, g.cell, 0) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNormal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vWNormal = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vWNormal; uniform sampler2D uTunnel; uniform vec4 uTGrid;
          float th(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
          float tn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          // cut the terrain out of tunnel tubes
          float tY = texture2D(uTunnel, ((vWPos.xz - uTGrid.xy) / uTGrid.z + 0.5) / vec2(${g.nx}.0, ${g.nz}.0)).r;
          if (vWPos.y < tY + 8.2) discard;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float n1 = tn(vWPos.xz * 0.9), n2 = tn(vWPos.xz * 0.11), n3 = tn(vWPos.xz * 0.023);
          diffuseColor.rgb *= 0.78 + 0.16 * n1 + 0.18 * n2 + 0.12 * n3;
          float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36,0.32,0.26) * (0.8 + 0.3*n1), smoothstep(0.35, 0.6, slope));`);
    };
    const nxC = Math.ceil((g.nx - 1) / CHUNK), nzC = Math.ceil((g.nz - 1) / CHUNK);
    const lodScale = quality.terrainLod;
    this.lods = [];
    for (let cz = 0; cz < nzC; cz++) for (let cx = 0; cx < nxC; cx++) {
      const lod = new THREE.LOD();
      const ox = g.x0 + (cx + 0.5) * CHUNK * g.cell, oz = g.z0 + (cz + 0.5) * CHUNK * g.cell;
      lod.position.set(ox, 0, oz);
      for (const [step, dist] of [[1, 0], [2, 1100 * lodScale], [4, 2600 * lodScale], [8, 6000 * lodScale]]) {
        const m = new THREE.Mesh(this.chunkGeometry(cx * CHUNK, cz * CHUNK, step, ox, oz), this.material);
        m.receiveShadow = step === 1;
        m.matrixAutoUpdate = false;
        lod.addLevel(m, dist);
      }
      lod.matrixAutoUpdate = false;
      lod.updateMatrix();
      this.group.add(lod);
      this.lods.push(lod);
    }
  }

  // per-cell road height for tunnel footprints (very low elsewhere)
  tunnelMask(world) {
    const g = world.grid, data = new Float32Array(g.nx * g.nz).fill(-1e5), cs = world.cs, f = {};
    for (const r of world.routes) {
      for (let i = 0; i < r.n; i++) {
        if (r.kind[i] !== KIND.TUNNEL) continue;
        r.frame(r.s[i], f);
        for (let o = cs.left - 2; o <= cs.right + 2; o += 3) {
          const x = f.x + f.rx * o, z = f.z + f.rz * o;
          const c = Math.round((x - g.x0) / g.cell), rr = Math.round((z - g.z0) / g.cell);
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc, r2 = rr + dr;
            if (cc < 0 || r2 < 0 || cc >= g.nx || r2 >= g.nz) continue;
            const k = r2 * g.nx + cc; data[k] = Math.max(data[k], f.y);
          }
        }
      }
    }
    const t = new THREE.DataTexture(data, g.nx, g.nz, THREE.RedFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }

  chunkGeometry(c0, r0, step, ox, oz) {
    const g = this.world.grid, H = this.world.H;
    const c1 = Math.min(g.nx - 1, c0 + CHUNK), r1 = Math.min(g.nz - 1, r0 + CHUNK);
    const cols = [], rows = [];
    for (let c = c0; c < c1; c += step) cols.push(c); cols.push(c1);
    for (let r = r0; r < r1; r += step) rows.push(r); rows.push(r1);
    const nx = cols.length, nz = rows.length;
    const skirt = 2 * (nx + nz);
    const pos = new Float32Array((nx * nz + skirt) * 3), nor = new Float32Array((nx * nz + skirt) * 3), uv = new Float32Array((nx * nz + skirt) * 2);
    const Wm = (g.nx - 1) * g.cell, Hm = (g.nz - 1) * g.cell;
    const h = (c, r) => H[Math.max(0, Math.min(g.nz - 1, r)) * g.nx + Math.max(0, Math.min(g.nx - 1, c))];
    let v = 0;
    const put = (c, r, dy) => {
      const x = g.x0 + c * g.cell, z = g.z0 + r * g.cell;
      pos[v * 3] = x - ox; pos[v * 3 + 1] = h(c, r) + dy; pos[v * 3 + 2] = z - oz;
      const dx = h(c + step, r) - h(c - step, r), dz = h(c, r + step) - h(c, r - step);
      const l = Math.hypot(dx, 2 * g.cell * step, dz);
      nor[v * 3] = -dx / l; nor[v * 3 + 1] = (2 * g.cell * step) / l; nor[v * 3 + 2] = -dz / l;
      uv[v * 2] = (x - g.x0) / Wm; uv[v * 2 + 1] = (z - g.z0) / Hm;
      v++;
    };
    for (const r of rows) for (const c of cols) put(c, r, 0);
    const idx = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // skirts
    const edge = (list) => {
      const base = v;
      for (const [c, r] of list) put(c, r, -12);
      for (let k = 0; k + 1 < list.length; k++) {
        const [c, r] = list[k], [c2, r2] = list[k + 1];
        const a = rows.indexOf(r) * nx + cols.indexOf(c), b = rows.indexOf(r2) * nx + cols.indexOf(c2);
        idx.push(a, base + k, b, b, base + k, base + k + 1);
        idx.push(a, b, base + k, b, base + k + 1, base + k);
      }
    };
    edge(cols.map((c) => [c, rows[0]]));
    edge(cols.map((c) => [c, rows[nz - 1]]));
    edge(rows.map((r) => [cols[0], r]));
    edge(rows.map((r) => [cols[nx - 1], r]));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, v * 2), 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.boundingSphere.radius += 20;
    return geo;
  }

  update() { /* LOD levels switch automatically during render */ }
}
