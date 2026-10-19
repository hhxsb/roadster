// Samples terrarium tiles into an elevation function (metres).
import fs from 'node:fs';
import { decodePNG } from './png.mjs';
const Z = 13, tiles = new Map();
function tile(x, y) {
  const k = x + '_' + y;
  if (!tiles.has(k)) tiles.set(k, decodePNG(fs.readFileSync(`rawdata/dem/${Z}_${x}_${y}.png`)));
  return tiles.get(k);
}
function px(gx, gy) {
  const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  const t = tile(tx, ty), ix = gx - tx * 256, iy = gy - ty * 256, o = (iy * 256 + ix) * t.bpp;
  return t.data[o] * 256 + t.data[o + 1] + t.data[o + 2] / 256 - 32768;
}
export function elevation(lat, lon) {
  const n = 2 ** Z;
  const fx = ((lon + 180) / 360) * n * 256 - 0.5;
  const r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256 - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  return (px(x0, y0) * (1 - ax) + px(x0 + 1, y0) * ax) * (1 - ay) + (px(x0, y0 + 1) * (1 - ax) + px(x0 + 1, y0 + 1) * ax) * ay;
}
