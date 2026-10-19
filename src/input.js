// Keyboard + gamepad input with smoothing for digital keys.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.state = { throttle: 0, brake: 0, steer: 0, boost: 0, lift: 0, descend: 0, handbrake: false, land: false };
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code); this.pressed.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.padPrev = {};
    this.touchSteer = null; // analog steering from the touch pad (TouchControls)
  }
  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  // returns true once per key press
  hit(code) { if (this.pressed.has(code)) { this.pressed.delete(code); return true; } return false; }
  endFrame() { this.pressed.clear(); }

  update(dt) {
    const s = this.state, k = this;
    const thr = k.down('KeyW', 'ArrowUp') ? 1 : 0, brk = k.down('KeyS', 'ArrowDown') ? 1 : 0;
    const st = (k.down('KeyD', 'ArrowRight') ? 1 : 0) - (k.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const ramp = (cur, tgt, up, dn) => (tgt > cur ? Math.min(tgt, cur + up * dt) : Math.max(tgt, cur - dn * dt));
    s.throttle = ramp(s.throttle, thr, 4, 6);
    s.brake = ramp(s.brake, brk, 5, 8);
    // steering: turn in progressively, return to centre (or swap sides) quickly
    const toward = (cur, tgt, rate) => (cur < tgt ? Math.min(tgt, cur + rate * dt) : Math.max(tgt, cur - rate * dt));
    if (st === 0) s.steer = toward(s.steer, 0, 6);
    else if (s.steer !== 0 && Math.sign(st) !== Math.sign(s.steer)) s.steer = toward(s.steer, 0, 9);
    else s.steer = toward(s.steer, st, 3.4);
    if (this.touchSteer !== null) s.steer = this.touchSteer;
    s.boost = k.down('ShiftLeft', 'ShiftRight') ? 1 : 0;
    s.lift = k.down('Space') ? 1 : 0;
    s.descend = k.down('KeyC', 'ControlLeft', 'ControlRight') ? 1 : 0;
    s.handbrake = k.down('KeyX');
    s.land = false;
    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) s.steer = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.6;
      const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
      if (rt > 0.05) s.throttle = rt;
      if (lt > 0.05) s.brake = lt;
      if (p.buttons[0]?.pressed) s.lift = 1;          // A
      if (p.buttons[1]?.pressed) s.handbrake = true;  // B
      if (p.buttons[2]?.pressed) s.boost = 1;         // X
      if (p.buttons[3]?.pressed) s.descend = 1;       // Y
      const edge = (i, code) => { const b = !!p.buttons[i]?.pressed; if (b && !this.padPrev[i]) this.pressed.add(code); this.padPrev[i] = b; };
      edge(9, 'Escape'); edge(5, 'KeyL'); edge(4, 'KeyV'); edge(8, 'KeyR'); edge(12, 'KeyF');
    }
    return s;
  }
}
