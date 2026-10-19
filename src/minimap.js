import { LC } from './data.js';

export class Minimap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    const g = world.grid;
    const S = 1; // cells per pixel (10 m/px)
    const W = Math.floor(g.nx / S), H = Math.floor(g.nz / S);
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const c = off.getContext('2d');
    const img = c.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const l = world.land[y * S * g.nx + x * S];
      const col = l === LC.LAKE || l === LC.SEA ? [28, 58, 92] : l === LC.PARK || l === LC.FOREST || l === LC.GOLF ? [34, 52, 38] : l === LC.BUILDING ? [58, 60, 66] : l === LC.STREET ? [70, 72, 78] : [40, 42, 46];
      img.data.set([...col, 255], (y * W + x) * 4);
    }
    c.putImageData(img, 0, 0);
    const px = (v) => (v - g.x0) / (g.cell * S), pz = (v) => (v - g.z0) / (g.cell * S);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const r of world.stubs) {
      c.beginPath();
      for (let i = 0; i < r.n; i += 4) { const X = px(r.x[i]), Z = pz(r.z[i]); if (!i) c.moveTo(X, Z); else c.lineTo(X, Z); }
      c.strokeStyle = '#7d828c'; c.lineWidth = 3; c.stroke();
    }
    const L = world.loop;
    c.beginPath();
    for (let i = 0; i <= L.n; i += 4) { const k = i % L.n; const X = px(L.x[k]), Z = pz(L.z[k]); if (!i) c.moveTo(X, Z); else c.lineTo(X, Z); }
    c.closePath();
    c.strokeStyle = '#0b0d10'; c.lineWidth = 7; c.stroke();
    c.strokeStyle = '#3e9bff'; c.lineWidth = 4; c.stroke();
    this.off = off; this.px = px; this.pz = pz;
    this.zoom = 2.2;
  }

  draw(player, heading, dots, checkpoints, nextCp) {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.save();
    ctx.fillStyle = '#16181c'; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H * 0.6);
    ctx.rotate(-heading);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.px(player.x), -this.pz(player.z));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.off, 0, 0);
    const r = 3.2 / this.zoom * 2;
    // checkpoints
    checkpoints.forEach((cp, i) => {
      if (i < nextCp) return;
      ctx.beginPath(); ctx.arc(this.px(cp.x), this.pz(cp.z), r * (i === nextCp ? 2 : 1.3), 0, Math.PI * 2);
      ctx.fillStyle = i === checkpoints.length - 1 ? '#ffffff' : i === nextCp ? '#ffd23e' : 'rgba(255,210,62,0.5)'; ctx.fill();
    });
    for (const d of dots) {
      ctx.beginPath(); ctx.arc(this.px(d.x), this.pz(d.z), r * (d.big ? 1.6 : 1), 0, Math.PI * 2);
      ctx.fillStyle = d.color; ctx.fill();
    }
    ctx.restore();
    // player arrow (always pointing up)
    ctx.save();
    ctx.translate(W / 2, H * 0.6);
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 12); ctx.lineTo(0, 6); ctx.lineTo(-10, 12); ctx.closePath();
    ctx.fillStyle = '#e82127'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.fill(); ctx.stroke();
    ctx.restore();
    // north marker
    ctx.save();
    ctx.translate(W - 26, 26); ctx.rotate(-heading);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -10);
    ctx.restore();
  }
}
