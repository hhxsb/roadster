import * as THREE from 'three';
import { mergeGeoms } from './roads.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const TILE = 500;

function colorize(geo, color) {
  const c = new THREE.Color(color), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // darker towards the bottom of the crown for fake self-shadowing
    const y = geo.attributes.position.array[i * 3 + 1];
    const k = 0.75 + 0.25 * Math.min(1, Math.max(0, (y - 2) / 10));
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function jitter(geo, amt, seed) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const q = geo.attributes.position;
  for (let i = 0; i < q.count; i++) q.setXYZ(i, q.getX(i) + r() * amt, q.getY(i) + r() * amt, q.getZ(i) + r() * amt);
  geo.computeVertexNormals();
  return geo;
}
function mergeColored(list) {
  const g = mergeGeoms(list);
  let n = 0; for (const x of list) n += x.attributes.position.count;
  const col = new Float32Array(n * 3); let o = 0;
  for (const x of list) { col.set(x.attributes.color.array, o); o += x.attributes.color.array.length; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function treeGeometries() {
  const trunk = (h, r) => colorize(new THREE.CylinderGeometry(r * 0.7, r, h, 6).translate(0, h / 2, 0), 0x4a3a2c);
  // Douglas fir / western red cedar
  const fir = mergeColored([
    trunk(4, 0.35),
    colorize(new THREE.ConeGeometry(3.0, 6.5, 10, 1).translate(0, 6, 0), 0x22381f),
    colorize(new THREE.ConeGeometry(2.5, 6, 10, 1).translate(0, 9.5, 0), 0x263f22),
    colorize(new THREE.ConeGeometry(1.9, 5.5, 9, 1).translate(0, 12.8, 0), 0x2b4626),
    colorize(new THREE.ConeGeometry(1.2, 4.5, 8, 1).translate(0, 15.8, 0), 0x2f4c29),
  ]);
  // broadleaf maple
  const crown = [];
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7, r = 2.4 + (k % 2) * 0.6;
    crown.push(colorize(jitter(new THREE.IcosahedronGeometry(r, 2).translate(Math.cos(a) * 1.4, 6.5 + (k % 3) * 0.9, Math.sin(a) * 1.4), 0.18, 11 + k), 0x42602c));
  }
  const maple = mergeColored([trunk(5, 0.3), ...crown]);
  const small = mergeColored([trunk(2.2, 0.15), colorize(jitter(new THREE.IcosahedronGeometry(1.6, 2).translate(0, 3.2, 0), 0.1, 21), 0x4f6a30)]);
  return [fir, maple, small];
}

export class Vegetation {
  constructor(world, quality) {
    this.group = new THREE.Group();
    this.drawDist = quality.treeDist;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const geos = treeGeometries();
    const T = world.trees;
    const tiles = new Map();
    for (let i = 0; i < T.length; i += 3) {
      const x = T[i] / 2, z = T[i + 1] / 2, type = T[i + 2];
      const key = Math.floor(x / TILE) + ',' + Math.floor(z / TILE);
      let t = tiles.get(key); if (!t) tiles.set(key, (t = [[], [], []]));
      t[type].push(x, z);
    }
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [key, t] of tiles) {
      const [tx, tz] = key.split(',').map(Number);
      const grp = new THREE.Group();
      grp.userData.center = new THREE.Vector3((tx + 0.5) * TILE, 0, (tz + 0.5) * TILE);
      for (let type = 0; type < 3; type++) {
        const arr = t[type];
        if (!arr.length) continue;
        const im = new THREE.InstancedMesh(geos[type], this.mat, arr.length / 2);
        for (let k = 0; k < arr.length; k += 2) {
          const x = arr[k], z = arr[k + 1];
          const s = type === 0 ? 0.75 + rnd() * 0.75 : type === 1 ? 0.7 + rnd() * 0.5 : 0.8 + rnd() * 0.4;
          e.set(0, rnd() * 6.28, 0); q.setFromEuler(e);
          v.set(x, world.heightAt(x, z) - 0.2, z); sc.set(s, s * (0.9 + rnd() * 0.25), s);
          M.compose(v, q, sc); im.setMatrixAt(k / 2, M);
          c.setRGB(0.8 + rnd() * 0.3, 0.85 + rnd() * 0.25, 0.75 + rnd() * 0.3); im.setColorAt(k / 2, c);
        }
        im.castShadow = true; im.receiveShadow = true;
        im.computeBoundingSphere();
        grp.add(im);
      }
      this.group.add(grp);
    }
  }
  update(camPos) {
    const d2 = this.drawDist * this.drawDist;
    for (const g of this.group.children) {
      const c = g.userData.center, dx = c.x - camPos.x, dz = c.z - camPos.z;
      g.visible = dx * dx + dz * dz < d2;
    }
  }
}
