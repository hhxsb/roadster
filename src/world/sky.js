import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

// Time-of-day presets. Azimuth: degrees clockwise from north.
export const TIMES = {
  day:      { elev: 42, azim: 140, turbidity: 4, rayleigh: 1.3, mie: 0.004, exposure: 0.5, sun: 3.2, hemi: 0.55, env: 0.3, fog: 0xa9b8c8, fogDensity: 0.00007, clouds: 0.35, night: 0, cloudTint: 0xffffff },
  sunset:   { elev: 5.5, azim: 288, turbidity: 8, rayleigh: 2.6, mie: 0.006, exposure: 0.5, sun: 2.6, hemi: 0.35, env: 0.3, fog: 0xc7a58e, fogDensity: 0.00012, clouds: 0.42, night: 0.15, cloudTint: 0xffc9a0 },
  overcast: { elev: 38, azim: 170, turbidity: 12, rayleigh: 3.5, mie: 0.02, exposure: 0.55, sun: 0.7, hemi: 0.9, env: 0.35, fog: 0xa4aab0, fogDensity: 0.00022, clouds: 0.92, night: 0, cloudTint: 0xd8dadd },
  night:    { elev: -14, azim: 300, turbidity: 2, rayleigh: 0.4, mie: 0.002, exposure: 0.8, sun: 0.0, hemi: 0.12, env: 0.12, fog: 0x141a26, fogDensity: 0.00016, clouds: 0.3, night: 1, cloudTint: 0x404858 },
};

export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(150000);
    this.sky.renderOrder = -10;
    this.sky.material.depthWrite = false;
    scene.add(this.sky);
    this.sunDir = new THREE.Vector3();

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.06;
    const sc = this.sun.shadow.camera;
    sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 10; sc.far = 1600;
    scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x8899cc, 0.0);
    scene.add(this.moon);
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x4a4436, 1);
    scene.add(this.hemi);

    this.clouds = this.makeClouds();
    scene.add(this.clouds);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = null;
    scene.fog = new THREE.FogExp2(0xa0b0c0, 0.0001);
  }

  makeClouds() {
    const geo = new THREE.SphereGeometry(60000, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
      uniforms: { time: { value: 0 }, cover: { value: 0.4 }, sunDir: { value: new THREE.Vector3() }, tint: { value: new THREE.Color() }, night: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        varying vec3 vDir; uniform float time, cover, night; uniform vec3 sunDir, tint;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<6;i++){ s+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          if (d.y < 0.0) discard;
          vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(time*0.004, time*0.0015);
          float c = fbm(uv);
          float th = 1.0 - cover;
          float a = smoothstep(th - 0.08, th + 0.25, c);
          float shade = 0.65 + 0.35 * smoothstep(0.3, 0.9, fbm(uv*1.7 + 3.1));
          float sunGlow = pow(max(dot(d, sunDir), 0.0), 8.0);
          vec3 col = tint * shade + vec3(1.0,0.85,0.7) * sunGlow * 0.5 * (1.0 - night);
          col *= mix(1.0, 0.12, night);
          a *= smoothstep(0.0, 0.12, d.y);
          // stars at night
          vec3 sd = floor(d * 900.0);
          float star = step(0.9985, h(sd.xy + sd.z*7.13)) * night * (1.0 - a) * smoothstep(0.05, 0.3, d.y);
          gl_FragColor = vec4(col + star, max(a * 0.95, star));
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -9;
    m.frustumCulled = false;
    return m;
  }

  setTime(name) {
    const t = TIMES[name] || TIMES.day;
    this.preset = t;
    const u = this.sky.material.uniforms;
    u.turbidity.value = t.turbidity; u.rayleigh.value = t.rayleigh; u.mieCoefficient.value = t.mie; u.mieDirectionalG.value = 0.8;
    const phi = THREE.MathUtils.degToRad(90 - t.elev), theta = THREE.MathUtils.degToRad(t.azim);
    // azimuth clockwise from north; world: north = -z, east = +x
    this.sunDir.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta));
    u.sunPosition.value.copy(this.sunDir);
    this.renderer.toneMappingExposure = t.exposure;
    this.sun.intensity = t.sun;
    this.sun.color.setHSL(0.09, t.elev < 12 ? 0.75 : 0.25, t.elev < 12 ? 0.62 : 0.92);
    this.sun.visible = t.sun > 0.01;
    this.moon.intensity = t.night * 0.35;
    this.moon.position.set(-0.4, 0.8, 0.3).multiplyScalar(1000);
    this.hemi.intensity = t.hemi;
    this.hemi.color.set(t.night >= 0.5 ? 0x334466 : name === 'sunset' ? 0xffd2b0 : 0xcfe0ff);
    this.hemi.groundColor.set(t.night >= 0.5 ? 0x111111 : 0x5a5040);
    this.scene.fog.color.set(t.fog);
    this.scene.fog.density = t.fogDensity;
    const cu = this.clouds.material.uniforms;
    cu.cover.value = t.clouds; cu.sunDir.value.copy(this.sunDir); cu.tint.value.set(t.cloudTint); cu.night.value = t.night;
    this.sky.visible = t.night < 0.5;
    this.scene.background = t.night >= 0.5 ? new THREE.Color(0x070b16) : null;
    // environment map from the sky
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(1000);
    sky2.material.uniforms.turbidity.value = t.turbidity; sky2.material.uniforms.rayleigh.value = t.rayleigh;
    sky2.material.uniforms.mieCoefficient.value = t.mie; sky2.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(sky2);
    if (t.night >= 0.5) envScene.background = new THREE.Color(0x0a0e18);
    // simple ground plane so reflections show the ground below the horizon
    const g = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: t.night >= 0.5 ? 0x050505 : 0x3a3a38 }));
    g.position.y = -5; envScene.add(g);
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = this.pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = t.env;
    sky2.material.dispose(); g.geometry.dispose(); g.material.dispose();
  }

  update(dt, focus, camera) {
    this.clouds.material.uniforms.time.value += dt;
    this.clouds.position.copy(camera.position);
    this.sky.position.copy(camera.position);
    const d = this.sunDir.y > 0 ? this.sunDir : _moonDir;
    this.sun.position.copy(focus).addScaledVector(d, 700);
    this.sun.target.position.copy(focus);
    // snap the shadow camera to texels to avoid shimmering
    const sc = this.sun.shadow;
    if (sc.map) {
      const texel = (sc.camera.right - sc.camera.left) / sc.mapSize.x;
      this.sun.target.position.x = Math.round(focus.x / texel) * texel;
      this.sun.target.position.z = Math.round(focus.z / texel) * texel;
      this.sun.position.copy(this.sun.target.position).addScaledVector(d, 700);
    }
  }
}
const _moonDir = new THREE.Vector3(-0.3, 0.8, 0.4).normalize();
