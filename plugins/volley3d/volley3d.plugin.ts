// The browser half of volley3d: every launched round the page draws, drawn through particle3d. The
// server half (`volley3d.sim.ts`) says what a pattern holds, what every field of `world.volley3d`
// means, how a round flies and what an entry of the ledger row carries.
//
// A round is drawn with the effects its pattern's `look` names, each the page's own (particle3d's
// `emit`): `body` carried with it, turned along the way it goes, from the frame it is first drawn
// until it ends; `trail` thrown from where it is as it goes, stopped when it ends; and `burst` thrown
// where it met something, back the way it came. A round that ends at the end of its life, meeting
// nothing, stops its body and its trail and bursts nowhere. So this plugin is listed before
// particle3d, which is listed before render3d: an effect it emits or moves in its `afterTick` is then
// drawn that same frame, where listed after particle3d every round would be drawn a frame late, and
// that throws, as a scene that names no particle3d does.
//
// The rounds drawn are of two sorts:
//   - The page's own. `fire(pattern, at, dir, key)` draws a round at once, from `at` along `dir`: its
//     age is 0 the frame it is fired and a step of the scene's `dt` more each frame after, on the
//     page's own clock, and it is where `flight` puts it at that age. A firing rule gives its entry the
//     key `[from, n]`, the row that fired it and that row's count of its rounds, and the page that ran
//     the same rule fires it with the same key: the server's entry of that key, when a packet brings
//     it, is adopted, and the round is not drawn twice. The page keeps flying its own round and takes
//     from the entry only what it met, since the entry, a round trip behind, is not where the page's
//     round is; a guided round, which no closed form flies, is drawn from the entry's `pos` carried on
//     along its `vel` to the page's own age. A round of the page's own that no entry has matched
//     `world.volley3d.wait` seconds after it was fired is dropped, as one the server never fired, a
//     press it refused say. A key already drawn is not fired again. With no key, a round is the page's
//     alone, which the server has no entry of and no key can match, what an editor previews a pattern
//     with: `fire` hands back the key it makes for it, `[0, k]`, since no row is row 0, and it is drawn
//     to the end of its flight and for `world.volley3d.hold` seconds after, as an entry is kept.
//   - The server's, every other entry of the ledger row the last packet carried, drawn from its age:
//     where `flight` puts it at the entry's age, or at a guided one's `pos`. Such a round is drawn for
//     as long as the row holds its entry, as an adopted one is.
// Where a round met something is the server's: the entry's `hit`, which the round takes the frame a
// packet brings it, stopping where it met and bursting there. The page decides only what no row moves:
// each frame the line a round flew since the last, from where it was drawn to where it is, is asked
// of the scene's `shoot` mod (`world.volley3d.mods`) with bodies passed through, on the rows this page
// draws, since the scene's mods are imported on the page as on the server; a round that reaches the
// ground or a solid there stops at once and bursts there, before the packet that says so, and the
// server's `hit`, when it comes, bursts it again only when it met a body, which the page never
// decides. A scene with no `shoot` mod has its rounds burst where the server says alone.
//
// `volleys()` is every round the page has, `{ key, pos, local, hit }`: its key, where it is drawn,
// whether it is the page's own, and what it met: the server's `hit`, or, until that comes,
// `{ point, what, id }` of the ground or a solid the page found, `id` null. A round leaves it the
// frame its entry leaves the row, the frame it is dropped, or, for one of the page's alone, `hold`
// seconds after it ended.
//
// One of these per client: its rounds are its scene's, and `close` forgets them, the effects being
// particle3d's.
import type { Row, W } from '#engine/engine.ts'
import type { Plugins, Wire } from '#engine/browser.ts'
import { mod } from '#addons/scenemanager/scenemanager.addon.ts'
import { json } from '#plugins/loader/loader.sim.ts'
import type { Effect } from '#plugins/particle3d/particle3d.plugin.ts'
import { check, flight, guided, patternOf, velocity, type Entry, type Numbers, type Hit, type Pattern, type Patterns, type Shoot } from './volley3d.sim.ts'

export type Key = [number, number]
// What a round met: the server's `hit`, or the ground or a solid the page found first, which has no
// `age`.
export type Met = Omit<Hit, 'age'> & { age?: number }
export type Volley = { key: Key; pos: number[]; local: boolean; hit?: Met }

type Round = {
  key: Key; pattern: string; at: number[]; dir: number[]
  age: number // the page's own clock for its own rounds, the entry's age for the server's
  local: boolean
  alone: boolean // the page's alone: no entry is looked for
  fresh: boolean // fired since the last frame: its age is where it starts
  entry?: Entry
  pos: number[]; vel: number[]
  drawn?: number[] // where it was drawn last frame
  hit?: Met
  burst?: 'land' | 'server' // what it last burst at: the ground or a solid the page found, or the server's hit
  over?: number // for one of the page's alone, its age when it ended
  body?: Effect; trail?: Effect
}

const same = (a: Key, b: Key) => a[0] === b[0] && a[1] === b[1]
const unit = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2])
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : undefined
}

// The rows this page draws, as the scene's mods read them, never written.
const reading = (wire: Wire): W => {
  const refuse = (what: string) => () => { throw new Error(`volley3d's page reading the rows does not ${what}`) }
  const get = (id: number): Row => {
    const r = wire.rows.find(r => r.id === id)
    if (!r) throw new Error(`no row ${id} in this packet`)
    return r
  }
  return {
    world: wire.scene.world ?? {},
    all: kind => wire.rows.filter(r => r.kind === kind),
    get,
    find: (kind, pred = () => true) => {
      const r = wire.rows.find(r => r.kind === kind && pred(r))
      if (!r) throw new Error(`no ${kind} matches in this packet`)
      return r
    },
    spawn: refuse('spawn'),
    end: refuse('end a row'),
    die: refuse('roll'),
    call: refuse('call an act'),
  }
}

export function volley3d() {
  let rounds: Round[] = []
  let previews = 0
  let checked = false

  // Its effects stopped where it is.
  const stop = (r: Round) => {
    for (const fx of [r.body, r.trail]) {
      if (!fx) continue
      fx.at = r.pos.slice()
      fx.life = fx.age
    }
    r.body = r.trail = undefined
  }

  const burst = (plugins: Plugins, p: Pattern, r: Round, at: number[]) => {
    const back = unit(r.vel)
    if (p.look.burst) plugins.particle3d.emit(p.look.burst, at, back ? { dir: back.map(c => -c) } : {})
  }

  // Where a round is this frame, and how fast it goes: the page's own on its clock, the server's at its
  // entry's age; a guided one from its entry once there is one.
  const place = (p: Pattern, r: Round) => {
    const e = r.entry
    if (e && guided(p, e)) {
      const ahead = Math.max(0, Math.min(r.age, p.life) - e.age)
      r.pos = e.pos.map((c, i) => c + e.vel[i] * ahead)
      r.vel = e.vel.slice()
      return
    }
    const t = Math.min(r.age, p.life)
    r.pos = flight(p, r.at, r.dir, t)
    r.vel = velocity(p, r.dir, t)
  }

  return {
    // A round of the page's own, drawn from this frame on; with no key, the page's alone. Its key.
    fire(pattern: string, at: number[], dir: number[], key?: Key): Key {
      const k: Key = key ? [key[0], key[1]] : [0, ++previews]
      if (rounds.some(r => same(r.key, k))) return k
      rounds.push({
        key: k, pattern, at: at.slice(), dir: dir.slice(), age: 0, local: true, alone: !key, fresh: true,
        pos: at.slice(), vel: [0, 0, 0],
      })
      return k
    },
    // Every round drawn.
    volleys(): Volley[] {
      return rounds.map(r => ({ key: [r.key[0], r.key[1]] as Key, pos: r.pos.slice(), local: r.local, ...(r.hit ? { hit: structuredClone(r.hit) } : {}) }))
    },
    afterTick(plugins: Plugins) {
      const { wire } = plugins
      const { scene } = wire
      const own = scene.world?.volley3d as Numbers | undefined
      if (!own) throw new Error('the scene names volley3d but gives no world.volley3d')
      if (!checked) {
        checked = true
        const order = scene.plugins!
        if (!order.includes('particle3d')) throw new Error('volley3d draws its rounds through particle3d, which this scene does not name')
        if (order.indexOf('particle3d') < order.indexOf('volley3d'))
          throw new Error('volley3d is listed after particle3d, which would draw every round a frame late')
      }
      const dt = scene.prefabs.engine?.dt
      if (!dt) throw new Error('scene has no engine prefab with dt')
      const file: Patterns = json(wire, own.patterns)
      check(file, own)
      const shoot = mod<Shoot>(scene.world ?? {}, 'volley3d', 'shoot')
      const w = reading(wire)

      // The ledger the last packet carried: each entry the round of its key, adopted or drawn anew.
      const live: Entry[] = wire.rows.find(r => r.kind === 'volley3d')?.data.live ?? []
      const held = new Set<Round>()
      for (const e of live) {
        const key: Key = [e.from, e.n]
        let r = rounds.find(r => !r.alone && same(r.key, key))
        if (!r) {
          r = { key, pattern: e.pattern, at: e.at.slice(), dir: e.dir.slice(), age: e.age, local: false, alone: false, fresh: true, pos: e.pos.slice(), vel: e.vel.slice() }
          rounds.push(r)
        }
        r.entry = e
        held.add(r)
      }

      const kept: Round[] = []
      for (const r of rounds) {
        // One of the page's alone whose pattern the file no longer has, as a file the editor has written
        // may say, and a round whose entry has gone from the row: drawn no more.
        if ((r.alone && !(r.pattern in file.patterns)) || (!r.alone && r.entry && !held.has(r))) {
          stop(r)
          continue
        }
        if (!r.local) r.age = r.entry!.age
        else if (!r.fresh) r.age += dt
        r.fresh = false
        // A round of the page's own no entry has matched in time.
        if (r.local && !r.alone && !r.entry && r.age >= own.wait - 1e-9) {
          stop(r)
          continue
        }
        const p = patternOf(file, r.pattern)
        if (!r.hit) place(p, r)
        // The ground or a solid, met on the page since the round was last drawn.
        if (!r.hit && shoot && r.drawn) {
          const gap = r.pos.map((c, i) => c - r.drawn![i])
          const length = Math.hypot(gap[0], gap[1], gap[2])
          const met = length > 0 ? shoot(w, r.drawn, gap, length, { bodies: false }) : undefined
          if (met) {
            r.hit = { point: met.point.slice(), what: met.what, id: null }
            r.pos = met.point.slice()
            r.burst = 'land'
            burst(plugins, p, r, r.pos)
          }
        }
        // What the server says it met.
        const said = r.entry?.hit
        if (said && r.burst !== 'server') {
          r.hit = said
          r.pos = said.point.slice()
          if (r.burst === undefined || said.what === 'body') burst(plugins, p, r, r.pos)
          r.burst = 'server'
        }
        // Its effects: put on the first frame it is drawn flying, carried with it, and stopped once it
        // has ended.
        const flying = !r.hit && r.age < p.life - 1e-9
        const way = unit(r.vel)
        if (flying && !r.drawn) {
          const spawn = { life: Infinity, ...(way ? { dir: way } : {}) }
          if (p.look.body) r.body = plugins.particle3d.emit(p.look.body, r.pos, spawn)
          if (p.look.trail) r.trail = plugins.particle3d.emit(p.look.trail, r.pos, spawn)
        }
        if (!flying) stop(r)
        for (const fx of [r.body, r.trail]) {
          if (!fx) continue
          fx.at = r.pos.slice()
          if (way) fx.dir = way
        }
        r.drawn = r.pos.slice()
        // One of the page's alone is kept `hold` seconds after it ends, as an entry is.
        if (r.alone && !flying) {
          r.over ??= r.age
          if (r.age >= r.over + own.hold - 1e-9) continue
        }
        kept.push(r)
      }
      rounds = kept
    },
    close() {
      rounds = []
    },
  }
}

