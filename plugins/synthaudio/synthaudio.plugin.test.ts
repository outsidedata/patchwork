// synthaudio over a recording stand-in of Tone: every node made, what it was wired to, and every note
// it was asked to play. The stand-in's transport runs at 120 bpm, 192 ticks a quarter, so a sixteenth
// is 48 ticks and 0.125 s, and its clock is `clock.now`, Tone's own a lookahead of 0.1 s ahead of it.
import { beforeEach, expect, test, vi } from 'vitest'
import { synthaudio, sixteenth, type Song, type Table } from './synthaudio.plugin.ts'

type Made = { type: string; options: any; into: string[]; started: boolean; ramps: number[][] }
const { calls, made, transport, clock, node } = vi.hoisted(() => {
  const calls: unknown[][] = []
  const made: Made[] = []
  const clock = { now: 0 }
  const transport = {
    PPQ: 192,
    state: 'stopped',
    bpms: [] as number[][],
    bpm: { setValueAtTime(v: number, t: number) { transport.bpms.push([v, t]) } },
    getTicksAtTime: (t: number) => t * 384,
    start() { transport.state = 'started' },
  }
  const node = (type: string) =>
    class {
      me: Made
      gain: Record<string, unknown>
      constructor(o: any = {}) {
        this.me = { type, options: o, into: [], started: false, ramps: [] }
        made.push(this.me)
        const me = this.me
        this.gain = { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, getValueAtTime: () => 1, linearRampToValueAtTime: (v: number, t: number) => me.ramps.push([v, t]) }
      }
      connect(to: any) { this.me.into.push(to.me.type); return this }
      chain(...to: any[]) { let from: any = this; for (const t of to) { from.connect(t); from = t } return this }
      start() { this.me.started = true; return this }
      dispose() {}
      triggerAttack(...a: unknown[]) { calls.push([type, 'attack', ...a]) }
      triggerRelease(...a: unknown[]) { calls.push([type, 'release', ...a]) }
      triggerAttackRelease(...a: unknown[]) { calls.push([type, 'play', ...a]) }
      releaseAll() { calls.push([type, 'hush']) }
    }
  return { calls, made, transport, clock, node }
})
vi.mock('tone', () => ({
  Context: class {
    state = 'running'
    transport = transport
    destination = { me: { type: 'destination' } }
    now() { return clock.now + 0.1 }
    immediate() { return clock.now }
    resume() {}
    close() {}
  },
  Gain: node('Gain'), Panner: node('Panner'), Compressor: node('Compressor'), Limiter: node('Limiter'),
  FeedbackDelay: node('FeedbackDelay'), Chorus: node('Chorus'),
  PolySynth: node('PolySynth'), Synth: node('Synth'), AMSynth: node('AMSynth'),
  MembraneSynth: node('MembraneSynth'), NoiseSynth: node('NoiseSynth'), MetalSynth: node('MetalSynth'),
  Part: class {
    constructor(o: any) { calls.push(['part', o.events.map((e: any) => [e.time, e.track, e.note, e.dur]), o.loopEnd]) }
    start(t: string, offset?: string) { calls.push(['part start', t, offset]); return this }
    stop(t: number) { calls.push(['part stop', t]) }
    dispose() {}
  },
}))
vi.stubGlobal('AudioContext', class {})

const table: Table = {
  parts: {
    lead: { synth: 'Synth', gain: 0.5, pan: 0.25, effects: [{ type: 'FeedbackDelay', options: { delayTime: 0.2 } }, { type: 'Chorus' }] },
    pad: { synth: 'AMSynth', poly: true, gain: 0.3 },
    drums: { gain: 0.8, kit: { C1: { synth: 'MembraneSynth' }, D1: { synth: 'NoiseSynth', gain: 0.4 }, 'F#1': { synth: 'MetalSynth', pitch: 'G3' } } },
  },
  master: { compressor: { threshold: -18 }, limiter: -1 },
  songs: ['jam', 'groove'],
  music: { kind: 'setlist', path: 'song' },
}
const jam: Song = { bpm: 120, length: 32, tracks: { lead: [[0, 'C4', 2]], drums: [[4, 'D1', 1]] } }
const groove: Song = { bpm: 96, length: 16, tracks: { pad: [[0, 'E4', 16]] } }
const rows: any[] = []
const plugins = { wire: { scene: { world: { synthaudio: table } }, rows }, loader: { load: async (n: string) => ({ jam, groove } as Record<string, Song>)[n] } } as any
const q = sixteenth(120)
const settle = async () => { for (let i = 0; i < 3; i++) await Promise.resolve() }

beforeEach(() => {
  calls.length = 0
  made.length = 0
  rows.length = 0
  clock.now = 0
  transport.state = 'stopped'
  transport.bpms.length = 0
})

test('a pitched part attacks and releases its note; a kit plays the voice its note names, at the voice\'s pitch, a noise voice at none', () => {
  const s = synthaudio()
  s.tick(plugins)
  s.attack('pad', 'C4')
  expect(s.held()).toEqual([{ part: 'pad', note: 'C4' }])
  s.release('pad', 'C4')
  expect(s.held()).toEqual([])
  expect(calls).toEqual([['PolySynth', 'attack', 'C4', undefined, 1], ['PolySynth', 'release', 'C4', undefined]])
  calls.length = 0
  for (const n of ['C1', 'D1', 'F#1', 'E1']) s.attack('drums', n)
  expect(calls).toEqual([['MembraneSynth', 'attack', 'C1', undefined, 1], ['NoiseSynth', 'attack', undefined, 1], ['MetalSynth', 'attack', 'G3', undefined, 1]])
  expect(s.notes('drums')).toEqual(['C1', 'D1', 'F#1'])
  expect(s.notes('lead')).toBeUndefined()
  expect(() => s.attack('bass', 'C2')).toThrow('no part bass')
})

test('a part goes out through its effects in order, started where they move, its pan, the bus, and the master\'s compressor and limiter', () => {
  const s = synthaudio()
  s.tick(plugins)
  s.attack('lead', 'C4')
  const of = (type: string) => made.filter(m => m.type === type)
  const [compressor] = of('Compressor'), [limiter] = of('Limiter'), [delay] = of('FeedbackDelay'), [chorus] = of('Chorus'), [pan] = of('Panner')
  expect(compressor.options).toMatchObject({ threshold: -18 })
  expect(compressor.into).toEqual(['Limiter'])
  expect(limiter.options).toMatchObject({ threshold: -1 })
  expect(limiter.into).toEqual(['destination'])
  expect(delay.options).toMatchObject({ delayTime: 0.2 })
  expect(delay.into).toEqual(['Chorus'])
  expect(chorus.started).toBe(true)
  expect(chorus.into).toEqual(['Panner'])
  expect(pan.options).toMatchObject({ pan: 0.25 })
  expect(pan.into).toEqual(['Gain'])
  table.parts.bad = { synth: 'Synth', gain: 1, effects: [{ type: 'Nope' as never }] }
  expect(() => s.attack('bad', 'C4')).toThrow('no effect Nope')
  delete table.parts.bad
})

test('the field the music names chooses the song: the first starts at once, a change waits for the next bar line of the one heard', async () => {
  const s = synthaudio()
  rows.push({ id: 1, kind: 'setlist', data: { song: null } })
  s.tick(plugins)
  expect(s.playing()).toBeUndefined()
  rows[0].data.song = 'jam'
  s.tick(plugins)
  await settle()
  // Its times in ticks, so a change of tempo keeps every note where it was written.
  expect(calls).toContainEqual(['part', [['0i', 'lead', 'C4', '96i'], ['192i', 'drums', 'D1', '48i']], '1536i'])
  expect(transport.bpms).toEqual([[120, 0.1]])
  clock.now = 0.1 + 5.5 * q
  expect(s.playing()).toBe('jam')
  expect(s.song()).toBe(jam)
  expect(s.position()).toBeCloseTo(5.5)
  expect(s.at()).toBe(5)

  rows[0].data.song = 'groove'
  s.tick(plugins)
  await settle()
  const bar = clock.now + (16 - 5.5) * q
  expect(calls).toContainEqual(['part stop', bar])
  expect(transport.bpms.at(-1)).toEqual([96, bar])
  expect(s.playing()).toBe('jam')
  clock.now = bar
  expect(s.playing()).toBe('groove')
  expect(s.position()).toBeCloseTo(0)
  rows[0].data.song = 'nope'
  expect(() => s.tick(plugins)).toThrow('no song nope, which setlist.song names')
})

test('with a fade the music fades out over it, changes, and fades back in over as long', async () => {
  table.music = { kind: 'setlist', path: 'song', fade: 2 }
  const s = synthaudio()
  rows.push({ id: 1, kind: 'setlist', data: { song: 'jam' } })
  s.tick(plugins)
  await settle()
  clock.now = 1
  rows[0].data.song = null
  s.tick(plugins)
  await settle()
  const fader = made.filter(m => m.type === 'Gain')[1]
  expect(fader.ramps).toEqual([[0, 3.1], [1, 5.1]])
  expect(calls).toContainEqual(['part stop', 3.1])
  clock.now = 3.2
  expect(s.playing()).toBeUndefined()
  delete table.music!.fade
})

test('an audition starts where it is asked to, and is heard from there', () => {
  const s = synthaudio()
  s.tick(plugins)
  clock.now = 2
  s.audition(jam, 36)
  // 36 sixteenths into a song of 32 is 4 into it.
  expect(calls).toContainEqual(['part start', `${Math.round(2.1 * 384)}i`, '192i'])
  clock.now = 2.1 + q
  expect(s.position()).toBeCloseTo(5)
  expect(s.playing()).toBe('')
})
