import * as THREE from 'three';

// Procedural Tesla Roadster, Rocket trim as revealed on 15 Oct 2026: a white, sharp-edged wedge
// (SR-71 / F-35 / Lotus Esprit lines), dark glass canopy, pop-down headlamps behind a knife-edge
// DRL, thin red tail strip, RDSTR plate above four rear thrusters, six corner/side lift thrusters,
// self-adjusting rear wing, black wheels, one seat with an air tank where the passenger sat.
// Local frame: +z forward, +x left, +y up, origin on the ground under the car's centre.

export const PAINT = 0xf1f1ee;

const WHEELS = { front: { z: 1.33, r: 0.34, w: 0.26 }, rear: { z: -1.32, r: 0.36, w: 0.32 }, x: 0.84 };

// Body stations: z, half width W, bottom yb, side crease yM, shoulder crease yS, centreline deck yC
const ST = [
  [2.19, 0.66, 0.25, 0.31, 0.35, 0.34],
  [2.10, 0.82, 0.20, 0.33, 0.42, 0.40],
  [1.95, 0.92, 0.16, 0.37, 0.52, 0.47],
  [1.70, 0.98, 0.13, 0.43, 0.66, 0.55],
  [1.33, 1.00, 0.13, 0.50, 0.77, 0.63],
  [1.00, 0.99, 0.13, 0.52, 0.76, 0.67],
  [0.86, 0.97, 0.13, 0.53, 0.75, 0.69],
  // open cockpit tub under the canopy (deck centre drops to the floor pan)
  [0.70, 0.965, 0.13, 0.53, 0.75, 0.46],
  [0.30, 0.95, 0.13, 0.54, 0.75, 0.40],
  [-0.30, 0.96, 0.13, 0.55, 0.78, 0.40],
  [-0.80, 0.99, 0.13, 0.56, 0.82, 0.42],
  [-1.12, 1.00, 0.13, 0.565, 0.85, 0.50],
  [-1.32, 1.01, 0.14, 0.57, 0.87, 0.82],
  [-1.70, 1.00, 0.16, 0.58, 0.89, 0.87],
  [-2.00, 0.97, 0.20, 0.58, 0.89, 0.885],
  [-2.17, 0.95, 0.22, 0.58, 0.88, 0.88],
];

// straight-line interpolation keeps the wedge's edges ruler-straight
function lerpStations(z) {
  for (let i = 0; i < ST.length - 1; i++) {
    const a = ST[i], b = ST[i + 1];
    if (z <= a[0] && z >= b[0]) { const t = (a[0] - z) / (a[0] - b[0]); return a.map((v, k) => v + (b[k] - v) * t); }
  }
  return z > ST[0][0] ? ST[0] : ST[ST.length - 1];
}

// angular wheel opening: flat top, straight 58-degree flanks
function archY(z) {
  let y = -1;
  for (const w of [WHEELS.front, WHEELS.rear]) {
    const top = w.r + 0.38 + (w === WHEELS.rear ? 0.02 : 0), dz = Math.abs(z - w.z);
    y = Math.max(y, dz < 0.2 ? top : top - (dz - 0.2) * 1.6);
  }
  return y;
}

// half cross-section, centre-bottom round to centre-top
function section(z) {
  const [, W, yb, yM, yS, yC] = lerpStations(z);
  const half = [[0, yb], [W - 0.1, yb], [W - 0.01, yb + 0.09], [W, yM], [W - 0.07, yS], [W - 0.24, yS + 0.012], [0, yC]];
  const ay = archY(z);
  if (ay > 0) for (const p of half) if (p[0] > 0.6 && p[1] < ay) p[1] = ay;
  return half;
}

// Loft half-sections (mirrored about x = 0) into flat facets that share no vertices across a
// crease, so every edge stays sharp while each facet shades smoothly along its length.
function facetLoft(zs, sectionAt, caps = true) {
  const rings = zs.map((z) => { const h = sectionAt(z); return [...h.slice(1).reverse().map(([x, y]) => [-x, y, z]), ...h.map(([x, y]) => [x, y, z])]; });
  const pos = [], idx = [], N = rings[0].length;
  for (let k = 0; k < N - 1; k++) {
    const base = pos.length / 3;
    for (const r of rings) pos.push(...r[k], ...r[k + 1]);
    for (let i = 0; i + 1 < rings.length; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  if (caps) for (const [r, flip] of [[rings[0], true], [rings[rings.length - 1], false]]) {
    const ci = pos.length / 3, cy = r.reduce((s, v) => s + v[1], 0) / N;
    pos.push(0, cy, r[0][2]); for (const v of r) pos.push(...v);
    for (let k = 0; k < N - 1; k++) if (flip) idx.push(ci, ci + 2 + k, ci + 1 + k); else idx.push(ci, ci + 1 + k, ci + 2 + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return fixOutward(g);
}

function fixOutward(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  let top = 0; for (let i = 1; i < p.count; i++) if (p.getY(i) > p.getY(top)) top = i;
  if (n.getY(top) < 0) {
    const ix = g.index; for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); }
    ix.needsUpdate = true; g.computeVertexNormals();
  }
  return g;
}

function buildBody() {
  const zs = [];
  for (let z = 2.19; z > -2.17; z -= 0.02) zs.push(z);
  zs.push(-2.17);
  return facetLoft(zs, section);
}

// Faceted canopy: raked flat windscreen, flat roof, tumbled-in side glass, long fastback
const CANOPY = [
  // z, base half width, base y, roof-edge half width, roof-edge y, roof centre y
  [0.98, 0.70, 0.68, 0.66, 0.70, 0.705],
  [0.30, 0.74, 0.68, 0.52, 1.05, 1.08],
  [-0.45, 0.75, 0.70, 0.50, 1.10, 1.13],
  [-1.05, 0.74, 0.76, 0.46, 1.00, 1.02],
  [-1.55, 0.62, 0.84, 0.40, 0.89, 0.895],
];
function canopyAt(z) {
  let a = CANOPY[0], b = CANOPY[1];
  for (let i = 0; i < CANOPY.length - 1; i++) if (z <= CANOPY[i][0] && z >= CANOPY[i + 1][0]) { a = CANOPY[i]; b = CANOPY[i + 1]; }
  const t = (a[0] - z) / (a[0] - b[0]), s = a.map((v, k) => v + (b[k] - v) * t);
  // roof centre first, open underneath so the cabin shows through the glass
  return [[0, s[5]], [s[3] * 0.45, s[5] - 0.004], [s[3], s[4]], [s[1], s[2] - 0.02]];
}
function buildCanopy() {
  const zs = [];
  for (let z = 0.98; z > -1.55; z -= 0.025) zs.push(z);
  zs.push(-1.55);
  return facetLoft(zs, canopyAt);
}

function tube(points, radius) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 48, radius, 8, false);
}

// z of the body outline (plan view) at half-width x, searching from the nose (dir 1) or tail (dir -1)
function edgeZ(x, dir) {
  for (let z = dir > 0 ? 2.19 : -2.17; Math.abs(z) > 1.2; z -= dir * 0.004) if (lerpStations(z)[1] >= x) return z;
  return dir * 1.2;
}

function plateTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f4f2'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#111'; x.font = 'bold 44px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('RDSTR', 128, 35);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildRoadster() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({ color: PAINT, metalness: 0.15, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: 0.4, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.88 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5, metalness: 0.3 });
  const liner = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, side: THREE.DoubleSide });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.32, metalness: 0.5 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.7 });
  const interior = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.85 });
  const lightW = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf2ff, emissiveIntensity: 1.6 });
  const lightR = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1418, emissiveIntensity: 2.2 });
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.25, metalness: 1.0, side: THREE.DoubleSide });

  body.add(new THREE.Mesh(buildBody(), paint));
  body.add(new THREE.Mesh(buildCanopy(), glass));

  // wheel-arch liners
  for (const w of [WHEELS.front, WHEELS.rear]) for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(w.r + 0.05, w.r + 0.05, 0.3, 24, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), liner);
    l.position.set(s * 0.72, w.r, w.z);
    body.add(l);
  }

  // knife-edge DRL along the nose's side crease; the headlamps themselves pop down out of the
  // two slots behind it, so the nose stays clean
  const drl = [];
  for (let x = -0.62; x <= 0.621; x += 0.062) { const z = edgeZ(Math.abs(x) + 0.004, 1); drl.push([x, lerpStations(z)[3], z + 0.006]); }
  body.add(new THREE.Mesh(tube(drl, 0.011), lightW));
  for (const s of [-1, 1]) {
    const z = 1.98, slot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.09), black);
    slot.position.set(s * 0.6, lerpStations(z)[4] - 0.025, z); slot.rotation.x = 0.42; body.add(slot);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.025), lightW);
    lamp.position.set(s * 0.6, lerpStations(z)[4] - 0.03, z + 0.035); lamp.rotation.x = 0.42; body.add(lamp);
  }
  // front: lower intake and splitter
  const intake = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.1), black); intake.position.set(0, 0.25, 2.1); body.add(intake);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.02, 0.16), carbon); splitter.position.set(0, 0.17, 2.05); body.add(splitter);
  // carbon side skirts and small camera-mirror pods
  for (const s of [-1, 1]) {
    const sk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 1.9), carbon); sk.position.set(s * 0.95, 0.16, 0.0); body.add(sk);
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.12), carbon); pod.position.set(s * 0.82, 0.8, 0.78); body.add(pod);
  }

  // tail: thin full-width red strip under the deck edge, black panel with the RDSTR plate
  const rearBar = [];
  for (let x = -0.93; x <= 0.931; x += 0.093) { const z = edgeZ(Math.abs(x) + 0.004, -1); rearBar.push([x, 0.8, z - 0.008]); }
  body.add(new THREE.Mesh(tube(rearBar, 0.012), lightR));
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.34, 0.02), black); panel.position.set(0, 0.53, -2.172); body.add(panel);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.105), new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.4 }));
  plate.position.set(0, 0.62, -2.185); plate.rotation.y = Math.PI; body.add(plate);
  const diff = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.4), carbon); diff.position.set(0, 0.2, -1.97); diff.rotation.x = 0.18; body.add(diff);
  for (let k = -3; k <= 3; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.36), carbon); fin.position.set(k * 0.19, 0.18, -1.98); fin.rotation.x = 0.18; body.add(fin); }

  // self-adjusting rear wing: lies flush in the deck, rises and tilts with speed (see Game.syncModel)
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.lineTo(0.3, 0.012); wingShape.lineTo(0.3, -0.008); wingShape.lineTo(0, -0.012); wingShape.lineTo(0, 0);
  const wing = new THREE.Group(); wing.position.set(0, 0.885, -2.1);
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 1.7, bevelEnabled: false }).translate(0, 0, -0.85).rotateY(-Math.PI / 2), paint);
  blade.position.y = 0.012; wing.add(blade);
  const struts = [];
  for (const s of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1, 0.08).translate(0, -0.5, 0), carbon);
    st.position.set(s * 0.45, 0.01, 0.16); st.scale.y = 0.001; wing.add(st); struts.push(st);
  }
  body.add(wing);
  root.userData.wing = { obj: wing, blade, struts, baseY: wing.position.y };

  // interior: one white seat (driver, left), carbon air tank where the passenger seat was
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.55, 0.12).translate(0, 0.27, 0), seatMat); seat.position.set(0.33, 0.44, -0.66); seat.rotation.x = -0.28; body.add(seat);
  const cush = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.5), seatMat); cush.position.set(0.33, 0.45, -0.4); body.add(cush);
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 6, 16).rotateX(Math.PI / 2), carbon); tank.position.set(-0.33, 0.62, -0.5); body.add(tank);
  for (const z of [-0.75, -0.25]) { const strap = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.012, 6, 20), nozzleMat); strap.position.set(-0.33, 0.62, z); body.add(strap); }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.4), interior); dash.position.set(0, 0.66, 0.62); body.add(dash);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.3 }));
  screen.position.set(0, 0.78, 0.46); screen.rotation.set(-0.45, Math.PI, 0); body.add(screen);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 8, 24, Math.PI * 1.6), black);
  wheel.position.set(0.33, 0.72, 0.3); wheel.rotation.set(-0.35, 0, Math.PI * 0.7); body.add(wheel);
  root.userData.steeringWheel = wheel;

  // SpaceX package: four rear thrusters in a row under the plate, plus lift/rotation thrusters
  // at each corner and one on each side
  const nozzles = [];
  const bell = new THREE.LatheGeometry([new THREE.Vector2(0.03, 0), new THREE.Vector2(0.04, 0.03), new THREE.Vector2(0.065, 0.1), new THREE.Vector2(0.069, 0.11)], 18).rotateX(-Math.PI / 2);
  for (const x of [-0.45, -0.15, 0.15, 0.45]) {
    const n = new THREE.Mesh(bell, nozzleMat);
    n.position.set(x, 0.41, -2.17);
    body.add(n);
    nozzles.push({ type: 'main', obj: n });
  }
  const port = new THREE.CylinderGeometry(0.06, 0.075, 0.03, 16);
  for (const [x, y, z] of [[0.72, 0.14, 1.85], [-0.72, 0.14, 1.85], [0.78, 0.15, -1.85], [-0.78, 0.15, -1.85], [0.86, 0.11, 0.0], [-0.86, 0.11, 0.0]]) {
    const p = new THREE.Mesh(port, nozzleMat);
    p.position.set(x, y, z);
    body.add(p);
    nozzles.push({ type: 'lift', obj: p });
  }
  root.userData.nozzles = nozzles;

  // wheels: pivot (steer) > spin. Order must match the physics: FL, FR, RL, RR (+x = left)
  const wheels = [];
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.92 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x0e0f11, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide });
  const rimFace = new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.8, roughness: 0.25 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x5d5f62, metalness: 0.9, roughness: 0.45 });
  const calMat = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.4 });
  for (const [def, front] of [[WHEELS.front, true], [WHEELS.rear, false]]) for (const s of [1, -1]) {
    const { r, w } = def;
    const pivot = new THREE.Group(); pivot.position.set(s * WHEELS.x, r, def.z);
    const spin = new THREE.Group(); pivot.add(spin);
    const rr = r - 0.1;
    const prof = [new THREE.Vector2(rr, -w / 2)];
    for (let k = 0; k <= 8; k++) { const a = -Math.PI / 2 + (k / 8) * Math.PI; prof.push(new THREE.Vector2(r - 0.035 + Math.cos(a) * 0.035, (w / 2) * Math.sin(a))); }
    prof.push(new THREE.Vector2(rr, w / 2));
    spin.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 36).rotateZ(Math.PI / 2), tireMat));
    spin.add(new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, w * 0.85, 30, 1, true).rotateZ(Math.PI / 2), rimMat));
    const face = new THREE.Mesh(new THREE.CircleGeometry(rr * 0.98, 30).rotateY(s * Math.PI / 2), rimMat); face.position.x = s * w * 0.2; spin.add(face);
    // closed aero face with five flat blades
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.018, rr * 0.86, 0.09).translate(0, rr * 0.47, 0), rimFace);
      sp.rotation.x = (k / 5) * Math.PI * 2;
      sp.position.x = s * (w * 0.21 + 0.01);
      spin.add(sp);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 6).rotateZ(Math.PI / 2), rimFace); cap.position.x = s * (w * 0.21 + 0.02); spin.add(cap);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.82, rr * 0.82, 0.03, 24).rotateZ(Math.PI / 2), discMat); disc.position.x = -s * 0.01; pivot.add(disc);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.12), calMat); cal.position.set(s * 0.02, 0.1, -0.12); pivot.add(cal);
    root.add(pivot);
    wheels.push({ pivot, spin, front, radius: r, baseY: r });
  }
  root.userData.wheels = wheels;
  root.userData.paint = paint;
  root.userData.lights = { head: lightW, tail: lightR };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

// wing deployment 0 (flush) .. 1 (raised, max angle)
export function setWing(root, k) {
  const w = root.userData.wing; if (!w) return;
  const h = 0.15 * k;
  w.obj.position.y = w.baseY + h;
  w.obj.rotation.x = -0.22 * k;
  for (const s of w.struts) s.scale.y = Math.max(0.001, h);
}
