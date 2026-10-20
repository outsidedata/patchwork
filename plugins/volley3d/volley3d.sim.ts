// The server half of volley3d: launched rounds in a 3D world, rockets, shells, grenades and missiles
// that fly for a while before they meet something, none of them a row. A rule fires a round: one
// entry on the ledger row naming its pattern, where it was fired from, which way and by whom. Each
// step the entry is flown on and the line it flew in the step is asked what it met, and whoever
// fired it is told. Every page draws the entries (`volley3d.plugin.ts`), and the page that fired a
// round draws its own from the frame it was fired.
//
// The one row of this kind is the ledger. Its prefab is `next`, the id the next entry gets, and
// `live`, the entries, and nothing else, since a prefab field goes onto the row and a row goes to
// every seat every step. A field of the row that is neither throws, naming it, in its `before`. The
// fixed numbers are `world.volley3d`:
//   patterns  the name in the scene's `loader` catalogue of the data file that holds every pattern;
//   hold      the seconds an entry stays on the row once its round has ended, so every page, which
//             reads only the last packet it took, sees how it ended;
//   wait      the seconds a page keeps a round of its own that no entry of the row has matched
//             (`volley3d.plugin.ts`); this half never reads it;
//   mods      what volley3d asks other plugins for (`addons/scenemanager`'s mods), each optional:
//     shoot   `(w, from, dir, far, { skip, bodies, grow }) → { t, point, what, id?, part? }`, the
//             first thing a line from `from` along `dir`, any length, meets within `far` metres, or
//             undefined: `t` metres along it, the point there, `what` it is, `ground`, `solid` or
//             `body`, and a body's `id` and the `part` of it met. `skip` is ids of bodies the line
//             passes through; `bodies: false` passes through every body, so only the land stops it;
//             `grow` is metres every body is taken wider by, and longer by at both ends
//             (`hitscan3d.volley3d.ts`). With none, a round meets nothing.
//     bodies  `(w) → { id, pos, radius, height }[]`, every body a round can reach now, each an
//             upright cylinder `radius` round from its feet at `pos` up `height`: what a splash
//             reaches and what a guided round turns toward (`hitscan3d.volley3d.ts`). With none, no
//             round splashes a body and none is guided.
// A field of `world.volley3d` that is none of these throws, naming it.
//
// The patterns file is `{ patterns: { <name>: pattern } }`, and a pattern, in metres and seconds:
//   speed    metres a second along its aim the moment it is fired;
//   accel    metres a second added to that every second, a negative one taking them away, 0 when left
//            out: `t` seconds after it was fired its speed along its aim is `min(max, speed + accel·t)`;
//   max      the speed along its aim it never goes over, none when left out;
//   g        metres a second² it falls, on its own, beside its speed along its aim, 0 when left out;
//   life     the seconds it flies before it ends where it is, having met nothing;
//   radius   metres a body may be off its line and still be met: every body is met as if that much
//            wider and longer at both ends, 0 when left out; the ground and the solids meet its middle;
//   splash   metres: every body other than the one it met that is nearer than this to where it met
//            something is splashed; left out or 0, none is;
//   seek     radians a second its aim turns toward the target it was fired at; a pattern with none
//            flies straight whatever it was fired at;
//   look     `{ body, trail, burst }`, the particle3d effects a page draws it with: `body` carried
//            with it while it flies, `trail` thrown from it as it goes, and `burst` where it met
//            something; one left out draws nothing.
// A pattern with no `speed`, `life` or `look`, or with a field that is none of these, throws naming
// it, the first step after the file is read or written.
//
// `flight(pattern, at, dir, t)` is where a round fired from `at` along `dir`, any length, is `t`
// seconds on when nothing turns it, closed form: its speed along its aim as above, along the unit
// `dir`, and its fall, g·t²/2, down y. `velocity(pattern, dir, t)` is how fast it goes then, and
// `speedOf(pattern, t)` its speed along its aim. The two halves fly a round by them alike.
//
// `fire(w, pattern, at, dir, { from, n, skip, target })` puts an entry on the ledger and hands it
// back: `{ id, pattern, at, dir, age, from, n, skip, target?, ride?, pos, vel, hit? }`. `id` is the ledger's
// `next`; `at` and `dir` are as fired and `age` 0; `from` is the row that fired it, whose `landed` act
// is told what it met, and `n` the count that row gives its rounds, so `[from, n]` is the round's key,
// by which a page that fired the same round itself knows it; `skip` is ids of the bodies it passes
// through, its shooter's; `target` the id of the body it seeks, when fired at one; `ride` the row
// and the field of the point it rides, when fired to ride one (below); `pos` is where it
// is, `at` at first, and `vel` how fast it goes, its speed along `dir`.
//
// Each step, in `before`, every entry in flight is a step older, flown to its age or to the end of its
// life, whichever is sooner. So a round fired in a tick or an after is sent where it was fired, and one
// fired in an act a seat's message runs, which is answered before the step's passes, is sent a step
// on, as far as the page that sent the message has flown its own by then:
//   - an unguided one, its pattern with no `seek` or fired at no target, is where `flight` puts it;
//   - a guided one flies as `flight` would, but first each step its aim is turned toward the point it
//     is after, by no more than `seek` times the step; with no closed form of that, its `pos` and
//     `vel` are the ones written each step. The point is its `ride`'s while it has one: fired with
//     `ride` `{ id, field }`, it rides the point [x, y, z] row `id` carries in `field`, a laser's spot
//     say, wherever it moves to, for as long as the row carries one there. Otherwise it is the middle
//     of its target's body. With neither, a ride whose row has ended or carries no point and a target
//     that is not among `bodies`, the round flies on straight.
// The line it flew in the step, from where it was to where it is, is asked of `shoot`, passing
// through `skip`, every body grown by `radius`. At the first thing met, its `pos` is the point met and
// it writes `hit` `{ point, what, id, age }`: `id` the body's, null for the ground or a solid, and
// `age` its age as it met it, found along the step. Then it calls `landed(entry, what, id, part, 0)` on
// its `from` row, `id` and `part` null for the ground or a solid, and with a `splash`,
// `landed(entry, 'splash', id, null, far)` on it for every body but the one met whose `far`, the
// metres from the point to the nearest point of the body's upright cylinder, 0 inside it, is under
// `splash`: its shooter's too, since `skip` is the line's alone, and the act says what a splash of
// its own shooter does. A `from` row that has ended is told nothing. A round that reaches the end of
// its life meeting nothing ends there, with no hit, and tells nothing.
// An entry that has ended ages on and leaves the row `hold` seconds after it ended.
//
// `intercept(w, id)` shoots down entry `id` where it is: a round still in flight ends there, its
// `hit` `{ point, what: 'intercepted', id: null, age }` at its `pos` and age, telling nobody, and the
// page bursts it there as it bursts any hit the server writes. It returns whether it did: an entry
// that has ended, or none of that id, is left as it is.
import type { Kind, W } from '#engine/engine.ts'
import { mod } from '#addons/scenemanager/scenemanager.addon.ts'
import { json } from '#plugins/loader/loader.sim.ts'

export type Look = { body?: string; trail?: string; burst?: string }
export type Pattern = {
  speed: number; accel?: number; max?: number; g?: number; life: number; radius?: number; splash?: number; seek?: number; look: Look
}
export type Patterns = { patterns: Record<string, Pattern> }
export type Numbers = { patterns: string; hold: number; wait: number; mods?: Record<string, string> }
export type Hit = { point: number[]; what: string; id: number | null; age: number }
export type Entry = {
  id: number; pattern: string; at: number[]; dir: number[]; age: number; from: number; n: number; skip: number[]
  target?: number; ride?: Ride; pos: number[]; vel: number[]; hit?: Hit
}
export type Ride = { id: number; field: string }
// What `shoot` answers: the first thing a line meets.
export type Shot = { t: number; point: number[]; what: string; id?: number; part?: string }
export type Shoot = (w: W, from: number[], dir: number[], far: number, opts: { skip?: number[]; bodies?: boolean; grow?: number }) => Shot | undefined
export type Body = { id: number; pos: number[]; radius: number; height: number }
export type Bodies = (w: W) => Body[]

// The fields of the row, of `world.volley3d`, of a pattern and of its look.
const ROW = ['next', 'live']
export const WORLD = ['patterns', 'hold', 'wait', 'mods'] as const satisfies readonly (keyof Numbers)[]
export const FIELDS = ['speed', 'accel', 'max', 'g', 'life', 'radius', 'splash', 'seek', 'look'] as const satisfies readonly (keyof Pattern)[]
export const LOOK = ['body', 'trail', 'burst'] as const satisfies readonly (keyof Look)[]
const NEEDED = ['speed', 'life', 'look'] as const

// Throws for the first field of `world.volley3d`, of a pattern or of a pattern's look that volley3d
// does not read, and for a pattern with no speed, life or look.
export function check(file: Patterns, own: Record<string, unknown>) {
  for (const k of Object.keys(own)) if (!(WORLD as readonly string[]).includes(k)) throw new Error(`world.volley3d has ${k}, which volley3d does not know`)
  if (checked.has(file.patterns)) return
  for (const [name, p] of Object.entries(file.patterns)) {
    for (const k of Object.keys(p)) if (!(FIELDS as readonly string[]).includes(k)) throw new Error(`volley3d pattern ${name} has ${k}, which volley3d does not know`)
    for (const k of NEEDED) if (p[k] === undefined) throw new Error(`volley3d pattern ${name} has no ${k}`)
    for (const k of Object.keys(p.look)) if (!(LOOK as readonly string[]).includes(k)) throw new Error(`volley3d pattern ${name}'s look has ${k}, which volley3d does not know`)
  }
  checked.add(file.patterns)
}
// The `patterns` of each read of the file that has been checked: a file the editor writes is
// refilled in place with a new `patterns`, so a new read is checked again.
const checked = new WeakSet<object>()

export function patternOf(file: Patterns, name: string): Pattern {
  const p = file.patterns[name]
  if (!p) throw new Error(`volley3d has no pattern ${name}`)
  return p
}

const unit = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2])
  if (!(l > 0)) throw new Error('volley3d is asked a round along no direction')
  return [v[0] / l, v[1] / l, v[2] / l]
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// Its speed along its aim `t` seconds on: `min(max, speed + accel·t)`.
export const speedOf = (p: Pattern, t: number) => Math.min(p.max ?? Infinity, p.speed + (p.accel ?? 0) * t)

// How far along its aim it has gone `t` seconds on: the speed above, summed. The speed is at `max`
// on one side of the moment `speed + accel·t` reaches it, and grows or falls with `accel` on the
// other.
function along(p: Pattern, t: number): number {
  const v = p.speed, a = p.accel ?? 0, m = p.max ?? Infinity
  if (a === 0) return Math.min(m, v) * t
  const lin = (u0: number, u1: number) => v * (u1 - u0) + (a * (u1 * u1 - u0 * u0)) / 2
  // Held at `max` for `u` seconds: none at all when there is no max to hold at.
  const held = (u: number) => (u > 0 ? m * u : 0)
  const at = Math.min(t, Math.max(0, (m - v) / a))
  return a > 0 ? lin(0, at) + held(t - at) : held(at) + lin(at, t)
}

export function flight(p: Pattern, at: number[], dir: number[], t: number): number[] {
  const d = unit(dir), s = along(p, t), fall = ((p.g ?? 0) * t * t) / 2
  return [at[0] + d[0] * s, at[1] + d[1] * s - fall, at[2] + d[2] * s]
}

export function velocity(p: Pattern, dir: number[], t: number): number[] {
  const d = unit(dir), s = speedOf(p, t)
  return [d[0] * s, d[1] * s - (p.g ?? 0) * t, d[2] * s]
}

// Whether a round of this pattern fired so is guided.
export const guided = (p: Pattern, e: { target?: number; ride?: Ride }) => p.seek !== undefined && (e.target !== undefined || e.ride !== undefined)

// The point a ride's row carries in its field, when it holds one: three finite numbers.
function ridden(w: W, ride: Ride): number[] | undefined {
  if (!holds(w, ride.id)) return undefined
  const v = w.get(ride.id).data[ride.field]
  return Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(x)) ? v : undefined
}

// A body's middle, which a guided round turns toward.
const middle = (b: Body) => [b.pos[0], b.pos[1] + b.height / 2, b.pos[2]]

// Metres from a point to the nearest point of a body's upright cylinder, 0 inside it.
export function far(b: Body, p: number[]): number {
  const across = Math.max(0, Math.hypot(p[0] - b.pos[0], p[2] - b.pos[2]) - b.radius)
  const up = Math.max(0, b.pos[1] - p[1], p[1] - (b.pos[1] + b.height))
  return Math.hypot(across, up)
}

// A guided round's aim at its age: its velocity with its fall taken off, over its speed along its
// aim; the way it was fired while that speed is nothing.
function aimOf(p: Pattern, e: Entry): number[] {
  const s = speedOf(p, e.age)
  if (Math.abs(s) < 1e-12) return unit(e.dir)
  const v = [e.vel[0] / s, (e.vel[1] + (p.g ?? 0) * e.age) / s, e.vel[2] / s]
  return unit(v)
}

// Unit `h` turned toward unit `want` by no more than `most` radians.
function turn(h: number[], want: number[], most: number): number[] {
  const c = Math.min(1, Math.max(-1, dot(h, want)))
  if (Math.acos(c) <= most) return want
  let q = [want[0] - h[0] * c, want[1] - h[1] * c, want[2] - h[2] * c]
  if (Math.hypot(q[0], q[1], q[2]) < 1e-12) q = Math.abs(h[1]) < 0.9 ? [h[2], 0, -h[0]] : [1, 0, 0]
  const n = unit(q), cos = Math.cos(most), sin = Math.sin(most)
  return unit([h[0] * cos + n[0] * sin, h[1] * cos + n[1] * sin, h[2] * cos + n[2] * sin])
}

const numbersOf = (w: W): Numbers => {
  const n = w.world.volley3d as Numbers | undefined
  if (!n) throw new Error('the scene names volley3d but gives no world.volley3d')
  return n
}

const fileOf = (w: W): Patterns => {
  const own = numbersOf(w)
  const file: Patterns = json(w, own.patterns)
  check(file, own)
  return file
}

const ledgerOf = (w: W) => {
  const rows = w.all('volley3d')
  if (rows.length !== 1) throw new Error(`volley3d needs one ledger row, and the scene has ${rows.length}`)
  return rows[0].data
}

// Whether the scene has row `id`.
const holds = (w: W, id: number) => {
  try {
    w.get(id)
    return true
  } catch {
    return false
  }
}

// One step of a round in flight: flown on, and its line asked what it met, which its `from` is told.
function fly(w: W, e: Entry, p: Pattern, dt: number) {
  const t0 = e.age, t1 = Math.min(t0 + dt, p.life)
  const g = p.g ?? 0
  let to: number[], vel: number[]
  if (guided(p, e)) {
    let aim = aimOf(p, e)
    const body = e.target === undefined ? undefined : mod<Bodies>(w.world, 'volley3d', 'bodies')?.(w).find(b => b.id === e.target)
    const m = (e.ride && ridden(w, e.ride)) ?? (body && middle(body))
    if (m) {
      const d = [m[0] - e.pos[0], m[1] - e.pos[1], m[2] - e.pos[2]]
      if (Math.hypot(d[0], d[1], d[2]) > 1e-9) aim = turn(aim, unit(d), p.seek! * (t1 - t0))
    }
    const s = along(p, t1) - along(p, t0), fall = (g * (t1 * t1 - t0 * t0)) / 2
    to = [e.pos[0] + aim[0] * s, e.pos[1] + aim[1] * s - fall, e.pos[2] + aim[2] * s]
    const v = speedOf(p, t1)
    vel = [aim[0] * v, aim[1] * v - g * t1, aim[2] * v]
  } else {
    to = flight(p, e.at, e.dir, t1)
    vel = velocity(p, e.dir, t1)
  }
  e.age += dt
  const gap = [to[0] - e.pos[0], to[1] - e.pos[1], to[2] - e.pos[2]]
  const length = Math.hypot(gap[0], gap[1], gap[2])
  const shoot = mod<Shoot>(w.world, 'volley3d', 'shoot')
  const met = shoot && length > 0 ? shoot(w, e.pos, gap, length, { skip: e.skip, grow: p.radius ?? 0 }) : undefined
  if (!met) {
    e.pos = to
    e.vel = vel
    return
  }
  const age = t0 + (t1 - t0) * (met.t / length)
  const id = met.what === 'body' ? (met.id ?? null) : null
  e.pos = met.point.slice()
  e.vel = guided(p, e) ? vel : velocity(p, e.dir, age)
  e.hit = { point: met.point.slice(), what: met.what, id, age }
  if (!holds(w, e.from)) return
  w.call(w.get(e.from), 'landed', -1, e.id, met.what, id, id === null ? null : (met.part ?? null), 0)
  if (!p.splash) return
  for (const b of mod<Bodies>(w.world, 'volley3d', 'bodies')?.(w) ?? []) {
    if (b.id === id) continue
    const k = far(b, met.point)
    if (k < p.splash && holds(w, e.from)) w.call(w.get(e.from), 'landed', -1, e.id, 'splash', b.id, null, k)
  }
}

// The age an entry's round ends at: when it met something, else the end of its life.
const endOf = (e: Entry, p: Pattern) => e.hit?.age ?? p.life

// Whether an entry's round has ended: it met something, or its life is over. An age is a sum of
// steps, which falls short of a whole number of them by a rounding.
export const ended = (e: Entry, p: Pattern) => !!e.hit || e.age >= p.life - 1e-9

export const volley3d: Kind = {
  before(me, dt, w) {
    const d = me.data
    for (const k of Object.keys(d)) if (!ROW.includes(k)) throw new Error(`the volley3d prefab has ${k}, which volley3d does not know`)
    const { hold } = numbersOf(w)
    const file = fileOf(w)
    // What a `landed` act fires meanwhile is put on the same list, and goes on from the next step.
    const was = d.live as Entry[], count = was.length
    const kept: Entry[] = []
    for (const e of was.slice(0, count)) {
      const p = patternOf(file, e.pattern)
      if (ended(e, p)) e.age += dt
      else fly(w, e, p, dt)
      if (!ended(e, p) || e.age < endOf(e, p) + hold - 1e-9) kept.push(e)
    }
    d.live = [...kept, ...was.slice(count)]
  },
}

export function intercept(w: W, id: number): boolean {
  const e = (ledgerOf(w).live as Entry[]).find(e => e.id === id)
  if (!e || ended(e, patternOf(fileOf(w), e.pattern))) return false
  e.hit = { point: e.pos.slice(), what: 'intercepted', id: null, age: e.age }
  return true
}

export function fire(w: W, pattern: string, at: number[], dir: number[], by: { from: number; n: number; skip: number[]; target?: number; ride?: Ride }): Entry {
  const ledger = ledgerOf(w)
  const p = patternOf(fileOf(w), pattern)
  const entry: Entry = {
    id: ledger.next++, pattern, at: [...at], dir: [...dir], age: 0, from: by.from, n: by.n, skip: [...by.skip],
    pos: [...at], vel: velocity(p, dir, 0),
  }
  if (by.target !== undefined) entry.target = by.target
  if (by.ride !== undefined) entry.ride = { id: by.ride.id, field: by.ride.field }
  ledger.live.push(entry)
  return entry
}
