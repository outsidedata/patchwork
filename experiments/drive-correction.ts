// Experiment: how should a packet correct a page that runs whole steps (box3d's tick included) ahead
// of the server? A server truth and a page, 9 steps of lag each way. The page keeps its own rows, so
// box3d's world on the page (keyed by the page's box3d row) lives across packets, and a reset writes
// the packet's rows into those same row objects: box3d then pushes only what differs (plan step 1).
// A car (a crate driven by a held force a press sets) runs into a stack of crates. At step 125 a rule
// the page does not have shoves the stack's top crate while the car pushes it, and at step 150 one
// the car never touches: the server changed what the page predicted.
//   mode       the tolerance a packet is compared with the page's own step n: every number within
//              it, everything else equal (0 is byte-equal); differ -> reset and re-run. -1 resets
//              on every packet; 'none' never does (the faithfulness check).
//   ahead      0: the page runs level with the server (half the round trip ahead of the packets, as
//              the player does now), so a press stamped with its step lands late. LAG: the page runs
//              the whole round trip ahead of the packets, so a press lands on the step it is stamped.
//   GROUND=wave  the red-team: the car drives the whole run over bumps, in contact every step.
// Run: node --experimental-strip-types experiments/drive-correction.ts (and GROUND=wave).
//
// Found (2026-09-27):
// - ahead decides what the player sees. At 0 a correction yanks the car up to 90 cm; at LAG the
//   page's own car is where the server has it (0 cm with no correction at all: a stamped press is
//   applied on the server at the step the page applied it).
// - The tolerance changes only how many packets re-run (flat 85 -> 61, wave 257 -> 157 of 411), not
//   what is drawn (3.1 cm worst jump flat, 0 cm car error on the wave). Byte-equal needs no number.
// - A new world per reset (new row objects) is out: Box3D holds at most 128 worlds a process
//   (B3_MAX_WORLDS), freed only when the collector gets to them; it crashed at 128.
// - Resetting on every packet (-1) on flat ground, while the car pushes the stack, makes some re-runs
//   lose most of the car's speed: the drawn car flickers 168 cm frame to frame. Not seen when the
//   page compares first, on either ground, nor at -1 on the wave. Clearing a moved body's contacts
//   (b3Body_Disable/Enable) did not change it. Unexplained; the drive crash (plan step 7) is its check.
import { boot, type Kind, type Row, type Sim, type W } from '#engine/engine.ts'
import { box3d } from '#plugins/box3d/box3d.sim.ts'

const DT = 1 / 60, LAG = 9, STEPS = 420, F = 12000
const surface = { friction: 0.6, restitution: 0, rollingResistance: 0 }
const crate = { type: 'dynamic', shapes: [{ box: [0.5, 0.5, 0.5], density: 1000, baseMaterial: surface }] }
const at = (pos: number[]) => ({ pos, rot: [0, 0, 0, 1], vel: [0, 0, 0], spin: [0, 0, 0], awake: true })
// GROUND=wave: the red-team. The car drives the whole run over bumps, touching the land every step.
const WAVE = process.env.GROUND === 'wave'
const land = WAVE
  ? { pos: [-30, 0, -30], rot: [0, 0, 0, 1], shapes: [{ heightField: { make: 'wave', rowCount: 120, columnCount: 120, scale: [0.5, 0.3, 0.5], rowFrequency: 0.3, columnFrequency: 0.2, makeHoles: false }, density: 0, baseMaterial: surface }] }
  : { pos: [0, -1, 0], rot: [0, 0, 0, 1], shapes: [{ box: [60, 1, 60], density: 0, baseMaterial: surface }] }
const scene = {
  world: { box3d: { gravity: [0, -10, 0], subStepCount: 4, static: [land], kinds: { car: crate, crate } } },
  prefabs: { box3d: {}, car: at([0, 0.5, 0]), crate: at([0, 0.5, 0]), gust: {} },
  actors: [{ is: 'box3d' }, { is: 'car', pos: WAVE ? [-20, 2, 3] : [-6, 0.5, 0] }, ...[0, 1, 2].map(i => ({ is: 'crate', pos: [0, 0.5 + i, 0] })), { is: 'crate', pos: [0, 0.5, 8] }, { is: 'gust' }],
}
const car: Kind = { acts: { throttle(me, _w, _seat, v: number) { if (v) me.data.force = [v * F, 0, 0]; else delete me.data.force } } }
const serverGust: Kind = { tick(_me, _dt, w) { ++gusts; if (gusts === 150) w.all('crate').at(-1)!.data.pushes = [{ impulse: [0, 0, 3000] }]; if (gusts === 125) w.all('crate')[2].data.pushes = [{ impulse: [0, 0, 400] }] } }
let gusts = 0
const serverSim: Sim = { box3d, car, crate: {}, gust: serverGust }
const pageSim: Sim = { box3d, car, crate: {}, gust: {} }
const presses = WAVE ? [{ at: 30, v: 1 }] : [{ at: 30, v: 1 }, { at: 200, v: 0 }]

type Msg = { seq: number; n: number; id: number; action: string; args: number[] }
const PASSES = ['before', 'tick', 'after'] as const

// One whole step over the page's own rows, as the engine steps a truth: the due presses' acts, then
// every row's passes.
function step(rows: Row[], world: any, sim: Sim, due: Msg[]) {
  const w: W = {
    world, all: k => rows.filter(r => r.kind === k), get: id => rows.find(r => r.id === id)!,
    find: (k, p = () => true) => rows.find(r => r.kind === k && p(r))!,
    spawn: () => { throw new Error('spawn') }, end: () => { throw new Error('end') }, die: () => { throw new Error('die') },
    call: () => { throw new Error('call') },
  }
  for (const m of due) sim[w.get(m.id).kind].acts![m.action](w.get(m.id), w, 0, ...m.args)
  for (const pass of PASSES) for (const r of [...rows]) sim[r.kind][pass]?.(r, DT, w)
}

type Mode = number | 'none' // the tolerance, -1 always corrects, or never correct
const dist = (a: number[], b: number[]) => Math.hypot(...a.map((c, i) => c - b[i]))
// Agnostic: every number within `eps` of the other, everything else equal. eps 0 is byte-equal.
const near = (a: unknown, b: unknown, eps: number): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => near(x, b[i], eps))
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter(k => (a as any)[k] !== undefined), kb = Object.keys(b).filter(k => (b as any)[k] !== undefined)
    return ka.length === kb.length && ka.every(k => near((a as any)[k], (b as any)[k], eps))
  }
  return a === b
}

// `ahead`: how many steps the page runs ahead of the server. 0 is the half round trip ahead of
// the packets the player keeps now; LAG is the whole round trip, so a press stamped with the page's
// step reaches the server as that step is due.
function play(mode: Mode, ahead: number) {
  gusts = 0
  const server = boot(structuredClone(scene) as any, serverSim)
  const seat = server.open(2)
  const page = boot(structuredClone(scene) as any, pageSim) // the page's rows: its own objects, kept for the run
  const rows = page.rows, world = page.world
  const history = new Map<number, Row[]>() // the page's rows after each step it ran
  const up: { arrive: number; msg: Msg }[] = [], down: { arrive: number; pkt: ReturnType<typeof server.packet> }[] = []
  let n = 0, seq = 0, reruns = 0, packets = 0, worstJump = 0
  let unacked: Msg[] = []
  const serverAt = new Map<number, Row[]>(), drawnAt = new Map<number, Row[]>()
  let drawn = rows[1].data.pos.slice()
  const run = (from: number, to: number) => { for (let s = from; s < to; s++) { step(rows, world, pageSim, unacked.filter(m => m.n === s)); history.set(s + 1, structuredClone(rows)) } }
  run(0, ahead); n = ahead
  for (let frame = 0; frame < STEPS; frame++) {
    // The page: a press is stamped with the page's step and applied before that step's passes.
    for (const p of presses) if (p.at === frame) { const m = { seq: ++seq, n, id: 2, action: 'throttle', args: [p.v] }; unacked.push(m); up.push({ arrive: frame + LAG, msg: m }) }
    // The server: messages arrive after LAG, and wait for the step they are stamped with.
    for (const u of up.filter(u => u.arrive === frame)) server.inbox(seat, u.msg)
    server.step(DT)
    serverAt.set(server.n, structuredClone(server.rows))
    down.push({ arrive: frame + LAG, pkt: server.packet(seat) })
    // Packets reach the page LAG frames later.
    for (const d of down.filter(d => d.arrive === frame)) {
      packets++
      const pkt = d.pkt
      unacked = unacked.filter(m => m.seq > pkt.ack)
      const mine = history.get(pkt.n)
      const differ = mode === 'none' ? false : mode < 0 || !mine || !near(mine, pkt.rows, mode)
      if (differ) {
        reruns++
        for (const r of pkt.rows) rows.find(x => x.id === r.id)!.data = structuredClone(r.data)
        history.set(pkt.n, structuredClone(pkt.rows))
        run(pkt.n, n)
      }
    }
    run(n, n + 1); n++
    const pos = rows[1].data.pos
    const jump = dist(pos, drawn) - Math.hypot(...rows[1].data.vel) * DT
    worstJump = Math.max(worstJump, jump)
    drawn = pos.slice()
    drawnAt.set(n, structuredClone(rows))
  }
  // What the page drew at step s against the server's rows at step s: the car, and the shoved crate.
  let carErr = 0, crateErr = 0
  for (const [s, mine] of drawnAt) {
    const truth = serverAt.get(s)
    if (!truth) continue
    carErr = Math.max(carErr, dist(mine[1].data.pos, truth[1].data.pos))
    if (s > 300) crateErr = Math.max(crateErr, dist(mine[5].data.pos, truth[5].data.pos))
  }
  return { mode, ahead, reruns, packets, carX: +server.rows[1].data.pos[0].toFixed(2), worstJumpCm: +(worstJump * 100).toFixed(2), worstCarErrCm: +(carErr * 100).toFixed(2), shovedCrateErrLateCm: +(crateErr * 100).toFixed(2) }
}

for (const ahead of [0, LAG]) for (const mode of ['none', 0, 0.01, -1] as Mode[]) console.log(JSON.stringify(play(mode, ahead)))
