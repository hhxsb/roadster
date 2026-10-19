import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { World } from './data.js';
import { QUALITY, settings } from './config.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { SkySystem } from './world/sky.js';
import { Terrain } from './world/terrain.js';
import { Water } from './world/water.js';
import { Roads, crossSection } from './world/roads.js';
import { tunnelBores } from './world/tunnel.js';
import { Buildings } from './world/buildings.js';
import { Vegetation } from './world/vegetation.js';
import { Landmarks } from './world/landmarks.js';
import { FX } from './fx/particles.js';
import { Game } from './game.js';

const app = document.getElementById('app');
const quality = QUALITY[settings.quality] || QUALITY.medium;
let game = null;
let prevScreen = 'menu';

const audio = new Audio();
audio.volume = settings.volume;
const input = new Input();
const ui = new UI(app, {
  click: () => audio.click(),
  action(act) {
    if (act === 'start') game?.start();
    else if (act === 'controls' || act === 'specs' || act === 'settings' || act === 'records') { prevScreen = ui.current === 'pause' ? 'pause' : 'menu'; game && (game.prevScreen = prevScreen); ui.show(act); }
    else if (act === 'back') ui.show(prevScreen);
    else if (act === 'resume') game?.resume();
    else if (act === 'restart') { game?.start(); }
    else if (act === 'quit') game?.toMenu();
  },
  settingChanged(key) {
    if (key === 'volume') audio.setVolume(settings.volume);
    if (key === 'time' && game) game.applyTime();
  },
});

const yieldFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  if (!window.WebGL2RenderingContext) { ui.loadError('This game needs WebGL 2. Please use a recent desktop browser.'); return; }
  const renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'gl';
  app.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.15, 200000);

  const world = new World();
  await world.load((p, f) => ui.loading(p * 0.45, `Loading ${f}…`));
  world.cs = crossSection(world.road);
  world.tunnelBores = tunnelBores(world.cs);
  const steps = [
    ['Sky and lighting', () => { sys.sky = new SkySystem(renderer, scene); sys.sky.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize); }],
    ['Terrain (USGS elevation)', () => { sys.terrain = new Terrain(world, renderer, quality); scene.add(sys.terrain.group); }],
    ['Lake Washington', () => { sys.water = new Water(world); scene.add(sys.water.group); }],
    ['Freeways, bridges and tunnels', () => { sys.roads = new Roads(world, quality); scene.add(sys.roads.group); }],
    [`${world.buildingsRaw.length.toLocaleString()} buildings`, () => { sys.buildings = new Buildings(world, quality); scene.add(sys.buildings.group); }],
    ['Trees', () => { sys.vegetation = new Vegetation(world, quality); scene.add(sys.vegetation.group); }],
    ['Landmarks and mountains', () => { sys.landmarks = new Landmarks(world); scene.add(sys.landmarks.group); }],
    ['Vehicles', () => { fx = new FX(scene); }],
  ];
  const sys = {};
  let fx;
  for (let i = 0; i < steps.length; i++) {
    ui.loading(0.45 + (i / steps.length) * 0.5, `Building ${steps[i][0]}…`);
    await yieldFrame();
    steps[i][1]();
  }
  // outer ground beyond the data area
  const outer = new THREE.Mesh(new THREE.CircleGeometry(120000, 64).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x34403f }));
  outer.position.y = -14; scene.add(outer);

  game = new Game({ renderer, scene, camera, world, ui, audio, input, sys, fx });
  game.prevScreen = 'menu';

  // post-processing
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.msaa });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 0.92);
  bloom.enabled = quality.bloom;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  ui.loading(1, 'Compiling shaders…');
  await yieldFrame();
  renderer.compile(scene, camera);
  ui.show('menu');

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      game.update(dt);
      composer.render(dt);
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener('visibilitychange', () => { if (document.hidden) game.pause(); });
  // expose for debugging in the console
  window.__game = game;
}

boot().catch((e) => { console.error(e); ui.loadError(`Failed to start: ${e.message}`); });
