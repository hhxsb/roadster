import * as THREE from 'three';
import { loft, paint, mergeParts, wheelGeo, box } from './loft.js';

const GLASS = 0x1a2128, TRIM = 0x1c1c1e, CHROME = 0xb9bec4;
const HEAD = 1, TAIL = 2, SIREN_R = 3, SIREN_B = 4, AMBER = 5;

// Generic passenger vehicle.
function passenger(o) {
  const { L, W, H } = o;
  const gc = o.gc ?? 0.16, belt = o.belt ?? H * 0.58, hood = o.hood ?? belt - 0.08, trunk = o.trunk ?? belt - 0.02;
  const zf = L / 2, zr = -L / 2, body = o.color ?? 0xffffff;
  const parts = [];
  // lower body
  parts.push(paint(loft([
    { z: zr, w: W / 2 - 0.12, yb: gc + 0.12, yt: trunk - 0.06, p: 4 },
    { z: zr + 0.12, w: W / 2 - 0.03, yb: gc, yt: trunk, p: 5 },
    { z: zr + L * 0.3, w: W / 2, yb: gc, yt: belt, p: 6 },
    { z: zf - L * 0.3, w: W / 2, yb: gc, yt: belt, p: 6 },
    { z: zf - 0.15, w: W / 2 - 0.04, yb: gc, yt: hood, p: 5 },
    { z: zf, w: W / 2 - 0.14, yb: gc + 0.1, yt: hood - 0.12, p: 4 },
  ], { segments: 16, tumble: 0.08 }), body));
  // greenhouse
  const c0 = o.cabin[0] * L / 2, c1 = o.cabin[1] * L / 2, rr = o.rearRake ?? 0.45, fr = o.frontRake ?? 0.7;
  const cw = W / 2 - (o.cabinInset ?? 0.12);
  const top = H;
  parts.push(paint(loft([
    { z: c0, w: cw, yb: belt - 0.05, yt: belt + 0.04, p: 5 },
    { z: c0 + rr * 0.15, w: cw, yb: belt - 0.05, yt: top - 0.25, p: 5 },
    { z: c0 + rr, w: cw - 0.04, yb: belt - 0.05, yt: top, p: 5 },
    { z: c1 - fr, w: cw - 0.04, yb: belt - 0.05, yt: top, p: 5 },
    { z: c1, w: cw, yb: belt - 0.05, yt: belt + 0.06, p: 5 },
  ], { segments: 14, tumble: o.tumble ?? 0.22 }), GLASS));
  // roof skin
  parts.push(paint(loft([
    { z: c0 + rr - 0.05, w: cw - 0.07, yb: top - 0.05, yt: top + 0.02, p: 6 },
    { z: c1 - fr + 0.05, w: cw - 0.07, yb: top - 0.05, yt: top + 0.02, p: 6 },
  ], { segments: 10, tumble: 0.3 }), o.roofColor ?? body));
  // wheels
  const wr = o.wr ?? 0.33, wb = o.wb ?? L * 0.6, wc = o.wbCenter ?? 0;
  for (const z of [wc - wb / 2, wc + wb / 2]) for (const x of [-1, 1]) {
    const [t, r] = wheelGeo(wr, 0.24, o.rim ?? CHROME);
    t.translate(x * (W / 2 - 0.15), wr, z); r.translate(x * (W / 2 - 0.15), wr, z);
    parts.push(t, r);
  }
  // lights + grille + bumpers
  parts.push(box(W * 0.24, 0.1, 0.06, W * 0.3, hood - 0.12, zf - 0.02, 0xe8eef5, HEAD), box(W * 0.24, 0.1, 0.06, -W * 0.3, hood - 0.12, zf - 0.02, 0xe8eef5, HEAD));
  parts.push(box(W * 0.26, 0.09, 0.06, W * 0.3, trunk - 0.1, zr + 0.02, 0x9a0f12, TAIL), box(W * 0.26, 0.09, 0.06, -W * 0.3, trunk - 0.1, zr + 0.02, 0x9a0f12, TAIL));
  parts.push(box(W * 0.42, 0.16, 0.05, 0, gc + 0.22, zf - 0.04, TRIM));
  parts.push(box(W - 0.2, 0.12, 0.08, 0, gc + 0.06, zr + 0.06, TRIM), box(W - 0.2, 0.12, 0.08, 0, gc + 0.06, zf - 0.06, TRIM));
  if (o.extra) parts.push(...o.extra({ L, W, H, belt, top, c0, c1, zf, zr, gc }));
  return parts;
}

function pickup(o) {
  const { L, W, H } = o, gc = 0.24, belt = 1.18, zf = L / 2, zr = -L / 2;
  const body = o.color ?? 0xffffff, parts = [];
  parts.push(paint(loft([
    { z: zr, w: W / 2 - 0.05, yb: gc + 0.15, yt: belt, p: 10 },
    { z: zr + 0.1, w: W / 2, yb: gc, yt: belt, p: 10 },
    { z: zf - 0.25, w: W / 2, yb: gc, yt: belt + 0.02, p: 9 },
    { z: zf, w: W / 2 - 0.1, yb: gc + 0.12, yt: belt - 0.08, p: 7 },
  ], { segments: 16 }), body));
  // cab
  const c0 = -0.25, c1 = zf - 1.45;
  parts.push(paint(loft([
    { z: c0, w: W / 2 - 0.08, yb: belt - 0.04, yt: H - 0.05, p: 8 },
    { z: c1 - 0.55, w: W / 2 - 0.1, yb: belt - 0.04, yt: H, p: 8 },
    { z: c1, w: W / 2 - 0.08, yb: belt - 0.04, yt: belt + 0.05, p: 8 },
  ], { segments: 12, tumble: 0.12 }), GLASS));
  parts.push(box(W - 0.22, 0.06, c1 - 0.55 - c0, 0, H + 0.01, (c1 - 0.55 + c0) / 2, body));
  // bed (open box)
  const b0 = zr + 0.1, b1 = c0 - 0.05;
  parts.push(box(W - 0.1, 0.05, b1 - b0, 0, belt - 0.5, (b0 + b1) / 2, 0x222222));
  parts.push(box(0.08, 0.5, b1 - b0, W / 2 - 0.05, belt - 0.25 + 0.02, (b0 + b1) / 2, body), box(0.08, 0.5, b1 - b0, -W / 2 + 0.05, belt - 0.25 + 0.02, (b0 + b1) / 2, body));
  parts.push(box(W - 0.1, 0.5, 0.08, 0, belt - 0.23, b0, body));
  const wr = 0.42, wb = o.wb ?? 3.6;
  for (const z of [-wb / 2 - 0.2, wb / 2 - 0.2]) for (const x of [-1, 1]) {
    const [t, r] = wheelGeo(wr, 0.3, 0x9a9da0);
    t.translate(x * (W / 2 - 0.18), wr, z); r.translate(x * (W / 2 - 0.18), wr, z); parts.push(t, r);
  }
  parts.push(box(W * 0.7, 0.42, 0.06, 0, belt - 0.32, zf - 0.02, o.grille ?? CHROME));
  parts.push(box(0.3, 0.14, 0.06, W * 0.36, belt - 0.12, zf - 0.03, 0xe8eef5, HEAD), box(0.3, 0.14, 0.06, -W * 0.36, belt - 0.12, zf - 0.03, 0xe8eef5, HEAD));
  parts.push(box(0.12, 0.35, 0.06, W / 2 - 0.08, belt - 0.25, zr + 0.01, 0x9a0f12, TAIL), box(0.12, 0.35, 0.06, -W / 2 + 0.08, belt - 0.25, zr + 0.01, 0x9a0f12, TAIL));
  parts.push(box(W, 0.18, 0.12, 0, gc + 0.12, zr, CHROME), box(W, 0.2, 0.12, 0, gc + 0.14, zf, TRIM));
  return parts;
}

function cybertruck() {
  const L = 5.68, W = 2.2, gc = 0.33, parts = [];
  // the famous single-crease profile: low nose, apex over the B-pillar, straight tonneau to the tail
  const prof = [[-L / 2, 1.2], [-L / 2 + 0.1, 1.25], [0.15, 1.9], [L / 2 - 0.05, 1.05], [L / 2, 0.85]];
  const st = prof.map(([z, yt]) => ({ z, w: W / 2, yb: gc, yt, p: 30 }));
  parts.push(paint(loft(st, { segments: 8, flat: true, tumble: 0.12 }), 0xb8bcc0));
  parts.push(paint(loft([{ z: -0.4, w: W / 2 - 0.15, yb: 1.4, yt: 1.86, p: 30 }, { z: 0.15, w: W / 2 - 0.14, yb: 1.5, yt: 1.92, p: 30 }, { z: 1.5, w: W / 2 - 0.14, yb: 1.18, yt: 1.42, p: 30 }], { segments: 8, flat: true }), GLASS));
  parts.push(box(W - 0.1, 0.05, 0.08, 0, 1.0, L / 2 - 0.08, 0xf2f6ff, HEAD));
  parts.push(box(W - 0.1, 0.05, 0.08, 0, 1.15, -L / 2 + 0.03, 0xa00f12, TAIL));
  for (const z of [-1.85, 1.85]) for (const x of [-1, 1]) { const [t, r] = wheelGeo(0.44, 0.32, 0x333333); t.translate(x * 0.92, 0.44, z); r.translate(x * 0.92, 0.44, z); parts.push(t, r); }
  return parts;
}

function boxy(o) { // vans, box trucks, buses
  const { L, W, H } = o, gc = o.gc ?? 0.3, parts = [], zf = L / 2, zr = -L / 2;
  const body = o.color ?? 0xffffff;
  parts.push(paint(loft([
    { z: zr, w: W / 2, yb: gc, yt: H, p: 14 },
    { z: zf - (o.nose ?? 0.9), w: W / 2, yb: gc, yt: H, p: 14 },
    { z: zf - 0.15, w: W / 2 - 0.04, yb: gc, yt: o.noseTop ?? H * 0.62, p: 9 },
    { z: zf, w: W / 2 - 0.12, yb: gc + 0.1, yt: (o.noseTop ?? H * 0.62) - 0.2, p: 7 },
  ], { segments: 16, tumble: 0.03, flat: true }), body));
  // windshield
  parts.push(paint(loft([
    { z: zf - (o.nose ?? 0.9) - 0.02, w: W / 2 - 0.06, yb: (o.noseTop ?? H * 0.62) - 0.05, yt: H - 0.15, p: 12 },
    { z: zf - (o.nose ?? 0.9) + 0.35, w: W / 2 - 0.08, yb: (o.noseTop ?? H * 0.62) - 0.05, yt: (o.noseTop ?? H * 0.62) + 0.05, p: 12 },
  ], { segments: 12, flat: true }), GLASS));
  if (o.windowBand) parts.push(box(W + 0.02, o.windowBand[1] - o.windowBand[0], L - (o.nose ?? 0.9) - 0.6, 0, (o.windowBand[0] + o.windowBand[1]) / 2, -0.3, GLASS));
  if (o.stripe) parts.push(box(W + 0.03, o.stripe[1] - o.stripe[0], L - 0.4, 0, (o.stripe[0] + o.stripe[1]) / 2, 0, o.stripe[2]));
  const wr = o.wr ?? 0.38;
  for (const z of o.axles) for (const x of [-1, 1]) { const [t, r] = wheelGeo(wr, 0.3, 0x8a8d90); t.translate(x * (W / 2 - 0.2), wr, z); r.translate(x * (W / 2 - 0.2), wr, z); parts.push(t, r); }
  parts.push(box(0.28, 0.12, 0.06, W * 0.35, gc + 0.55, zf - 0.02, 0xe8eef5, HEAD), box(0.28, 0.12, 0.06, -W * 0.35, gc + 0.55, zf - 0.02, 0xe8eef5, HEAD));
  parts.push(box(0.15, 0.3, 0.06, W / 2 - 0.12, gc + 0.6, zr - 0.01, 0x9a0f12, TAIL), box(0.15, 0.3, 0.06, -W / 2 + 0.12, gc + 0.6, zr - 0.01, 0x9a0f12, TAIL));
  if (o.extra) parts.push(...o.extra());
  return parts;
}

function semi(color) {
  const parts = [], W = 2.55;
  // tractor (conventional hood)
  parts.push(paint(loft([
    { z: 3.2, w: W / 2 - 0.05, yb: 0.55, yt: 3.5, p: 10 }, { z: 5.2, w: W / 2, yb: 0.55, yt: 3.5, p: 10 },
    { z: 5.5, w: W / 2 - 0.1, yb: 0.55, yt: 2.2, p: 8 }, { z: 7.5, w: W / 2 - 0.25, yb: 0.6, yt: 1.95, p: 6 }, { z: 7.9, w: W / 2 - 0.35, yb: 0.65, yt: 1.6, p: 5 },
  ], { segments: 14 }), color));
  parts.push(box(W - 0.3, 0.8, 0.1, 0, 2.6, 5.31, GLASS));
  parts.push(box(1.3, 1.1, 0.06, 0, 1.25, 7.9, CHROME));
  parts.push(box(0.35, 0.18, 0.06, 0.95, 1.1, 7.75, 0xe8eef5, HEAD), box(0.35, 0.18, 0.06, -0.95, 1.1, 7.75, 0xe8eef5, HEAD));
  for (const x of [-1, 1]) parts.push(paint(new THREE.CylinderGeometry(0.1, 0.1, 2.8, 8).translate(x * 1.2, 3.7, 3.3), CHROME));
  // trailer
  parts.push(box(W, 2.9, 15.6, 0, 2.65, -4.9, 0xe9e9e6));
  parts.push(box(W + 0.02, 0.25, 15.6, 0, 1.35, -4.9, 0x5a5d60));
  parts.push(box(0.2, 0.25, 0.06, 1.1, 1.0, -12.72, 0x9a0f12, TAIL), box(0.2, 0.25, 0.06, -1.1, 1.0, -12.72, 0x9a0f12, TAIL));
  for (const z of [7.0, 4.2, 2.9, -10.0, -11.3]) for (const x of [-1, 1]) { const [t, r] = wheelGeo(0.52, 0.55, 0xa0a0a0); t.translate(x * 0.95, 0.52, z); r.translate(x * 0.95, 0.52, z); parts.push(t, r); }
  return parts;
}

function lightBar(W, y, z) {
  return [box(W * 0.35, 0.1, 0.28, -W * 0.19, y, z, 0xcc1010, SIREN_R), box(W * 0.35, 0.1, 0.28, W * 0.19, y, z, 0x1030dd, SIREN_B), box(W * 0.75, 0.04, 0.3, 0, y - 0.06, z, 0x111111)];
}

// Vehicle catalogue -----------------------------------------------------------
export const CATALOG = [
  { id: 'sedan', names: ['Toyota Camry', 'Honda Accord', 'Hyundai Sonata', 'Nissan Altima'], L: 4.88, W: 1.84, H: 1.44, mass: 1550, weight: 10, build: (o) => passenger({ ...o, cabin: [-0.62, 0.32], rearRake: 0.5, frontRake: 0.75 }) },
  { id: 'model3', names: ['Tesla Model 3'], L: 4.72, W: 1.85, H: 1.44, mass: 1760, weight: 6, build: (o) => passenger({ ...o, belt: 0.86, hood: 0.78, trunk: 0.86, cabin: [-0.66, 0.5], rearRake: 0.75, frontRake: 0.95, roofColor: GLASS }) },
  { id: 'compact', names: ['Honda Civic', 'Toyota Corolla', 'Mazda3', 'Kia Forte'], L: 4.55, W: 1.8, H: 1.42, mass: 1350, weight: 9, build: (o) => passenger({ ...o, cabin: [-0.6, 0.34] }) },
  { id: 'hatch', names: ['Volkswagen Golf', 'Subaru Impreza', 'Mini Cooper', 'Chevrolet Bolt'], L: 4.25, W: 1.79, H: 1.48, mass: 1300, weight: 6, build: (o) => passenger({ ...o, cabin: [-0.9, 0.36], rearRake: 0.18, frontRake: 0.72, trunk: 0.95 }) },
  { id: 'suv', names: ['Toyota RAV4', 'Subaru Forester', 'Honda CR-V', 'Tesla Model Y', 'Ford Escape'], L: 4.65, W: 1.86, H: 1.7, mass: 1700, weight: 14, build: (o) => passenger({ ...o, gc: 0.22, belt: 1.02, hood: 0.98, trunk: 1.02, cabin: [-0.88, 0.38], rearRake: 0.25, frontRake: 0.7, wr: 0.36 }) },
  { id: 'bigsuv', names: ['Chevrolet Tahoe', 'Ford Expedition', 'GMC Yukon'], L: 5.35, W: 2.05, H: 1.93, mass: 2550, weight: 4, build: (o) => passenger({ ...o, gc: 0.26, belt: 1.15, hood: 1.12, trunk: 1.15, cabin: [-0.94, 0.4], rearRake: 0.12, frontRake: 0.65, wr: 0.4, tumble: 0.1 }) },
  { id: 'pickup', names: ['Ford F-150', 'Ram 1500', 'Chevrolet Silverado', 'Toyota Tacoma'], L: 5.9, W: 2.03, H: 1.95, mass: 2300, weight: 9, build: (o) => pickup(o) },
  { id: 'cybertruck', names: ['Tesla Cybertruck'], L: 5.68, W: 2.2, H: 1.92, mass: 3100, weight: 2, fixedColor: true, build: () => cybertruck() },
  { id: 'minivan', names: ['Honda Odyssey', 'Toyota Sienna', 'Chrysler Pacifica'], L: 5.16, W: 1.99, H: 1.78, mass: 2050, weight: 4, build: (o) => passenger({ ...o, gc: 0.18, belt: 1.0, hood: 0.92, trunk: 1.0, cabin: [-0.95, 0.5], rearRake: 0.1, frontRake: 0.85, tumble: 0.12 }) },
  { id: 'sports', names: ['Porsche 911', 'Chevrolet Corvette', 'BMW M4', 'Ford Mustang'], L: 4.52, W: 1.9, H: 1.27, mass: 1550, weight: 3, build: (o) => passenger({ ...o, gc: 0.12, belt: 0.74, hood: 0.66, trunk: 0.76, cabin: [-0.55, 0.35], rearRake: 0.8, frontRake: 0.75, wr: 0.34 }) },
  { id: 'jeep', names: ['Jeep Wrangler', 'Ford Bronco'], L: 4.4, W: 1.9, H: 1.85, mass: 2000, weight: 3, build: (o) => passenger({ ...o, gc: 0.3, belt: 1.12, hood: 1.08, trunk: 1.12, cabin: [-0.98, 0.3], rearRake: 0.05, frontRake: 0.2, wr: 0.42, tumble: 0.02, rim: 0x333333 }) },
  { id: 'van', names: ['Ford Transit', 'Mercedes-Benz Sprinter', 'Ram ProMaster'], L: 5.9, W: 2.05, H: 2.6, mass: 2600, weight: 5, build: (o) => boxy({ ...o, nose: 1.0, noseTop: 1.25, axles: [-1.8, 1.8], gc: 0.25 }) },
  { id: 'boxtruck', names: ['Isuzu NPR box truck', 'Hino 268 box truck'], L: 7.6, W: 2.4, H: 3.5, mass: 7500, weight: 3, fixedColor: true, build: () => boxy({ L: 7.6, W: 2.4, H: 3.5, color: 0xf0f0ee, nose: 2.0, noseTop: 2.6, axles: [-2.3, 2.4], wr: 0.45, gc: 0.45, extra: () => [box(2.38, 2.0, 0.1, 0, 2.3, 1.75, GLASS)] }) },
  { id: 'semi', names: ['Freightliner Cascadia', 'Peterbilt 579', 'Kenworth T680', 'Volvo VNL'], L: 20.8, W: 2.6, H: 4.1, mass: 30000, weight: 4, fixedColor: true, zOffset: 2.4, variants: [0xb01818, 0x1d3f8c, 0xe9e9e6, 0x1c1c1c, 0x2f6b39], build: (o) => semi(o.color) },
  { id: 'bus', names: ['King County Metro bus', 'Sound Transit Express bus', 'Community Transit bus'], L: 12.2, W: 2.6, H: 3.25, mass: 13500, weight: 2, fixedColor: true, build: () => boxy({ L: 12.2, W: 2.6, H: 3.25, color: 0xf2f0e8, nose: 0.4, noseTop: 2.9, axles: [-3.5, 3.9], wr: 0.5, gc: 0.35, windowBand: [1.45, 2.65], stripe: [0.6, 0.95, 0x0f7f73], extra: () => [box(2.0, 0.35, 0.06, 0, 2.95, 6.1, 0x111111, AMBER)] }) },
];

export const POLICE = [
  { id: 'police_suv', names: ['WSP Ford Police Interceptor Utility'], L: 5.05, W: 2.0, H: 1.78, mass: 2250, fixedColor: true, police: true,
    build: () => passenger({ L: 5.05, W: 2.0, H: 1.78, color: 0x1b2a4a, roofColor: 0x1b2a4a, gc: 0.2, belt: 1.03, hood: 0.98, trunk: 1.03, cabin: [-0.88, 0.38], rearRake: 0.25, frontRake: 0.7, wr: 0.37, rim: 0x222222,
      extra: ({ W, top }) => [...lightBar(W, top + 0.08, 0.05), box(W + 0.02, 0.1, 3.6, 0, 0.75, -0.1, 0xd9d9d9), box(0.9, 0.35, 0.08, 0, 0.55, 2.55, 0x0b0b0b)] }) },
  { id: 'police_sedan', names: ['SPD Dodge Charger Pursuit'], L: 5.1, W: 1.91, H: 1.48, mass: 1950, fixedColor: true, police: true,
    build: () => passenger({ L: 5.1, W: 1.91, H: 1.48, color: 0x101010, roofColor: 0xf0f0f0, cabin: [-0.6, 0.3], rearRake: 0.55, frontRake: 0.75, rim: 0x222222,
      extra: ({ W, top, belt }) => [...lightBar(W, top + 0.08, 0.0), box(W + 0.02, belt - 0.42, 1.9, 0, (belt + 0.42) / 2 + 0.03, 0.1, 0xf0f0f0), box(0.9, 0.3, 0.08, 0, 0.5, 2.57, 0x0b0b0b)] }) },
];

export const EMIT = { HEAD, TAIL, SIREN_R, SIREN_B, AMBER };

export function buildCatalogGeometry(entry, color) {
  const parts = entry.build({ L: entry.L, W: entry.W, H: entry.H, color });
  const g = mergeParts(parts);
  if (entry.zOffset) g.translate(0, 0, entry.zOffset);
  return g;
}

// Instanced material for traffic: vertex colours * instance colour, emissive lights driven by
// per-instance brake / headlight / siren attributes.
export function makeTrafficMaterial(uniforms) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEmit; attribute vec3 iState; varying float vEmit; varying vec3 vState;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = aEmit; vState = iState;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; uniform float uTime; varying float vEmit; varying vec3 vState;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float e = floor(vEmit + 0.5);
        // vState: x = brake, y = siren on, z = phase
        if (e == 1.0) totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * (0.15 + uNight * 4.0);
        if (e == 2.0) totalEmissiveRadiance += vec3(1.0, 0.05, 0.03) * (0.2 + uNight * 1.6 + vState.x * 5.0);
        float ph = fract(uTime * 2.2 + vState.z);
        if (e == 3.0) totalEmissiveRadiance += vec3(1.0, 0.05, 0.05) * vState.y * step(0.5, ph) * 9.0;
        if (e == 4.0) totalEmissiveRadiance += vec3(0.1, 0.25, 1.0) * vState.y * step(ph, 0.5) * 9.0;
        if (e == 5.0) totalEmissiveRadiance += vec3(1.0, 0.6, 0.1) * (0.3 + uNight * 2.0);
        // body tint should not affect glass / tyres / lights much
        `);
  };
  return m;
}
