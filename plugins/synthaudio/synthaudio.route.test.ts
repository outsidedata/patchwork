// synthaudio's routes run as the server runs them, inside a change (`editor/server/changes.ts`), on a
// repo of their own: a song made new or as a copy, taken away and renamed, each writing its file, its
// catalogue entry and its place in the songs, a rename byte for byte what a make and a drop write; one
// undo takes each back byte for byte; every call the route must refuse refused with nothing written,
// a rename refused after it has written put back whole.
import { afterAll, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Changes, type Answer, type Changed } from '#editor/server/changes.ts'
import { Files } from '#editor/server/files.ts'
import type { Route } from '#editor/server/routes.ts'
import { synthaudio } from './synthaudio.route.ts'

const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'synthaudio-route-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const files = new Files(root)

const routes = new Map<string, Route>()
synthaudio({ get: (r, f) => routes.set(`GET ${r}`, f), post: (r, f) => routes.set(`POST ${r}`, f) })
// The server's changes over the repo, whose routes are synthaudio's, each named by how many came before.
let changes = 0
const log = new Changes(files, path.join(root, 'node_modules/.cache/editor/changes'), async (owner, route, body, f) => {
  if (owner !== 'synthaudio') throw new Error(`no ${owner}.route.ts`)
  return routes.get(`POST ${route}`)!({ query: new URLSearchParams(), body, files: f })
})
// Route `route` of synthaudio's called as one change, answered as the server answers it.
const call = (route: string, body: unknown) => log.change(`c${changes++}`, [{ route: { owner: 'synthaudio', route, body } }])
const made = (a: Answer): Changed => {
  if ('error' in a) throw new Error(a.error)
  return a
}
const refused = async (route: string, body: unknown) => {
  const a = await call(route, body)
  if (!('error' in a)) throw new Error(`${route} was not refused`)
  return a.error
}

const at = (p: string) => path.join(root, p)
const put = (p: string, text: string) => {
  mkdirSync(path.dirname(at(p)), { recursive: true })
  writeFileSync(at(p), text)
}
const text = (p: string) => (existsSync(at(p)) ? readFileSync(at(p), 'utf8') : null)
const held = (...paths: string[]) => Object.fromEntries(paths.map(p => [p, text(p)]))

// A game whose scene lists its songs and whose game file holds the catalogue, as a scene that composes
// its `world` from the game's does.
const SONGS = 'games/g/stage.scene.json'
const CATALOGUE = 'games/g/g.scene.json'
const JAM = 'games/g/assets/jam.json'
const NEW = 'games/g/assets/ballad.json'
const where = { songs: SONGS, catalogue: CATALOGUE }
const fresh = () => {
  put(SONGS, '{\n  "world": {\n    "synthaudio": {\n      "parts": {},\n      "songs": ["jam"]\n    }\n  }\n}\n')
  put(CATALOGUE, '{\n  "world": {\n    "loader": {\n      "assets": {\n        "defs": { "type": "json", "url": "/games/g/assets/defs.json" },\n        "jam": { "type": "json", "url": "/games/g/assets/jam.json", "preload": true }\n      }\n    }\n  }\n}\n')
  put(JAM, '{\n  "bpm": 90,\n  "length": 16,\n  "tracks": {}\n}\n')
  put('games/g/assets/defs.json', '{ "setlist": ["jam"] }\n')
  rmSync(at(NEW), { force: true })
}
const all = () => held(SONGS, CATALOGUE, JAM, NEW)

test('make writes the song\'s file, its catalogue entry and its place at the end of the songs, each a value written as the editor writes one; one undo takes it all back byte for byte, and redo makes it again', async () => {
  fresh()
  const before = all()
  const song = '{\n  "bpm": 120,\n  "length": 64,\n  "tracks": {}\n}\n'
  const a = made(await call('make', { ...where, name: 'ballad', path: NEW, text: song }))
  expect(a.answers).toEqual([{ name: 'ballad', file: NEW }])
  expect(Object.keys(a.files).sort()).toEqual([NEW, CATALOGUE, SONGS])
  const after = all()
  expect(after[NEW]).toBe(song)
  expect(after[SONGS]).toBe(before[SONGS]!.replace('["jam"]', '["jam", "ballad"]'))
  expect(after[CATALOGUE]).toBe(before[CATALOGUE]!.replace(
    '"preload": true }\n',
    '"preload": true },\n        "ballad": { "type": "json", "preload": true, "url": "/games/g/assets/ballad.json" }\n',
  ))
  made(await log.undo(`c${changes - 1}`))
  expect(all()).toEqual(before)
  made(await log.redo(`c${changes - 1}`))
  expect(all()).toEqual(after)
})

test('make like a song copies its file\'s text and its catalogue entry, the url its own', async () => {
  fresh()
  made(await call('make', { ...where, name: 'ballad', path: NEW, like: 'jam' }))
  expect(text(NEW)).toBe(text(JAM))
  expect(text(CATALOGUE)).toContain('"ballad": { "type": "json", "url": "/games/g/assets/ballad.json", "preload": true }')
})

test('drop takes the song\'s place, its catalogue entry and its file away; one undo puts them back byte for byte', async () => {
  fresh()
  made(await call('make', { ...where, name: 'ballad', path: NEW, like: 'jam' }))
  const before = all()
  const a = made(await call('drop', { ...where, name: 'jam' }))
  expect(a.answers).toEqual([{ name: 'jam', file: JAM }])
  expect(JSON.parse(text(SONGS)!).world.synthaudio.songs).toEqual(['ballad'])
  expect(Object.keys(JSON.parse(text(CATALOGUE)!).world.loader.assets)).toEqual(['defs', 'ballad'])
  expect(text(JAM)).toBeNull()
  made(await log.undo(`c${changes - 1}`))
  expect(all()).toEqual(before)
})

test('rename is one change written byte for byte as a make of the new name like the old and a drop of the old write it', async () => {
  fresh()
  made(await call('make', { ...where, name: 'ballad', path: NEW, like: 'jam' }))
  made(await call('drop', { ...where, name: 'jam' }))
  const twice = all()
  fresh()
  const before = all()
  const a = made(await call('rename', { ...where, name: 'jam', to: 'ballad', path: NEW }))
  expect(a.answers).toEqual([{ name: 'ballad', file: NEW }])
  expect(all()).toEqual(twice)
  made(await log.undo(`c${changes - 1}`))
  expect(all()).toEqual(before)
})

test('a rename refused once its make is written, its old song in the catalogue but not in the songs, leaves every file as it was and keeps nothing', async () => {
  fresh()
  const before = all()
  expect(await refused('rename', { ...where, name: 'defs', to: 'ballad', path: NEW })).toBe(`${SONGS} has no song defs`)
  expect(all()).toEqual(before)
  expect(await log.undo(`c${changes - 1}`)).toEqual({ id: `c${changes - 1}`, error: `no change c${changes - 1} is kept` })
})

test('every call the route must refuse is refused with nothing written', async () => {
  fresh()
  const before = all()
  const song = '{}\n'
  const make = (b: object) => refused('make', { ...where, name: 'ballad', path: NEW, text: song, ...b })
  expect(await refused('make', 'ballad')).toBe('the songs are listed in a JSON file of a game\'s, and not undefined')
  expect(await make({ songs: 'games/g/../x.json' })).toBe('the songs are listed in a JSON file of a game\'s, and not games/g/../x.json')
  expect(await make({ catalogue: 'notes/x.json' })).toBe('the catalogue is in a JSON file of a game\'s, and not notes/x.json')
  expect(await make({ songs: CATALOGUE })).toBe(`${CATALOGUE} has no list at world.synthaudio.songs`)
  put('games/g/bad.json', '{ "world": { "loader": { "assets": [] } } }\n')
  expect(await make({ catalogue: 'games/g/bad.json' })).toBe('games/g/bad.json has no catalogue at world.loader.assets')
  for (const name of ['Ballad', '2nd', 'a b', '', 3, undefined])
    expect(await make({ name })).toBe(`a song's name is lower-case letters, digits and dashes, and not ${JSON.stringify(name)}`)
  expect(await make({ name: 'jam' })).toBe(`${SONGS} has a song jam already`)
  expect(await make({ name: 'defs' })).toBe(`${CATALOGUE}'s catalogue has a defs already`)
  for (const p of ['games/g/assets/ballad.txt', 'games/g/../g/assets/ballad.json', 'assets/ballad.json', 7])
    expect(await make({ path: p })).toBe(`a song's file is a JSON file in a game's folder, and not ${p}`)
  expect(await make({ path: JAM })).toBe(`${JAM} is there already`)
  expect(await make({ text: undefined })).toBe('make takes one of the new song\'s text and the song it is a copy of')
  expect(await make({ like: 'jam' })).toBe('make takes one of the new song\'s text and the song it is a copy of')
  expect(await make({ text: 5 })).toBe(`make writes ${NEW} as text`)
  expect(await make({ text: '{ bpm' })).toBe(`${NEW} is written as JSON, and its text is not JSON`)
  expect(await make({ text: undefined, like: 'nobody' })).toBe(`${CATALOGUE}'s catalogue has no nobody`)
  expect(await refused('drop', { ...where, name: 'defs' })).toBe(`${SONGS} has no song defs`)
  expect(await refused('drop', { ...where, name: 7 })).toBe(`${SONGS} has no song 7`)
  expect(await refused('rename', { ...where, to: 'ballad', path: NEW })).toBe('rename takes the name of the song it renames')
  expect(all()).toEqual(before)

  // A song in the songs with no entry, or one whose url is no JSON file of a game's, or whose file is
  // not there, is not taken away, nor copied.
  put(SONGS, text(SONGS)!.replace('["jam"]', '["jam", "lost", "odd"]'))
  put(CATALOGUE, text(CATALOGUE)!.replace('"defs": {', '"odd": { "type": "json", "url": "/../secret.json" },\n        "defs": {'))
  const broken = all()
  expect(await refused('drop', { ...where, name: 'lost' })).toBe(`${CATALOGUE}'s catalogue has no lost`)
  expect(await refused('drop', { ...where, name: 'odd' })).toBe('odd\'s url is no JSON file of a game\'s, but /../secret.json')
  expect(await make({ text: undefined, like: 'odd' })).toBe('odd\'s url is no JSON file of a game\'s, but /../secret.json')
  rmSync(at(JAM))
  expect(await refused('drop', { ...where, name: 'jam' })).toBe(`${JAM} is not there`)
  expect(all()).toEqual({ ...broken, [JAM]: null })
})
