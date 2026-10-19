// Shared geographic helpers for the offline data pipeline.
// Local frame: origin at ORIGIN, x = metres east, n = metres north.
export const ORIGIN = { lat: 47.615, lon: -122.26 };
export const BBOX = { s: 47.555, w: -122.375, n: 47.675, e: -122.145 };
const R = 6378137;
const cosLat = Math.cos((ORIGIN.lat * Math.PI) / 180);

export function project(lat, lon) {
  return [
    ((lon - ORIGIN.lon) * Math.PI / 180) * R * cosLat,
    ((lat - ORIGIN.lat) * Math.PI / 180) * R,
  ];
}
export function unproject(x, n) {
  return [ORIGIN.lat + (n / R) * 180 / Math.PI, ORIGIN.lon + (x / (R * cosLat)) * 180 / Math.PI];
}
