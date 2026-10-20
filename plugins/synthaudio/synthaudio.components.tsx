// The components of synthaudio's extension (synthaudio.extension.tsx): the Notes panel and the
// fields of the synthaudio types.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useEditor, useText } from '#editor/context.ts'
import type { Editor, FieldProps } from '#editor/editor.ts'
import { NumberField, Select, TextField } from '#editor/ui/fields.tsx'
import { Badge, Button, Empty, Note, PanelBody, Row, Section, Split, Toolbar } from '#editor/ui/layout.tsx'
import { StepGrid } from '#editor/ui/steps.tsx'
import { Timeline, type Chip, type Lane, type Move } from '#editor/ui/timeline.tsx'
import { EFFECTS, midi, named, synthaudio, SYNTHS, type Song, type Table } from './synthaudio.plugin.ts'

const KIND = 'synthaudio'
type Asset = { type: string; url: string; preload?: boolean }
// A song made new: a minute's tempo and four bars, no notes.
const EMPTY: Song = { bpm: 120, length: 64, tracks: {} }

// The pitches a track's lanes show, from the highest down: every note it holds and two octaves at
// least, centred on them, C4's two octaves for a track with none.
function pitches(notes: string[]): string[] {
  const ns = notes.map(midi)
  let lo = ns.length ? Math.min(...ns) : 60, hi = ns.length ? Math.max(...ns) : 60
  const short = 24 - (hi - lo)
  if (short > 0) { lo -= Math.floor(short / 2); hi += Math.ceil(short / 2) }
  return Array.from({ length: hi - lo + 1 }, (_, i) => named(hi - i))
}

// The `json` entries of a scene's catalogue.
function jsonIn(ed: Editor, scene: string | undefined): Record<string, Asset> {
  const assets = (scene ? ed.session?.scenes().get(scene)?.world.loader?.assets : undefined) ?? {}
  return Object.fromEntries(Object.entries(assets as Record<string, Asset>).filter(([, a]) => a.type === 'json'))
}

// A time in sixteenths as bar.beat, and .sixteenth off a beat, each counted from 1.
const bars = (t: number) => {
  const q = Math.round(t)
  return `${Math.floor(q / 16) + 1}.${Math.floor((q % 16) / 4) + 1}${q % 4 ? `.${(q % 4) + 1}` : ''}`
}

// A song's file as the songs are written: its numbers, then each track with a note a line.
const songText = (s: Song) => {
  const tracks = Object.entries(s.tracks).map(([k, v]) => `    ${JSON.stringify(k)}: [\n${v.map(n => `      ${JSON.stringify(n)}`).join(',\n')}\n    ]`)
  return `{\n  "bpm": ${s.bpm},\n  "length": ${s.length},\n  "tracks": {${tracks.length ? `\n${tracks.join(',\n')}\n  ` : ''}}\n}\n`
}

// ---------------------------------------------------------------- the songs

// Where the songs of scene `scene` are written, as synthaudio's route is handed it: the file its songs
// list is in and the file its catalogue is in; and where a new song `name`'s file goes, in the folder
// of the songs it has.
function home(ed: Editor, scene: string, name: string) {
  const s = ed.need()
  const songs: string[] = (s.scene(scene).world.synthaudio as Table).songs
  const assets = jsonIn(ed, scene)
  const first = songs.map(n => assets[n]?.url).find(Boolean)
  const game = s.game.path.slice(0, s.game.path.lastIndexOf('/') + 1)
  const folder = first ? first.slice(1, first.lastIndexOf('/') + 1) : `${game}assets/`
  return { songs: ed.worldFile(scene, KIND), catalogue: ed.worldFile(scene, 'loader'), path: `${folder}${name}.json` }
}

// Why song `name` may not be taken away or renamed: the definitions file of a scene that plays these
// songs names it, as a setlist does. Undefined when none does.
async function namedIn(ed: Editor, scene: string, name: string): Promise<string | undefined> {
  const s = ed.need()
  const file = ed.worldFile(scene, KIND)
  for (const [n, t] of s.scenes()) {
    if (!(KIND in t.world) || ed.worldFile(n, KIND) !== file || typeof t.world.defs !== 'string') continue
    const url = jsonIn(ed, n)[t.world.defs]?.url
    if (!url) continue
    const walk = (v: unknown, at: string[]): string | undefined => {
      if (v === name) return at.join('.')
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { const f = walk(x, [...at, k]); if (f) return f }
      return undefined
    }
    const where = walk(JSON.parse(await ed.text(url.slice(1))), [])
    if (where) return `${url.slice(1)} names it at ${where}`
  }
  return undefined
}

// Song `name` made, with the text `text` or as a copy of song `like`: its file, its catalogue entry
// and its place at the end of the songs, one change (synthaudio's route `make`).
async function makeSong(ed: Editor, scene: string, name: string, made: { text: string } | { like: string }) {
  await ed.route(KIND, 'make', { ...home(ed, scene, name), name, ...made })
}

// Song `name` taken away: its place in the songs, its catalogue entry and its file, one change
// (`drop`); refused while a game's definitions name it.
async function dropSong(ed: Editor, scene: string, name: string) {
  const why = await namedIn(ed, scene, name)
  if (why) throw new Error(`${name} stays: ${why}`)
  const { songs, catalogue } = home(ed, scene, name)
  await ed.route(KIND, 'drop', { songs, catalogue, name })
}

// Song `name` made again as `to`, its file, catalogue entry and place, and taken away as `name`, one
// change (`rename`); refused while a game's definitions name it.
async function renameSong(ed: Editor, scene: string, name: string, to: string) {
  const why = await namedIn(ed, scene, name)
  if (why) throw new Error(`${name} keeps its name: ${why}`)
  await ed.route(KIND, 'rename', { ...home(ed, scene, to), name, to })
}

// ---------------------------------------------------------------- the types

export function SynthName({ value, onChange, label }: FieldProps<string>) {
  return <Select<string> label={label} value={value} options={SYNTHS.map(s => ({ value: s }))} onChange={onChange} />
}
export function EffectName({ value, onChange, label }: FieldProps<string>) {
  return <Select<string> label={label} value={value} options={EFFECTS.map(e => ({ value: e }))} onChange={onChange} />
}
export function SongName({ value, onChange, owner, label }: FieldProps<string>) {
  const ed = useEditor(['game', 'selection'])
  const names = Object.keys(jsonIn(ed, owner.scene ?? ed.focus(KIND)?.scene))
  return <Select<string> label={label} value={value} options={[...new Set([value, ...names])].map(n => ({ value: n, label: names.includes(n) ? n : `${n} (not in the catalogue)` }))} onChange={onChange} />
}

// ---------------------------------------------------------------- the panel

export function Notes() {
  const ed = useEditor(['game', 'selection'])
  const fo = ed.focus(KIND)
  const table = fo?.world as unknown as Table | undefined
  const [songPick, setSong] = useState('')
  const [trackPick, setTrack] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [head, setHead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState<string[]>([])
  const [solo, setSolo] = useState<string[]>([])
  const [name, setName] = useState('')
  const song = table?.songs.includes(songPick) ? songPick : table?.songs[0]
  const parts = Object.keys(table?.parts ?? {})
  const track = parts.includes(trackPick) ? trackPick : parts[0]
  const url = song ? jsonIn(ed, fo?.scene)[song]?.url : undefined
  const path = url?.slice(1)
  const text = useText(path)

  // The panel's own synthaudio, made from the parts as they are, so it plays with the game view or
  // without, and a change to an instrument is heard: it is made again when the parts change.
  const [synth, setSynth] = useState<ReturnType<typeof synthaudio>>()
  const instruments = JSON.stringify([table?.parts ?? null, table?.master ?? null])
  useEffect(() => {
    const [parts, master] = JSON.parse(instruments) as [Table['parts'] | null, Table['master'] | null]
    if (!parts) return
    const s = synthaudio()
    s.tick({ wire: { scene: { world: { synthaudio: { parts, master: master ?? undefined, songs: [] } } }, rows: [] } } as never)
    setSynth(s)
    return () => s.close()
  }, [instruments])

  // What plays: the song as its file holds it now, from where the playhead is, the muted tracks, or
  // all but the soloed, left out; played again from where it is whenever any of that changes.
  const at = useRef(0)
  const quiet = JSON.stringify([muted, solo])
  useEffect(() => {
    if (!synth) return
    if (!playing || text === undefined) {
      synth.stop()
      return
    }
    const [m, so] = JSON.parse(quiet) as [string[], string[]]
    const s = JSON.parse(text) as Song
    synth.audition({ ...s, tracks: Object.fromEntries(Object.entries(s.tracks).filter(([p]) => (so.length ? so.includes(p) : !m.includes(p)))) }, at.current)
  }, [synth, playing, text, quiet])
  // The playhead follows it, looked at after each frame of the editor's clock (`Session.onFrame`).
  const session = ed.session
  useEffect(() => {
    if (!playing || !synth || !session) return
    return session.onFrame(() => {
      const p = synth.position()
      if (p !== null) { at.current = p; setHead(Math.floor(p)) }
    })
  }, [playing, synth, session])

  if (!ed.session) return <Empty>Open a game, and the notes of its songs are edited here.</Empty>
  if (!fo || !table) return <Empty>No scene of {ed.session.game.name} has a world.synthaudio.</Empty>
  const scene = fo.scene
  // What is refused is said in the console, once: a change the server refused is said as it is.
  const fail = (e: Error) => { if (!ed.said(e)) ed.error(`synthaudio: ${e.message}`) }
  const act = (f: () => Promise<void>) => void f().catch(fail)
  const seek = (t: number) => { at.current = t; setHead(t) }

  const songs = (
    <Section title="Songs" extra={<Badge>{table.songs.length}</Badge>}>
      {table.songs.map(n => (
        <Row key={n}><Button pressed={n === song} onClick={() => { setSong(n); setSelected([]); seek(0) }}>{n}</Button></Row>
      ))}
      <TextField label="song name" value={name} onChange={v => setName(v)} />
      <Row>
        <Button title="new song" disabled={!name} onClick={() => { act(() => makeSong(ed, scene, name, { text: songText(EMPTY) })); setSong(name); setName('') }}>New</Button>
        <Button title="duplicate song" disabled={!name || text === undefined} onClick={() => { act(() => makeSong(ed, scene, name, { like: song! })); setSong(name); setName('') }}>Duplicate</Button>
        <Button title="rename song" disabled={!name || !song || text === undefined} onClick={() => { act(() => renameSong(ed, scene, song!, name)); setSong(name); setName('') }}>Rename</Button>
      </Row>
      <Row>
        <Button title="delete song" disabled={!song} onClick={() => act(() => dropSong(ed, scene, song!))}>Delete</Button>
      </Row>
      <Note>New, Duplicate and Rename take the name typed above. A song a game's definitions name is not deleted or renamed.</Note>
    </Section>
  )

  if (!song || !track) return <PanelBody bar={<Toolbar label="notes"><Badge tone="dim">{scene}</Badge></Toolbar>}><Split main={<Empty>{scene}'s synthaudio names no song or no part.</Empty>} side={songs} /></PanelBody>
  if (!path) return <Empty>{song} is not a json entry of {scene}'s catalogue.</Empty>
  if (text === undefined) return <Empty>Reading {path}…</Empty>

  const s = JSON.parse(text) as Song
  const notes = s.tracks[track] ?? []
  const part = table.parts[track]
  const kit = 'kit' in part ? part.kit : undefined
  const to = (...k: (string | number)[]) => ['tracks', track, ...k]
  const write = (at: (string | number)[], value: unknown, insert = false) => void ed.editFile(path, at, value, insert).catch(fail)
  const add = (lane: string, t: number) => (s.tracks[track] ? write(to(-1), [t, lane, 1], true) : write(to(), [[t, lane, 1]]))
  const hear = (note: string) => { if (!synth) return; synth.attack(track, note); setTimeout(() => synth.release(track, note), 300) }
  const flip = (list: string[], set: (v: string[]) => void, p: string) => set(list.includes(p) ? list.filter(x => x !== p) : [...list, p])

  // Every track at once: a lane a part, every note of it where it falls. A lane's name opens it below.
  const arrangement = (
    <Timeline
      label={`${song} tracks`}
      lanes={parts.map(p => ({
        id: p,
        label: <Button pressed={p === track} title={`open ${p}`} onClick={() => { setTrack(p); setSelected([]) }}>{p}</Button>,
        extra: (
          <>
            <Button title={`mute ${p}`} pressed={muted.includes(p)} onClick={() => flip(muted, setMuted, p)}>M</Button>
            <Button title={`solo ${p}`} pressed={solo.includes(p)} onClick={() => flip(solo, setSolo, p)}>S</Button>
          </>
        ),
      }))}
      chips={parts.flatMap(p => (s.tracks[p] ?? []).map(([t, note, len], i) => ({ id: `${p} ${i}`, lane: p, at: t, length: len, label: note, fixed: true })))}
      head={head}
      span={s.length}
      grain={1}
      end={s.length}
      fit={`${song} ${s.length} tracks`}
      format={bars}
      onSeek={seek}
      onSelect={ids => { const p = ids[0]?.split(' ')[0]; if (p) setTrack(p) }}
    />
  )

  // The track opened: a step grid for a kit, a voice a row; a piano roll for any other part.
  let detail
  if (kit) {
    const voices = Object.keys(kit).map(n => named(midi(n))).sort((a, b) => midi(b) - midi(a))
    const synthOf = (v: string) => Object.entries(kit).find(([n]) => midi(n) === midi(v))![1].synth
    const hit = (v: string, i: number) => notes.findIndex(([t, n]) => t === i && midi(n) === midi(v))
    detail = (
      <StepGrid
        label={`${song} ${track} steps`}
        rows={voices.map(v => ({ id: v, label: `${v} ${synthOf(v).replace('Synth', '').toLowerCase()}`, extra: <Button title={`hear ${v}`} disabled={!synth} onClick={() => hear(v)}>▶</Button> }))}
        steps={s.length}
        head={playing ? head : undefined}
        on={(v, i) => hit(v, i) >= 0}
        onToggle={(v, i) => { const k = hit(v, i); if (k >= 0) write(to(k), undefined); else add(v, i) }}
      />
    )
  } else {
    const lanes: Lane[] = pitches(notes.map(n => n[1])).map(p => ({ id: p, label: p, extra: <Button title={`hear ${p}`} disabled={!synth} onClick={() => hear(p)}>▶</Button> }))
    const ids = lanes.map(l => l.id)
    const chips: Chip[] = notes.map(([t, note, len], i) => ({ id: String(i), lane: named(midi(note)), at: t, length: len, resize: true, label: note, lanes: ids }))
    const move = (moves: Move[], done: boolean) => {
      if (!done) return
      void ed.editFiles(moves.flatMap(m => [
        { file: path, at: to(Number(m.id), 0), value: m.at },
        { file: path, at: to(Number(m.id), 1), value: m.lane },
      ])).catch(fail)
    }
    const key = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || !selected.length) return
      e.preventDefault()
      const gone = selected.map(Number).sort((a, b) => b - a)
      setSelected([])
      void ed.editFiles(gone.map(i => ({ file: path, at: to(i), value: undefined }))).catch(fail)
    }
    detail = (
      <Timeline
        label={`${song} ${track}`}
        lanes={lanes}
        chips={chips}
        head={head}
        span={s.length}
        grain={1}
        end={s.length}
        fit={`${song} ${s.length}`}
        selected={selected}
        format={bars}
        onSeek={seek}
        onSelect={setSelected}
        onMove={move}
        onResize={(id, length, done) => { if (done) write(to(Number(id), 2), Math.max(1, length)) }}
        onAdd={add}
        onKey={key}
      />
    )
  }

  return (
    <PanelBody bar={
      <Toolbar label="notes">
        <Badge tone="dim">{scene}</Badge>
        <Badge>{song}</Badge>
        <Button title={playing ? 'stop' : 'play'} disabled={!synth} pressed={playing} onClick={() => setPlaying(!playing)}>{playing ? '■' : '▶'}</Button>
        <NumberField label="bpm" integer value={s.bpm} onChange={(v, done) => { if (done && v > 0) write(['bpm'], v) }} />
        <NumberField label="length" integer value={s.length} onChange={(v, done) => { if (done && v > 0) write(['length'], v) }} />
        <span className="ui-spacer" />
        <Badge>{Object.values(s.tracks).reduce((n, t) => n + t.length, 0)} notes</Badge>
      </Toolbar>
    }>
      <Split
        main={
          <>
            {arrangement}
            <Section title={`${track}${kit ? ' · steps' : ''}`} extra={<Badge>{notes.length} notes</Badge>}>
              {detail}
              <Note>{kit ? 'Click a step to hit it or take it out.' : 'Double-click a lane to add a note; drag to move, drag its end to lengthen; Delete takes the selected out.'}</Note>
            </Section>
          </>
        }
        side={songs}
      />
    </PanelBody>
  )
}
