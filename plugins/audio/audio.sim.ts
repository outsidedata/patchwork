// The server half of audio: the ledger of the sounds the rules raise. A sound is heard and never
// read by a rule, and every row goes to every seat in every packet, so no sound is a row: a rule says
// once which cue, and where, and each page plays it (`audio.plugin.ts`, which holds the cues, the
// loops and the listener).
//
// The one row of this kind is the ledger: `step`, the steps it has counted, `next`, the id the next
// entry gets, and `live`, the entries, each `{ id, cue, at?, from?, step }`. Its prefab is those
// three and nothing else, since a prefab field goes onto the row and a row goes to every seat every
// step. `hold` is fixed, so it is `world.audio.hold`, beside the browser half's own numbers.
//
// A rule cannot read the engine's step counter, so the ledger counts its own: `step` goes up by one
// in its `before`, and an entry's `step` is the ledger's step it was raised on. An entry leaves in
// the ledger's `before` once `hold` seconds of steps have passed since then: a page reads only the
// last packet's rows each frame, so an entry on the row for one step is missed whenever two packets
// land in one frame, and `hold` is how long an entry stays so that every page sees it. So the
// ledger's actor is listed before any actor that raises a sound in its own `before`: a row whose
// `before` runs ahead of the ledger's stamps its entry with the step before, and the entry leaves a
// step early. A seat's message is answered before every `before`, so a sound its act raises is
// stamped with the step before as well.
//
// `sound(w, cue, at?, from?)` appends an entry with the next id: the cue's name, the point `at`, and
// `from`, the id of the row it comes from. Given `from` and no `at`, the entry's `at` is that row's
// `pos` as it stands, so a page that sees the entry after the row has gone still plays it where it
// was raised; a page follows `from` for as long as its rows hold it. With neither, the sound has no
// place. A cue raised is one entry, so two sounds in one step are two sounds.
//
// The act `play(cue, x, y, z, from)` is `sound` for another plugin's row, through `w.call`. A
// message's args are numbers, strings, booleans and null, so the point is three numbers, or nulls for
// none, and `from` a row id or null. No seat may send it: it is not `open`.
//
// `chance(w, id, odds)` is whether something happens to row `id` this step, with those odds: a hash
// of the id and the ledger's step, the same on every machine, rolling no die, so asking it moves no
// roll of the scene's generator.
import { seeded, type Kind, type W } from '#engine/engine.ts'

export type Entry = { id: number; cue: string; at?: number[]; from?: number; step: number }

const ledgerOf = (w: W) => {
  const rows = w.all('audio')
  if (rows.length !== 1) throw new Error(`audio needs one ledger row, and the scene has ${rows.length}`)
  return rows[0].data
}

export function sound(w: W, cue: string, at?: number[], from?: number) {
  const ledger = ledgerOf(w)
  const entry: Entry = { id: ledger.next++, cue, step: ledger.step }
  if (at) entry.at = [...at]
  else if (from !== undefined) entry.at = [...w.get(from).data.pos]
  if (from !== undefined) entry.from = from
  ledger.live.push(entry)
}

export const chance = (w: W, id: number, odds: number) => seeded(Math.imul(id, 0x9e3779b1) ^ ledgerOf(w).step)() < odds

export const audio: Kind = {
  before(me, dt, w) {
    const d = me.data
    d.step++
    d.live = (d.live as Entry[]).filter(e => (d.step - e.step) * dt < w.world.audio.hold)
  },
  acts: {
    play(_me, w, _seat, cue: string, x: number | null, y: number | null, z: number | null, from: number | null) {
      sound(w, cue, x === null ? undefined : [x, y as number, z as number], from ?? undefined)
    },
  },
}
