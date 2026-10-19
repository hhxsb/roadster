// Downloads OSM layers needed by build_world.mjs into rawdata/.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { unproject, BBOX } from './geo.mjs';

function overpass(query, file) {
  if (fs.existsSync(file) && process.argv.indexOf('--force') < 0) { console.log('skip', file); return; }
  console.log('fetch', file);
  execFileSync('curl', ['-s', '-m', '600', '-A', 'roadster-game-builder/1.0', '--data-urlencode', 'data=' + query,
    'https://overpass-api.de/api/interpreter', '-o', file], { stdio: 'inherit' });
  const txt = fs.readFileSync(file, 'utf8');
  if (!txt.startsWith('{')) throw new Error('overpass error for ' + file + ': ' + txt.slice(0, 400));
  console.log('  ', (txt.length / 1e6).toFixed(1), 'MB', JSON.parse(txt).elements.length, 'elements');
}

const legs = JSON.parse(fs.readFileSync('rawdata/legs.json', 'utf8'));
const poly = [];
for (const k in legs) {
  let acc = 1e9, prev = null;
  for (const p of legs[k]) {
    if (prev) acc += Math.hypot(p.x - prev.x, p.n - prev.n);
    prev = p;
    if (acc > 120) { acc = 0; const [la, lo] = unproject(p.x, p.n); poly.push(la.toFixed(5), lo.toFixed(5)); }
  }
}
const bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
const B = '["building"]', P = '["building:part"]';
const SEA = '47.585,-122.350,47.632,-122.312', BEL = '47.603,-122.212,47.628,-122.180', SLU = '47.615,-122.350,47.650,-122.305';
overpass(`[out:json][timeout:500];(way${B}(${SEA});way${P}(${SEA});relation${B}(${SEA});way${B}(${SLU});way${P}(${SLU}););out geom tags;`, 'rawdata/bld_seattle.json');
overpass(`[out:json][timeout:500];(way${B}(${BEL});way${P}(${BEL});relation${B}(${BEL}););out geom tags;`, 'rawdata/bld_bellevue.json');
overpass(`[out:json][timeout:500];(way${B}(around:550,${poly.join(',')}););out geom tags;`, 'rawdata/bld_corridor.json');
overpass(`[out:json][timeout:300];(way["natural"="water"](${bb});relation["natural"="water"](${bb});way["natural"="coastline"](${bb});way["waterway"="riverbank"](${bb}););out geom tags;`, 'rawdata/water.json');
overpass(`[out:json][timeout:300];(way["leisure"~"^(park|golf_course|pitch)$"](${bb});way["landuse"~"^(grass|forest|cemetery|meadow|recreation_ground)$"](${bb});way["natural"~"^(wood|scrub)$"](${bb});relation["leisure"="park"](${bb});relation["natural"="wood"](${bb}););out geom tags;`, 'rawdata/green.json');
overpass(`[out:json][timeout:300];(way["highway"~"^(trunk|primary|secondary|tertiary|residential|unclassified|motorway_link|trunk_link|primary_link|service)$"](${bb}););out geom tags;`, 'rawdata/streets.json');
