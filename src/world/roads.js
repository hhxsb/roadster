import * as THREE from 'three';
import { KIND } from '../data.js';
import { tunnelBores, TUNNEL_H } from './tunnel.js';

// Cross-section helper derived from the build constants.
export function crossSection(road) {
  const C = road.lanes * road.laneW;
  const ourL = -C / 2, ourR = C / 2;
  const medL = ourL - road.lShoulder, medR = medL - road.median; // medL > medR (more negative = further left)
  const oppIn = medR - road.lShoulder, oppOut = oppIn - C;
  return {
    carriage: C, ourL, ourR, medianCenter: (medL + medR) / 2, oppIn, oppOut,
    left: road.offLeft, right: road.offRight,
    // lane centre offsets; our direction lane 0 = leftmost (fast) lane
    ourLane: (k) => ourL + road.laneW * (k + 0.5),
    // opposite direction lane 0 = their leftmost (next to the median)
    oppLane: (k) => oppIn - road.laneW * (k + 0.5),
  };
}

const STRIDE = 2; // route samples per mesh ring (2 m spacing -> 4 m)

export class Roads {
  constructor(world, quality) {
    this.world = world;
    this.group = new THREE.Group();
    this.uniforms = { uNight: { value: 0 } };
    this.cs = crossSection(world.road);
    this.bores = tunnelBores(this.cs);
    this.deckMat = this.makeDeckMaterial();
    this.concreteMat = new THREE.MeshStandardMaterial({ color: 0xb4b0a6, roughness: 0.85, metalness: 0 });
    this.girderMat = new THREE.MeshStandardMaterial({ color: 0x9d998f, roughness: 0.9 });
    this.pontoonMat = new THREE.MeshStandardMaterial({ color: 0x8b8a84, roughness: 0.92 });
    this.tunnelMat = this.makeTunnelMaterial();
    this.steelMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.45, metalness: 0.75 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 });
    this.lampMats = [this.lampMat];
    for (const r of world.routes) this.markBarriers(r);
    for (const r of world.routes) this.buildRoute(r);
    this.buildPoles();
    this.buildSigns();
    this.buildStubEnds();
  }

  // ------------------------------------------------------------ materials
  makeDeckMaterial() {
    const cs = this.cs;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = this.uniforms.uNight;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aDeck; varying vec3 vDeck; varying vec2 vRoad;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDeck = aDeck; vRoad = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uNight; varying vec3 vDeck; varying vec2 vRoad;
          float rh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
          float rn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(rh(i),rh(i+vec2(1,0)),f.x), mix(rh(i+vec2(0,1)),rh(i+vec2(1,1)),f.x), f.y); }
          float band(float x, float c, float w){ float aa = fwidth(x) * 0.75; return smoothstep(c - w*0.5 - aa, c - w*0.5 + aa, x) - smoothstep(c + w*0.5 - aa, c + w*0.5 + aa, x); }
          float dash(float s){ float m = mod(s, 12.192); float aa = fwidth(s); return smoothstep(0.0, aa, m) - smoothstep(3.048 - aa, 3.048, m); }`)
        .replace('#include <map_fragment>', `
          float o = vRoad.x, s = vRoad.y;
          float concrete = vDeck.x, tunnel = vDeck.y, startLine = vDeck.z;
          float grain = rn(vec2(o, s) * 3.1) * 0.5 + rn(vec2(o, s) * 0.35) * 0.5;
          vec3 asph = vec3(0.20, 0.20, 0.205) * (0.82 + 0.3 * grain);
          vec3 conc = vec3(0.47, 0.46, 0.43) * (0.86 + 0.22 * grain);
          // concrete slab joints
          float joint = 1.0 - 0.35 * band(mod(s, 4.6), 0.05, 0.08);
          vec3 base = mix(asph, conc * joint, concrete);
          // wheel-track wear in each lane
          float lp = mod(o + ${(-cs.ourL).toFixed(3)}, ${this.world.road.laneW.toFixed(3)});
          float wear = band(lp, 0.95, 0.75) + band(lp, 2.75, 0.75);
          base *= 1.0 - 0.07 * wear * (1.0 - concrete) ;
          base *= 1.0 + 0.05 * wear * concrete;
          // shoulders slightly different + rumble strips
          bool ourSh = o > ${cs.ourR.toFixed(3)} || (o < ${cs.ourL.toFixed(3)} && o > ${cs.medianCenter.toFixed(3)});
          bool oppSh = o < ${cs.oppOut.toFixed(3)} || (o > ${cs.oppIn.toFixed(3)} && o < ${cs.medianCenter.toFixed(3)});
          if (ourSh || oppSh) {
            base *= 0.92 + 0.06 * rn(vec2(o, s) * 0.8);
            float rumble = band(mod(s, 0.6), 0.15, 0.25) * (band(o, ${(cs.ourR + 0.6).toFixed(3)}, 0.4) + band(o, ${(cs.oppOut - 0.6).toFixed(3)}, 0.4));
            base *= 1.0 - 0.3 * rumble;
          }
          // markings
          float white = 0.0, yellow = 0.0;
          white += band(o, ${(cs.ourR - 0.1).toFixed(3)}, 0.15) + band(o, ${(cs.oppOut + 0.1).toFixed(3)}, 0.15);
          yellow += band(o, ${(cs.ourL + 0.1).toFixed(3)}, 0.15) + band(o, ${(cs.oppIn - 0.1).toFixed(3)}, 0.15);
          for (int k = 1; k < ${this.world.road.lanes}; k++) {
            white += band(o, ${cs.ourL.toFixed(3)} + float(k) * ${this.world.road.laneW.toFixed(3)}, 0.12) * dash(s);
            white += band(o, ${cs.oppIn.toFixed(3)} - float(k) * ${this.world.road.laneW.toFixed(3)}, 0.12) * dash(s + 6.0);
          }
          float wornPaint = 0.75 + 0.25 * rn(vec2(o * 9.0, s * 2.0));
          base = mix(base, vec3(0.86, 0.86, 0.82) * wornPaint, clamp(white, 0.0, 1.0));
          base = mix(base, vec3(0.86, 0.66, 0.12) * wornPaint, clamp(yellow, 0.0, 1.0));
          // start / finish checkerboard
          if (startLine > 0.5) {
            float ch = mod(floor(o / 1.0) + floor(s / 1.0), 2.0);
            base = mix(vec3(0.04), vec3(0.92), ch);
          }
          // light: tunnels are dim, lamp pools at night / in tunnels
          float pool = exp(-pow(mod(s, 64.0) - 32.0, 2.0) / 260.0) * (exp(-pow(o - ${(cs.medianCenter + 6).toFixed(3)}, 2.0) / 60.0) + exp(-pow(o - ${(cs.medianCenter - 6).toFixed(3)}, 2.0) / 60.0));
          float tpool = 0.5 + 0.5 * exp(-pow(mod(s, 12.0) - 6.0, 2.0) / 10.0);
          base *= mix(1.0, 0.45, tunnel);
          vec4 diffuseColor2 = vec4(base, 1.0);
          diffuseColor *= diffuseColor2;
          vec3 roadGlow = vec3(1.0, 0.78, 0.5) * base * (pool * uNight * 0.55 * (1.0 - tunnel) + tpool * tunnel * 0.9);
        `)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = clamp(0.92 - 0.25 * clamp(white + yellow, 0.0, 1.0) - 0.08 * wear, 0.3, 1.0);`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += roadGlow;');
    };
    return mat;
  }

  makeTunnelMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.55, metalness: 0.0, side: THREE.DoubleSide, emissive: 0x000000 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vT;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvT = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vT;')
        .replace('#include <map_fragment>', `
          // tiles + lamp strip near the ceiling
          vec2 tg = fract(vT * vec2(0.5, 1.6));
          float grout = step(0.97, tg.x) + step(0.95, tg.y);
          diffuseColor.rgb *= (1.0 - 0.35 * clamp(grout, 0.0, 1.0)) * 0.55;
          float lamp = step(6.4, vT.y) * step(vT.y, 6.8) * step(0.25, fract(vT.x / 12.0)) * step(fract(vT.x / 12.0), 0.75);
          float roof = step(7.3, vT.y);
          lamp += roof * step(0.42, fract(vT.x / 24.0)) * step(fract(vT.x / 24.0), 0.5) * 0.6;
          diffuseColor.rgb += roof * 0.04;`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.86, 0.6) * lamp * 2.5 + diffuseColor.rgb * 0.18;');
    };
    return mat;
  }

  setNight(v) {
    this.uniforms.uNight.value = v;
    for (const m of this.lampMats) m.emissiveIntensity = v > 0.5 ? 4 : v * 2;
  }

  // ------------------------------------------------------------ barriers enable/disable at gores
  markBarriers(route) {
    const n = route.n, cs = this.cs, w = this.world;
    route.barR = new Uint8Array(n).fill(1);
    route.barL = new Uint8Array(n).fill(1);
    route.barM = new Uint8Array(n).fill(1);
    const p = {}, tmp = {};
    for (let i = 0; i < n; i++) {
      route.frame(route.s[i], p);
      for (const [arr, off] of [[route.barR, cs.right + 0.25], [route.barL, cs.left - 0.25], [route.barM, cs.medianCenter]]) {
        const x = p.x + p.rx * off, z = p.z + p.rz * off;
        for (const o of w.routes) {
          if (o === route) continue;
          const q = o.nearest(x, z, tmp, 2);
          if (!q || Math.abs(q.y - p.y) > 4) continue;
          if (!o.closed && (q.s <= 0 || q.s >= o.length)) continue;
          if (q.offset > cs.left - 1.5 && q.offset < cs.right + 1.5) { arr[i] = 0; break; }
        }
      }
    }
    // remove isolated barrier fragments shorter than 20 m
    for (const arr of [route.barR, route.barL, route.barM]) {
      for (let i = 0; i < n; i++) {
        if (!arr[i]) continue;
        let j = i; while (j < n && arr[j]) j++;
        if (j - i < 10) for (let k = i; k < j; k++) arr[k] = 0;
        i = j;
      }
    }
  }

  // ------------------------------------------------------------ geometry builders
  // Extrudes a 2D profile [(offset, height)...] along route samples [i0, i1].
  extrude(route, i0, i1, profile, opts = {}) {
    const pos = [], nor = [], uv = [], idx = [];
    const f = {};
    const samples = [];
    for (let i = i0; i <= i1; i += STRIDE) samples.push(Math.min(i, route.n - 1));
    if (samples.at(-1) !== Math.min(i1, route.n - 1)) samples.push(Math.min(i1, route.n - 1));
    const segs = profile.length - 1;
    const yOff = opts.yOff || 0, sg = opts.flip ? -1 : 1;
    for (let si = 0; si < samples.length; si++) {
      const i = samples[si];
      route.frame(route.s[i], f);
      const y0 = opts.yAt ? opts.yAt(i, f) : f.y;
      for (let k = 0; k < segs; k++) {
        const a = profile[k], b = profile[k + 1];
        const dO = b[0] - a[0], dH = b[1] - a[1], L = Math.hypot(dO, dH) || 1;
        // outward normal of the profile segment in the (offset, height) plane
        const nO = (-dH / L) * sg, nH = (dO / L) * sg;
        for (const [o, h, vv] of [[a[0], a[1], 0], [b[0], b[1], 1]]) {
          pos.push(f.x + f.rx * o, y0 + h + yOff, f.z + f.rz * o);
          nor.push(f.rx * nO, nH, f.rz * nO);
          uv.push(route.s[i], opts.uvH ? h : (k + vv) / segs);
        }
      }
      if (si > 0) {
        const base0 = (si - 1) * segs * 2, base1 = si * segs * 2;
        for (let k = 0; k < segs; k++) {
          const a = base0 + k * 2, b = a + 1, c = base1 + k * 2, d = c + 1;
          if (opts.flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  deckGeometry(route, i0, i1) {
    const pos = [], nor = [], uv = [], deck = [], idx = [];
    const cs = this.cs, f = {};
    const offs = [cs.left, cs.oppOut, cs.oppIn, cs.medianCenter, cs.ourL, cs.ourR, cs.right];
    const concreteLeg = route.legs.map((l) => (l === 'i5' || l === 'i90' ? 1 : 0));
    let rows = 0;
    const list = [];
    for (let i = i0; i < i1; i += STRIDE) list.push(i);
    list.push(i1);
    for (const ii of list) {
      const wrap = ii >= route.n, k = ii % route.n;
      route.frame(wrap ? 0 : route.s[k], f);
      const sv = wrap ? route.length : route.s[k];
      const g = f.grade, inv = 1 / Math.hypot(1, g);
      const isConc = concreteLeg[route.legIdx[k]] || route.kind[k] === KIND.FLOATING ? 1 : 0;
      const tun = route.kind[k] === KIND.TUNNEL ? 1 : 0;
      const start = route.closed && (sv < 3 || sv > route.length - 0.01) ? 1 : 0;
      for (const o of offs) {
        pos.push(f.x + f.rx * o, f.y, f.z + f.rz * o);
        nor.push(-f.tx * g * inv, inv, -f.tz * g * inv);
        uv.push(o, sv);
        deck.push(isConc, tun, start);
      }
      if (rows > 0) {
        const a0 = (rows - 1) * offs.length, a1 = rows * offs.length;
        for (let c = 0; c < offs.length - 1; c++) idx.push(a0 + c, a0 + c + 1, a1 + c, a0 + c + 1, a1 + c + 1, a1 + c);
      }
      rows++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aDeck', new THREE.Float32BufferAttribute(deck, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  runs(route, pred) { // contiguous index runs where pred(i)
    const out = [];
    for (let i = 0; i < route.n; i++) {
      if (!pred(i)) continue;
      let j = i; while (j < route.n && pred(j)) j++;
      out.push([i, j - 1]);
      i = j;
    }
    return out;
  }

  buildRoute(route) {
    const cs = this.cs, n = route.n;
    const CH = 250; // samples per deck chunk (~500 m)
    const end = route.closed ? n : n - 1;
    for (let i0 = 0; i0 < end; i0 += CH) {
      const i1 = Math.min(end, i0 + CH);
      const m = new THREE.Mesh(this.deckGeometry(route, i0, i1), this.deckMat);
      m.receiveShadow = true;
      this.group.add(m);
    }
    // Jersey barriers
    const jersey = (c, flipSide) => [[c - 0.32, 0], [c - 0.24, 0.08], [c - 0.1, 0.33], [c - 0.08, 0.86], [c + 0.08, 0.86], [c + 0.1, 0.33], [c + 0.24, 0.08], [c + 0.32, 0]];
    const parts = [];
    for (const [arr, off] of [[route.barR, cs.right + 0.32], [route.barL, cs.left - 0.32], [route.barM, cs.medianCenter]]) {
      for (const [a, b] of this.runs(route, (i) => arr[i] && route.kind[i] !== KIND.TUNNEL)) {
        for (let i0 = a; i0 < b; i0 += CH) parts.push(this.extrude(route, i0, Math.min(b, i0 + CH), jersey(off)));
      }
    }
    // bridges: girders, fascia, piers; floating pontoons
    const pierPos = [];
    for (const [a, b] of this.runs(route, (i) => route.kind[i] === KIND.BRIDGE || route.kind[i] === KIND.FLOATING)) {
      const girder = [[cs.right + 0.7, 0.9], [cs.right + 0.7, -0.35], [cs.right - 1.5, -1.9], [cs.left + 1.5, -1.9], [cs.left - 0.7, -0.35], [cs.left - 0.7, 0.9]];
      for (let i0 = Math.max(0, a - 2); i0 < b + 2; i0 += CH) parts.push(this.extrude(route, i0, Math.min(Math.min(n - 1, b + 2), i0 + CH), girder));
      const f = {};
      for (let i = a; i <= b; i += 22) {
        route.frame(route.s[i], f);
        if (route.kind[i] === KIND.FLOATING) continue;
        for (const o of [cs.right - 3, cs.ourL + 1, cs.oppIn - 1, cs.left + 3]) {
          const x = f.x + f.rx * o, z = f.z + f.rz * o;
          const ground = this.world.isWater(x, z) ? this.world.waterLevelAt(x, z) - 3 : this.world.heightAt(x, z) - 1;
          const h = f.y - 1.9 - ground;
          if (h > 1.5) pierPos.push([x, ground, z, h, Math.atan2(f.tx, f.tz)]);
        }
      }
    }
    const lake = this.world.lakeLevel;
    for (const [a, b] of this.runs(route, (i) => route.kind[i] === KIND.FLOATING)) {
      const pont = [[cs.right + 4, lake - 2], [cs.right + 4, lake + 1.1], [cs.left - 4, lake + 1.1], [cs.left - 4, lake - 2]];
      for (let i0 = a; i0 < b; i0 += CH) {
        const g = this.extrude(route, i0, Math.min(b, i0 + CH), pont, { yAt: () => 0, flip: true });
        const m = new THREE.Mesh(g, this.pontoonMat); m.receiveShadow = true; this.group.add(m);
      }
      // columns between pontoon and deck where the deck is high (520)
      const f = {};
      for (let i = a; i <= b; i += 12) {
        route.frame(route.s[i], f);
        const h = f.y - 1.9 - (lake + 1.1);
        if (h < 0.8) continue;
        for (const o of [cs.right - 2, cs.ourL + 2, cs.oppIn - 2, cs.left + 2]) pierPos.push([f.x + f.rx * o, lake + 1.1, f.z + f.rz * o, h, Math.atan2(f.tx, f.tz)]);
      }
    }
    if (parts.length) {
      const merged = mergeGeoms(parts);
      const m = new THREE.Mesh(merged, this.concreteMat);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }
    if (pierPos.length) {
      const geo = new THREE.BoxGeometry(1.6, 1, 2.2).translate(0, 0.5, 0);
      const im = new THREE.InstancedMesh(geo, this.girderMat, pierPos.length);
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      pierPos.forEach(([x, y, z, h, yaw], k) => { e.set(0, yaw, 0); q.setFromEuler(e); M.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, h, 1)); im.setMatrixAt(k, M); });
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
    // tunnels: walls + ceiling + portals
    for (const [a, b] of this.runs(route, (i) => route.kind[i] === KIND.TUNNEL)) {
      if (b - a < 8) continue;
      // two bores with chamfered corners (shared with the physics, see tunnel.js)
      for (const bore of [this.bores.ours, this.bores.opp]) {
        const P = bore.poly;
        const profile = [P[1], P[2], P[3], P[4], P[5], P[6], P[7], P[0]];
        const g = this.extrude(route, a, b, profile, { uvH: true });
        const m = new THREE.Mesh(g, this.tunnelMat); m.receiveShadow = true; m.castShadow = true; this.group.add(m);
      }
      // outer shell (so the tunnel reads as a structure from outside)
      const outer = [[cs.left - 1.6, -0.5], [cs.left - 1.6, TUNNEL_H + 1.2], [cs.right + 1.6, TUNNEL_H + 1.2], [cs.right + 1.6, -0.5]];
      const go = this.extrude(route, a, b, outer);
      const mo = new THREE.Mesh(go, this.concreteMat); mo.castShadow = true; this.group.add(mo);
      // portal frames
      const f = {};
      for (const i of [a, b]) {
        route.frame(route.s[i], f);
        const w = cs.right - cs.left + 3.2;
        const portal = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, 1.2), this.concreteMat);
        const mid = (cs.right + cs.left) / 2;
        portal.position.set(f.x + f.rx * mid, f.y + 7.9, f.z + f.rz * mid);
        portal.rotation.y = Math.atan2(f.tx, f.tz);
        portal.castShadow = true;
        this.group.add(portal);
      }
    }
  }

  buildPoles() {
    // twin-arm lamp posts in the median every 64 m (matches the road glow pattern)
    const poleGeo = mergeGeoms([
      new THREE.CylinderGeometry(0.12, 0.18, 12, 8).translate(0, 6, 0),
      new THREE.BoxGeometry(0.12, 0.12, 6).translate(0, 11.8, 0).rotateY(Math.PI / 2),
    ]);
    const headGeo = mergeGeoms([new THREE.BoxGeometry(0.9, 0.18, 0.4).translate(-3, 11.7, 0), new THREE.BoxGeometry(0.9, 0.18, 0.4).translate(3, 11.7, 0)]);
    const mats = [];
    const f = {};
    for (const r of this.world.routes) {
      for (let s = 32; s < r.length; s += 64) {
        r.frame(s, f);
        const i = Math.floor(r.index(s));
        if (r.kind[i] === KIND.TUNNEL || !r.barM[i]) continue;
        mats.push([f.x + f.rx * this.cs.medianCenter, f.y + 0.8, f.z + f.rz * this.cs.medianCenter, Math.atan2(f.tx, f.tz)]);
      }
    }
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    const im = new THREE.InstancedMesh(poleGeo, this.steelMat, mats.length);
    const ih = new THREE.InstancedMesh(headGeo, this.lampMat, mats.length);
    mats.forEach(([x, y, z, yaw], k) => { e.set(0, yaw, 0); q.setFromEuler(e); M.compose(new THREE.Vector3(x, y, z), q, one); im.setMatrixAt(k, M); ih.setMatrixAt(k, M); });
    im.castShadow = true;
    im.computeBoundingSphere(); ih.computeBoundingSphere();
    this.group.add(im, ih);
    this.lampPositions = mats;
  }

  signTexture(lines, opts = {}) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = opts.bg || '#0b6b3a'; c.fillRect(0, 0, 512, 256);
    c.strokeStyle = '#f2f2f2'; c.lineWidth = 6; c.strokeRect(8, 8, 496, 240);
    c.fillStyle = '#f2f2f2'; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (opts.shield) {
      // interstate / state shield
      c.save(); c.translate(256, 62);
      if (opts.shield.type === 'I') {
        c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(-38, -36); c.lineTo(38, -36); c.quadraticCurveTo(46, 10, 0, 40); c.quadraticCurveTo(-46, 10, -38, -36); c.fill();
        c.fillStyle = '#1b3f94'; c.fillRect(-34, -22, 68, 46); c.fillStyle = '#c62026'; c.fillRect(-34, -33, 68, 11);
        c.fillStyle = '#fff'; c.font = 'bold 30px Arial'; c.fillText(opts.shield.num, 0, 4);
      } else {
        c.fillStyle = '#fff'; c.beginPath(); c.arc(0, 0, 36, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#111'; c.font = 'bold 28px Arial'; c.fillText(opts.shield.num, 0, 2);
      }
      c.restore();
    }
    c.fillStyle = '#f2f2f2';
    const y0 = opts.shield ? 140 : 70;
    lines.forEach((l, k) => { c.font = `${k === 0 ? 'bold 40px' : '34px'} "Arial", sans-serif`; c.fillText(l, 256, y0 + k * 46); });
    if (opts.exitOnly) { c.fillStyle = '#ffd200'; c.fillRect(8, 210, 496, 38); c.fillStyle = '#111'; c.font = 'bold 28px Arial'; c.fillText('EXIT ONLY', 256, 230); }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  buildSigns() {
    const loop = this.world.loop, cs = this.cs;
    const legRuns = [];
    for (let i = 0; i < loop.n; i++) {
      const lg = loop.legs[loop.legIdx[i]];
      if (!legRuns.length || legRuns.at(-1).leg !== lg) legRuns.push({ leg: lg, s0: loop.s[i], s1: loop.s[i] });
      legRuns.at(-1).s1 = loop.s[i];
    }
    const NEXT = {
      i5: [{ shield: { type: 'I', num: '90' }, lines: ['EAST', 'Bellevue  Spokane'] }, { shield: { type: 'I', num: '5' }, lines: ['SOUTH', 'Portland'] }],
      i90: [{ shield: { type: 'I', num: '405' }, lines: ['NORTH', 'Bellevue  Everett'] }, { shield: { type: 'I', num: '90' }, lines: ['EAST', 'Mercer Island  Bellevue'] }],
      i405: [{ shield: { type: 'S', num: '520' }, lines: ['WEST', 'Seattle'] }, { shield: { type: 'I', num: '405' }, lines: ['NORTH', 'NE 8th St  Downtown Bellevue'] }],
      sr520: [{ shield: { type: 'I', num: '5' }, lines: ['SOUTH', 'Seattle  Portland'] }, { shield: { type: 'S', num: '520' }, lines: ['WEST', 'Montlake Blvd  Seattle'] }],
    };
    const gantries = [];
    for (const run of legRuns) {
      const info = NEXT[run.leg];
      if (!info) continue;
      const len = run.s1 - run.s0;
      if (len > 1500) gantries.push({ s: run.s0 + len * 0.35, sign: info[1] });
      gantries.push({ s: run.s1 - 900, sign: { ...info[0], lines: [...info[0].lines.slice(0, 1), info[0].lines[1], ] }, mile: true });
      gantries.push({ s: run.s1 - 250, sign: info[0], exitOnly: true });
    }
    const f = {};
    const postGeo = new THREE.CylinderGeometry(0.22, 0.25, 8, 8).translate(0, 4, 0);
    const beamGeo = new THREE.BoxGeometry(1, 0.9, 0.9);
    for (const gn of gantries) {
      const i = Math.floor(loop.index(gn.s));
      if (loop.kind[i] === KIND.TUNNEL) continue;
      loop.frame(gn.s, f);
      const grp = new THREE.Group();
      const yaw = Math.atan2(f.tx, f.tz);
      grp.position.set(f.x, f.y, f.z);
      grp.rotation.y = yaw;
      // local frame: +z forward, +x = left
      const span = cs.right + 0.6 - cs.medianCenter;
      for (const o of [cs.medianCenter, cs.right + 0.8]) {
        const p = new THREE.Mesh(postGeo, this.steelMat); p.position.set(-o, 0, 0); p.castShadow = true; grp.add(p);
      }
      const beam = new THREE.Mesh(beamGeo, this.steelMat);
      beam.scale.set(span + 1, 1, 1); beam.position.set(-(cs.medianCenter + cs.right + 0.8) / 2, 7.6, 0); beam.castShadow = true; grp.add(beam);
      const tex = this.signTexture(gn.sign.lines.concat(gn.mile ? ['1/2 MILE'] : []), { shield: gn.sign.shield, exitOnly: gn.exitOnly });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.05 }));
      this.lampMats.push(panel.material);
      // panels face oncoming traffic (towards -z local)
      panel.rotation.y = Math.PI;
      panel.position.set(-(gn.exitOnly ? cs.ourLane(3) - 1.5 : cs.ourLane(1)), 7.6, -0.5);
      grp.add(panel);
      const back = new THREE.Mesh(new THREE.BoxGeometry(7.3, 3.7, 0.15), this.steelMat);
      back.position.copy(panel.position); back.position.z += 0.1; grp.add(back);
      this.group.add(grp);
    }
    // speed limit signs on the right shoulder
    const limTex = {};
    const limGeo = new THREE.PlaneGeometry(1.2, 1.5);
    let lastLim = 0;
    for (let s = 150; s < loop.length; s += 1600) {
      loop.frame(s, f);
      const i = Math.floor(loop.index(s));
      if (loop.kind[i] === KIND.TUNNEL) continue;
      const lim = loop.limit[i];
      if (!limTex[lim]) {
        const cv = document.createElement('canvas'); cv.width = 128; cv.height = 160;
        const c = cv.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, 128, 160); c.strokeStyle = '#111'; c.lineWidth = 5; c.strokeRect(6, 6, 116, 148);
        c.fillStyle = '#111'; c.textAlign = 'center'; c.font = 'bold 22px Arial'; c.fillText('SPEED', 64, 38); c.fillText('LIMIT', 64, 62);
        c.font = 'bold 64px Arial'; c.fillText(String(lim), 64, 128);
        limTex[lim] = new THREE.CanvasTexture(cv); limTex[lim].colorSpace = THREE.SRGBColorSpace;
      }
      lastLim = lim;
      const grp = new THREE.Group();
      grp.position.set(f.x + f.rx * (cs.right + 1.4), f.y, f.z + f.rz * (cs.right + 1.4));
      grp.rotation.y = Math.atan2(f.tx, f.tz) + Math.PI;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6).translate(0, 1.3, 0), this.steelMat);
      const sign = new THREE.Mesh(limGeo, new THREE.MeshStandardMaterial({ map: limTex[lim], roughness: 0.6 }));
      sign.position.y = 2.6; sign.position.z = -0.06;
      grp.add(post, sign);
      this.group.add(grp);
    }
    void lastLim;
  }

  buildStubEnds() {
    const f = {}, cs = this.cs;
    const mat = new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.6 });
    for (const r of this.world.stubs) {
      for (const s of [0.5, r.length - 0.5]) {
        r.frame(s, f);
        // no barrier where the stub branches off another road (e.g. an exit splitting from I-90)
        if (this.world.routes.some((o) => { if (o === r) return false; const q = o.nearest(f.x, f.z, {}, 2); return q && q.dist < cs.right - cs.left && Math.abs(q.y - f.y) < 3; })) continue;
        const grp = new THREE.Group();
        grp.position.set(f.x, f.y, f.z); grp.rotation.y = Math.atan2(f.tx, f.tz);
        const w = cs.right - cs.left;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 0.6), this.concreteMat);
        wall.position.set(-(cs.right + cs.left) / 2, 0.55, 0);
        grp.add(wall);
        for (let o = cs.left + 1; o < cs.right; o += 3) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.1), mat);
          b.position.set(-o, 1.25, 0); grp.add(b);
        }
        this.group.add(grp);
      }
    }
  }
}

export function mergeGeoms(geoms) {
  let nv = 0, ni = 0;
  for (const g of geoms) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geoms) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[io + k] = g.index.array[k] + vo;
    else for (let k = 0; k < c; k++) idx[io + k] = vo + k;
    io += g.index ? g.index.count : c; vo += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
