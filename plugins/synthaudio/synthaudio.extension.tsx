// synthaudio's extension: the Notes panel, and the types of its fields.
//
// The panel (`synthaudio.components.tsx`) is a multi-track editor of the songs of the scene
// selected, else of the one the game view shows, else of the first scene with a `world.synthaudio`.
// - Songs, beside it: every song of the scene's `songs`, one picked. New makes a song of four bars at
//   120 bpm with no notes, Duplicate a copy of the one picked, Rename moves the one picked to a new
//   name, each named as typed; Delete takes the one picked away. Each is one call of this extension's
//   route (`synthaudio.route.ts`), so one change, which one undo takes back whole: the song's file,
//   its entry in the loader's catalogue, and its place in `songs`. A song the definitions of a scene
//   that plays these songs name, as a setlist does, is not deleted or renamed, and the console says
//   where it is named.
// - Tracks: a lane per part over the whole song, every note of it where it falls. A lane's name
//   opens that track below; M mutes it and S solos it in what plays.
// - The track opened: for a kit, a step grid, a row per voice named by its note and its synth, a
//   click on a step hitting it or taking the hit out; for any other part, a piano roll on the
//   design system's Timeline, a lane per pitch over the notes it holds and two octaves at least,
//   where a double-click adds a note a sixteenth long, dragging moves notes in time and pitch,
//   dragging a note's end lengthens it, and Delete takes the notes selected out. ▶ on a row plays
//   that note on the track's part. Each change is one value of the song's file, one undo.
// - The song's `bpm` and `length`, and Play: the song as its file holds it now, from the playhead,
//   looped, the muted tracks, or all but the soloed, left out; played again from where it is when
//   any of that changes, so an edit is heard as it is made. Clicking the ruler moves the playhead.
// The panel plays through a synthaudio of its own, made from the scene's `parts` and `master` and
// made again when they change, so it plays whatever the game view shows and an instrument changed
// in the inspector is heard at once.
//
// The types, wherever a synthaudio field is shown: a part's synth and a kit voice's are one of Tone's
// synths (`synthaudio.synth`), an effect's type one of its effects (`synthaudio.effect`), and a song
// a `json` entry of the scene's catalogue (`synthaudio.song`).
import type { Editor } from '#editor/editor.ts'
import { EffectName, Notes, SongName, SynthName } from './synthaudio.components.tsx'

export function synthaudio(ed: Editor) {
  ed.panel({ id: 'notes', title: 'Notes', area: 'bottom', component: Notes })
  ed.field('synthaudio.synth', SynthName)
  ed.field('synthaudio.song', SongName)
  ed.field('synthaudio.effect', EffectName)
  ed.bind('synthaudio', {
    'parts.*.synth': 'synthaudio.synth',
    'parts.*.kit.*.synth': 'synthaudio.synth',
    'parts.*.effects.*.type': 'synthaudio.effect',
    'songs.*': 'synthaudio.song',
  })
}
