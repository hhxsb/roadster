import * as THREE from 'three';

// Facade styles understood by the shader
const S = { GLASS: 0, OFFICE: 1, APART: 2, HOUSE: 3, INDUSTRIAL: 4, PARKING: 5, ROOF: 10, ROOF_HOUSE: 11 };
const TILE = 420;

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const PALETTE = {
  [S.GLASS]: [0x4d6b80, 0x5b7484, 0x3e5566, 0x6f8592, 0x51655a, 0x7a8a96, 0x2f4252, 0x8c9aa4],
  [S.OFFICE]: [0xb9b2a4, 0xa8a49b, 0xc8c0b0, 0x8f8a82, 0xd2cdc2, 0x9a8f80, 0x7d7f84],
  [S.APART]: [0x9a5a44, 0xb07a5a, 0xc9b9a0, 0x8b8f94, 0xd8d0c0, 0x6f7b6a, 0xa86a50, 0xbfae92, 0x5d6670],
  [S.HOUSE]: [0xd9d2c2, 0xa8b4b8, 0x8a9a88, 0xc4a77e, 0xe8e2d4, 0x7c8c9c, 0xb48a6a, 0x9fa38f, 0xcfc6a8],
  [S.INDUSTRIAL]: [0x9ea3a6, 0xb5b1a5, 0x8c9295, 0xa39278, 0xc2c4c0],
  [S.PARKING]: [0xa8a69e, 0xb8b5ac],
};
const NAMED = { white: 0xe8e6e0, grey: 0x9a9a9a, gray: 0x9a9a9a, brown: 0x7a5a44, red: 0x9a4a3a, beige: 0xd8c8a8, black: 0x333333, blue: 0x50607a, yellow: 0xd8c070, tan: 0xc8b090 };

export class Buildings {
  constructor(world, quality) {
    this.world = world;
    this.group = new THREE.Group();
    this.uniforms = { uNight: { value: 0 } };
    this.material = this.makeMaterial();
    this.tiles = new Map();
    this.colGrid = new Map();
    this.list = [];
    this.drawDist = quality.buildingDist;
    const raw = world.buildingsRaw;
    const tileGeo = new Map();
    for (let bi = 0; bi < raw.length; bi++) {
      const b = raw[bi];
      if (b.n && /Space Needle/i.test(b.n)) continue;
      const ring = [];
      for (let k = 0; k < b.r.length; k += 2) ring.push([b.r[k] / 10, b.r[k + 1] / 10]);
      // positive signed area in (x,z) so edge normals (dz,-dx) point outward
      if (signedArea(ring) < 0) ring.reverse();
      let cx = 0, cz = 0; for (const p of ring) { cx += p[0]; cz += p[1]; } cx /= ring.length; cz /= ring.length;
      const key = Math.floor(cx / TILE) + ',' + Math.floor(cz / TILE);
      let t = tileGeo.get(key);
      if (!t) tileGeo.set(key, (t = { pos: [], nor: [], uv: [], col: [], sty: [], idx: [], cx: (Math.floor(cx / TILE) + 0.5) * TILE, cz: (Math.floor(cz / TILE) + 0.5) * TILE, maxH: 0 }));
      const rec = this.addBuilding(t, b, ring, bi);
      t.maxH = Math.max(t.maxH, b.b + b.h);
      // collision record
      const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
      const c = { ring, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0: b.b + b.m, y1: b.b + rec.roofY, top: b.b + b.h, flat: rec.flat };
      const id = this.list.length; this.list.push(c);
      for (let gx = Math.floor(c.x0 / 50); gx <= Math.floor(c.x1 / 50); gx++) for (let gz = Math.floor(c.z0 / 50); gz <= Math.floor(c.z1 / 50); gz++) {
        const k = gx * 92821 + gz; let a = this.colGrid.get(k); if (!a) this.colGrid.set(k, (a = [])); a.push(id);
      }
    }
    for (const t of tileGeo.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
      g.setAttribute('aStyle', new THREE.Float32BufferAttribute(t.sty, 3));
      g.setIndex(t.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.material);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.center = new THREE.Vector3(t.cx, 0, t.cz);
      m.userData.size = t.maxH;
      this.group.add(m);
    }
    world.buildings = this;
  }

  addBuilding(t, b, ring, seed) {
    const r = rng(seed * 7919 + 13);
    const area = Math.abs(signedArea(ring));
    const type = b.t || 'yes';
    let style;
    if (/parking/.test(type)) style = S.PARKING;
    else if (/industrial|warehouse|manufacture|hangar|shed|garage|service|storage/.test(type)) style = S.INDUSTRIAL;
    else if (b.h >= 45) style = S.GLASS;
    else if ((/house|detached|residential|semidetached|bungalow|terrace/.test(type) || type === 'yes') && area < 320 && b.h < 12) style = S.HOUSE;
    else if (/apartments|residential|dormitory|hotel/.test(type)) style = S.APART;
    else if (b.h >= 18 && r() < 0.45) style = S.GLASS;
    else style = r() < 0.5 ? S.OFFICE : S.APART;
    let colorHex = PALETTE[style][Math.floor(r() * PALETTE[style].length)];
    if (b.c) { const c = b.c.toLowerCase(); if (c[0] === '#' && c.length >= 7) colorHex = parseInt(c.slice(1, 7), 16); else if (NAMED[c]) colorHex = NAMED[c]; }
    if (b.mat === 'brick') colorHex = [0x8f4d3a, 0xa05a42, 0x7c4a3a][Math.floor(r() * 3)];
    const col = new THREE.Color(colorHex);
    const floorH = style === S.HOUSE ? 2.9 : style === S.GLASS ? 3.9 : style === S.PARKING ? 3.0 : style === S.INDUSTRIAL ? 6.0 : 3.4;
    const pitched = style === S.HOUSE || (b.roof && /gabled|hipped|pitched/.test(b.roof) && b.h < 20);
    const roofH = pitched ? Math.min(3.2, Math.max(1.6, Math.sqrt(area) * 0.22)) : 0;
    const y0 = b.b + b.m, eave = b.b + Math.max(b.m + 2.5, b.h - roofH);
    // walls
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) continue;
      const nx = (q[1] - p[1]) / len, nz = -(q[0] - p[0]) / len; // outward for CCW ring in (x, z)
      const base = t.pos.length / 3;
      t.pos.push(p[0], y0, p[1], q[0], y0, q[1], q[0], eave, q[1], p[0], eave, p[1]);
      for (let k = 0; k < 4; k++) { t.nor.push(nx, 0, nz); t.col.push(col.r, col.g, col.b); t.sty.push(style, floorH, seed % 997); }
      t.uv.push(u, y0 - b.b, u + len, y0 - b.b, u + len, eave - b.b, u, eave - b.b);
      t.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      u += len;
    }
    // roof
    const rc = style === S.GLASS ? new THREE.Color(0x4a4d50) : style === S.HOUSE ? new THREE.Color([0x3b3d40, 0x5a4a40, 0x464c55, 0x6b5b4b][Math.floor(r() * 4)]) : new THREE.Color(0x6e6c68).offsetHSL(0, 0, (r() - 0.5) * 0.1);
    if (pitched) {
      this.gableRoof(t, ring, eave, roofH, rc, seed);
      return { roofY: b.h, flat: false };
    }
    const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
    const base = t.pos.length / 3;
    for (const p of ring) { t.pos.push(p[0], eave, p[1]); t.nor.push(0, 1, 0); t.col.push(rc.r, rc.g, rc.b); t.sty.push(S.ROOF, 0, seed % 997); t.uv.push(p[0], p[1]); }
    for (const tr of tris) t.idx.push(base + tr[0], base + tr[2], base + tr[1]);
    // rooftop mechanical units on larger flat roofs
    if (area > 350 && style !== S.PARKING) {
      const n = 1 + Math.floor(r() * Math.min(4, area / 500));
      let cx = 0, cz = 0; for (const p of ring) { cx += p[0]; cz += p[1]; } cx /= ring.length; cz /= ring.length;
      for (let k = 0; k < n; k++) {
        const w = 2 + r() * Math.min(8, Math.sqrt(area) * 0.25), d = 2 + r() * Math.min(8, Math.sqrt(area) * 0.25), h = 1.2 + r() * 2.5;
        const ox = cx + (r() - 0.5) * Math.sqrt(area) * 0.4, oz = cz + (r() - 0.5) * Math.sqrt(area) * 0.4;
        if (!pointInRing(ox, oz, ring)) continue;
        boxInto(t, ox, eave, oz, w, h, d, new THREE.Color(0x8c8f90), seed);
      }
    }
    return { roofY: b.h, flat: true };
  }

  gableRoof(t, ring, eave, rh, col, seed) {
    // oriented bounding box via the longest edge direction
    let best = 0, ang = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l > best) { best = l; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); }
    }
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of ring) { const a = p[0] * ca + p[1] * sa, b = -p[0] * sa + p[1] * ca; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const ov = 0.35; a0 -= ov; a1 += ov; b0 -= ov; b1 += ov;
    const bm = (b0 + b1) / 2;
    const W = (a, b, y) => [a * ca - b * sa, y, a * sa + b * ca];
    const P = { A: W(a0, b0, eave), B: W(a1, b0, eave), C: W(a1, b1, eave), D: W(a0, b1, eave), E: W(a0, bm, eave + rh), F: W(a1, bm, eave + rh) };
    const quad = (p1, p2, p3, p4, st) => {
      const base = t.pos.length / 3;
      const v1 = new THREE.Vector3(...p2).sub(new THREE.Vector3(...p1)), v2 = new THREE.Vector3(...p3).sub(new THREE.Vector3(...p1));
      const n = v1.cross(v2).normalize();
      if (n.y < 0 && st !== S.HOUSE) n.negate();
      for (const p of [p1, p2, p3, p4]) { t.pos.push(...p); t.nor.push(n.x, n.y, n.z); t.col.push(col.r, col.g, col.b); t.sty.push(st, 0, seed % 997); t.uv.push(p[0], p[2]); }
      t.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    // two roof planes (winding chosen so normals point up/out)
    quad(P.A, P.E, P.F, P.B, S.ROOF_HOUSE);
    quad(P.C, P.F, P.E, P.D, S.ROOF_HOUSE);
    // gable ends (triangles, drawn as degenerate quads), wall-coloured
    const wc = t.col.slice(-3);
    const tri = (p1, p2, p3) => {
      const base = t.pos.length / 3;
      const v1 = new THREE.Vector3(...p2).sub(new THREE.Vector3(...p1)), v2 = new THREE.Vector3(...p3).sub(new THREE.Vector3(...p1));
      const n = v1.cross(v2).normalize();
      for (const p of [p1, p2, p3]) { t.pos.push(...p); t.nor.push(n.x, n.y, n.z); t.col.push(0.85, 0.83, 0.78); t.sty.push(S.HOUSE, 2.9, seed % 997); t.uv.push(0, 4); }
      t.idx.push(base, base + 1, base + 2);
      void wc;
    };
    tri(P.D, P.E, P.A);
    tri(P.B, P.F, P.C);
  }

  makeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = this.uniforms.uNight;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aStyle; varying vec3 vSty; varying vec2 vB; varying vec3 vWN;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSty = aStyle; vB = uv; vWN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uNight; varying vec3 vSty; varying vec2 vB; varying vec3 vWN;
          float bh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
          float bn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(bh(vec3(i,1.)),bh(vec3(i+vec2(1,0),1.)),f.x), mix(bh(vec3(i+vec2(0,1),1.)),bh(vec3(i+vec2(1,1),1.)),f.x), f.y); }`)
        .replace('#include <map_fragment>', `
          float st = floor(vSty.x + 0.5), fh = vSty.y, seed = vSty.z;
          float glass = 0.0, lit = 0.0, rough = 0.85, metal = 0.0;
          vec3 wcol = diffuseColor.rgb;
          if (st < 9.5) {
            float u = vB.x, v = vB.y;
            float fl = floor(v / fh), fv = fract(v / fh);
            float aaU = fwidth(u), aaV = fwidth(v / fh);
            if (st < 0.5) { // curtain-wall glass tower
              float mu = fract(u / 1.6), ml = smoothstep(0.0, 0.06 + aaU, mu) * smoothstep(1.0, 0.94 - aaU, mu);
              float fb = smoothstep(0.0, 0.08 + aaV, fv) * smoothstep(1.0, 0.86 - aaV, fv);
              glass = ml * fb;
              float pane = bh(vec3(floor(u / 1.6), fl, seed));
              wcol = mix(wcol * 0.55, wcol * (0.85 + 0.25 * pane), glass);
              rough = mix(0.5, 0.05, glass); metal = mix(0.2, 0.9, glass);
              lit = step(0.62, bh(vec3(floor(u / 4.8), fl, seed + 3.0)));
            } else if (st < 1.5) { // office: ribbon windows
              float band = smoothstep(0.3 - aaV, 0.32 + aaV, fv) * smoothstep(0.95 + aaV, 0.92 - aaV, fv);
              float mu = fract(u / 1.5); float mull = smoothstep(0.0, 0.05 + aaU, mu) * smoothstep(1.0, 0.95 - aaU, mu);
              glass = band * mull;
              wcol = mix(wcol * (0.9 + 0.1 * bn(vec2(u, v) * 0.5)), vec3(0.16, 0.2, 0.24), glass);
              rough = mix(0.8, 0.08, glass); metal = mix(0.0, 0.6, glass);
              lit = step(0.6, bh(vec3(floor(u / 4.5), fl, seed)));
            } else if (st < 2.5 || st > 2.5 && st < 3.5) { // punched windows (apartments / houses)
              float ww = st < 2.5 ? 2.6 : 3.4;
              float cu = fract(u / ww);
              float win = smoothstep(0.25 - aaU, 0.27 + aaU, cu) * smoothstep(0.75 + aaU, 0.73 - aaU, cu) * smoothstep(0.32 - aaV, 0.34 + aaV, fv) * smoothstep(0.86 + aaV, 0.84 - aaV, fv);
              float present = st > 2.5 ? step(0.35, bh(vec3(floor(u / ww), fl, seed + 9.0))) : 1.0;
              glass = win * present;
              float siding = st > 2.5 ? 0.92 + 0.08 * step(0.5, fract(v * 3.3)) : 0.9 + 0.12 * bn(vec2(u * 2.0, v * 4.0));
              wcol = mix(wcol * siding, vec3(0.12, 0.14, 0.16), glass);
              rough = mix(0.88, 0.1, glass); metal = mix(0.0, 0.5, glass);
              lit = step(st > 2.5 ? 0.45 : 0.55, bh(vec3(floor(u / ww), fl, seed + 1.0)));
            } else if (st < 4.5) { // industrial
              float rib = 0.9 + 0.1 * step(0.5, fract(u * 1.4));
              float hiw = smoothstep(0.72, 0.74, fract(v / fh)) * smoothstep(0.9, 0.88, fract(v / fh)) * step(0.5, fract(u / 6.0));
              glass = hiw * 0.8;
              wcol = mix(wcol * rib, vec3(0.2, 0.22, 0.24), glass);
              rough = mix(0.7, 0.2, glass); metal = 0.2;
              lit = step(0.7, bh(vec3(floor(u / 6.0), fl, seed)));
            } else { // parking structure: open decks
              float open = smoothstep(0.35, 0.37, fv) * smoothstep(0.85, 0.83, fv);
              wcol = mix(wcol, vec3(0.05), open * 0.92);
              rough = 0.9; lit = open * 0.5;
            }
            // street-level storefronts on bigger buildings
            if (v < 4.4 && (st < 1.5 || st > 1.5 && st < 2.5)) {
              float sf = smoothstep(0.6, 0.8, v) * smoothstep(4.2, 4.0, v) * step(0.12, fract(u / 6.0));
              wcol = mix(wcol, vec3(0.1, 0.12, 0.13), sf); glass = max(glass, sf); rough = mix(rough, 0.08, sf); lit = max(lit, sf * 0.9);
            }
            // weathering / AO towards the ground
            wcol *= 0.82 + 0.18 * smoothstep(0.0, 6.0, v);
          } else if (st < 10.5) { // flat roof gravel
            wcol *= 0.8 + 0.25 * bn(vB * 0.7) ;
            rough = 0.95;
          } else { // shingles
            wcol *= 0.85 + 0.15 * step(0.5, fract(dot(vB, vec2(0.7, 0.7)) * 3.0)) * bn(vB * 2.0);
            rough = 0.85;
          }
          diffuseColor.rgb = wcol;
          // distant facades: average the window pattern to avoid shimmering
          float farB = st < 9.5 ? smoothstep(0.25, 0.9, fwidth(vB.x) + fwidth(vB.y) * 0.5) : 0.0;
          float glowAmt = mix(glass * lit, 0.22, farB);
          vec3 winGlow = vec3(1.0, 0.82, 0.55) * glowAmt * uNight * 1.4;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rough;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = metal;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += winGlow;');
    };
    return mat;
  }

  setNight(v) { this.uniforms.uNight.value = v; }

  update(camPos) {
    const d2 = this.drawDist * this.drawDist;
    for (const m of this.group.children) {
      const c = m.userData.center;
      const dx = c.x - camPos.x, dz = c.z - camPos.z, dist2 = dx * dx + dz * dz;
      // tall towers stay visible further away (skyline)
      const lim = m.userData.size > 80 ? d2 * 4 : d2;
      m.visible = dist2 < lim;
    }
  }

  near(x, z, cb) {
    const k = Math.floor(x / 50) * 92821 + Math.floor(z / 50);
    const a = this.colGrid.get(k);
    if (a) for (const id of a) cb(this.list[id], id);
  }

  roofAt(x, z, yTop) {
    let best = -Infinity;
    this.near(x, z, (c) => {
      if (c.top > yTop + 0.05 || c.top <= best) return;
      if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return;
      if (pointInRing(x, z, c.ring)) best = c.flat ? c.top : c.top - 0.6;
    });
    return best;
  }

  // Push a point out of any building it is inside (between floor and roof).
  // Returns penetration info or null.
  resolvePoint(x, y, z, out) {
    let hit = null;
    this.near(x, z, (c) => {
      if (hit || y < c.y0 || y > c.top - 0.3 || x < c.x0 - 0.1 || x > c.x1 + 0.1 || z < c.z0 - 0.1 || z > c.z1 + 0.1) return;
      if (!pointInRing(x, z, c.ring)) return;
      // nearest edge
      let bd = Infinity, bnx = 0, bnz = 0;
      const r = c.ring;
      for (let i = 0; i < r.length; i++) {
        const p = r[i], q = r[(i + 1) % r.length];
        const dx = q[0] - p[0], dz = q[1] - p[1], L2 = dx * dx + dz * dz || 1;
        let t = ((x - p[0]) * dx + (z - p[1]) * dz) / L2; t = Math.max(0, Math.min(1, t));
        const px = p[0] + dx * t, pz = p[1] + dz * t, d = Math.hypot(x - px, z - pz);
        if (d < bd) { bd = d; const L = Math.sqrt(L2); bnx = dz / L; bnz = -dx / L; }
      }
      // roof contact is handled by the surface query: if we are close to the top, ignore
      if (c.top - y < 1.0 && c.flat) return;
      hit = out; out.depth = bd; out.nx = bnx; out.nz = bnz;
    });
    return hit;
  }
}

function signedArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export function pointInRing(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function boxInto(t, cx, y, cz, w, h, d, col, seed) {
  const g = new THREE.BoxGeometry(w, h, d).translate(cx, y + h / 2, cz);
  const base = t.pos.length / 3;
  const P = g.attributes.position.array, N = g.attributes.normal.array;
  for (let i = 0; i < P.length / 3; i++) {
    t.pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); t.nor.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    t.col.push(col.r, col.g, col.b); t.sty.push(10, 0, seed % 997); t.uv.push(P[i * 3], P[i * 3 + 2]);
  }
  for (const k of g.index.array) t.idx.push(base + k);
}
