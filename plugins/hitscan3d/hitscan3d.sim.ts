// hitscan3d: a shot along a line through a 3D world, answered with the first thing it meets: the
// ground, a solid standing on it, or a body. The server half (this file) answers; the browser half
// (`hitscan3d.plugin.ts`) tells a page's shot which step it was aimed at.
//
// What a line meets is asked of other plugins through mods (`addons/scenemanager`), each named in
// `world.hitscan3d.mods`, and each optional:
//   ground   `(w, from, dir, far) → { t, normal } | undefined`, the first point of the ground along
//            the line (`terrain3d.hitscan3d.ts`).
//   solids   `(w, from, dir, far) → { x, z, radius, base, tall? }[]`, every solid standing on it, a
//            trunk or a boulder, whose circle the line's path over the ground crosses within `far`:
//            an upright cylinder about (x, z) from `base` up `tall`, or without end when it has none
//            (`scatter3d.hitscan3d.ts`).
//   bodies   `(w) → { id, kind, pos, radius, height }[]`, every body that could be hit, standing
//            upright, `pos` its feet (`walker.hitscan3d.ts`).
// `t` is metres along `dir` from `from`, `dir` any length (it is normalised), `normal` the surface's,
// unit length. `far` is the most metres a line is asked along.
//
// The rest of `world.hitscan3d`:
//   kinds    `{ <kind>: { parts, tall?, off? } }`: the kinds of body a shot can hit, and no other.
//            A body is an upright cylinder of its `radius`, from its feet to `height` above them, or
//            to the row's field that `tall` names when the row carries it (a crouch). `parts` is
//            `{ <part>: [from, to] }`, fractions of that height from the feet; a shot says which part
//            it met, the first whose band holds where it met the body. A row whose field `off`
//            names is truthy (a body lying dead) is not hit.
//   rewind   steps: how far back a shot may be aimed.
//
// Aiming back. A seat sees the other bodies where the last packet it took put them, some steps
// behind the server by the time its shot arrives, so a shot is checked against the bodies as that
// packet held them. That needs a `hitscan3d` row, made by one actor entry: its `after` counts the
// steps in its field `n` and keeps where every body stood at the end of each of the last `rewind`
// steps, under the `n` the step's packet carries. A page reads `n` off the row in the packet it
// draws and hands it to the shot (`seen` on the browser half), and `shoot`'s `seen` puts each body
// back where it stood then; a `seen` older than `rewind` steps is taken as the oldest kept, and a
// `seen` newer than the last step, or one given in a scene with no `hitscan3d` row, as now. What is
// kept is the plugin's own memory, one per row, built from the rows as the steps run, and sent to no
// seat: a truth rebuilt by replaying its steps keeps it again. A body is only put back, never
// brought back: one that has ended since is not there, and whether it is `off` is read off its row now.
//
// `shoot(w, from, dir, far, { skip, seen, bodies, grow })` is the first thing the line meets within
// `far`: `{ t, point, normal, what }`, `what` being `ground`, `solid` or `body`, with `id`, `kind` and
// `part` when it is a body, or undefined when it meets nothing. `skip` is ids of bodies it passes
// through (the shooter); `bodies: false` passes through every body, for a line only the ground and the
// solids stop (a camera kept out of a hill); `grow` is metres every body is taken wider by, and longer
// by at both ends, 0 when left out, for a round with a size of its own, which meets a body its middle
// passes within that of: met below its feet or over its top, it is its lowest or its top part. A line
// starting inside a body meets it where it leaves it; a line starting inside a skipped body passes it
// by.
// `hittable(w)` is every body a shot can hit now, `{ id, kind, pos, radius, height }`: of a kind
// `kinds` lists, none lying `off`, each as tall as its row's `tall` field when it carries one.
// `sees(w, from, to)` is whether nothing of the ground or the solids stands between two points:
// bodies do not block a sight.
//
// hitscan3d answers other plugins through its own mods: `hitscan3d.volley3d.ts` hands volley3d
// `shoot` and `bodies`, so launched rounds meet what a shot meets.
import type { Kind, Row, W } from '#engine/engine.ts'
import { mod } from '#addons/scenemanager/scenemanager.addon.ts'

export type Surface = { t: number; normal: number[] }
export type Body = { id: number; kind: string; pos: number[]; radius: number; height: number }
export type Hit = { t: number; point: number[]; normal: number[]; what: 'ground' | 'solid' | 'body'; id?: number; kind?: string; part?: string }
export type Numbers = {
  kinds: Record<string, { parts: Record<string, [number, number]>; tall?: string; off?: string }>
  rewind: number
}

export type Solid = { x: number; z: number; radius: number; base: number; tall?: number }
type Ground = (w: W, from: number[], dir: number[], far: number) => Surface | undefined
type Solids = (w: W, from: number[], dir: number[], far: number) => Solid[]
type Bodies = (w: W) => Body[]

const kept = new WeakMap<Row, Map<number, Body[]>>()

const numbersOf = (w: W) => {
  const n = w.world.hitscan3d as Numbers | undefined
  if (!n) throw new Error('hitscan3d is asked a shot, and the scene gives no world.hitscan3d')
  return n
}

// The bodies a shot can hit now.
function bodiesOf(w: W): Body[] {
  const bodies = mod<Bodies>(w.world, 'hitscan3d', 'bodies')
  if (!bodies) return []
  const { kinds } = numbersOf(w)
  return bodies(w).filter(b => b.kind in kinds)
}

export const hitscan3d: Kind = {
  after(me, _dt, w) {
    const { rewind } = numbersOf(w)
    me.data.n = (me.data.n ?? 0) + 1
    let steps = kept.get(me)
    if (!steps) kept.set(me, steps = new Map())
    steps.set(me.data.n, bodiesOf(w).map(b => ({ ...b, pos: b.pos.slice() })))
    for (const k of steps.keys()) if (k <= me.data.n - rewind) steps.delete(k)
  },
}

// A body as a shot meets it now: none for one lying `off`, and as tall as its row's `tall` field when
// the row carries it (a crouch).
function upright(w: W, b: Body): Body | undefined {
  const k = numbersOf(w).kinds[b.kind]
  const row = w.get(b.id)
  if (k.off && row.data[k.off]) return undefined
  return k.tall !== undefined && typeof row.data[k.tall] === 'number' ? { ...b, height: row.data[k.tall] } : b
}

export const hittable = (w: W): Body[] => bodiesOf(w).flatMap(b => upright(w, b) ?? [])

// Where each body stood on the step `seen`, of those that are there now; now, with no `seen`.
function bodiesAt(w: W, seen: number | undefined): Body[] {
  const now = bodiesOf(w)
  if (seen === undefined) return now
  const row = w.all('hitscan3d')[0]
  const steps = row && kept.get(row)
  if (!row || !steps || seen >= row.data.n) return now
  const oldest = Math.min(...steps.keys())
  const then = steps.get(Math.max(oldest, Math.floor(seen)))
  if (!then) return now
  const here = new Map(now.map(b => [b.id, b]))
  return then.filter(b => here.has(b.id)).map(b => ({ ...here.get(b.id)!, pos: b.pos }))
}

// Where a line from `o` along unit `d` first meets an upright cylinder about `c`'s x and z, from y0 up
// to y1 (Infinity for one without end), within `far`; from inside, where it leaves it.
export function cylinder(o: number[], d: number[], far: number, c: number[], r: number, y0: number, y1: number): Surface | undefined {
  let best: Surface | undefined
  const take = (t: number, normal: number[]) => { if (t >= 0 && t <= far && (!best || t < best.t)) best = { t, normal } }
  const ox = o[0] - c[0], oz = o[2] - c[2]
  const a = d[0] * d[0] + d[2] * d[2]
  const inside = ox * ox + oz * oz <= r * r
  if (a > 1e-12) {
    const b = ox * d[0] + oz * d[2]
    const disc = b * b - a * (ox * ox + oz * oz - r * r)
    if (disc >= 0) {
      const s = Math.sqrt(disc)
      const t = inside ? (-b + s) / a : (-b - s) / a
      const y = o[1] + d[1] * t
      if (y >= y0 && y <= y1) {
        const px = ox + d[0] * t, pz = oz + d[2] * t
        const l = Math.hypot(px, pz) || 1
        take(t, inside ? [-px / l, 0, -pz / l] : [px / l, 0, pz / l])
      }
    }
  }
  if (Math.abs(d[1]) > 1e-12)
    for (const [y, up] of [[y1, 1], [y0, -1]] as const) {
      if (!Number.isFinite(y)) continue
      const t = (y - o[1]) / d[1]
      const px = ox + d[0] * t, pz = oz + d[2] * t
      if (px * px + pz * pz <= r * r) take(t, [0, up, 0])
    }
  return best
}

// Where a line from `from` along unit `d` first meets a solid within `far`, of those the scene's
// `solids` mod stands along it.
function solidAlong(w: W, from: number[], d: number[], far: number): Surface | undefined {
  const solids = mod<Solids>(w.world, 'hitscan3d', 'solids')
  let best: Surface | undefined
  for (const s of solids?.(w, from, d, far) ?? []) {
    const hit = cylinder(from, d, far, [s.x, s.base, s.z], s.radius, s.base, s.tall === undefined ? Infinity : s.base + s.tall)
    if (hit && (!best || hit.t < best.t)) best = hit
  }
  return best
}

const unit = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2])
  if (!(l > 0)) throw new Error('hitscan3d is asked a shot along no direction')
  return [v[0] / l, v[1] / l, v[2] / l]
}

export function shoot(w: W, from: number[], dir: number[], far: number, opts: { skip?: number[]; seen?: number; bodies?: boolean; grow?: number } = {}): Hit | undefined {
  const d = unit(dir)
  const { kinds } = numbersOf(w)
  let best: Hit | undefined
  const take = (s: Surface | undefined, what: Hit['what'], body?: { id: number; kind: string; part: string }) => {
    if (s && (!best || s.t < best.t)) best = { t: s.t, point: [from[0] + d[0] * s.t, from[1] + d[1] * s.t, from[2] + d[2] * s.t], normal: s.normal, what, ...body }
  }
  const ground = mod<Ground>(w.world, 'hitscan3d', 'ground')
  if (ground) take(ground(w, from, d, far), 'ground')
  take(solidAlong(w, from, d, best?.t ?? far), 'solid')
  const skip = new Set(opts.skip ?? [])
  const grow = opts.grow ?? 0
  for (const b of opts.bodies === false ? [] : bodiesAt(w, opts.seen)) {
    if (skip.has(b.id)) continue
    const up = upright(w, b)
    if (!up) continue
    const tall = up.height, k = kinds[b.kind]
    const s = cylinder(from, d, best?.t ?? far, b.pos, b.radius + grow, b.pos[1] - grow, b.pos[1] + tall + grow)
    if (!s) continue
    // Where on the body, 0 at its feet and 1 at its top: a cap's own rounding can put it a hair outside,
    // and a body grown by `grow` well outside, under its feet or over its top.
    const f = Math.min(1, Math.max(0, (from[1] + d[1] * s.t - b.pos[1]) / tall))
    const part = Object.entries(k.parts).find(([, [lo, hi]]) => f >= lo && f <= hi)?.[0]
    if (part === undefined) throw new Error(`hitscan3d: a shot met a ${b.kind} ${f.toFixed(2)} of its height up, where none of its parts is`)
    take(s, 'body', { id: b.id, kind: b.kind, part })
  }
  return best
}

export function sees(w: W, from: number[], to: number[]): boolean {
  const dir = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  const far = Math.hypot(dir[0], dir[1], dir[2])
  if (far === 0) return true
  const d = unit(dir)
  const ground = mod<Ground>(w.world, 'hitscan3d', 'ground')
  return !ground?.(w, from, d, far) && !solidAlong(w, from, d, far)
}
