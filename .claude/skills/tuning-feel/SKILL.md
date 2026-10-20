---
name: tuning-feel
description: Use in core, or any clone of it, when making a game feel right - how fast a thing speeds up, stops, turns, jumps or falls, and where those numbers go (a kind's definition in `assets/<game>.json`, `world`, `world.<plugin>`). It covers the physics and movement plugins (box2d, box3d, box3dvehicle, walker, flight3d, ragdoll3d, volley2d, volley3d), a camera that follows (chasecamera3d, pancamera, roomcamera), the step rate (`engine.dt`, `scenemanager.dt`), a press that should feel instant (prediction, `world.player.steps`), tuning a number while the game runs in the editor (inspector, timeline, step, seek, replay) or in `dev.html`, and measuring feel with tests and the simulator instead of guessing. Triggers on "feels floaty", "sluggish", "slippery", "heavy", "too fast", "laggy", "it snaps", "rubber-banding", "acceleration", "friction", "drag", "gravity", "jump height", "top speed", "tune the movement", "game feel".
---

# Tuning feel

Feel is numbers and the law that uses them: how fast a thing speeds up and slows down, what it
keeps from one step to the next, how a press reaches it, and how the camera sits on it. This work is
finding those numbers, putting each in its one home, turning them while the game runs, and proving
with a measurement that the game does what was meant.

Other work has its own skill. A new kind and its rules: `designing-a-kind`. Keys, actions, the
stick's deadzone, key repeat, seats and ledgers: `input-and-seats`. A bad network, a second seat,
the server on node: `going-multiplayer`. Tests, bots and the simulator in general: `proving-a-game`.
Walls, ground and collision with the level: `building-a-level`. A new game and its first `dev.html`:
`starting-a-game`. The craft of a 3D camera (stutter, judder, damping in the subject's frame):
`building-3d-cameras`. A flight model on top of `plugins/flight3d`: `flight-simulator-design`. A
panel in the editor for a plugin's numbers: `building-an-extension`. This skill points to them and
does not repeat them.

## Where every knob is

Every number has one home, by the prime directive's first question.

- What changes while the game runs is on the row, and its starting value is a field of the kind's
  prefab in the scene file. A body that speeds up remembers its speed, so `vel` is a field of its row
  and of its prefab: the next step reads it, the page runs it ahead, and a browser that arrives later
  is sent rows and nothing else. Never a module variable or a closure.
- What a kind is tuned by and never changes is its definition: its entry in the data file the
  scene's `world.defs` names (`assets/<game>.json`), read with `def(w, me.kind)` in its rule and
  `def(plugins.wire, row.kind)` in its look (`plugins/loader/loader.sim.ts`). Never on the row, which
  goes to every seat every step, and never a number in code.
- A plugin's fixed numbers are `world.<plugin>`, always: its server half reads `w.world.<plugin>`,
  its browser half `plugins.wire.scene.world.<plugin>`, whether it has a row or not, never its
  prefab. A child scene's `world` is the manager's with its own over it, key by key
  (`addons/scenemanager/scenemanager.addon.ts`), so a table every scene uses is written once in the
  manager's file.
- A scene's own few numbers are fields of its `world`.
- Never a setting only one game would set. A plugin that does not do what one game wants (a camera
  that eases, a coyote time on a jump) is not given a field for that game: the game's kind does it,
  its numbers on its definition. What is general and missing is built in the plugin, set from
  `world.<plugin>`, tested there, and used by every game it belongs in.

What the movement and camera plugins read, each from its own header:

| plugin | its fixed numbers | what the rows carry |
| --- | --- | --- |
| `box2d` | `world.box2d`: `subStepCount`, `static` and `kinds` required, `gravity`, the contact and sleep fields, `rollback`; `world.box2d.kinds.<kind>`, the Body: `linearDamping`, `gravityScale`, `shapes` with `density` and `material` (`friction`, `restitution`) | a body's `pos`, `rot`, `vel`, `spin`; a rule writes `force` and `torque` (held), `pushes` (one step's impulses), `target`, `wind` |
| `box3d` | `world.box3d`: `subStepCount`, `static` and `kinds` required, `gravity`, the contact and sleep fields and `enableSpeculative`, and no `rollback`; `world.box3d.kinds.<kind>`, the Body, a shape's surface under `baseMaterial` | a body's `pos`, `rot` (a quaternion), `vel`, `spin`, `force`, `torque`, `pushes`, `target`, `wind`, and `friction` over its shapes' |
| `box3dvehicle` | `world.box3dvehicle.vehicles.<name>`: `body`, `axles` (`wheel.friction`, `spring`, `damper`, `bumpStop`, `antiRoll`), `engine`, `steering` | `throttle`, `brake`, `steer`; it writes `compression`, `load`, `grounded`, and for a petrol or electric engine `rpm` and `torque` |
| `walker` | `world.walker.kinds.<kind>`: `accel` (the rate a second `vel` eases toward `want` by, the law's `friction` in step 1, not a push), `turnRate`, `turnMax`, `gravity`, `jumpH`, `step`, `maxSlope`, `slide`, … | `pos`, `yaw`, `vel`, `grounded`; the rule sets `want` (its speed, a number of its kind's definition, times `relative(stick, yaw)`), `face`, `jump` |
| `flight3d` | `world.flight3d`, every field required: `gravity`, `air`, `materials` (what an airframe's mass is priced from), `planes.<name>` (its `airframe`, the sheet, and `gear`), `overspeed`, `sweep` | the stick `pitch`, `roll`, `yaw`, `throttling`, `airbrake`, `brake`, `gearDown` |
| `ragdoll3d` | `world.ragdoll3d`: `damp`, `friction`, `iter`, `vmax`, `limits`, … | the dying row's `limp`, `limpFor`, `blow`, `pose` |
| `volley2d` | the patterns file `world.volley2d.patterns` names: each emitter layer of a pattern, its `speed`, `accel`, `min`, `max`, `curve`, `life`, … | the ledger row |
| `volley3d` | the patterns file `world.volley3d.patterns` names: each pattern's `speed`, `accel`, `max`, `g`, `life`, `seek`, …; a field it does not know throws | the ledger row |
| `chasecamera3d` | none | the followed row's `pos`, `lift`, `look` `{ yaw, pitch, dist, side }` |
| `pancamera` | `world.pancamera`: `speed`, `edge`, `keys`, `zooms`, `notch`, `bounds`, `look` | none |
| `roomcamera` | none | none: an actor hands `look` the point and its room each frame |
| `player` | `world.player.steps`, `world.player.window`, `world.player.ledgers` | the `player` row |

Two homes meet on a body a plugin moves. What the plugin does with it is the plugin's numbers, under
the kind's name in its table: how a box2d body collides and damps (`world.box2d.kinds.<kind>`), how
a walker eases, falls and jumps (`accel`, `gravity`, `jumpH` in `world.walker.kinds.<kind>`). What
the kind's own rule decides is the kind's definition: how hard it pushes the box2d body, how fast it
asks walker to go. box2d and box3d take a field left out as the library's own default; walker checks
its table and throws naming a number that is missing or out of its range.

The step rate is one number written three times, and `yarn new-game` writes all three as 1/60: the
manager's `prefabs.engine.dt` in `<game>.scene.json` (what `index.html`, `<game>.server.ts`, the
recorder and the editor's clock step the manager by), the manager's `prefabs.scenemanager.dt` beside
it (what each child step is handed), and each child scene's `prefabs.engine.dt` (what the page's
player steps its own rows by and turns milliseconds into steps with). Changed, all three change
together: observed with `scenemanager.dt` at 1/30 and the child's at 1/60, a three-second simulator
run corrected the page 91 times, by up to 32 px. Nothing in core places a row between two steps: a
frame draws the rows of the step the page is on (`engine/browser.ts`), so motion is as fine as the
step rate, and a 120 Hz display draws each step on two frames.

## The work, in order

### 1. Write the motion as a law of the definition's numbers

A thing that moves at a fixed speed starts and stops on one step and feels like a cursor. Give it a
law instead, its numbers on its definition, so the top speed, how soon it gets there and how far it
glides are what the numbers make rather than numbers of their own. The game `yarn new-game` writes
runs its body at `speed`; turned into a body that speeds up and glides:

```ts
// body.sim.ts: dv/dt = accel·move − friction·v, `accel` and `friction` its definition's. `glide` is
// the law solved over one step of `dt`: the velocity a step takes `vel` to under `move`.
export function glide(vel: number[], move: number[], accel: number, friction: number, dt: number): number[] {
  const keep = Math.exp(-friction * dt)
  const gain = friction > 0 ? (1 - keep) / friction : dt
  return [vel[0] * keep + accel * move[0] * gain, vel[1] * keep + accel * move[1] * gain]
}

// in `body`:
tick(me, dt, w) {
  const [mx, my] = me.data.move
  const [vx, vy] = me.data.vel
  if (!mx && !my && !vx && !vy) return
  const { accel, friction } = def(w, me.kind)
  const vel = glide(me.data.vel, me.data.move, accel, friction, dt)
  me.data.vel = vel
  me.data.pos = [me.data.pos[0] + vel[0] * dt, me.data.pos[1] + vel[1] * dt]
},
```

with `"body": { "accel": 1800, "friction": 7.5, … }` in `assets/<game>.json` and `"vel": [0, 0]` in
the body's prefab. Held, it closes on accel / friction, 240 px/s, by 1 − e^(−friction·t), nine tenths
of the way in ln 10 / friction, 0.31 s; let go, it glides top / friction, 32 px. The step solves the
law exactly over its dt, so the same definition moves at the same speeds stepped 30, 60 or 120 times
a second; observed with the Euler step `v += (accel·move − friction·v)·dt` planted in its place, it
ran at 197 px/s where the law says 186 after 0.2 s at 30 Hz. walker eases `vel` toward `want` the
same way, by 1 − exp(−accel·dt): its `accel` is a rate a second, this law's `friction`, and its top
speed is the `want` the rule asks for. The law holds at every value a person can type into the
definition, 0 among them: the `gain` above keeps friction 0 from dividing by it.

The rule reads `def` where it uses the number, every step: a number kept in a module variable from
an earlier read is never the one the editor or `dev.html` changed. An actor that reads its definition
in `setup` takes a change when the editor sets it up again, which an edit of the data file does, and
never from a key of `dev.html`.

When the law changes, the test `yarn new-game` wrote beside the manager, `<game>.sim.test.ts`, which
checks the body runs at `speed`, changes with it.

### 2. Choose how a press is run ahead

A press goes up the wire and the server runs it when it arrives, so a press nothing runs ahead is
drawn a round trip late. `plugins/player/player.plugin.ts` runs it ahead on the page two ways, and
the scene's `world.player.steps` chooses. Both place the page's step by a clock of the page's own,
placed from the packets taken in the last `world.player.window` seconds, 2 when the scene gives none.

- Left out: the press's act runs at once on a copy of the rows; when it wrote only the row it names
  or the row it called with `w.call`, that row is drawn from the copy, and that row's own `before`,
  `tick` and `after` run on the page every step, so a `vel` on the row is run ahead with it. Each
  packet's rows are taken as they come and every press no ack covers is run again on them. The page
  runs half a round trip ahead, measured only from presses, so the first press runs with none. A
  press whose act writes to or calls a row of a plugin's kind (a `quit` calling `go` on the
  `scenemanager` row) is not run ahead at all and waits a round trip for the packet, unless that
  kind is a ledger the scene names in `world.player.ledgers` (a sound on `audio`'s, an effect on
  `particle3d`'s, a round on `volley3d`'s): what the run writes to or calls on a ledger is dropped,
  the rest of the press is drawn at once, and the event comes once, from the packet. Ledgers are
  `input-and-seats`'.
- `true`: whole steps, for state a single row's rule cannot be run ahead without, held outside the
  row: box3d's world and box2d's, box2d keeping its solver's memory through a correction with
  `world.box2d.rollback`. The page keeps rows of its own and runs every row's `before`, `tick` and
  `after` over them. A press is stamped with the page's step, and the server holds it for that step
  and applies it there. The page runs a whole round trip ahead, measured by probes from the moment
  it joins. A packet is compared with the page's rows after the same step, and only a difference is
  corrected. What it costs:
  - a step that spawns, ends a row, rolls the die or writes the world is not run on the page, which
    holds at the last packet until the next;
  - every row a step reads must be sent to the seat;
  - every kind the seat is sent a row of needs a rule the page can load, `<kind>.sim.ts` next to the
    page or `plugins/<kind>/<kind>.sim.ts`; a kind with neither, as a game's own plugin's is, makes
    the page's frame throw.

Whole steps are chosen for state held outside the row, or when a simulator run (step 6) shows the
default snapping, as it did on the body of step 1. Observed over a 100 ms round trip with 10 ms of
jitter: on the default the first press was drawn one step on, held there four frames, taken back for
two, then jumped 4 px, and after a let-go the drawn body ran up to 2.8 px from the server's for a
round trip and jumped back; on whole steps the same run drew the server's body at every step,
corrected nothing, and drew the press on the frame after the key.

The game `yarn new-game` writes meets the second cost once it has two seats. Every seat is sent only
its own `player` row (`addons/player/player.addon.ts`), and the body's `before` ends the body when no
`player` row names it, which on a page ends every other seat's body: the page refuses every step and
draws only packets (observed with two seats: the press 136 ms late, frames moving 0, 1 or 2 steps).
So the generated game goes on whole steps with one seat only. A game that needs two seats on whole
steps fixes this first, in `plugins/player` or `addons/player` with the test beside what changes.
`addons/player`'s header prescribes the self-ending public row and the template writes it
(`extensions/games/games.route.ts`, tested by `extensions/games/games.route.test.ts`), so by "When old
code disagrees" the header, the template and every game built on it, with their tests, migrate in
the same change.

### 3. Prove the law and the press with a test beside the rule

`<kind>.sim.test.ts` beside `<kind>.sim.ts` boots the game's manager, joins a seat with
`connection(manager(truth), send)`, presses through it with `seat.take({ scene, seat, msg })`, and
reads what the kind wrote off the rows. For the body it checks:

- the closed form: the first step at nine tenths of top speed is step ceil(ln 10 / friction / dt),
  held three seconds it is at accel / friction, and let go it glides top / friction to within a
  step's travel;
- the step rate: the law at 1/30, 1/60 and 1/120 gives the same speed at the same moment, to nine
  places. The test never changes the scene in memory to get there (`proving-a-game`). It calls the
  law the rule steps by, `glide`, with the definition's `accel` and `friction` read off
  `assets/<game>.json`, stepping each rate to the same moment; or it writes a manager and a child scene
  file of its own at each rate, its three `dt`s set together, into a temporary folder, with a
  `<scene>.sim.ts` importing the game's kinds by their absolute paths, and boots each through `load`,
  as a plugin's test writes its game;
- the press, through `simulate` (`addons/simulator/simulator.addon.ts`): the press check, whose one
  list is `going-multiplayer`'s (How it is proven), every fact of it for each page, the frame-by-step
  comparison among them, which is what catches a snap that `corrections` never counts on the default.
  For tuning, one page on a `{ hz: 60 }` display with `up` and `down` legs of
  `{ delay: 50, jitter: 10 }`, and `watch` `{ kinds: ['body'], fields: ['pos'], own: 'body' }`.

Each check is seen to fail before it is trusted: observed, with `world.player.steps` taken out the
press check failed (480.47 drawn where the server had 480), and with the Euler step the step-rate
check failed. Run the files beside what changed, `yarn vitest run games/<game>/body.sim.test.ts`.

### 4. A testbed that turns the numbers while the game plays

`dev.html`, beside `index.html`, is `index.html` with changes made before the boot, over a
loopback, and the one place a shortcut is allowed. `yarn new-game` does not write it. For tuning it
holds:

- The definition overridden. The tab holds one decoded copy of each data file, which the truth's
  rules, the page's own steps and every actor's `def` read alike, and `jsonAt(name, url)` hands it
  out. A number written into it moves the body from the next step, on the server's side and the
  page's together:

  ```js
  import { jsonAt } from '#plugins/loader/loader.sim.ts'
  import main from './main.scene.json'
  // after `await load(truth, import.meta.url)`, before the loop
  const { defs } = main.world
  const table = await jsonAt(defs, main.world.loader.assets[defs].url)
  table.body.friction = Number(new URLSearchParams(location.search).get('friction') ?? 3)
  ```

- Every override of a scene file, a prefab or `world` before `load`. `load` boots each truth from the
  imported scene file there and then, its `world` copied and its actors made into rows, so a change
  made after it reaches no truth's `world` or rows; the page's client takes the imported file again
  when `view` makes it, so the page draws a number the server never steps with. A number to turn
  while the game plays is a definition, through `jsonAt` above, or for box2d and box3d a field of the
  world's row (`gravity`, `subStepCount`, …) or of a body's row (`linearDamping`, `gravityScale`, …,
  and box3d's `friction`), which they push into the live world each step it differs; `load` hands
  back the truths whose rows those are.
- Keys of its own that turn a number by a fraction, and a readout of the numbers, what they make (top
  speed, the seconds to nine tenths of it, the glide) and the speed of the seat's body as the page
  draws it, read off the client `view` mounts (`client.plugins.wire.rows`). A scene that lists
  `stats` gets its frames a second shown once `dev.html` mounts it,
  `me.plugins.stats?.mount(document.body)`.

Nothing of it bleeds out: no scene file, rule, actor, plugin, extension or test reads it, and the game
plays the same with it deleted. What feels right is written into the definition file by hand; no
line of `dev.html` is copied into `index.html`.

### 5. Turn it in the editor, against one recorded run

`yarn editor <game>` plays the game under the `recorder` addon (`addons/recorder/recorder.addon.ts`),
which journals everything that reaches the truth. A step is rebuilt by booting again from the files
and replaying the journal up to it; that is how time goes back, and how a number is tuned against
the same input every time. A message the seat sends at a step below the recording's end takes over:
every entry after that step is dropped and the recording goes on live from there. An edit below the
end is kept with the rest of the recording.

- The timeline (`extensions/timeline/timeline.extension.tsx`): play, pause, step (`.`), step back
  (`,`), seek along the ruler, speeds from 0.1 to 4, and the commands `game.run`, `game.seek`,
  `game.back`, `game.speed`, `game.state`, `game.restart`, `game.cut`.
- The Inspector (`extensions/inspector/inspector.extension.tsx`): a row's live data edited from this
  step on, an edit the recording keeps (`inspect.set`); a scene's `world` and prefabs; and a data
  file, a scene's definitions shown an entry per kind (`inspect.file`, `inspect.edit`). An edit to a
  file writes that one value, is one undo, and rebuilds the step it is at from step 0 with the new
  number, so the presses already recorded play again under it. Observed on the body: `move` set at
  step 65, 30 steps run, `vel` 234.36; `friction` set to 3 in the definition, the same step 95
  rebuilt, `vel` 466.12, which is 600 × (1 − e^(−1.5)); Undo, and 234.36 again.
- A plugin that ships a panel for its numbers, each change one value and one undo:
  - the Vehicle panel (`vehicle.state`, `vehicle.drive`, `vehicle.design`) and the Flight panel
    (`flight.state`, `flight.stick`, `flight.design`) set a car's or a plane's inputs on the live row
    and write `world.box3dvehicle` or `world.flight3d`, beside what the numbers make: how often a car
    bounces on its springs and its dampers' ratios to critical, a plane's top and stall speed;
  - the Patterns panel (`volley2d.patterns`, `volley2d.pattern`, `volley2d.rename`, `volley2d.plot`,
    `volley2d.fire`) and the Patterns 3D panel edit the patterns file a field at a time, plot a
    pattern without firing it, and fire it as a preview through the view's client, again whenever
    the last is gone, so an edit shows on the next volley; their tools, Fire Pattern (B) and Fire
    Pattern 3D (N), fire it where the view is pressed.
- In Play (Escape) the game view has the keys while it has the focus, which a click on it gives
  (`extensions/game/game.extension.tsx`, `editor/gate.ts`). In a tool a click is the tool's: in
  Select (V) it selects the row under the pointer and a drag moves it, one edit from this step on. A
  call has no keys: it sets the intent a press would, `move` on the row through `inspect.set`, or a
  plugin's own command.

The page's clock (`paced` in `plugins/player/player.plugin.ts`) moves by the page's real time, so
while the editor's clock is paused or slowed the page runs its predicted rows, or its whole steps,
ahead of the step the timeline shows (observed on whole steps: paused at step 80 the view drew step
5760, its body 23,000 px off the canvas; slowed to 0.25 the truth was at step 45 and the view at
7777). When the job meets it, the clock is fixed in `plugins/player` with a test beside it
(`plugins/player/player.plugin.test.ts`), and the comment in `editor/session.ts`'s `frame` that says
a client that predicts runs nothing ahead while paused is corrected in the same change.

### 6. Measure, never guess

- What the numbers make is arithmetic: put it in the readout and in the test, and the feel is
  stated, not eyeballed. "Floaty" is a glide too long for its top speed; "sluggish" is too many
  seconds to nine tenths.
- The simulator plays pages against a server on one timeline, with the real engine, scenemanager,
  loopback, player and the game's own rules and actors, and writes every frame, step, packet and
  message. From node: `node --experimental-strip-types addons/simulator/simulator.addon.ts run
  <config.json> [out.jsonl]`, a config being a `Run` with `game`, the manager scene file's path, in
  place of `file`, `sim` and `base`, and `seed` and `ms` required. Rows are recorded only when it
  gives a `watch` (`kinds`, `fields`, `own`). It prints the steps each frame moved (`histogram`), the
  lead, the corrections and the largest (whole steps' only), the late presses, and `standoff`, how
  much the distance from the camera to the seat's own row changes frame to frame, a camera that
  judders changing it every frame; `standoff` needs a camera that exports `eye()`, an actor's, or
  `chasecamera3d`'s or `cutscene`'s. The JSONL's frame records hold the drawn rows and step, its step
  records the server's rows; laid side by side they show a snap that no number in the summary names.
- A real browser records the same frames from
  `client.html?tap=<name>&kinds=<kind,…>&fields=<field,…>&own=<field.field>`, kept by the simulator's
  routes (`addons/simulator/simulator.route.ts`) and shown in its Runs panel; without `kinds`,
  `fields` or `own` in the address no rows are recorded. Bad networks and their shapes are
  `going-multiplayer`'s, and the simulator's every record and part `proving-a-game`'s.

## Cameras

A camera is felt as much as the body it follows. `chasecamera3d` is a rigid orbit on one row: the
row's `pos` raised by `lift`, the eye `look.dist` out along `look.yaw` and `look.pitch`, `look.side`
to the right. It adds no easing, floor or speed of its own: whatever turns or rises gradually is a
field of the row that the kind's rule moves at a rate, the rate on the kind's definition, and a camera
that shakes on a body that shakes is fixed in the body. It is listed after `render3d` and after
`player`, so it places the camera on the row as the page predicts it; listed otherwise its tick
throws. `pancamera` pans rigidly at `world.pancamera.speed`, carrying no speed from frame to frame,
inside `bounds`, through `zooms`, from `look`, the world point it looks at first; it is listed after
`render2d` and after `player`, or its tick throws. `roomcamera` has no numbers: an actor hands
`look` the point and the room each frame, and the walk from one room to the next. The craft of a 3D
camera is `building-3d-cameras`; its measure here is the simulator's `standoff`.

## What goes wrong

- A fixed speed where a law belongs, or a top speed typed beside `accel` and `friction`: the top
  speed is accel / friction, and a second number for the same fact leaves one of them wrong.
- A velocity integrated with Euler: the feel changes with the step rate. The law is solved exactly
  over dt, and a test runs it at three rates.
- walker's `accel` written as a push in units a second²: it is a rate a second, the law's `friction`.
- What a kind remembers kept anywhere but its row, or a definition number kept from an earlier read.
- A prediction mode chosen without a simulator run to show what it draws, or whole steps taken
  without their costs: a step that spawns, ends, rolls or writes the world, a row the seat is not
  sent, a kind with no rule the page can load.
- One of the three `dt`s changed alone.
- A defect met while tuning, the page's clock running ahead of a paused or slowed editor or the
  self-ending body on whole steps with two seats, worked around in the game, in the testbed or by a
  way of looking round it, instead of fixed in its home with its test.
- A plugin given a setting for one game, a camera's easing say, instead of a field the kind's rule
  moves at a rate.
- An override of a scene file, a prefab or `world` made in `dev.html` after `load`: the page draws it
  and the server never steps with it. Or a number found in `dev.html` and never written into the
  definition file.
- A simulator run with no `watch`, read for rows it never recorded; a summary's corrections read as
  proof the default drew no snap. The press check is `going-multiplayer`'s one list, the
  frame-by-step comparison in it.
- A check that has never been seen to fail.

## How it is proven

The kind's `<kind>.sim.test.ts` holds the closed form, the three step rates and the simulated press
(step 3), each seen to fail with its fault planted; the game's `<game>.sim.test.ts` follows the new
law. Then it is played: `dev.html` in Chrome with the override in place, the readout's top speed
matching the drawn speed when a key is held, a key turning a number and the drawn speed following;
and in the editor a recorded run replayed under a changed definition, the speed at the same step the
law's for the new number, and Undo bringing back the old.
