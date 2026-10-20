---
name: input-and-seats
description: Use in core, or any clone of it, when a game's player controls anything. That covers keys, the mouse, a gamepad or controller, binding them in `player.client.ts` (`plugins.player.bind` or `control`), named actions in `world.player.actions`, letting the player rebind or remap keys, a controls or key-bindings screen, toggles, the stick's deadzone and key repeat. It also covers seats and players: the `player` row a seat possesses, slots, a second seat or player, where each player starts or spawns (`start` actors), what a seat may send (acts, `open`), and a press drawn before the server answers (prediction, lag, a sound or effect that plays twice: `world.player.ledgers`). It also covers a seat that plays itself (the `playtester` plugin, `playtest`).
---

# Input and seats

How a player controls a game in core: the seat and the `player` row it possesses, where the seat
starts, how its keys, mouse and gamepad become acts on that row, how a player rebinds them, how a
press is drawn before the server has it, and a seat that plays itself. The facts are the headers of
`plugins/player/player.plugin.ts` (Actions, rebinding, Gamepads, Prediction), `addons/player/player.addon.ts`,
`plugins/store/store.plugin.ts`, `plugins/ui/ui.plugin.ts`, `plugins/playtester/playtester.plugin.ts`,
`engine/engine.ts`, and the tests beside them. Load `prime-directive` too; nothing here overrides it.

Other phase skills instead:

- Making the game folder, and what each file `yarn new-game` writes is for: `starting-a-game`.
- What a kind does with the act a press reaches, its rows, definitions and `w.call`: `designing-a-kind`.
- Moving a seat to another scene, `go`, `arrive`: `scene-flow`.
- Panels, styles and the HUD in general: `building-the-hud`. This skill covers only the controls
  screen.
- What a sound plays and its cues: `sound`. This skill covers only why its kind is a ledger.
- Seats over a socket, what each seat may see (`security`, `masks`, `vision`): `going-multiplayer`.
- Proving a game plays, playtests and gyms: `proving-a-game`.

## Seats, slots and the `player` row

- A connection is one seat on one scene at a time (`addons/scenemanager/scenemanager.addon.ts`,
  `connection`). In a scene that lists the `player` plugin, `addons/player/player.addon.ts`'s `join`
  gives it the lowest slot below the scene's `seats` that no seat holds and no `player` row sits in,
  spawns a `player` row with that slot in its `seat` field, and opens the seat possessing that row.
  A scene that lists no `player` plugin, a menu, gives a plain seat with no row (`own` in the
  scenemanager addon).
- The seat possesses its `player` row, so every message the page sends names an act on that row
  (`engine/engine.ts`, `answer`: a message at any other row is refused unless that row's kind lists
  the act in `open`). The `player` row's acts forward to what the seat plays with
  `w.call(w.get(me.data.body), 'move', seat, x, y)`, as the `player.sim.ts` `yarn new-game` writes does.
- Only the seat's own page is sent its `player` row. Anything other seats must see is a public row
  the `player` row's `before` spawns and keeps by id (the new game's `body`), whose own `before`
  ends it when no `player` row names it any more, which is how a seat that leaves takes it away.
- The slot is not the seat's number. The `seat` an act is handed is the truth's seat number, which
  counts every seat the truth ever opened, so a seat that leaves and comes back gets a higher one. A
  rule about who is who (whose turn, which side, which colour) reads the slot off the `player` row,
  `me.data.seat`, and passes that on.
- A second seat in a scene is its `seats` raised to 2 and, where a seat stands somewhere, a second
  `start` actor, slot 1 (Where a seat starts). The seats that count are the entry scene's, the
  child's: `join` reads the child's `seats`, and the manager's `seats` in `<game>.scene.json` is
  never read. A third connection to a scene of two seats throws `no seat free: 2 declared`.
- Which links are one seat is the page's to say (`link` in `addons/scenemanager/scenemanager.addon.ts`):
  one link is one seat, and two links on one manager in one process are two seats, as
  `plugins/store/store.plugin.test.ts` makes them. The pages `yarn new-game` writes make one link
  each: `index.html` holds a truth of its own in its tab, so a second tab of it is a second game, and
  two seats on one game are two `client.html` pages against `<game>.server.ts`.

## Where a seat starts

Where a seat starts is never on `world`: no `world.pads`, `world.spawns` or `world.starts`, and no
list of places in a definition. It is a `start` actor in the scene file, one `actors` entry per slot:

- `start.sim.ts` in the game's folder is `export const start: Kind = {}`, with no rule and no drawing.
- Each entry holds the slot in `slot` and where that slot begins, `pos`, and whatever else the thing
  it becomes starts with (a `look`, a heading, a speed): `{ "is": "start", "slot": 1, "pos": [700, 270] }`.
- The seat's `player` row finds its own in `before`,
  `w.find('start', s => s.data.slot === me.data.seat)`, spawns what the seat plays there, and keeps
  that row's id. `player.sim.ts` from `yarn new-game` does exactly this.
- A start is an actor because it is a place in the level: the editor shows it, selects it and drags
  it as it does every other actor. A scene has as many as it has slots. A slot with no start throws
  `no start matches` from the step that seats it, and nothing catches it: on node it ends
  `<game>.server.ts` (`run` steps inside a timer), and in `index.html` the loop never asks for its
  next frame, so the game stops. What the server does with a rule's throw is built in the
  scenemanager addon (`going-multiplayer`, step 6), never caught in a game; the start the slot lacks
  is written in the scene file.

A seat that stands nowhere, a quiz's or a hand of cards', has no `start`: nothing of it is a place in
a level. What `yarn new-game` wrote for the body goes with the body: `start.sim.ts`, `body.sim.ts`
and `body.client.ts`, the `start` and `body` prefabs, the `start` entry in `actors`, their imports
and names in `<scene>.sim.ts`'s `sim`, the `body` definition in `assets/<game>.json`, the `body`
field of the `player` prefab, and the start and body checks of `<game>.sim.test.ts`, which is
rewritten to prove what the seat does play. `player.sim.ts` and `player.client.ts` stay: the seat's
row, whose `before` no longer looks for a start and whose acts forward to the rows the seat plays
with, and its binding, the keys bound to those acts.

## Binding input: `bind` and `control`

The game's `player.client.ts` hands the player plugin one table in its `setup` and holds no
listener, queue or tick of its own; its `remove` calls `plugins.player.unbind()`. The plugin listens
on the page. A key is named by its place on the keyboard (`keyOf`): `a`, `1`, `' '`, `Shift`,
`ArrowLeft`, `Escape`; a mouse button is `Mouse0` to `Mouse2`; a gamepad button is `Pad0` to `Pad16`
in the browser's standard mapping, and the left stick's sides are `PadStickLeft`, `PadStickRight`,
`PadStickUp` and `PadStickDown`. There are two avenues, side by side:

- `bind(table: Binds)` binds behaviour straight to keys: `press`, `release`, `axis`, `stick`, `hold`,
  `every`, `click`, `pointer`, `drag`, `hover`, `stroke`, `wheel`, `locked`, each keyed or listed by
  keys. Games that use it stay on it: no sweep moves them to `control`. On this avenue the code reads
  the left stick's deadzone off the `player` prefab (`prefabs.player.deadzone`), a fixed number on a
  prefab, which breaks the directive; it belongs on `world.player.deadzone`, where `control` already
  reads it. Moving it (the `bind` path and header of `plugins/player/player.plugin.ts`, its test, and
  every `bind` game with a stick) is part of any job it is in the way of. Gamepad keys never reach
  the UI on this avenue, so a gamepad cannot move through a menu. A key in `press` sends its message
  on every keydown, the keyboard's repeats of a held key among them; a key that `release` also names
  is pressed once a hold (`onDown` and `pressed` in `plugins/player/player.plugin.ts`). So a header
  that says how often a held key acts is proven by a test that sends the key's keydown a second time,
  with `repeat: true`, before its keyup, and counts the presses the server took.
- `control(table: Controls)` binds behaviour to the scene's actions, and the scene binds keys to the
  actions, so a player can change which keys play which action and the game never knows. It is the
  way for a game that wants its player to rebind keys or change how its controls play.

A game is moved to `control` when it wants remapping, never as a sweep of every game. A new game
from `yarn new-game` is on `bind`, and stays there until its person asks for rebinding.

On `control`:

- The scene names each action in `world.player.actions`, fixed for the scene, so on `world` and
  never on the player prefab: `{ "label": "Dash", "keys": [" ", "Pad0"] }`. The shape of `keys` is
  the shape of the action: one list of keys is a button, held while any of them is down; two lists
  are an axis, the keys that push it to -1 and to 1; four lists are a stick, left, right, up, down.
- The table is `bind`'s keyed by action names: `press`, `release` and `hold` name buttons, `axis`
  axes, `stick` sticks, `every` is handed whether a button action is held, `locked` names button
  actions, `drag` and `stroke` name the button action whose keys they follow; `click`, `pointer`,
  `hover` and `wheel` are as on `bind`. It throws on an action the scene does not name and on one
  whose keys are not the shape the part of the table reads.
- The left stick reads `world.player.deadzone`, and a scene whose actions hold a side of the stick
  and gives none throws.
- A gamepad key going down is offered to the UI (`keyDown`, then `keyUp`) before it is the game's, so
  a pad moves through the UI's menus.
- What the player chooses is the page's, never the server's: four keys of the store, which the scene
  lists before `player` in `plugins`, or `control` throws `store is listed after player`. They are
  `player.keys` (the actions rebound, each in its scene shape), `player.toggle` (button actions played
  as toggles), `player.deadzone` and `player.repeat` (seconds between presses while a `press` action
  is held; `world.player.repeat` gives the scene's, 0 when left out). A scene that lists no store
  plays its own actions and settings and changes none (`rebind` throws `the scene lists no store`).
- `bind` and `control` replace each other as the table in force; `unbind` drops either.

## Moving a game from `bind` to `control`

In order, for a game made by `yarn new-game` (`games/<game>/`, scene `main`). Moving `move` to an
action changes no act: the page sends the same messages, and `<game>.sim.test.ts` is unchanged. A new
action that does something new, `dash` here, needs its act before anything binds it: a press of an
act the `player` kind does not have throws `no action player.dash` in the player plugin's tick, and
the page's loop stops with it.

1. The act first. `dash(me, w, seat)` on `player.sim.ts` calling `w.call(w.get(me.data.body), 'dash',
   seat)`, and the act on the kind it reaches, its numbers on that kind's definition in
   `assets/<game>.json` (`designing-a-kind`), with its test in `<game>.sim.test.ts`.
2. `main.scene.json`: add `world.player`, the actions and the deadzone.

   ```json
   "player": {
     "actions": {
       "move": { "label": "Move", "keys": [["ArrowLeft", "a", "Pad14", "PadStickLeft"], ["ArrowRight", "d", "Pad15", "PadStickRight"], ["ArrowUp", "w", "Pad12", "PadStickUp"], ["ArrowDown", "s", "Pad13", "PadStickDown"]] },
       "dash": { "label": "Dash", "keys": [" ", "Pad0"] }
     },
     "deadzone": 0.25
   }
   ```

3. `main.scene.json`: list `store` before `player` in `plugins`, and give `world.store`, the
   starting value of each key the game reads, `{}` when it reads none of its own. The store has no
   row, and a plugin with no row has no prefab; yet `plugins/store/store.plugin.ts` reads its
   starting values off a `store` prefab today, and throws `scene lists store but has no store
   prefab` without one. So the job that uses the store moves them to `world.store` first, in one
   change, as `building-the-hud` (step 9) lists it, and then writes `world.store`. It is no pattern
   for any other plugin.
4. `player.client.ts`: `control` in place of `bind`, typed with `Controls` from
   `#plugins/player/player.plugin.ts`:

   ```ts
   export function setup(_row: Row, plugins: Plugins) {
     plugins.player.control({
       stick: { move: (x, y) => ['move', x, y] },
       press: { dash: ['dash'] },
     } satisfies Controls)
   }
   ```

5. A game of several scenes: a child's `world` is the manager's with the child's own keys over it,
   one top-level key at a time (`child` in the scenemanager addon). `world.player` written in
   `<game>.scene.json` is every child's; a child that gives its own `player` key replaces all of it,
   its `actions`, `deadzone`, `ledgers`, `repeat`, `steps` and `window` together. The store is one
   table for every scene of the page, so an action's rebound keys follow the player into the next
   scene, and an action of the same name with keys of another shape there throws `the store's
   player.keys gives <name> keys of another shape than the scene's`.

## A controls screen

The screen that shows and changes the actions is the game's own actor on a `ui` modal, built on
the player plugin's `actions`, `listen`, `rebind`, `restore`, `conflicts`, `settings`, `configure` and
`device`, its numbers on its kind's definition. In order:

1. The kind. `controls.sim.ts`: `export const controls: Kind = {}`; the server has nothing to run.
   Add it to `main.sim.ts`'s `sim`, give it a prefab, `"controls": {}`, and an `actors` entry,
   `{ "is": "controls" }`. Without the prefab the engine throws `no prefab for controls`; without the
   sim entry, `no code for kind controls`. The page also loads `controls.sim.ts` as a rule beside
   the page, as it does for every kind it is sent a row of. Do not name the kind after a plugin: a file
   named after a plugin is loaded as that plugin row's actor.
2. The scene. List `ui` in `plugins` (an actor ticks after every plugin, so where `ui` stands in the
   list does not matter to the actor) and give `world.ui` the panel, the keys that move the focus,
   press and back out, and the styles:

   ```json
   "ui": {
     "panels": { "controls": { "anchor": "center", "size": [700, 320], "modal": true, "backdrop": { "color": 0, "alpha": 0.6 }, "key": "Escape" } },
     "keys": { "up": ["ArrowUp", "Pad12"], "down": ["ArrowDown", "Pad13"], "left": ["ArrowLeft", "Pad14"], "right": ["ArrowRight", "Pad15"], "press": ["Enter", " ", "Pad0"], "back": ["Escape", "Pad1"] },
     "styles": {
       "title": { "fontFamily": "monospace", "fontSize": 24, "fill": 15253831 },
       "label": { "fontFamily": "monospace", "fontSize": 18, "fill": 15658734 },
       "key": { "fontFamily": "monospace", "fontSize": 14, "fill": 15658734 },
       "button": { "radius": 4, "fill": { "color": 3355443 }, "focus": { "color": 7829367 }, "text": { "fontSize": 14 } }
     }
   }
   ```

   A panel whose entry names a `key` is opened by it when no modal has the input, and `back` or that
   key closes it (`plugins/ui/ui.plugin.ts`, Menus the player opens). A panel names one `key`.
   The pad keys in `keys`, `Pad12` to `Pad15`, `Pad0` and `Pad1` here, are what let a pad reach the
   screen and move through it: under `control` the player plugin offers each pad key to the UI, and
   the UI acts only on the keys `world.ui` names (the ui header, Keys). A screen that shows or rebinds
   pad keys gives them, and its test moves the focus with a pad.
   `index.html` already mounts a canvas for `ui` when the scene lists it; no page changes.
3. The definition. Every place, size and word of the screen is `controls` in `assets/<game>.json`:
   the title, the rows' place and step, each part button's place, size and gap, the side names
   (`left right up down`, `- +`), the restore button, the listening line, the conflicts line, and
   display names for keys (`" ": "Space"`). A line made of several fields is written whole, each field
   named in braces where the actor fills it in, `"{key} is bound to {actions}"`, beside the strings a
   list is joined with and the gap between two of them, so the order of a line's fields and the gaps
   between them are the definition's too. Nothing measures text in core (the ui header), so a button
   is as wide as the definition says: size it for the longest label it will hold, and look at it.
4. The actor, `controls.client.ts`. It shows the screen in its `tick` behind `ui.opened('controls')`,
   every frame it is open, with `ui.show`, writing each frame's values on what `show` hands back;
   nothing it shows needs a `remove`. This one rebinds any part of any action and keeps the other
   device's keys of that part:

   ```ts
   const PANEL = 'controls'
   const pad = (key: string) => key.startsWith('Pad')
   // A line of the definition with each field named in braces filled in.
   const line = (form: string, fields: Record<string, string>) => form.replace(/\{(\w+)\}/g, (_, f: string) => fields[f])

   // An action's keys with part `part`'s keys of `key`'s family replaced by `key`.
   function replaced(a: Shown, part: number, key: string): Bound {
     const swap = (held: string[]) => [key, ...held.filter(k => pad(k) !== pad(key))]
     return a.shape === 'button' ? swap(a.keys as string[]) : (a.keys as string[][]).map((held, i) => (i === part ? swap(held) : held))
   }

   function listen(player: Plugins['player'], name: string, part: number) {
     player.listen((key: string | undefined) => {
       if (key === undefined) return // Escape, or unbind: nothing changes
       const now: Shown = player.actions().find((a: Shown) => a.name === name)
       player.rebind(name, replaced(now, part, key))
     })
   }

   export function setup() {}

   export function tick(row: Row, plugins: Plugins) {
     const { ui, player } = plugins
     if (!ui.opened(PANEL)) return
     const d = def(plugins.wire, row.kind)
     const named = (key: string): string => d.names[key] ?? key
     const text = (key: string, style: string, [x, y]: number[], value: string) => {
       const t = ui.show(PANEL, key, () => new ui.PIXI.Text({ text: value, style: ui.style(style) }))
       t.text = value
       t.position.set(x, y)
     }
     const button = (key: string, [x, y]: number[], size: number[], value: string, tap: () => void) => {
       const b = ui.show(PANEL, key, () => ui.button({ ...ui.style('button'), size, label: '' }).on('pointertap', tap))
       b.position.set(x, y)
       text(`${key}.label`, 'key', [x + d.parts.label[0], y + d.parts.label[1]], value)
     }
     const box = ui.panel(PANEL).boundsArea // the panel's `size`, filled first so the rest is over it
     ui.show(PANEL, 'back', () => new ui.PIXI.Graphics().roundRect(0, 0, box.width, box.height, d.back.radius).fill(d.back.colour))
     text('title', 'title', d.title.at, d.title.text)
     const actions: Shown[] = player.actions()
     const mine = player.device() === 'keyboard' ? (k: string) => !pad(k) : pad
     actions.forEach((a, i) => {
       const y = d.rows.at[1] + i * d.rows.step
       text(`label.${a.name}`, 'label', [d.rows.at[0], y + d.parts.label[1]], a.label)
       const parts = a.shape === 'button' ? [a.keys as string[]] : (a.keys as string[][])
       parts.forEach((keys, j) => {
         const held = keys.filter(mine).map(named).join(d.parts.between) || d.none
         const value = a.shape === 'button' ? held : line(d.parts.line, { side: d.sides[a.shape][j], keys: held })
         const at = [d.parts.at + j * (d.parts.size[0] + d.parts.gap), y]
         button(`part.${a.name}.${j}`, at, d.parts.size, value, () => listen(player, a.name, j))
       })
     })
     button('restore', d.restore.at, d.restore.size, d.restore.text, () => player.restore())
     if (player.listening) text('listening', 'label', d.listening.at, d.listening.text)
     const label = new Map(actions.map(a => [a.name, a.label]))
     const clash = player.conflicts().map((c: { key: string; actions: string[] }) =>
       line(d.conflicts.line, { key: named(c.key), actions: c.actions.map(n => label.get(n)).join(d.conflicts.between) }))
     if (clash.length) text('conflicts', 'key', d.conflicts.at, clash.join(d.conflicts.gap))
   }

   export function remove() {}
   ```

What the player plugin and the UI do around it, which the actor relies on and never rebuilds:

- While the modal shows anything it has the input: every key goes to the UI but `back` on a screen
  the game put up, the player plugin lets go of every key and the pointer lock each frame, and the
  seat stops. So the arrows move the focus, Space presses the focused button, and `w a s d` do
  nothing.
- The key that pressed a button (Enter, Space, `Pad0`) began the listening and is not heard by it:
  the UI listens in the capture phase and took it, and the player plugin skips a key the UI took.
- While the player plugin listens, the UI takes no key, from the keyboard or a pad: the next key,
  mouse button or gamepad button goes to `listen`'s function and nothing else, and `Escape` hands it
  `undefined`. So Escape cancels a listen and leaves the screen up; the next Escape closes it.
- `rebind(action, keys)` writes `player.keys` in the store, throws on keys of another shape, and the
  new keys play at once. `restore(action?)` gives back the scene's keys and toggle for one action,
  or with none every action's, the deadzone and the repeat. `settings()` and `configure({ toggle,
  deadzone, repeat })` read and write the rest; a deadzone is above 0 and below 1, a repeat 0 or more
  seconds, and only a button toggles.
- `device()` is `keyboard`, `xbox`, `playstation` or `pad`, what was used last, and on `control`
  only: on `bind` no gamepad key sets it. A gamepad key sets it even when the UI takes the key; a
  keyboard key the UI takes does not, so after a pad has moved the focus, arrow keys on the screen
  leave it at the pad's until a key reaches the game or a listen. A mouse button going down anywhere
  sets it back to `keyboard`, over the UI or not.
- The store is the link's table (`plugins/store/store.plugin.ts`): one per page, every scene of the
  page reads it, and no server and no other page sees it. Nothing in core writes it to the browser's
  storage, so a choice lasts while the page is open and a reload starts from the scene's keys.

## Mouse and gamepad, briefly

- A mouse button is a key in any table. `click` is asked for a message from where the page was
  clicked, in the canvas's pixels; `pointer` takes the pointer lock on a click and sends the pixels
  moved each frame; `locked` names keys the game hears only under the lock; `drag`, `hover`,
  `stroke` and `wheel` are in the header. A click over something on the UI that takes the pointer is
  the UI's and sends nothing.
- Every connected gamepad is read each frame in the player plugin's tick. Its keys work in `press`,
  `axis`, `stick`, `hold`, `every` and `locked` (the header, Gamepads), on either avenue. On `bind` a
  gamepad button coming up runs no `release`; `release` hears a pad only on `control`. `stroke`
  begins only from a mouse button. A pad key has no repeat of its own (on `control`, `player.repeat`
  presses a held action again from a pad as from a key). A key or mouse button a table names has its
  browser default cancelled, except under Control, Command or Alt.

## Prediction and ledgers

The page runs a press ahead of the server on its own copy of the rows (the player header,
Prediction). On a press, the rule it names is run on a clone of the rows; if that run wrote nothing
but the `player` row and rows whose acts it called with `w.call`, what it wrote is drawn at once,
and each row it wrote has its per-step rule run on the page once a step, under the same test. A run that
spawns, ends a row, rolls the die, writes `world`, or calls a row of a plugin's kind (one with no
rule file beside the page, as `scenemanager`'s `go`) is not run ahead and waits a round trip. So the
`player` act that forwards with `w.call` to the body, as the new game's does, is drawn at the press.
A scene whose rules keep state between steps (box3d's physics world) sets `world.player.steps` to
`true`, and the page runs whole steps of its own rows instead (the header, Whole steps).

A ledger is a row that only appends events for the page to play or draw once: a sound on `audio`'s,
an effect on `particle3d`'s or `particle2d`'s, a launched round on `volley3d`'s or `volley2d`'s. A
write there by a press run ahead would play the sound at the press and again when the server's packet
brings it. The scene names its ledger kinds in `world.player.ledgers` (`["audio"]`): fixed for the
scene, so on `world`, never on the player prefab, where every player row would carry the list to
every seat every step. What a predicted run writes to a ledger's rows, or calls on them, is dropped;
the rest of the press is still drawn at once, and the event comes once, from the packet. A press
that writes to or calls a plugin's kind the list leaves out is not run ahead at all, so every scene
that uses a ledger names its kind. A new plugin whose row only appends events is a ledger, and every
scene that uses it adds its kind to the list. Guarded by `plugins/player/player.plugin.test.ts`
(`a press or a step that raises a sound is still predicted, and the page draws only the ledger the
server sent`).

## Open acts

A kind may list acts any seat may send at its rows directly, `open: ['go']` on the `Kind`
(`engine/engine.ts`). The page sends one with `plugins.wire.send(row.id, act, ...args)`, as the
scenemanager plugin's `go` and the chat plugin's `say` do; it is not run ahead. It is for what any
seat may ask of a row it does not possess: a seat moving on (`plugins/scenemanager/scenemanager.sim.ts`),
skipping a cutscene (`plugins/cutscene/cutscene.sim.ts`), a menu scene's plain seat that has no
`player` row. A game's own shared row is reached through the seat's `player` row and its acts, with
the slot (the player addon header); a kind reached only that way lists no `open`, and `w.call` runs
its acts without the check because the `player` act already passed one. Every act's arguments come
from outside the program, so an act checks them and does nothing with a bad one, as the new game's
`body` `move` checks for two finite numbers and the scenemanager's `go` refuses a scene it has not got.

## A seat that plays itself

Two ways, both pressing acts and not keys, so a game on `control` plays alike:

- On the page, the `playtester` plugin: the scene lists it, and an actor's `setup` hands it the
  player and a think, `plugins.playtester.play(plugins.player, rows => [...] | undefined)`. Each frame
  the think reads the rows this seat sees and names an act and its arguments, `['move', 1, 0]`, which
  goes through the player plugin as a press does (`plugins/playtester/playtester.plugin.test.ts`).
- On the server, `playtest(truth, think)` from `addons/player/player.addon.ts`: a seat the server
  drives itself with no page (`addons/player/player.addon.test.ts`, two playtesters on two seats).

How a game is proven with them is `proving-a-game`.

## What goes wrong

- Every game moved to `control` because input mapping sounds good everywhere. A game moves when its
  person wants rebinding; `bind` stays for the rest.
- Rebound keys put on a row, the player prefab, or sent to the server. They are the store's, the
  page's own table; `rebind` writes them there.
- Actions, the deadzone or the ledger list written on the `player` prefab. They are fixed for the
  scene, so `world.player`. (On `bind` the code still reads the stick's deadzone off the player
  prefab; that is old code to move to `world.player.deadzone`, never a pattern.)
- `store` listed after `player`: `control` throws `store is listed after player`.
- A `store` prefab written so the store runs. The store's starting values are `world.store`, and the
  job that uses the store makes that move first (step 3 of Moving a game from `bind` to `control`).
- An action bound in `player.client.ts` before its act is on `player.sim.ts`: the first press throws
  `no action player.<act>` and the page stops. The act comes first.
- A child scene given `world.player: { ledgers: [...] }` alone, which drops the manager's actions
  for that scene.
- The controls screen built inside `player.client.ts`, or as a plugin. It is a kind of its own, the
  game's actor, `controls.sim.ts` and `controls.client.ts`, with its numbers on its definition.
- Places, sizes or words of the screen written in the actor's code. They are its definition.
- A button sized by guess. Nothing measures text; size it in the definition for its longest label,
  and look at it in Chrome.
- An act's `seat` taken for the slot. Who is who is `me.data.seat` on the `player` row.
- Where a seat starts put on `world` or in a definition. It is a `start` actor per slot.
- A press's sound played at the press. Its kind is a ledger in `world.player.ledgers`, and the sound
  comes once, from the packet.
- A listener, a key table or a readout added to `index.html`. A page mounts things; a key is the
  player plugin's, bound by the game's actor. A shortcut to try something is `dev.html`'s alone.
- `world.ui.keys` written into a scene with no modal and no panel a key opens, where nothing reads
  it.
- A start, a body and their checks kept for a seat that stands nowhere, a quiz's or a hand of cards'.
  They go with the body; `player.sim.ts` and `player.client.ts` stay (Where a seat starts).
- A test that steps a few frames and then reads the rows, or reads them against a range of steps. It
  holds the page's clock and pins the step a press lands on.
- The pad keys left out of `world.ui.keys` on a screen that shows or rebinds pad keys: a pad can
  neither reach the screen nor move through it.

## How it is proven

Each test sits beside the file it tests, is a `.test.ts` (node), and is run alone with
`yarn vitest run <file>`. A page made in node by the scenemanager's `view` is not the editor's
`session.attach`, so it is not a `.view.test.tsx`.

- The rule, server side: `games/<game>/<game>.sim.test.ts`, as `yarn new-game` writes it: boot the
  manager, `load`, make a seat with `connection`, send `seat.take({ scene, seat, msg: { seq, n, id,
  action, args } })` at the seat's `player` row, step, and read what the kind wrote off the scene's
  rows. A new act (`dash`) gets its test here. Moving to `control` changes nothing in it.
- A second seat, in the same file: a `connection` on the manager for each of the scene's `seats`;
  their `player` rows hold the slots from 0 up, and each body stands on its slot's start; one more
  `connection` throws `no seat free: <seats> declared`; after one seat's `close()` and a step, its
  `player` row and its body are gone and the other seats' remain. Every number is the scene file's:
  the seats, and so the slots, are read off the scene, never typed. A scene of more than one seat is
  played over a socket, so it also gets `going-multiplayer`'s server test, `<game>.server.test.ts`,
  with its `simulate` test.

  ```ts
  const seats = room.scene.seats!
  const tabs = Array.from({ length: seats }, () => connection(manager(truth), () => {}))
  truth.step(DT)
  const players = room.rows.filter(r => r.kind === 'player')
  expect(players.map(p => p.data.seat)).toEqual(tabs.map((_, slot) => slot))
  for (const p of players) {
    const start = room.rows.find(r => r.kind === 'start' && r.data.slot === p.data.seat)!
    expect(room.rows.find(r => r.id === p.data.body)!.data.pos).toEqual(start.data.pos)
  }
  expect(() => connection(manager(truth), () => {})).toThrow(`no seat free: ${seats} declared`)
  tabs[0].close()
  truth.step(DT)
  expect(room.rows.filter(r => r.kind === 'body').map(r => r.id)).toEqual(players.slice(1).map(p => p.data.body))
  for (const t of tabs.slice(1)) t.close()
  ```
- The seat's input, on a page: `games/<game>/player.client.test.ts`. Boot and `load` the manager as
  `index.html` does, make the page with `view(link(loopback(accept(manager(truth)))), file,
  import.meta.url, mount)`, step the manager and `await` the view's `frame()` once a step, hand key
  events and a gamepad to the page, and read the server's rows: each action from each of its keys,
  the d-pad, the stick inside and past `world.player.deadzone`, a button action's act, and how often
  a held key acts, its keydown sent again with `repeat: true`. The test holds the page's clock with
  `vi.spyOn(performance, 'now')`, moved a step with each step it takes, since the player plugin counts
  the steps between packets on it (`plugins/player/player.plugin.test.ts`), and it pins the step a
  press lands on: the row as it was on the step before, and changed on that step, never "within a few
  steps".
- Every test that presses a key the player plugin handles, the controls screen's below and any other
  page test, or clicks something that sends through it, a mouse button a table binds or a UI button
  whose tap calls `plugins.player.<act>()`, holds the page's clock the same way and pins the step
  each press lands on; none steps a count of frames, `step(2)` say, and reads the rows within a few
  steps.
- The game replays: the scene's test plays it under the recorder and seeks back (`proving-a-game`, A
  kind's test, and a scene's).
- The controls screen, on a page: `games/<game>/controls.client.test.ts`. Open it with its key, read
  what it shows off its panel by each thing's key, `ui.panel('controls').getChildByLabel('part.dash.0.label').text`,
  move the focus and press with `world.ui`'s keys, and check: the screen takes the game's keys while
  up; a part pressed listens (`player.listening`), the next key lands in the store
  (`link.store['player.keys']`) with the other device's keys kept, and neither a row nor `world` on
  the server holds it; the old key no longer plays the act and the new one does; Escape while
  listening changes nothing and leaves the screen up; a shared key shows on the conflicts line;
  Restore empties `player.keys`; a gamepad moves the focus, rebinds its own keys, and the labels show
  the pad's keys.

What those page tests need, all of it learned writing them:

```ts
// The page's listeners by type and phase. The UI listens in the capture phase and the player plugin
// asks it `took(e)`, so a key reaches the capture listeners first, as in a browser.
type On = { type: string; f: (e: unknown) => void; capture: boolean }
const page: On[] = []
vi.stubGlobal('addEventListener', (type: string, f: (e: unknown) => void, o?: unknown) => { page.push({ type, f, capture: o === true }) })
vi.stubGlobal('removeEventListener', (type: string, f: (e: unknown) => void, o?: unknown) => {
  const i = page.findIndex(x => x.type === type && x.f === f && x.capture === (o === true))
  if (i >= 0) page.splice(i, 1)
})
// `repeat` true is the keyboard's repeat of a key held down.
const key = (type: 'keydown' | 'keyup', k: string, repeat = false) => {
  const e = { code: keyCode(k), key: k, repeat, preventDefault() {} } // keyCode from the player plugin
  for (const capture of [true, false]) for (const o of page.filter(o => o.type === type && o.capture === capture)) o.f(e)
}
// The page's clock, which the player plugin counts the steps between packets on, moved only by the
// test: a step of it with each step the test takes, `truth.step(DT); clock += DT * 1000; await tab.frame()`.
let clock = 0
vi.spyOn(performance, 'now').mockImplementation(() => clock)
// One gamepad, read by the player plugin each frame.
const pad = { connected: true, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0] }
vi.stubGlobal('navigator', { getGamepads: () => [pad] })

// The UI listens for keys only once it has a canvas. `mount` would ask PixiJS for a renderer, so the
// test hands the UI a canvas stand-in directly, as the player plugin's test sets `render3d.canvas`.
const tab = view(link(loopback(accept(manager(truth)))), file as Scene, import.meta.url, me => {
  me.plugins.ui.canvas = { style: {}, addEventListener() {}, removeEventListener() {}, remove() {} }
})
```

The other route lets `mount` run as `index.html` runs it: fake PixiJS's renderer with
`vi.mock('pixi.js', …)` replacing `autoDetectRenderer` by a stand-in that keeps its size and draws
nothing, as `plugins/ui/ui.plugin.test.ts` does, stub `devicePixelRatio` (`vi.stubGlobal`), and mount
a canvas stand-in (`width`, `height`, `style`, `addEventListener`, `removeEventListener`, `remove`)
on render2d and on `ui` in the view's `mount`. The keys then reach the seat as they do on a page.

A key pressed between frames is applied in the next frame's tick and reaches the server on the step
after it, so with the clock held that step is known: the test reads the row on the step before it,
unchanged, and on that step, changed. Close every view after its test (`tab.close()`), which unbinds
the player and the UI from the page's listeners.

What is played: `yarn editor <game>`, then the game in the Game panel or at
`localhost:5173/games/<game>/index.html`. Move with every key of each action; open the screen with its
key; rebind a part; look that every label fits its button and the conflicts line names a shared key;
play the new key; Restore. With a gamepad at hand, move through the screen with it and rebind a pad
key. The screen is looked at in Chrome closed, open, listening and showing a conflict, a screenshot of
each read for every line standing inside its background and every label inside its button; the work
is not done until what those shots showed is reported.

A second seat is played against the server, `node --experimental-strip-types
games/<game>/<game>.server.ts`, with `client.html` open twice, at
`localhost:5173/games/<game>/client.html` while `yarn editor` runs. Chrome pauses
`requestAnimationFrame` in a background tab, so of two such tabs in one window only the one in front
plays (the scenemanager header): open them in two windows side by side.

## Questions never asked

- Can where each seat starts go on `world`, as `pads` or `spawns`? No: a `start` actor per slot,
  which the seat's `player` finds by `slot`.
- Should every game move to `control` so input mapping is everywhere? No: a game moves when it wants
  its player to rebind, and `bind` stays for the rest.
- Can a game's rebound keys go on a row or be sent to the server? No: they are the store's, the page's.
- Can a predicted press play its sound or effect right away? No: its kind is a ledger, named in
  `world.player.ledgers`, and the sound comes once, from the packet.
- Can the ledger list go on the player prefab? No: `world.player.ledgers`. It never changes, and a
  row is copied to every seat every step.
- Can the actions or the deadzone go on the player prefab? No: `world.player.actions` and
  `world.player.deadzone`, fixed for the scene.
- Can the controls screen's numbers go in its code? No: its kind's definition.
- Should the page listen for this key? No: the player plugin does, and the game's actor binds it.
- Do you want the full version? Always.

Ask the person making the game what its controls should be: which actions there are, their default
keys, whether the player may rebind them. That is content, and it is theirs.
