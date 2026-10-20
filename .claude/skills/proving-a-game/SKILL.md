---
name: proving-a-game
description: Use in core, or any clone of it, to show that a game or a piece of it works. That covers a test of a kind, a scene, a plugin or an addon (`<kind>.sim.test.ts`, `.test.ts` in node, `.test.tsx` in jsdom, `.view.test.tsx` and `yarn test:view`), a seat that plays itself with a think (the `playtester` plugin, the player addon's `playtest`), and pages played against a server over a bad network on the `simulator`, with its JSONL read back (`simulate`, its command line, `?tap=`, the Runs panel). It also covers a gym that plays a game many times with bots to measure it, steps rebuilt by replay under the `recorder`, playing the game in one tab, against its server or in `dev.html`, and looking at it in Chrome. Triggers on "test it", "prove it works", "is it done", "playtest", "bot", "autoplay", "lag", "packet loss", "measure it", "replay", "screenshot it", and on which of `yarn vitest run <file>`, `yarn test:view <file>`, `yarn tsc` and `yarn lint` to run.
---

# Proving a game

A game is shown to work by tests that boot it as its pages boot it and read what its kinds wrote
off the rows, by seats that play it, and by playing and looking at it. This skill is that work, from
the first test to the screenshot. Load `prime-directive` first; nothing here overrides it.

It does not cover building the thing being proven. Making the game and its `dev.html` is
`starting-a-game`; a kind's rule and look is `designing-a-kind`; keys, seats and slots are
`input-and-seats`; the server, more seats over a network, prediction and fog of war are
`going-multiplayer`; a panel or tool for the editor, and its test under the recorder, is
`building-an-extension`. Each of those ends here.

## The rules this work meets

From the prime directive, where proving meets them:

- A test sits beside the file it tests and is named after it: `body.sim.test.ts` beside
  `body.sim.ts`, `main.sim.test.ts` beside `main.sim.ts`, `<game>.sim.test.ts` beside the
  manager's sim. A file in a game folder is named after a kind, a scene or the game, and a test
  file follows the file it tests.
- A kind's test boots its game's manager, drives seats, and reads what the kind wrote off the rows.
  It never fakes what a plugin should do. Every value it checks against is read off the scene file
  and the definitions (`assets/<game>.json`), never typed again: a number, a count, a label, a key
  list, a slot list, the seats in a refusal, a scene's name. So is every input that works only
  because of the layout or a definition: a cell beside a start, a wall's row, a spot clear of every
  tree, an offset inside a reach, a list of moves that wins. It is derived from the map and the scene
  by the test, so it still works when they change, and never typed and then guarded by an assertion
  that it still holds. On a continuous track the same holds: into the wall is the road's outward
  normal at the point the body stands, worked out from the track's points, and how far the body went
  is distance measured along the road, never a typed axis such as `[1, 0]` or a distance as the crow
  flies. A loop's bound, a count of steps the test chose and an input no layout or definition decides
  are the test's own.
- A file the test reads beyond the scene file and the definitions it imports, a map, a track's
  points, a list of questions, is reached through its catalogue entry: `prepared(room.world,
  <name>)` with the name the scene's `world` or a definition gives, as `building-a-level`'s test
  reads its map, never a path typed into the test. The one literal path a test writes is the url a
  look's test checks the loader asked for, since checked against the entry's own url it passes with
  the slash missing (`bringing-in-art`). Nor does a test restate what a scene file says as it says
  it, a prefab's fields or a scene's `plugins` list: it proves what they do, the row a prefab starts
  as and what the rules then make of it, the drawing a listed plugin makes, the order a plugin must
  stand in.
- An addon's or a plugin's test boots a scene it writes itself. A test outside `games/` never uses
  a game in `games/`: core ships none. A test of a plugin on one game's content is that game's, in
  its folder.
- A piece that needs a page and a truth joined takes a transport and never joins them itself: a
  test that makes a page on a game makes it on `link(loopback(accept(manager(truth))))`, as
  `index.html` does, the recorder does and the simulator does. A copy of the wire works, passes its
  own tests and leaves the real one untested. The engine's own test is the one exception.
- `dev.html`, beside `index.html`, is the testbed: the one place a game is played to find
  something out with shortcuts. It is `index.html` with changes made before the boot. It may enter
  any scene directly (`file.prefabs.scenemanager.entry = '<scene>'`), override any value of a scene
  file, a prefab, `world` or a definition, start a seat already carrying things, and add readouts and
  keys of its own. It boots, mounts and steps as `index.html` does, over a loopback, and changes only
  the page's copy in memory, never a file. No scene file, rule, actor, plugin, addon, extension or
  test imports it, reads what it set or asks whether it is running, and the game plays the same
  with it deleted. What it finds that the game needs is built in its home. How it is written is
  `starting-a-game` (The testbed).

## Which test, which file, which runner

`vitest.workspace.ts` sorts tests by name:

- `<name>.test.ts` runs in node. The engine, addons, plugins, a game's kinds and scenes, and the
  editor's server are tested here, pages too: a `view` over the loopback runs in node, as
  `plugins/playtester/playtester.plugin.test.ts` and `addons/simulator/simulator.addon.test.ts`
  show.
- `<name>.test.tsx` runs in jsdom with Testing Library (`editor/test/setup.ts`): React, the
  editor's panels.
- `<name>.view.test.tsx` is a test that attaches a game view to the editor's session
  (`session.attach`, directly or through the Game panel), so the game's client is made and draws in
  jsdom. It sits beside `<name>.test.tsx`, never inside it. `yarn test` leaves it out, and
  `yarn test:view <file>` runs it. `plugins/volley3d/volley3d.extension.view.test.tsx` is one. A
  node test that makes a `view` itself is not a view test: it is a `.test.ts`.

The commands, run from the repo's root:

- `yarn vitest run <file>` for each test file beside what changed, one file at a time.
- `yarn test:view <file>` for a `.view.test.tsx` beside what changed.
- `yarn tsc`: the whole repo, every game in `games/` with it, so an error in another game shows
  in the output too. Read it for your files. This is what checks a game's rules and tests.
- `yarn lint`: eslint on the editor's code, the extensions, every `*.extension.tsx` and
  every `*.route.ts` (`eslint.config.js`). A game's rules and tests are not linted. Run it when you
  changed one of those.

## A kind's test, and a scene's

`yarn new-game` writes the shape: `<game>.sim.test.ts` boots the manager with `boot(file, sim)`,
`load(truth, import.meta.url)`, takes a seat with `connection(manager(truth), d => heard.push(d))`,
steps, and hands the seat a message as a page would:
`seat.take({ scene, seat, msg: { seq, n, id, action, args } })`, `scene` and `seat` from the last
`Down` it heard, `id` the seat's `player` row in that packet. Then it reads the child's rows,
`(await load(...)).get('<scene>')` or `scene(manager(truth), '<scene>')`, and checks them against
the definitions it imports (`defs.body.speed * DT * 30`). A seat with no page needs no transport:
`connection` is the server's side of one seat, and the test is the page.

Steps, in order:

1. Boot the manager file and `load` it with the game folder's url as base. The loader reads a
   catalogue url such as `/games/<game>/assets/<game>.json` from `process.cwd()` in node, so tests
   and the simulator's command line run from the repo's root.
2. Seat whoever plays: a `connection` per seat, a page per seat (below), or the player addon's
   `playtest(child, think)`.
3. Step the manager, `truth.step(DT)`, `DT` the manager's `engine.dt`. A child steps when its
   table entry says `suspend: false` or while a connection is seated in it. The scene `yarn new-game`
   writes is `suspend: true`.
4. Read what the kind wrote off the child's rows, and what the server took off its log:
   `child.log` holds every message put in a seat's inbox, `{ at, seat, msg }`.
5. Check it against numbers read from the files: the scene's `engine.width`, the start actor's
   `pos`, the definition's `speed` and `size`.

A test of how a scene plays through, a seat walking it, is the scene's: `<scene>.sim.test.ts`
beside `<scene>.sim.ts`. A test of one kind's rule is `<kind>.sim.test.ts`.

Another seat's row comes from a second `connection`: on the game's scene when its `seats` is 2 or
more, or else on a scene file of the test's own with `seats: 2` and a `start` for slot 1, written
into a temporary folder as a test writes a scene at another value (below). A test never spawns or
ends a `player` row by hand: the player addon spawns one for each seat it seats and ends it when
the seat closes.

A kind whose rows move a body a seat drives also gets the press check through `simulate`, the one
list of it in `going-multiplayer` (How it is proven): the frame-by-step comparison among its facts,
for each page. A body the page draws snapping back fails it, and how its press is run ahead is then
chosen as `tuning-feel` says (Choose how a press is run ahead).

A game proves it replays, in the scene's test, `<scene>.sim.test.ts`: `const rec = await
recorder(file, sim, here)`, a real page on `view(rec.link, file, here, mount)` played by presses or a
bot, and after each frame `await rec.step()` with the child's rows kept. The page sends what it
sends; the test never hands messages to `rec.link.send` itself, which leaves the page's way of
sending them unproven. Then `await rec.seek(k)` for steps across the run, each holding the rows it
held when played. Three things the recorder does quietly, which a test checks:

- A step that throws is caught: `step()` keeps the error in `rec.failure`, rebuilds the step
  before it and stays there, and returns that rebuild's promise. `await rec.step()`, and check
  `rec.failure` is undefined after every step and every seek.
- An entry a rebuild cannot apply is skipped and kept in `rec.skipped`. Check it is empty after
  every step and every seek, since each rebuild empties it and fills it again.
- Every seek, and every step that threw, boots a new truth: `rec.truth` is another object after it.
  Read the child again each time, `scene(manager(rec.truth), '<scene>')`, never a child held from
  before.

Close it with `rec.link.close()`. What the recorder is: The recorder, below.

A scene of N seats replays with N pages, each on a recorder seat of its own. The recorder holds one
seat (`addons/recorder/recorder.addon.ts`: it opens one, and its `link` is that seat for its whole
life), so a scene of several seats meets a piece core lacks: journal entries that carry the seat
that sent them, and each rebuild opening the seats again in the order they were first opened. It is
built in `addons/recorder/` when a job needs it, with its test beside it,
`addons/recorder/recorder.addon.test.ts`, which does not exist yet, and the header saying it. A
`player` row spawned by a recorder edit is never a seat: no connection possesses it, and nothing
presses through it. Tell the person that a rule waiting for every seat, a race that starts when its
grid is full, never starts in `index.html`, which is one seat, and never in the editor's Game panel
until the recorder holds seats.

## A page in a test

A test that has a page on the game makes it as `index.html` does:

```ts
const truth = boot(structuredClone(file) as Scene, sim)
await load(truth, here)
const page = view(link(loopback(accept(manager(truth)))), file as Scene, here, () => {})
for (let f = 0; f < 240; f++) { await page.frame(); truth.step(DT) }
page.close()
```

- `here` is `new URL('./', import.meta.url).href`, the game's folder: the client finds each row's
  `<kind>.client.ts` and `<kind>.sim.ts` there.
- Node has no page, and the seat's actor binds its keys: give the test
  `globalThis.addEventListener = () => {}` and `removeEventListener` at its top, as the playtester's
  test does. The simulator holds its own pages' listeners and needs none.
- `mount` is `() => {}`: no canvas, so the renderer draws nothing, and an actor that makes its
  drawing in `setup` still runs. A look's test checks what the look built from the row and the
  definition, read off the objects it made: one drawing per row on its layer, standing on the row's
  `pos`, of the definition's size and colour, gone when the row ends (`writing-the-look`,
  `bringing-in-art`). Whether it looks right is seen in Chrome, never asserted in node.
- `page.client` is undefined until a frame has taken the first packet. When the seat moves to
  another scene, the next frame closes that client and makes a new one.
- A test that presses a key the player plugin handles, or clicks something that sends through it (a
  mouse button a table binds, a UI button whose tap calls `plugins.player.<act>()`), holds the page's
  clock, `vi.spyOn(performance, 'now')` moved a step with each step it takes, since the player plugin
  counts the steps between packets on it, and pins the step each press lands on: the row as it was on
  the step before, and changed on that step (`input-and-seats`, How it is proven). It never steps a
  count of frames and reads the rows within a few steps.
- A HUD's places are read off the page: where the ui put a panel is `ui.panel(name).position`, and a
  thing's place inside it is its own `position`. A test never works `world.ui`'s anchor, `at` and the
  canvas's size through again to find them (`building-the-hud`, How it is proven).

A page the template writes (`gameFiles` in `extensions/games/games.route.ts`, which writes every
page a game has) is proven by a test that makes its views as its lines make them, on a game the
test writes on a root of its own, as `extensions/games/games.route.test.ts` writes one, and by
playing the page in Chrome. A test that reads the page's text for a line proves nothing about what
the page does.

## A seat that plays itself

A think is `(rows) => [action, ...args] | undefined`: it reads the rows the seat sees and names a
press or nothing. Write it from the rows alone, every number read off the files, and press only when
what it wants changes, as a held key sends only when it changes. There are three players for it,
each the real path a press takes:

- The simulator's page `think` (`Page.think` in `addons/simulator/simulator.addon.ts`): asked
  before every frame of a simulated page with the rows its client holds, the press called on the
  page's player plugin, which sends it up the link and predicts it as a bound key would. The scene
  needs no playtester and nothing of it changes. This is how a test has a scene a person plays play
  itself: `pages: [{ display, up, down, think }]` to `simulate`, on next to no network
  (`{ delay: 0.1 }` each way) or a bad one. `addons/simulator/simulator.addon.test.ts` never passes
  a `think`; `plugins/player/player.plugin.test.ts` does.
- The player addon's `playtest(truth, think)` (`addons/player/player.addon.ts`): a seat the server
  drives, with no page and no client files, for the rules alone. Each step it asks the think with
  the rows that seat is sent and puts the press in the inbox at the seat's `player` row. It joins
  the truth it is handed directly, not through a connection, so on a `suspend: true` child the
  manager never steps it: step that child itself, or run it beside a page whose connection keeps it
  stepping. Many of them in one truth are many bots, each sent only its own `player` row
  (`addons/player/player.addon.test.ts`); each takes a slot (A gym, below).
- The `playtester` plugin (`plugins/playtester/playtester.plugin.ts`), for a scene that plays itself
  in the browser. That is a scene of its own, which names `playtester` in its file's `plugins`, and
  the seat's actor hands it the player and the think in `setup`:
  `plugins.playtester.play(plugins.player, think)`. Every frame, in its tick, it asks the think with
  the client's rows and calls the press on the player plugin. `<kind>.client.ts` is one file for
  every scene of the game, so the actor hands it only `if (plugins.playtester)`: in a scene that does
  not list it, `plugins.playtester` is undefined and the call throws. The plugin's own test writes a
  scene that names it and an actor that hands the think in `setup`, and boots a page on it over the
  loopback. The scene a person plays never names it: then `index.html` plays itself.

A test never changes a scene's values in memory: the scene object a `<scene>.sim.ts` exports, the
scene object a page's client holds, `plugins.wire.scene`, a manager file's `entry` or a child's
`plugins`. Overriding a value to see what happens is `dev.html`'s and no other page's or file's. A test that needs the game at another value, a step rate say, tests
the function that value feeds, called with each value, or writes a scene file of its own at each one
into a temporary folder, as a plugin's test writes its game (below), its `<scene>.sim.ts` importing
the game's kinds by their absolute paths.

`dev.html` may name the playtester in its copy of a scene and hand the think to the client it holds, `page.client.plugins.playtester.play(...)`, the first frame that
client holds the seat's rows and again for each new client; its think is its own, since nothing
imports `dev.html` and it imports no test. Check a bot's result off the server's rows, and that the
server took the presses the think meant: a step record's `applied` on the simulator, or
`child.log.filter(e => e.msg.action === 'move').map(e => e.msg.args)` on a truth.

## The simulator: pages against a server in time

`addons/simulator/simulator.addon.ts` plays the real code on both ends, the engine, the
scenemanager, the loopback, the player, the game's rules and actors, on one timeline in
milliseconds with no time passing, and writes every frame, step, packet and message as JSONL. Its
header lists every knob and record; read it before a run.

- `simulate(run)` in a test. `run` is `{ file, sim, base, seed, ms, pages, server?, watch?,
  mount?, ready?, turns?, cost?, write? }`: the manager file, its sim, the game folder's url, and a
  page per seat; `mount(client, scene)` is handed each client a page makes. A page is `{ display: { hz, phase?, at?, wobble?, drop?, long?, hidden?, stall? }, up,
  down, join?, open?, clock?, presses?, think? }`. Each leg `{ delay, jitter?, tail?, loss?,
  reorder?, dup?, burst?, wait? }` is the loopback's, in milliseconds. The server is `{ late?,
  pause?, grain?, ppm?, loop?, steps? }`. A press is `{ at, key }` (a `KeyboardEvent.code` handed to
  the listeners the actor bound, `up: true` for the key coming up, the code `keyCode` from
  `plugins/player/player.plugin.ts` gives the key, never a mapping of the test's own) or
  `{ at, act }` (straight through the player plugin). A
  `key` proves the actor's binding too. `ready(truth)` is handed the loaded manager before anything
  runs; `turns` turn a knob at a time. The same seed is the same bytes.
- The command line, from the repo's root:
  `node --experimental-strip-types addons/simulator/simulator.addon.ts run <config.json> [out.jsonl]`
  prints the summary and writes the JSONL. A config is a run as JSON, with `game`, the manager
  scene file's path, in place of `file`, `sim` and `base`. `summary <run.jsonl>` prints the
  summary of any recording, and `real <config.json>` plays the same pages over the real socket on
  the machine's clocks.
- In the editor, the Runs panel (`simulator.extension.tsx`) plays a config through the simulator's
  route (`simulator.route.ts`, `POST /api/x/simulator/run`) and keeps it as
  `addons/simulator/runs/<name>.jsonl`, which git ignores. Its commands, `sim.runs`, `sim.read` and
  `sim.run`, are tools on the editor's MCP server.
- A real browser records itself: `client.html` wraps its dial in `tap`, and
  `client.html?tap=<name>&kinds=<k,k>&fields=<f,f>&own=<field>` sends every frame to
  `addons/simulator/runs/<name>.jsonl` through the editor's server, a batch a second and the last
  as the page is left. A tap holds no server, so its recording has no steps.

Reading a run back. The first record is `run`, the knobs. A `frame` holds `t`, the page's `step`
and `lead`, `took` (each envelope that arrived since the frame before), and the watched rows the
page drew, `rows`, with `own`, the id of the seat's own row by `watch.own`. A `step` holds `n`,
`applied` (each message a scene took that step and how many steps `late`) and `rows`, the server's
watched rows keyed by the scene's name (`rows.main`). A `press` says in `taken` whether the page
had a client to take it.
After the run, each `packet` and `message` lists every time it arrived in `at`: none when it was
lost, two when it was sent twice. `parse` reads the text back; `summary`, `report`, `histogram`,
`leads`, `corrections`, `packets`, `late` and `standoff` state facts of it. A test states the facts
the mechanism makes true: the server ran the body a stride a step between the two steps it took the
moves, and once the network is quiet the page's own row equals the server's. A body a seat drives
is held to the press check's list, `going-multiplayer`'s (How it is proven), whose frame-by-step
comparison holds a body that never comes to rest to the step each frame drew: a frame's `step`
against the step record whose `scenes[<scene>]` is that step.

## A gym

A gym is the game played many times by bots to measure it: a test that runs the same play over many
seeds, networks or starts, each with a think, and states facts of all of them. It is a test like any
other, beside what it plays (`<scene>.sim.test.ts`), or beside a scene made to be measured, which is
a scene like any other in the manager's table: `load` boots every scene the table names, so a test
reaches it as `scene(manager(truth), '<scene>')` with `playtest` seats on it, and `dev.html` enters
it in the browser. Use the simulator with a page `think` to measure what a player feels across
networks, and `playtest` seats stepped on the scene itself to measure the rules alone.

Every `playtest` seat takes a slot, as a connection does. A scene holds as many as its `seats`
says, and the next `join` throws `no seat free: N declared`; and each slot's `player` row finds its
`start` actor with `w.find('start', s => s.data.slot === me.data.seat)`, which throws `no start
matches` for a slot with none. The scene `yarn new-game` writes has `seats: 1` and one start, so it
holds one bot. A scene made for many bots says so in its file: `seats` at least the bots, and a
`start` entry for each slot.

Look at the numbers once, then write what the mechanism makes true, with the bound derived from the
knobs. In the scene `yarn new-game` writes, prediction stamps a press with the step of the last
packet the page took, already the down leg behind the server, and the press then crosses the up leg:
so on a network of 90 ms each way every move is taken at least `floor(180 / (1000 / 60))`, ten
steps, late, and a body the page stopped at an edge comes to rest past it on the server, on every
seed. That is a fact of the game to bring to the person making it. Whether a seat should run a
round trip ahead (`world.player.steps`, the player plugin's whole steps) is theirs to decide.

## The recorder

`addons/recorder/recorder.addon.ts` holds a game's manager under a clock someone else holds, the
editor's. It boots and loads it, opens one seat over the loopback, and journals every envelope the
seat sends and every edit made to a live row. One seat is all it holds; a scene of several meets
the piece built in `addons/recorder/` above (A kind's test, and a scene's). Any step is rebuilt by booting again and replaying the
journal up to it. The editor's session plays every game under it (`editor/session.ts`), and its
timeline goes back with it. An extension's test boots its scene under it (`building-an-extension`),
and a game's scene test replays the game under it (A kind's test, and a scene's, above).

Replay boots again and runs the same inputs, so by its mechanism a rule that rolls `Math.random`
instead of `w.die`, or keeps from one step to the next a value outside its row, gives other rows on
a step sought again. Nothing in core tests that: `recorder.addon.ts` has no test beside it.

## A plugin's or an addon's test

It writes its own game into a folder of the system's temporary folder (`mkdtempSync`), a manager
scene and a child as a game's are: each kind's `<kind>.sim.ts`, a `<kind>.client.ts` where the page
needs an actor, the child's `<scene>.scene.json` and its `<scene>.sim.ts` importing
`plugins/scenemanager/scenemanager.sim.ts` by its absolute path. Its base is
`pathToFileURL(dir + '/').href`, and `afterAll` removes the folder. `playtester.plugin.test.ts`,
`simulator.addon.test.ts` and `plugins/player/player.plugin.test.ts` are written so. A plugin that
names a mod boots its scene through `load` or `view`, which is what loads mods. A test that writes a
game folder of its own ships the game's plugins and mods there, `plugins/<n>/<n>.plugin.ts` and
each `<a>.<p>.ts` where `building-a-plugin`'s Mods put it, re-exporting the real files or a
provider of the test's own. A mod's test, `<a>.<p>.test.ts` beside it, loads a scene that names it
through `load` and checks `mod(world, p, name)` is its function, then what it hands back. A planted fault, the
real source with one fault written in and mocked in its place, shows a check turns red, as the
simulator's test does with the player plugin's source.

## Playing it, and looking at it

- In one tab: `yarn editor <game>` serves the editor at `http://localhost:5173/editor/?game=<game>`
  and every game's pages beside it: `http://localhost:5173/games/<game>/index.html`. `PORT=<n>`
  before it serves on another port. The editor's Game panel plays the same game under the recorder.
- Against its server: `node --experimental-strip-types games/<game>/<game>.server.ts` serves on the
  manager's `port`, and `http://localhost:5173/games/<game>/client.html` dials it. The scene
  `yarn new-game` writes has one seat: a second page is refused, its socket closed with 1013 and
  `no seat free: 1 declared`, and it draws nothing. A page left open elsewhere holds the seat;
  restart the server, or close that page.
- In `dev.html`: the testbed above, at `http://localhost:5173/games/<game>/dev.html`.
- In Chrome: `.claude/skills/good-webviews/`.
  `node --experimental-websocket .claude/skills/good-webviews/webview.mjs shot <out.png> <url> <ms>`
  loads the page, waits `<ms>` and writes the picture; then read the PNG. `eval <js>` asks the page
  a question, such as how many canvases it holds. The tab is keyed by the session, and agents of one
  session share it: set `WEBVIEW_TAB=<a name of your own>` on every call, or another agent's page is
  what you photograph. `close` when done.

## What goes wrong, and what is right

- Naming `playtester` in the scene file of a scene a person plays, to make a test play it: then
  `index.html` plays itself. Pass the simulator a page `think`, or seat a `playtest`.
- Changing a scene in memory inside a test, its `plugins`, its `entry` or any value, the page's
  `plugins.wire.scene` among them, as `dev.html` may: a test boots the files as they are. The
  simulator's `think` needs no change to the scene, and a value the test must try at several
  settings, a step rate or an empty ledger list, is tried on the function it feeds or on a scene file
  the test writes itself.
- A test that spawns or ends a `player` row by hand to have another seat: a second `connection` on a
  scene of `seats: 2`.
- A test that presses a key the player plugin handles, or clicks something that sends through it,
  without holding the page's clock, then steps a count of frames and reads the rows within a few
  steps: it pins no step.
- A test that restates a scene file, a prefab's fields or a `plugins` list copied into an
  assertion, or opens a file by a path it typed: it proves what they do, and reaches a file through
  its catalogue entry.
- A scene of several seats replayed through the recorder's one seat, or a `player` row a recorder
  edit spawned taken for a second seat: the recorder's seats are built in `addons/recorder/` first
  (A kind's test, and a scene's).
- A setup that works only because of the layout typed into the test, a cell, a row of the map, a
  list of moves, and guarded by an assertion that it still works: it is derived from the files.
- An actor that hands the playtester its think without `if (plugins.playtester)`: every scene of
  the game that does not list it throws as the seat's row is set up.
- In `dev.html`, handing the think before the client exists, or once when the seat moves scenes:
  hand it the first frame the client holds the seat's rows, and again to each new client.
- More `playtest` bots than the scene's `seats`, or a slot with no `start`: `join` or the `player`
  row's `before` throws.
- Holding a recorder's child across a seek, or not awaiting `rec.step()` and reading
  `rec.failure`: the test reads a truth that is gone, or passes over a step that threw.
- A node test that makes a page with no `globalThis.addEventListener` of its own throws as the
  actor binds its keys.
- Running a test or the simulator from another folder: the loader in node reads the catalogue's
  url under `process.cwd()`, and fails.
- Joining a page to a truth by hand, a pipe or a wire of the test's own: take the loopback.
- Seating `playtest` on a `suspend: true` child and stepping the manager: the child stays at step
  0 and nothing happens. Step the child, or keep a connection in it.
- Reading a run's `corrections` or a frame's `fix` on a scene without `world.player.steps`: they
  count only the player plugin's whole-step reruns and read 0 there, even on a frame where the page's
  own row snapped back. Compare the frames' `rows` with the steps' `rows`.
- Reading a histogram before the page has an ack: it is empty (`join -`) until a frame's `ack` is
  above 0. Under `world.player.steps` the player plugin sends a probe as the page joins, which the
  engine refuses and acks, so the ack comes at once. Without it nothing is sent until a press, and a
  tap of a page nobody pressed in has an empty histogram.
- Asserting the numbers a run printed: state what the mechanism makes true, with bounds derived
  from the knobs and the files.
- A view test in a `.test.tsx`: it is `<name>.view.test.tsx`, run by `yarn test:view`.
- Asserting how a game looks in node: a look's test checks what the look built from the row and the
  definition, and whether it looks right is seen in Chrome.
- Driving a recorder with `rec.link.send` instead of a page on `rec.link`, or reading `rec.failure`
  and `rec.skipped` after the steps alone: a seek that threw or skipped an entry passes unseen.
- A page of the template proven by reading its text: it is proven by making its views as its lines
  do, and by playing it.

## How the work is proven

- Every test beside what changed is run with `yarn vitest run <file>`, a view test with
  `yarn test:view <file>`, and passes. Each was seen to check something: its assertions read
  numbers off the files and pin the result to a step or a stride.
- Every press that raises a sound, from a key or from a UI button through `plugins.player.<act>`, is
  proven as `sound` proves it (Proving it): the entry counted on the server's packets, and the page
  tests, the second on a scene of the test's own with `world.player.ledgers` at `[]`.
- The game replays: its scene's test plays a real page under the recorder and seeks back across the
  run, each step holding the rows it held when played, `rec.failure` undefined and `rec.skipped`
  empty after every step and every seek (A kind's test, and a scene's).
- `yarn tsc` shows no error in the files you wrote.
- `yarn lint` passes when editor, extension or route code changed.
- A run over a bad network is read back from its records, not only its summary.
- The game is played in one tab, and against its server when it has one, and looked at in Chrome.
