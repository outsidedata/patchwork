// Music as notes: Tone.js synthesizers in the page. A note is sound, which no rule reads, so this
// plugin is the page's: no server half and no row of its own. A page's actors play it directly, a
// key down attacking a note and the key up releasing it; and a scene may let a row's field choose
// the song, so every seat hears the one the game is in.
//
// Its numbers are the scene's `world.synthaudio`:
//   parts   name to a part, one of:
//           { synth, poly?, options? }: a pitched instrument. `synth` one of `SYNTHS`, Tone's
//             synthesizers; `poly`, whether a PolySynth wraps it so it plays chords; `options`,
//             handed to Tone as they are (`oscillator`, `envelope`, …).
//           { kit }: drums. `kit` is note name to voice, `{ synth, gain?, pitch?, options? }`, as
//             General MIDI lays drums on notes (C1 a kick, D1 a snare, F#1 a closed hat): a note of
//             the part plays the voice its name names, at `pitch` when it has one, else at the note,
//             and a note no voice names plays nothing. A voice's `synth` is a membrane (kicks, toms),
//             noise (snares, claps) or metal (hats, cymbals), or any other of `SYNTHS`.
//           Either has `gain`, `pan` (-1 left to 1 right) and `effects`, the effects it goes out
//           through, in order, each `{ type, options? }`: `type` one of `EFFECTS`, `options` handed to
//           Tone as they are (a reverb's `decay`, a delay's `delayTime` and `feedback`, `wet`, …).
//           An effect that moves by itself (a chorus, a tremolo, an auto-filter) is started.
//   master  { compressor?, limiter? }: what every part goes out through last: a Compressor with
//           those options, then a Limiter at `limiter` dB.
//   songs   the loader `json` entries that are songs, by name.
//   music   { kind, path, fade? }: the song the field `path` (fields joined by dots) of the first row
//           of `kind` names plays, and none while it names none or there is no such row. When the
//           field changes the song changes on the next bar line of the one playing; with `fade`, the
//           music fades out over `fade` seconds, changes, and fades back in over as many. The whole
//           of it fades, the notes the keys play too. A scene with `music` has its song chosen by the
//           field; `play` and `stop` still play one until the field next changes.
//   volume  { level, muted }: the store keys the volume is read from, as audio's. Without it, or
//           without a store, the volume is 1.
//
// A song file: `{ bpm, length, tracks }`. Time is counted in sixteenth notes, whole numbers, so a
// grid edits it: `length` is the song's, and each track, keyed by a part's name, is a list of
// `[sixteenth, note, sixteenths long, velocity?]`, a note a name Tone reads ("C4", "F#3"). A bar is
// 16 sixteenths. A song's times are the transport's ticks, so a song that changes the tempo keeps
// every note where it was written.
//
// What it hands a page:
//   attack(part, note, vel?), release(part, note): a held note, now.
//   play(song), stop(), playing(): a song of `songs`, looped over its length, from its start, now.
//   audition(song, from?): a song given as its notes, as the editor holds it before it is saved,
//   looped, from `from` sixteenths into it, its start without;
//   at(): the sixteenth the song heard is at, or null; position(), the same unrounded; song(), the
//   song heard, as its notes. A song asked for is heard from the moment it starts, so until the bar
//   line it waits for these are the song before it.
//   held(): every note a key holds now, `{ part, note }`, attacked and not yet released.
//   notes(part): a kit's notes, lowest first; undefined for a pitched part.
// And for anyone who counts notes: `midi(name)`, a note's name as MIDI's number, and `named(n)` back.
//
// Each client has a Tone context of its own over an AudioContext of its own, never Tone's global
// one, since a page makes a client per scene. Node has no Web Audio: a client made there has no
// context and plays nothing. The context resumes on the first pointerdown or keydown on the page, as
// audio's does. `close` stops every note and the song, and closes the context.
import * as Tone from 'tone'
import type { Plugins } from '#engine/browser.ts'

export const SYNTHS = ['Synth', 'AMSynth', 'FMSynth', 'MonoSynth', 'DuoSynth', 'PluckSynth', 'MembraneSynth', 'MetalSynth', 'NoiseSynth'] as const
export const EFFECTS = [
  'Reverb', 'Freeverb', 'JCReverb', 'FeedbackDelay', 'PingPongDelay', 'Chorus', 'Phaser', 'Tremolo', 'Vibrato', 'AutoFilter',
  'AutoPanner', 'AutoWah', 'Filter', 'EQ3', 'Distortion', 'BitCrusher', 'Chebyshev', 'StereoWidener', 'Compressor',
] as const
type Options = Record<string, unknown>
export type Synth = (typeof SYNTHS)[number]
export type Effect = { type: (typeof EFFECTS)[number]; options?: Options }
export type Voice = { synth: Synth; gain?: number; pitch?: string; options?: Options }
export type Part = ({ synth: Synth; poly?: boolean; options?: Options } | { kit: Record<string, Voice> }) & { gain: number; pan?: number; effects?: Effect[] }
export type Note = [at: number, note: string, len: number, vel?: number]
export type Song = { bpm: number; length: number; tracks: Record<string, Note[]> }
export type Music = { kind: string; path: string; fade?: number }
export type Table = {
  parts: Record<string, Part>
  songs: string[]
  master?: { compressor?: Options; limiter?: number }
  music?: Music
  volume?: { level: string; muted: string }
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }
// A note's name as a number of semitones, C-1 at 0, as MIDI counts them; its name back.
export const midi = (name: string) => {
  const m = /^([A-G][#b]?)(-?\d+)$/.exec(name)
  if (!m) throw new Error(`synthaudio: ${name} is not a note`)
  return NAMES.indexOf(FLATS[m[1]] ?? m[1]) + 12 * (Number(m[2]) + 1)
}
export const named = (n: number) => NAMES[n % 12] + (Math.floor(n / 12) - 1)

// The seconds one sixteenth lasts at `bpm`.
export const sixteenth = (bpm: number) => 60 / bpm / 4
const BAR = 16

// One instrument: a note attacked, released, played for a while, every note let go, and gone.
type Inst = { attack(n: string, t?: number, v?: number): void; release(n: string, t?: number): void; play(n: string, d: string, t: number, v?: number): void; hush(): void; dispose(): void }
// A song on the transport: its notes, from the transport tick `from`, heard from context time `at`,
// and until context time `until` once something has been asked for in its place.
type Playing = { name: string; notes: Song; part: Tone.Part; from: number; at: number; until?: number }

const read = (rows: Plugins['wire']['rows'], m: Music) => {
  const row = rows.find(r => r.kind === m.kind)
  const v = row ? m.path.split('.').reduce<any>((o, k) => o?.[k], row.data) : undefined
  return typeof v === 'string' ? v : null
}

export function synthaudio() {
  const Raw = globalThis.AudioContext
  const context = Raw ? new Tone.Context(new Raw()) : undefined
  // Every part goes into the bus, then through the fader a fade moves, the store's volume, and the
  // master's compressor and limiter.
  let bus: Tone.Gain | undefined
  let fader: Tone.Gain | undefined
  let volume: Tone.Gain | undefined
  const tail: Tone.ToneAudioNode[] = []
  const parts = new Map<string, { play: (note: string) => Inst | undefined; nodes: Tone.ToneAudioNode[]; insts: Inst[] }>()
  let table: Table | undefined
  let plugins: Plugins | undefined
  const songs: Playing[] = [] // the song heard, then those asked for after it
  let wanted: string | null | undefined // the song the music field named last
  const held = new Map<string, { part: string; note: string }>() // every note a key holds, by part and note

  let listening = false
  const unlock = () => { void context!.resume(); off() }
  const off = () => {
    if (!listening) return
    listening = false
    removeEventListener('pointerdown', unlock)
    removeEventListener('keydown', unlock)
  }
  if (context && context.state !== 'running') {
    listening = true
    addEventListener('pointerdown', unlock)
    addEventListener('keydown', unlock)
  }

  // The bus and the master chain, made on the first tick, from `master`.
  function wire(t: Table) {
    const c = context!
    bus = new Tone.Gain({ context: c })
    fader = new Tone.Gain({ context: c })
    volume = new Tone.Gain({ context: c })
    if (t.master?.compressor) tail.push(new Tone.Compressor({ context: c, ...t.master.compressor }))
    if (t.master?.limiter !== undefined) tail.push(new Tone.Limiter({ context: c, threshold: t.master.limiter }))
    bus.chain(fader, volume, ...tail, c.destination)
  }

  function instrument(synth: Synth, poly: boolean, options: Options | undefined, out: Tone.ToneAudioNode, where: string): Inst {
    if (!SYNTHS.includes(synth)) throw new Error(`synthaudio ${where}: no synth ${synth}`)
    if (poly && synth === 'NoiseSynth') throw new Error(`synthaudio ${where}: a NoiseSynth plays no chords`)
    const c = context!
    const Made = Tone[synth] as any
    const s: any = poly ? new Tone.PolySynth({ context: c, voice: Made, options: options ?? {} }) : new Made({ context: c, ...options })
    s.connect(out)
    // A NoiseSynth has no pitch: its triggers take none.
    if (synth === 'NoiseSynth') return {
      attack: (_n, t, v) => s.triggerAttack(t, v),
      release: (_n, t) => s.triggerRelease(t),
      play: (_n, d, t, v) => s.triggerAttackRelease(d, t, v),
      hush: () => s.triggerRelease(),
      dispose: () => s.dispose(),
    }
    return {
      attack: (n, t, v) => s.triggerAttack(n, t, v),
      release: (n, t) => (poly ? s.triggerRelease(n, t) : s.triggerRelease(t)),
      play: (n, d, t, v) => s.triggerAttackRelease(n, d, t, v),
      hush: () => (poly ? s.releaseAll() : s.triggerRelease()),
      dispose: () => s.dispose(),
    }
  }

  // The part's instruments and its chain to the bus, made the first time it is played; `play(note)`
  // is the instrument that plays that note, which plays it at its own pitch when a kit voice has one.
  function part(name: string) {
    const had = parts.get(name)
    if (had) return had
    const p = table?.parts[name]
    if (!p) throw new Error(`synthaudio has no part ${name}`)
    const c = context!
    const input = new Tone.Gain({ context: c, gain: p.gain })
    const effects = (p.effects ?? []).map((e, i) => {
      if (!EFFECTS.includes(e.type)) throw new Error(`synthaudio part ${name} effect ${i}: no effect ${e.type}`)
      const fx: any = new (Tone[e.type] as any)({ context: c, ...e.options })
      if (typeof fx.start === 'function') fx.start()
      return fx as Tone.ToneAudioNode
    })
    const pan = new Tone.Panner({ context: c, pan: p.pan ?? 0 })
    input.chain(...effects, pan, bus!)
    const nodes: Tone.ToneAudioNode[] = [input, ...effects, pan]
    const insts: Inst[] = []
    let play: (note: string) => Inst | undefined
    if ('kit' in p) {
      const kit = new Map<number, Inst>()
      for (const [note, v] of Object.entries(p.kit)) {
        const gain = new Tone.Gain({ context: c, gain: v.gain ?? 1 }).connect(input)
        nodes.push(gain)
        const inst = instrument(v.synth, false, v.options, gain, `part ${name} voice ${note}`)
        const at = v.pitch ?? note
        const voice: Inst = { ...inst, attack: (_n, t, vel) => inst.attack(at, t, vel), release: (_n, t) => inst.release(at, t), play: (_n, d, t, vel) => inst.play(at, d, t, vel) }
        kit.set(midi(note), voice)
        insts.push(voice)
      }
      play = note => kit.get(midi(note))
    } else {
      const inst = instrument(p.synth, !!p.poly, p.options, input, `part ${name}`)
      insts.push(inst)
      play = () => inst
    }
    const made = { play, nodes, insts }
    parts.set(name, made)
    return made
  }

  // The transport's ticks in `n` sixteenths, and ticks as a Tone time.
  const ticks = (n: number) => (n * context!.transport.PPQ) / 4
  const T = (t: number) => `${Math.round(t)}i`

  // The song heard now: the last one asked for whose moment has come. Those it followed are gone.
  function heard(): Playing | undefined {
    if (!context) return undefined
    const now = context.immediate()
    while (songs.length && songs[0].until !== undefined && songs[0].until <= now) songs.shift()!.part.dispose()
    return songs[0] && songs[0].at <= now ? songs[0] : undefined
  }

  // `s` plays from context time `at`, from `offset` sixteenths into it, looped over its length, in
  // place of whatever plays then; none stops the music at `at`.
  function begin(name: string, s: Song | undefined, at: number, offset = 0) {
    const c = context!, t = c.transport
    for (let i = songs.length - 1; i >= 0; i--) if (songs[i].at >= at) songs.splice(i, 1)[0].part.dispose()
    for (const p of songs) {
      p.part.stop(at)
      p.until = at
    }
    if (!s) return
    if (t.state !== 'started') t.start(at)
    t.bpm.setValueAtTime(s.bpm, at)
    const from = t.getTicksAtTime(at) - ticks(offset)
    const events = Object.entries(s.tracks).flatMap(([track, notes]) =>
      notes.map(([n, note, len, vel]) => ({ time: T(ticks(n)), track, note, dur: T(ticks(len)), vel: vel ?? 1 })))
    const p = new Tone.Part({
      context: c,
      events,
      loop: true,
      loopEnd: T(ticks(s.length)),
      callback: (time, e: any) => { if (table!.parts[e.track]) part(e.track).play(e.note)?.play(e.note, e.dur, time, e.vel) },
    }).start(T(from + ticks(offset)), T(ticks(offset)))
    songs.push({ name, notes: s, part: p, from, at })
    void c.resume()
  }

  // The context time of the next bar line of the song heard; now when none plays.
  function nextBar() {
    const c = context!, s = heard(), at = position()
    if (!s || at === null) return c.now()
    return c.immediate() + (BAR - (at % BAR)) * sixteenth(s.notes.bpm)
  }

  // The music moves to the song `name`, or to none: on the next bar line, or faded over `fade`.
  async function change(name: string | null, fade: number | undefined) {
    const c = context!
    const s: Song | undefined = name === null ? undefined : await plugins!.loader.load(name)
    if (!fade || !heard()) return begin(name ?? '', s, nextBar())
    const now = c.now(), at = now + fade, g = fader!.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.getValueAtTime(now), now)
    g.linearRampToValueAtTime(0, at)
    g.linearRampToValueAtTime(1, at + fade)
    begin(name ?? '', s, at)
  }

  function stop() {
    if (!context) return
    for (const p of songs.splice(0)) p.part.dispose()
    for (const p of parts.values()) for (const i of p.insts) i.hush()
  }

  // Where the song heard is now, in sixteenths from its start, within its length: the transport's
  // ticks at the context's own clock, not at Tone's, which runs its lookahead ahead of what is heard.
  function position() {
    const s = heard()
    if (!s) return null
    const at = (context!.transport.getTicksAtTime(context!.immediate()) - s.from) / ticks(1)
    return ((at % s.notes.length) + s.notes.length) % s.notes.length
  }

  return {
    context,
    tick(p: Plugins) {
      plugins = p
      table = p.wire.scene.world!.synthaudio as Table
      if (!context) return
      if (!bus) wire(table)
      const v = table.volume
      volume!.gain.value = v && p.store ? (p.store.get(v.muted) ? 0 : (p.store.get(v.level) as number)) : 1
      const m = table.music
      if (!m) return
      const want = read(p.wire.rows, m)
      if (want === wanted) return
      wanted = want
      if (want !== null && !table.songs.includes(want)) throw new Error(`synthaudio has no song ${want}, which ${m.kind}.${m.path} names`)
      void change(want, m.fade)
    },
    attack(name: string, note: string, vel = 1) {
      held.set(`${name} ${note}`, { part: name, note })
      if (!context) return
      part(name).play(note)?.attack(note, undefined, vel)
    },
    release(name: string, note: string) {
      held.delete(`${name} ${note}`)
      if (!context) return
      part(name).play(note)?.release(note)
    },
    async play(name: string) {
      if (!table!.songs.includes(name)) throw new Error(`synthaudio has no song ${name}`)
      if (!context) return
      begin(name, await plugins!.loader.load(name), context.now())
    },
    audition(s: Song, from = 0) {
      if (context) begin('', s, context.now(), from % s.length)
    },
    stop,
    playing: () => heard()?.name,
    at() {
      const at = position()
      return at === null ? null : Math.floor(at)
    },
    position,
    song: () => heard()?.notes,
    held: () => [...held.values()],
    notes(name: string) {
      const p = table?.parts[name]
      if (!p) throw new Error(`synthaudio has no part ${name}`)
      return 'kit' in p ? Object.keys(p.kit).sort((a, b) => midi(a) - midi(b)) : undefined
    },
    close() {
      if (!context) return
      stop()
      for (const p of parts.values()) {
        for (const i of p.insts) i.dispose()
        for (const n of p.nodes) n.dispose()
      }
      parts.clear()
      for (const n of [bus, fader, volume, ...tail]) n?.dispose()
      off()
      void context.close()
    },
  }
}
