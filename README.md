# Roadster: Seattle Loop

An open-road 3D driving game in the browser. You drive the Tesla Roadster (Rocket trim, with the SpaceX cold-gas package; modelled on the 15 Oct 2026 reveal: white wedge body, dark glass canopy, pop-down headlamps behind a knife-edge DRL, thin red tail strip, RDSTR plate over four rear thrusters, corner and side lift thrusters, self-adjusting rear wing, black wheels, one seat plus an air tank) around a 34 km loop built from real map data:

**I-5 South** through downtown Seattle (under the Convention Center) → **I-90 East** through the Mount Baker Ridge Tunnel, over the Lacey V. Murrow floating bridge, across Mercer Island and the East Channel Bridge → **I-405 North** past downtown Bellevue → **SR 520 West** over the Evergreen Point floating bridge and the Portage Bay Viaduct → back onto I-5 to the finish.

Finish the loop as fast as you can. State Patrol units wait on the shoulder; speed past one, or fly near it, and a pursuit starts. Getting boxed in and stopped means you're busted. Collisions cost integrity, and at 0 HP the car is destroyed. Driving into the lake also ends the run.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (includes public/data)
```

It runs in any browser with WebGL 2. On phones and tablets, on-screen touch controls appear automatically and the game starts on low graphics quality. Landscape works best, and on Android, starting a run switches to full screen. Graphics quality, time of day (day / sunset / overcast / night), traffic density, police aggressiveness, thruster air supply and units are in **Settings**.

## Controls

| Action | Keys | Gamepad |
|---|---|---|
| Throttle / brake · reverse | W S / ↑ ↓ | RT / LT |
| Steer | A D / ← → | Left stick |
| Thruster boost (4 rear mains) | Shift | X |
| Lift off / climb | Space | A |
| Descend | C / Ctrl | Y |
| Auto-land | L | RB |
| Handbrake | X | B |
| Suction fans | F | D-pad up |
| Camera (chase / far / hood / cockpit) | V | LB |
| Reset to road (+5 s) | R | Back |
| Pause | Esc / P | Start |

On a touch screen, drag the left pad to steer. Gas, Brake, Boost, Lift, Down and Land are on the right, and Pause, Camera, Fans, Reset and Full screen are along the top.

## Replays and clips

When a run ends (finished, destroyed, busted or in the lake), **Watch replay** on the results screen plays the whole run back. You can scrub the timeline, change the speed (0.25× to 4×), and switch between six cameras: chase, trackside, far, orbit, hood and cockpit. Mark a clip with **Set start** / **Set end** (I / O); it defaults to the last 30 s. **Save clip** records it with game audio as a vertical 9:16 or landscape 16:9 video for posting. The video has a race-clock and speed overlay. It is saved as MP4 in Chrome and Edge, and as WebM in other browsers.

The replay is kept in memory only (about 30 MB for a full loop) and is gone once you start a new run.

## The Roadster

Specs come from coverage of Tesla's 15 Oct 2026 reveal: TechCrunch, The EV Report and Tech Insider (links are on the in-game spec sheet). The published figures are top speed over 230 mph, 300 mi range, 10 cold-gas thrusters, 600 L of compressed air in carbon-overwrapped tanks, and more than 80 kN of rear thrust. Unpublished values (mass, tank pressure, exhaust velocity, lift thrust) are engineering estimates and are labelled as estimates in-game.

How flight works in the game:

- **Thrust = ṁ · vₑ.** Cold air leaves the nozzles at about 640 m/s, so a 2.2 t hover uses about 34 kg of air per second. A full ~260 kg tank gives a few seconds of hover, or about 2 s of full rear boost. That matches the short thruster-assisted hops Tesla showed.
- **Six downward lift/attitude ports** carry the weight. The flight computer throttles them to hold altitude when you release Space, and fires them differentially to control pitch, roll and yaw. In the air, W/S tilt the car to translate and A/D yaw it. The reaction-control system also rights the car automatically if it tumbles after a jump or crash, which is the "repositioning in the air" from the demo.
- **Auto-land** aligns the car with the road, descends under throttle, flares and touches down. When the remaining air is only enough to land, the car lands itself. Landing on another vehicle damages you.
- The onboard compressor refills the tanks while you drive. The *Extended* air setting stretches endurance for casual play.

## Tunnel wall and ceiling driving

The car's "multi-mode suction" fans let it stick to tunnel walls and ceilings. Inside a tunnel the wheels ray-cast against the bore cross-section, which has chamfered floor and roof corners. That bore shape is shared by the renderer, the physics and the camera (`src/world/tunnel.js`). As the car rolls off the floor, the fans ramp up to 42 kN, about 1.9× its weight (comparable to the McMurtry Spéirling's fan downforce). Steer into the wall to climb, keep turning to cross the ceiling, and steer back to come down. The chase camera rolls with the car.

## Physics

- A 6-DOF rigid body at 120 Hz, with raycast suspension (springs, dampers, bump stops, anti-roll bars) on four wheels.
- Magic-formula lateral tyre model with staggered front/rear grip and a friction circle. Traction control, ABS and electronic stability control; the handbrake disables ESC for drifting.
- 950 kW / 10,000 Nm AWD drive split 35/65 front/rear, aerodynamic drag and lift, switchable suction-fan downforce, and a 250 mph limiter.
- Measured performance: 0–60 mph in about 2.2 s on tyres alone, under 1 s with the rear thrusters.
- Collisions: impulse-based contacts against Jersey barriers, tunnel walls, terrain, building footprints and other vehicles (oriented-box SAT). Damage scales with Δv.

## Traffic and police

- About 16 vehicle models: sedans, Model 3, compacts, hatchbacks, SUVs, full-size SUVs, pickups, Cybertruck, minivans, sports cars, Jeeps, vans, box trucks, semis in several liveries, and Metro buses. Each spawns with a realistic paint mix and a brand name.
- Traffic uses the Intelligent Driver Model for car-following and a MOBIL-style lane-change model, including "keep right except to pass". Trucks stay right. Vehicles you hit become physics wrecks.
- Washington State Patrol (Ford PI Utility) and SPD (Charger) units sit in ambush on the shoulders. They detect you by speed (more than 10 mph over the posted limit) or by flight. In pursuit they pull out, chase without U-turns, ram, and back up to box you in. Heat escalates over time, bringing reinforcements and roadblocks with spike strips. A radar detector warns you about parked units.

## World data pipeline

All world data is generated offline by the scripts in `tools/`:

```bash
node tools/build_route.mjs   # chain OSM motorway ways into directed legs (needs rawdata/motorways.json)
node tools/fetch_osm.mjs     # buildings, water, parks, streets via the Overpass API
node tools/build_world.mjs   # route + heights, terrain carving, landcover, buildings, trees -> public/data
```

- **Roads:** the OpenStreetMap carriageway geometry for I-5, I-90, I-405 and SR 520 is chained into a loop and joined by Hermite-spline interchange ramps. Elevation comes from the DEM. Bridge and tunnel spans are interpolated, floating-bridge decks sit on the lake surface, and grades are limited to 5.5 %.
- **Terrain:** AWS Terrain Tiles (USGS 3DEP / SRTM) at zoom 13, resampled to a 10 m grid and carved around the freeways.
- **Buildings:** about 27,600 OSM footprints with real heights and building parts, so Columbia Center and the Bellevue towers have their actual shapes. Facades are procedural: curtain-wall glass, ribbon windows, brick, siding, gabled roofs and lit windows at night.
- **Landmarks:** the Space Needle, Mount Rainier, and the Olympic and Cascade ranges on the horizon.

Map data © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles.

This is a fan project and is not affiliated with Tesla or SpaceX.

## Code map

| Path | Purpose |
|---|---|
| `src/main.js` | Renderer, post-processing, loading, boot |
| `src/game.js` | Game state, checkpoints, damage, collisions, HUD feed |
| `src/vehicles/roadsterPhysics.js` | Vehicle dynamics, thrusters, flight computer |
| `src/vehicles/roadsterModel.js`, `carModels.js`, `loft.js` | Procedural vehicle models |
| `src/traffic/traffic.js`, `police.js`, `collisions.js` | AI traffic, police, vehicle contacts |
| `src/world/*` | Terrain, roads, buildings, water, sky, vegetation, landmarks |
| `src/data.js` | World data loading and spatial queries |
| `src/ui.js`, `src/minimap.js`, `src/style.css` | Menus and HUD |
| `src/audio.js` | Synthesized audio (motors, wind, tyres, thrusters, sirens) |

Debug hooks in the browser console: `__game`, `window.__autopilot = {lane: 2, speed: 31}`, `window.__god`, `window.__ghost`, `window.__timescale`, `window.__cam = {pos, look}`.
