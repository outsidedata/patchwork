// The browser half of the player: prediction. The server and one browser on a seat of it play on the
// simulator (`addons/simulator`), with no time passing: a manager of one scene, stepped by the loop
// every server runs, and a page on it through the loopback's millisecond network, as a game's
// `index.html` runs them, on one timeline. The server's timer fires on the very millisecond owed
// (`grain: 0`), so step n is taken at n steps' time. The page's display draws a frame a step, its
// vsyncs half a step past each step (`display.phase`), so frame k is drawn with the server k steps on
// and the page's clock moves one step's time a frame. A leg `u` steps long is u steps' milliseconds:
// a packet of step n arrives u steps later, half a step before frame n + u takes it, and a press sent
// on frame k reaches the server's inbox half a step before step k + u + 1 takes it. A press before
// frame k is a key pressed between frames, an eighth of a step before its vsync; the player plugin
// applies it in that frame's tick. Frame k's record holds the rows the browser's actors were handed,
// and step n's record the server's rows after step n.
//
// The prediction tests write their scenes here, and each kind's rule into a folder of its own as
// `<kind>.sim.ts`, the page's folder, where the player plugin finds the rule it runs ahead. The
// scene's own file and sim are written beside them, so the server boots it from the same files and
// both sides run one rule.
import { afterAll, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join as path, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { boot, type Arg, type Row, type Scene, type Truth } from '#engine/engine.ts'
import type { Entry } from '#plugins/audio/audio.sim.ts'
import { client, type Client } from '#engine/browser.ts'
import { loader } from '#plugins/loader/loader.plugin.ts'
import { accept, entries, link, load, manager, scene } from '#addons/scenemanager/scenemanager.addon.ts'
import { loopback, type Leg } from '#addons/loopback/loopback.addon.ts'
import { playtest, type Think } from '#addons/player/player.addon.ts'
import { simulate, type Display, type FrameRecord, type MessageRecord, type Server, type StepRecord, type Watched } from '#addons/simulator/simulator.addon.ts'
import { scenemanager } from '#plugins/scenemanager/scenemanager.sim.ts'
import { keyCode, keyName, type Bound } from './player.plugin.ts'

// The actors bind keys and the mouse on the page; node has no page. This one keeps the last
// listener bound for each event, so a test can hand it an event, and it holds the pointer lock:
// `requestPointerLock` on the element clicked gives the lock to that element, `exitPointerLock`
// takes it back. Every event it hands on can have its default cancelled, and `cancelled` counts
// the events that were, by type. A page on the simulator binds its own listeners, which the
// simulator holds for it.
const on = new Map<string, (e: any) => void>()
const cancelled = new Map<string, number>()
;(globalThis as any).addEventListener = (type: string, f: (e: any) => void) => {
  on.set(type, e => f({ preventDefault() { cancelled.set(type, (cancelled.get(type) ?? 0) + 1) }, ...e }))
}
;(globalThis as any).removeEventListener = (type: string) => { on.delete(type) }
const page = { pointerLockElement: null as unknown, exitPointerLock() { page.pointerLockElement = null } }
;(globalThis as any).document = page

// A key event as the page sends one: the key's place on the keyboard, `code`, and what it typed,
// which is its name unless `more` says otherwise, as `W` with Shift down.
const key = (code: string, more: Record<string, unknown> = {}) => ({ code, key: keyName(code), ...more })

const r3 = (x: number) => +x.toFixed(3)

// The page's clock for the rigs that hand a page every packet the moment it is sent, the range,
// which the player plugin reads to count the steps between packets: it moves only as those
// tests move it. A page on the simulator reads the simulator's clock instead.
let clock = 0
vi.spyOn(performance, 'now').mockImplementation(() => clock)
const pass = (seconds: number) => { clock += seconds * 1000 }

// A folder of the files named, the page's folder of one scene, and the server's sim off the rule
// files in it: each kind's `<kind>.sim.ts` exports the kind under its name.
const folders: string[] = []
afterAll(() => { for (const f of folders) rmSync(f, { recursive: true }) })
function folder(files: Record<string, string>) {
  const dir = mkdtempSync(path(tmpdir(), 'player-'))
  folders.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(path(dir, name)), { recursive: true })
    writeFileSync(path(dir, name), text)
  }
  return pathToFileURL(dir + '/').href
}
// A manager of the one scene `name`, written into `home` as a game's child scene is: its scene file,
// and its sim, which imports each kind's rule file named in `kinds`, a path from `home` or from
// anywhere. Hands back the manager's scene, which the simulator boots and the page views.
function managed(home: string, name: string, child: Scene, kinds: Record<string, string>): Scene {
  const dir = fileURLToPath(home)
  writeFileSync(path(dir, `${name}.scene.json`), JSON.stringify(child))
  writeFileSync(path(dir, `${name}.sim.ts`), `${Object.entries(kinds).map(([k, f]) => `import { ${k} } from ${JSON.stringify(f)}\n`).join('')}import file from './${name}.scene.json' with { type: 'json' }
export const sim = { ${Object.keys(kinds).join(', ')} }
export const scene = file
`)
  const dt = child.prefabs.engine.dt
  return {
    world: {},
    plugins: ['scenemanager'],
    seats: 1,
    prefabs: { engine: { dt }, scenemanager: { scenes: { [name]: { file: `${name}.scene.json`, suspend: false } }, dt, entry: name, port: 0 } },
    actors: [{ is: 'scenemanager' }],
  }
}

// ---------------------------------------------------------------- the timeline

// Every scene here steps 60 times a second.
const DT = 1 / 60
const STEP = DT * 1000
// A way of the network `steps` steps long, and whatever else it does.
const leg = (steps: number, more: Omit<Leg, 'delay'> = {}): Leg => ({ delay: steps * STEP, ...more })
// Watched rows as rows.
const rowsOf = (rows: Watched): Row[] => Object.entries(rows).map(([id, { kind, ...data }]) => ({ id: Number(id), kind: kind as string, data }))

// Frames that took packets in bursts: none on many, never more than three, and all of them at the
// rate the server steps, one a step on the mean, less the burst in flight at each end.
// A server whose timer rounds every wait down to a burst: two steps' milliseconds and a millionth
// of one more, so the time it owes at each firing is never a hair short of two steps and it takes
// exactly two, then none for a frame, as a timer that fires late and catches up does. At exactly two
// steps' milliseconds the owed sum's float error now and then takes one and then three.
const BURST = 2 * STEP + 1e-6
// Frames that took their packets two on one frame and none on the next, every frame.
function expectBursts(frames: FrameRecord[]) {
  const took = frames.map(f => f.took.length)
  expect(new Set(took)).toEqual(new Set([0, 2]))
  expect(took.every((n, i) => i === 0 || n !== took[i - 1])).toBe(true)
}

type Knobs = {
  frames: number // the vsyncs the run lasts
  up: Leg
  down: Leg
  display?: Display // a frame a step, half a step past each step, when unset
  server?: Server // the loop on a timer that fires on the millisecond owed, when unset
  presses?: [frame: number, action: string, ...args: Arg[]][] // each pressed before its frame
  think?: Think
  turns?: { frame: number; turn: () => void }[] // each turned where a press before its frame would be
  seed?: number
  cost?: boolean
  seated?: (child: Truth) => void // after the page's seat, which is 0, before the first step
}

// The manager of `name` in `home` on the simulator, with one page on it, for `knobs.frames` vsyncs:
// long enough for the server to take the step after the last frame, as a frame and then a step does.
// The page joins at 0 and takes the first seat; `seated` is handed the child's truth an eighth of a
// step later, for a playtester to take the next. Hands back each frame the page drew (`frames[k]` is
// frame k when nothing hides a vsync), what it drew, the server's rows after each step (`server(0)`
// before the first) and as each frame was drawn (`serverAt(k)`, after step k when the server keeps
// time), the child's truth and the page's client.
async function played(home: string, name: string, child: Scene, kinds: Record<string, string>, knobs: Knobs) {
  const top = managed(home, name, child, kinds)
  const display = knobs.display ?? { hz: 60, phase: STEP / 2 }
  const P = 1000 / display.hz, phase = display.phase ?? 0
  const before = (frame: number) => phase + frame * P - STEP / 8
  const byStep = new Map<number, Row[]>()
  let truth: Truth | undefined, me: Client | undefined
  const records = await simulate({
    file: top, sim: { scenemanager }, base: home, seed: knobs.seed ?? 1, ms: phase + (knobs.frames - 1 / 4) * P,
    server: knobs.server ?? { grain: 0 }, watch: {}, cost: knobs.cost,
    pages: [{ display, up: knobs.up, down: knobs.down, presses: (knobs.presses ?? []).map(([frame, ...act]) => ({ at: before(frame), act })), think: knobs.think }],
    turns: [
      ...(knobs.seated ? [{ at: STEP / 8, turn: () => { knobs.seated!(truth!); byStep.set(truth!.n, structuredClone(truth!.rows)) } }] : []),
      ...(knobs.turns ?? []).map(t => ({ at: before(t.frame), turn: t.turn })),
    ],
    ready(t) {
      truth = scene(manager(t), name)
      byStep.set(truth.n, structuredClone(truth.rows))
    },
    mount: c => { me = c },
  })
  const frames = records.filter((r): r is FrameRecord => r.type === 'frame')
  if (!display.hidden && frames.length !== knobs.frames) throw new Error(`the run drew ${frames.length} frames, not ${knobs.frames}`)
  const steps = records.filter((r): r is StepRecord => r.type === 'step')
  for (const s of steps) byStep.set(s.scenes[name], rowsOf(s.rows![name]))
  // The step each frame was drawn after: the last one at or before its time.
  let last = 0
  const after = frames.map(f => { while (last < steps.length && steps[last].t <= f.t) last++; return last ? steps[last - 1].scenes[name] : 0 })
  return {
    records, frames, steps, truth: truth!, client: me!,
    drawn: (k: number) => rowsOf(frames[k].rows),
    server: (n: number) => byStep.get(n),
    serverAt: (k: number) => byStep.get(after[k])!,
  }
}

const SCENEMANAGER = new URL('../scenemanager/scenemanager.sim.ts', import.meta.url).pathname
const BOX3D = new URL('../box3d/box3d.sim.ts', import.meta.url).pathname

// ---------------------------------------------------------------- birds

// Two birds falling, and the only presses are the test's. The seat possesses its `player` row,
// which takes the first bird offered it; every bird's actor offers its bird in setup, as a page
// does the moment the bird's row arrives. A flap sets the bird's own vy; a laser writes the other
// bird, when it is level with this one and to its right.
// 3 steps up and 3 down: a press sent on frame k is taken by the server in step k + 4, and the
// packet of step n is taken by the browser on frame n + 3. The browser takes its first packet, step
// 1's, on frame 4; the assignPlayer presses every bird's setup makes are acked on frame 11, which
// measures the round trip at 7 frames, so from 11 the browser runs 3 steps ahead of each packet.
const birds: Scene = {
  world: { gravity: 900 },
  plugins: ['scenemanager', 'player'],
  seats: 1,
  prefabs: { engine: { dt: 1 / 60 }, scenemanager: { out: {} }, player: { seat: 0, bird: null }, bird: { x: 100, y: 300, vy: 0, dead: false } },
  actors: [{ is: 'bird' }, { is: 'bird', x: 200 }, { is: 'scenemanager' }],
}
const birdsHome = folder({
  'bird.sim.ts': `export const bird = {
  tick(me, dt, w) {
    if (me.data.dead) return
    me.data.vy -= w.world.gravity * dt
    me.data.y += me.data.vy * dt
  },
  acts: {
    flap(me) { if (!me.data.dead) me.data.vy = 300 },
    laser(me, w) {
      const other = w.find('bird', b => b.id !== me.id)
      if (Math.abs(other.data.y - me.data.y) < 20 && other.data.x > me.data.x) other.data.dead = true
    },
  },
}
`,
  'player.sim.ts': `export const player = {
  acts: {
    assignPlayer(me, w, _seat, id) {
      if (me.data.bird !== null) return
      if (w.all('player').some(p => p.data.bird === id)) return
      me.data.bird = id
    },
    flap(me, w, seat) { if (me.data.bird !== null) w.call(w.get(me.data.bird), 'flap', seat) },
    laser(me, w, seat) { if (me.data.bird !== null) w.call(w.get(me.data.bird), 'laser', seat) },
  },
}
`,
  'bird.client.ts': `export function setup(row, plugins) { plugins.player.assignPlayer(row.id) }
export function tick() {}
export function remove() {}
`,
})
// Up and down, in steps.
const LAG = 3

// The birds for `frames` frames, each press pressed before its frame. `drawn(k, b)` is bird b as
// frame k drew it and `server(k, b)` as the server had it after step k, read from frame 11 on.
async function birdsRig(frames: number, presses: Knobs['presses']) {
  const p = await played(birdsHome, 'birds', birds, { scenemanager: SCENEMANAGER, bird: './bird.sim.ts', player: './player.sim.ts' }, { frames, up: leg(LAG), down: leg(LAG), presses })
  // Bird 1 and bird 2 are the first and second bird rows.
  const ids = p.server(0)!.filter(r => r.kind === 'bird').map(r => r.id)
  const drawn = (k: number, bird: number) => p.drawn(k).find(r => r.id === ids[bird - 1])!.data
  const server = (k: number, bird: number) => p.server(k)!.find(r => r.id === ids[bird - 1])!.data
  const read = <T>(f: (k: number) => T): T[] => { const out: T[] = []; for (let k = 11; k < frames; k++) out[k] = f(k); return out }
  return { drawn, server, read }
}

// A flap on 11 first, so bird 1 is already the browser's copy: before its first press a row is
// drawn from the packet, 3 steps behind. The flap on 40 is the one measured; bird 1 is falling
// again by then. The server applies it in the step from 43 to 44: 3 steps after the browser did.
test('a flap is drawn before the server hears it', async () => {
  const { drawn, server, read } = await birdsRig(55, [[11, 'flap'], [40, 'flap']])
  const M = read(k => drawn(k, 1).y), S = read(k => server(k, 1).y)
  expect(M.findIndex((y, k) => k > 35 && y > M[k - 1])).toBe(41)
  expect(S.findIndex((y, k) => k > 35 && y > S[k - 1])).toBe(44)
})

// The flap on 30 makes bird 1 the browser's copy; from then on the drawn row and the server's
// are equal except between a press and the packet whose ack numbers it. A press on p is
// applied here at step p and there in the step after p + 3. The packets of steps p + 1, p + 2 and
// p + 3 are taken on p + 4, p + 5 and p + 6; the first two do not ack it, so the press is re-applied
// at each packet's step, one later each time, and the third packet's rows already have it.
test('the server catches up with a flap on the sixth frame after it', async () => {
  const later = Array.from({ length: 25 }, (_, i) => 60 + i * 10)
  const { drawn, server, read } = await birdsRig(320, [30, ...later].map((k): [number, string] => [k, 'flap']))
  const M = read(k => drawn(k, 1).y), S = read(k => server(k, 1).y)
  const differ = M.map((y, k) => (y !== S[k] ? k : -1)).filter(k => k >= 0)
  const notYetMine = Array.from({ length: 25 }, (_, i) => 11 + i)
  const inFlight = later.flatMap(p => [1, 2, 3, 4, 5].map(i => p + i))
  expect(differ).toEqual([...notYetMine, ...inFlight])
})

// No flaps, so both birds fall at the same height, and bird 2 is to the right of bird 1: in
// range. Laser writes bird 2, not the row the press names, so the browser does not run it: the
// server takes it in step 34 and has bird 2 dead after it, the packet of step 34 is taken on 37,
// and the drawn bird 2 stops falling there, dead.
test('a laser is not drawn ahead', async () => {
  const { drawn, server, read } = await birdsRig(45, [[30, 'laser']])
  const M = read(k => drawn(k, 2).y), D = read(k => server(k, 2).dead), d = read(k => drawn(k, 2).dead)
  expect(D.indexOf(true)).toBe(34)
  expect(d.indexOf(true)).toBe(37)
  expect(M.findIndex((y, k) => k > 11 && y === M[k - 1])).toBe(37)
})

// ---------------------------------------------------------------- lanes

// The prediction model under stress: seat 0 is the browser, seat 1 a playtester on the addon. Each
// seat has a lane of bodies, one kind to a claim of the model; a `target` and a `ledger` are
// nobody's. A miss is drawn minus server for one number of one row at one frame. The clock
// row's t is the step number on both sides, so once seat 0 has touched its clock, the t it draws
// is the step the browser is at.
const W = { width: 800, speed: 200, pace: 150, hop: 20, stride: 2, kick: 300, seed: 7, notes: 0 }
const lanes: Scene = {
  world: {
    ...W,
    // A window that is no whole number of frames, so no packet is ever exactly its age.
    player: { window: 1.99 },
    box3d: {
      gravity: [0, -900, 0], subStepCount: 4, contactHertz: 30, contactDampingRatio: 10, contactSpeed: 300,
      restitutionThreshold: 100, maximumLinearSpeed: 40000, enableSleep: true, enableContinuous: true,
      static: [{ pos: [400, -50, 0], rot: [0, 0, 0, 1], shapes: [{ box: [4000, 50, 50], density: 0, baseMaterial: { friction: 0.6, restitution: 0, rollingResistance: 0 } }] }],
      kinds: {
        crate: {
          type: 'dynamic', linearDamping: 0, angularDamping: 0, gravityScale: 1, sleepThreshold: 5, isBullet: false,
          shapes: [{ box: [10, 10, 10], density: 1, baseMaterial: { friction: 0.6, restitution: 0, rollingResistance: 0 } }],
        },
      },
    },
  },
  plugins: ['scenemanager', 'player'],
  seats: 2,
  prefabs: {
    engine: { dt: 1 / 60 },
    scenemanager: { out: {} },
    box3d: {},
    target: { x: 0, vx: 150 },
    chaser: { seat: 0, x: 400 },
    mover: { seat: 0, x: 100, vx: 0, rolls: 0, last: 0, shots: 0 },
    shot: { x: 0, vx: 600, life: 1 },
    stamper: { seat: 0, x: 0, vx: 120, n: 0, every: 10 },
    tally: { seat: 0, count: 0 },
    clock: { seat: 0, t: 0, touched: 0 },
    ledger: { count: 0, last: -1 },
    crate: { seat: 0, pos: [100, 10, 0], rot: [0, 0, 0, 1], vel: [0, 0, 0], spin: [0, 0, 0], awake: true },
    player: { seat: 0 },
  },
  actors: [
    { is: 'box3d' }, { is: 'target' },
    { is: 'chaser' }, { is: 'chaser', seat: 1, x: 200 },
    { is: 'mover' }, { is: 'mover', seat: 1, x: 500 },
    { is: 'stamper' }, { is: 'stamper', seat: 1, x: 400 },
    { is: 'tally' }, { is: 'tally', seat: 1 },
    { is: 'clock' }, { is: 'clock', seat: 1 },
    { is: 'ledger' },
    { is: 'crate' }, { is: 'crate', seat: 1, pos: [500, 10, 0] },
    { is: 'scenemanager' },
  ],
}
const LANE_KINDS = ['player', 'mover', 'shot', 'clock', 'chaser', 'target', 'stamper', 'tally', 'ledger', 'crate']
const lanesHome = folder({
  // The seat possesses this row. Every press goes at the row of that kind holding the same seat,
  // except bump, which goes at the one ledger.
  'player.sim.ts': `const mine = (w, kind, seat) => w.find(kind, r => r.data.seat === seat)
export const player = {
  acts: {
    hop(_me, w, seat, d) { w.call(mine(w, 'mover', seat), 'hop', seat, d) },
    move(_me, w, seat, v) { w.call(mine(w, 'mover', seat), 'move', seat, v) },
    fire(_me, w, seat) { w.call(mine(w, 'mover', seat), 'fire', seat) },
    roll(_me, w, seat) { w.call(mine(w, 'mover', seat), 'roll', seat) },
    note(_me, w, seat) { w.call(mine(w, 'mover', seat), 'note', seat) },
    touch(_me, w, seat) { w.call(mine(w, 'clock', seat), 'touch', seat) },
    steer(_me, w, seat, d) { w.call(mine(w, 'chaser', seat), 'steer', seat, d) },
    poke(_me, w, seat, d) { w.call(mine(w, 'stamper', seat), 'poke', seat, d) },
    kick(_me, w, seat, dv) { w.call(mine(w, 'crate', seat), 'kick', seat, dv) },
    bump(_me, w, seat) { w.call(w.find('ledger'), 'bump', seat) },
  },
}
`,
  // A body on a line whose per-step rule reads nothing but itself. hop and move write only this
  // row; fire spawns, roll rolls the die, note writes the world.
  'mover.sim.ts': `export const mover = {
  tick(me, dt, w) { me.data.x = Math.max(0, Math.min(w.world.width - 20, me.data.x + me.data.vx * dt)) },
  acts: {
    hop(me, w, _seat, d) { me.data.x = Math.max(0, Math.min(w.world.width - 20, me.data.x + d)) },
    move(me, _w, _seat, v) { me.data.vx = v },
    fire(me, w) { w.spawn('shot', { x: me.data.x + 20 }); me.data.shots++ },
    roll(me, w) { me.data.last = w.die(); me.data.rolls++ },
    note(_me, w) { w.world.notes++ },
  },
}
`,
  // Spawned by a mover's fire. Flies right for its life, then ends itself.
  'shot.sim.ts': `export const shot = {
  tick(me, dt, w) {
    me.data.x += me.data.vx * dt
    me.data.life -= dt
    if (me.data.life <= 0) w.end(me)
  },
}
`,
  // t is the step number: 0 before step 0, n after step n - 1, on both sides.
  'clock.sim.ts': `export const clock = { tick(me) { me.data.t++ }, acts: { touch(me) { me.data.touched++ } } }\n`,
  // A body whose per-step rule reads another row: it walks toward the target.
  'chaser.sim.ts': `export const chaser = {
  tick(me, dt, w) {
    const t = w.find('target')
    const off = t.data.x - me.data.x
    if (Math.abs(off) > w.world.speed * dt) me.data.x += Math.sign(off) * w.world.speed * dt
    else me.data.x = t.data.x
  },
  acts: { steer(me, w, _seat, d) { me.data.x = Math.max(0, Math.min(w.world.width - 20, me.data.x + d)) } },
}
`,
  // Nobody's. Sweeps left and right at its own speed.
  'target.sim.ts': `export const target = {
  tick(me, dt, w) {
    me.data.x += me.data.vx * dt
    if (me.data.x < 0) { me.data.x = 0; me.data.vx = Math.abs(me.data.vx) }
    if (me.data.x > w.world.width - 20) { me.data.x = w.world.width - 20; me.data.vx = -Math.abs(me.data.vx) }
  },
}
`,
  // A body whose per-step rule writes a second row, its tally, every \`every\` steps.
  'stamper.sim.ts': `export const stamper = {
  tick(me, dt, w) {
    me.data.n++
    me.data.x += me.data.vx * dt
    if (me.data.x > w.world.width - 20) me.data.x -= w.world.width - 20
    if (me.data.n % me.data.every === 0) w.find('tally', t => t.data.seat === me.data.seat).data.count++
  },
  acts: { poke(me, w, _seat, d) { me.data.x = (me.data.x + d) % (w.world.width - 20) } },
}
`,
  'tally.sim.ts': `export const tally = {}\n`,
  // One row both seats write: a count and who bumped last.
  'ledger.sim.ts': `export const ledger = { acts: { bump(me, _w, seat) { me.data.count++; me.data.last = seat } } }\n`,
  // A box3d body. The box3d row moves it each step; its own rule is only the kick.
  'crate.sim.ts': `export const crate = { acts: { kick(me, _w, _seat, dv) { me.data.vel[0] += dv } } }\n`,
})
const x = (d: any) => d.x

// The other seat, on the addon: move at the world's pace, turn at each wall. The seat is the
// one on the player row in the packet: the addon shows a seat only its own.
const patrol: Think = rows => {
  const seat = rows.find(r => r.kind === 'player')?.data.seat
  if (seat === undefined) throw new Error('no player row on this seat')
  const me = rows.find(r => r.kind === 'mover' && r.data.seat === seat)
  if (!me) return
  if (me.data.vx === 0) return ['move', W.pace]
  if (me.data.vx < 0 && me.data.x <= 0) return ['move', W.pace]
  if (me.data.vx > 0 && me.data.x >= W.width - 20) return ['move', -W.pace]
}

// A press every frame: a hop of the world's stride, turning at each wall.
const sweep = (seat: number): Think => {
  let dir = 1
  return rows => {
    const me = rows.find(r => r.kind === 'mover' && r.data.seat === seat)
    if (!me) return
    if (me.data.x <= 0) dir = 1
    if (me.data.x >= W.width - 20) dir = -1
    return ['hop', dir * W.stride]
  }
}

type Read = { n: number; drawn: Row[]; server: Row[] }
type Window = { from: number; to: number; peak: number }

// The lanes on the simulator, 3 steps each way unless `knobs` say otherwise, seat 1 played by
// `other`. `R[k]` is frame k: the packet's step it drew from, the rows it drew, and the server's
// rows as it was drawn, after step k when the server keeps time.
async function lanesRig(knobs: Partial<Knobs> & { frames: number }, other: Think = patrol) {
  const kinds = Object.fromEntries(LANE_KINDS.map(k => [k, `./${k}.sim.ts`]))
  const p = await played(lanesHome, 'lanes', lanes, { scenemanager: SCENEMANAGER, box3d: BOX3D, ...kinds }, { up: leg(LAG), down: leg(LAG), ...knobs, seated: t => { playtest(t, other) } })
  const R: Read[] = p.frames.map((f, k) => ({ n: f.n ?? 0, drawn: rowsOf(f.rows), server: p.serverAt(k) }))
  const pick = (rows: Row[], kind: string, seat?: number) => rows.find(r => r.kind === kind && (seat === undefined || r.data.seat === seat))
  const drawn = (k: number, kind: string, seat?: number) => pick(R[k].drawn, kind, seat)?.data
  const server = (k: number, kind: string, seat?: number) => pick(R[k].server, kind, seat)?.data
  const miss = (k: number, kind: string, seat: number | undefined, field: (d: any) => number) => {
    const d = drawn(k, kind, seat), s = server(k, kind, seat)
    return d && s ? field(d) - field(s) : undefined
  }
  // The runs of frames in [from, to) where |miss| > tol, each with its largest |miss|.
  const windows = (from: number, to: number, kind: string, seat: number | undefined, field: (d: any) => number, tol = 0): Window[] => {
    const out: Window[] = []
    for (let k = from; k < to; k++) {
      const m = miss(k, kind, seat, field)
      if (m === undefined || Math.abs(m) <= tol) continue
      const last = out[out.length - 1]
      if (last && last.to === k - 1) { last.to = k; last.peak = Math.max(last.peak, Math.abs(m)) }
      else out.push({ from: k, to: k, peak: Math.abs(m) })
    }
    return out
  }
  // The step seat 0's browser is at, read off its clock, and how far that is from the server's.
  const at = (k: number) => drawn(k, 'clock', 0)?.t as number
  const ahead = (k: number) => at(k) - R[k].n
  const lead = (k: number) => at(k) - k
  // Whether the row seat 0 drew at k is the row the server had at the step the browser was at.
  const same = (k: number, kind: string, seat?: number) => JSON.stringify(drawn(k, kind, seat)) === JSON.stringify(server(at(k), kind, seat))
  // How many steps behind the server a number is drawn: the smallest m with drawn(k) = server(k - m).
  const late = (k: number, kind: string, seat: number | undefined, field: (d: any) => number, max = 30) => {
    for (let m = 0; m <= max; m++) if (k - m >= 0 && drawn(k, kind, seat) && server(k - m, kind, seat) && field(drawn(k, kind, seat)) === field(server(k - m, kind, seat))) return m
    return undefined
  }
  return { ...p, R, drawn, server, miss, windows, at, ahead, lead, same, late }
}

// A hop writes only the mover, through the player's call: drawn on the frame of the press, in the
// server's inbox `up` steps after it is sent, before step 64, which takes it, and never redrawn.
test('a hop is drawn at the press', async () => {
  const g = await lanesRig({ frames: 120, presses: [[20, 'touch'], [60, 'hop', W.hop]] })
  expect(g.R.findIndex((_, k) => g.drawn(k, 'mover', 0)?.x === 100 + W.hop)).toBe(60)
  expect(g.R.findIndex((_, k) => g.server(k, 'mover', 0).x === 100 + W.hop)).toBe(64)
  expect(g.windows(20, 120, 'mover', 0, x)).toEqual([{ from: 60, to: 63, peak: W.hop }])
  expect(Array.from({ length: 10 }, (_, i) => g.drawn(58 + i, 'mover', 0).x)).toEqual([100, 100, 120, 120, 120, 120, 120, 120, 120, 120])
})

// A move sets vx; the per-step rule then runs on the copy each frame. The browser applies the
// press at its own step, the server `up` steps later, so the copy is ahead by up steps of motion
// until each packet re-applies the press one step later: the drawn body stands still for `up`
// frames instead of jumping back. A stop press creeps forward the same way. Outside those
// windows the drawn mover is the server's row at the browser's step.
test('a move runs ahead, and the redraw is a stall of up frames', async () => {
  const g = await lanesRig({ frames: 200, presses: [[20, 'touch'], [60, 'move', W.speed], [120, 'move', 0]] })
  const xs = (from: number, n: number) => Array.from({ length: n }, (_, i) => r3(g.drawn(from + i, 'mover', 0).x))
  const ws = g.windows(30, 200, 'mover', 0, x, 1e-9)
  const still = xs(60, 11).filter((v, i, a) => i > 0 && v === a[i - 1]).length
  const vws = g.windows(30, 200, 'mover', 0, d => d.vx)
  const inFlight = (k: number) => [...ws, ...vws].some(w => k >= w.from && k <= w.to)
  const sameOutside = g.R.map((_, k) => k).filter(k => k >= 30 && !inFlight(k)).every(k => g.same(k, 'mover', 0))
  expect(ws.map(w => [w.from, w.to])).toEqual([[61, 65], [121, 125]])
  expect(r3(ws[0].peak)).toBe(r3(W.speed * DT * LAG))
  expect(still).toBe(3)
  expect(sameOutside).toBe(true)
})

// A display that draws twice for every step the page takes, as a 120 Hz one does over a 60 Hz loop:
// its vsyncs a quarter and three quarters of a step past each step, so every other frame brings no
// packet, and half a step of the page's clock has passed. The predicted body moves when the packet
// comes, as every other row does, a step's ground at a time, and holds on the frame between, so it
// keeps its place against the rest of the world.
test('with two frames to a step, a predicted body moves once a step, on the frame its packet comes, and holds between', async () => {
  // Frames 2k and 2k + 1 are the pair between step k and step k + 1.
  const g = await lanesRig({ frames: 240, up: leg(0), down: leg(0), display: { hz: 120, phase: STEP / 4 }, presses: [[40, 'touch'], [120, 'move', W.speed]] })
  const xs = Array.from({ length: 50 }, (_, i) => [0, 1].map(f => g.drawn(140 + 2 * i + f, 'mover', 0).x))
  const step = r3(W.speed * DT)
  // The frame between packets draws what the packet's frame drew.
  expect(xs.every(([a, b]) => a === b)).toBe(true)
  // And each packet's frame is a step on from the last.
  expect(xs.slice(1).every(([a], i) => r3(a - xs[i][0]) === step)).toBe(true)
})

// The browser's step is the packet's plus half the last press's round trip in frames, so it is
// the server's step only when up and down are equal. Before the first press is acked the copy
// runs at the packet's step, `down` behind.
test('steps ahead is half the round trip, and only equal lag lands on the server\'s step', async () => {
  const lags: [number, number][] = [[0, 0], [1, 1], [3, 3], [6, 6], [12, 12], [1, 5], [5, 1], [0, 6], [6, 0]]
  for (const [up, down] of lags) {
    const g = await lanesRig({ frames: 120, up: leg(up), down: leg(down), presses: [[20, 'touch'], [60, 'move', W.speed]] })
    const rtt = up + down + 1
    expect(g.ahead(100)).toBe(Math.floor(rtt / 2))
    expect(g.lead(100)).toBe(Math.floor(rtt / 2) - down)
    expect(g.lead(20)).toBe(0 - down)
  }
})

// The chaser's per-step rule reads the target. The copy runs it against the target the packet
// carried, `down` steps stale, so the drawn chaser sits on where the target was: on every one of
// 520 frames it sits on the drawn target and equals the server's chaser `down` steps earlier.
test('a rule that reads another row runs against a stale row', async () => {
  const g = await lanesRig({ frames: 600, presses: [[20, 'touch'], [60, 'steer', W.hop]] })
  const ws = g.windows(80, 600, 'chaser', 0, x, 1e-9)
  const missed = ws.reduce((n, w) => n + w.to - w.from + 1, 0)
  const peak = Math.max(...ws.map(w => w.peak))
  const behind = Array.from({ length: 520 }, (_, i) => 80 + i).every(k => g.drawn(k, 'chaser', 0).x === g.server(k - LAG, 'chaser', 0).x)
  const onTarget = Array.from({ length: 520 }, (_, i) => 80 + i).every(k => g.drawn(k, 'chaser', 0).x === g.drawn(k, 'target').x)
  expect(missed).toBeGreaterThan(400)
  expect(peak).toBeGreaterThanOrEqual(LAG * lanes.prefabs.target.vx * DT - 1e-9)
  expect(behind).toBe(true)
  expect(onTarget).toBe(true)
})

// The stamper's per-step rule writes its tally every tenth step. On that step the copy is not
// run: the drawn stamper stands still and is one step behind until the packet made after the
// server took that step, `down` frames, each run starting on the frame whose next step writes the
// tally.
test('the step where a rule writes a second row is not run ahead', async () => {
  const g = await lanesRig({ frames: 200, presses: [[20, 'touch'], [60, 'poke', W.hop]] })
  const stalls = g.R.map((_, k) => k).filter(k => k >= 75 && k < 200 && g.drawn(k, 'stamper', 0).x === g.drawn(k - 1, 'stamper', 0).x)
  const runs = stalls.reduce<number[][]>((rs, k) => { const last = rs[rs.length - 1]; if (last && last[last.length - 1] === k - 1) last.push(k); else rs.push([k]); return rs }, [])
  const ns = runs.map(r => g.drawn(r[0], 'stamper', 0).n)
  const every = lanes.prefabs.stamper.every
  expect(runs.length).toBe(12)
  expect(runs.every(r => r.length === LAG)).toBe(true)
  expect(ns.every(n => (n + 1) % every === 0)).toBe(true)
})

// A striker whose per-step rule calls a bag's `hit` every `every` steps, as a sword's step strikes
// what it lands on. That step is run on the copy like any other: from the press that makes the
// striker the browser's, the drawn striker moves on a step every frame and is the server's at the
// step the browser is at, never standing still on a strike. What the call wrote on the copy is
// dropped: the bag is drawn as the packets bring it, the server's `down` steps earlier.
const strikes: Scene = {
  world: {},
  plugins: ['scenemanager', 'player'],
  seats: 1,
  prefabs: { engine: { dt: 1 / 60 }, scenemanager: { out: {} }, player: { seat: 0 }, striker: { x: 0, vx: 120, n: 0, every: 10, touched: 0 }, bag: { count: 0 } },
  actors: [{ is: 'striker' }, { is: 'bag' }, { is: 'scenemanager' }],
}
const strikesHome = folder({
  'player.sim.ts': `export const player = { acts: { touch(_me, w, seat) { w.call(w.find('striker'), 'touch', seat) } } }\n`,
  'striker.sim.ts': `export const striker = {
  tick(me, dt, w) {
    me.data.n++
    me.data.x += me.data.vx * dt
    if (me.data.n % me.data.every === 0) w.call(w.find('bag'), 'hit', -1)
  },
  acts: { touch(me) { me.data.touched++ } },
}
`,
  'bag.sim.ts': `export const bag = { acts: { hit(me) { me.data.count++ } } }\n`,
})

// The striker and the bag each frame drew, and the server's after each step, from a run of 200
// frames, 3 steps each way, with a touch on 20.
async function struck(home: string, name: string, child: Scene) {
  const p = await played(home, name, child, { scenemanager: SCENEMANAGER, player: './player.sim.ts', striker: './striker.sim.ts', bag: './bag.sim.ts' }, { frames: 200, up: leg(LAG), down: leg(LAG), presses: [[20, 'touch']] })
  const of = (rows: Row[], kind: string) => rows.find(r => r.kind === kind)!.data
  const drawn: { striker: any; bag: any }[] = [], server: { striker: any; bag: any }[] = []
  for (let k = 0; k < 200; k++) {
    const rows = p.drawn(k)
    if (rows.length) drawn[k] = { striker: of(rows, 'striker'), bag: of(rows, 'bag') }
    server[k] = { striker: of(p.server(k)!, 'striker'), bag: of(p.server(k)!, 'bag') }
  }
  return { drawn, server }
}

test('the step where a rule calls a second row\'s act is run ahead, and the called row is drawn from the packet', async () => {
  const { drawn, server } = await struck(strikesHome, 'strikes', strikes)
  const from = 40
  const every = strikes.prefabs.striker.every
  expect(server[199].bag.count).toBe(Math.floor(199 / every))
  for (let k = from; k < 200; k++) {
    // A step on from the last frame's, strike or none, and the server's striker at that step.
    expect(drawn[k].striker.n).toBe(drawn[k - 1].striker.n + 1)
    expect(drawn[k].striker).toEqual(server[drawn[k].striker.n].striker)
    // The bag the packet carried.
    expect(drawn[k].bag).toEqual(server[k - LAG].bag)
  }
  // The frames round every strike were read.
  expect(Array.from({ length: 200 - from }, (_, i) => drawn[from + i].striker.n).filter(n => n % every === 0).length).toBeGreaterThan(10)
})

// A striker that stands at a bag, striking it every `every` steps until the third strike fells it,
// and then walks on through where it stood, as a sword's step fells a dummy and the body walks on.
// The steps here read the bag as the strikes run here left it, so from the step the striker fells it
// here it walks on, as the server's does, while the bag is drawn as the packets bring it.
const felling: Scene = {
  world: {},
  plugins: ['scenemanager', 'player'],
  seats: 1,
  prefabs: { engine: { dt: 1 / 60 }, scenemanager: { out: {} }, player: { seat: 0 }, striker: { x: 0, vx: 120, n: 0, every: 25, touched: 0 }, bag: { count: 0, down: false } },
  actors: [{ is: 'striker' }, { is: 'bag' }, { is: 'scenemanager' }],
}
const fellingHome = folder({
  'player.sim.ts': `export const player = { acts: { touch(_me, w, seat) { w.call(w.find('striker'), 'touch', seat) } } }\n`,
  'striker.sim.ts': `export const striker = {
  tick(me, dt, w) {
    me.data.n++
    const bag = w.find('bag')
    if (bag.data.down) me.data.x += me.data.vx * dt
    else if (me.data.n % me.data.every === 0) w.call(bag, 'hit', -1)
  },
  acts: { touch(me) { me.data.touched++ } },
}
`,
  'bag.sim.ts': `export const bag = { acts: { hit(me) { me.data.count++; me.data.down = me.data.count >= 3 } } }\n`,
})

test('a step here reads a row it called an act of as that act left it, which is still drawn from the packet', async () => {
  const { drawn, server } = await struck(fellingHome, 'felling', felling)
  const from = 40
  const felled = 3 * felling.prefabs.striker.every
  expect(server[199].bag).toEqual({ count: 3, down: true })
  expect(server[199].striker.x).toBeGreaterThan(0)
  for (let k = from; k < 200; k++) {
    // The server's striker at the step the browser is at, standing at the bag and walking on from the
    // step it fells it.
    expect(drawn[k].striker).toEqual(server[drawn[k].striker.n].striker)
    // The bag the packet carried.
    expect(drawn[k].bag).toEqual(server[k - LAG].bag)
  }
  // Frames drew the striker walking on while the bag drawn still stood.
  expect(Array.from({ length: 200 - from }, (_, i) => drawn[from + i]).filter(d => d.striker.n > felled && !d.bag.down).length).toBeGreaterThan(0)
})

// fire spawns, roll rolls the die, note writes the world: none is run on the copy. Each shows
// on the browser when the packet made after the server's step arrives: up + down + 1 later.
// The world is not in a packet, so a note never reaches any seat.
test('a spawn, a roll of the die and a world write are not run ahead', async () => {
  const g = await lanesRig({ frames: 160, presses: [[20, 'touch'], [60, 'fire'], [80, 'roll'], [100, 'note']] })
  expect(g.R.findIndex((_, k) => g.server(k, 'shot'))).toBe(64)
  expect(g.R.findIndex((_, k) => g.drawn(k, 'shot'))).toBe(67)
  expect(g.R.findIndex((_, k) => g.server(k, 'mover', 0).rolls === 1)).toBe(84)
  expect(g.R.findIndex((_, k) => g.drawn(k, 'mover', 0)?.rolls === 1)).toBe(87)
  expect(g.truth.world.notes).toBe(1)
  expect((g.client.plugins.wire.scene.world as any).notes).toBe(0)
})

// A kick writes only the crate's velocity, so it is drawn at the press; but the crate's own
// rule is empty and box3d's row is not the copy's, so the drawn position is the packet's: on
// every frame the crate moves, the drawn p[0] is the server's `down` steps earlier.
test('a physics body is drawn down steps late', async () => {
  const g = await lanesRig({ frames: 200, presses: [[20, 'touch'], [60, 'kick', W.kick]] })
  const p0 = (d: any) => d.pos[0]
  const moving = g.R.map((_, k) => k).filter(k => k >= 70 && k < 200 && g.server(k, 'crate', 0).vel[0] > 1)
  expect(g.R.findIndex((_, k) => g.drawn(k, 'crate', 0)?.vel[0] === W.kick)).toBe(60)
  expect(new Set(moving.map(k => g.late(k, 'crate', 0, p0)))).toEqual(new Set([LAG]))
})

// Seat 1's mover is driven on the addon. Seat 0 draws it from the packet: down steps late, and
// the miss while it moves is exactly down steps of its pace.
test('another seat\'s body is drawn down steps late', async () => {
  const g = await lanesRig({ frames: 300, presses: [[20, 'touch']] })
  const behind = Array.from({ length: 200 }, (_, i) => 100 + i).every(k => g.drawn(k, 'mover', 1).x === g.server(k - LAG, 'mover', 1).x)
  const peaks = new Set(g.windows(20, 300, 'mover', 1, x, 1e-9).map(w => r3(w.peak)))
  expect(behind).toBe(true)
  expect(peaks).toEqual(new Set([r3(W.pace * DT * LAG)]))
})

// One ledger both seats bump. Seat 0's bump is drawn at the press; seat 1's arrives with the
// packet. `count` misses by the bumps in flight: the peak of 3 is seat 1's three bumps on
// 130..132 not yet in a packet. Both sides end at 10.
test('a shared row two seats write', async () => {
  const bumps = new Set([62, 63, 90, 130, 131, 132])
  const other: Think = rows => bumps.has(rows.find(r => r.kind === 'clock' && r.data.seat === 1)!.data.t) ? ['bump'] : patrol(rows)
  const g = await lanesRig({ frames: 200, presses: [[20, 'touch'], [60, 'bump'], [61, 'bump'], [125, 'bump'], [128, 'bump']] }, other)
  const cw = g.windows(30, 200, 'ledger', undefined, (d: any) => d.count)
  expect(g.truth.rows.find(r => r.kind === 'ledger')!.data.count).toBe(10)
  expect(g.drawn(199, 'ledger').count).toBe(10)
  expect(cw[cw.length - 1].to).toBeLessThan(199)
  expect(Math.max(...cw.map(w => w.peak))).toBe(3)
})

// The knobs are read live: both legs are turned to 6 steps before frame 100 and to 1 before frame
// 200, after the server has sent that step's packet on the old leg. The browser's step is its own
// clock, placed by the earliest packets of the lanes' `world.player.window`, 1.99 seconds, 119.4
// frames, and the most steps ahead measured in them. At 6/6 the packets come 3 steps later than at
// 3/3, and the earlier ones still place the clock, so the browser stays on the server's step rather
// than falling 3 behind it. The hop on 150 is acked on 163, a round trip of 12, 6 ahead: the browser
// runs 3 ahead of the server until the 3/3 packets leave the window. At 1/1 the packets come 5 steps
// sooner, but the network keeps their order, as TCP does: step 200's packet left on the 6-step leg
// and arrives on 206, and those of steps 201 to 205, sent on the 1-step leg, wait behind it and come
// with it, which moves the clock at once on frame 206. The browser is 5 ahead until the 6 measured
// on 163 leaves the window, 120 frames later, and the 1 the hop on 250 measured is the steps ahead.
test('the round trip changes between presses', async () => {
  const up = leg(LAG), down = leg(LAG)
  const to = (steps: number) => () => { up.delay = down.delay = steps * STEP }
  const g = await lanesRig({
    frames: 300, up, down,
    presses: [[20, 'touch'], [40, 'hop', W.hop], [150, 'hop', W.hop], [250, 'hop', W.hop]],
    turns: [{ frame: 100, turn: to(6) }, { frame: 200, turn: to(1) }],
  })
  expect(g.lead(90)).toBe(0)
  expect(g.R.slice(100, 163).every((_, i) => g.lead(100 + i) === 0)).toBe(true)
  expect(g.lead(163)).toBe(3)
  expect(g.frames[206].took.map(t => t.n)).toEqual([200, 201, 202, 203, 204, 205])
  expect(g.R.findIndex((_, k) => k > 200 && g.lead(k) === 5)).toBe(206)
  expect(g.R.findIndex((_, k) => k > 206 && g.lead(k) === 0)).toBe(283)
})

// Jitter: every wait is the base plus up to 4 steps more, an even spread. Each ack re-measures the
// round trip, so the browser's step wanders against the server's.
test('jitter moves the browser\'s step around', async () => {
  const jittery = leg(LAG, { jitter: 4 * STEP })
  const hops = Array.from({ length: 57 }, (_, i): [number, string, number] => [30 + 10 * i, 'hop', i % 2 ? -W.hop : W.hop])
  const g = await lanesRig({ frames: 600, up: jittery, down: jittery, seed: 3, presses: [[20, 'touch'], ...hops] })
  const leads = new Set<number>()
  for (let k = 100; k < 600; k++) leads.add(g.lead(k))
  expect(leads.size).toBeGreaterThan(1)
})

// The browser's step is its own clock: packets place it and never move it a frame. The server runs
// in bursts (`BURST`), two steps at once and then none, so the packets come two on one frame and none
// on the next, at the same rate as one a step. From frame 100, long after the page has its lead, the
// browser still moves one step every frame, as it does on packets that come one a frame.
test('packets in bursts move the browser one step a frame', async () => {
  const hops = Array.from({ length: 13 }, (_, i): [number, string, number] => [30 + 30 * i, 'hop', i % 2 ? -W.hop : W.hop])
  const g = await lanesRig({ frames: 400, server: { grain: BURST }, presses: [[20, 'touch'], ...hops] })
  expectBursts(g.frames.slice(100))
  const moved = Array.from({ length: 300 }, (_, i) => g.at(100 + i) - g.at(99 + i))
  expect(new Set(moved)).toEqual(new Set([1]))
})

// A server slower than the page's clock, as one stepped by node's setInterval of a step's
// milliseconds is (58.76 a second where the scene says 60): its clock runs a sixtieth slow, 59 steps
// for 60 frames, so across the 600 frames from 100 it falls 10 steps behind. The browser falls back
// one step each time the server does, a frame it holds once the packets from before the server fell
// behind have left the window, and never moves two: the round trip is counted in the server's
// steps, so a press waiting on a step the server has not taken yet is no longer trip.
test('a server slower than the page costs a held frame per step it falls behind, never a jump', async () => {
  const hops = Array.from({ length: 23 }, (_, i): [number, string, number] => [30 + 30 * i, 'hop', i % 2 ? -W.hop : W.hop])
  const g = await lanesRig({ frames: 700, server: { grain: 0, ppm: -1e6 / 60 }, presses: [[20, 'touch'], ...hops] })
  expect(g.R[699].server.find(r => r.kind === 'clock')!.data.t - g.R[99].server.find(r => r.kind === 'clock')!.data.t).toBe(590)
  const moved = Array.from({ length: 600 }, (_, i) => g.at(100 + i) - g.at(99 + i))
  expect(new Set(moved)).toEqual(new Set([0, 1]))
  expect(moved.filter(m => m === 0).length).toBeLessThanOrEqual(11)
  expect(g.ahead(699)).toBeGreaterThanOrEqual(g.frames[699].lead)
})

// Loss: a lost press is drawn and never applied; it stays drawn until a later press's ack
// covers its number.
test('a lost press is drawn until a later press is acked', async () => {
  const lossy = leg(LAG, { loss: 0.2 })
  const pressed = Array.from({ length: 20 }, (_, i) => 40 + 20 * i)
  const g = await lanesRig({ frames: 500, up: lossy, down: lossy, seed: 2, presses: [[20, 'touch'], ...pressed.map((k): [number, string, number] => [k, 'hop', W.hop])] })
  const applied = (g.server(499, 'mover', 0).x - 100) / W.hop
  const ws = g.windows(30, 500, 'mover', 0, x)
  const longest = ws.reduce((a, w) => (w.to - w.from > a.to - a.from ? w : a), ws[0])
  expect(applied).toBeLessThan(pressed.length)
  expect(longest.to - longest.from + 1).toBeGreaterThan(4)
})

// A duplicated message is answered twice: the server runs the act twice and the browser is
// redrawn to the doubled row on the ack.
test('a duplicated press runs twice on the server', async () => {
  const twice = leg(LAG, { dup: 1 })
  const g = await lanesRig({ frames: 120, up: twice, down: twice, presses: [[20, 'touch'], [60, 'hop', W.hop]] })
  expect(g.server(119, 'mover', 0).x).toBe(100 + 2 * W.hop)
  expect(g.drawn(119, 'mover', 0).x).toBe(100 + 2 * W.hop)
})

// Reorder up: two presses in the other order on the server leave it in a state neither side
// asked for — the stop is applied first. Each wait is 3 steps and up to 2 more, and a reorder lets
// an item overtake the one sent before it, so the stop, sent a frame after the move, passes it on
// this seed's rolls, not on every press: the page says it got each packet up the same way, and
// those rolls come between. Reorder down: a packet taken after a newer one moves the browser's step
// back.
test('reordered presses and packets', async () => {
  const mixed = () => leg(LAG, { jitter: 2 * STEP, reorder: 0.3 })
  const g = await lanesRig({ frames: 120, up: mixed(), down: mixed(), seed: 1, presses: [[20, 'touch'], [60, 'move', W.speed], [61, 'move', 0]] })
  const hops = Array.from({ length: 37 }, (_, i): [number, string, number] => [30 + 10 * i, 'hop', i % 2 ? -W.hop : W.hop])
  const h = await lanesRig({ frames: 400, up: mixed(), down: mixed(), seed: 1, presses: [[20, 'touch'], ...hops] })
  const mine = g.truth.rows.find(r => r.kind === 'player' && r.data.seat === 0)!.id
  expect(g.truth.log.filter(e => e.msg.id === mine && e.msg.action === 'move').map(e => e.msg.args)).toEqual([[0], [W.speed]])
  expect(g.server(119, 'mover', 0).vx).toBe(W.speed)
  expect(g.drawn(119, 'mover', 0).vx).toBe(W.speed)
  expect(h.R.filter((r, k) => k > 0 && r.n < h.R[k - 1].n).length).toBeGreaterThan(0)
})

// A press every frame for 3000 frames from the frame after the touch, and two in one frame. The miss
// is exactly the hops in flight, the frame cost stays flat, and the drawn body never runs away from
// the server's.
test('a press every frame for 3000 frames', async () => {
  const sweeping = sweep(0)
  const think: Think = rows => (rows.some(r => r.kind === 'clock' && r.data.seat === 0 && r.data.touched > 0) ? sweeping(rows) : undefined)
  const g = await lanesRig({ frames: 3000, cost: true, think, presses: [[20, 'touch'], [1000, 'hop', W.hop]] })
  const ms = g.frames.map(f => f.cost!)
  const misses = new Set<number>()
  for (let k = 100; k < 3000; k++) misses.add(r3(g.miss(k, 'mover', 0, x)!))
  const early = ms.slice(100, 600).reduce((a, b) => a + b, 0) / 500
  const lateCost = ms.slice(2500).reduce((a, b) => a + b, 0) / 500
  // A hop sent on every frame from 21 to 2999, and the one on 1000.
  expect(g.records.filter(r => r.type === 'message' && r.action === 'hop').length).toBe(2979 + 1)
  expect([...misses].every(m => Math.abs(m) <= W.stride * (LAG + 1) + W.hop)).toBe(true)
  expect(Math.abs(g.miss(2999, 'mover', 0, x)!)).toBeLessThanOrEqual(W.stride * (LAG + 1))
  expect(Math.abs(g.drawn(1000, 'mover', 0).x - g.drawn(999, 'mover', 0).x)).toBe(W.stride + W.hop)
  expect(lateCost).toBeLessThan(early * 3)
})

// The page has no client, and so no player to press, until the first packet: `view` makes the
// client from it, `down` steps after the manager's first step. The first press the page can make
// is on the frame after, and it is drawn there and applied on the server `up` steps later. The
// page presses it the first time it is asked with a client, and the frame it went on is read off
// when the page sent it.
test('the page gets its player with the first packet, and its first press is drawn at the press', async () => {
  let pressed = false
  const g = await lanesRig({ frames: 60, think: () => (pressed ? undefined : ((pressed = true), ['hop', W.hop])) })
  const sent = g.records.filter((r): r is MessageRecord => r.type === 'message' && r.action === 'hop')
  expect(sent.length).toBe(1)
  const first = g.frames.findIndex(f => f.t === sent[0].sent)
  const firstPacket = g.R.findIndex(r => r.drawn.length > 0)
  expect(firstPacket).toBe(LAG + 1)
  expect(first).toBe(firstPacket + 1)
  expect(g.R.findIndex((_, k) => g.drawn(k, 'mover', 0)?.x === 100 + W.hop)).toBe(first)
  expect(g.R.findIndex((_, k) => g.server(k, 'mover', 0).x === 100 + W.hop)).toBe(first + LAG + 1)
})

// ---------------------------------------------------------------- the mouse, the keys and gamepads

// A range of a camera and nothing else, and one page on it: no actor binds a key, so the only
// presses are the test's. Each test binds its own table on the page's player plugin. The seat's
// `aim` and `fire` do nothing; the messages are what is measured, and every one the mouse, a key or a
// gamepad makes is in the range's log as its action and its args.
const range: Scene = {
  world: {},
  plugins: ['scenemanager', 'player', 'render3d'],
  seats: 1,
  prefabs: {
    engine: { dt: DT, width: 800, height: 600 },
    scenemanager: { out: {} },
    render3d: { camera: { at: [0, 2, 10], look: [0, 0, 0], fov: 50, near: 0.1, far: 100 } },
    player: { seat: 0 },
  },
  actors: [{ is: 'scenemanager' }],
}
const rangeHome = folder({ 'player.sim.ts': 'export const player = { acts: { aim() {}, fire() {} } }\n' })
const rangeTop = managed(rangeHome, 'range', range, { scenemanager: SCENEMANAGER, player: './player.sim.ts' })

// The range booted, and a page on it. `player` is written over the page's player prefab, as a scene
// file would give it.
async function rangeRig(player: Record<string, unknown> = {}) {
  const truth = boot(structuredClone(rangeTop), { scenemanager })
  const shots = (await load(truth, rangeHome)).get('range')!
  const row = manager(truth)
  const wire = link(loopback(accept(row)))
  // The range is the one scene, and the seat never leaves it, so this page is the one client the
  // scenemanager's `view` would make, made here and handed every packet.
  const [[name]] = entries(row)
  const s = structuredClone(scene(row, name).scene) as Scene
  const me = await client({ ...s, prefabs: { ...s.prefabs, player: { ...s.prefabs.player, ...player } } }, rangeHome)
  // Mounted, as the view mounts a client, on the visit the first envelope names.
  wire.hear(d => {
    if (!me.plugins.scenemanager.link) me.plugins.scenemanager.mount(wire, d.scene, d.seat)
    me.plugins.scenemanager.hand(d.packet)
  })
  me.plugins.render3d.canvas = { addEventListener: () => {}, style: {}, width: 800, height: 600 }
  const frames = async (k: number) => { for (let i = 0; i < k; i++) { truth.step(DT); pass(DT); await me.frame() } }
  const sent = (action: string) => shots.log.filter(l => l.msg.action === action).map(l => l.msg.args)
  await frames(5)
  return { player: me.plugins.player, plugins: me.plugins, frames, sent }
}

const canvas = { requestPointerLock() { page.pointerLockElement = canvas } }
const click = { target: canvas, clientX: 0, clientY: 0, offsetX: 0, offsetY: 0 }

test('the mouse sends nothing until a click takes the pointer lock, then one message a frame with the pixels it moved', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ pointer: (dx: number, dy: number) => ['aim', dx, dy] })
  on.get('mousemove')!({ movementX: 7, movementY: 3 })
  await frames(2)
  expect(sent('aim')).toEqual([])
  on.get('click')!(click)
  expect(page.pointerLockElement).toBe(canvas)
  on.get('mousemove')!({ movementX: 7, movementY: 3 })
  on.get('mousemove')!({ movementX: 5, movementY: -1 })
  await frames(2)
  expect(sent('aim')).toEqual([[12, 2]])
  await frames(3)
  expect(sent('aim')).toEqual([[12, 2]])
  player.unbind()
})

// Node as it is, with no `document` (the loader lends node one only while a model decodes), so
// nothing holds the pointer lock. A click still asks the element for the
// lock, a move sends nothing, and letting go asks the page for nothing.
test('with no document nothing holds the pointer lock: a click asks for it, a move sends nothing, and unbind lets go', async () => {
  const { player, frames, sent } = await rangeRig()
  const g = globalThis as { document?: unknown }
  const was = g.document
  delete g.document
  try {
    let asked = 0
    player.bind({ pointer: (dx: number, dy: number) => ['aim', dx, dy] })
    on.get('click')!({ ...click, target: { requestPointerLock() { asked++ } } })
    on.get('mousemove')!({ movementX: 7, movementY: 3 })
    await frames(2)
    expect(asked).toBe(1)
    expect(sent('aim')).toEqual([])
    expect(() => player.unbind()).not.toThrow()
  } finally {
    g.document = was
  }
})

// The loader lends node a `document` that decodes images and has no pointer lock, while a model
// decodes; anything the page runs meanwhile sees it. The glTF loader here stands in for three's: the
// moment it is handed the model, the player lets go of a lock a click asked for.
test('while the loader lends node a document to decode a model, the player lets go of the pointer lock without calling what it lacks', async () => {
  const { player } = await rangeRig()
  const g = globalThis as { document?: unknown }
  const was = g.document
  delete g.document
  const dir = mkdtempSync(path(tmpdir(), 'player-model-'))
  try {
    writeFileSync(path(dir, 'x.glb'), 'glb')
    player.bind({ pointer: (dx: number, dy: number) => ['aim', dx, dy] })
    on.get('click')!({ ...click, target: { requestPointerLock() {} } })
    let seen: unknown, threw: unknown
    class Decoding { parse(_b: unknown, _p: string, ok: (g: unknown) => void) { seen = g.document; try { player.unbind() } catch (e) { threw = e } ok({ scene: {}, animations: [] }) } }
    const me = loader()
    me.tick({ wire: { rows: [{ id: 1, kind: 'loader', data: {} }], scene: { world: { loader: { assets: { x: { type: 'model', url: '/' + relative(process.cwd(), path(dir, 'x.glb')) } } } } } }, render3d: { GLTFLoader: Decoding } } as any)
    await me.load('x')
    expect(seen).toMatchObject({ createElementNS: expect.any(Function) })
    expect(threw).toBeUndefined()
    expect(g.document).toBeUndefined()
  } finally {
    rmSync(dir, { recursive: true })
    g.document = was
  }
})

test('a mouse button is a key: held while it is down, and sent from press the moment it goes down', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ press: { Mouse0: ['fire'] }, every: (held: (key: string) => boolean) => (held('Mouse2') ? ['aim', 0, 0.01] : undefined) })
  on.get('mousedown')!({ button: 0 })
  on.get('mouseup')!({ button: 0 })
  on.get('mousedown')!({ button: 2 })
  await frames(3)
  on.get('mouseup')!({ button: 2 })
  await frames(3)
  expect(sent('fire')).toEqual([[]])
  expect(sent('aim')).toEqual([[0, 0.01], [0, 0.01], [0, 0.01]])
  player.unbind()
})

test('a hold is one button of any of its keys: 1 sent when the first goes down, 0 when the last comes up', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ hold: [{ keys: ['Mouse0', 'Control'], send: (v: number) => ['aim', v, 0] }] })
  on.get('mousedown')!({ button: 0 })
  on.get('keydown')!(key('ControlLeft'))
  await frames(2)
  on.get('mouseup')!({ button: 0 })
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0]])
  on.get('keyup')!(key('ControlLeft'))
  on.get('keydown')!(key('ControlLeft'))
  on.get('keyup')!(key('ControlLeft'))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [1, 0], [0, 0]])
  player.unbind()
})

test('a stick is four keys sent as one way, x and y, whenever either changes, and any key of a list holds its side', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ stick: [{ keys: [['ArrowLeft', 'a'], ['ArrowRight', 'd'], ['ArrowUp', 'w'], ['ArrowDown', 's']], send: (x: number, y: number) => ['aim', x, y] }] })
  on.get('keydown')!(key('KeyD'))
  on.get('keydown')!(key('ArrowUp'))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [1, -1]])
  on.get('keydown')!(key('ArrowRight'))
  on.get('keyup')!(key('KeyD'))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [1, -1]])
  on.get('keydown')!(key('KeyA'))
  on.get('keyup')!(key('ArrowUp'))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [1, -1], [0, -1], [0, 0]])
  player.unbind()
})

test('a key press gives a function runs it on the page the moment the key goes down, and sends nothing', async () => {
  const { player, frames, sent } = await rangeRig()
  let flips = 0
  player.bind({ press: { h: () => { flips++ }, f: ['fire'] } })
  on.get('keydown')!(key('KeyH'))
  expect(flips).toBe(1)
  on.get('keyup')!(key('KeyH'))
  on.get('keydown')!(key('KeyF'))
  await frames(2)
  expect(flips).toBe(1)
  expect(sent('fire')).toEqual([[]])
  expect(sent('h')).toEqual([])
  player.unbind()
})

test('a key release gives a function runs it when the key comes up, its repeats press nothing, and letting go of every key releases it', async () => {
  const { player } = await rangeRig()
  const heard: string[] = []
  player.bind({ press: { a: () => heard.push('down') }, release: { a: () => heard.push('up') } })
  on.get('keydown')!(key('KeyA'))
  on.get('keydown')!(key('KeyA'))
  on.get('keyup')!(key('KeyA'))
  expect(heard).toEqual(['down', 'up'])
  on.get('keydown')!(key('KeyA'))
  player.unbind()
  expect(heard).toEqual(['down', 'up', 'down', 'up'])
})

test('a key that goes down in a field of the page is the field\'s: nothing is sent and nothing is run', async () => {
  const { player, frames, sent } = await rangeRig()
  let ran = 0
  player.bind({ press: { f: ['fire'], h: () => { ran++ } } })
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    for (const code of ['KeyF', 'KeyH']) {
      on.get('keydown')!(key(code, { target }))
      on.get('keyup')!(key(code, { target }))
    }
  }
  await frames(2)
  expect(sent('fire')).toEqual([])
  expect(ran).toBe(0)
  on.get('keydown')!(key('KeyF', { target: { tagName: 'CANVAS' } }))
  on.get('keydown')!(key('KeyH', { target: { tagName: 'CANVAS' } }))
  await frames(2)
  expect(sent('fire')).toEqual([[]])
  expect(ran).toBe(1)
  player.unbind()
})

test('an axis key may be a list of keys, any of which holds its side', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ axis: [{ keys: [['q', 'Home'], 'e'], send: (v: number) => ['aim', v, 0] }] })
  on.get('keydown')!(key('Home'))
  on.get('keydown')!(key('KeyQ'))
  on.get('keyup')!(key('Home'))
  await frames(2)
  expect(sent('aim')).toEqual([[-1, 0]])
  on.get('keyup')!(key('KeyQ'))
  await frames(2)
  expect(sent('aim')).toEqual([[-1, 0], [0, 0]])
  player.unbind()
})

test('a table without pointer takes no pointer lock, and unbind gives back the lock one with pointer took', async () => {
  const { player } = await rangeRig()
  player.bind({ click: () => undefined })
  on.get('click')!(click)
  expect(page.pointerLockElement).toBe(null)
  player.bind({ pointer: () => undefined })
  on.get('click')!(click)
  expect(page.pointerLockElement).toBe(canvas)
  player.unbind()
  expect(page.pointerLockElement).toBe(null)
})

// A letter is one key whether Shift is down or not: the page types it in capitals while Shift is
// held, and the table names it in lower case, so a key held across Shift's press or release is let
// go when it comes up either way.
test('a letter is one key with Shift or without: a table names it in lower case', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ axis: [{ keys: ['s', 'w'], send: (v: number) => ['aim', v, 0] }], press: { f: ['fire'] } })
  on.get('keydown')!(key('ShiftLeft'))
  on.get('keydown')!(key('KeyW', { key: 'W' }))
  on.get('keydown')!(key('KeyF', { key: 'F' }))
  on.get('keyup')!(key('ShiftLeft'))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0]])
  expect(sent('fire')).toEqual([[]])
  on.get('keyup')!(key('KeyW'))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0]])
  on.get('keydown')!(key('KeyS'))
  on.get('keydown')!(key('ShiftLeft'))
  on.get('keyup')!(key('KeyS', { key: 'S' }))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [-1, 0], [0, 0]])
  player.unbind()
})

// A digit or a punctuation key types another character under Shift: `1` goes down, and `!` comes up
// with Shift held. The key is its place on the keyboard, so it is let go all the same, and one
// pressed under Shift is the key the table names.
test('a digit or punctuation key let go under Shift is let go, and one pressed under Shift is held', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ axis: [{ keys: ['1', '['], send: (v: number) => ['aim', v, 0] }], press: { '/': ['fire'] } })
  on.get('keydown')!(key('Digit1'))
  on.get('keydown')!(key('ShiftLeft'))
  on.get('keyup')!(key('Digit1', { key: '!' }))
  await frames(2)
  expect(sent('aim')).toEqual([[-1, 0], [0, 0]])
  on.get('keydown')!(key('BracketLeft', { key: '{' }))
  on.get('keydown')!(key('Slash', { key: '?' }))
  on.get('keyup')!(key('ShiftLeft'))
  on.get('keyup')!(key('Slash'))
  await frames(2)
  expect(sent('aim')).toEqual([[-1, 0], [0, 0], [1, 0]])
  expect(sent('fire')).toEqual([[]])
  on.get('keyup')!(key('BracketLeft'))
  await frames(2)
  expect(sent('aim')).toEqual([[-1, 0], [0, 0], [1, 0], [0, 0]])
  player.unbind()
})

test('a key is named by its place: what it types on a US keyboard without Shift, one name for both sides of a modifier; keyCode runs it backwards', () => {
  const names = {
    KeyA: 'a', KeyZ: 'z', Digit0: '0', Digit9: '9', Numpad0: '0', Numpad7: '7', Space: ' ',
    ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Control', ControlRight: 'Control', AltLeft: 'Alt', AltRight: 'Alt',
    MetaLeft: 'Meta', MetaRight: 'Meta', OSLeft: 'Meta', OSRight: 'Meta',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`',
    Comma: ',', Period: '.', Slash: '/',
    NumpadDecimal: '.', NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadEnter: 'Enter', NumpadEqual: '=', NumpadComma: ',',
    ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', Escape: 'Escape', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', F1: 'F1', F12: 'F12', Home: 'Home', PageDown: 'PageDown', CapsLock: 'CapsLock', IntlBackslash: 'IntlBackslash',
  }
  for (const [code, name] of Object.entries(names)) expect([code, keyName(code)]).toEqual([code, name])
  // Run backwards, a name is the main keyboard's key, and the left of a pair.
  const codes = { a: 'KeyA', W: 'KeyW', '0': 'Digit0', ' ': 'Space', Shift: 'ShiftLeft', Control: 'ControlLeft', Alt: 'AltLeft', Meta: 'MetaLeft', '-': 'Minus', '=': 'Equal', '.': 'Period', '/': 'Slash', ',': 'Comma', '\\': 'Backslash', "'": 'Quote', '[': 'BracketLeft', Enter: 'Enter', Escape: 'Escape', ArrowDown: 'ArrowDown', Tab: 'Tab', '+': '+', '*': '*' }
  for (const [name, code] of Object.entries(codes)) expect([name, keyCode(name)]).toEqual([name, code])
  for (const name of Object.values(names)) expect(keyName(keyCode(name))).toBe(name)
})

// An on-screen keyboard's key has no place, and its `code` is empty: it is named by what it typed.
test('a key with no place on the keyboard is named by what it typed, a letter in lower case', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ axis: [{ keys: ['s', 'w'], send: (v: number) => ['aim', v, 0] }] })
  on.get('keydown')!({ code: '', key: 'W' })
  await frames(2)
  on.get('keyup')!({ code: '', key: 'w' })
  await frames(2)
  on.get('keydown')!({ code: 'Unidentified', key: 's' })
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [-1, 0]])
  player.unbind()
})

// A click on a canvas render2d's `fit` draws at three CSS pixels a canvas pixel: the page says
// where in CSS pixels, and `click` and the UI hear canvas pixels.
test('a click\'s page pixels reach `click` and the UI divided by the renderer\'s scale', async () => {
  const { player, plugins, frames, sent } = await rangeRig()
  const hits: number[][] = []
  plugins.ui = { hit: (x: number, y: number) => { hits.push([x, y]); return false }, took: () => false, modal: () => undefined }
  Object.defineProperty(plugins.render3d, 'scale', { value: 3, configurable: true })
  try {
    player.bind({ click: (x: number, y: number) => ['aim', x, y] })
    on.get('click')!({ ...click, offsetX: 450, offsetY: 30 })
    await frames(2)
    expect(sent('aim')).toEqual([[150, 10]])
    expect(hits).toEqual([[150, 10]])
  } finally {
    delete plugins.render3d.scale
    player.unbind()
  }
})

// ---------------------------------------------------------------- gamepads

// The gamepads `navigator.getGamepads` hands back, as the browser's: a list with a hole where a
// gamepad was unplugged, each with its buttons in the standard mapping's order, its axes, and
// `connected`.
type Pad = { id?: string; connected: boolean; buttons: { pressed: boolean; value: number }[]; axes: number[] }
const gamepads: (Pad | null)[] = []
const gamepad = () => {
  const p: Pad = { connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }
  gamepads.push(p)
  return p
}
const push = (p: Pad, i: number, down: boolean) => { p.buttons[i] = { pressed: down, value: down ? 1 : 0 } }
const plugged = async (f: () => Promise<void>) => {
  gamepads.length = 0
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { getGamepads: () => gamepads }))
  try {
    await f()
  } finally {
    vi.unstubAllGlobals()
    gamepads.length = 0
  }
}

test('a gamepad button is a key: sent from press the frame it goes down, once, held while it is down, and heard by every', () => plugged(async () => {
  const { player, frames, sent } = await rangeRig()
  gamepads.push(null)
  const pad = gamepad()
  player.bind({
    press: { Pad0: ['fire'] },
    hold: [{ keys: ['Pad7', 'Control'], send: (v: number) => ['aim', v, 0] }],
    every: (held: (key: string) => boolean) => (held('Pad3') ? ['aim', 0, 9] : undefined),
  })
  push(pad, 0, true)
  await frames(3)
  expect(sent('fire')).toEqual([[]])
  push(pad, 0, false)
  await frames(1)
  push(pad, 0, true)
  await frames(1)
  expect(sent('fire')).toEqual([[], []])
  push(pad, 7, true)
  await frames(2)
  on.get('keydown')!(key('ControlLeft'))
  push(pad, 7, false)
  await frames(2)
  on.get('keyup')!(key('ControlLeft'))
  push(pad, 3, true)
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [0, 9], [0, 9]])
  // A gamepad unplugged lets go of what it held.
  pad.connected = false
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [0, 9], [0, 9]])
  player.unbind()
}))

// Two gamepads, and a d-pad and the left stick beside the keys: any of them holds a side.
test('the left stick past the dead zone and the d-pad hold a side of a stick as its keys do, on any gamepad connected', () => plugged(async () => {
  const { player, frames, sent } = await rangeRig({ deadzone: 0.5 })
  const one = gamepad(), two = gamepad()
  player.bind({ stick: [{ keys: [['ArrowLeft', 'a', 'Pad14', 'PadStickLeft'], ['ArrowRight', 'd', 'Pad15', 'PadStickRight'], ['ArrowUp', 'w', 'Pad12', 'PadStickUp'], ['ArrowDown', 's', 'Pad13', 'PadStickDown']], send: (x: number, y: number) => ['aim', x, y] }] })
  one.axes = [-0.4, 0.2]
  await frames(2)
  expect(sent('aim')).toEqual([])
  one.axes = [-0.6, 0.2]
  await frames(2)
  one.axes = [0.7, 0.9]
  await frames(2)
  // Pushed right on one and up on the other's d-pad: right and up together.
  one.axes = [0.7, 0]
  push(two, 12, true)
  await frames(2)
  one.axes = [0, 0]
  await frames(2)
  push(two, 12, false)
  await frames(2)
  expect(sent('aim')).toEqual([[-1, 0], [1, 1], [1, -1], [0, -1], [0, 0]])
  // The d-pad and the keys hold one side together: it is let go when the last of them is.
  push(one, 14, true)
  on.get('keydown')!(key('KeyA'))
  await frames(2)
  push(one, 14, false)
  await frames(2)
  on.get('keyup')!(key('KeyA'))
  await frames(2)
  expect(sent('aim')).toEqual([[-1, 0], [1, 1], [1, -1], [0, -1], [0, 0], [-1, 0], [0, 0]])
  player.unbind()
}))

test('a table that binds the left stick throws when the player prefab gives no dead zone, and without one the stick holds nothing', () => plugged(async () => {
  const { player, frames, sent } = await rangeRig()
  const pad = gamepad()
  pad.axes = [-1, 0]
  player.bind({ every: (held: (key: string) => boolean) => (held('PadStickLeft') ? ['aim', -1, 0] : undefined), press: { Pad0: ['fire'] } })
  push(pad, 0, true)
  await frames(2)
  expect(sent('aim')).toEqual([])
  expect(sent('fire')).toEqual([[]])
  player.bind({ axis: [{ keys: ['PadStickLeft', 'PadStickRight'], send: (v: number) => ['aim', v, 0] }] })
  await expect(frames(1)).rejects.toThrow('the player table binds the left stick, and the player prefab has no deadzone')
  player.unbind()
}))

// While a modal has the input, no gamepad key goes down; one held as it came up is held only when
// it is pressed again, as a key is.
test('while a modal has the input a gamepad button is not the game\'s, and one held through it is held again only on a new press', () => plugged(async () => {
  const { player, plugins, frames, sent } = await rangeRig()
  let up: string | undefined
  plugins.ui = { hit: () => false, took: () => false, modal: () => up }
  const pad = gamepad()
  player.bind({ hold: [{ keys: ['Pad1'], send: (v: number) => ['aim', v, 0] }], press: { Pad9: ['fire'] } })
  push(pad, 1, true)
  await frames(2)
  up = 'pause'
  await frames(2)
  push(pad, 9, true)
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0]])
  expect(sent('fire')).toEqual([])
  up = undefined
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0]])
  push(pad, 1, false)
  push(pad, 9, false)
  await frames(1)
  push(pad, 1, true)
  push(pad, 9, true)
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [1, 0]])
  expect(sent('fire')).toEqual([[]])
  player.unbind()
}))

// Tab moves the focus off the page and the right button opens a menu, unless the page cancels them.
test('a key or a mouse button the table binds has its browser default cancelled, and one it does not bind keeps it', async () => {
  const { player } = await rangeRig()
  cancelled.clear()
  player.bind({ press: { Tab: ['fire'] }, stick: [{ keys: ['a', 'd', 'w', 's'], send: (x: number, y: number) => ['aim', x, y] }] })
  on.get('keydown')!(key('Tab'))
  on.get('keydown')!(key('KeyD', { key: 'D' }))
  on.get('keydown')!(key('KeyK'))
  on.get('contextmenu')!({})
  expect(cancelled.get('keydown')).toBe(2)
  expect(cancelled.get('contextmenu')).toBeUndefined()
  player.bind({ hold: [{ keys: ['Mouse2'], send: (v: number) => ['aim', v, 0] }] })
  on.get('contextmenu')!({})
  on.get('mousedown')!({ button: 2 })
  expect(cancelled.get('contextmenu')).toBe(1)
  expect(cancelled.get('mousedown')).toBe(1)
  player.unbind()
})

// Control, Command or Alt held is a browser shortcut: zoom on Control =, find on Control F.
test('a bound key keeps its browser default while Control, Command or Alt is down', async () => {
  const { player, frames, sent } = await rangeRig()
  cancelled.clear()
  player.bind({ press: { f: ['fire'], '=': ['fire'] } })
  on.get('keydown')!(key('KeyF', { ctrlKey: true }))
  on.get('keyup')!(key('KeyF'))
  on.get('keydown')!(key('Equal', { metaKey: true }))
  on.get('keyup')!(key('Equal'))
  on.get('keydown')!(key('KeyF', { key: 'F', altKey: true }))
  on.get('keyup')!(key('KeyF'))
  expect(cancelled.get('keydown')).toBeUndefined()
  on.get('mousedown')!({ button: 2, ctrlKey: true })
  expect(cancelled.get('mousedown')).toBeUndefined()
  on.get('keydown')!(key('KeyF'))
  expect(cancelled.get('keydown')).toBe(1)
  await frames(2)
  expect(sent('fire').length).toBe(4)
  player.unbind()
})

// A drag is the mouse moved with a key held, the right button say, while the page holds no pointer
// lock: the pixels it moved across and down are added up and sent once a frame. Once a click has
// taken the lock, the movement is `pointer`'s and the drag sends nothing.
test('a drag sends the pixels the mouse moved while its key is held and the page holds no pointer lock, once a frame', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ drag: { key: 'Mouse2', send: (dx: number, dy: number) => ['aim', dx, dy] }, pointer: (dx: number) => ['aim', dx, 99] })
  on.get('mousemove')!({ movementX: 4, movementY: 1 })
  await frames(1)
  on.get('mousedown')!({ button: 2 })
  on.get('mousemove')!({ movementX: 4, movementY: 1 })
  on.get('mousemove')!({ movementX: 3, movementY: -2 })
  await frames(2)
  expect(sent('aim')).toEqual([[7, -1]])
  on.get('mouseup')!({ button: 2 })
  on.get('mousemove')!({ movementX: 5, movementY: 5 })
  await frames(2)
  expect(sent('aim')).toEqual([[7, -1]])
  on.get('click')!(click)
  on.get('mousedown')!({ button: 2 })
  on.get('mousemove')!({ movementX: 2, movementY: 0 })
  await frames(2)
  expect(sent('aim')).toEqual([[7, -1], [2, 99]])
  player.unbind()
})

// Hover is where the pointer is, asked once a frame it moved: over the UI or off the page it is over
// nothing. A city's tool draws the cell under it from it.
test('hover is asked once a frame the pointer moved, with where it is, and with null over the UI or off the page', async () => {
  const { player, plugins, frames, sent } = await rangeRig()
  let overUi = false
  plugins.ui = { hit: () => overUi, took: () => false, modal: () => undefined }
  try {
    // The range's player has one act that takes two numbers, `aim`: null is sent as [-1, -1].
    player.bind({ hover: (at: [number, number] | null) => ['aim', ...(at ?? [-1, -1])] })
    on.get('mousemove')!({ offsetX: 10, offsetY: 20 })
    on.get('mousemove')!({ offsetX: 30, offsetY: 40 })
    await frames(2)
    expect(sent('aim')).toEqual([[30, 40]])
    overUi = true
    on.get('mousemove')!({ offsetX: 31, offsetY: 40 })
    await frames(1)
    overUi = false
    on.get('mouseout')!({ relatedTarget: {} })
    await frames(1)
    on.get('mouseout')!({ relatedTarget: null })
    await frames(1)
    expect(sent('aim')).toEqual([[30, 40], [-1, -1], [-1, -1]])
  } finally {
    player.unbind()
  }
})

// A stroke is a drag with where it began and ended: a road laid from the cell pressed to the cell
// let go, the cells between drawn as the mouse moves. A press on the UI is the UI's and begins none;
// a modal letting every key go cancels one.
test('a stroke asks start where its button went down, move once a frame it moved, and end where it came up; a modal cancels it', async () => {
  const { player, plugins, frames, sent } = await rangeRig()
  let overUi = false, modal: object | undefined
  plugins.ui = { hit: () => overUi, took: () => false, modal: () => modal }
  try {
    // The range's player has one act that takes two numbers, `aim`: each call is told by a thousands
    // mark on its y, start 1000, move 2000, end 3000 and cancel 4000.
    player.bind({ stroke: { key: 'Mouse0', start: (x: number, y: number) => ['aim', x, 1000 + y], move: (x: number, y: number) => ['aim', x, 2000 + y], end: (x: number, y: number) => ['aim', x, 3000 + y], cancel: () => ['aim', 0, 4000] } })
    const calls = (mark: number) => sent('aim').filter(([, y]) => Math.floor((y as number) / 1000) === mark).map(([x, y]) => [x, (y as number) - mark * 1000])
    on.get('mousemove')!({ offsetX: 1, offsetY: 1 })
    await frames(1)
    expect(sent('aim')).toEqual([])
    on.get('mousedown')!({ button: 0, offsetX: 1, offsetY: 2 })
    on.get('mousemove')!({ offsetX: 3, offsetY: 4 })
    on.get('mousemove')!({ offsetX: 5, offsetY: 6 })
    await frames(1)
    await frames(1)
    on.get('mouseup')!({ button: 0, offsetX: 7, offsetY: 8 })
    on.get('mousemove')!({ offsetX: 9, offsetY: 9 })
    await frames(2)
    expect([calls(1), calls(2), calls(3)]).toEqual([[[1, 2]], [[5, 6]], [[7, 8]]])
    // Another button, or a press on the UI, begins no stroke.
    on.get('mousedown')!({ button: 2, offsetX: 1, offsetY: 1 })
    on.get('mouseup')!({ button: 2, offsetX: 1, offsetY: 1 })
    overUi = true
    on.get('mousedown')!({ button: 0, offsetX: 1, offsetY: 1 })
    on.get('mouseup')!({ button: 0, offsetX: 1, offsetY: 1 })
    overUi = false
    await frames(2)
    expect([calls(1).length, calls(3).length]).toEqual([1, 1])
    // A modal lets it go: cancel, and its release then ends nothing.
    on.get('mousedown')!({ button: 0, offsetX: 2, offsetY: 2 })
    await frames(1)
    modal = {}
    await frames(1)
    modal = undefined
    on.get('mouseup')!({ button: 0, offsetX: 3, offsetY: 3 })
    await frames(2)
    expect([calls(1), calls(3), calls(4)]).toEqual([[[1, 2], [2, 2]], [[7, 8]], [[0, 0]]])
  } finally {
    player.unbind()
  }
})

// A locked key is the game's only while the page holds the pointer lock: a strike on the left button
// and a block on the right, which without the lock take the lock and drag the camera. The lock lost
// while one is held lets it go, as its release would.
test('a locked key is heard only while the page holds the pointer lock, and losing the lock lets it go', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ press: { Mouse0: ['fire'] }, hold: [{ keys: ['Mouse2'], send: (v: number) => ['aim', v, 0] }], locked: ['Mouse0', 'Mouse2'], pointer: () => undefined })
  on.get('mousedown')!({ button: 0 })
  on.get('mousedown')!({ button: 2 })
  await frames(2)
  expect(sent('fire')).toEqual([])
  expect(sent('aim')).toEqual([])
  on.get('mouseup')!({ button: 0 })
  on.get('mouseup')!({ button: 2 })
  on.get('click')!(click)
  expect(page.pointerLockElement).toBe(canvas)
  on.get('mousedown')!({ button: 0 })
  on.get('mousedown')!({ button: 2 })
  await frames(2)
  expect(sent('fire')).toEqual([[]])
  expect(sent('aim')).toEqual([[1, 0]])
  page.pointerLockElement = null
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0]])
  // The lock back with the button still down: not held until it is pressed again.
  on.get('click')!(click)
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0]])
  on.get('mouseup')!({ button: 2 })
  on.get('mousedown')!({ button: 2 })
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [1, 0]])
  on.get('mouseup')!({ button: 2 })
  on.get('mouseup')!({ button: 0 })
  // A button already down when a click takes the lock is not held.
  page.pointerLockElement = null
  await frames(1)
  on.get('mousedown')!({ button: 2 })
  on.get('click')!(click)
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [1, 0], [0, 0]])
  player.unbind()
})

// Losing the lock (Escape does it in a browser) lets go of every key held, and a key still down is
// held again only when it is pressed again.
test('every key held is let go the frame the pointer lock is lost, and is held again only on a new press', async () => {
  const { player, frames, sent } = await rangeRig()
  player.bind({ axis: [{ keys: ['s', 'w'], send: (v: number) => ['aim', v, 0] }], pointer: () => undefined })
  on.get('click')!(click)
  on.get('keydown')!(key('KeyW'))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0]])
  page.pointerLockElement = null
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0]])
  on.get('click')!(click)
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0]])
  on.get('keydown')!(key('KeyW'))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [1, 0]])
  player.unbind()
})

// The wheel's turn, in pixels down, is added up and sent once a frame it turned, and the page does
// not scroll under it.
test('the wheel is asked once a frame it turned, with the pixels it turned down, and the page does not scroll', async () => {
  const { player, frames, sent } = await rangeRig()
  cancelled.clear()
  player.bind({ wheel: (dy: number) => ['aim', 0, dy] })
  on.get('wheel')!({ deltaY: 100 })
  on.get('wheel')!({ deltaY: -30 })
  await frames(2)
  expect(sent('aim')).toEqual([[0, 70]])
  expect(cancelled.get('wheel')).toBe(2)
  // Under Control, Command or Alt the wheel keeps its default, so the browser zooms (a trackpad's
  // pinch is the wheel under Control), and the game still hears it.
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) on.get('wheel')!({ deltaY: 10, [mod]: true })
  await frames(2)
  expect(sent('aim')).toEqual([[0, 70], [0, 30]])
  expect(cancelled.get('wheel')).toBe(2)
  player.unbind()
})

// The scene's UI is asked first. This one has something that takes the pointer left of x 100, and
// takes the key `q`, as it takes every key while a modal panel holds anything.
test('a click, a mouse button or a key the UI takes is not the game\'s', async () => {
  const { player, plugins, frames, sent } = await rangeRig()
  plugins.ui = { hit: (x: number) => x < 100, took: (e: { key: string }) => e.key === 'q', modal: () => undefined }
  player.bind({ press: { Mouse0: ['fire'], q: ['fire'] }, click: (x: number, y: number) => ['aim', x, y] })
  const at = (x: number) => ({ ...click, button: 0, offsetX: x, offsetY: 10 })
  on.get('mousedown')!(at(50))
  on.get('mouseup')!(at(50))
  on.get('click')!(at(50))
  on.get('keydown')!(key('KeyQ'))
  on.get('keyup')!(key('KeyQ'))
  await frames(2)
  expect(sent('fire')).toEqual([])
  expect(sent('aim')).toEqual([])
  on.get('mousedown')!(at(150))
  on.get('mouseup')!(at(150))
  on.get('click')!(at(150))
  await frames(2)
  expect(sent('fire')).toEqual([[]])
  expect(sent('aim')).toEqual([[150, 10]])
  player.unbind()
})

// While a modal has the input, the game holds nothing: a held key's axis and a held button's hold
// go back to 0 as their release would send them, a held button stops being held, and the pointer
// lock this plugin took is given back. This UI says a modal is up from the moment `up` is set.
test('while a modal has the input, every key and button the game held is let go, and so is the pointer lock', async () => {
  const { player, plugins, frames, sent } = await rangeRig()
  let up: string | undefined
  plugins.ui = { hit: () => false, took: () => false, modal: () => up }
  player.bind({
    axis: [{ keys: ['s', 'w'], send: (v: number) => ['aim', v, 0] }],
    hold: [{ keys: ['Control'], send: (v: number) => ['aim', 0, v] }],
    every: (held: (key: string) => boolean) => (held('Mouse0') ? ['fire'] : undefined),
    pointer: () => undefined,
  })
  on.get('click')!(click)
  expect(page.pointerLockElement).toBe(canvas)
  on.get('keydown')!(key('KeyW'))
  on.get('keydown')!(key('ControlLeft'))
  on.get('mousedown')!({ button: 0 })
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 1]])
  expect(sent('fire').length).toBe(2)
  up = 'pause'
  await frames(3)
  expect(sent('aim')).toEqual([[1, 0], [0, 1], [0, 0], [0, 0]])
  expect(sent('fire').length).toBe(2)
  expect(page.pointerLockElement).toBe(null)
  player.unbind()
})

// ---------------------------------------------------------------- the action avenue (`control`)

// The range as `rangeRig` makes it, with `world.player` written over the range's, its `actions` each
// labelled by its name, as a scene file would give them; with `store`, the scene lists the store
// `before` the player, as a scene whose player rebinds does, or `after` it.
type World = { actions?: Record<string, Bound>; deadzone?: number; repeat?: number }
async function actionRig(world: World = {}, store: false | 'before' | 'after' = false) {
  const truth = boot(structuredClone(rangeTop), { scenemanager })
  const shots = (await load(truth, rangeHome)).get('range')!
  const row = manager(truth)
  const wire = link(loopback(accept(row)))
  const [[name]] = entries(row)
  const s = structuredClone(scene(row, name).scene) as Scene
  const { actions = {}, ...rest } = world
  const player = { ...rest, actions: Object.fromEntries(Object.entries(actions).map(([n, keys]) => [n, { label: n, keys }])) }
  const plugins = s.plugins!.flatMap(p => (p !== 'player' || !store ? [p] : store === 'before' ? ['store', p] : [p, 'store']))
  const me = await client({ ...s, plugins, world: { ...s.world, player }, prefabs: { ...s.prefabs, ...(store ? { store: {} } : {}) } }, rangeHome)
  wire.hear(d => {
    if (!me.plugins.scenemanager.link) me.plugins.scenemanager.mount(wire, d.scene, d.seat)
    me.plugins.scenemanager.hand(d.packet)
  })
  me.plugins.render3d.canvas = { addEventListener: () => {}, style: {}, width: 800, height: 600 }
  const frames = async (k: number) => { for (let i = 0; i < k; i++) { truth.step(DT); pass(DT); await me.frame() } }
  const sent = (action: string) => shots.log.filter(l => l.msg.action === action).map(l => l.msg.args)
  await frames(5)
  return { player: me.plugins.player, plugins: me.plugins, link: wire, frames, sent }
}

test('control binds behaviour to the scene\'s actions: a press, a hold, an axis, a stick and a release, each from any of its keys', async () => {
  const { player, frames, sent } = await actionRig({ actions: { shoot: ['f', 'Mouse0'], grip: ['Control'], tilt: [['q'], ['e']], way: [['ArrowLeft', 'a'], ['ArrowRight', 'd'], ['ArrowUp', 'w'], ['ArrowDown', 's']], note: ['n', 'Mouse1'] } })
  const notes: string[] = []
  player.control({
    press: { shoot: ['fire'], note: () => notes.push('down') },
    release: { note: () => notes.push('up') },
    hold: { grip: (v: number) => ['aim', v, 100] },
    axis: { tilt: (v: number) => ['aim', v, 200] },
    stick: { way: (x: number, y: number) => ['aim', x, y] },
  })
  on.get('keydown')!(key('KeyF'))
  on.get('keyup')!(key('KeyF'))
  on.get('mousedown')!({ button: 0 })
  on.get('mouseup')!({ button: 0 })
  on.get('keydown')!(key('ControlLeft'))
  on.get('keydown')!(key('KeyE'))
  on.get('keydown')!(key('KeyD'))
  on.get('keydown')!(key('ArrowUp'))
  await frames(2)
  on.get('keyup')!(key('ControlLeft'))
  on.get('keyup')!(key('KeyE'))
  on.get('keyup')!(key('KeyD'))
  on.get('keyup')!(key('ArrowUp'))
  await frames(2)
  expect(sent('fire')).toEqual([[], []])
  expect(sent('aim')).toEqual([[1, 100], [1, 200], [1, 0], [1, -1], [0, 100], [0, 200], [0, -1], [0, 0]])
  // Two keys of one action with a release: pressed at the first, released at the last.
  on.get('keydown')!(key('KeyN'))
  on.get('mousedown')!({ button: 1 })
  on.get('keydown')!(key('KeyN', { repeat: true }))
  on.get('keyup')!(key('KeyN'))
  expect(notes).toEqual(['down'])
  on.get('mouseup')!({ button: 1 })
  expect(notes).toEqual(['down', 'up'])
  player.unbind()
})

test('control throws on an action the scene does not name and on one read in another shape, and every asks only of buttons', async () => {
  const { player, frames } = await actionRig({ actions: { shoot: ['f'], tilt: [['s'], ['w']] } })
  expect(() => player.control({ press: { fire: ['fire'] } })).toThrow("the player table's press names fire, which the scene's world.player.actions does not")
  expect(() => player.control({ axis: { shoot: (v: number) => ['aim', v, 0] } })).toThrow("the player table's axis reads shoot as a axis, and the scene gives it the keys of a button")
  expect(() => player.control({ locked: ['nothing'] })).toThrow("the player table's locked names nothing")
  player.control({ every: (held: (action: string) => boolean) => (held('tilt') ? ['fire'] : undefined) })
  await expect(frames(1)).rejects.toThrow('every asked whether tilt is held, and it is not a button')
  player.unbind()
})

test('bind and control replace each other as the table in force, and bind plays by keys as it always has', async () => {
  const { player, frames, sent } = await actionRig({ actions: { shoot: ['f'] } })
  player.control({ press: { shoot: ['fire'] } })
  player.bind({ press: { g: ['fire'] } })
  on.get('keydown')!(key('KeyF'))
  on.get('keyup')!(key('KeyF'))
  on.get('keydown')!(key('KeyG'))
  on.get('keyup')!(key('KeyG'))
  await frames(2)
  expect(sent('fire')).toEqual([[]])
  player.control({ press: { shoot: ['fire'] } })
  on.get('keydown')!(key('KeyG'))
  on.get('keyup')!(key('KeyG'))
  on.get('keydown')!(key('KeyF'))
  on.get('keyup')!(key('KeyF'))
  await frames(2)
  expect(sent('fire')).toEqual([[], []])
  player.unbind()
})

// What the player chose is the store's, the page's own table: the server is sent none of it.
test('an action rebound plays from its new keys and not its old, the store holds the choice, and restore gives back the scene\'s', async () => {
  const { player, plugins, link: page, frames, sent } = await actionRig({ actions: { shoot: ['f'], tilt: [['s'], ['w']] } }, 'before')
  player.control({ press: { shoot: ['fire'] }, axis: { tilt: (v: number) => ['aim', v, 0] } })
  player.rebind('shoot', ['g', 'Pad3'])
  player.rebind('tilt', [['ArrowDown'], ['ArrowUp']])
  expect(page.store['player.keys']).toEqual({ shoot: ['g', 'Pad3'], tilt: [['ArrowDown'], ['ArrowUp']] })
  expect(plugins.store.get('player.keys')).toBe(page.store['player.keys'])
  on.get('keydown')!(key('KeyF'))
  on.get('keyup')!(key('KeyF'))
  on.get('keydown')!(key('KeyW'))
  on.get('keyup')!(key('KeyW'))
  await frames(2)
  expect(sent('fire')).toEqual([])
  expect(sent('aim')).toEqual([])
  on.get('keydown')!(key('KeyG'))
  on.get('keydown')!(key('ArrowUp'))
  await frames(2)
  expect(sent('fire')).toEqual([[]])
  expect(sent('aim')).toEqual([[1, 0]])
  on.get('keyup')!(key('ArrowUp'))
  on.get('keyup')!(key('KeyG'))
  expect(() => player.rebind('tilt', ['q'])).toThrow('tilt is a axis and was given ["q"]')
  expect(() => player.rebind('shoot', [['q'], ['e']])).toThrow('shoot is a button and was given [["q"],["e"]]')
  expect(() => player.rebind('nothing', ['q'])).toThrow("the scene's world.player.actions names no nothing")
  player.restore('shoot')
  expect(page.store['player.keys']).toEqual({ tilt: [['ArrowDown'], ['ArrowUp']] })
  on.get('keydown')!(key('KeyF'))
  await frames(2)
  expect(sent('fire')).toEqual([[], []])
  player.restore()
  expect(page.store['player.keys']).toEqual({})
  player.unbind()
})

test('a scene that lists no store plays its own keys and keeps no choice, and one that lists it after the player throws', async () => {
  const { player } = await actionRig({ actions: { shoot: ['f'] } })
  player.control({ press: { shoot: ['fire'] } })
  expect(() => player.rebind('shoot', ['g'])).toThrow('the scene lists no store, so nothing the player changes can be kept')
  expect(() => player.configure({ repeat: 0.2 })).toThrow('the scene lists no store')
  expect(player.settings()).toEqual({ toggle: [], deadzone: undefined, repeat: 0 })
  player.unbind()
  const late = await actionRig({ actions: { shoot: ['f'] } }, 'after')
  expect(() => late.player.control({ press: { shoot: ['fire'] } })).toThrow('store is listed after player, so the player would read the store of the frame before')
  late.player.unbind()
})

// A hold played as a toggle: the first press holds it and the next lets it go, sending what a held
// key sends; a modal, like every key, lets it go.
test('a toggle holds its action from one press to the next and sends the 1 and 0 a held key sends, and a modal lets it go', async () => {
  const { player, plugins, frames, sent } = await actionRig({ actions: { grip: ['Control', 'Pad7'] } }, 'before')
  let up: string | undefined
  plugins.ui = { hit: () => false, took: () => false, modal: () => up }
  player.control({ hold: { grip: (v: number) => ['aim', v, 0] } })
  player.configure({ toggle: ['grip'] })
  expect(plugins.store.get('player.toggle')).toEqual(['grip'])
  expect(player.settings().toggle).toEqual(['grip'])
  on.get('keydown')!(key('ControlLeft'))
  on.get('keyup')!(key('ControlLeft'))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0]])
  // The keyboard's repeat of a key already down turns nothing.
  on.get('keydown')!(key('ControlLeft'))
  on.get('keydown')!(key('ControlLeft', { repeat: true }))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0]])
  on.get('keyup')!(key('ControlLeft'))
  on.get('keydown')!(key('ControlLeft'))
  on.get('keyup')!(key('ControlLeft'))
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [1, 0]])
  up = 'pause'
  await frames(2)
  expect(sent('aim')).toEqual([[1, 0], [0, 0], [1, 0], [0, 0]])
  up = undefined
  expect(() => player.configure({ toggle: ['nothing'] })).toThrow("the scene's world.player.actions names no nothing")
  player.restore('grip')
  expect(player.settings().toggle).toEqual([])
  player.unbind()
})

test('a scene whose actions hold a side of the left stick needs world.player.deadzone, and the store\'s takes the stick in place of it', () => plugged(async () => {
  const bare = await actionRig({ actions: { tilt: [['PadStickLeft'], ['PadStickRight']] } }, 'before')
  bare.player.control({ axis: { tilt: (v: number) => ['aim', v, 0] } })
  await expect(bare.frames(1)).rejects.toThrow('an action holds a side of the left stick, and the scene gives no world.player.deadzone')
  bare.player.unbind()
  const { player, frames, sent } = await actionRig({ deadzone: 0.5, actions: { tilt: [['PadStickLeft'], ['PadStickRight']] } }, 'before')
  const pad = gamepad()
  player.control({ axis: { tilt: (v: number) => ['aim', v, 0] } })
  pad.axes = [-0.3, 0]
  await frames(2)
  expect(sent('aim')).toEqual([])
  player.configure({ deadzone: 0.2 })
  expect(player.settings().deadzone).toBe(0.2)
  await frames(2)
  expect(sent('aim')).toEqual([[-1, 0]])
  player.restore()
  expect(player.settings().deadzone).toBe(0.5)
  await frames(2)
  expect(sent('aim')).toEqual([[-1, 0], [0, 0]])
  for (const d of [0, 1, -0.1, 1.5]) expect(() => player.configure({ deadzone: d })).toThrow('a deadzone is a fraction of the way out, above 0 and below 1')
  // A stick swung from one side to the other between two frames sends the one way it holds now.
  pad.axes = [-0.9, 0]
  await frames(1)
  pad.axes = [0.9, 0]
  await frames(1)
  expect(sent('aim')).toEqual([[-1, 0], [0, 0], [-1, 0], [1, 0]])
  player.unbind()
}))

// The repeat presses a held action again every so many seconds, from a gamepad as from a key, and
// the keyboard's own repeats are then nobody's; an action with a release is pressed once a hold all
// the same.
test('the repeat presses a held action again every so many seconds, and the keyboard\'s own repeats press nothing', () => plugged(async () => {
  const { player, frames, sent } = await actionRig({ actions: { shoot: ['f', 'Pad0'], note: ['n'] } }, 'before')
  const pad = gamepad()
  const notes: string[] = []
  player.control({ press: { shoot: ['fire'], note: () => notes.push('down') }, release: { note: () => notes.push('up') } })
  // With no repeat, the keyboard's repeat presses again, as `bind`'s does.
  on.get('keydown')!(key('KeyF'))
  on.get('keydown')!(key('KeyF', { repeat: true }))
  on.get('keyup')!(key('KeyF'))
  await frames(1)
  expect(sent('fire').length).toBe(2)
  player.configure({ repeat: 0.1 })
  expect(player.settings().repeat).toBe(0.1)
  on.get('keydown')!(key('KeyF'))
  on.get('keydown')!(key('KeyF', { repeat: true }))
  // A quarter of a second held: pressed at the start, then at 0.1 and 0.2.
  await frames(15)
  on.get('keyup')!(key('KeyF'))
  await frames(15)
  expect(sent('fire').length).toBe(5)
  push(pad, 0, true)
  await frames(15)
  push(pad, 0, false)
  await frames(15)
  expect(sent('fire').length).toBe(8)
  on.get('keydown')!(key('KeyN'))
  await frames(15)
  on.get('keyup')!(key('KeyN'))
  expect(notes).toEqual(['down', 'up'])
  expect(() => player.configure({ repeat: -1 })).toThrow('a repeat is 0 or more seconds')
  player.unbind()
}))

// `listen` is a rebinding screen's: the next key, button or gamepad button goes to it and to nothing
// else, the UI included, and Escape hands it nothing.
test('listen hands the next key, mouse button or gamepad button to the screen and to nothing else, and Escape hands it nothing', () => plugged(async () => {
  const { player, plugins, frames, sent } = await actionRig({ actions: { shoot: ['f', 'Mouse0', 'Pad0'] } })
  // The UI takes no key from the keyboard while the player listens, as the real one does; a gamepad's
  // it would take is never offered it.
  const offered: string[] = []
  plugins.ui = { hit: () => false, took: () => false, modal: () => undefined, keyDown: (k: string) => { offered.push(k); return true }, keyUp: () => {} }
  const pad = gamepad()
  const got: (string | undefined)[] = []
  player.control({ press: { shoot: ['fire'] }, click: () => ['aim', 1, 1] })
  player.listen((k: string | undefined) => got.push(k))
  expect(player.listening).toBe(true)
  on.get('keydown')!(key('KeyF'))
  expect(player.listening).toBe(false)
  on.get('keyup')!(key('KeyF'))
  player.listen((k: string | undefined) => got.push(k))
  on.get('keydown')!(key('Escape'))
  player.listen((k: string | undefined) => got.push(k))
  on.get('mousedown')!({ button: 0 })
  on.get('mouseup')!({ button: 0 })
  on.get('click')!(click)
  player.listen((k: string | undefined) => got.push(k))
  push(pad, 3, true)
  await frames(2)
  player.listen((k: string | undefined) => got.push(k))
  player.unbind()
  expect(got).toEqual(['f', undefined, 'Mouse0', 'Pad3', undefined])
  expect(offered).toEqual([])
  expect(sent('fire')).toEqual([])
  expect(sent('aim')).toEqual([])
}))

// A gamepad key goes to the UI as a keyboard's does: offered first, and, taken, not the game's.
test('on the action avenue a gamepad key the UI takes is not the game\'s, and each one handed to the UI is handed back up', () => plugged(async () => {
  const { player, plugins, frames, sent } = await actionRig({ actions: { shoot: ['Pad0', 'Pad8'] } })
  const heard: string[] = []
  plugins.ui = { hit: () => false, took: () => false, modal: () => undefined, keyDown: (k: string) => { heard.push(`down ${k}`); return k === 'Pad8' }, keyUp: (k: string) => heard.push(`up ${k}`) }
  const pad = gamepad()
  player.control({ press: { shoot: ['fire'] } })
  push(pad, 8, true)
  await frames(2)
  expect(sent('fire')).toEqual([])
  push(pad, 8, false)
  push(pad, 0, true)
  await frames(2)
  expect(sent('fire')).toEqual([[]])
  expect(heard).toEqual(['down Pad8', 'up Pad8', 'down Pad0'])
  player.unbind()
}))

test('conflicts names each key more than one action holds, and actions shows every action as it is now beside the scene\'s', async () => {
  const { player } = await actionRig({ actions: { shoot: ['f', 'g'], block: ['g'], tilt: [['g'], ['h']], lift: ['Pad0'] } }, 'before')
  player.control({ press: { shoot: ['fire'] }, hold: { block: (v: number) => ['aim', v, 0] }, locked: ['block'], axis: { tilt: (v: number) => ['aim', v, 0] } })
  expect(player.conflicts()).toEqual([{ key: 'g', actions: ['shoot', 'block', 'tilt'] }])
  player.rebind('lift', ['h'])
  expect(player.conflicts()).toEqual([{ key: 'g', actions: ['shoot', 'block', 'tilt'] }, { key: 'h', actions: ['tilt', 'lift'] }])
  expect(player.actions()).toEqual([
    { name: 'shoot', label: 'shoot', shape: 'button', keys: ['f', 'g'], defaults: ['f', 'g'], bound: ['press'] },
    { name: 'block', label: 'block', shape: 'button', keys: ['g'], defaults: ['g'], bound: ['hold', 'locked'] },
    { name: 'tilt', label: 'tilt', shape: 'axis', keys: [['g'], ['h']], defaults: [['g'], ['h']], bound: ['axis'] },
    { name: 'lift', label: 'lift', shape: 'button', keys: ['h'], defaults: ['Pad0'], bound: [] },
  ])
  player.unbind()
})

test('device is what was used last: the keyboard and mouse, or a gamepad by its id', () => plugged(async () => {
  const { player, frames } = await actionRig({ actions: { shoot: ['f', 'Pad0'] } })
  player.control({ press: { shoot: ['fire'] } })
  expect(player.device()).toBe('keyboard')
  for (const [id, is] of [['Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'xbox'], ['DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'playstation'], ['8BitDo SN30 Pro', 'pad']]) {
    gamepads.length = 0
    const pad = gamepad()
    pad.id = id
    push(pad, 0, true)
    await frames(1)
    expect(player.device()).toBe(is)
    push(pad, 0, false)
    await frames(1)
    on.get('keydown')!(key('KeyF'))
    on.get('keyup')!(key('KeyF'))
    expect(player.device()).toBe('keyboard')
  }
  player.unbind()
}))

// ---------------------------------------------------------------- ledgers

// A drum whose every rule raises a sound on audio's ledger: its hit and its roll write the drum and
// the ledger, its ring writes the drum and calls the ledger's `play`, and while it rolls its
// per-step rule writes both each step. The scene's `world.player.ledgers` names `audio`, so
// what a predicted step writes to the ledger, or calls on it, is dropped and the drum is still
// predicted; the sound comes once, from the server's packet.
const AUDIO = new URL('../audio/audio.sim.ts', import.meta.url).pathname
const drums: Scene = {
  world: { player: { ledgers: ['audio'] }, audio: { hold: 0.25, space: { model: 'linear', ref: 1, max: 10, rolloff: 1 }, cues: { thud: { sounds: [], gain: 1 } } } },
  plugins: ['scenemanager', 'player', 'audio'],
  seats: 1,
  prefabs: {
    engine: { dt: 1 / 60 },
    scenemanager: { out: {} },
    player: { seat: 0 },
    audio: { step: 0, next: 1, live: [] },
    drum: { x: 0, vx: 0, pos: [0, 0, 0] },
  },
  actors: [{ is: 'scenemanager' }, { is: 'audio' }, { is: 'drum' }],
}
const drumsHome = folder({
  'player.sim.ts': `export const player = {
  acts: {
    hit(_me, w, seat) { w.call(w.find('drum'), 'hit', seat) },
    ring(_me, w, seat) { w.call(w.find('drum'), 'ring', seat) },
    roll(_me, w, seat, v) { w.call(w.find('drum'), 'roll', seat, v) },
  },
}
`,
  'drum.sim.ts': `import { sound } from ${JSON.stringify(AUDIO)}
export const drum = {
  tick(me, dt, w) {
    if (!me.data.vx) return
    me.data.x += me.data.vx * dt
    sound(w, 'thud', undefined, me.id)
  },
  acts: {
    hit(me, w) { me.data.x += 10; sound(w, 'thud', undefined, me.id) },
    ring(me, w, seat) { me.data.x += 100; w.call(w.find('audio'), 'play', seat, 'thud', null, null, null, me.id) },
    roll(me, w, _seat, v) { me.data.vx = v; sound(w, 'thud', [0, 0, 0]) },
  },
}
`,
})

async function drumsRig(frames: number, presses: Knobs['presses']) {
  const p = await played(drumsHome, 'drums', drums, { scenemanager: SCENEMANAGER, audio: AUDIO, drum: './drum.sim.ts', player: './player.sim.ts' }, { frames, up: leg(LAG), down: leg(LAG), presses })
  const kind = (rows: Row[], k: string) => rows.find(r => r.kind === k)!.data
  // The server's ledger at each of its steps, and what the page drew each frame beside the step of
  // the packet it drew from.
  const ledgerAt: Record<number, unknown> = {}
  for (let n = 0; p.server(n); n++) ledgerAt[n] = kind(p.server(n)!, 'audio')
  const R = p.frames.map((f, k) => {
    const rows = rowsOf(f.rows)
    return { n: f.n ?? 0, drum: rows.length ? kind(rows, 'drum').x : 0, ledger: rows.length ? kind(rows, 'audio') : undefined, server: kind(p.server(k)!, 'drum').x }
  })
  return { R, ledgerAt, drumId: p.server(0)!.find(r => r.kind === 'drum')!.id }
}

test('a press or a step that raises a sound is still predicted, and the page draws only the ledger the server sent', async () => {
  const { R, ledgerAt, drumId } = await drumsRig(120, [[20, 'hit'], [50, 'ring'], [80, 'roll', 60]])
  // The hit and the ring are drawn at the press, the server has them `up` steps on.
  expect([R[19].drum, R[20].drum, R[20].server, R[23].server, R[24].server]).toEqual([0, 10, 0, 0, 10])
  expect([R[49].drum, R[50].drum, R[50].server, R[54].server]).toEqual([10, 110, 10, 110])
  // The roll's per-step rule sounds every step, and is run ahead from the press on: the drawn drum
  // moves a step at a time while the server's has not started.
  expect(R.slice(80, 84).map(r => r.server)).toEqual([110, 110, 110, 110])
  expect(R.slice(80, 84).map(r => r.drum - 110)).toEqual([0, 1, 2, 3])
  // Every frame's ledger is the server's at the step of the packet it came in, never one this page
  // wrote: its entries are the server's, and it has one for each press and step that sounded.
  for (const r of R.filter(r => r.ledger)) expect(r.ledger).toEqual(ledgerAt[r.n])
  // The hit's sound is drawn first on the frame the packet of the server's hit arrives. The server
  // answered the hit before its passes, so before the ledger counted that step.
  const hit = R.findIndex(r => (r.ledger as { live: Entry[] } | undefined)?.live.some(e => e.id === 1))
  expect(hit).toBe(20 + LAG + LAG + 1)
  expect((R[hit].ledger as { live: Entry[] }).live).toEqual([{ id: 1, cue: 'thud', at: [0, 0, 0], from: drumId, step: R[hit].n - 1 }])
})

// ---------------------------------------------------------------- which rule files

// A scene with a plugin's kind of each sort: `scenemanager`, which the scene's `plugins` names, and
// `rug`, a game's own plugin `world.shipped` names. The page's folder holds a rule file for
// each of them and for `player`, and each file writes its name down when it is imported; the server
// runs rules from another folder, so what is written down is what the page asked for.
test('no rule file is asked for a plugin\'s kind, and the player\'s is', async () => {
  const seen = globalThis as unknown as { asked: string[] }
  seen.asked = []
  const noted = (kind: string) => `globalThis.asked.push('${kind}')\nexport const ${kind} = {}\n`
  const pageHome = folder({
    'player.sim.ts': noted('player'),
    'scenemanager.sim.ts': noted('scenemanager'),
    'rug.sim.ts': noted('rug'),
    'plugins/rug/rug.plugin.ts': 'export function rug() { return {} }\n',
  })
  const rules = folder({ 'player.sim.ts': 'export const player = {}\n', 'rug.sim.ts': 'export const rug = {}\n' })
  const room: Scene = {
    plugins: ['scenemanager', 'player', 'shipped'],
    seats: 1,
    world: { shipped: { plugins: ['rug'] } },
    prefabs: { engine: { dt: 1 / 60 }, scenemanager: { out: {} }, player: { seat: 0 }, rug: {} },
    actors: [{ is: 'scenemanager' }, { is: 'rug' }],
  }
  const at = (f: string) => fileURLToPath(new URL(f, rules))
  const p = await played(pageHome, 'room', room, { scenemanager: SCENEMANAGER, player: at('player.sim.ts'), rug: at('rug.sim.ts') }, { frames: 6, up: leg(1), down: leg(1) })
  expect(p.drawn(5).map(r => r.kind).sort()).toEqual(['player', 'rug', 'scenemanager'])
  expect(seen.asked).toEqual(['player'])
})

// ---------------------------------------------------------------- whole steps

// A yard of two box3d crates on a floor, in a scene with `world.player.steps`: the page runs whole
// steps, box3d's tick included. A press kicks crate 0. `clock` counts the steps on both sides, so
// the rows drawn say the step the page is at. The server's `stir` is not the page's: from
// `world.stir.at` it writes what the page does not, one shove of crate 1 or a count every step. 9
// steps up and 9 down, as 150 ms each way at 60 a second.
const yard: Scene = {
  world: {
    player: { steps: true },
    stir: { at: 1e9, every: false },
    box3d: {
      gravity: [0, -10, 0], subStepCount: 4,
      static: [{ pos: [0, -1, 0], rot: [0, 0, 0, 1], shapes: [{ box: [100, 1, 100], density: 0, baseMaterial: { friction: 0.6, restitution: 0, rollingResistance: 0 } }] }],
      kinds: { crate: { type: 'dynamic', shapes: [{ box: [0.5, 0.5, 0.5], density: 100, baseMaterial: { friction: 0.6, restitution: 0, rollingResistance: 0 } }] } },
    },
  },
  plugins: ['scenemanager', 'player'],
  seats: 1,
  prefabs: {
    engine: { dt: 1 / 60 },
    scenemanager: { out: {} },
    box3d: {},
    crate: { pos: [0, 0.5, 0], rot: [0, 0, 0, 1], vel: [0, 0, 0], spin: [0, 0, 0], awake: true },
    clock: { t: 0 },
    stir: { count: 0 },
    player: { seat: 0 },
  },
  actors: [{ is: 'box3d' }, { is: 'crate' }, { is: 'crate', pos: [0, 0.5, 6] }, { is: 'clock' }, { is: 'stir' }, { is: 'scenemanager' }],
}
const yardFiles = {
  'player.sim.ts': `export const player = { acts: { kick(_me, w, _seat, dv) { w.all('crate')[0].data.vel = [dv, 0, 0] } } }\n`,
  'crate.sim.ts': 'export const crate = {}\n',
  'clock.sim.ts': 'export const clock = { tick(me) { me.data.t++ } }\n',
  'stir.sim.ts': 'export const stir = {}\n',
  'stir.server.ts': `export const stir = {
  tick(me, _dt, w) {
    const t = w.find('clock').data.t
    if (t === w.world.stir.at) w.all('crate')[1].data.vel = [0, 0, 4]
    if (w.world.stir.every && t >= w.world.stir.at) me.data.count++
  },
}
`,
}
// Up and down, in steps.
const LAG9 = 9

// The yard on the simulator, 9 steps each way unless `knobs` say otherwise. `drawn[k]` is the rows
// frame k drew, `server(n)` the server's after step n, and `step` the step a set of rows is at.
async function yardRig(stir: { at: number; every: boolean }, knobs: Partial<Knobs> & { frames: number }) {
  const home = folder(yardFiles)
  const child = structuredClone(yard)
  child.world!.stir = stir
  const kinds = { scenemanager: SCENEMANAGER, box3d: BOX3D, player: './player.sim.ts', crate: './crate.sim.ts', clock: './clock.sim.ts', stir: './stir.server.ts' }
  const p = await played(home, 'yard', child, kinds, { up: leg(LAG9), down: leg(LAG9), ...knobs })
  const drawn = p.frames.map(f => rowsOf(f.rows))
  const crate = (rows: Row[], i: number) => rows.filter(r => r.kind === 'crate')[i]?.data
  const step = (rows: Row[]) => rows.find(r => r.kind === 'clock')?.data.t as number
  return { ...p, drawn, crate, step }
}

test('whole steps: a press moves the drawn crate on the next frame, before any packet', async () => {
  const g = await yardRig({ at: 1e9, every: false }, { frames: 122, presses: [[120, 'kick', 3]] })
  const x = g.crate(g.drawn[119], 0).pos[0]
  expect(g.crate(g.drawn[120], 0).pos[0]).toBe(x)
  expect(g.crate(g.drawn[121], 0).pos[0]).toBeGreaterThan(x + 0.01)
  expect(g.crate(g.server(122)!, 0).vel[0]).toBe(0)
})

// A stall as a page's first frames make one while it loads: the page has joined and sent its first
// probe on the frame that took its first packet, `down` + 1, then draws no frame for 20 vsyncs, a
// span its display hides, while the server takes 20 steps. The frame after takes at once the 21
// packets sent since the frame before it, the stall's 20 and its own step's, and the ack came on one
// of them, so after the packet the last frame took and no sooner: the round
// trip measured is the real one, and the page never runs further ahead of the packets than it, 18
// steps at 9 up and 9 down, none on a page in the server's own process.
test('whole steps: a stall as the page joins is not measured as round trip', async () => {
  for (const [lag, rtt] of [[LAG9, 18], [0, 0]]) {
    const from = lag + 2
    const g = await yardRig({ at: 1e9, every: false }, { frames: from + 20 + 90, up: leg(lag), down: leg(lag), display: { hz: 60, phase: STEP / 2, hidden: [[from * STEP, (from + 20) * STEP]] } })
    expect(g.frames.length).toBe(from + 90)
    expect(g.frames[from].took.length).toBe(21)
    const after = g.frames.slice(from)
    const lead = (f: FrameRecord) => f.step! - f.n!
    expect(Math.max(...after.map(lead))).toBe(rtt)
    expect(lead(after[after.length - 1])).toBe(rtt)
  }
})

// Whole steps on packets in bursts, as the lanes' are (`BURST`): two steps at once and then none, and
// from 120, long after the page has its lead, the page runs one step every frame, the kick's frames
// included.
test('whole steps: packets in bursts move the page one step a frame', async () => {
  const g = await yardRig({ at: 1e9, every: false }, { frames: 420, server: { grain: BURST }, presses: [[200, 'kick', 3]] })
  expectBursts(g.frames.slice(120))
  const moved = Array.from({ length: 300 }, (_, i) => g.step(g.drawn[120 + i]) - g.step(g.drawn[119 + i]))
  expect(new Set(moved)).toEqual(new Set([1]))
})

test('whole steps: a press made once the round trip is learned is applied by the server at the step it is stamped with, and drawn where the server has it', async () => {
  const g = await yardRig({ at: 1e9, every: false }, { frames: 240, presses: [[120, 'kick', 3]] })
  const kick = g.truth.log.find(e => e.msg.action === 'kick')!
  expect(kick.at).toBeLessThanOrEqual(kick.msg.n)
  expect(g.steps.flatMap(s => s.applied).filter(a => a.action === 'kick').map(a => a.late)).toEqual([0])
  for (let k = 121; k < 240; k++) {
    const mine = g.drawn[k], theirs = g.server(g.step(mine))
    if (theirs) expect(Math.hypot(...g.crate(mine, 0).pos.map((c: number, i: number) => c - g.crate(theirs, 0).pos[i]))).toBeLessThan(0.5)
  }
})

// A page joins a world whose contacts the server has carried since step 0 and builds its own from
// the rows, so while the crates settle its steps differ from the server's in the last digits and
// are corrected. Once they sleep, each packet is the page's step to the byte.
test('whole steps: packets that match the page\'s step cause no re-run', async () => {
  const g = await yardRig({ at: 1e9, every: false }, { frames: 360 })
  expect(g.crate(g.server(240)!, 0).awake).toBe(false)
  expect(g.frames[359].reruns).toBe(g.frames[239].reruns)
})

test('whole steps: a packet the server changed causes a re-run, and the crate is then drawn where the server has it', async () => {
  const g = await yardRig({ at: 200, every: false }, { frames: 400 })
  expect(g.frames[399].reruns).toBeGreaterThan(g.frames[179].reruns)
  const mine = g.drawn[379], theirs = g.server(g.step(mine))!
  const off = g.crate(mine, 1).pos.map((c: number, i: number) => c - g.crate(theirs, 1).pos[i])
  expect(Math.hypot(...off)).toBeLessThan(0.5)
  expect(g.crate(mine, 1).pos[2]).toBeGreaterThan(6.5)
})

test('whole steps: 300 re-runs in a row keep the page running, drawing the crates where the server has them', async () => {
  const g = await yardRig({ at: 60, every: true }, { frames: 410, presses: [[100, 'kick', 3]] })
  expect(g.frames[409].reruns - g.frames[59].reruns).toBeGreaterThanOrEqual(300)
  const mine = g.drawn[389], theirs = g.server(g.step(mine))!
  for (const i of [0, 1]) expect(Math.hypot(...g.crate(mine, i).pos.map((c: number, j: number) => c - g.crate(theirs, i).pos[j]))).toBeLessThan(0.5)
})
