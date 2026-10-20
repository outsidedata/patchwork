# Patchwork

Patchwork is a multiplayer game engine shipped as source, made to be built with an agent. A game is
made by cloning this repo: the engine and every plugin and addon built on it are folders you can
read, change and commit, and nothing is published to npm. Each piece is documented in the header of
its own file and proven by the tests beside it, and `.claude/` holds the rules and the skills an
agent such as Claude Code reads before it writes a line, so you can say what the game should do and
have it built in the right place.

## What you get

- **2D and 3D.** 2D draws with PixiJS (`render2d`), 3D with three.js (`render3d`). Core's three is
  `outsidedata/three.js`, whose math hands back the same bits on every engine.
- **Physics.** Box2D v3 and Box3D, Erin Catto's engines, as WebAssembly (`box2d.js`, `box3d.js`),
  the same bytes on the server and in every page.
- **Multiplayer.** The server holds the truth and sends each seat its rows every step. A page across
  a network runs its scene ahead of the server, so a press answers on the next frame, and the server
  puts a late press back on the step it was made on. One scene runs in one tab, over a WebSocket on
  node, or on a simulated bad network, with the same code.
- **57 plugins and 13 addons**, below, each name a link to its folder.
- **A game on any static host.** `yarn produce_static_site <game>` writes a game's one-tab page as a
  folder GitHub Pages, itch.io or any web server serves as it is.

### Plugins

A plugin lives in the world (rows, the step) or in the player's browser (drawing, input, camera,
sound, UI): a server half, `<p>.sim.ts`, a browser half, `<p>.plugin.ts`, or both. A **mod** is how
one plugin hands another what it knows without either importing the other (terrain3d hands walker
the height of the ground): "for" names the plugins this one hands a mod, "from" the ones that hand it
one.

| plugin | what it does | built on | mods |
|---|---|---|---|
| [`anim`](plugins/anim/) | Mixamo skeletal animation from a rig file: gaits picked from ground speed, jumps and landings, one-shot clips with root-motion travel, animation-event markers, and an upper-body layer blended over the legs, the same on every seat. | three.js, loader | for ik3d, interact, ragdoll3d |
| [`audio`](plugins/audio/) | Positional 3D and 2D sound (Web Audio panners with distance rolloff) for the sounds the rules raise, each played once on every page through a ledger, and loops. | Web Audio | for box3dvehicle, cutscene |
| [`audiodaw`](plugins/audiodaw/) | A DAW in the browser: a rack of Tone.js instruments and drum kits, effect chains, sends and buses, tracks of MIDI patterns placed as clips, mute and solo, edits heard while the song plays. | Tone.js | |
| [`box2d`](plugins/box2d/) | Box2D v3 rigid-body physics as WebAssembly, deterministic and bit-identical on the server and in every browser: bodies, joints, sensors, ray casts and shape queries, rewound for late input. | box2d.js, loader, rewind | from tilemap |
| [`box3d`](plugins/box3d/) | Box3D 3D rigid-body physics as WebAssembly, the same bytes on the server and in the browser: bodies, joints, sensors and queries, rewound for late input. | box3d.js, loader, rewind | for box3dvehicle · from box3dvehicle, ragdoll3d, scatter3d, terrain3d |
| [`box3dvehicle`](plugins/box3dvehicle/) | Drivable cars from one description: chassis and wheel joints in box3d, a spring-damper suspension of its own, throttle, brake and steering, per-wheel compression for effects, and the body, cabin or open jeep drawn from its sizes. | box3d, three.js, particle3d, scatter3d | for box3d, interact, scatter3d · from audio, box3d, dismember3d, hitscan3d, terrain3d |
| [`cel3d`](plugins/cel3d/) | Toon (cel) shading on every three.js material: stepped light bands, a shadow tint and ink outlines. | three.js, render3d | |
| [`chasecamera3d`](plugins/chasecamera3d/) | A third-person chase and over-the-shoulder camera locked to a row: yaw, pitch, distance and shoulder offset, no easing, no drift. | three.js, render3d | |
| [`chat`](plugins/chat/) | Multiplayer chat: zone, global, party and whisper channels in ring buffers on rows, private lines kept from other seats, with tabs and text entry. | PixiJS, ui | for party |
| [`cover3d`](plugins/cover3d/) | Cover finding for AI: the spots behind trees and rocks out of a threat's line of sight, nearest first. | | from scatter3d |
| [`cull3d`](plugins/cull3d/) | Frustum culling and distance LOD for instanced crowds of buildings or trees, binned on a grid and drawn front to back. | three.js, render3d | |
| [`cutscene`](plugins/cutscene/) | Scripted in-engine cinematics from a cue file: camera shots, follows and look-ats, letterbox bars, fades, subtitles, camera shake, a directed cast and skipping, the same on every seat. | PixiJS, three.js, loader, ui | from audio, terrain3d |
| [`dismember3d`](plugins/dismember3d/) | Dismemberment and gore on Mixamo characters: hits per limb on the skeleton, severed limbs as physics pieces with blood bursts and drips, and cars that run bodies over. | three.js, anim, hitscan3d, ragdoll3d, particle3d | for box3dvehicle, hitscan3d · from terrain3d |
| [`dither3d`](plugins/dither3d/) | The PS1 look: 15-bit colour, 4×4 ordered dithering and chunky low-resolution pixels. | three.js, render3d | |
| [`environment3d`](plugins/environment3d/) | A 3D lighting rig: a sun with shadow maps, hemisphere, ambient and fill lights, and a floor. | three.js, render3d | |
| [`flight3d`](plugins/flight3d/) | Flight physics for fixed-wing aircraft: stability-derivative aerodynamics with stall, ailerons, elevator and rudder, deterministic and replayable, control surfaces animated on the model. | render3d, loader | from terrain3d |
| [`grid`](plugins/grid/) | Large tile maps that change while the game runs, for city builders and sims: chunked cells packed for cheap network sync, drawn from sprite sheets, a cell redrawn only when it changes. | render2d, loader | |
| [`hitscan3d`](plugins/hitscan3d/) | Hitscan weapons with lag compensation: rays against the terrain, trees and bodies as they stood on the step the shooter saw, with damage. | rewind | for box3dvehicle, volley3d · from dismember3d, ragdoll3d, scatter3d, terrain3d, walker |
| [`ik3d`](plugins/ik3d/) | Inverse kinematics for characters: hands and feet that reach the points of what a body holds or uses, and held props set against the body. | three.js | from anim, interact |
| [`interact`](plugins/interact/) | Entering and using vehicles and machines: boarding, sitting, climbing in and driving, as sequences of clips parented to the machine, with IK hands and feet. | three.js, anim, loader | for ik3d · from anim, box3dvehicle |
| [`light2d`](plugins/light2d/) | 2D lighting: an ambient darkness over the world and radial lights that cut through it. | render2d | |
| [`lights3d`](plugins/lights3d/) | Clustered Forward+ shading: as many point lights as a scene likes, each pixel lit only by the lights that reach it. | three.js, render3d | |
| [`loader`](plugins/loader/) | The asset pipeline: a catalogue of glTF models, textures, sprite sheets, Tiled maps, bitmap fonts, palettes, sounds and JSON, fetched and decoded once, preloaded, and sealed wads (AES-GCM) for art that may not be handed on. | three.js, fflate, fzstd | |
| [`local`](plugins/local/) | Client-only actors spawned from prefabs: effects and props with no row and no network cost. | | |
| [`mapgen`](plugins/mapgen/) | Procedural level generation from a recipe and a seed: rooms carved into a Tiled map, set pieces and actors placed, the same level for the same seed. | math | |
| [`math`](plugins/math/) | Deterministic math: `sin`, `cos`, `atan2`, `exp`, `log`, `pow` and the rest, bit-identical on Node and every browser, so prediction never drifts. | | |
| [`nav`](plugins/nav/) | Pathfinding on grids: windowed A*, distance fields, line of sight and string-pulled routes. | math | |
| [`ocean3d`](plugins/ocean3d/) | An FFT ocean from a JONSWAP spectrum, with foam and shoaling over the seabed, deterministic so a boat floats the same on the server and every client, and the wave height anywhere. | three.js, render3d | from skydome3d, terrain3d |
| [`pancamera`](plugins/pancamera/) | An RTS camera in 2D: edge scrolling, keyboard panning and mouse-wheel zoom inside bounds. | render2d | |
| [`particle2d`](plugins/particle2d/) | 2D particle effects spawned by the rules or the page, synced on a ledger, no network cost per particle. | render2d, loader | |
| [`particle3d`](plugins/particle3d/) | 3D particle effects (sparks, smoke, blood, trails) spawned by the rules or the page, synced on a ledger, no network cost per particle. | render3d, loader | |
| [`party`](plugins/party/) | A party system: invites, a leader, kick and promote, member frames with health, kept in the hub and mirrored into every scene a member is in. | PixiJS, ui | from chat |
| [`persist`](plugins/persist/) | Saved games and persistent characters: a rule claims its records and gets them as rows. | persist addon | |
| [`player`](plugins/player/) | Input and possession: keyboard, mouse, drag and gamepad sent as acts on the seat's row, rebindable actions, and getting in and out of vehicles, mounts and turrets. | player addon | |
| [`playtester`](plugins/playtester/) | Bots that play the game through the same input path a person uses, for automated playtests. | player | |
| [`ragdoll3d`](plugins/ragdoll3d/) | Ragdolls on Mixamo skeletons, physics in box3d, deterministic on every seat: death from the blow's direction, lying where it fell, and getting up. | three.js, anim, box3d, hitscan3d | for box3d, hitscan3d · from anim, scatter3d, terrain3d, walker |
| [`render2d`](plugins/render2d/) | The PixiJS 2D renderer: world layers, a camera with zoom, pixel-perfect integer scaling and sharp HiDPI. | PixiJS | |
| [`render3d`](plugins/render3d/) | The three.js renderer: shadow maps, GTAO ambient occlusion, bloom, neutral tone mapping and exposure, and a camera other plugins claim. | three.js | |
| [`renderdom`](plugins/renderdom/) | An HTML and CSS layer scaled over the game canvas, for menus and text as real DOM elements. | | |
| [`roomcamera`](plugins/roomcamera/) | A room-by-room camera for top-down adventures: held inside the room, sliding to the next as the player walks through. | render2d | |
| [`scatter3d`](plugins/scatter3d/) | Procedural vegetation and rocks: forests, grass and boulders as instanced meshes, each placed by a pure function of its cell, streamed round the camera, trunks and rocks solid to bodies and bullets, the same on the server and every client. | three.js, box3d | for box3d, cover3d, hitscan3d, ragdoll3d, terrain3d, walker · from box3dvehicle, terrain3d |
| [`scenemanager`](plugins/scenemanager/) | Scenes and levels: title screens, menus and levels as scenes of one game, a seat moved between them. | scenemanager addon | |
| [`shipped`](plugins/shipped/) | A game's own plugins, loaded from its folder. | | |
| [`skydome3d`](plugins/skydome3d/) | Dynamic sky and weather: a day-night cycle, sun and moon, clouds and their shadows, fog, rain, snow, dust, wind and lightning, the same on every seat. | three.js, loader, render3d | for ocean3d · from terrain3d |
| [`solids`](plugins/solids/) | Low-poly models made of solids in JSON: procedural meshes for machines and props, and static props stood on the ground. | render3d, loader | from terrain3d |
| [`sprite2d`](plugins/sprite2d/) | Sprite-sheet animation in 2D: animated frames, facing, drop shadows, per layer. | render2d, loader | |
| [`sprite3d`](plugins/sprite3d/) | Billboard sprites in 3D: sprite-sheet characters that turn to face the camera and stand on the floor. | render3d, loader | |
| [`stats`](plugins/stats/) | An FPS, frame-time and heap panel (three.js's stats). | three.js | |
| [`store`](plugins/store/) | Client-side settings: volume, brightness, rebound keys, kept across scenes and never sent to the server. | | |
| [`synthaudio`](plugins/synthaudio/) | Music as notes on Tone.js: a song as one JSON file in sixteenths, a compressor and limiter on the master, echo sends, played live from keys. | Tone.js, loader | |
| [`terrain3d`](plugins/terrain3d/) | Infinite procedural terrain: heights from a field of noise nodes with domain warp, biomes, texture layers placed by rules, sea and flooding, geometry rings that follow the camera, baked ground textures, web workers, and height and ray queries the same on the server and every client. | three.js, loader, box3d, scatter3d | for box3d, box3dvehicle, cutscene, dismember3d, flight3d, hitscan3d, ocean3d, ragdoll3d, scatter3d, skydome3d, solids, walker · from scatter3d |
| [`tilemap`](plugins/tilemap/) | Tiled maps (`.tmj`): queries for the rules, layered drawing, edits while the game runs, and Box2D colliders. | render2d, loader, box2d | for box2d |
| [`ui`](plugins/ui/) | The HUD and menus on PixiJS: anchored panels, buttons, bars, text styles, modals, keyboard and gamepad focus, sharp at any scale. | PixiJS, player | |
| [`vision`](plugins/vision/) | Fog of war over a 2D map: what the team sees now, what it has seen, what it never has. | render2d, vision addon | |
| [`volley2d`](plugins/volley2d/) | Bullet-hell patterns: every bullet a closed-form function of its volley's age, no rows, hits checked on the server, hundreds on screen at the network cost of the volleys that fired them. | render2d, loader | |
| [`volley3d`](plugins/volley3d/) | Projectiles in 3D: rockets, shells, grenades and missiles in flight, splash damage, trails and explosions. | loader, particle3d | from hitscan3d |
| [`walker`](plugins/walker/) | A kinematic character controller: walking, sliding and seeking on any terrain, round trees and rocks. | hitscan3d | for hitscan3d, ragdoll3d · from scatter3d, terrain3d |

### Addons

An addon holds a truth: seats, connections, sockets, files, timers, more than one truth, what a
packet carries. It runs where the truth is.

| addon | what it does | built on |
|---|---|---|
| [`accounts`](addons/accounts/) | Login: a connection is signed in before anything it sends reaches the game. | persist, loopback |
| [`heard`](addons/heard/) | A log of the messages each step answered, for tests and the simulator. | rewind |
| [`interest`](addons/interest/) | Interest management: each seat sent only the rows within a radius of it. | |
| [`loopback`](addons/loopback/) | An in-memory transport, with a bad network of any shape when given one. | |
| [`persist`](addons/persist/) | Persistence: records loaded into a game as rows and saved as they change. | rewind |
| [`player`](addons/player/) | Seats: a connection takes a slot and gets its `player` row; server-authoritative input. | rewind, vision |
| [`predict`](addons/predict/) | Client-side prediction: the page runs its scene ahead of the server, so a press is drawn on the next frame at any latency. | player, rewind |
| [`recorder`](addons/recorder/) | Deterministic record and replay: any step rebuilt by booting again and replaying the inputs. | loopback |
| [`rewind`](addons/rewind/) | Server-side rollback: a late press put back on the step it was made on. | |
| [`scenemanager`](addons/scenemanager/) | Many scenes running in one server process, and seats moved between them. | loopback, player, rewind |
| [`simulator`](addons/simulator/) | A network simulator: pages and server under any latency and loss, with no wall-clock time, every frame and packet logged as JSONL. | heard, loopback, player, predict, socket |
| [`socket`](addons/socket/) | The WebSocket transport, with binary frames for physics snapshots. | ws, loopback |
| [`vision`](addons/vision/) | Server-side fog of war: each team sent only the rows it sees, so a hacked client sees nothing more. | |

## The model

- A **scene** is a file: how a world starts and which plugins it uses. Its `world` holds its fixed
  numbers, its `prefabs` what a new row of each kind starts as, and its `actors` the rows it starts
  with. A game's manager scene holds its scenes.
- A **row** is one thing in the world, and its **kind** is what it is. A kind's code is its actor:
  its rule, `<kind>.sim.ts`, run on the server every step, and its look, `<kind>.client.ts`, run in
  the page.
- A running world is a **truth**, and one tick of its time a **step**. Every step it sends each
  seat a packet of the rows it may see.
- A **seat** is a player's place in a truth. What it plays as is its own `player` row, and a
  press is a message asking that row to act.
- A **plugin** lives in the world or in the browser; an **addon** holds a truth. The engine,
  [`engine/`](engine/), is frozen; everything new is a plugin, an addon, or a game's own kind.

## Requirements

- Node 22.6 or later (it runs TypeScript with `--experimental-strip-types`).
- Yarn 1.
- To bake art: Blender, the library of raw parts the bakes read, the native gltfpack 1.3 or later
  (it packs WebP textures; the npm one cannot), and ImageMagick built with libwebp. Copy
  `.env.example` to `.env` and set `BLENDER`, `PATCHWORK_LIBRARY`, `GLTFPACK` and `MAGICK` where
  yours differ from the defaults it lists. Playing a game needs none of them.

`yarn health` checks all of it: it runs each tool and prints what passes, what fails and how to fix it.

## Getting started

```
git clone --origin upstream https://github.com/outsidedata/patchwork.git mygame
cd mygame
yarn install
yarn new-game mygame
yarn vite --port 5173
```

Then open `http://localhost:5173/games/mygame/index.html`.

`--origin upstream` names Patchwork's remote `upstream`, leaving `origin` for your own repo.

`yarn new-game <name>` writes `games/<name>/`: one scene, `main`, on render2d, with a seat that
starts at a `start` actor and moves a square with the arrow keys. `index.html` plays the whole game
in one tab. For players together, run its server with
`node --experimental-strip-types games/<name>/<name>.server.ts` from the repo's root and open
`client.html`, one window a player. Run `yarn new-game` again to make a second game.

The example games are in their own repo, `outsidedata/patchwork-games`. Clone it as `games/`:

```
git clone https://github.com/outsidedata/patchwork-games.git games
```

and open any of them as `games/<game>/index.html`.

## Commands

| command | what it does |
|---|---|
| `yarn health` | Whether this machine has what core needs: node, the packages, and for baking, Blender, the library, gltfpack and ImageMagick. |
| `yarn new-game <name>` | `games/<name>/`: a game of one scene and a seat. |
| `yarn bake <game>` | The game's art made again from the library: every glb its scripts build, packed, and its cc0 texture maps cut. |
| `yarn produce_static_site <game> [--base /<path>/]` | The game's `index.html` as a static site in `dist/`, its page at the site's root. `--base` is the path the host serves it under, `/<repo>/` on GitHub Pages. |
| `yarn test` | Every test but the ones that draw a game in a page. |
| `yarn test:view [<file>]` | The tests that draw a game in a page (`.view.test.tsx`). |
| `yarn vitest run <file>` | One test file. |
| `yarn tsc` | The typecheck. |
| `yarn lint` | ESLint. |

## Putting a game online

`yarn produce_static_site <game> --base /<repo>/` writes `dist/`, the game's `index.html` with
every file it reaches, compiled to JavaScript, so any static host serves it. For GitHub Pages, a repo
of your game with a workflow that runs it on every push and uploads `dist/` puts the game at
`https://<owner>.github.io/<repo>/`. How the site is laid out is the header of
[`scripts/produce_static_site.ts`](scripts/produce_static_site.ts); serving the game's own server for
players together is [`publishing-a-game`](.claude/skills/publishing-a-game/SKILL.md).

## For agents

Start at [`.claude/CLAUDE.md`](.claude/CLAUDE.md): the commands, and where every fact lives. Then
[`prime-directive`](.claude/skills/prime-directive/SKILL.md): the engine is frozen, where every new
thing goes, and which phase skill carries each kind of work. Beside it in
[`.claude/skills/`](.claude/skills/) are the phase skills: making a game (`starting-a-game` through
`auditing-a-game`) and distributing it (`going-multiplayer`, `persisting-players`,
`committing-a-game`, `publishing-a-game`).

Whether a game can be built on Patchwork is answered from the tables above and the headers of those
files: each says what the piece does, what it is handed and what it hands back.

## Your repo

It has two remotes:

- `upstream`: Patchwork. You read from it and never push to it.
- `origin`: your own repo, which you add when you make it (`git remote add origin <url>`, then
  `git push -u origin master`).

Everything you change is a commit in your repo: your game, a new plugin such as
`plugins/terrain4d/`, an edit to Patchwork's own `plugins/terrain3d/`. You push to `origin`.

## Taking updates

1. `git fetch upstream`: downloads Patchwork's new release. It changes none of your files.
2. `git switch -c update-core`: a branch to merge on, so `master` is untouched until the merge is
   proven.
3. `git merge upstream/master`: joins Patchwork's changes into yours.
4. `yarn install`, `yarn tsc`, the tests beside what Patchwork changed, and your game played.
5. `git switch master`, `git merge update-core`, `git push origin master`.

Each release of Patchwork is one commit, tagged with its date. A game made on an older release runs
on it: `git clone --branch <tag> --depth 1 https://github.com/outsidedata/patchwork.git`.

Git merges line by line, file by file:

- A file only you have (`plugins/terrain4d/`, `games/mygame/`): Patchwork has no such file, so the
  merge never touches it.
- A file only Patchwork changed: takes Patchwork's version.
- A file both changed, in different places: both changes kept.
- A file both changed on the same lines, a file one side deleted and the other changed, or a file
  both created at the same path (Patchwork later ships its own `terrain4d`): the merge stops and
  names the file, with both versions marked inside it. Nothing is overwritten. You, or your agent,
  write what the lines should be and commit; `git merge --abort` puts everything back as it was
  before step 3.
- `yarn.lock` in conflict: take Patchwork's (`git checkout --theirs yarn.lock`) and run
  `yarn install`, which writes it again with both sides' dependencies.

A merge with no conflict can still break your game: Patchwork renames a function `terrain4d` calls,
and the lines never touched each other. Step 4 is how that is found: `yarn tsc` names every call
that no longer matches, and the tests and the game show the rest.

## Giving back

A plugin worth having in Patchwork goes to it as a pull request from a fork of
`outsidedata/patchwork` on GitHub; once merged, the next update brings it back as Patchwork's. The
steps are in [`publishing-a-game`](.claude/skills/publishing-a-game/SKILL.md), Giving back.

## Licence

MIT ([`LICENSE`](LICENSE)), Copyright (c) 2026 Outside Data. Make games, sell them, keep the money.
