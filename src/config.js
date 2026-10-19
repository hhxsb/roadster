// Vehicle specification and game tuning.
// Roadster figures come from Tesla's 15 Oct 2026 reveal coverage (see SPECS_SOURCES).
// Values Tesla has not published (mass, thrust split, tank pressure) are engineering
// estimates and are labelled as such in the in-game spec sheet.

export const MPH = 0.44704; // m/s per mph

export const ROADSTER = {
  name: 'Tesla Roadster — Rocket',
  // --- published
  topSpeedMph: 250,         // "over 230 mph"; electronically limited at 250 in-game
  rangeMi: 300,             // all trims
  thrusters: 10,            // cold-gas, SpaceX package
  airTankLiters: 600,       // carbon-overwrapped pressure vessels, rechargeable
  rearThrustN: 80000,       // "more than 80 kN" from the 4 rear thrusters
  // --- estimates (unpublished)
  dryMassKg: 1950,          // "two-ton electric car"
  airMassKg: 260,           // ~600 L at ~700 bar
  tankRatedBar: 700,
  exhaustVel: 640,          // m/s, cold-gas air nozzle (Isp ~65 s)
  liftThrustN: 36000,       // 6 down/attitude thrusters combined
  compressorKgPerSec: 0.9,  // regen-driven onboard compressor while driving
  motorPowerW: 950e3,       // 3 motors
  wheelTorqueNm: 10000,     // Tesla's 2017 wheel-torque figure
  wheelRadius: 0.35,
  length: 4.33, width: 2.0, height: 1.16,
  wheelbase: 2.65, trackF: 1.70, trackR: 1.72,
  cgHeight: 0.42,
  cdA: 0.52,                // Cd ~0.27 * 1.93 m^2
  clA: 0.35,                // passive downforce coefficient * area
  fanDownforceN: 7500,      // "multi-mode suction" fans (road mode)
  fanMaxN: 42000,           // full suction (~1.9x the car's weight, cf. McMurtry Speirling's 2 t of fan downforce) for wall / ceiling driving
  tireMu: 1.32,
  springK: 70000, damperC: 5400, restLength: 0.34, maxTravel: 0.18,
  maxSteer: 0.52,
};

export const GAME = {
  physicsHz: 120,
  maxHP: 100,
  bustTime: 3.2,          // seconds pinned by police to be busted
  bustRadius: 13,
  radarRange: 650,
  detectRange: 170,
  speedTolMph: 10,        // tolerance over the limit before police react
  evadeTime: 14,
  trafficSpacing: 85,     // metres per vehicle per lane (Medium)
  checkpoints: 8,
};

export const SPECS_SOURCES = [
  ['TechCrunch — Tesla reveals SpaceX-powered Roadster (15 Oct 2026)', 'https://techcrunch.com/2026/10/15/tesla-reveals-spacex-powered-roadster-that-flies-and-falls-with-style/'],
  ['The EV Report — Production Roadster with SpaceX cold-gas thrusters', 'https://theevreport.com/tesla-roadster-unveil-spacex-cold-gas-thrusters'],
  ['Tech Insider — Roadster flight tech: 80 kN thrust explained', 'https://tech-insider.org/tesla-roadster-flight-tech-80kn-thrust-explained-2026/'],
  ['explainx — How the flying Roadster works and what is unproven', 'https://www.explainx.ai/blog/tesla-flying-roadster-cold-gas-thrusters-how-it-works-what-was-shown-2026'],
];

export const QUALITY = {
  low:    { pixelRatio: 0.75, shadows: false, shadowSize: 1024, bloom: false, treeDist: 600, buildingDist: 2500, terrainLod: 0.6, msaa: 0 },
  medium: { pixelRatio: 1.0, shadows: true, shadowSize: 2048, bloom: true, treeDist: 1000, buildingDist: 4500, terrainLod: 1.0, msaa: 4 },
  high:   { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), shadows: true, shadowSize: 4096, bloom: true, treeDist: 1600, buildingDist: 8000, terrainLod: 1.5, msaa: 4 },
};

export const settings = loadSettings();
function loadSettings() {
  const def = { quality: 'medium', time: 'day', air: 'realistic', traffic: 'medium', units: 'mph', volume: 0.8, police: 'normal', invertY: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem('roadster.settings') || '{}') }; } catch { return def; }
}
export function saveSettings() {
  try { localStorage.setItem('roadster.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
