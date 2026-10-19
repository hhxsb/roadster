import * as THREE from 'three';

// Lofted body: stations along z (front = +z). Each station { z, w, yb, yt, p?, tumble?, xo? }
//  w      half width
//  yb/yt  bottom / top heights
//  p      superellipse exponent (2 = ellipse, large = box)
//  tumble narrowing of the upper half (0..1)
export function loft(stations, opts = {}) {
  const N = opts.segments || 20;
  const pos = [], uv = [];
  const ring = (st) => {
    const out = [];
    const p = st.p ?? opts.p ?? 3, tum = st.tumble ?? opts.tumble ?? 0;
    const mid = (st.yb + st.yt) / 2, hh = (st.yt - st.yb) / 2;
    for (let k = 0; k < N; k++) {
      const th = -Math.PI / 2 + (k / N) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      let x = st.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
      const yn = Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
      if (yn > 0) x *= 1 - tum * yn;
      out.push([x + (st.xo || 0), mid + hh * yn, st.z]);
    }
    return out;
  };
  const rings = stations.map(ring);
  for (const r of rings) for (const v of r) pos.push(...v);
  const idx = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < N; k++) {
      const a = i * N + k, b = i * N + ((k + 1) % N), c = (i + 1) * N + k, d = (i + 1) * N + ((k + 1) % N);
      idx.push(a, c, b, b, c, d);
    }
  }
  // end caps
  if (opts.caps !== false) {
    for (const [ri, flip] of [[0, true], [rings.length - 1, false]]) {
      const center = rings[ri].reduce((acc, v) => [acc[0] + v[0] / N, acc[1] + v[1] / N, acc[2] + v[2] / N], [0, 0, 0]);
      const ci = pos.length / 3; pos.push(...center);
      for (let k = 0; k < N; k++) {
        const a = ri * N + k, b = ri * N + ((k + 1) % N);
        if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
      }
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (opts.flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  return fixWinding(g);
}

// Flips the winding if the highest vertex's normal points down (i.e. faces inward)
export function fixWinding(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  let topI = 0;
  for (let i = 1; i < p.count; i++) if (p.getY(i) > p.getY(topI)) topI = i;
  if (n.getY(topI) < 0) {
    const idx = g.index;
    if (idx) { for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); } idx.needsUpdate = true; }
    else { for (let i = 0; i < p.count; i += 3) for (const a of [p, n]) { for (let c = 0; c < a.itemSize; c++) { const t = a.array[(i + 1) * a.itemSize + c]; a.array[(i + 1) * a.itemSize + c] = a.array[(i + 2) * a.itemSize + c]; a.array[(i + 2) * a.itemSize + c] = t; } } }
    g.computeVertexNormals();
  }
  return g;
}

export function paint(geo, color, emit = 0) {
  const c = new THREE.Color(color), n = geo.attributes.position.count;
  const col = new Float32Array(n * 3), em = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; em[i] = emit; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}

// merge geometries that all carry position/normal/color/aEmit
export function mergeParts(parts) {
  const list = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), em = new Float32Array(n);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3); em.set(g.attributes.aEmit.array, o);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
  out.computeBoundingSphere();
  return out;
}

export function wheelGeo(r, w, rimColor = 0xb8bcc0) {
  const tire = paint(new THREE.CylinderGeometry(r, r, w, 18, 1).rotateZ(Math.PI / 2), 0x151515);
  const rim = paint(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 14, 1).rotateZ(Math.PI / 2), rimColor);
  return [tire, rim];
}

export function box(w, h, d, x, y, z, color, emit = 0) {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color, emit);
}
