// Fully synthesized audio (Web Audio API) - no sample files needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.out = comp;
    this.noise = this.makeNoise(2);
    this.brown = this.makeNoise(2, true);

    // electric drive unit whine (3 motors -> a few slightly detuned partials)
    this.motorGain = this.gain(0);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 2;
    lp.connect(this.motorGain);
    this.motorOsc = [0, 1, 2].map((k) => {
      const o = ctx.createOscillator(); o.type = k === 0 ? 'sawtooth' : 'sine';
      const g = ctx.createGain(); g.gain.value = [0.05, 0.12, 0.06][k];
      o.connect(g).connect(lp); o.start(); return o;
    });
    this.motorLP = lp;
    // wind
    this.windGain = this.gain(0);
    const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 500; wbp.Q.value = 0.5;
    this.loop(this.noise).connect(wbp).connect(this.windGain); this.windBP = wbp;
    // road / tyre rumble
    this.roadGain = this.gain(0);
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 260;
    this.loop(this.brown).connect(rlp).connect(this.roadGain);
    // tyre squeal
    this.squealGain = this.gain(0);
    const sq = ctx.createBiquadFilter(); sq.type = 'bandpass'; sq.frequency.value = 1100; sq.Q.value = 9;
    this.loop(this.noise).connect(sq).connect(this.squealGain);
    // cold-gas thrusters: supersonic hiss + low roar
    this.thrustGain = this.gain(0);
    const thp = ctx.createBiquadFilter(); thp.type = 'highpass'; thp.frequency.value = 1800;
    this.loop(this.noise).connect(thp).connect(this.thrustGain);
    this.roarGain = this.gain(0);
    const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 180;
    this.loop(this.brown).connect(rl).connect(this.roarGain);
    // fans
    this.fanGain = this.gain(0);
    const fbp = ctx.createBiquadFilter(); fbp.type = 'bandpass'; fbp.frequency.value = 2400; fbp.Q.value = 3;
    this.loop(this.noise).connect(fbp).connect(this.fanGain);
    // siren (two-tone wail)
    this.sirenGain = this.gain(0);
    const so = ctx.createOscillator(); so.type = 'square';
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2200;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.28; const lg = ctx.createGain(); lg.gain.value = 420;
    lfo.connect(lg).connect(so.frequency); so.frequency.value = 1050;
    so.connect(sf).connect(this.sirenGain); so.start(); lfo.start();
    this.sirenLfo = lfo;
    // scrape
    this.scrapeGain = this.gain(0);
    const sc = ctx.createBiquadFilter(); sc.type = 'bandpass'; sc.frequency.value = 3200; sc.Q.value = 1.5;
    this.loop(this.noise).connect(sc).connect(this.scrapeGain);
    this.radarT = 0;
  }

  // a MediaStream of the mixed game audio (for video export); captureStream(false) releases it
  captureStream(on = true) {
    if (!this.ctx) return null;
    if (!on) { if (this.dest) { this.out.disconnect(this.dest); this.dest = null; } return null; }
    if (!this.dest) { this.dest = this.ctx.createMediaStreamDestination(); this.out.connect(this.dest); }
    return this.dest.stream;
  }

  gain(v) { const g = this.ctx.createGain(); g.gain.value = v; g.connect(this.master); return g; }
  makeNoise(sec, brown = false) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  loop(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }
  set(param, v, tc = 0.06) { param.setTargetAtTime(v, this.ctx.currentTime, tc); }

  setVolume(v) { this.volume = v; if (this.master) this.set(this.master.gain, this.muted ? 0 : v, 0.05); }
  toggleMute() { this.muted = !this.muted; this.setVolume(this.volume); return this.muted; }

  update(st) {
    if (!this.ctx) return;
    const sp = st.speed;
    const f = 90 + sp * 23;
    this.motorOsc[0].frequency.setTargetAtTime(f * 0.5, this.ctx.currentTime, 0.05);
    this.motorOsc[1].frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    this.motorOsc[2].frequency.setTargetAtTime(f * 2.97, this.ctx.currentTime, 0.05);
    this.set(this.motorGain.gain, st.paused ? 0 : 0.05 + Math.min(1, st.power / 600000) * 0.5 + Math.min(0.15, sp / 300));
    this.set(this.windGain.gain, st.paused ? 0 : Math.min(0.8, (sp * sp) / 9000));
    this.set(this.windBP.frequency, 300 + sp * 12);
    this.set(this.roadGain.gain, st.paused || !st.grounded ? 0 : Math.min(0.6, sp / 60));
    this.set(this.squealGain.gain, st.paused ? 0 : Math.min(0.5, st.slip * 0.6), 0.03);
    this.set(this.thrustGain.gain, st.paused ? 0 : Math.min(1, st.thrust * 0.9), 0.03);
    this.set(this.roarGain.gain, st.paused ? 0 : Math.min(1.2, st.thrust * 1.3), 0.03);
    this.set(this.fanGain.gain, st.paused ? 0 : st.fans * 0.05);
    this.set(this.sirenGain.gain, st.paused ? 0 : st.siren * 0.22, 0.1);
    this.set(this.scrapeGain.gain, st.paused ? 0 : Math.min(0.5, st.scrape / 40), 0.03);
    // radar detector beeps
    if (st.radar > 0 && !st.paused) {
      this.radarT -= st.dt;
      if (this.radarT <= 0) { this.beep(st.radar > 0.7 ? 2400 : 1800, 0.06, 0.18); this.radarT = 1.2 - st.radar * 1.05; }
    }
  }

  beep(freq, dur, vol = 0.2) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = freq; o.type = 'square';
    g.gain.setValueAtTime(vol, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g).connect(this.master); o.start(); o.stop(this.ctx.currentTime + dur + 0.02);
  }

  burst(vol, freq, dur, type = 'lowpass') {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    s.connect(f).connect(g).connect(this.master); s.start(); s.stop(this.ctx.currentTime + dur + 0.05);
  }
  crash(strength) { this.burst(Math.min(1.2, 0.25 + strength * 0.06), 900 + strength * 60, 0.5 + strength * 0.02); this.burst(Math.min(0.8, strength * 0.05), 3500, 0.25, 'highpass'); }
  explosion() { this.burst(1.6, 300, 2.5); this.burst(1.0, 90, 3.5); this.burst(0.6, 2000, 0.8); }
  splash() { this.burst(0.9, 1400, 1.4, 'bandpass'); this.burst(0.7, 300, 1.8); }
  whoosh(v) { this.burst(Math.min(0.4, v * 0.008), 700, 0.7, 'bandpass'); }
  click() { this.beep(1200, 0.03, 0.08); }
  chime() { this.beep(880, 0.15, 0.15); setTimeout(() => this.beep(1320, 0.25, 0.15), 120); }
  horn() { if (!this.ctx) return; for (const f of [415, 520]) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = f; g.gain.setValueAtTime(0.08, this.ctx.currentTime); g.gain.setTargetAtTime(0, this.ctx.currentTime + 0.35, 0.05); const lp = this.ctx.createBiquadFilter(); lp.frequency.value = 1500; o.connect(lp).connect(g).connect(this.master); o.start(); o.stop(this.ctx.currentTime + 0.6); } }
}
