// The browser half of the player. Any function called on it becomes a message up the wire,
// carrying the name and the inputs, at this seat's player row. A call made outside a frame,
// as an actor's setup does before the first one, waits for the next tick.
//
// Prediction. On a press, the rule it names is run here on a clone of
// the rows. If that run wrote nothing but the row the press names, or the row that rule
// called, the rows it wrote replace the packet's rows in what the actors draw, and the press
// is kept, with the browser's step it was pressed at, until a packet's ack is at or past its number.
// The browser's step is the page's own clock (Clock, below), and each such row's per-step rule runs
// here once a step, under the same test: it writes nothing but that row, or a row whose act it calls, as a strike calls `hit` on what
// it lands on. That row is drawn as the packets bring it, since no press predicts it, but the rules
// run here read it as the packet brought it with what the acts called on it here wrote, until the
// next packet, so a strike that fells what it lands on lets the striker's next steps here through
// where it stood, as the server's are. When a packet arrives the server's rows are taken, the
// presses the ack covers are dropped, and the per-step rule is run forward to the browser's step,
// and each remaining press is re-applied before the passes of its own step, as the server applies
// a message before the passes of the step it arrives in.
// The steps ahead are half a press's round trip in the server's steps: from the packet it was sent
// on to the one the last frame took before the packet whose ack covers it, since that ack came on
// a packet after the last frame's.
//
// Clock. The browser's step is a clock of the page's own, moved by the page's clock and never by a
// packet, so a packet that comes late, or two on one frame, as a timer's and a network's do, moves
// nothing drawn: on a display drawing a frame a step it moves one step every frame, with packets as
// without. Each packet taken says the server was at least at its step when the page took it, so the
// server's step now is at least that step and the steps since; the most any packet taken in the
// last `world.player.window` seconds (2 when the scene gives none) says is where the clock wants to
// be, with the steps ahead added: the most measured in the same seconds. A packet that came late
// says less than one that came on time and moves nothing. The clock keeps within a step above what
// it wants: below it, it is moved up a step at a time, so a press still reaches the server by its
// step; more than a step above, down a step at a time, which holds the rows drawn for a frame. A
// server slower than the page's clock falls a step behind now and then, and the page holds a frame
// each time, once the packets from before it fell behind have left the window; a steps ahead that
// grows moves the page a step on at once, and one that falls holds it a frame, a window later. The
// clock starts a quarter step past a whole step, so a frame of a display that draws one a step, or
// two, is a quarter step from the edge of one, however its timing wobbles. The window is long
// beside a stall or a burst of packets and short beside how far two machines' clocks drift apart.
// A ledger is a row that only appends events for the page to play or draw: a sound on audio's, an
// effect on particle3d's, a launched round on volley3d's. The scene's `world.player.ledgers` names
// their kinds, fixed for the scene, so no row carries the list. What a run here writes
// to a row of one of them, or calls on it, is dropped rather than refusing the run: the pressed row
// is still predicted, the ledger drawn is the packet's, and the sound or effect comes once, from the
// server's packet.
// The rule file of a kind is `<kind>.sim.ts` next to the page, as its drawing file is, and every
// kind the page is sent a row of has one: two kinds with one rule are two one-line files handing
// out the one `Kind`. A plugin's kind — one named in the scene's `plugins` or in
// `world.shipped`'s `plugins` — has its rule in the plugin's folder, not next to the page, so no file is
// asked for, and a press whose rule calls a row of such a kind — a `quit` that calls `go` on the
// `scenemanager` row — is not run here, as a spawn is not: the rows drawn are the ones the packet
// carries. `player` is the one name that is both: the scene lists the player plugin, and the
// `player` kind's rule is the game's own, which every press is sent to, so its file is always asked
// for.
//
// A message the pipe refuses is numbered 0 by `wire.send`. The press is not run here, not kept,
// and not re-applied: the rows drawn are the ones the packet carried.
//
// One of these per client. The rules it loaded, the rows it predicted, the presses no ack covers
// yet, the step it thinks it is at, the key table and the listeners on the page all belong to the
// one scene it was made for, and go when the page closes that scene's client: a key pressed after
// the seat moved on cannot reach the rows of the scene it left.
//
// Keys, mouse and clicks. A game's player actor hands `bind` one table in its setup and holds no
// listener, no queue and no tick of its own. The plugin listens on the page, and a key that goes
// down in a field of the page, an input, a text area, a select or anything editable, is the
// field's and not the seat's, so typing in a panel beside the game plays nothing: a key in `press`
// sends its message the moment the key goes down, or, for a key `press` gives a function, runs it
// then and sends nothing, for what is the page's alone, such as a key of the store; `release` gives
// a key a function run when it comes up, or when the page lets go of every key, and a key it names
// is pressed once per hold, the keyboard's repeats of it running nothing, as a synth's note is; each `axis` is two keys whose held value,
// -1, 0 or 1, is sent through `send` when it changes; each `stick` is four keys, left, right, up
// and down, whose held value, an x and a y each -1, 0 or 1 with y growing down, is sent through
// `send` as one message when either changes, so a rule hears a way at once rather than two halves
// of it a message apart; each `hold` is a button of one or more keys,
// held while any of them is down, whose value, 1 held and 0 let go, is sent through `send` when
// it changes, so a rule can do a thing for as long as it is held; `every` is asked each frame, in this
// plugin's tick, for a message from what is held; `click` is asked for a message from where the
// page was clicked, in the canvas's pixels: the page's CSS pixels divided by the renderer's
// `scale`, which is more than 1 when render2d's `fit` draws a canvas pixel across several. A mouse
// button is a key named `Mouse` and the button's number — `Mouse0` the left, `Mouse1` the middle,
// `Mouse2` the right — held while it is down and sent from `press` the moment it goes down. Each key
// an `axis` or a `stick` names may be a list of keys, any of which holds it: the arrows and w a s d
// for one stick.
// The scene's `ui` is asked first. A click, or a mouse button going down, over something on the UI
// that takes the pointer is the UI's: it is not held, sends nothing and asks `click` nothing. A
// key the UI took — every key while a modal has the input, but `world.ui`'s `back` key on a
// screen the game put up, which is the game's to bind — does not go down here. Each frame a modal has the input, every key
// and button held is let go, the way their release would, so an `axis` sends 0 and the seat stops,
// and a pointer lock this plugin took is given back, so the pointer can reach the menu; while the
// modal's backdrop covers the page, no click takes it again.
// A key is named by its place on the keyboard, the event's `code`, as `keyOf` names it: what that
// key types on a US keyboard without Shift, so `a`, `1`, `' '`, `-`, `Shift`, `ArrowLeft`,
// `Escape`. So it is one key with Shift down or not: `w` is held from its press as `W` to its release
// as `w`, and `1` from its press to its release as `!`. A key on another layout is named by where it
// is, so a table's `w a s d` are the same four keys under the left hand on every keyboard. A key with
// no place, as an on-screen keyboard's, is named by what it typed, a letter in lower case.
//
// Gamepads. Every gamepad connected is read each frame, in this plugin's tick, and its buttons and
// its left stick are keys like any other, in any table and with the same `press`, `axis`, `stick`,
// `hold`, `every` and `locked`: a key goes down the frame it is first seen down on any gamepad and
// comes up the frame none has it down, and has no repeat. A button is `Pad` and its number in the
// browser's standard mapping: `Pad0` the bottom face button (A on an Xbox pad, cross on a
// PlayStation's), `Pad1` the right, `Pad2` the left, `Pad3` the top, `Pad4` and `Pad5` the left and
// right shoulders, `Pad6` and `Pad7` the triggers, `Pad8` select, `Pad9` start, `Pad10` and `Pad11`
// the sticks pressed in, `Pad12` to `Pad15` the d-pad's up, down, left and right, `Pad16` the home
// button. A gamepad the browser does not map to the standard numbers its buttons its own way. The
// left stick holds `PadStickLeft`, `PadStickRight`, `PadStickUp` and `PadStickDown` while it is
// pushed that way past the `player` prefab's `deadzone`, a fraction of the way out, each axis on its
// own, so a push both ways holds a diagonal; a scene whose prefab gives no `deadzone` reads no stick,
// and a table that names a side of it there throws. So `stick` keys of `[['ArrowLeft', 'a', 'Pad14',
// 'PadStickLeft'], …]` move a seat from the arrows, the keys, the d-pad or the stick. While a
// modal has the input no gamepad key goes down, and one down as it came up is held only on a new
// press.
//
// Actions: the second avenue. `bind`'s table binds what a seat does straight to keys. `control`'s
// binds it to the scene's actions instead, and the scene binds the keys to the actions, so a player
// can change which keys play which action and the game never knows. The scene names each action in
// `world.player.actions`, fixed for the scene and so carried by no row, with the `label` a screen
// shows it by and its `keys`, whose shape is what it is: a list of keys is a button, held while any
// of them is down; two lists are an axis, the keys that push it to -1 and the ones that push it to
// 1; four lists are a stick, left, right, up and down. `control`'s table is `bind`'s keyed by those
// actions: `press`, `release` and `hold` name buttons, `axis` axes and `stick` sticks, `every` is
// handed whether a button action is held, `locked` names button actions, and `drag` and `stroke`
// each name the button action whose keys they follow; `click`, `pointer`, `hover` and `wheel` are
// as they are in `bind`. It throws on an action the scene does not name, and on one whose keys are
// not the shape the part of the table naming it reads. `bind` and `control` each replace the other
// as the table in force, and `unbind` drops either. On this avenue:
// - the left stick reads `world.player.deadzone`, not the player prefab's, and a scene whose actions
//   hold a side of it and gives none throws;
// - a gamepad key going down is offered to the UI (`keyDown`, and `keyUp` as it comes up) before it
//   is the game's, as a key from the keyboard is, so a pad moves through the UI's menus;
// - what the player chose is the page's, never the server's: four keys of the store, which the
//   scene lists before `player`, or it throws, so the store has ticked when they are read. A scene
//   that lists no store plays the scene's actions and settings and changes none.
//   - `player.keys`, the actions rebound, each to keys of the shape the scene gives it; an action
//     it leaves out has the scene's.
//   - `player.toggle`, the button actions played as toggles: a press of one of its keys holds it
//     and the next lets it go, so a `hold` sends the 1 and the 0 a held key sends, and no rule can
//     tell. A modal, or the pointer lock lost, lets a toggle go as it lets a key go.
//   - `player.deadzone`, in place of `world.player.deadzone`.
//   - `player.repeat`, in place of `world.player.repeat` (0 when the scene gives none): the seconds
//     between presses while a `press` action is held. Above 0 the keyboard's own repeats press
//     nothing and the action is pressed again every that many seconds, the first that long after it
//     went down, from a gamepad as from a key; at 0 a keyboard's repeat presses it again, as
//     `bind`'s does. An action with a `release` is pressed once a hold either way.
// What a screen that shows and changes the actions calls, all of it on the page:
// - `actions()`: each action the scene names, in its order, with its `name`, `label`, `shape`
//   (`button`, `axis` or `stick`), the `keys` it has now, the scene's `defaults`, and `bound`, the
//   parts of the table in force that name it.
// - `listen(fn)`: the next key, mouse button or gamepad button that goes down is handed to `fn` and
//   to nothing else, neither the game nor the UI, and `listening` is true until it is; `Escape`
//   hands `fn` undefined, as does `unbind`, and a click after a mouse button it took is nobody's.
// - `rebind(action, keys)`: `player.keys` given the action's new keys, in its shape, or it throws.
// - `restore(action?)`: the action's keys and its toggle back to the scene's; with no action, every
//   action's, and the deadzone and the repeat.
// - `conflicts()`: each key more than one action holds, with the actions holding it.
// - `settings()` and `configure(changes)`: the toggles, the deadzone and the repeat in force, and a
//   change to any of them, written to the store. A toggle is a button action; a deadzone is above 0
//   and below 1; a repeat is 0 or more seconds.
// - `device()`: what was used last: `keyboard` (a key or a mouse button), `xbox` or `playstation`
//   by the gamepad's `id`, or `pad` for any other.
// Each is the plugin's own and not a message, as `bind` is.
//
// A key or a mouse button the table names anywhere has its browser default cancelled, as the wheel
// does when `wheel` is in the table: Tab would move the focus off the page, the right button open a
// menu, the wheel scroll it.
// With Control, Command or Alt down it keeps its default, the wheel too, so the browser's shortcuts
// (zoom, find, copy, and zoom on the wheel or a trackpad's pinch) still work on a page that binds the
// key; the game still hears it.
// `locked` names keys the game hears only while the page holds the pointer lock, pressed under it:
// without it they are not held and `press` hears nothing of them, and one already down when a click
// takes the lock is not held until it is pressed again. So a strike on the left button and a block
// on the right are the game's while the mouse looks, and a click without the lock only takes it.
// The frame the page loses the pointer lock, every key held is let go, as its release would, and
// each is held again only on a new press.
// With `drag` in the table, `{ key, send }`, the mouse's movement while that key is down and the
// page holds no pointer lock is added up, and `send` is asked once each frame for a message from the
// page pixels it moved across and down; a frame it did not move asks nothing. `wheel` is asked once each
// frame the wheel turned, for a message from the pixels it turned down since the last one.
// With `hover` in the table, it is asked once each frame the mouse moved without the pointer lock,
// for a message from where the pointer is now, `[x, y]` in the canvas's pixels as `click` has them,
// or from `null` the frame it went over something on the UI that takes the pointer, or off the page:
// what the pointer is over, a cell a tool would build on, is drawn from it.
// With `stroke` in the table, `{ key, start, move, end, cancel }`, a press of `key`, a mouse button,
// that is not the UI's begins a stroke: `start` is asked for a message from where it went down,
// `move` once each frame the mouse moved while it is down from where it is now, and `end` from where
// it came up, which ends it, over the UI or not, so a road is laid from where a drag began to where
// it ended. A stroke the plugin lets go of without its release, as a modal lets every key go, asks
// `cancel` and nothing more. Each is left out to ask nothing, and each point is in the canvas's
// pixels.
// With `pointer` in the table, a click on the page takes the pointer lock for the element
// clicked, and while the page holds the lock the mouse's movement is added up and `pointer` is
// asked once each frame, in this plugin's tick, for a message from the page pixels it moved across and
// down since the last one; a frame it did not move asks nothing. A key goes down between frames,
// so its message waits with the other calls made outside a frame and is applied in the next tick,
// before any actor draws. The table in force is the last one bound; `unbind` drops it and the
// listeners, and gives back a pointer lock this plugin took. Where there is no `document`, as in
// node, or one with no pointer lock, as the one the loader lends node while a model decodes, nothing
// holds the pointer lock and there is none to give back.
//
// `step` is the step the rows drawn are at, predicted either way, and `seen` the page's clock as its
// last tick read it, the moment that step was placed at.
//
// Whole steps. A scene with `world.player.steps` true is predicted another way, for rules that keep
// state between steps a single row's rule cannot be run ahead without, such as box3d's physics
// world, which moves every body in the box3d row's own tick. There the page keeps its own rows,
// the same objects by id from packet to packet, and runs whole steps over them: every row's
// `before`, `tick` and `after`, as the server does. Each kind's rule is `<kind>.sim.ts` next to the
// page, or else its plugin's, `plugins/<kind>/<kind>.sim.ts`. A press is stamped with the page's
// step and applied before that step's passes; the engine holds a message until the step it is
// stamped with, so the server applies it on the same step. The page runs on the Clock, the whole
// round trip ahead, so a press reaches the server by its step. The round trip is measured by a
// probe, a message whose action is '', which the engine refuses, writes nothing for and still acks:
// it is stamped with the step of the last packet the page has, so no server holds it, and the first
// packet whose ack covers it shows the step the server took it at, that packet's step less one. The
// page takes every packet that came since its last frame at once, and only the last is read, so
// that step is taken as the last frame's packet's, the least it can be: a round trip a stall drew
// out, as a page's first frames do while it loads, is not measured at all. Each message covered, a
// probe or a press, measures a steps ahead: the steps ahead it was sent with, and the steps the
// server took it past the lowest step the clock could have been at when it was sent, so a press
// that lands L steps late moves the page L steps further ahead, and a probe the server took early
// lets it fall. `lead` is the steps ahead the clock runs by. The page sends a probe when it first
// joins and again each time the last is covered, after the frame's step is placed.
// The page keeps its rows after each step it ran. A packet for step n is compared with the page's
// rows after step n, row by row as a packet carries them: the same, and nothing happens; different,
// and the packet is written into the page's rows (each row's data into the page's object of its id,
// a row the page lacks added, a row the packet lacks dropped) and the steps from n are run again,
// each press no ack covers applied before the step it is stamped with. The objects are kept because
// a plugin keeps its library's memory per row object, as box3d keeps its world per box3d row: new
// objects would mean a new world per correction, and Box3D holds at most 128 a process. `reruns`
// counts the corrections, and `fixed` is the last one: `was`, the page's rows after the packet's step
// as it ran them, and `now`, the packet's. A packet is compared after
// the page has run to its step with every press stamped before it, and only then are the presses
// its ack covers dropped: a page on the server's step is sent the ack of a press before it has run
// the step the press is stamped for, and that step is run with the press. The pipe's `send` stamps
// a message with `wire.n`, the last packet's step, and the engine is not changed for this, so the
// player sets `wire.n` to its step for the one call and puts it back.
// A step that spawns, ends a row, rolls the die or writes the world is not run here: the rows drawn
// are the last packet's until the next packet. The seat is taken to be sent every row a step reads.
import type { Arg, Kind, Row, Scene, W } from '#engine/engine.ts'
import type { Plugins, Wire } from '#engine/browser.ts'
import { delta } from '#addons/scenemanager/scenemanager.addon.ts'

export type Input = [action: string, ...args: Arg[]]
export type Keys = string | string[]
export type Binds = {
  press?: Record<string, Input | (() => void)>
  release?: Record<string, () => void>
  axis?: { keys: [neg: Keys, pos: Keys]; send: (v: number) => Input }[]
  stick?: { keys: [left: Keys, right: Keys, up: Keys, down: Keys]; send: (x: number, y: number) => Input }[]
  hold?: { keys: string[]; send: (v: number) => Input }[]
  every?: (held: (key: string) => boolean) => Input | undefined
  click?: (x: number, y: number) => Input | undefined
  pointer?: (dx: number, dy: number) => Input | undefined
  drag?: { key: string; send: (dx: number, dy: number) => Input | undefined }
  hover?: (at: [number, number] | null) => Input | undefined
  stroke?: {
    key: string
    start?: (x: number, y: number) => Input | undefined
    move?: (x: number, y: number) => Input | undefined
    end?: (x: number, y: number) => Input | undefined
    cancel?: () => Input | undefined
  }
  wheel?: (dy: number) => Input | undefined
  locked?: string[]
}

// The action avenue (Actions, above). An action's keys, whose shape is what it is: a button's list,
// an axis's two lists, a stick's four.
export type Bound = string[] | string[][]
export type Shape = 'button' | 'axis' | 'stick'
// An action as the scene names it in `world.player.actions`.
export type Action = { label: string; keys: Bound }
// An action as a screen reads it, from `actions()`.
export type Shown = { name: string; label: string; shape: Shape; keys: Bound; defaults: Bound; bound: string[] }
export type Settings = { toggle: string[]; deadzone: number | undefined; repeat: number }
export type Device = 'keyboard' | 'xbox' | 'playstation' | 'pad'
// `control`'s table: `Binds` keyed by the scene's actions instead of keys.
export type Controls = {
  press?: Record<string, Input | (() => void)>
  release?: Record<string, () => void>
  axis?: Record<string, (v: number) => Input>
  stick?: Record<string, (x: number, y: number) => Input>
  hold?: Record<string, (v: number) => Input>
  every?: (held: (action: string) => boolean) => Input | undefined
  click?: (x: number, y: number) => Input | undefined
  pointer?: (dx: number, dy: number) => Input | undefined
  drag?: { action: string; send: (dx: number, dy: number) => Input | undefined }
  hover?: (at: [number, number] | null) => Input | undefined
  stroke?: {
    action: string
    start?: (x: number, y: number) => Input | undefined
    move?: (x: number, y: number) => Input | undefined
    end?: (x: number, y: number) => Input | undefined
    cancel?: () => Input | undefined
  }
  wheel?: (dy: number) => Input | undefined
  locked?: string[]
}

// The shape of an action's keys: a list of keys is a button, two lists an axis, four a stick.
export function shapeOf(keys: Bound): Shape {
  if (keys.every(k => typeof k === 'string')) return 'button'
  if (keys.every(k => Array.isArray(k) && k.every(x => typeof x === 'string'))) {
    if (keys.length === 2) return 'axis'
    if (keys.length === 4) return 'stick'
  }
  throw new Error(`keys ${JSON.stringify(keys)} are not a button's list, an axis's two lists or a stick's four`)
}

// The keys whose name is not their `code` with a side or a prefix taken off: what each types on a
// US keyboard without Shift, or with NumLock on for the number pad's.
const TYPED: Record<string, string> = {
  Space: ' ', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/', OSLeft: 'Meta', OSRight: 'Meta',
  NumpadDecimal: '.', NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/',
  NumpadEnter: 'Enter', NumpadEqual: '=', NumpadComma: ',',
}

// The four sides of the left stick, each a key.
const STICK = ['PadStickLeft', 'PadStickRight', 'PadStickUp', 'PadStickDown']

// The name a binding gives the key at `code`, a `KeyboardEvent.code`: `KeyA` is `a`, `Digit1` and
// `Numpad1` are `1`, `Space` is `' '`, `ShiftLeft` and `ShiftRight` are `Shift` (and so Control, Alt
// and Meta), a punctuation key is what it types without Shift (`Minus` is `-`), and any other key is
// its code, which for every key the page names alike is its `key` too (`ArrowLeft`, `Escape`,
// `Enter`, `Tab`, `F1`).
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code[3].toLowerCase()
  if (/^(Digit|Numpad)\d$/.test(code)) return code[code.length - 1]
  const side = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code)
  return side ? side[1] : (TYPED[code] ?? code)
}

// The `code` of the key a table names, the one a key event from that key carries: `keyName` run
// backwards, taking the main keyboard's key over the number pad's and the left of a pair of
// modifiers. A letter may be given in either case, as the page types it with Shift down. It is what
// a test builds a key event from, as the browser would send it.
export function keyCode(name: string): string {
  if (/^[a-z]$/i.test(name)) return `Key${name.toUpperCase()}`
  if (/^\d$/.test(name)) return `Digit${name}`
  if (/^(Shift|Control|Alt|Meta)$/.test(name)) return `${name}Left`
  return Object.keys(TYPED).find(c => !/^(Numpad|OS)/.test(c) && TYPED[c] === name) ?? name
}

// The name of the key a key event is from, the one every table names it by, `world.ui`'s
// too: `keyName` of its `code`, so the key that comes up is the one that went down whatever Shift
// did in between. A key with no place, as an on-screen keyboard's, is named by what it typed, a
// letter in lower case.
export function keyOf(e: KeyboardEvent): string {
  return e.code && e.code !== 'Unidentified' ? keyName(e.code) : /^[A-Z]$/.test(e.key) ? e.key.toLowerCase() : e.key
}

export function player() {
  const PASSES = ['before', 'tick', 'after'] as const
  type Press = { seq: number; n: number; id: number; action: string; args: Arg[] }

  let wire: Wire | undefined
  let all: Plugins | undefined
  let between = true // no frame is running: presses wait for the next tick
  const waiting: (() => void)[] = []
  // Everything below belongs to one wire and starts over when the frame brings a new one.
  let rules = new Map<string, { kind?: Kind; error?: Error }>()
  let predicted = new Set<number>() // rows a press wrote here; drawn from the browser's copy
  let struck = new Map<number, Row>() // rows a predicted row's step called an act of, as the rules here read them until the next packet
  let unacked: Press[] = [] // presses run here that no packet's ack covers yet
  let sent: { seq: number; n: number }[] = [] // every press and the packet's step it was sent on, for the round trip
  let seenN = -1, n = 0 // n: the browser's step
  // The page's own clock of steps (the header's Clock): `clock` in steps, `last` the page's clock at
  // the tick that moved it, NaN before the first packet. `taken` is each packet taken in the last
  // `window` seconds, when by the page's clock and its step; `trips` each steps-ahead measured in them.
  let clock = NaN, last = 0
  let low = 0 // the lowest step the clock could be at, with the lead it runs ahead by: its want's floor
  let seen = NaN // the page's clock as the last tick read it
  let taken: { at: number; n: number }[] = []
  let trips: { at: number; steps: number }[] = []

  // The kinds whose rule is a plugin's, which have no file next to the page.
  const plugged = (scene: Scene) => new Set([...(scene.plugins ?? []), ...(scene.world?.shipped?.plugins ?? [])].filter(k => k !== 'player'))

  async function load(home: string, scene: Scene, kinds: Iterable<string>) {
    const skip = plugged(scene)
    for (const kind of kinds) {
      if (rules.has(kind) || skip.has(kind)) continue
      try {
        const mod = await import(/* @vite-ignore */ new URL(`${kind}.sim.ts`, home).href)
        if (!(kind in mod)) throw new Error(`${kind}.sim.ts does not export ${kind}`)
        rules.set(kind, { kind: mod[kind] })
      } catch (e) {
        rules.set(kind, { error: e as Error })
      }
    }
  }

  function rule(kind: string): Kind {
    const r = rules.get(kind)
    if (!r) throw new Error(`no rule file loaded for kind ${kind}`)
    if (r.error) throw r.error
    return r.kind!
  }

  // Runs f over a clone of the rows, each called row as the rules here read it, and returns the rows
  // it wrote, or undefined when it wrote a row `allowed` does not cover, spawned, ended, rolled the
  // die, wrote the world, or called a row whose rule has no file next to the page. What it wrote to a
  // row of a ledger kind, or called on one, is dropped: that row stays the packet's.
  function run(f: (w: W) => void, allowed: (id: number, called: Set<number>) => boolean): Row[] | undefined {
    const { scene } = wire!
    const ledgers = new Set<string>(scene.world?.player?.ledgers ?? [])
    const rows = structuredClone(wire!.rows.map(r => struck.get(r.id) ?? r))
    const world = structuredClone(scene.world ?? {})
    const before = new Map(rows.map(r => [r.id, JSON.stringify(r.data)]))
    const called = new Set<number>()
    let bad = false
    const get = (id: number) => {
      const r = rows.find(r => r.id === id)
      if (!r) throw new Error(`no row ${id}`)
      return r
    }
    const w: W = {
      world,
      all: kind => rows.filter(r => r.kind === kind),
      get,
      find: (kind, pred = () => true) => {
        const r = rows.find(r => r.kind === kind && pred(r))
        if (!r) throw new Error(`no ${kind} matches`)
        return r
      },
      spawn: (kind, data = {}) => { bad = true; return { id: 0, kind, data: { ...structuredClone(scene.prefabs[kind]), ...data } } },
      end: () => { bad = true },
      die: () => { bad = true; return 0 },
      call: (row, action, seat, ...args) => {
        if (ledgers.has(row.kind)) return
        // A row whose rule has no file next to the page — a plugin's, such as `scenemanager` — is
        // run on the server alone.
        if (!rules.get(row.kind)?.kind) { bad = true; return }
        const act = rule(row.kind).acts?.[action]
        if (!act) throw new Error(`no action ${row.kind}.${action}`)
        called.add(row.id)
        act(get(row.id), w, seat, ...args)
      },
    }
    f(w)
    if (bad || JSON.stringify(world) !== JSON.stringify(scene.world ?? {})) return
    const wrote = rows.filter(r => !ledgers.has(r.kind) && before.get(r.id) !== JSON.stringify(r.data))
    return wrote.every(r => allowed(r.id, called)) ? wrote : undefined
  }

  const swap = (row: Row) => { wire!.rows[wire!.rows.findIndex(r => r.id === row.id)] = row }

  // The seconds of packets the clock is placed from: `world.player.window`, or 2. Long enough to hold
  // a packet that came on time through a stall or a burst, short beside how far two clocks drift.
  function windowOf(): number {
    const s = wire!.scene.world?.player?.window ?? 2
    if (typeof s !== 'number' || !(s > 0)) throw new Error('the scene\'s world.player.window is not a number of seconds above 0')
    return s
  }

  // What the window keeps of `list` at `now`: its entries of the last `window` seconds, and the
  // newest whatever its age.
  const within = <T extends { at: number }>(list: T[], now: number) => list.filter((e, i) => i === list.length - 1 || e.at >= now - windowOf() * 1000)

  // The packet taken now, at step `n`, for the clock.
  function took(now: number, n: number) {
    taken = within([...taken, { at: now, n }], now)
    trips = within(trips, now)
  }

  // A steps-ahead measured now.
  function trip(now: number, steps: number) {
    trips = within([...trips, { at: now, steps }], now)
  }

  // The steps ahead: the most the window measured.
  const leadNow = () => trips.reduce((m, t) => Math.max(m, t.steps), 0)

  // The step the page is at `now`, by its own clock (the header's Clock).
  function paced(now: number, dt: number): number {
    const ms = dt * 1000
    const want = taken.reduce((m, t) => Math.max(m, t.n + (now - t.at) / ms), -Infinity) + leadNow()
    if (Number.isNaN(clock)) clock = Math.ceil(want - 1 / 4) + 1 / 4
    else clock += (now - last) / ms
    last = now
    while (clock < want) clock += 1
    while (clock > want + 1) clock -= 1
    low = Math.floor(want)
    return Math.floor(clock)
  }

  // Applies a press here when its rule writes only the row it names or the row that rule calls.
  function apply(p: Press): boolean {
    const me = wire!.rows.find(r => r.id === p.id)
    if (!me) return false
    const act = rule(me.kind).acts?.[p.action]
    if (!act) throw new Error(`no action ${me.kind}.${p.action}`)
    const wrote = run(w => act(w.get(p.id), w, me.data.seat, ...p.args), (id, called) => id === p.id || called.has(id))
    if (!wrote) return false
    for (const r of wrote) { swap(r); predicted.add(r.id); struck.delete(r.id) }
    return true
  }

  // One step of each predicted row's per-step rule, each only when it writes nothing but that row
  // and the rows whose acts it called. What it wrote to a predicted row is drawn; what it wrote to
  // another is kept for the rules here and drawn as the packets bring it.
  function advance() {
    const dt = wire!.scene.prefabs.engine?.dt
    if (!dt) throw new Error('scene has no engine prefab with dt')
    for (const id of predicted) {
      const wrote = run(w => { const me = w.get(id); for (const pass of PASSES) rule(me.kind)[pass]?.(me, dt, w) }, (x, called) => x === id || called.has(x))
      for (const r of wrote ?? []) {
        if (predicted.has(r.id)) swap(r)
        else struck.set(r.id, r)
      }
    }
  }

  // ------------------------------------------------ whole steps (`world.player.steps`)

  // `n` the step it is stamped with, `low` the lowest step the page could have been at when it was
  // sent, `lead` the steps ahead then.
  type Stamped = { seq: number; n: number; low: number; lead: number; id: number; action: string; args: Arg[] }
  let mine: Row[] | undefined // the page's own rows, after `at` steps
  let own: any // the page's own copy of the scene's world, which its steps read
  let at = 0
  let kept = new Map<number, Row[]>() // the page's rows after each step it ran, by step
  let pending: Stamped[] = [] // presses and the probe that no ack covers yet
  let stuck = false // a step could not be run here: hold at the packet until the next one
  let reruns = 0
  let fixed: { was: Row[]; now: Row[] } | undefined // the last correction
  const whole = () => !!wire!.scene.world?.player?.steps

  // The rule of each kind: next to the page, or else its plugin's.
  async function loadWhole(home: string, kinds: Iterable<string>) {
    for (const kind of kinds) {
      if (rules.has(kind)) continue
      const from = async (url: string) => {
        const mod = await import(/* @vite-ignore */ url)
        if (!(kind in mod)) throw new Error(`${url} does not export ${kind}`)
        return mod[kind] as Kind
      }
      try {
        rules.set(kind, { kind: await from(new URL(`${kind}.sim.ts`, home).href) })
      } catch {
        try {
          rules.set(kind, { kind: await from(new URL(`../${kind}/${kind}.sim.ts`, import.meta.url).href) })
        } catch (e) {
          rules.set(kind, { error: e as Error })
        }
      }
    }
  }

  // One whole step of the page's rows, as the server steps its truth: the presses stamped with this
  // step, then every row's passes. False, and the rows as they were, when the step spawned, ended a
  // row, rolled the die or wrote the world.
  function stepWhole(dt: number): boolean {
    const rows = mine!, world = own ??= structuredClone(wire!.scene.world)
    const was = JSON.stringify(world)
    const refuse = () => { throw refused }
    const get = (id: number) => {
      const r = rows.find(r => r.id === id)
      if (!r) throw new Error(`no row ${id}`)
      return r
    }
    const w: W = {
      world,
      all: kind => rows.filter(r => r.kind === kind),
      get,
      find: (kind, pred = () => true) => {
        const r = rows.find(r => r.kind === kind && pred(r))
        if (!r) throw new Error(`no ${kind} matches`)
        return r
      },
      spawn: refuse, end: refuse, die: refuse,
      call: (row, action, seat, ...args) => {
        const act = rule(row.kind).acts?.[action]
        if (!act) throw new Error(`no action ${row.kind}.${action}`)
        act(get(row.id), w, seat, ...args)
      },
    }
    try {
      for (const p of pending.filter(p => p.n === at && p.action !== '')) {
        const me = rows.find(r => r.id === p.id)
        const act = me && rule(me.kind).acts?.[p.action]
        if (act) act(me, w, me.data.seat, ...p.args)
      }
      for (const pass of PASSES) for (const row of [...rows]) rule(row.kind)[pass]?.(row, dt, w)
      if (JSON.stringify(world) !== was) throw refused
    } catch (e) {
      if (e !== refused) throw e
      for (const k of Object.keys(world)) delete world[k]
      Object.assign(world, JSON.parse(was))
      return false
    }
    at++
    kept.set(at, structuredClone(rows))
    return true
  }
  const refused = new Error('a step the page does not run')

  // The packet's rows written into the page's own: each row's data into the page's object of its
  // id, a row the page lacks added, a row the packet lacks dropped.
  function reset(to: Row[], n: number) {
    const had = new Map((mine ?? []).map(r => [r.id, r]))
    mine = to.map(r => {
      const own = had.get(r.id)
      if (!own || own.kind !== r.kind) return structuredClone(r)
      own.data = structuredClone(r.data)
      return own
    })
    at = n
    kept = new Map([[n, structuredClone(to)]])
  }

  const matches = (a: Row[], b: Row[]) => { const d = delta(a, b); return !d.add.length && !d.change.length && !d.drop.length }

  // Runs the page's rows forward to step `to`, or holds at the packet when a step cannot be run.
  function runTo(to: number, dt: number) {
    while (!stuck && at < to) if (!stepWhole(dt)) { stuck = true; reset(wire!.rows, wire!.n) }
  }

  // A message stamped with the page's step: the pipe stamps `wire.n`, so it is the page's step for
  // the one call. 0 when the pipe refused it.
  function stamped(id: number, action: string, args: Arg[]): number {
    const packet = wire!.n
    wire!.n = at
    try { return wire!.send(id, action, ...args) } finally { wire!.n = packet }
  }

  async function tickWhole(now: number, dt: number) {
    if (wire!.n !== seenN) {
      // A message the ack covers was taken on the step before the first packet that shows it. That
      // packet came after the one the last frame took, so that step is at least the last frame's
      // packet's. The lead that would have had it taken on the lowest step the page could have been
      // at when it was sent is a steps-ahead measured.
      const before = seenN
      seenN = wire!.n
      took(now, wire!.n)
      await loadWhole(wire!.home, new Set(wire!.rows.map(r => r.kind)))
      for (const p of pending) if (p.seq <= wire!.ack) trip(now, Math.max(0, p.lead + before - p.low))
      stuck = false
      // The page catches up to a packet for a step it has not run by running the steps, with the
      // presses stamped for them, so its world stays one run of them, and compares the packet with
      // what it ran. Every press the ack covers was stamped before the packet's step, so the steps
      // from it on need none of them.
      if (!mine) reset(wire!.rows, wire!.n)
      else {
        runTo(wire!.n, dt)
        const mineThen = kept.get(wire!.n)
        if (!mineThen || !matches(mineThen, wire!.rows)) {
          const ahead = at
          reruns++
          fixed = { was: mineThen ?? [], now: wire!.rows }
          reset(wire!.rows, wire!.n)
          runTo(ahead, dt)
        }
      }
      pending = pending.filter(p => p.seq > wire!.ack)
      for (const n of kept.keys()) if (n < wire!.n) kept.delete(n)
    }
    runTo(paced(now, dt), dt)
    if (!pending.some(p => p.action === '')) {
      const me = wire!.rows.find(r => r.kind === 'player')
      const seq = me ? wire!.send(me.id, '') : 0
      if (seq) pending.push({ seq, n: wire!.n, low, lead: leadNow(), id: me!.id, action: '', args: [] })
    }
    wire!.rows = structuredClone(mine!)
  }

  function sendWhole(name: string, args: Arg[]) {
    const me = mine!.find(r => r.kind === 'player')
    if (!me) throw new Error('no player row on this seat')
    const seq = stamped(me.id, name, args)
    if (seq === 0) return
    pending.push({ seq, n: at, low, lead: leadNow(), id: me.id, action: name, args })
  }

  const send = (name: string, args: Arg[]) => {
    if (whole()) return sendWhole(name, args)
    const me = wire!.rows.find(r => r.kind === 'player')
    if (!me) throw new Error('no player row on this seat')
    const seq = wire!.send(me.id, name, ...args)
    // The pipe refused it, so no seat will ever ack it. Nothing is predicted and nothing is kept:
    // a press that was never sent is a press that never happened.
    if (seq === 0) return
    sent.push({ seq, n: wire!.n })
    const press = { seq, n, id: me.id, action: name, args }
    if (apply(press)) unacked.push(press)
  }

  async function tick(p: Plugins) {
    all = p
    if (p.wire !== wire) {
      wire = p.wire
      rules = new Map(); predicted = new Set(); struck = new Map(); unacked = []; sent = []
      seenN = -1; n = 0; clock = NaN; last = 0; low = 0; taken = []; trips = []
      mine = undefined; own = undefined; at = 0; kept = new Map(); pending = []; stuck = false; reruns = 0; fixed = undefined
    }
    between = false
    const now = performance.now()
    seen = now
    const dt = wire.scene.prefabs.engine?.dt
    if (!dt) throw new Error('scene has no engine prefab with dt')
    if (whole()) await tickWhole(now, dt)
    else if (wire.n !== seenN) {
      // The ack came on one of the packets taken this frame, so after the last frame's: the round
      // trip, in the server's steps, is at least from the packet the press was sent on to that one.
      const before = seenN
      seenN = wire.n
      took(now, wire.n)
      await load(wire.home, wire.scene, new Set(wire.rows.map(r => r.kind)))
      const covered = sent.filter(s => s.seq <= wire!.ack)
      if (covered.length) {
        trip(now, Math.max(0, Math.floor((before - covered[covered.length - 1].n) / 2)))
        sent = sent.filter(s => s.seq > wire!.ack)
      }
      for (const id of [...predicted]) if (!wire.rows.some(r => r.id === id)) predicted.delete(id)
      // The packet's rows are the server's, the acts' writes on them included.
      struck = new Map()
      let left = unacked.filter(u => u.seq > wire!.ack)
      unacked = []
      const replay = (due: (p: Press) => boolean) => {
        const now = left.filter(due)
        left = left.filter(p => !now.includes(p))
        for (const p of now) if (apply(p)) unacked.push(p)
      }
      n = wire.n
      replay(p => p.n <= n)
      const due = paced(now, dt)
      while (n < due) { advance(); n++; replay(p => p.n <= n) }
      replay(() => true)
    } else {
      const due = paced(now, dt)
      while (n < due) { advance(); n++ }
    }
    for (const f of waiting.splice(0)) f()
    if (controls) refresh()
    // Every key held as the lock was lost is let go, and every toggle with them.
    const hasLock = !!lockedTo()
    if (hadLock && !hasLock) { down.clear(); armed.clear(); latched.clear() }
    hadLock = hasLock
    // A gamepad key going down is pressed and held as a key's is, but not while a modal has the
    // input: one down then is held only on a new press, as a key is once a modal has let it go.
    // Every key a poll moved is moved before the axes are asked, so a stick swung from one side to
    // the other between two frames sends the one way it holds now.
    if (binds) {
      if (sticks && typeof wire.scene.prefabs.player?.deadzone !== 'number') throw new Error('the player table binds the left stick, and the player prefab has no deadzone')
      const now = poll(wire.scene.prefabs.player?.deadzone), modal = !!all?.ui?.modal()
      for (const k of pads) if (!now.has(k)) { down.delete(k); armed.delete(k) }
      for (const k of now) if (!pads.has(k) && !modal) { hold(k); pressed(k) }
      pads = now
    }
    // On the action avenue a gamepad key going down is handed to a `listen` waiting for one, else
    // offered to the UI, as a key from the keyboard is, and is the game's only when neither takes it;
    // each one handed to the UI is handed it again as it comes up.
    if (controls) {
      if (sticks && deadzone() === undefined) throw new Error('an action holds a side of the left stick, and the scene gives no world.player.deadzone')
      const now = poll(deadzone()), modal = !!all?.ui?.modal()
      for (const k of pads) if (!now.has(k)) { down.delete(k); armed.delete(k); all?.ui?.keyUp?.(k) }
      for (const k of now) {
        if (pads.has(k)) continue
        used = family(padOf.get(k) ?? '')
        if (listener) hear(k)
        else if (all?.ui?.keyDown?.(k)) continue
        else if (!modal) { hold(k); act(k, true) }
      }
      pads = now
    }
    axes()
    if (all?.ui?.modal()) letGo()
    if (controls) repeating(now)
    const t = binds ?? controls
    if (binds?.every) input(binds.every(held))
    if (controls?.every) input(controls.every(heldAction))
    if (t?.pointer && (moved[0] || moved[1])) input(t.pointer(moved[0], moved[1]))
    if (t?.drag && (dragged[0] || dragged[1])) input(t.drag.send(dragged[0], dragged[1]))
    if (t?.hover && hovered !== undefined) input(t.hover(hovered))
    hovered = undefined
    if (stroking && stroked) input(t?.stroke?.move?.(...stroked))
    stroked = undefined
    if (t?.wheel && turned) input(t.wheel(turned))
    moved = [0, 0]
    dragged = [0, 0]
    turned = 0
  }

  let binds: Binds | undefined
  let listening = false
  const down = new Set<string>()
  let values: number[] = [] // per axis, the value last sent
  let pushed: [number, number][] = [] // per stick, the value last sent
  let holding: number[] = [] // per hold, the value last sent
  let moved = [0, 0] // pixels across and down since the last tick, while the page holds the lock
  let dragged = [0, 0] // pixels across and down since the last tick, while the drag's key is down without the lock
  let turned = 0 // the wheel's pixels down since the last tick
  let hovered: [number, number] | null | undefined // where the pointer moved to since the last tick, null over the UI or off the page
  let stroking = false // the stroke's key went down off the UI and has not come up
  let stroked: [number, number] | undefined // where the pointer moved to during the stroke since the last tick
  let locked = false // this plugin asked for the pointer lock and has not given it back
  let bound = new Set<string>() // every key the table names
  let lockOnly = new Set<string>() // the table's `locked` keys
  const armed = new Set<string>() // the `locked` keys pressed while the page held the lock
  let hadLock = false // the page held the pointer lock at the last tick
  let sticks = false // the table names a side of the left stick
  let pads = new Set<string>() // the gamepad keys down at the last poll
  const padOf = new Map<string, string>() // each gamepad key down at the last poll, and the `id` of a gamepad holding it
  let used: Device = 'keyboard' // what was used last

  // ------------------------------------------------ the action avenue (`control`)

  let controls: Controls | undefined
  let keysOf = new Map<string, Bound>() // every action the scene names, with the keys it has now
  let toggles = new Set<string>() // the button actions played as toggles
  const latched = new Set<string>() // the toggled actions a press turned on
  let acted = new Map<string, number>() // per axis, stick side and hold, the value last sent
  let wasHeld = new Set<string>() // the release actions held when the actions were last settled
  const due = new Map<string, number>() // per press action held under the repeat, the page's time it is pressed again
  let listener: ((key: string | undefined) => void) | undefined // what `listen` hands the next key to
  let swallow = false // a mouse button `listen` took, whose click is nobody's

  const scened = (): Record<string, Action> => wire?.scene.world?.player?.actions ?? {}
  const stored = (key: string): any => {
    const s = all?.store
    if (!s || !s.has(key)) return undefined
    const v = s.get(key)
    return v === null ? undefined : v
  }
  const store = () => {
    if (!all?.store) throw new Error('the scene lists no store, so nothing the player changes can be kept')
    return all.store
  }
  const deadzone = (): number | undefined => stored('player.deadzone') ?? wire?.scene.world?.player?.deadzone
  const repeat = (): number => stored('player.repeat') ?? wire?.scene.world?.player?.repeat ?? 0
  const action = (name: string): Action => {
    const a = scened()[name]
    if (!a) throw new Error(`the scene's world.player.actions names no ${name}`)
    return a
  }
  const shape = (name: string) => shapeOf(keysOf.get(name) ?? action(name).keys)
  const buttonKeys = (name: string) => keysOf.get(name) as string[]
  // Every part of a table naming an action, with the shape that part reads.
  const parts = (t: Controls): [part: string, name: string, shape: Shape][] => [
    ...Object.keys(t.press ?? {}).map((a): [string, string, Shape] => ['press', a, 'button']),
    ...Object.keys(t.release ?? {}).map((a): [string, string, Shape] => ['release', a, 'button']),
    ...Object.keys(t.hold ?? {}).map((a): [string, string, Shape] => ['hold', a, 'button']),
    ...Object.keys(t.axis ?? {}).map((a): [string, string, Shape] => ['axis', a, 'axis']),
    ...Object.keys(t.stick ?? {}).map((a): [string, string, Shape] => ['stick', a, 'stick']),
    ...(t.locked ?? []).map((a): [string, string, Shape] => ['locked', a, 'button']),
    ...(t.drag ? [['drag', t.drag.action, 'button'] as [string, string, Shape]] : []),
    ...(t.stroke ? [['stroke', t.stroke.action, 'button'] as [string, string, Shape]] : []),
  ]
  // The keys every action has now: the store's where the player rebound it, else the scene's. Read
  // each frame and after every change, so what the store says is what the keys do.
  function refresh() {
    if (!wire || !controls) return
    const order: string[] = wire.scene.plugins ?? []
    if (order.includes('store') && order.indexOf('store') > order.indexOf('player')) throw new Error('store is listed after player, so the player would read the store of the frame before')
    const acts = scened(), chosen: Record<string, Bound> = stored('player.keys') ?? {}
    keysOf = new Map()
    for (const [name, a] of Object.entries(acts)) {
      const mine = chosen[name]
      if (mine !== undefined && shapeOf(mine) !== shapeOf(a.keys)) throw new Error(`the store's player.keys gives ${name} keys of another shape than the scene's`)
      keysOf.set(name, mine ?? a.keys)
    }
    toggles = new Set(stored('player.toggle') ?? [])
    for (const [part, name, want] of parts(controls)) {
      if (!(name in acts)) throw new Error(`the player table's ${part} names ${name}, which the scene's world.player.actions does not`)
      if (shape(name) !== want) throw new Error(`the player table's ${part} reads ${name} as a ${want}, and the scene gives it the keys of a ${shape(name)}`)
    }
    bound = new Set([...keysOf.values()].flatMap(k => k.flat()))
    lockOnly = new Set((controls.locked ?? []).flatMap(buttonKeys))
    sticks = STICK.some(k => bound.has(k))
  }
  // A button action is held while any of its keys is, or, played as a toggle, from one press to the next.
  const pushedDown = (name: string) => buttonKeys(name).some(held)
  const isHeld = (name: string) => (toggles.has(name) ? latched.has(name) : pushedDown(name))
  // What `every` is handed on the action avenue: whether a button action is held.
  const heldAction = (name: string) => {
    if (shape(name) !== 'button') throw new Error(`every asked whether ${name} is held, and it is not a button`)
    return isHeld(name)
  }
  const dragging = () =>
    binds?.drag ? down.has(binds.drag.key) : !!controls?.drag && buttonKeys(controls.drag.action).some(k => down.has(k))
  const strokes = (key: string) =>
    binds?.stroke ? key === binds.stroke.key : !!controls?.stroke && buttonKeys(controls.stroke.action).includes(key)
  // Each action's value against the one last sent: an axis's, a stick's and a hold's sent when it
  // changed, and a release run when its action stopped being held.
  const settle = () => {
    const c = controls!
    const changed = (k: string, v: number) => {
      if (v === (acted.get(k) ?? 0)) return false
      acted.set(k, v)
      return true
    }
    for (const [name, f] of Object.entries(c.axis ?? {})) {
      const [neg, pos] = keysOf.get(name) as string[][]
      const v = way(neg, pos)
      if (changed(`axis ${name}`, v)) input(f(v))
    }
    for (const [name, f] of Object.entries(c.stick ?? {})) {
      const [left, right, up, dn] = keysOf.get(name) as string[][]
      const x = way(left, right), y = way(up, dn)
      const moved = [changed(`x ${name}`, x), changed(`y ${name}`, y)]
      if (moved[0] || moved[1]) input(f(x, y))
    }
    for (const [name, f] of Object.entries(c.hold ?? {})) {
      const v = isHeld(name) ? 1 : 0
      if (changed(`hold ${name}`, v)) input(f(v))
    }
    for (const [name, f] of Object.entries(c.release ?? {})) {
      if (isHeld(name)) wasHeld.add(name)
      else if (wasHeld.delete(name)) f()
    }
  }
  const fire = (name: string) => {
    const it = controls?.press?.[name]
    if (typeof it === 'function') it()
    else input(it)
  }
  // A key going down, `fresh` unless it is the keyboard's repeat of one already down: each button
  // action it is a key of is turned on or off when played as a toggle, and pressed. An action with a
  // `release` is pressed once per hold; any other on each fresh press, and on the keyboard's repeats
  // too while the repeat setting is 0.
  const act = (key: string, fresh: boolean) => {
    if (lockOnly.has(key) && !lockedTo()) return
    const r = repeat()
    for (const [name, keys] of keysOf) {
      if (shapeOf(keys) !== 'button' || !(keys as string[]).includes(key)) continue
      if (toggles.has(name) && fresh && !latched.delete(name)) latched.add(name)
      if (controls?.press?.[name] === undefined) continue
      if (controls.release?.[name]) {
        if (!wasHeld.has(name) && isHeld(name)) fire(name)
        continue
      }
      if (!fresh && r > 0) continue
      fire(name)
      if (r > 0) due.set(name, performance.now() + r * 1000)
    }
  }
  // Each press action held under the repeat, pressed again each time its time comes round.
  const repeating = (now: number) => {
    const r = repeat()
    if (!(r > 0)) return due.clear()
    for (const [name, at] of due) {
      if (!controls?.press?.[name] || !pushedDown(name)) { due.delete(name); continue }
      let next = at
      while (now >= next) { fire(name); next += r * 1000 }
      due.set(name, next)
    }
  }
  // The key `listen` waited for, handed on; Escape hands it nothing.
  const hear = (key: string) => {
    const f = listener!
    listener = undefined
    f(key === 'Escape' ? undefined : key)
  }
  // A gamepad's kind, by the name its `id` gives it or the USB vendor in it: Microsoft's is 045e,
  // Sony's 054c.
  const family = (id: string): Device =>
    /xbox|xinput|045e/i.test(id) ? 'xbox' : /playstation|dualshock|dualsense|054c/i.test(id) ? 'playstation' : 'pad'
  // The gamepad keys down on every gamepad connected: each button pressed, and each side of the left
  // stick past the dead zone.
  // Each key is also written into `padOf` with the `id` of a gamepad holding it.
  const poll = (deadzone: unknown): Set<string> => {
    const now = new Set<string>()
    padOf.clear()
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return now
    for (const pad of navigator.getGamepads()) {
      if (!pad?.connected) continue
      const add = (k: string) => { now.add(k); if (!padOf.has(k)) padOf.set(k, pad.id ?? '') }
      pad.buttons.forEach((b, i) => { if (b.pressed) add(`Pad${i}`) })
      if (typeof deadzone !== 'number') continue
      const [x, y] = pad.axes
      if (x < -deadzone) add('PadStickLeft')
      if (x > deadzone) add('PadStickRight')
      if (y < -deadzone) add('PadStickUp')
      if (y > deadzone) add('PadStickDown')
    }
    return now
  }
  // The element holding the pointer lock, or null.
  const lockedTo = () => (typeof document === 'undefined' ? null : document.pointerLockElement ?? null)
  const held = (key: string) => down.has(key) && (!lockOnly.has(key) || (armed.has(key) && !!lockedTo()))
  // A bound key keeps its browser default under Control, Command or Alt.
  const cancel = (e: KeyboardEvent | MouseEvent, key: string) => { if (bound.has(key) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault() }
  const hold = (key: string) => {
    down.add(key)
    if (lockOnly.has(key) && lockedTo()) armed.add(key)
  }
  const lift = (key: string) => {
    if (down.has(key)) binds?.release?.[key]?.()
    down.delete(key)
    armed.delete(key)
    axes()
  }
  const any = (keys: Keys) => (typeof keys === 'string' ? held(keys) : keys.some(held))
  const way = (neg: Keys, pos: Keys) => (any(pos) ? 1 : 0) - (any(neg) ? 1 : 0)
  const input = (i: Input | undefined) => { if (i) between ? waiting.push(() => send(i[0], i.slice(1))) : send(i[0], i.slice(1)) }
  const axes = () => {
    if (controls) return settle()
    binds?.axis?.forEach((a, i) => {
      const v = way(a.keys[0], a.keys[1])
      if (v !== values[i]) { values[i] = v; input(a.send(v)) }
    })
    binds?.stick?.forEach((st, i) => {
      const [left, right, up, down] = st.keys
      const x = way(left, right), y = way(up, down)
      if (x !== pushed[i][0] || y !== pushed[i][1]) { pushed[i] = [x, y]; input(st.send(x, y)) }
    })
    binds?.hold?.forEach((h, i) => {
      const v = h.keys.some(held) ? 1 : 0
      if (v !== holding[i]) { holding[i] = v; input(h.send(v)) }
    })
  }
  const pressed = (key: string) => {
    if (controls) return act(key, true)
    if (lockOnly.has(key) && !lockedTo()) return
    const it = binds?.press?.[key]
    if (typeof it === 'function') it()
    else input(it)
  }
  // A key typed into a field of the page, a panel's text box or number, say, is the field's.
  const typed = (e: KeyboardEvent) => {
    const t = e.target as { tagName?: string; isContentEditable?: boolean } | null
    return !!t && (t.isContentEditable === true || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
  }
  const onDown = (e: KeyboardEvent) => {
    // The UI takes no key while this listens, so a key it took is the one that began the listening.
    if (all?.ui?.took(e)) return
    if (listener && !typed(e)) {
      used = 'keyboard'
      e.preventDefault()
      if (!e.repeat) hear(keyOf(e))
      return
    }
    if (typed(e)) return
    used = 'keyboard'
    const key = keyOf(e)
    cancel(e, key)
    const fresh = !down.has(key)
    const again = !fresh && !!binds?.release?.[key]
    hold(key)
    if (controls) act(key, fresh)
    else if (!again) pressed(key)
    axes()
  }
  const onUp = (e: KeyboardEvent) => lift(keyOf(e))
  const button = (e: MouseEvent) => `Mouse${e.button}`
  // `offsetX` is measured against the element under the pointer, which over the game is the UI's
  // canvas, laid in the same box as the game's: the same numbers either way. They are CSS pixels,
  // and the canvas's are those divided by the renderer's `scale`, which render2d's `fit` sets.
  const point = (e: MouseEvent): [number, number] => {
    const s = (all?.render3d ?? all?.render2d)?.scale ?? 1
    return [e.offsetX / s, e.offsetY / s]
  }
  const ui = (e: MouseEvent) => !!all?.ui?.hit(...point(e))
  const onPress = (e: MouseEvent) => {
    used = 'keyboard'
    if (listener) {
      e.preventDefault()
      swallow = true
      hear(button(e))
      return
    }
    if (ui(e)) return
    cancel(e, button(e))
    hold(button(e))
    pressed(button(e))
    axes()
    const t = binds ?? controls
    if (t?.stroke && strokes(button(e)) && !lockedTo()) {
      stroking = true
      stroked = undefined
      input(t.stroke.start?.(...point(e)))
    }
  }
  const onRelease = (e: MouseEvent) => {
    lift(button(e))
    const t = binds ?? controls
    if (stroking && t?.stroke && strokes(button(e))) {
      stroking = false
      stroked = undefined
      input(t.stroke.end?.(...point(e)))
    }
  }
  const onMenu = (e: MouseEvent) => { if (bound.has('Mouse2')) e.preventDefault() }
  const onMove = (e: MouseEvent) => {
    if (lockedTo()) {
      moved[0] += e.movementX
      moved[1] += e.movementY
      return
    }
    if (dragging()) {
      dragged[0] += e.movementX
      dragged[1] += e.movementY
    }
    if ((binds ?? controls)?.hover) hovered = ui(e) ? null : point(e)
    if (stroking) stroked = point(e)
  }
  // The pointer leaving the page, into nothing, is over nothing to hover.
  const onOut = (e: MouseEvent) => { if ((binds ?? controls)?.hover && !e.relatedTarget) hovered = null }
  const onWheel = (e: WheelEvent) => {
    if (!(binds ?? controls)?.wheel || ui(e)) return
    if (!e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault()
    turned += e.deltaY
  }
  // One door. A click on the UI is the UI's, which PixiJS hands to the thing clicked, and is not a
  // game message.
  const onClick = (e: MouseEvent) => {
    if (swallow) { swallow = false; return }
    if (ui(e)) return
    const t = binds ?? controls
    if (t?.pointer && !lockedTo()) {
      locked = true
      void (e.target as Element).requestPointerLock()
    }
    input(t?.click?.(...point(e)))
  }

  function bind(table: Binds) {
    controls = undefined
    binds = table
    const each = (k: Keys) => (typeof k === 'string' ? [k] : k)
    bound = new Set([
      ...Object.keys(table.press ?? {}),
      ...Object.keys(table.release ?? {}),
      ...(table.axis ?? []).flatMap(a => a.keys.flatMap(each)),
      ...(table.stick ?? []).flatMap(st => st.keys.flatMap(each)),
      ...(table.hold ?? []).flatMap(h => h.keys),
      ...(table.drag ? [table.drag.key] : []),
      ...(table.stroke ? [table.stroke.key] : []),
      ...(table.locked ?? []),
    ])
    lockOnly = new Set(table.locked ?? [])
    sticks = STICK.some(k => bound.has(k))
    values = (table.axis ?? []).map(() => 0)
    pushed = (table.stick ?? []).map(() => [0, 0])
    holding = (table.hold ?? []).map(() => 0)
    attach()
  }

  function attach() {
    if (listening) return
    listening = true
    addEventListener('keydown', onDown)
    addEventListener('keyup', onUp)
    addEventListener('click', onClick)
    addEventListener('mousedown', onPress)
    addEventListener('mouseup', onRelease)
    addEventListener('mousemove', onMove)
    addEventListener('mouseout', onOut)
    addEventListener('contextmenu', onMenu)
    addEventListener('wheel', onWheel, { passive: false })
  }

  // Nothing held, and no pointer lock this plugin took.
  function letGo() {
    armed.clear()
    due.clear()
    for (const key of down) binds?.release?.[key]?.()
    if (down.size || latched.size) {
      down.clear()
      latched.clear()
      axes()
    }
    moved = [0, 0]
    dragged = [0, 0]
    turned = 0
    if (stroking) {
      stroking = false
      stroked = undefined
      input(binds?.stroke?.cancel?.())
    }
    if (locked) {
      locked = false
      if (typeof document !== 'undefined' && typeof document.exitPointerLock === 'function') document.exitPointerLock()
    }
  }

  function unbind() {
    letGo()
    if (listener) hear('Escape')
    binds = undefined
    controls = undefined
    if (!listening) return
    listening = false
    removeEventListener('keydown', onDown)
    removeEventListener('keyup', onUp)
    removeEventListener('click', onClick)
    removeEventListener('mousedown', onPress)
    removeEventListener('mouseup', onRelease)
    removeEventListener('mousemove', onMove)
    removeEventListener('mouseout', onOut)
    removeEventListener('contextmenu', onMenu)
    removeEventListener('wheel', onWheel)
  }

  function control(table: Controls) {
    binds = undefined
    controls = table
    acted = new Map()
    wasHeld = new Set()
    latched.clear()
    due.clear()
    refresh()
    attach()
  }

  // ------------------------------------------------ rebinding (the action avenue's, the page's alone)

  function actions(): Shown[] {
    const t = controls ? parts(controls) : []
    return Object.entries(scened()).map(([name, a]) => ({
      name,
      label: a.label,
      shape: shapeOf(a.keys),
      keys: keysOf.get(name) ?? stored('player.keys')?.[name] ?? a.keys,
      defaults: a.keys,
      bound: t.filter(([, n]) => n === name).map(([part]) => part),
    }))
  }

  function listen(fn: (key: string | undefined) => void) {
    if (listener) hear('Escape')
    letGo()
    listener = fn
  }

  function rebind(name: string, keys: Bound) {
    const a = action(name)
    if (shapeOf(keys) !== shapeOf(a.keys)) throw new Error(`${name} is a ${shapeOf(a.keys)} and was given ${JSON.stringify(keys)}`)
    store().set('player.keys', { ...(stored('player.keys') ?? {}), [name]: keys })
    refresh()
  }

  function restore(name?: string) {
    if (name === undefined) {
      store().set('player.keys', {})
      store().set('player.toggle', [])
      store().set('player.deadzone', null)
      store().set('player.repeat', null)
    } else {
      action(name)
      const { [name]: _, ...rest } = stored('player.keys') ?? {}
      store().set('player.keys', rest)
      store().set('player.toggle', (stored('player.toggle') ?? []).filter((t: string) => t !== name))
    }
    latched.clear()
    due.clear()
    refresh()
  }

  function conflicts(): { key: string; actions: string[] }[] {
    const by = new Map<string, string[]>()
    for (const name of Object.keys(scened())) {
      const keys: Bound = keysOf.get(name) ?? stored('player.keys')?.[name] ?? action(name).keys
      for (const k of new Set(keys.flat())) by.set(k, [...(by.get(k) ?? []), name])
    }
    return [...by].filter(([, names]) => names.length > 1).map(([key, names]) => ({ key, actions: names }))
  }

  function settings(): Settings {
    return { toggle: [...(stored('player.toggle') ?? [])], deadzone: deadzone(), repeat: repeat() }
  }

  function configure(changes: Partial<Settings>) {
    if (changes.toggle) {
      for (const name of changes.toggle) if (shapeOf(action(name).keys) !== 'button') throw new Error(`${name} is not a button, and only a button toggles`)
      store().set('player.toggle', [...changes.toggle])
      latched.clear()
    }
    if (changes.deadzone !== undefined) {
      if (!(changes.deadzone > 0 && changes.deadzone < 1)) throw new Error(`a deadzone is a fraction of the way out, above 0 and below 1, not ${changes.deadzone}`)
      store().set('player.deadzone', changes.deadzone)
    }
    if (changes.repeat !== undefined) {
      if (!(changes.repeat >= 0)) throw new Error(`a repeat is 0 or more seconds, not ${changes.repeat}`)
      store().set('player.repeat', changes.repeat)
      due.clear()
    }
    refresh()
  }

  return new Proxy(
    // Closing the client drops the table and every listener on the page, as `unbind` does.
    {
      tick, afterTick() { between = true }, bind, unbind, close: unbind,
      control, actions, listen, rebind, restore, conflicts, settings, configure, device: () => used,
      get listening() { return !!listener },
      get reruns() { return reruns }, get fixed() { return fixed }, get step() { return wire && whole() ? at : n }, get seen() { return seen }, get lead() { return leadNow() },
    },
    {
      get: (t: any, name: string) =>
        name in t ? t[name] : (...args: Arg[]) => { between ? waiting.push(() => send(name, args)) : send(name, args) },
    },
  ) as Record<string, (...args: any[]) => void>
}
