// The engine knows no package. Its files import one another and nothing else, and no line of them
// names a folder of plugins/ or addons/: a client loads the plugins its scene names, by the name
// the scene gives, and everything outside the step is attached from outside.
//
// A step's rows are the ones standing as its passes begin: a row spawned during the step runs from
// the next step's `before`, and a row ended runs nothing more.
import { expect, test } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { boot, type Row, type Sim, type W } from './engine.ts'

const here = new URL('./', import.meta.url)
const files = readdirSync(here).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
const source = files.map(f => readFileSync(new URL(f, here), 'utf8'))

test('the engine imports only its own files', () => {
  const from = source.flatMap(s => [...s.matchAll(/from '([^']+)'/g)].map(m => m[1]))
  expect(from.length).toBeGreaterThan(0)
  expect(from.filter(f => !f.startsWith('./'))).toEqual([])
})

test('the engine names no plugin and no addon', () => {
  const packages = ['../plugins/', '../addons/'].flatMap(d => readdirSync(new URL(d, here)))
  expect(packages).toContain('box3d')
  expect(packages).toContain('player')
  expect(packages.filter(p => source.some(s => new RegExp(`\\b${p}\\b`).test(s)))).toEqual([])
})

// A scene of an `a` row and a `b` row, with a prefab for every kind `sim` names.
const bootWith = (sim: Sim) => boot({ prefabs: Object.fromEntries(Object.keys(sim).map(k => [k, {}])), actors: [{ is: 'a' }, { is: 'b' }] }, sim)

test('a row spawned during a step runs nothing that step, and every pass of the next from its before', () => {
  const ran: string[] = []
  const hooks = (name: string) => ({ before: () => { ran.push(`${name}.before`) }, tick: () => { ran.push(`${name}.tick`) }, after: () => { ran.push(`${name}.after`) } })
  for (const pass of ['before', 'tick', 'after'] as const) {
    ran.length = 0
    const t = bootWith({ a: { ...hooks('a'), [pass]: (_me: Row, _dt: number, w: W) => { ran.push(`a.${pass}`); if (t.n === 0) w.spawn('kid') } }, b: hooks('b'), kid: hooks('kid') })
    t.step(1 / 30)
    expect(ran).toEqual(['a.before', 'b.before', 'a.tick', 'b.tick', 'a.after', 'b.after'])
    expect(t.rows.map(r => r.kind)).toEqual(['a', 'b', 'kid'])
    ran.length = 0
    t.step(1 / 30)
    expect(ran).toEqual(['a.before', 'b.before', 'kid.before', 'a.tick', 'b.tick', 'kid.tick', 'a.after', 'b.after', 'kid.after'])
  }
})

test('a row ended during a step runs nothing more, in that pass or the ones after it', () => {
  const ran: string[] = []
  const hooks = (name: string) => ({ before: () => { ran.push(`${name}.before`) }, tick: () => { ran.push(`${name}.tick`) }, after: () => { ran.push(`${name}.after`) } })
  const t = bootWith({ a: { ...hooks('a'), tick: (_me, _dt, w) => { ran.push('a.tick'); w.end(w.get(2)) } }, b: hooks('b') })
  t.step(1 / 30)
  expect(ran).toEqual(['a.before', 'b.before', 'a.tick', 'a.after'])
  expect(t.rows.map(r => r.kind)).toEqual(['a'])
})

test('a row that ends itself runs nothing more that step', () => {
  const ran: string[] = []
  const t = bootWith({ a: { before: (me, _dt, w) => { ran.push('a.before'); w.end(me) }, tick: () => { ran.push('a.tick') }, after: () => { ran.push('a.after') } }, b: { after: () => { ran.push('b.after') } } })
  t.step(1 / 30)
  expect(ran).toEqual(['a.before', 'b.after'])
})

test('a row spawned by an act answered as the step begins, or between steps, runs that step', () => {
  const ran: string[] = []
  const t = bootWith({ a: { tick: () => { ran.push('a.tick') }, acts: { make: (_me, w) => { w.spawn('kid') } }, open: ['make'] }, b: {}, kid: { before: () => { ran.push('kid.before') }, tick: () => { ran.push('kid.tick') } } })
  t.open()
  t.inbox(0, { seq: 1, n: 0, id: 1, action: 'make', args: [] })
  t.step(1 / 30)
  expect(ran).toEqual(['kid.before', 'a.tick', 'kid.tick'])
  ran.length = 0
  t.spawn('kid')
  t.step(1 / 30)
  expect(ran).toEqual(['kid.before', 'kid.before', 'a.tick', 'kid.tick', 'kid.tick'])
})
