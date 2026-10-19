import * as THREE from 'three';

const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _vo = new THREE.Vector3(), _vp = new THREE.Vector3();

// 2D oriented-box overlap (x,z). Boxes: {x, z, yaw, hw, hl}. Returns {depth, nx, nz} (normal from b to a) or null.
export function obbOverlap(a, b) {
  const axes = [[Math.sin(a.yaw), Math.cos(a.yaw)], [Math.cos(a.yaw), -Math.sin(a.yaw)], [Math.sin(b.yaw), Math.cos(b.yaw)], [Math.cos(b.yaw), -Math.sin(b.yaw)]];
  const dx = a.x - b.x, dz = a.z - b.z;
  let best = Infinity, bn = null;
  const proj = (box, ax) => {
    const f = [Math.sin(box.yaw), Math.cos(box.yaw)], l = [Math.cos(box.yaw), -Math.sin(box.yaw)];
    return Math.abs(f[0] * ax[0] + f[1] * ax[1]) * box.hl + Math.abs(l[0] * ax[0] + l[1] * ax[1]) * box.hw;
  };
  for (const ax of axes) {
    const d = dx * ax[0] + dz * ax[1];
    const o = proj(a, ax) + proj(b, ax) - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; bn = d >= 0 ? ax : [-ax[0], -ax[1]]; }
  }
  return { depth: best, nx: bn[0], nz: bn[1] };
}

// Player (RoadsterPhysics) vs another vehicle {pos, y, yaw, len, wid, hgt, mass, vel}.
// Applies the impulse to the player and returns the result for the other body.
export function collidePlayer(phys, other, restitution = 0.25) {
  const fwd = phys.forward(_p);
  const pyaw = Math.atan2(fwd.x, fwd.z);
  const a = { x: phys.pos.x, z: phys.pos.z, yaw: pyaw, hw: 1.0, hl: 2.16 };
  const b = { x: other.pos.x, z: other.pos.z, yaw: other.yaw, hw: other.wid / 2, hl: other.len / 2 };
  // quick reject
  const r = 2.4 + Math.hypot(b.hw, b.hl);
  if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > r * r) return null;
  const pBottom = phys.pos.y - 0.3, pTop = phys.pos.y + 0.75, oBottom = other.y, oTop = other.y + other.hgt;
  if (pBottom > oTop || pTop < oBottom) return null;
  const ov = obbOverlap(a, b);
  if (!ov) return null;
  let roof = false;
  if (pBottom > oTop - 0.45 && phys.vel.y < 1) { roof = true; _n.set(0, 1, 0); ov.depth = oTop - pBottom; }
  else _n.set(ov.nx, 0, ov.nz);
  // contact point: player's support point towards the other body
  const cp = new THREE.Vector3(phys.pos.x - _n.x * 1.2, roof ? pBottom : phys.pos.y + 0.1, phys.pos.z - _n.z * 1.2);
  phys.pointVelocity(cp, _vp);
  _vo.copy(other.vel || _vo.set(0, 0, 0));
  const vrel = _vp.sub(_vo);
  const vn = vrel.dot(_n);
  // positional correction (heavier body moves less)
  const share = other.mass / (other.mass + phys.mass);
  phys.pos.addScaledVector(_n, Math.min(ov.depth, 1.5) * (roof ? 1 : share));
  if (vn >= 0) return { depth: ov.depth, n: _n.clone(), j: 0, dvPlayer: 0, roof, push: Math.min(ov.depth, 1.5) * (1 - share) };
  const k = 1 / phys.mass + 1 / other.mass;
  const j = (-(1 + restitution) * vn) / k;
  const J = _n.clone().multiplyScalar(j);
  // tangential friction
  const vt = vrel.clone().addScaledVector(_n, -vn);
  if (vt.lengthSq() > 0.01) J.addScaledVector(vt.normalize(), -Math.min(0.3 * j, vt.length() * phys.mass * 0.3));
  phys.applyImpulse(cp, J);
  return { depth: ov.depth, n: _n.clone(), j, dvPlayer: j / phys.mass, dvOther: j / other.mass, roof, relSpeed: -vn, push: Math.min(ov.depth, 1.5) * (1 - share), point: cp };
}
