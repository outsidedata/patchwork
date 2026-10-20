// The synthaudio extension's backend (`synthaudio.extension.tsx`): a scene's songs made new, renamed
// and taken away, each as one call, so each is one change the editor can undo whole. A song is three
// things: its file, a `json` entry of the loader's catalogue (`world.loader.assets`) whose `url` is
// that file, and its name in `world.synthaudio.songs`. The page names the scene files the songs list
// and the catalogue are in (`songs`, `catalogue`), which may be one file; the route reads the list and
// the catalogue there itself, and refuses what they do not allow, writing nothing.
//
//   POST make    { songs, catalogue, name, path, text } or { songs, catalogue, name, path, like }:
//                song `name` made, its file written at `path` holding `text`, which is JSON, or the
//                text of song `like`'s file; its catalogue entry `like`'s with the new `url`, else
//                { type: 'json', preload: true, url }; and `name` put at the end of the songs. Refused
//                for a name that is not lower-case letters, digits and dashes, or that the songs or the
//                catalogue have already, and for a path that is no `.json` in a game's folder or a file
//                that is there already. Answers { name, file }: the song and its file.
//   POST drop    { songs, catalogue, name }: song `name` taken away: its place in the songs, its
//                catalogue entry and its file. Refused for a name the songs, or the catalogue, do not
//                have, and a file that is not there. Answers { name, file }.
//   POST rename  { songs, catalogue, name, to, path }: song `name` made again as `to`, at `path`, a
//                copy of its file with its catalogue entry, and then `name` taken away: `make` then
//                `drop`, written as they write. Answers { name, file }, of `to`.
//
// Each JSON value is set through `files.edit`, as the editor writes one, so a file's diff is that
// value. Run inside a change (`Edits.route`, `editor/server/changes.ts`), every file it writes or
// takes away is part of that change, which one undo takes back byte for byte, and a call refused part
// way, a rename whose `drop` is refused after its `make` is written, leaves every file as it was.
import { valueAt } from '#editor/server/files.ts'
import type { RouteFiles, Router } from '#editor/server/routes.ts'

// A song's name, as the songs and the catalogue name it.
const NAME = /^[a-z][a-z0-9-]*$/
const SONGS = ['world', 'synthaudio', 'songs']
const ASSETS = ['world', 'loader', 'assets']

// A JSON file of a game's, below `games/<game>/`, with no step up or back out of it.
const json = (p: unknown): p is string =>
  typeof p === 'string' && /^games\/[^/]+\/./.test(p) && p.endsWith('.json') && !p.split('/').some(part => part === '..' || part === '.' || part === '')
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

async function there(files: RouteFiles, p: string) {
  return files.read(p).then(() => true, () => false)
}

type Body = { songs?: unknown; catalogue?: unknown; name?: unknown; path?: unknown; text?: unknown; like?: unknown; to?: unknown }
// The page sends an object, and anything else is read as one with nothing in it.
const bodyOf = (body: unknown): Body => (record(body) ? body : {})

// The songs list and the catalogue as their files hold them now.
async function scene(b: Body, files: RouteFiles) {
  const { songs, catalogue } = b
  if (!json(songs)) throw new Error(`the songs are listed in a JSON file of a game's, and not ${String(songs)}`)
  if (!json(catalogue)) throw new Error(`the catalogue is in a JSON file of a game's, and not ${String(catalogue)}`)
  const list = valueAt(await files.read(songs), SONGS)
  if (!Array.isArray(list)) throw new Error(`${songs} has no list at world.synthaudio.songs`)
  const assets = valueAt(await files.read(catalogue), ASSETS) ?? {}
  if (!record(assets)) throw new Error(`${catalogue} has no catalogue at world.loader.assets`)
  return { songs, catalogue, list: list as unknown[], assets }
}

// Song `name`'s catalogue entry, and the file its `url` names.
function song(at: Awaited<ReturnType<typeof scene>>, name: unknown) {
  const entry = typeof name === 'string' && Object.hasOwn(at.assets, name) ? at.assets[name] : undefined
  if (!record(entry)) throw new Error(`${at.catalogue}'s catalogue has no ${String(name)}`)
  const url = entry.url
  if (typeof url !== 'string' || !url.startsWith('/') || !json(url.slice(1))) throw new Error(`${String(name)}'s url is no JSON file of a game's, but ${String(url)}`)
  return { entry, file: url.slice(1) }
}

async function make(body: unknown, files: RouteFiles) {
  const b = bodyOf(body)
  const at = await scene(b, files)
  const { name, path, text, like } = b
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error(`a song's name is lower-case letters, digits and dashes, and not ${JSON.stringify(name)}`)
  if (at.list.includes(name)) throw new Error(`${at.songs} has a song ${name} already`)
  if (Object.hasOwn(at.assets, name)) throw new Error(`${at.catalogue}'s catalogue has a ${name} already`)
  if (!json(path)) throw new Error(`a song's file is a JSON file in a game's folder, and not ${String(path)}`)
  if (await there(files, path)) throw new Error(`${path} is there already`)
  if ((text === undefined) === (like === undefined)) throw new Error('make takes one of the new song\'s text and the song it is a copy of')
  let made: string, entry: Record<string, unknown> = { type: 'json', preload: true }
  if (like !== undefined) {
    const was = song(at, like)
    made = await files.read(was.file)
    entry = was.entry
  } else {
    if (typeof text !== 'string') throw new Error(`make writes ${path} as text`)
    try {
      JSON.parse(text)
    } catch {
      throw new Error(`${path} is written as JSON, and its text is not JSON`)
    }
    made = text
  }
  await files.write(path, made)
  await files.edit(at.catalogue, [...ASSETS, name], { ...entry, url: `/${path}` })
  await files.edit(at.songs, [...SONGS, -1], name, true)
  return { name, file: path }
}

async function drop(body: unknown, files: RouteFiles) {
  const b = bodyOf(body)
  const at = await scene(b, files)
  const { name } = b
  const index = at.list.indexOf(name)
  if (typeof name !== 'string' || index < 0) throw new Error(`${at.songs} has no song ${String(name)}`)
  const { file } = song(at, name)
  if (!(await there(files, file))) throw new Error(`${file} is not there`)
  await files.edit(at.songs, [...SONGS, index], undefined)
  await files.edit(at.catalogue, [...ASSETS, name], undefined)
  await files.remove(file)
  return { name, file }
}

async function rename(body: unknown, files: RouteFiles) {
  const { songs, catalogue, name, to, path } = bodyOf(body)
  if (typeof name !== 'string') throw new Error('rename takes the name of the song it renames')
  const made = await make({ songs, catalogue, name: to, path, like: name }, files)
  await drop({ songs, catalogue, name }, files)
  return made
}

export function synthaudio(r: Router) {
  r.post('make', ({ body, files }) => make(body, files))
  r.post('drop', ({ body, files }) => drop(body, files))
  r.post('rename', ({ body, files }) => rename(body, files))
}
