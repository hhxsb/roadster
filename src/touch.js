// On-screen controls for touch devices. Buttons feed the same key codes as the keyboard
// (held buttons -> Input.keys, taps -> Input.pressed); the steering pad sets an analog value.

export const isTouch = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

const HOLD = [
  ['t-down', 'KeyC', 'Down'],
  ['t-lift', 'Space', 'Lift'],
  ['t-boost', 'ShiftLeft', 'Boost'],
  ['t-land', null, 'Land'],
  ['t-brake', 'KeyS', 'Brake'],
  ['t-gas', 'KeyW', 'Gas'],
];
const TAPS = [
  ['t-pause', 'Escape', 'II', 'Pause'],
  ['t-cam', 'KeyV', 'CAM', 'Camera'],
  ['t-fans', 'KeyF', 'FANS', 'Suction fans'],
  ['t-reset', 'KeyR', '↺', 'Reset to road (+5 s)'],
];

export class TouchControls {
  constructor(input, hud) {
    this.input = input;
    this.on = false;
    const el = document.createElement('div');
    el.className = 'touch';
    el.innerHTML = `
      <div class="t-steer" id="t-steer"><div class="t-track"><span>◀</span><i id="t-knob"></i><span>▶</span></div><small>Steer</small></div>
      <div class="t-pad">${HOLD.map(([id, , label]) => `<button id="${id}" class="t-btn ${id}">${label}</button>`).join('')}</div>
      <div class="t-top">${TAPS.map(([id, , label, title]) => `<button id="${id}" class="t-btn small" aria-label="${title}">${label}</button>`).join('')}
        ${document.fullscreenEnabled ? '<button id="t-full" class="t-btn small" aria-label="Full screen">⛶</button>' : ''}</div>
      <div class="rotate">Turn your phone sideways for a wider view</div>`;
    hud.appendChild(el);
    this.el = el;
    const keys = input.keys;
    // held buttons
    for (const [id, code] of HOLD) {
      const b = el.querySelector('#' + id);
      const down = (e) => {
        e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.classList.add('on');
        if (code) keys.add(code); else input.pressed.add('KeyL');
        navigator.vibrate?.(8);
      };
      const up = () => { b.classList.remove('on'); if (code) keys.delete(code); };
      b.addEventListener('pointerdown', down);
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
    }
    for (const [id, code] of TAPS) {
      el.querySelector('#' + id).addEventListener('pointerdown', (e) => { e.preventDefault(); input.pressed.add(code); navigator.vibrate?.(8); });
    }
    el.querySelector('#t-full')?.addEventListener('pointerdown', (e) => { e.preventDefault(); goFullscreen(); });
    // steering pad: drag left/right from wherever the thumb lands
    const pad = el.querySelector('#t-steer'), knob = el.querySelector('#t-knob');
    let id = null, x0 = 0;
    const range = () => Math.max(50, pad.clientWidth * 0.32);
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId; x0 = e.clientX; pad.setPointerCapture?.(id); pad.classList.add('on');
      input.touchSteer = 0;
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const k = Math.max(-1, Math.min(1, (e.clientX - x0) / range()));
      // small dead zone, then a gentle curve for fine corrections at speed
      input.touchSteer = Math.abs(k) < 0.06 ? 0 : Math.sign(k) * ((Math.abs(k) - 0.06) / 0.94) ** 1.4;
      knob.style.transform = `translateX(${k * 100}%)`;
    });
    const release = (e) => {
      if (e.pointerId !== id) return;
      id = null; input.touchSteer = null; knob.style.transform = ''; pad.classList.remove('on');
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    if (isTouch()) this.enable();
    // a touch on a hybrid laptop also turns the controls on
    addEventListener('touchstart', () => this.enable(), { once: true, passive: true });
  }

  enable() {
    if (this.on) return;
    this.on = true;
    document.body.classList.add('touch-ui');
  }
}

// full screen + landscape lock where the browser allows it (Android Chrome; iOS Safari has neither)
export function goFullscreen() {
  const d = document.documentElement;
  if (!document.fullscreenEnabled || document.fullscreenElement) return;
  d.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
}
