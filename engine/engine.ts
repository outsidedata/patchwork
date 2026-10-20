// The server side: the game state, the step, and a packet per seat.

export type Row = { id: number; kind: string; data: any }
export type Scene = {
  world?: Record<string, any>
  prefabs: Record<string, any>
  actors: ({ is: string } & Record<string, any>)[]
  plugins?: string[]
  seats?: number
  [block: string]: unknown // any other top-level block of the scene file, for whatever reads it
}
export type Arg = number | string | boolean | null
export type Msg = { seq: number; n: number; id: number; action: string; args: Arg[] }
export type Packet = { n: number; ack: number; rows: Row[]; born: number[]; ended: number[] }
// `send` returns whether the pipe took the message. A pipe that refuses it returns false and the
// browser side treats the message as never made.
export type Pipe = { send(msg: Msg): boolean; take(): Packet[]; close(): void }

export type W = {
  world: any
  all(kind: string): Row[]
  get(id: number): Row
  find(kind: string, pred?: (r: Row) => boolean): Row
  spawn(kind: string, data?: any): Row
  end(row: Row): void
  die(): number
  call(row: Row, action: string, seat: number, ...args: Arg[]): void
}
export type Hook = (me: Row, dt: number, w: W) => void
export type Act = (me: Row, w: W, seat: number, ...args: any[]) => void
export type Kind = { before?: Hook; tick?: Hook; after?: Hook; acts?: Record<string, Act>; open?: string[] }
export type Sim = Record<string, Kind>

const PASSES = ['before', 'tick', 'after'] as const

// ---------------------------------------------------------------- seed

// Seeded random.
export type Die = { (): number; state: number }

export function seeded(seed: number): Die {
  const die = (() => {
    die.state = (die.state + 0x6d2b79f5) >>> 0
    let t = die.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Die
  die.state = seed >>> 0
  return die
}

export function noDie(why: string): Die {
  return Object.assign(() => { throw new Error(why) }, { state: 0 })
}

// ---------------------------------------------------------------- state

// `ended`: the ids of the rows ended since the step's passes began, which run nothing more.
type State = { rows: Row[]; ended: Set<number>; world: any; die: Die; nextId: number; sim: Sim; prefabs: Record<string, any> }

function state(scene: Scene, sim: Sim): State {
  const world = structuredClone(scene.world ?? {})
  const die = 'seed' in world ? seeded(world.seed) : noDie('scene has no seed')
  const rows = scene.actors.map(({ is, ...over }, i) => {
    if (!(is in scene.prefabs)) throw new Error(`no prefab for ${is}`)
    if (!(is in sim)) throw new Error(`no code for kind ${is}`)
    return { id: i + 1, kind: is, data: { ...structuredClone(scene.prefabs[is]), ...over } }
  })
  return { rows, ended: new Set(), world, die, nextId: rows.length + 1, sim, prefabs: scene.prefabs }
}

// What a kind's hooks and acts may touch. `as` runs a row's hook or act with that row as
// `running`; a row spawned meanwhile is handed to `spawned` with the running row, and a row
// spawned outside every hook and act with none.
function worldFor(st: State, spawned: (row: Row, by: Row | undefined) => void) {
  let running: Row | undefined
  const as = (row: Row, f: () => void) => {
    const was = running
    running = row
    try { f() } finally { running = was }
  }
  const spawn = (kind: string, data: any = {}) => {
    if (!(kind in st.prefabs)) throw new Error(`no prefab for ${kind}`)
    const row = { id: st.nextId++, kind, data: { ...structuredClone(st.prefabs[kind]), ...data } }
    st.rows.push(row)
    spawned(row, running)
    return row
  }
  const w: W = {
    world: st.world,
    all: kind => st.rows.filter(r => r.kind === kind),
    get: id => {
      const r = st.rows.find(r => r.id === id)
      if (!r) throw new Error(`no row ${id}`)
      return r
    },
    find: (kind, pred = () => true) => {
      const r = st.rows.find(r => r.kind === kind && pred(r))
      if (!r) throw new Error(`no ${kind} matches`)
      return r
    },
    spawn,
    end: row => {
      st.rows = st.rows.filter(r => r.id !== row.id)
      st.ended.add(row.id)
    },
    die: () => st.die(),
    call: (row, action, seat, ...args) => {
      const act = st.sim[row.kind]?.acts?.[action]
      if (!act) throw new Error(`no action ${row.kind}.${action}`)
      const raw = st.rows.find(r => r.id === row.id)
      if (!raw) throw new Error(`no row ${row.id}`)
      as(raw, () => act(raw, w, seat, ...args))
    },
  }
  return { w, as }
}

// ---------------------------------------------------------------- truth

type Seat = { possess: number | undefined; ack: number; inbox: Msg[]; closed: boolean; shown: Set<number> }
export type LogEntry = { at: number; seat: number; msg: Msg }

// Attached from outside. `show`, `accept` and `advance` must all say yes. `hide` names fields of a
// row the seat is sent without: the packet carries a copy with those fields deleted. `spawn` is
// handed every row spawned, with the row whose hook or act spawned it.
export type Piece = {
  show(seat: number, row: Row): boolean
  hide(seat: number, row: Row): string[]
  accept(seat: number, msg: Msg): boolean
  advance(): boolean
  spawn(row: Row, by: Row | undefined): void
}

export type Truth = ReturnType<typeof truthFrom>

export function boot(scene: Scene, sim: Sim) {
  return truthFrom(state(scene, sim), 0, scene, sim)
}

function truthFrom(st: State, n: number, scene: Scene, sim: Sim) {
  const seats: Seat[] = []
  const listeners: (() => void)[] = []
  const log: LogEntry[] = []
  const pieces: Piece[] = []
  const { w, as } = worldFor(st, (row, by) => { for (const p of pieces) p.spawn(row, by) })

  const refuse = (seat: Seat, m: Msg, why: string) => { seat.ack = Math.max(seat.ack, m.seq); void why }

  const answer = (i: number, m: Msg) => {
    const seat = seats[i]
    if (!pieces.every(p => p.accept(i, m))) return refuse(seat, m, 'dropped')
    const row = st.rows.find(r => r.id === m.id)
    if (!row) return refuse(seat, m, 'no row')
    const kind = st.sim[row.kind]
    const act = kind.acts?.[m.action]
    if (!act) return refuse(seat, m, 'no action')
    if (row.id !== seat.possess && !kind.open?.includes(m.action)) return refuse(seat, m, 'not yours')
    seat.ack = Math.max(seat.ack, m.seq)
    as(row, () => act(row, w, i, ...m.args))
  }

  const truth = {
    n,
    scene,
    sim,
    log,
    get rows() { return st.rows },
    get world() { return st.world },
    get seats() { return seats.length },
    step(dt: number) {
      if (!pieces.every(p => p.advance())) return
      for (let i = 0; i < seats.length; i++) {
        const seat = seats[i]
        const due = seat.inbox.filter(m => m.n <= truth.n).sort((a, b) => a.seq - b.seq)
        seat.inbox = seat.inbox.filter(m => m.n > truth.n)
        for (const m of due) answer(i, m)
      }
      // The rows standing as the passes begin are the step's: one spawned meanwhile runs from the
      // next step's `before`, and one ended runs nothing more.
      const rows = [...st.rows]
      st.ended.clear()
      for (const pass of PASSES) for (const row of rows) if (!st.ended.has(row.id)) as(row, () => st.sim[row.kind][pass]?.(row, dt, w))
      truth.n++
      for (const f of listeners) f()
    },
    open(possess?: number): number {
      if (possess !== undefined && !st.rows.some(r => r.id === possess)) throw new Error(`no row ${possess} to possess`)
      seats.push({ possess, ack: 0, inbox: [], closed: false, shown: new Set() })
      return seats.length - 1
    },
    close(seat: number) { seats[seat].closed = true },
    closed(seat: number) { return seats[seat].closed },
    inbox(seat: number, msg: Msg) {
      log.push({ at: truth.n, seat, msg })
      seats[seat].inbox.push(msg)
    },
    // Rows this seat may see, each a copy without the fields it may not, plus which are new or
    // gone since its last packet.
    packet(seat: number): Packet {
      const s = seats[seat]
      const rows = st.rows.filter(r => pieces.every(p => p.show(seat, r))).map(r => {
        const copy = structuredClone(r)
        for (const p of pieces) for (const field of p.hide(seat, r)) delete copy.data[field]
        return copy
      })
      const now = new Set(rows.map(r => r.id))
      const born = rows.map(r => r.id).filter(id => !s.shown.has(id))
      const ended = [...s.shown].filter(id => !now.has(id))
      s.shown = now
      return { n: truth.n, ack: s.ack, rows, born, ended }
    },
    attach(piece: Piece) { pieces.push(piece) },
    onStep(f: () => void) { listeners.push(f) },
    spawn(kind: string, data?: any): Row { return w.spawn(kind, data) },
    end(row: Row) { w.end(row) },
  }
  return truth
}
