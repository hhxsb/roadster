// Extracts directed centrelines for each freeway leg of the loop from OSM data
// and writes rawdata/legs.json (consumed by build_world.mjs).
import fs from 'node:fs';
import { project } from './geo.mjs';

const data = JSON.parse(fs.readFileSync('rawdata/motorways.json', 'utf8'));

// Legs in driving order. start/end are approximate lat/lon anchors.
const LEGS = [
  { id: 'i5', ref: /^I 5$/, start: [47.6585, -122.3225], end: [47.5800, -122.3215] },
  { id: 'i90', ref: /^I 90$/, start: [47.5935, -122.3200], end: [47.5800, -122.1650] },
  { id: 'i405', ref: /^(I 405|I-405 Express Toll Lanes)$/, start: [47.5650, -122.1850], end: [47.6500, -122.1870] },
  { id: 'sr520', ref: /^SR 520$/, start: [47.6300, -122.1700], end: [47.6429, -122.3168] },
];

function buildGraph(refRe) {
  const nodes = new Map(); // id -> {x,n,out:[{to,len,wayIdx}]}
  const ways = [];
  for (const e of data.elements) {
    if (e.type !== 'way' || e.tags.highway !== 'motorway') continue;
    if (!refRe.test(e.tags.ref || '')) continue;
    const wi = ways.length;
    ways.push(e.tags);
    const ow = e.tags.oneway === 'no' ? 0 : e.tags.oneway === '-1' ? -1 : 1;
    const pts = e.geometry.map((g) => project(g.lat, g.lon));
    const ids = e.geometry.map((g) => g.lat.toFixed(7) + ',' + g.lon.toFixed(7));
    ids.forEach((id, i) => {
      if (!nodes.has(id)) nodes.set(id, { id, x: pts[i][0], n: pts[i][1], out: [] });
    });
    for (let i = 0; i + 1 < ids.length; i++) {
      const a = nodes.get(ids[i]), b = nodes.get(ids[i + 1]);
      const len = Math.hypot(b.x - a.x, b.n - a.n);
      if (ow >= 0) a.out.push({ to: b.id, len, wi });
      if (ow <= 0) b.out.push({ to: a.id, len, wi });
    }
  }
  return { nodes, ways };
}

function route(leg) {
  const { nodes, ways } = buildGraph(leg.ref);
  const [sx, sn] = project(...leg.start), [ex, en] = project(...leg.end);
  const dist = new Map(), prev = new Map();
  const open = [];
  for (const nd of nodes.values()) {
    if (Math.hypot(nd.x - sx, nd.n - sn) < 250) { dist.set(nd.id, Math.hypot(nd.x - sx, nd.n - sn)); open.push(nd.id); }
  }
  const done = new Set();
  while (open.length) {
    open.sort((a, b) => dist.get(a) - dist.get(b));
    const u = open.shift();
    if (done.has(u)) continue;
    done.add(u);
    for (const ed of nodes.get(u).out) {
      const d = dist.get(u) + ed.len;
      if (d < (dist.get(ed.to) ?? Infinity)) { dist.set(ed.to, d); prev.set(ed.to, { from: u, wi: ed.wi }); open.push(ed.to); }
    }
  }
  let best = null, bestD = Infinity;
  for (const nd of nodes.values()) {
    const de = Math.hypot(nd.x - ex, nd.n - en);
    if (de < 250 && dist.has(nd.id) && dist.get(nd.id) + de < bestD) { bestD = dist.get(nd.id) + de; best = nd.id; }
  }
  if (best == null) throw new Error('no route for ' + leg.id);
  const out = [];
  let cur = best;
  while (cur != null) {
    const nd = nodes.get(cur), p = prev.get(cur);
    const t = p ? ways[p.wi] : out.length ? out[out.length - 1].tags : {};
    out.push({ x: nd.x, n: nd.n, tags: t });
    cur = p ? p.from : null;
  }
  out.reverse();
  // tags on a point describe the segment arriving at it; shift to the departing segment
  for (let i = 0; i + 1 < out.length; i++) out[i].tags = out[i + 1].tags;
  return out.map((p) => ({
    x: +p.x.toFixed(2), n: +p.n.toFixed(2),
    lanes: +(p.tags.lanes || 3),
    bridge: p.tags.bridge || null,
    floating: p.tags['bridge:structure'] === 'floating',
    tunnel: p.tags.tunnel || null,
    layer: +(p.tags.layer || 0),
    maxspeed: parseInt(p.tags.maxspeed || '60'),
    name: p.tags['bridge:name'] || p.tags.tunnel_name || p.tags['tunnel:name'] || p.tags.name || null,
  }));
}

const legs = {};
for (const leg of LEGS) {
  const pts = route(leg);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].n - pts[i - 1].n);
  console.log(leg.id, pts.length, 'pts', (len / 1000).toFixed(2), 'km',
    'floating', pts.filter((p) => p.floating).length, 'tunnel', pts.filter((p) => p.tunnel).length);
  legs[leg.id] = pts;
}
fs.writeFileSync('rawdata/legs.json', JSON.stringify(legs));
