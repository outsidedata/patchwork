// Many truths in one process. A `scenemanager` row names scene files and one of them as the
// entry scene; `load` boots one truth per name and hangs the table off that row. Each child holds
// its own rows, world numbers, seed counter and step counter, so a child nobody is in is unchanged
// and steps again when somebody enters it.
// A connection is one seat on one child at a time. It enters the entry scene and moves when that
// child writes its seat's next scene onto the child's own `scenemanager` row.
//
// Every game is built on this, a game of one scene too, because this is what gives a connection a
// seat. A game folder holds:
// - `<game>.scene.json`, the manager scene: one `scenemanager` prefab and an `actors` entry for it,
//   `"plugins": ["scenemanager"]`, `"seats": 1`, and an `engine` prefab whose `dt` the page and the
//   server step the manager by. The `scenemanager` prefab holds `scenes`, name to `{ file, suspend,
//   enter? }`; `dt`, the seconds each child step is given; `entry`, the scene every connection
//   enters; and `port`, which `serve` listens on and `client.html` dials. Each game has a port no
//   other game uses. It may hold `backlog`, how many envelopes a seat's diffs may reach back over
//   (`accept`), 32 when it holds none.
// - `<game>.sim.ts`, exporting `sim = { scenemanager }`.
// - For each child, `<scene>.scene.json` and `<scene>.sim.ts`, which imports that scene file and
//   exports it as `scene` beside `sim`. A child names `scenemanager` in its `plugins`, has a
//   `"scenemanager": { "out": {} }` prefab and an actor for it, and an `engine` prefab with `dt`,
//   `width` and `height`, which size the page's canvases. Its `sim` names every kind it makes rows
//   of, a kind whose prefab only the manager's file gives included. A child's `prefabs` and its
//   `world` are the manager's with its own over them (`child`), so a plugin's fixed numbers,
//   `world.<plugin>`, that every child uses are written once, in the manager's `world`.
// - A scene is a tiled environment and actors. The tiled environment is everything static — the
//   art, the collision — one Tiled map (`.tmj`), the `tilemap` entry of the scene's loader
//   catalogue, `world.loader.assets`, that its `world.tilemap`'s `file` names, which the tilemap
//   plugin draws and its rules ask; nothing in it makes a row. The actors are everything that has a row: the scene
//   file's `actors` entries, then those of the file its `actorsFile` names, a list beside the map,
//   `<level>.actors.json`, when it names one. A level drawn by hand is its map and the actors
//   written in its scene file. A level a generator makes (`plugins/mapgen`) is the two files it
//   writes, `<level>.tmj` and `<level>.actors.json`, which the scene loads as it loads a level
//   drawn by hand; nothing makes a level while the game runs.
// - For each kind a `sim` names that is not a plugin's, `<kind>.sim.ts`, exporting its rule under
//   the kind's name, which the page's player finds by that name. Two kinds with one rule are two
//   one-line files handing out the one rule under each name.
// - `index.html`: `boot` and `load` the manager, then `view(link(loopback(accept(manager(truth)))),
//   file, import.meta.url, mount)`, where `mount` makes a canvas the size of the child's `engine`
//   prefab for the game's renderer and one for `ui`, for whichever of them the scene names, and
//   mounts each; the page's CSS puts every canvas in one grid cell, so the UI's lies over the
//   game's. Then a fixed-step loop on `requestAnimationFrame` that steps the manager by `engine.dt`
//   and calls the view's `frame()`. It is one seat on a truth of its own: a second tab is a second
//   game.
// - `client.html`: the same `view` on `link(dial('ws://<host>:<port>'))`, the same loop, and no
//   stepping.
//   Two seats on one game are two tabs of it against the server. Chrome pauses
//   `requestAnimationFrame` in a background tab, so of two such tabs in one window only the one in
//   front plays; the server keeps stepping.
// - `<game>.server.ts`: `boot`, `load`, `serve(manager(truth).data.port, accept(manager(truth)))`,
//   and `run(truth)`, which steps the manager by `engine.dt` as often as the real clock owes a step,
//   as `index.html`'s loop does.
// - `assets/`: the game's art and data files. `assets/<game>.json` holds every kind's definition,
//   the numbers of it that never change, keyed by kind; each child names it in `world.defs` and in
//   its loader catalogue, `world.loader.assets`, as a `json` entry with `preload`, and rules and actors read it with
//   `def` (`plugins/loader/loader.sim.ts`). A level's map is a `tilemap` entry, read with `tiled`,
//   and anything else big that never changes is a data file of its own, read with `json`;
//   a sprite sheet is read with `sheet` and a palette with `palette`. `load` and `view` wait for
//   every preload before the first step and the first frame (`Prepare`), so a rule reads them on
//   any step. Beside the files the game reads it may keep what they are made from, which the game
//   never reads: the rips art is cut from, and the scripts that cut it. Every file the game reads
//   is an entry of the scene's loader catalogue, or a file one names,
//   as a map names its tilesets and a multipack its packs, and reaches whatever uses it through the
//   loader and nothing else: a data file with `json` or `def`, a map, a palette, an image, a sheet,
//   a model or a sound with `plugins.loader` (`get`, `on`, `load`, `model`, `sound`,
//   `plugins/loader/loader.plugin.ts`), which decodes it for the scene's renderer. A url in the catalogue is the file's path as it is
//   named, spaces and all; the loader encodes it. A kind of file the loader has no type for gets
//   its type there first. The UI draws on a canvas of its own, which cannot draw a texture decoded
//   for the renderer, so an image the UI draws is an entry of its own with `"for": "ui"`, and a
//   file both draw is two entries.
// - `plugins/<name>/` and `addons/<name>/`: plugins and addons of the game's own, laid out as the
//   top-level ones are and free to name its kinds. Its sim files import a plugin's server half; the
//   `shipped` plugin, listed in a child's `plugins`, loads the browser half of each one its
//   `world.shipped` names.
//
// This addon carries envelopes and does not care how. The transport is the wire `link` is handed:
// `loopback` (`addons/loopback`), the page and the manager in one process, with a network in
// milliseconds of any shape given a `Net`; or `dial` and `serve` (`addons/socket`), a WebSocket
// between them.
// What crosses it is a `Diff`: each packet as the rows added, changed and dropped since the newest
// packet the page said it got, which `accept` makes and `link` turns back into the whole `Down`
// before anything on the page hears it. A step where nothing moved crosses as next to nothing.
//
// A child moves a seat by calling `go` on its own `scenemanager` row with the seat and the next
// scene's name (`plugins/scenemanager/scenemanager.sim.ts`); the args after the name reach the new
// scene's `player` row as its `arrive` act at the start of that scene's next step. When what a seat
// needs there is a value the last scene chose, the `player` prefab holds that field as `null` or
// `-1`, and the `player` row's `before` spawns nothing until `arrive` has written it.
//
// Tests drive this as a page does: `boot` the manager, `load` it, and make a seat with
// `connection(row, send)`, or a page with `view(link(loopback(accept(row))), file, here, mount)`,
// whose `mount` gives the renderer and `ui` a canvas stand-in with `addEventListener`,
// `removeEventListener`, `style` and `remove`. Two links are two seats, and the view's `client` is
// the one client it holds.
import { boot, type Arg, type Msg, type Packet, type Row, type Scene, type Sim, type Truth } from '#engine/engine.ts'
import { client, type Client } from '#engine/browser.ts'
import { free, join, leave } from '#addons/player/player.addon.ts'
import type { Accept, Time, Wire } from '#addons/loopback/loopback.addon.ts'

export type Entry = { file: string; suspend: boolean; enter?: { kind: string; act: string } }
// Work a kind finishes before its scene's first step: `prepare`, handed each of its rows and the
// scene's `world`, such as the loader fetching the files its catalogue in `world` names, which a
// rule reads on whatever step it likes. `load` awaits it for every
// row of every truth it boots and of the manager's own, and `view` for every row of a visit's
// first packet before it makes that visit's client, so the page's prediction, which runs the
// seat's own rules, finds the same files the server's rules do.
export type Prepare = { prepare?(me: Row, world: Record<string, any>): Promise<void> }
// `seat` is the seat's number on that scene when the page sent it, as the `Down` it was on said.
export type Up = { scene: string; seat: number; msg: Msg }
// `seat` is the seat's number on that scene's truth. It changes every time the seat enters a scene,
// that scene's own name included, so a page can tell a seat that came back from one that stayed.
export type Down = { scene: string; seat: number; packet: Packet }
// One row's fields that differ from the base: each `set` a path into `data` and the value there
// now, each `unset` a path to a field gone. Plain objects are walked into; an array or a scalar
// that differs is sent whole. A field whose value is `undefined` counts as absent, as JSON has it.
export type Change = { id: number; set: [string[], unknown][]; unset: string[][] }
export type Delta = { add: Row[]; change: Change[]; drop: number[] }
// A `Down` as it crosses the wire. `k` numbers the envelopes of one seat's connection, across every
// visit. `base` is the `k` whose rows the delta is against, or null when it is against no rows at
// all. `keep` is the lowest `k` any later envelope may name as its base.
export type Diff = { scene: string; seat: number; k: number; n: number; ack: number; base: number | null; keep: number } & Delta
// The page's word that it rebuilt envelope `got`, so the server may diff against it.
export type Got = { got: number }
// One seat's envelopes, and the functions that carry them. A page holds one of these for as long
// as it is open, and `view` mounts it on each client it makes.
// `store` is the page's table of values the server never reads, such as a volume, a tint or the
// keys a player rebound. It is one per link, so every scene of the page reads and writes the same
// table and no other page and no server ever sees it. A value is any JSON value: a number, a list,
// a table.
export type Value = Arg | Value[] | { [key: string]: Value }
export type Link = { hear(fn: (down: Down) => void): void; send(up: Up): void; close(): void; store: Record<string, Value> }

const loaded = new WeakMap<Row, Map<string, Truth>>()
const owners = new WeakMap<Row, Truth>()
// How many connections are seated on a child. A `suspend: true` child steps while this is above
// zero and stops at the step counter it is at when it falls to zero.
const inside = new WeakMap<Truth, number>()

const busy = (child: Truth) => inside.get(child) ?? 0
const shift = (child: Truth, by: number) => inside.set(child, busy(child) + by)

// Mods. A plugin `a` supports a plugin `p` with a mod, `<a>.<p>.ts`, which hands on what `a` knows.
// A scene gives `p` a function of a mod by naming it in `world.<p>.mods`, `{ <function>: '<a>' }`:
// new to `p`, or one `p` already has, which the mod's then overwrites. Swapping one `a` for another
// that exports the same function is changing that one value. A mod is a function of whatever `p`
// asks it with: the server's `w`, or on the page the `plugins` it is handed, so it hands on what
// `a`'s browser half holds. The server loads every mod a scene names, so a mod imports types alone
// of anything that draws.
//
// A mod sits in the one folder that may know both names. When `a` and `p` are both top-level
// plugins it is `a`'s, `plugins/<a>/<a>.<p>.ts`. A game's own plugins are the names its scene's
// `world.shipped.plugins` lists: when `a` is one of them the mod is beside it, in the game's
// `plugins/<a>/<a>.<p>.ts`; when only `p` is, the mod is beside `p`, in the game's
// `plugins/<p>/<a>.<p>.ts`, since a top-level plugin names no game's. The game's folder is the
// scene's `world.scenemanager.home`, which `child` writes, so the scene never says where a mod is.
//
// `prepare` loads every mod a scene's `world` names before any kind's `prepare`, so on the server
// and on the page a mod is there on the first step, and a mod that does not export the function it
// is named for throws there. `mod(world, p, name)` hands back the function, or undefined when the
// scene names none.
//
// `listed(scene)` is the order a scene's plugins tick in on the page: its `plugins`, with the game's
// own in place of `shipped`, in their list's order (`plugins/shipped`). A mod a browser half asks
// hands on what plugin `a`'s browser half holds, so `a` must be one of the page's plugins:
// `provided(scene, p, name)` throws unless the plugin the scene names for `p`'s mod `name` is listed,
// and does nothing when the scene names none, asked by every `p` that hands its mod `plugins`.
// `ahead(scene, p, name)` throws as `provided` does, and unless that plugin ticks before `p`: asked
// instead by a `p` that reads what that plugin makes earlier in the same frame, in the same phase
// (its `afterTick` what the other placed in its own, or its `tick` what the other made in its own),
// so a scene listing them the other way is told rather than drawn a frame behind.
const mods = new Map<string, Record<string, unknown>>()
function modUrl(world: Record<string, any>, a: string, p: string) {
  const ours: string[] = world.shipped?.plugins ?? []
  if (!ours.includes(a) && !ours.includes(p)) return new URL(`../../plugins/${a}/${a}.${p}.ts`, import.meta.url).href
  const home: string | undefined = world.scenemanager?.home
  if (!home) throw new Error(`the ${a} mod of ${p} is the game's, and this scene has no world.scenemanager.home to find it in`)
  return new URL(`plugins/${ours.includes(a) ? a : p}/${a}.${p}.ts`, home).href
}

async function loadMods(world: Record<string, any>) {
  for (const [p, fixed] of Object.entries(world)) {
    for (const [name, a] of Object.entries((fixed?.mods ?? {}) as Record<string, string>)) {
      const url = modUrl(world, a, p)
      if (!mods.has(url)) mods.set(url, await import(/* @vite-ignore */ url))
      if (typeof mods.get(url)![name] !== 'function') throw new Error(`${url} does not export ${name}`)
    }
  }
}

export function mod<F extends (...args: any[]) => any>(world: Record<string, any>, p: string, name: string): F | undefined {
  const a: string | undefined = world[p]?.mods?.[name]
  if (!a) return undefined
  const m = mods.get(modUrl(world, a, p))
  if (!m) throw new Error(`the ${a} mod of ${p} is not loaded: prepare loads it`)
  return m[name] as F
}

export const listed = (scene: Scene): string[] =>
  (scene.plugins ?? []).flatMap(n => (n === 'shipped' ? (scene.world?.shipped?.plugins ?? []) as string[] : [n]))

export function provided(scene: Scene, p: string, name: string) {
  const a: string | undefined = scene.world?.[p]?.mods?.[name]
  if (a !== undefined && !listed(scene).includes(a)) throw new Error(`${p}'s ${name} is ${a}'s, which this scene does not list`)
}

export function ahead(scene: Scene, p: string, name: string) {
  provided(scene, p, name)
  const a: string | undefined = scene.world?.[p]?.mods?.[name]
  if (a === undefined) return
  const order = listed(scene)
  if (order.indexOf(a) > order.indexOf(p)) throw new Error(`${p} is listed before ${a}, whose ${name} it reads that frame`)
}

const prepare = async (sim: Sim, rows: Row[], world: Record<string, any>) => {
  await loadMods(world)
  await Promise.all(rows.map(r => (sim[r.kind] as Prepare | undefined)?.prepare?.(r, world)))
}

// The truth the `scenemanager` row is a row of. `connection` needs it: a seat hears once per step
// of the manager, and the manager is this.
export function owner(row: Row): Truth {
  const t = owners.get(row)
  if (!t) throw new Error('scenemanager row has loaded no scenes')
  return t
}

export function entries(row: Row): [string, Entry][] {
  if (!row.data.scenes) throw new Error('scenemanager row names no scenes')
  return Object.entries(row.data.scenes as Record<string, Entry>)
}

export function scenes(row: Row): Map<string, Truth> {
  const m = loaded.get(row)
  if (!m) throw new Error('scenemanager row has loaded no scenes')
  return m
}

export function scene(row: Row, name: string): Truth {
  const t = scenes(row).get(name)
  if (!t) throw new Error(`no loaded scene ${name}`)
  return t
}

export function manager(truth: Truth): Row {
  const rows = truth.rows.filter(r => r.kind === 'scenemanager')
  if (rows.length !== 1) throw new Error(`${rows.length} scenemanager rows, need 1`)
  return rows[0]
}

// The list of `actors` entries in the file a scene's `actorsFile` names, from the url of the scene
// file: read once per process, a `file:` url from the disk and any other fetched, and kept, so every
// boot of the scene reads the one list, and whoever refills it in place (the editor, when the file
// is written) changes what the next boot reads.
const lists = new Map<string, Promise<Scene['actors']>>()
export function actorsOf(scene: URL, file: string): Promise<Scene['actors']> {
  if (!file.endsWith('.actors.json')) return Promise.reject(new Error(`the scene names ${file} as its actorsFile, not a .actors.json`))
  const url = new URL(file, scene)
  let had = lists.get(url.href)
  if (!had) {
    had = (async () => {
      const text = url.protocol === 'file:'
        ? await (await import('node:fs/promises')).readFile(url, 'utf8')
        : await (await fetch(url)).text()
      const list = JSON.parse(text)
      if (!Array.isArray(list)) throw new Error(`${file} is not a list of actors entries`)
      return list
    })()
    lists.set(url.href, had)
    had.catch(() => lists.delete(url.href))
  }
  return had
}

// The scene file an entry names, and the sim beside it. One import, of the sim file: it imports
// the scene file itself and exports it, so the two halves are always the pair that were written
// together.
async function halves(name: string, e: Entry, base: string): Promise<{ scene: Scene; sim: Sim }> {
  if (typeof e.suspend !== 'boolean') throw new Error(`scene ${name} declares no suspend`)
  if (e.enter && (typeof e.enter.kind !== 'string' || typeof e.enter.act !== 'string'))
    throw new Error(`scene ${name} names an enter that is not a kind and an act`)
  if (!e.file.endsWith('.scene.json')) throw new Error(`scene ${name} names ${e.file}, not a .scene.json`)
  const file = e.file.replace(/\.scene\.json$/, '.sim.ts')
  const mod = await import(/* @vite-ignore */ new URL(file, base).href)
  if (!('sim' in mod)) throw new Error(`${file} exports no sim`)
  if (!('scene' in mod)) throw new Error(`${file} exports no scene`)
  return { scene: mod.scene as Scene, sim: mod.sim as Sim }
}

// A child's prefabs are the manager scene's prefabs with the child's own over them. A name the
// child's file gives a prefab is the child's; a name only the manager's file gives is the
// manager's. So a prefab every child uses is written once, in the manager's file, and an actor or a
// `w.spawn` in any child makes a row of it. Its `world` is made the same way, key by key: a
// plugin's fixed numbers, `world.<plugin>`, every child uses are written once in the manager's
// file, and a child that gives the key has its own. The child's own `scenemanager` prefab is given `names`,
// the names of the manager's table, so its row's `go` can refuse a scene the manager has not got.
// A child's actors are its file's `actors`, then the entries of the file its `actorsFile` names,
// when it names one (`actorsOf`), copied whole: the engine writes an entry's fields over its prefab
// as they are, so a row booted from the list itself would hold the entry's own arrays, and a rule
// moving the row's `pos` in place would move the entry, and every row booted from it after. The
// same list is the child's `world.scenemanager.actors`, which no packet carries, so a rule can make
// again what the scene placed, as a level that starts over spawns its cast again from its entries,
// and no row has to keep a copy of it. Beside it, `world.scenemanager.home` is the game's folder,
// `base`, where a mod of one of the game's own plugins is found (`modUrl`). The truth and the page's
// client of a child read this same scene.
async function child(top: Scene, name: string, e: Entry, base: string): Promise<{ scene: Scene; sim: Sim }> {
  const { scene, sim } = await halves(name, e, base)
  const prefabs = { ...top.prefabs, ...scene.prefabs }
  if (scene.prefabs.scenemanager) prefabs.scenemanager = { ...scene.prefabs.scenemanager, names: Object.keys(top.prefabs.scenemanager.scenes) }
  const more = typeof scene.actorsFile === 'string' ? await actorsOf(new URL(e.file, base), scene.actorsFile) : []
  const actors = structuredClone([...scene.actors, ...more])
  return { scene: { ...scene, world: { ...top.world, ...scene.world, scenemanager: { actors, home: new URL('./', base).href } }, prefabs, actors }, sim }
}

// Every child named by the row, booted, and the stepping registered. `base` is the url the file
// names are relative to, which is the manager scene's folder: pass the page's or the server
// file's `import.meta.url`.
//
// Each step of the manager steps every child whose entry says `suspend: false`, and every child a
// connection is seated on. A `suspend: true` child nobody is in is not stepped at all, so its
// rows, world numbers, seed counter and step counter stay at the numbers they were at, and it
// carries on from there when somebody enters it.
//
// Each child is booted from `child`'s scene, the manager's prefabs under its own.
//
// It returns once every row of every truth has been prepared (`Prepare`), so the first step finds
// what they fetched.
//
// `load` writes nothing onto any child row but what its prefab gives it, `names` among it. Each
// child's `scenemanager` row is sent without `out`:
// only this addon reads it, and it holds the args of every seat's `go` until this addon moves
// that seat, so a seat whose packet is made first would otherwise be sent another seat's args.
export async function load(truth: Truth, base: string): Promise<Map<string, Truth>> {
  const row = manager(truth)
  if (typeof row.data.dt !== 'number') throw new Error('scenemanager row declares no dt')
  if ('backlog' in row.data && !(Number.isInteger(row.data.backlog) && row.data.backlog >= 1))
    throw new Error('scenemanager row declares a backlog that is not a whole number above 0')
  if (typeof row.data.entry !== 'string') throw new Error('scenemanager row names no entry scene')
  await prepare(truth.sim, truth.rows, truth.world)
  const m = new Map<string, Truth>()
  for (const [name, e] of entries(row)) {
    const { scene, sim } = await child(truth.scene, name, e, base)
    const made = boot(scene, sim)
    await prepare(sim, made.rows, made.world)
    made.attach({
      show: () => true,
      hide: (_seat, r) => (r.kind === 'scenemanager' ? ['out'] : []),
      accept: () => true,
      advance: () => true,
      spawn: () => {},
    })
    m.set(name, made)
  }
  if (!m.has(row.data.entry)) throw new Error(`no loaded scene ${row.data.entry}`)
  loaded.set(row, m)
  owners.set(row, truth)
  truth.onStep(() => {
    for (const [name, e] of entries(row)) {
      const child = scene(row, name)
      if (!e.suspend || busy(child) > 0) child.step(row.data.dt)
    }
  })
  return m
}

// A child whose scene names the player package gets its seat from that package, which spawns the
// row the seat possesses and shows it to no other seat. A child that does not — a menu — takes a
// plain seat, which may still send the acts a kind lists as open.
const own = (child: Truth) => child.scene.plugins!.includes('player')

// One connection: one seat on one child. It enters the entry scene when it is made, and each step
// of the manager it reads its seat's slot of the current child's `scenemanager` row. A name there
// is where that seat goes next, and the rest of the write is the arguments the game sent with it,
// delivered to the seat's new `player` row as an `arrive` act. A scene whose seats are all taken
// (`free` in `addons/player`) takes no one more: the seat stays where it is, as though it had not
// asked, and the child that sent it may ask again, as a later step writes it again. A seat sent to
// the scene it is on leaves its own slot on the way out, so it always goes.
//
// The step registered here runs after the one `load` registered, so a connection only ever reads a
// child whose step is over, and only ever sends a packet of a finished step.
export function connection(row: Row, send: (down: Down) => void) {
  const table = new Map(entries(row))
  const enter = (to: string): number => {
    const child = scene(row, to)
    const seat = own(child) ? join(child) : child.open()
    shift(child, 1)
    // The entry may name a kind and an act on it: the seat that just entered is told to that act
    // at the start of the child's next step, before `before`, the way `arrive` is. The act is one
    // the kind lists in `open`, because the seat does not possess that row.
    const hook = table.get(to)!.enter
    if (hook) {
      const it = child.rows.find(r => r.kind === hook.kind)
      if (!it) throw new Error(`no ${hook.kind} row in ${to}`)
      child.inbox(seat, { seq: 0, n: child.n, id: it.id, action: hook.act, args: [] })
    }
    return seat
  }
  const exit = (from: string, seat: number) => {
    const child = scene(row, from)
    own(child) ? leave(child, seat) : child.close(seat)
    shift(child, -1)
    // A `suspend: true` child nobody is left in is not stepped again, so without this step no row
    // in it would ever run with the leaver's rows gone — whatever that scene does when a seat
    // leaves would happen only if somebody else happened to be standing in it.
    if (busy(child) === 0 && table.get(from)!.suspend) child.step(row.data.dt)
  }

  let name: string = row.data.entry
  let seat = enter(name)
  let gone = false

  owner(row).onStep(() => {
    if (gone) return
    const child = scene(row, name)
    const ctrl = child.rows.find(r => r.kind === 'scenemanager')
    const next = ctrl?.data.out?.[seat] as { scene: string; args: any[] } | undefined
    if (!next) { send({ scene: name, seat, packet: child.packet(seat) }); return }
    delete ctrl!.data.out[seat]
    if (!scenes(row).has(next.scene)) throw new Error(`no loaded scene ${next.scene}`)
    const full = scene(row, next.scene)
    if (next.scene !== name && own(full) && !free(full)) { send({ scene: name, seat, packet: child.packet(seat) }); return }
    exit(name, seat)
    name = next.scene
    seat = enter(name)
    const to = scene(row, name)
    const packet = to.packet(seat)
    // The seat possesses that row, so `answer()` runs the game's `arrive` act at the start of the
    // new child's next step, before `before`. A child whose `player` kind has no `arrive` act
    // refuses the message the way it refuses any unknown act.
    if (next.args.length > 0 && own(to)) {
      const mine = packet.rows.find(r => r.kind === 'player')
      if (!mine) throw new Error(`no player row on seat ${seat} of ${name}`)
      to.inbox(seat, { seq: 0, n: to.n, id: mine.id, action: 'arrive', args: next.args })
    }
    send({ scene: name, seat, packet })
  })

  return {
    // A message sent on a visit that is over, sent before the page heard the seat had moved, is
    // dropped, as the engine drops one a seat may not send: nothing on the scene it names is that
    // seat's any more, and a visit to the same scene after it is a seat of another number.
    take(up: Up) {
      if (up.scene !== name || up.seat !== seat) return
      scene(row, name).inbox(seat, up.msg)
    },
    close() {
      if (gone) return
      gone = true
      exit(name, seat)
    },
  }
}

// One link, which is one seat. The page makes it once and hands it to `view`, so which clients are
// one seat is the page's to say and nothing else can guess it: two pages on one manager are two
// links and two seats. `wire` is the transport the envelopes cross: `loopback(accept(row))` when
// the page holds the manager in the same tab, `dial(url)` when it is across a socket.
//
// A link holds the envelopes that arrive before anything hears it and hands them to the first
// hearer. A seat is told a row was born in one packet and in no other, so a link that dropped the
// first packet would leave the page with rows and no actor for any of them.
//
// Each envelope crosses as a `Diff`, which the link rebuilds into the whole packet and says it got,
// so what it hands on is the `Down` the seat's `connection` sent, `born` and `ended` counted
// against the rows it last handed on. One it cannot rebuild, its base lost on the way, is dropped
// as a lost envelope is; so is a second copy of one. One older than an envelope already handed on
// is handed on with no birth or end.
export function link(wire: Wire<Up | Got, Diff>): Link {
  const hearers: ((down: Down) => void)[] = []
  const held: Down[] = []
  const hear = (fn: (down: Down) => void) => { if (!hearers.length) held.splice(0).forEach(fn); hearers.push(fn) }
  const fan = (down: Down) => { if (!hearers.length) held.push(down); for (const h of hearers) h(down) }
  // The visit the newest envelopes are of, and the first `k` heard on it; the rows rebuilt for each
  // `k` a later envelope may still name as its base; the newest `k` handed on, and the rows the
  // page was last told were born, by id and kind.
  let visit: { scene: string; seat: number; first: number } | undefined
  const rebuilt = new Map<number, Row[]>()
  let floor = 0
  let newest = -1
  let shown = new Map<number, string>()
  const end = wire(d => {
    if (!visit || visit.scene !== d.scene || visit.seat !== d.seat) {
      // Numbers only go up across visits, so one below this visit's first is of a visit over.
      if (visit && d.k < visit.first) return
      visit = { scene: d.scene, seat: d.seat, first: d.k }
      rebuilt.clear()
      newest = -1
      shown = new Map()
    }
    // Rebuilt already, a duplicate: handing it on again would hand the page the same step twice.
    // Below `floor`, older than any base the server may still name, and older than what was handed.
    if (rebuilt.has(d.k) || d.k < floor) return
    const base = d.base === null ? [] : rebuilt.get(d.base)
    // A base the page never rebuilt: the envelope it was is lost, so this one cannot be read.
    if (!base) return
    const rows = patch(base, d)
    rebuilt.set(d.k, rows)
    floor = Math.max(floor, d.keep)
    for (const k of rebuilt.keys()) if (k < floor) rebuilt.delete(k)
    end.send({ got: d.k })
    // An envelope older than one already handed on is handed on as it is today, the step going
    // back, but tells of no birth or end: the newer one already did.
    if (d.k < newest) { fan({ scene: d.scene, seat: d.seat, packet: { n: d.n, ack: d.ack, rows: structuredClone(rows), born: [], ended: [] } }); return }
    newest = d.k
    const now = new Map(rows.map(r => [r.id, r.kind]))
    const born = rows.filter(r => shown.get(r.id) !== r.kind).map(r => r.id)
    const ended = [...shown].filter(([id, kind]) => now.get(id) !== kind).map(([id]) => id)
    shown = now
    fan({ scene: d.scene, seat: d.seat, packet: { n: d.n, ack: d.ack, rows: structuredClone(rows), born, ended } })
  })
  return { ...end, hear, store: {} }
}

// The page's one client, for the scene the seat is on. `file` is the manager's scene file, whose
// `scenemanager` prefab names the scenes, and `base` the url their files are relative to: the
// page's `import.meta.url`. `mount` is the page's: it gives each new client a canvas.
//
// Every envelope names the scene the seat is on and the seat's number there. When one names another
// scene, or another number on the same scene — the seat left and came back, or a scene sent it to
// itself, and its first packet there names every row as born — the next `frame` closes the client
// it holds (every actor's `remove`, every plugin's `close`: the renderer lets go of its canvas and
// its WebGL context, the keys stop listening) and makes one for where the seat is now. A scene the
// seat has left is drawn by nothing, listened for by nothing and run by nothing on this page; the
// server, or the truths in this tab, decide whether it runs. Envelopes of a visit that is already
// over when a frame reads them are dropped: nothing draws them.
export function view(wire: Link, file: Scene, base: string, mount: (me: Client, scene: Scene) => void) {
  const table = file.prefabs.scenemanager?.scenes as Record<string, Entry> | undefined
  if (!table) throw new Error('the manager scene has no scenemanager prefab naming scenes')
  const down: Down[] = []
  let live: { scene: string; seat: number; me: Client } | undefined
  const same = (a: { scene: string; seat: number }, b: { scene: string; seat: number }) => a.scene === b.scene && a.seat === b.seat
  wire.hear(d => {
    down.push(d)
    if (live && !same(live, d)) live.me.plugins.scenemanager.here = false
  })
  return {
    get name() { return live?.scene },
    get client() { return live?.me },
    async frame() {
      if (down.length) {
        const last = down[down.length - 1]
        let from = down.length - 1
        while (from > 0 && same(down[from - 1], last)) from--
        const visit = down.splice(0).slice(from)
        if (!live || !same(live, last)) {
          live?.me.close()
          live = undefined
          const e = table[last.scene]
          if (!e) throw new Error(`the link carried a packet of ${last.scene}, which the manager does not name`)
          const { scene, sim } = await child(file, last.scene, e, base)
          await prepare(sim, visit[0].packet.rows, scene.world ?? {})
          const me = await client(scene, base)
          me.plugins.scenemanager.mount(wire, last.scene, last.seat)
          mount(me, scene)
          live = { scene: last.scene, seat: last.seat, me }
        }
        for (const d of visit) live.me.plugins.scenemanager.hand(d.packet)
      }
      await live?.me.frame()
    },
    close() { live?.me.close(); live = undefined },
  }
}

// The manager stepped by its `engine.dt` as often as `time` owes it a step, the machine's clock
// unless another is handed in. Each call adds the time since the last, at most a quarter second, to
// what is owed, runs every whole step owed, and asks to be called again when the next one falls due.
// `setInterval` of a step's milliseconds does not keep time: node truncates 16.67 to 16 and each
// firing comes late, so it measured 58.76 steps a second where the scene says 60, in bursts. A timer
// that fires late here only makes the steps it owes run on that call. `stop` ends it: the call
// already asked for runs nothing.
export function run(truth: Truth, time: Time = { now: () => performance.now(), after: (ms, f) => { setTimeout(f, ms) } }) {
  const dt = truth.scene.prefabs.engine?.dt
  if (typeof dt !== 'number' || !(dt > 0)) throw new Error('the manager scene has no engine prefab with a dt above 0')
  let last = time.now(), owed = 0, stopped = false
  const loop = () => {
    if (stopped) return
    const now = time.now()
    owed += Math.min((now - last) / 1000, 0.25)
    last = now
    while (owed >= dt) { truth.step(dt); owed -= dt }
    time.after((dt - owed) * 1000, loop)
  }
  loop()
  return { stop() { stopped = true } }
}

// The server's side of a seat on this manager, for a transport to hand each page that arrives:
// every page is a `connection` of its own, and each of its packets crosses as a `Diff` against the
// newest envelope the page said it got that is still one of the last `backlog` sent. A visit's
// first envelopes, and any after the page has said nothing for `backlog` envelopes, are against no
// rows. The rows of an envelope are put by before it is sent: with no lag its `got` comes back
// inside the send.
export const accept = (row: Row): Accept<Up | Got, Diff> => send => {
  const backlog: number = row.data.backlog ?? 32
  const sent = new Map<number, Row[]>()
  let visit: { scene: string; seat: number } | undefined
  let k = 0
  let got = 0
  const seat = connection(row, down => {
    if (!visit || visit.scene !== down.scene || visit.seat !== down.seat) { sent.clear(); visit = { scene: down.scene, seat: down.seat } }
    k++
    const base = sent.get(got)
    sent.set(k, down.packet.rows)
    sent.delete(k - backlog)
    const { n, ack, rows } = down.packet
    send({ scene: down.scene, seat: down.seat, k, n, ack, base: base ? got : null, keep: k - backlog + 1, ...delta(base ?? [], rows) })
  })
  return {
    take(up) {
      if (!('got' in up)) return seat.take(up)
      if (Number.isSafeInteger(up.got) && up.got <= k) got = Math.max(got, up.got)
    },
    close: () => seat.close(),
  }
}

const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const field = (o: Record<string, unknown>, key: string) => (Object.hasOwn(o, key) ? o[key] : undefined)
// Equal as JSON sends them: an object's `undefined` fields are absent.
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b) || a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (!plain(a) || !plain(b)) return false
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter(key => o[key] !== undefined)
  const ka = keys(a)
  return ka.length === keys(b).length && ka.every(key => same(a[key], field(b, key)))
}
function walk(a: Record<string, unknown>, b: Record<string, unknown>, path: string[], c: Change) {
  for (const key of Object.keys(b)) {
    const x = field(a, key), y = b[key]
    if (y === undefined) continue
    if (plain(x) && plain(y)) walk(x, y, [...path, key], c)
    else if (!same(x, y)) c.set.push([[...path, key], y])
  }
  for (const key of Object.keys(a)) if (a[key] !== undefined && field(b, key) === undefined) c.unset.push([...path, key])
}

// The rows of `now` as a delta against `base`, both lists of rows as a packet holds them. A row
// whose id names another kind than in the base is dropped and added.
export function delta(base: Row[], now: Row[]): Delta {
  const was = new Map(base.map(r => [r.id, r]))
  const d: Delta = { add: [], change: [], drop: [] }
  for (const r of now) {
    const b = was.get(r.id)
    was.delete(r.id)
    if (!b || b.kind !== r.kind) { if (b) d.drop.push(r.id); d.add.push(r); continue }
    const c: Change = { id: r.id, set: [], unset: [] }
    walk(b.data, r.data, [], c)
    if (c.set.length || c.unset.length) d.change.push(c)
  }
  d.drop.push(...was.keys())
  return d
}

// `base` with a delta applied: new rows, sharing nothing with either, in id order, which is the
// order a truth keeps its rows in and so the order its packet lists them.
export function patch(base: Row[], d: Delta): Row[] {
  const rows = new Map(base.map(r => [r.id, r]))
  for (const id of d.drop) rows.delete(id)
  for (const [id, r] of rows) rows.set(id, structuredClone(r))
  for (const c of d.change) {
    const r = rows.get(c.id)
    if (!r) throw new Error(`the delta changes row ${c.id}, which its base has not got`)
    for (const [path, value] of c.set) Object.defineProperty(at(r, path), path[path.length - 1], { value: structuredClone(value), enumerable: true, writable: true, configurable: true })
    for (const path of c.unset) delete at(r, path)[path[path.length - 1]]
  }
  for (const r of d.add) rows.set(r.id, structuredClone(r))
  return [...rows.values()].sort((a, b) => a.id - b.id)
}
// The object a path's last key is a field of.
function at(r: Row, path: string[]): Record<string, unknown> {
  let o: Record<string, unknown> = r.data
  for (const key of path.slice(0, -1)) {
    const next = field(o, key)
    if (!plain(next)) throw new Error(`row ${r.id} has no object at ${path.join('.')}`)
    o = next
  }
  return o
}
