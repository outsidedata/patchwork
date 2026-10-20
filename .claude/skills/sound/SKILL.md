---
name: sound
description: Use in core, or any clone of it, when a game needs sound or music. That covers a sound effect when something happens (a jump, a hit, a coin, footsteps, a door, a shot), sound files in the loader catalogue, the `audio` plugin's cues and ledger (`sound(w, cue)`, `world.audio`, `world.player.ledgers`), and ambient loops that follow a field or the camera's height. It also covers music that changes with the game (a named loop, `synthaudio` songs, notes played from keys, Tone.js), volume and mute as store keys, a cutscene's sounds and voice lines (`audio.cutscene.ts`), and sound placed in 3D or 2D (`space`, `screen`). Also use it when a sound plays twice, plays late, plays in the wrong place or does not play at all, and when the editor's Sound or Notes panel is used.
---

# Sound

Sound is the page's. No rule reads it, so no sound is ever a row. Three plugins make the sound a
game has, and the engine knows none of them:

- `audio` (`plugins/audio/`): sound files. Its server half, `audio.sim.ts`, is a ledger. That is one
  row the rules append entries to: which cue, from which row, at which point. Its browser half,
  `audio.plugin.ts`, plays each entry once on every page, and it plays the loops and the music made
  of files. It holds the AudioContext every sound file plays through, and the loader decodes each
  `sound` entry through it, so no actor touches Web Audio.
- `synthaudio` (`plugins/synthaudio/`): notes played by Tone.js synthesizers, over an AudioContext
  each client makes of its own, with a volume gain of its own. It is the page's alone, with no row
  and no server half. A page's actors play its notes directly, and a row's field can choose the
  song every seat hears.
- `store` (`plugins/store/`): the volume and the mute, which are keys of the page's store. The
  server never reads them.

A cutscene's sounds reach the ledger through audio's mod for it, `plugins/audio/audio.cutscene.ts`.
The headers of those files, and the tests beside them, are where the facts are. This skill is the
work done with them.

## When it applies

It applies to every sound and every piece of music a game plays, and to the volume. Other skills
apply instead in these cases:

- How a press is run ahead on the page, how keys are bound, and what a seat may send:
  `input-and-seats`. This skill restates only what a sound needs from it.
- A settings screen that shows and changes the volume: `building-the-hud`. The volume's keys and
  what reads them are here.
- Any other file in the catalogue, such as an image, a sheet or a model: `bringing-in-art`.
- A new plugin that plays sound, or a new ledger plugin: `building-a-plugin`.
- The rest of the kind that raises the sound: `designing-a-kind`.

## Where each piece goes

- The sound file goes in `games/<game>/assets/` and is an entry in the scene's loader catalogue,
  `world.loader.assets`, of type `sound`: `"knock1": { "type": "sound", "url":
  "/games/<game>/assets/knock.wav" }`. The loader decodes it through audio's AudioContext
  (`plugins.audio.context.decodeAudioData`). A scene with a `sound` entry and no `audio` in its
  `plugins` fails that entry. Nothing else fetches or decodes a sound, and no path to one is
  written in code.
- The cue table is fixed, so it goes on `world`, as `world.audio`. It never goes on the ledger's
  prefab or row, however close at hand the row is. A row is sent to every seat every step. If every
  scene of the game uses the same table, it is written once in the manager's `<game>.scene.json`.
  A child scene's `world` is the manager's with the child's own keys over it, one top-level key at
  a time. So a child that gives `audio` replaces the whole table, and a child that gives `player`
  replaces the whole of `world.player`, its `ledgers` included.
- The ledger is a row, so its prefab holds only what changes: `"audio": { "step": 0, "next": 1,
  "live": [] }`, those three fields and nothing more. A scene that raises sounds has exactly one
  `{ "is": "audio" }` entry in its `actors`. `sound` throws `audio needs one ledger row, and the
  scene has N` for none or for two.
- The ledger's kind is named in `world.player.ledgers: ["audio"]`. That list is fixed for the
  scene, so it goes on `world` and never on the player prefab.
- The cue a kind plays is fixed for the kind, so it goes in the kind's definition in
  `assets/<game>.json`, as a `sounds` table of event to cue: `"body": { ..., "sounds": { "bump":
  "knock" } }`. The rule reads `def(w, me.kind).sounds.bump`. The editor's Sound panel reads every
  `sounds` table at any depth of a kind's definition. It refuses to take a cue out of the table
  while a kind names it (`plugins/audio/audio.extension.tsx`).
- The volume and the mute are keys of the store. `world.audio.volume: { "level": "volume", "muted":
  "muted" }` names the keys. The scene lists `store` in its `plugins`, and `world.store` gives the
  keys their first values, `"store": { "volume": 0.8, "muted": false }`. The store has no row, and a
  plugin with no row has no prefab; `plugins/store/store.plugin.ts` reads those values off a `store`
  prefab today, and throws `scene lists store but has no store prefab` without one. So the job that
  uses the store moves them to `world.store` first, in one change, as `building-the-hud` (step 9)
  lists it, and then writes `world.store`. It is never copied as a pattern for another plugin. These
  are the store's rules, from `plugins/store/store.plugin.ts`:
  - The starting values hold every key the volume names, because `store.get` throws `store has no
    <key>` otherwise.
  - The table lives on the link the page mounted, not on a client, so it outlives every scene. A
    starting value is given to a key only while the page's table has no such key. A later scene
    never resets a volume the player changed.
  - A child scene's `world` is the manager's with its own over it, key by key, so a `world.store`
    every scene uses is written once, in the manager's `<game>.scene.json`.
  - A table with no `volume`, or a scene with no store, plays at a volume of 1.
  - `synthaudio` has a volume gain of its own. For one mute and one volume to govern both,
    `world.synthaudio.volume` names the same store keys as `world.audio.volume`.
- The song playing now changes, so it is a field of a row: the cutscene row's `music`, or a field
  of a kind of the game's whose job it is. A loop or `synthaudio`'s `music` reads that field off the
  first row of the kind it names.

## A sound a rule raises, start to finish

This is the work as done on the game `yarn new-game <game>` writes. That game is one scene, `main`,
on render2d with no world of its own (`extensions/games/games.route.ts` lists its files). The
example below makes Space hop the body and knock.

1. Put the file in `games/<game>/assets/knock.wav`. A file the browser's `decodeAudioData` takes
   will work. Add its `sound` entry to `world.loader.assets` in `main.scene.json`. A cue's sound
   needs no `preload`, because audio asks the loader for every sound its cues and field loops name
   on its first frame. The server never fetches a sound: the sim half of the loader fetches only
   the file types a rule reads.
2. Write the table in `main.scene.json`:
   ```json
   "audio": {
     "hold": 0.25,
     "cues": { "knock": { "sounds": ["knock1"], "gain": 0.8 } },
     "volume": { "level": "volume", "muted": "muted" }
   },
   "player": { "ledgers": ["audio"] }
   ```
   These fields are what each part of the table does:
   - `hold` is how many seconds an entry stays on the ledger. A page reads only the last packet of
     each frame. If an entry were on the row for one step only, a page that took two packets in
     one frame would miss it. So `hold` is longer than the longest gap between a page's frames,
     network jitter included.
   - In a cue, `sounds` lists catalogue names. Each entry plays one of them, picked by a hash of
     the entry's id, so every seat hears the same pick.
   - The other fields of a cue: `gain`; `rate`, a `[lo, hi]` range of playback rate picked the same
     way; `range`, the distance this cue fades out over in place of the listener's `max`; and `cut`,
     which stops the last sound from the same row that is still playing.
   - `volume` names the store keys the volume is read from.
3. Put `store` and `audio` in the scene's `plugins` (here `["loader", "scenemanager", "store",
   "player", "render2d", "audio"]`). Add the `audio` prefab, and `world.store` with the volume's
   keys, the store's starting values moved there first (Where each piece goes). Put
   `{ "is": "audio" }` in `actors` ahead of every actor that raises a sound in its own `before`.
   Add the kind to the scene's sim in `main.sim.ts`: `import { audio } from
   '#plugins/audio/audio.sim.ts'` and `sim = { scenemanager, loader, audio, player, start, body }`.
   Name no file in the game folder after the plugin. The page loads `<kind>.client.ts` for every
   row, so a `games/<game>/audio.client.ts` would become the ledger row's actor.
4. Put the cue in the kind's definition, `"sounds": { "bump": "knock" }`, beside the kind's other
   fixed numbers (here `"hop": 24`).
5. Write the rule. The act in `body.sim.ts` changes the row and raises the cue from it:
   ```ts
   bump(me, w) {
     const d = def(w, me.kind)
     me.data.pos = [me.data.pos[0], me.data.pos[1] - d.hop]
     sound(w, d.sounds.bump, undefined, me.id)
   },
   ```
   `sound(w, cue, at?, from?)` comes from `#plugins/audio/audio.sim.ts` and has three forms:
   - At a point: `at`.
   - From a row: `from`. The entry keeps where the row stood, and a page follows the row while it
     has it.
   - With neither: the sound has no place.

   A cue raised twice in one step plays twice. `chance(w, id, odds)` says whether something happens
   to a row this step, from a hash, so an idle sound now and then moves no roll of the scene's die.

   A game's own kind raises its sound with `sound`, as above. Another plugin `p` never names
   audio. Audio writes a mod for it, `plugins/audio/audio.<p>.ts`, which exports `play(w, cue,
   at?, from?)` and calls the ledger's act `play` through `w.call`, as `audio.cutscene.ts` does.
   `p` asks `mod(w.world, '<p>', 'play')`, and a scene switches it on with
   `world.<p>.mods: { "play": "audio" }`. The act is `play(cue, x, y, z, from)`, with nulls for a
   missing point or row, and no seat may send it.
6. Make the press reach the act. In `player.sim.ts`, `bump(me, w, seat)` calls `w.call(w.get(me.data.body),
   'bump', seat)`. In `player.client.ts`, `bind` gets `press: { ' ': ['bump'] }`. The page runs the
   press ahead on its own copy of the rows, so the hop is drawn at once. The page drops the write
   to the ledger, because the scene names `audio` in `world.player.ledgers`. The knock comes once,
   from the server's packet.
7. Make the mute the page's. Give the mute key a function, which runs on the page and sends
   nothing: `m: () => plugins.store.set('muted', !plugins.store.get('muted'))`. Audio reads the
   store each frame, so the volume is 0 from the next frame.

What a page does with the ledger is in the header of `audio.plugin.ts`. These parts of it shape
the work:

- Each entry plays once. The entries already on the ledger when a page first sees it never play,
  so a seat that arrives late hears nothing raised before it came.
- An entry is let go without playing if the page sees it while the AudioContext is still locked,
  or before its sound has landed.
- The context resumes on the first `pointerdown` or `keydown` on the page, and `resume()` finishes
  in its own time. An entry that arrives before it has finished is let go, so the press that
  unlocks the context may go unheard. Whether it is heard is a race between the resume and the
  packet, not a rule. When this was tried in Chrome, the first press went unheard and the second
  was heard.
- A sound raised in an act is carried on one packet fewer than `hold`'s steps. This comes from the
  order of a step's passes: a seat's message is answered before every `before`, and the ledger
  counts its step in its own `before`, so the entry is stamped with the step before. A sound raised
  in the `before` of a row listed ahead of the ledger is stamped the same way. The scratch game this
  skill was written from counted it so.

Where a placed sound is heard depends on which renderer the scene has:

- Under render3d's camera, each placed sound plays through a PannerNode, and `world.audio.space`
  (`{ model, ref, max, rolloff }`, in metres) is required.
- Under render2d with a `world.render2d`, a placed sound is panned across the canvas and fades
  with its distance off the view, and `world.audio.screen` (the same four numbers, in canvas
  pixels) is required.
- Without either listener, as in the scene `yarn new-game` writes, every sound plays unplaced and
  neither table is read.

Audio throws `audio has no space` (or `screen`) at a placed sound under a renderer whose numbers
the table does not give.

Audio's sounds, its loops and its music go out through one gain, which is the volume. synthaudio's
notes go out through a gain of its own, which reads the store keys `world.synthaudio.volume` names.

## Loops and music

`world.audio.loops` maps a name to a loop. A loop plays once its sound has landed, and comes in
three forms:

- `{ sound, field: { kind, path }, over, gain }`: the gain follows a field of the first row of
  `kind`. `path` is fields joined by dots. The gain is clamped through `over` to `gain`, as rain
  follows a sky's mix.
- `{ sound, listener: "height", over, gain }`: the gain follows the height of render3d's camera
  through `over` to `gain`. Under any other listener the height reads 0, and the gain is what 0
  comes to through `over`.
- `{ named: { kind, path }, fade }`: music. It plays the sound the field names, or none, and
  crossfades over `fade` seconds when the field changes.

`loop: [start, end]` is the region that repeats, as a song with an intro has. A named loop gives
it per sound.

A cue's or a field loop's sound is asked for on the first frame. A named loop's sound is asked for
only when the field first names it, so give each song's catalogue entry `"preload": true`. That
way a song starts when it is named, not one fetch later.

`synthaudio` plays music as notes instead of files. Its numbers are `world.synthaudio`:

- `parts`: instruments and drum kits, each with `gain`, `pan` and `effects`.
- `master`: the compressor and limiter every part goes out through.
- `songs`: the loader `json` entries that are songs.
- `music: { kind, path, fade? }`: the field that chooses the song. The song changes on the next
  bar line, or fades when `fade` is given.
- `volume`: store keys, read as audio reads its own. Name the same keys as `world.audio.volume`
  for one mute to govern both.

A song file is `{ bpm, length, tracks }`, counted in sixteenths. Songs are made in the editor's
Notes panel (`synthaudio.extension.tsx`). Its route (`synthaudio.route.ts`) writes the file, the
catalogue entry and the name in `songs` as one undo.

A note a player plays on their own instrument is heard on their page alone. It is a key the page
handles: `press: { a: () => plugins.synthaudio.attack('lead', 'C4') }` with `release: { a: () =>
plugins.synthaudio.release('lead', 'C4') }`, and no message is sent. `synthaudio` reads the
store's volume in its `tick`, so the scene lists `store` before `synthaudio`. Listed after it,
`store.get` throws `store has not ticked yet` on the first frame, but only where
`world.synthaudio.volume` is set and the page has an AudioContext. synthaudio reads nothing
without a context, so a node test never catches the wrong order.

A page that makes its sound as it goes, such as a machine's sound chip, hands its samples to
`plugins.audio.stream({ rate, lead, most })` and calls `push` with each block. The numbers come
from the definition of the kind that pushes.

## A cutscene's sound

The cutscene plugin never imports audio. A scene switches its sound on with
`world.cutscene.mods: { "play": "audio" }`, and lists `audio` in its `plugins` with the ledger's
actor ahead of the cutscene row. A `sound` cue (`cue`, then `where` or `who`) and a `say` with a
`voice` are then raised on the ledger. Their names are cues of `world.audio.cues`. In a scene that
names no `play`, the cues fire and nothing is heard. A skipped cutscene raises no sound. Its
`music` cue sets the row's `music`. A named loop `{ "named": { "kind": "cutscene", "path": "music" },
"fade": 1 }`, or `synthaudio`'s `music` on the same field, plays it. The whole of it is in the
headers of `plugins/cutscene/cutscene.sim.ts` and `plugins/audio/audio.cutscene.ts`.

## What goes wrong

- A sound played from a `<kind>.client.ts` with `new Audio(url)`, an AudioContext of its own, or a
  fetch. That is a second way to a file and a second Web Audio, outside the catalogue, the store's
  volume and audio's unlock. Every sound a rule causes goes on the ledger.
- A sound played from an actor's `tick` when a field changes. The rows an actor is handed are the
  page's, run ahead and taken back, so a change can arrive twice, or come from a press the server
  refused. Raise the cue in the rule that made the change.
- Audio left out of `world.player.ledgers`. The sound still plays once, but a press that raises
  one is not run ahead at all. The body's hop then waits a round trip, as the second test below
  shows. Every scene that uses the ledger names it, and so does a child scene that gives its own
  `world.player`.
- A cue name, a gain or any other fixed value written in the rule. The cue name goes in the kind's
  definition, and the gain goes in the cue.
- The cue table on the ledger's prefab or row, or the volume on a row or in a message. The table
  goes on `world`, and the volume goes in the store.
- A key that `world.audio.volume` names with no starting value in `world.store`. Audio throws
  `store has no <key>` on its first frame.
- A cue a kind's definition names that `world.audio.cues` lacks. The server raises it without a
  word. The page throws `audio has no cue <name>` on the frame its entry arrives. Audio does
  nothing without an AudioContext, so a node test that does not stand one in never sees it.
- A node test that expects a sound to play. Node has no Web Audio. Audio makes no context there,
  plays nothing and asks for nothing, and the loader cannot decode a `sound` there. A test stands
  in an AudioContext before the page is made.

## Proving it

The tests sit beside the files they test and run with `yarn vitest run <file>`.

- `games/<game>/<kind>.sim.test.ts` is the kind's test, on the server. It boots the manager as
  the page does (`boot`, `load`), makes a seat with `connection`, and sends the press with
  `seat.take`. After a step it reads the ledger row of the child truth, which holds one entry:
  `cue` is `defs.<kind>.sounds.<event>`, `from` is the row's id and `at` is its `pos`. It also
  checks the row's own change. Stepping on, it counts the packets that carry the entry, which is
  `hold`'s steps less one for a sound raised in an act. Then the ledger is empty. It reads `hold`
  and every number off the scene file and the definitions, and writes none.
- `games/<game>/player.client.test.ts` (the test beside the file that binds the key) is the page's
  test. It makes a page in node as `index.html` does, `view(link(loopback(accept(manager(truth)))),
  file, import.meta.url, () => {})`, as `plugins/store/store.plugin.test.ts` does. It sets these
  globals with `vi.stubGlobal` before the page is made:
  - `addEventListener` and `removeEventListener`, keeping each listener so the test can hand it a
    key event `{ code: keyCode(' '), key: ' ' }`, its code from `keyCode` in
    `plugins/player/player.plugin.ts`.
  - `AudioContext`, as a stand-in that starts `running`, records each source started and the
    gains it goes out through, and has a `decodeAudioData` that hands back a buffer. Audio lets go
    of an entry while its context is not `running`. `plugins/audio/audio.plugin.test.ts` is the
    model for the graph, but its stand-in has no `decodeAudioData`, because that test stands in
    the loader too. With the real loader, a stand-in without one fails the sound, and
    `plugins.loader.load` rejects. The model for the decoding is the test "a sound is decoded
    through audio's context and is its AudioBuffer" in `plugins/loader/loader.plugin.test.ts`.

  It holds the page's clock, `vi.spyOn(performance, 'now')` moved a step with each step it takes,
  since the player plugin counts the steps between packets on it (`input-and-seats`, How it is
  proven), so each check below is pinned to a step, never read within a few steps. It awaits
  `plugins.loader.load('<sound>')`, because the real loader reads the file off the disk in its own
  time. Then it checks, in this order:
  - After the key and one frame with no step, the row is drawn changed, the server's is not, the
    ledger drawn is still the packet's, and nothing has started.
  - After a step and a frame, one source has started, playing the decoded file. It goes through the
    cue's gain and then a gain at the store's volume, out to the context's destination.
  - After thirty more frames, there is still one source.
  - The mute key sets the store and puts that gain to 0, and nothing reaches the server.
- A second page test presses again on a scene of the test's own: the game's manager and scene files
  written into a temporary folder (`mkdtempSync`) with the scene's `world.player` at
  `{ ledgers: [] }`, its `<scene>.sim.ts`, and a one-line file for each file the page loads beside
  its base, each kind's rule and `player.client.ts`, handing out the game's by its absolute path; it
  is booted and viewed with that folder as base. A test never changes a scene in memory, the page's
  `plugins.wire.scene` among them (`proving-a-game`). The row is now drawn changed only when the
  packet brings it. That shows the list is what lets the press run ahead.
- These hold for every press that raises a sound, whatever sends it. A button on the UI whose tap
  calls `plugins.player.<act>()` sends its act through the player plugin as a key's press is sent,
  and the plugin runs it ahead the same way (any name it has no function of its own for becomes a
  press, `plugins/player/player.plugin.ts`). So a sound raised from a button gets the same server
  test, the entry counted on `hold`'s packets less one, and the same two page tests, the button
  tapped with `emit('pointertap', ...)` in place of the key: one source started, once, and on the
  scene of `{ ledgers: [] }` the row drawn changed only when the packet brings it.
- Played: `yarn editor <game>`, or `games/<game>/index.html` on the editor's server. In
  `dev.html`, the testbed, a readout before the boot can wrap `AudioBufferSourceNode.prototype.start`
  to count the sounds started. Keys sent as real input events (Chrome's DevTools `Input` events)
  unlock the context as a person's would. A `resume()` called from a script before any input
  leaves it `suspended`. That is the browser's autoplay rule, not core's, and it stops holding
  once the page has had a person's gesture. The editor's Sound panel auditions every catalogue sound and every cue through
  the game view's client while the view shows that scene.

## Questions never asked

- Can a predicted press play its sound right away? No. Its kind is a ledger, named in
  `world.player.ledgers`, and the sound comes once, from the packet.
- Can the cue table ride on the ledger row or its prefab? No. It goes on `world.audio`, because a
  row is copied to every seat every step.
- Can the volume be a field of the player row, or sent to the server? No. It is a key of the
  store, which is the page's.
- Can an actor fetch or play a sound file itself? No. The file is a catalogue entry, the loader
  decodes it through audio, and the rule raises it on the ledger.
- Can the cue name be written in the rule? No. It goes in the kind's definition, in `sounds`.
- Can a plugin find audio's ledger and call `play` on it itself? No. Audio writes a mod for it,
  `plugins/audio/audio.<p>.ts`, and the scene names it in `world.<p>.mods`.
- Does the cutscene import audio to sound its cues? No. Audio's mod does it, named in
  `world.cutscene.mods`.
