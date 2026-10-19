// Tunnel cross-section shared by rendering and physics.
// Each bore is a counter-clockwise polygon in the route's (offset, height) plane with
// chamfered floor and ceiling corners, so a car with suction fans can roll from the
// floor onto the walls and across the ceiling.
import { KIND } from '../data.js';

export const TUNNEL_H = 7.4;
const FLOOR_CHAMFER = 1.1, ROOF_CHAMFER = 1.4;

export function tunnelBores(cs) {
  const split = cs.medianCenter, L = cs.left - 0.6, R = cs.right + 0.6;
  const bore = (A, B) => [
    [A + FLOOR_CHAMFER, 0], [B - FLOOR_CHAMFER, 0], [B, FLOOR_CHAMFER], [B, TUNNEL_H - ROOF_CHAMFER],
    [B - ROOF_CHAMFER, TUNNEL_H], [A + ROOF_CHAMFER, TUNNEL_H], [A, TUNNEL_H - ROOF_CHAMFER], [A, FLOOR_CHAMFER],
  ];
  const mk = (poly) => {
    const edges = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
      edges.push({ p, q, dx, dy, len, nx: -dy / len, ny: dx / len }); // inward normal (CCW polygon)
    }
    return { poly, edges };
  };
  return { split, ours: mk(bore(split + 0.45, R)), opp: mk(bore(L, split - 0.45)) };
}

// Signed distance from (o,h) to the bore boundary (positive inside) and nearest edge.
export function boreDistance(bore, o, h) {
  let best = Infinity, edge = null, inside = true;
  for (const e of bore.edges) {
    const t = Math.max(0, Math.min(1, ((o - e.p[0]) * e.dx + (h - e.p[1]) * e.dy) / (e.len * e.len)));
    const d = Math.hypot(o - (e.p[0] + e.dx * t), h - (e.p[1] + e.dy * t));
    if ((o - e.p[0]) * e.nx + (h - e.p[1]) * e.ny < 0) inside = false;
    if (d < best) { best = d; edge = e; }
  }
  return { d: inside ? best : -best, edge };
}

// Ray (o,h) + t*(do,dh) from inside the bore: first wall hit.
export function boreRay(bore, o, h, dO, dH) {
  let bt = Infinity, be = null;
  for (const e of bore.edges) {
    const den = dO * e.nx + dH * e.ny;
    if (den >= -1e-6) continue; // moving away from this wall
    // solve (o,h) + t*d = p + u*(q-p)
    const cross = dO * e.dy - dH * e.dx;
    if (Math.abs(cross) < 1e-9) continue;
    const wx = e.p[0] - o, wy = e.p[1] - h;
    const t = (wx * e.dy - wy * e.dx) / cross, u = (wx * dH - wy * dO) / cross;
    if (t > -0.3 && u >= -0.02 && u <= 1.02 && t < bt) { bt = t; be = e; }
  }
  return be ? { t: bt, edge: be } : null;
}

// Local tunnel frame around a world position, or null when not inside a tunnel.
export function tunnelContext(world, pos, out = {}) {
  const ra = world.roadAt(pos.x, pos.z, pos.y, _ra);
  if (!ra || ra.dist > 40) return null;
  const r = ra.route, i = Math.floor(r.index(ra.s));
  if (r.kind[i] !== KIND.TUNNEL) return null;
  const f = r.frame(ra.s, out.f || (out.f = {}));
  const h = pos.y - f.y;
  const bores = world.tunnelBores;
  if (h < -1.5 || h > 9 || ra.offset < world.cs.left - 1 || ra.offset > world.cs.right + 1) return null;
  out.route = r; out.s = ra.s; out.grade = f.grade;
  out.bore = ra.offset > bores.split ? bores.ours : bores.opp;
  out.rx = f.rx; out.rz = f.rz; out.tx = f.tx; out.tz = f.tz; out.x = f.x; out.y = f.y; out.z = f.z;
  return out;
}

export function toLocal(ctx, p) {
  const dx = p.x - ctx.x, dz = p.z - ctx.z;
  const along = dx * ctx.tx + dz * ctx.tz;
  return [dx * ctx.rx + dz * ctx.rz, p.y - (ctx.y + ctx.grade * along)];
}
export function dirToLocal(ctx, d) {
  return [d.x * ctx.rx + d.z * ctx.rz, d.y - ctx.grade * (d.x * ctx.tx + d.z * ctx.tz)];
}
// local normal (no, nh) -> world normal
export function normalToWorld(ctx, no, nh, out) {
  out.set(ctx.rx * no, nh, ctx.rz * no);
  return out.normalize();
}
const _ra = {};
