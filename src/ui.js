import { ROADSTER, SPECS_SOURCES, settings, saveSettings, MPH, GAME } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const fmtTime = (t) => { if (t == null || !isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
export { fmtTime };

export class UI {
  constructor(app, handlers) {
    this.h = handlers;
    app.insertAdjacentHTML('beforeend', `
    <div class="screen loading on" id="scr-loading">
      <div class="brand">Roadster<small>Seattle Loop</small></div>
      <div class="bar"><i id="load-bar"></i></div>
      <div class="status" id="load-status">Loading map data…</div>
      <div class="err" id="load-err"></div>
    </div>
    <div class="screen menu" id="scr-menu">
      <div class="panel">
        <div class="brand">Roadster<small>Seattle Loop</small></div>
        <div class="tagline">Run the Tesla Roadster with the SpaceX cold-gas package around Lake Washington: I-5 through downtown Seattle, the I-90 floating bridge, Bellevue on I-405, then back over SR 520. Finish the loop as fast as you can. Avoid the Washington State Patrol, and don't wreck the car.</div>
        <button class="btn primary" data-act="start">Start run</button>
        <button class="btn" data-act="controls">Controls</button>
        <button class="btn" data-act="specs">Roadster specs</button>
        <button class="btn" data-act="settings">Settings</button>
        <button class="btn" data-act="records">Records</button>
        <div class="best-line" id="menu-best"></div>
        <div class="credits">Map data © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles (USGS 3DEP / SRTM). Fan project, not affiliated with Tesla or SpaceX.</div>
      </div>
    </div>
    <div class="screen sheet" id="scr-controls"><div class="card">
      <h2>Controls</h2>
      <div class="grid2">
        <div class="kv"><span>Accelerate / brake · reverse</span><span><kbd>W</kbd> <kbd>S</kbd> or <kbd>↑</kbd> <kbd>↓</kbd></span></div>
        <div class="kv"><span>Steer</span><span><kbd>A</kbd> <kbd>D</kbd> or <kbd>←</kbd> <kbd>→</kbd></span></div>
        <div class="kv"><span>Thruster boost (rear mains)</span><span><kbd>Shift</kbd></span></div>
        <div class="kv"><span>Lift off / climb</span><span><kbd>Space</kbd></span></div>
        <div class="kv"><span>Descend</span><span><kbd>C</kbd> / <kbd>Ctrl</kbd></span></div>
        <div class="kv"><span>Auto-land</span><span><kbd>L</kbd></span></div>
        <div class="kv"><span>Handbrake</span><span><kbd>X</kbd></span></div>
        <div class="kv"><span>Suction fans on/off</span><span><kbd>F</kbd></span></div>
        <div class="kv"><span>Camera</span><span><kbd>V</kbd></span></div>
        <div class="kv"><span>Reset to road (+5 s)</span><span><kbd>R</kbd></span></div>
        <div class="kv"><span>High beams (auto-dip)</span><span><kbd>B</kbd></span></div>
        <div class="kv"><span>Horn · Mute</span><span><kbd>H</kbd> · <kbd>M</kbd></span></div>
        <div class="kv"><span>Pause</span><span><kbd>Esc</kbd> / <kbd>P</kbd></span></div>
        <div class="kv touch-only"><span>Touch screen</span><span>Drag the left pad to steer. Gas, Brake, Boost, Lift, Down and Land are on the right. Pause, camera, fans and reset are at the top.</span></div>
      </div>
      <h3>Flying</h3>
      <p>Hold <kbd>Space</kbd> to fire the six downward attitude/lift thrusters. Release it and the flight computer holds altitude. In the air, <kbd>W</kbd>/<kbd>S</kbd> tilt the car to translate forward or back, and <kbd>A</kbd>/<kbd>D</kbd> yaw. The reaction-control system keeps the car level on its own and rights it if it tumbles. Press <kbd>L</kbd> to auto-land: the car aligns with the road, then descends under throttle and touches down. Landing on another vehicle damages you. Compressed air is limited (about 260 kg in 600 L of COPVs), and the onboard compressor refills it while you drive. When the reserve is only enough to get down, the car lands automatically.</p>
      <h3>Tunnels: wall and ceiling driving</h3>
      <p>With the suction fans on (<kbd>F</kbd>), the Roadster can drive on tunnel walls and ceilings. In a tunnel (I-5 under the Convention Center, I-90 Mount Baker Ridge, the Mercer Island lids, SR 520), steer into the chamfered corner and the car rolls onto the wall. Keep turning and it carries on over the ceiling. The fans spool up to about 1.9× the car's weight to hold it on. Steer back down to return to the road. If you leave a tunnel while upside down, the attitude thrusters right the car as it drops.</p>
      <h3>Rules</h3>
      <p>Pass all ${GAME.checkpoints} checkpoints and cross the start line on I-5 to finish. State Patrol units wait on the shoulder: speed past one at more than ${GAME.speedTolMph} mph over the limit, or fly near it, and a pursuit starts. Heat rises over time and brings roadblocks with spike strips. If they box you in and stop you, you're busted. Get out of sight for long enough to evade. Collisions cost HP; at 0 HP the car is destroyed. Driving into the lake ends the run.</p>
      <h3>Gamepad</h3>
      <p>RT/LT throttle/brake · Left stick steer · A lift · Y descend · X boost · B handbrake · RB auto-land · LB camera · Start pause</p>
      <div class="row"><button class="btn" data-act="back">Back</button></div>
    </div></div>
    <div class="screen sheet" id="scr-specs"><div class="card" id="specs-card"></div></div>
    <div class="screen sheet" id="scr-settings"><div class="card" id="settings-card"></div></div>
    <div class="screen sheet" id="scr-records"><div class="card" id="records-card"></div></div>
    <div class="screen sheet" id="scr-pause"><div class="card" style="max-width:420px">
      <h2>Paused</h2>
      <div class="row col">
        <button class="btn primary" data-act="resume">Resume</button>
        <button class="btn" data-act="restart">Restart run</button>
        <button class="btn" data-act="settings">Settings</button>
        <button class="btn" data-act="controls">Controls</button>
        <button class="btn" data-act="quit">Main menu</button>
      </div>
    </div></div>
    <div class="screen result" id="scr-result">
      <h1 id="res-title">Busted</h1>
      <div class="sub" id="res-sub"></div>
      <div class="stats" id="res-stats"></div>
      <div class="row"><button class="btn primary" data-act="restart">Run again</button><button class="btn" data-act="replay" id="res-replay">Watch replay</button><button class="btn" data-act="quit">Main menu</button></div>
    </div>
    <div class="hud" id="hud">
      <div class="box tl">
        <div class="timer" id="h-time">0:00.00</div>
        <div class="subline" id="h-best">Best --:--.--</div>
        <div class="prog"><i id="h-prog"></i></div>
        <div class="cps" id="h-cps"></div>
        <div class="subline" id="h-remain"></div>
      </div>
      <div class="tc">
        <div class="police" id="h-police"><div class="t">Pursuit</div><div class="stars" id="h-stars"></div>
          <div class="m bust"><i id="h-bust"></i></div><div class="cap" id="h-pcap"></div>
          <div class="m evade"><i id="h-evade"></i></div></div>
        <div class="radar-wrap" id="h-radar-wrap">RADAR <div class="radar" id="h-radar"><i style="height:5px"></i><i style="height:8px"></i><i style="height:11px"></i><i style="height:14px"></i><i style="height:16px"></i></div></div>
      </div>
      <div class="box tr"><canvas id="h-map" width="400" height="400"></canvas><div class="loc" id="h-loc"></div></div>
      <div class="feed" id="h-feed"></div>
      <div class="box bl">
        <div class="meter hp" id="h-hpm"><div class="lab"><span>Integrity</span><b id="h-hp">100</b></div><div class="track"><i id="h-hpbar"></i></div></div>
        <div class="meter air"><div class="lab"><span>Thruster air</span><b id="h-air"></b></div><div class="track"><i id="h-airbar"></i></div></div>
        <div class="chips"><span class="chip" id="h-mode">DRIVE</span><span class="chip" id="h-fans">FANS</span><span class="chip" id="h-boost">BOOST</span><span class="chip" id="h-rcs">RCS</span></div>
        <div class="alt" id="h-alt"></div>
      </div>
      <div class="box br">
        <div class="limit" id="h-limit"><small>SPEED</small><small>LIMIT</small><b id="h-lim">60</b></div>
        <div class="power"><i id="h-power"></i></div>
        <div class="speed"><b id="h-speed">0</b><span id="h-unit">MPH</span><div class="gear" id="h-gear"><b>D</b></div></div>
      </div>
      <svg class="arrow" id="h-arrow" viewBox="0 0 54 54"><path d="M27 4 L46 40 L27 31 L8 40 Z" fill="#ffb020" stroke="#000" stroke-width="2"/></svg>
      <div class="toast" id="h-toast"></div>
      <div class="vignette" id="h-vig"></div>
      <div class="count" id="h-count"></div>
      <div class="help" id="h-help">Space lift off · Shift boost · L auto-land · F fans · V camera · Esc pause</div>
    </div>`);
    app.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      this.h.click?.();
      this.h.action(b.dataset.act);
    });
    this.cps = $('#h-cps');
    for (let i = 0; i < GAME.checkpoints; i++) this.cps.insertAdjacentHTML('beforeend', '<i></i>');
    this.map = $('#h-map');
    this.mapCtx = this.map.getContext('2d');
    this.el = {};
    for (const id of ['h-time', 'h-best', 'h-prog', 'h-remain', 'h-police', 'h-stars', 'h-bust', 'h-evade', 'h-pcap', 'h-radar-wrap', 'h-radar', 'h-loc', 'h-hp', 'h-hpbar', 'h-hpm', 'h-air', 'h-airbar', 'h-mode', 'h-fans', 'h-boost', 'h-rcs', 'h-alt', 'h-lim', 'h-power', 'h-speed', 'h-unit', 'h-gear', 'h-arrow', 'h-toast', 'h-vig', 'h-count', 'h-feed', 'h-help', 'h-limit']) this.el[id] = $('#' + id);
    this.renderSpecs();
    this.renderSettings();
  }

  show(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === 'scr-' + name);
    this.current = name;
    if (name === 'records') this.renderRecords();
    if (name === 'settings') this.renderSettings();
  }
  hideAll() { for (const s of document.querySelectorAll('.screen')) s.classList.remove('on'); this.current = null; }
  hud(on) { $('#hud').classList.toggle('on', on); }
  loading(p, msg) { $('#load-bar').style.width = `${Math.round(p * 100)}%`; if (msg) $('#load-status').textContent = msg; }
  loadError(msg) { $('#load-err').textContent = msg; }
  setMenuBest(t) { $('#menu-best').textContent = t ? `Personal best: ${fmtTime(t)}` : 'No completed runs yet.'; }

  renderSpecs() {
    const R = ROADSTER;
    const kv = (k, v, est) => `<div class="kv"><span>${k}</span><span>${v}${est ? '<span class="est">est.</span>' : ''}</span></div>`;
    $('#specs-card').innerHTML = `
      <h2>Tesla Roadster — Rocket</h2>
      <p>Tesla revealed the production Roadster on 15 October 2026 in three trims. Performance is "road ready", with active aero and a multi-mode suction-fan system. Thrust is "race ready" and adds rear cold-gas thrusters. Rocket is "air ready": a single-seat, invite-only trim with ten SpaceX cold-gas thrusters around the car. In the reveal demo the car drove up an inverted ramp, spun around in mid-air using fans and thrusters together, cleared a row of Tesla vehicles in short thruster-assisted hops, then eased back onto the pavement. Tesla did not show sustained flight.</p>
      <h3>Published</h3>
      <div class="grid2">
        ${kv('Top speed', 'over 230 mph (all trims)')}
        ${kv('Range', '300 mi (all trims)')}
        ${kv('0–60 mph', 'about 1 s (Thrust trim with thrusters)')}
        ${kv('Thrusters', '10 cold-gas (4 rear mains + 6 attitude)')}
        ${kv('Rear thrust', 'more than 80 kN')}
        ${kv('Propellant', '600 L of compressed air in carbon-overwrapped tanks, rechargeable')}
        ${kv('Production', '2028 (per Musk)')}
        ${kv('Reservation', '$50k Performance · $250k Thrust · Rocket invite only')}
      </div>
      <h3>Simulation model</h3>
      <div class="grid2">
        ${kv('Mass (dry + air)', `${R.dryMassKg} + ${R.airMassKg} kg`, true)}
        ${kv('Tank pressure', `${R.tankRatedBar} bar rated`, true)}
        ${kv('Cold-gas exhaust velocity', `${R.exhaustVel} m/s (Isp ≈ ${Math.round(R.exhaustVel / 9.81)} s)`, true)}
        ${kv('Lift thrust (6 ports)', `${R.liftThrustN / 1000} kN ≈ ${(R.liftThrustN / ((R.dryMassKg + R.airMassKg) * 9.81)).toFixed(2)} g`, true)}
        ${kv('Hover endurance (full tank)', `≈ ${Math.round((R.airMassKg * R.exhaustVel) / ((R.dryMassKg + R.airMassKg / 2) * 9.81))} s`, true)}
        ${kv('Rear-main boost endurance', `≈ ${((R.airMassKg * R.exhaustVel) / R.rearThrustN).toFixed(1)} s`, true)}
        ${kv('Compressor refill', `${R.compressorKgPerSec} kg/s while driving`, true)}
        ${kv('Motor power · wheel torque', `${R.motorPowerW / 1000} kW · ${R.wheelTorqueNm.toLocaleString()} Nm`, true)}
        ${kv('Suction-fan downforce', `${R.fanDownforceN / 1000} kN`, true)}
        ${kv('Tyre grip (peak μ)', `${R.tireMu}`, true)}
      </div>
      <p>How it flies: each thruster vents high-pressure air through a nozzle. Thrust = mass flow × exhaust velocity, so holding a ${((R.dryMassKg + R.airMassKg) / 1000).toFixed(1)} t car in a hover uses about ${Math.round(((R.dryMassKg + R.airMassKg) * 9.81) / R.exhaustVel)} kg of air per second. That limits a full tank to a few seconds of hover, or a couple of seconds of full rear boost, which matches the short hops in the reveal. The flight computer throttles the six downward ports to hold altitude and fires them differentially to control pitch, roll and yaw. Values marked <span style="color:var(--warn)">est.</span> are engineering estimates, because Tesla has not published them. The "Extended air" setting multiplies endurance for casual play.</p>
      <h3>Sources</h3>
      <ul class="src">${SPECS_SOURCES.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('')}</ul>
      <div class="row"><button class="btn" data-act="back">Back</button></div>`;
  }

  renderSettings() {
    const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-val="${v}" class="${settings[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    $('#settings-card').innerHTML = `
      <h2>Settings</h2>
      <div class="set"><label>Graphics quality</label>${seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}</div>
      <div class="set"><label>Time of day</label>${seg('time', [['day', 'Day'], ['sunset', 'Sunset'], ['overcast', 'Overcast'], ['night', 'Night']])}</div>
      <div class="set"><label>Thruster air supply</label>${seg('air', [['realistic', 'Realistic'], ['extended', 'Extended']])}</div>
      <div class="set"><label>Traffic density</label>${seg('traffic', [['low', 'Light'], ['medium', 'Normal'], ['high', 'Rush hour']])}</div>
      <div class="set"><label>Police</label>${seg('police', [['relaxed', 'Relaxed'], ['normal', 'Normal'], ['aggressive', 'Aggressive']])}</div>
      <div class="set"><label>Units</label>${seg('units', [['mph', 'mph'], ['kmh', 'km/h']])}</div>
      <div class="set"><label>Volume</label><input type="range" min="0" max="1" step="0.05" value="${settings.volume}" id="set-vol"></div>
      <p style="font-size:12px;color:var(--muted)">Graphics quality takes effect on the next reload. Time of day, traffic and air supply apply when the next run starts.</p>
      <div class="row"><button class="btn" data-act="back">Back</button></div>`;
    for (const s of document.querySelectorAll('#settings-card .seg')) {
      s.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        settings[s.dataset.key] = b.dataset.val; saveSettings();
        for (const x of s.querySelectorAll('button')) x.classList.toggle('on', x === b);
        this.h.settingChanged?.(s.dataset.key);
      });
    }
    $('#set-vol').addEventListener('input', (e) => { settings.volume = +e.target.value; saveSettings(); this.h.settingChanged?.('volume'); });
  }

  renderRecords() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('roadster.records') || '[]'); } catch { list = []; }
    $('#records-card').innerHTML = `<h2>Records</h2>${list.length ? `<table class="lb"><tr><th>#</th><th>Time</th><th>Top speed</th><th>HP left</th><th>Date</th></tr>${list.map((r, i) => `<tr><td>${i + 1}</td><td><b>${fmtTime(+r.time || 0)}</b></td><td>${+r.top || 0} mph</td><td>${+r.hp || 0}</td><td>${new Date(r.date).toLocaleDateString()}</td></tr>`).join('')}</table>` : '<p>No completed runs yet. Finish a full loop to set a record.</p>'}<div class="row"><button class="btn" data-act="back">Back</button></div>`;
  }

  result(kind, title, sub, stats) {
    const t = $('#res-title');
    t.textContent = title; t.className = kind === 'good' ? 'good' : 'bad';
    $('#res-sub').textContent = sub;
    $('#res-stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    this.show('result');
  }

  toast(title, sub = '', color = '#fff') {
    const d = document.createElement('div');
    d.style.color = color;
    d.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    this.el['h-toast'].replaceChildren(d);
  }
  feed(msg, color = 'var(--accent)') {
    const d = document.createElement('div');
    d.style.borderLeftColor = color; d.textContent = msg;
    this.el['h-feed'].prepend(d);
    while (this.el['h-feed'].children.length > 5) this.el['h-feed'].lastChild.remove();
    setTimeout(() => d.remove(), 4000);
  }
  countdown(v) { this.el['h-count'].textContent = v; }

  update(s) {
    const e = this.el;
    const kmh = settings.units === 'kmh';
    e['h-time'].textContent = fmtTime(s.time);
    e['h-best'].textContent = `Best ${fmtTime(s.best)}`;
    e['h-prog'].style.width = `${(s.progress * 100).toFixed(1)}%`;
    const left = s.remaining / (kmh ? 1000 : 1609.34);
    e['h-remain'].textContent = `${left.toFixed(1)} ${kmh ? 'km' : 'mi'} to finish`;
    [...this.cps.children].forEach((c, i) => c.classList.toggle('done', i < s.cpDone));
    e['h-speed'].textContent = Math.round(s.speed / (kmh ? 1 / 3.6 : MPH));
    e['h-unit'].textContent = kmh ? 'KM/H' : 'MPH';
    e['h-lim'].textContent = kmh ? Math.round(s.limit * 1.609) : s.limit;
    e['h-gear'].innerHTML = s.reverse ? '<b>R</b>' : '<b>D</b>';
    e['h-power'].style.height = `${Math.min(100, s.power * 100)}%`;
    e['h-hp'].textContent = Math.ceil(s.hp);
    e['h-hpbar'].style.width = `${s.hp}%`;
    e['h-hpm'].classList.toggle('low', s.hp < 30);
    e['h-air'].textContent = `${Math.round(s.air)} kg · ${Math.round(s.pressure)} bar`;
    e['h-airbar'].style.width = `${(s.airFrac * 100).toFixed(1)}%`;
    e['h-mode'].textContent = s.mode; e['h-mode'].className = 'chip' + (s.mode !== 'DRIVE' ? (s.mode === 'LOW AIR' ? ' warn' : ' fly') : '');
    e['h-fans'].classList.toggle('on', s.fans);
    e['h-boost'].classList.toggle('on', s.boost);
    e['h-rcs'].classList.toggle('on', s.rcs);
    e['h-alt'].textContent = s.wall ? 'FANS AT FULL SUCTION' : s.alt > 1.5 ? `ALT ${Math.round(s.alt * (kmh ? 1 : 3.281))} ${kmh ? 'm' : 'ft'} AGL · V/S ${s.vs >= 0 ? '+' : ''}${s.vs.toFixed(1)} m/s` : s.spikes ? 'TYRES DAMAGED' : '';
    e['h-loc'].textContent = s.location;
    // police
    e['h-police'].classList.toggle('on', s.heat > 0);
    e['h-stars'].textContent = '★'.repeat(s.heat) + '☆'.repeat(3 - s.heat);
    e['h-bust'].style.width = `${(s.bust * 100).toFixed(0)}%`;
    e['h-evade'].style.width = `${(s.evade * 100).toFixed(0)}%`;
    e['h-pcap'].textContent = s.bust > 0.05 ? 'GET MOVING!' : s.evade > 0.05 ? 'Evading…' : `${s.units} unit${s.units === 1 ? '' : 's'} in pursuit`;
    e['h-radar-wrap'].classList.toggle('on', s.radar > 0 && s.heat === 0);
    [...e['h-radar'].children].forEach((c, i) => c.classList.toggle('on', s.radar * 5 > i));
    // route arrow
    e['h-arrow'].classList.toggle('on', s.arrow != null);
    if (s.arrow != null) e['h-arrow'].style.transform = `rotate(${s.arrow}rad)`;
    e['h-vig'].style.boxShadow = `inset 0 0 ${120 + s.hurt * 120}px rgba(232,33,39,${Math.min(0.75, s.hurt * 0.8 + (s.hp < 25 ? 0.25 + 0.15 * Math.sin(performance.now() / 180) : 0))})`;
  }
}
