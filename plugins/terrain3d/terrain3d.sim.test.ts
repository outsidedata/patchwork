// The ground asked of fields the test writes: each op of the height program against its formula,
// the sea, painted layers stroke by stroke, the land record, the rules, and the queries a rule asks
// through `w` of a scene whose `world.terrain3d` names a json file the test hands the loader.
import { expect, test } from 'vitest'
import { boot, type Scene, type W } from '#engine/engine.ts'
import { loader, written } from '#plugins/loader/loader.sim.ts'
import {
  compile, depthAt, edits, hash, heightAt, keys, land, landOf, ray, rawAt, reach, restsAt, rules, shape, shows, simplex, value, worley,
  type Field, type LandRecord, type Node, type Stroke,
} from './terrain3d.sim.ts'

const WORLD = 600
const ANALYSIS = { slopeStep: 1.5, curveStep: 4, positionRadius: 18, occlusionRadius: 30, occlusionSteps: 5, cliffProbe: 12, cliffSlope: 0.5, cliffDrop: 7, flatAngle: 0.03, records: 50000 }

// A field of the nodes given, `out` the last one, with no layers unless given.
const fieldOf = (nodes: Node[], more: Partial<Field> & { hscale?: number; sea?: number; flood?: boolean } = {}): Field => ({
  program: { world: WORLD, hscale: more.hscale ?? 100, sea: more.sea ?? 0.5, flood: more.flood ?? false, out: nodes[nodes.length - 1].id, nodes },
  analysis: ANALYSIS,
  bands: [{ colour: '#3e5722', amount: 1, rules: [] }],
  grain: { base: 0.84, range: 0.32 },
  detail: [],
  surfaces: { road: { colour: '#6d6459', cover: 0, grip: 0.4 }, moss:{ colour: '#27401d', cover: 1.5 } },
  layers: [],
  ...more,
})
// A field whose program is one constant v: at hscale 100 and sea 0.5 the ground is flat at 100v.
const flat = (v: number, more: Parameters<typeof fieldOf>[1] = {}) => fieldOf([{ id: 'c', op: 'const', value: v }], more)

// Hills under grit of `grit` (unitless), in cells 0.7 m across, levelled at spawn.
const noisy = (grit: number): Node[] => [
  { id: 'hills', op: 'noise', kind: 'simplex', freq: 3, seed: 21 },
  { id: 'grit', op: 'noise', kind: 'value', freq: WORLD / 0.7, seed: 8 },
  { id: 'gritUp', op: 'remap', input: 'grit', inLo: 0, inHi: 1, outLo: 0, outHi: grit, ease: 'linear' },
  { id: 'sum', op: 'combine', a: 'hills', b: 'gritUp', mode: 'add' },
  { id: 'spawn', op: 'clearing', input: 'sum', flat: 40, floor: 0.12 },
]
const at = (nodes: Node[], x: number, z: number) => compile({ world: WORLD, hscale: 1, sea: 0.5, flood: false, out: nodes[nodes.length - 1].id, nodes }).run(x, z)
const lattice = (x: number, freq: number) => (x / WORLD + 0.5) * freq

test('the hash is a whole number mixed from every input, and each noise stays in its range', () => {
  expect(Number.isInteger(hash(3, 4, 5))).toBe(true)
  expect(new Set([hash(3, 4, 5), hash(4, 3, 5), hash(3, 4, 6), hash(3, 5, 5)]).size).toBe(4)
  for (let i = 0; i < 500; i++) {
    const x = i * 0.731 - 90, z = i * 0.377 + 11
    expect(value(x, z, 7)).toBeGreaterThanOrEqual(0)
    expect(value(x, z, 7)).toBeLessThan(1)
    expect(worley(x, z, 7, 'f2')).toBeLessThanOrEqual(1)
    expect(Math.abs(simplex(x, z, 7) - 0.5)).toBeLessThan(0.6)
  }
  // Value noise is its corner's hash on a lattice point, and between two corners the quintic fade.
  expect(value(3, 4, 9)).toBe(hash(3, 4, 9) / 2 ** 32)
  const a = hash(3, 4, 9) / 2 ** 32, b = hash(4, 4, 9) / 2 ** 32
  const q = 0.3 ** 3 * (0.3 * (0.3 * 6 - 15) + 10)
  expect(value(3.3, 4, 9)).toBeCloseTo(a + (b - a) * q, 12)
})

test('worley measures f1, f2 and their difference to the hashed points of the 3×3 cells around', () => {
  const x = 5.4, z = 2.2
  const d: number[] = []
  for (let cj = 1; cj <= 3; cj++) for (let ci = 4; ci <= 6; ci++) {
    d.push(Math.hypot(ci + hash(ci, cj, 3) / 2 ** 32 - x, cj + hash(ci, cj, 3 ^ 0x5bd1e995) / 2 ** 32 - z))
  }
  d.sort((p, q) => p - q)
  expect(worley(x, z, 3)).toBeCloseTo(Math.min(1, d[0]), 12)
  expect(worley(x, z, 3, 'f2')).toBeCloseTo(Math.min(1, d[1]), 12)
  expect(worley(x, z, 3, 'f2-f1')).toBeCloseTo(Math.min(1, d[1] - d[0]), 12)
})

test('const, noise, fold, remap, combine and scale each give their formula', () => {
  expect(at([{ id: 'c', op: 'const', value: 0.37 }], 50, -80)).toBe(0.37)
  const x = 123.4, z = -56.7
  const n: Node = { id: 'n', op: 'noise', kind: 'value', freq: 3, seed: 11 }
  const v = value(lattice(x, 3), lattice(z, 3), 11)
  expect(at([n], x, z)).toBe(v)
  expect(at([{ ...n, kind: 'simplex' }], x, z)).toBe(simplex(lattice(x, 3), lattice(z, 3), 11))
  expect(at([{ ...n, kind: 'worley', metric: 'f2-f1' }], x, z)).toBe(worley(lattice(x, 3), lattice(z, 3), 11, 'f2-f1'))
  // Turned a quarter, then stretched: x' = −z, z' = x.
  const r = 0.4, s = [2, 0.5]
  const tx = (x * Math.cos(r) - z * Math.sin(r)) * s[0], tz = (x * Math.sin(r) + z * Math.cos(r)) * s[1]
  expect(at([{ ...n, rotate: r, stretch: s }], x, z)).toBeCloseTo(value(lattice(tx, 3), lattice(tz, 3), 11), 12)

  const fold = (kind: string, steps?: number) => at([n, { id: 'f', op: 'fold', input: 'n', kind, steps }], x, z)
  expect(fold('ridge')).toBeCloseTo((1 - Math.abs(2 * v - 1)) ** 2, 12)
  expect(fold('billow')).toBeCloseTo(Math.abs(2 * v - 1) ** 2, 12)
  expect(fold('abs')).toBeCloseTo(Math.abs(2 * v - 1), 12)
  const t = v * 4, f = Math.floor(t), rise = (t - f) ** 3 * ((t - f) * ((t - f) * 6 - 15) + 10)
  expect(fold('terrace', 4)).toBeCloseTo((f + rise) / 4, 12)

  const remap = (ease: string, inLo = 0.2, inHi = 0.9) => at([n, { id: 'r', op: 'remap', input: 'n', inLo, inHi, outLo: -1, outHi: 3, ease }], x, z)
  const u = Math.min(1, Math.max(0, (v - 0.2) / 0.7))
  expect(remap('linear')).toBeCloseTo(-1 + 4 * u, 12)
  expect(remap('smooth')).toBeCloseTo(-1 + 4 * u * u * (3 - 2 * u), 12)
  expect(remap('smoother')).toBeCloseTo(-1 + 4 * u ** 3 * (u * (u * 6 - 15) + 10), 12)
  expect(remap('linear', 2, 3)).toBe(-1)
  expect(remap('linear', -3, -2)).toBe(3)

  const two = [{ id: 'a', op: 'const', value: 0.3 }, { id: 'b', op: 'const', value: 0.8 }]
  const combine = (mode: string, t?: number) => at([...two, { id: 'm', op: 'combine', a: 'a', b: 'b', mode, t }], 0, 0)
  expect(combine('add')).toBeCloseTo(1.1, 12)
  expect(combine('sub')).toBeCloseTo(-0.5, 12)
  expect(combine('mul')).toBeCloseTo(0.24, 12)
  expect(combine('min')).toBe(0.3)
  // Both above a half, and both below: min and max compare the two inputs and nothing else.
  const pair = (a: number, b: number, mode: string) => at([{ id: 'a', op: 'const', value: a }, { id: 'b', op: 'const', value: b }, { id: 'm', op: 'combine', a: 'a', b: 'b', mode }], 0, 0)
  expect(pair(0.7, 0.9, 'min')).toBe(0.7)
  expect(pair(0.7, 0.9, 'max')).toBe(0.9)
  expect(pair(0.1, 0.2, 'min')).toBe(0.1)
  expect(pair(0.1, 0.2, 'max')).toBe(0.2)
  expect(combine('max')).toBe(0.8)
  expect(combine('lerp')).toBeCloseTo(0.55, 12)
  expect(combine('lerp', 0.2)).toBeCloseTo(0.4, 12)
  expect(at([...two, { id: 's', op: 'scale', input: 'b', by: -2 }], 0, 0)).toBe(-1.6)
})

test('a warp runs the nodes up to its input again at the point moved amount·(x, z) metres', () => {
  const nodes: Node[] = [
    { id: 'n', op: 'noise', kind: 'simplex', freq: 5, seed: 2 },
    { id: 'dx', op: 'const', value: 0.25 },
    { id: 'dz', op: 'const', value: -0.5 },
    { id: 'w', op: 'warp', input: 'n', x: 'dx', z: 'dz', amount: 40 },
  ]
  expect(at(nodes, 10, 20)).toBe(at(nodes.slice(0, 1), 10 + 40 * 0.25, 20 - 40 * 0.5))
  // A warp of a warp: each runs its own input again.
  const twice: Node[] = [...nodes, { id: 'w2', op: 'warp', input: 'w', x: 'dx', z: 'dx', amount: 8 }]
  expect(at(twice, 10, 20)).toBe(at(nodes.slice(0, 1), 10 + 2 + 10, 20 + 2 - 20))
})

test('a crater digs its floor −depth(1 − q²), rises to its rim at q = 1, and its apron fades out to ejecta radii', () => {
  const crater: Node = { id: 'k', op: 'craters', freq: 1, seed: 4, radius: [50, 50], depth: 0.4, rim: 0.1, rimWidth: 0.05, ejecta: 3 }
  // One cell across the world: its crater's centre is at the hashed point of cell (0, 0).
  const cx = (hash(0, 0, 4) / 2 ** 32 - 0.5) * WORLD, cz = (hash(0, 0, 4 ^ 0x5bd1e995) / 2 ** 32 - 0.5) * WORLD
  const one = (dx: number) => at([crater], cx + dx, cz)
  // Each neighbouring crater is at least a cell's width away less its own reach, so near the centre
  // only this one counts: the floor and the rim's gaussian tail.
  const rimAt = (q: number) => 0.1 * Math.max(Math.exp(-0.5 * ((q - 1) / 0.05) ** 2), q >= 1 && q < 3 ? (1 - (q - 1) / 2) ** 2 : 0)
  expect(one(0)).toBeCloseTo(-0.4 + rimAt(0), 9)
  expect(one(25)).toBeCloseTo(-0.4 * (1 - 0.25) + rimAt(0.5), 9)
  expect(one(50)).toBeCloseTo(0.1, 9)
  expect(one(100)).toBeCloseTo(0.1 * 0.25, 9)
  expect(one(-100)).toBeCloseTo(0.1 * 0.25, 9)
})

test('a clearing levels its input toward its own value at the origin, not toward 0', () => {
  const nodes: Node[] = [
    { id: 'n', op: 'noise', kind: 'value', freq: 4, seed: 9 },
    { id: 'up', op: 'remap', input: 'n', inLo: 0, inHi: 1, outLo: 0.5, outHi: 0.9, ease: 'linear' },
    { id: 'c', op: 'clearing', input: 'up', flat: 40, floor: 0.12 },
  ]
  const v0 = at(nodes.slice(0, 2), 0, 0)
  expect(v0).toBeGreaterThan(0.5)
  expect(at(nodes, 0, 0)).toBe(v0)
  for (const [x, z] of [[10, 5], [-30, 22], [60, -80], [300, 10]]) {
    const r2 = x * x + z * z, keep = 0.12 + 0.88 * (1 - Math.exp(-r2 / (2 * 40 * 40)))
    expect(at(nodes, x, z)).toBeCloseTo(v0 + (at(nodes.slice(0, 2), x, z) - v0) * keep, 12)
  }
  // So the ground at spawn is the program's own there, with no pit dug to 0.
  const f = fieldOf(nodes)
  expect(land(f).height(0, 0)).toBeCloseTo(v0 * 100 - 0, 9)
})

test('an input that names no earlier node throws naming the node, so no cycle can be written', () => {
  const forward: Node[] = [{ id: 'a', op: 'scale', input: 'b', by: 2 }, { id: 'b', op: 'const', value: 1 }]
  expect(() => compile({ world: WORLD, hscale: 1, sea: 0.5, flood: false, out: 'b', nodes: forward })).toThrow('terrain3d node a reads input b, which is not a node before it')
  const self: Node[] = [{ id: 'a', op: 'combine', a: 'a', b: 'a', mode: 'add' }]
  expect(() => compile({ world: WORLD, hscale: 1, sea: 0.5, flood: false, out: 'a', nodes: self })).toThrow('terrain3d node a reads a a')
  expect(() => compile({ world: WORLD, hscale: 1, sea: 0.5, flood: false, out: 'z', nodes: [{ id: 'a', op: 'const', value: 0 }] })).toThrow('terrain3d program out z')
  expect(() => compile({ world: WORLD, hscale: 1, sea: 0.5, flood: false, out: 'a', nodes: [{ id: 'a', op: 'spin' }] })).toThrow('terrain3d node a op spin')
  const flatRemap: Node[] = [{ id: 'a', op: 'const', value: 0.5 }, { id: 'r', op: 'remap', input: 'a', inLo: 0.5, inHi: 0.5, outLo: 0, outHi: 1 }]
  expect(() => compile({ world: WORLD, hscale: 1, sea: 0.5, flood: false, out: 'r', nodes: flatRemap })).toThrow('terrain3d node r remaps from 0.5 to 0.5, which is no span')
})

test('the waterline is y = 0; with flood the height is the water and depth what is under it, with none there is no sea', () => {
  // program 0.2 at hscale 50 and sea 0.6: raw = 10 − 50·0.2 = 0 … choose 0.1: raw = 5 − 10 = −5.
  const wet = land(flat(0.1, { hscale: 50, sea: 0.6, flood: true }))
  expect(wet.raw(3, 4)).toBeCloseTo(-5, 12)
  expect(wet.height(3, 4)).toBe(0)
  expect(wet.depth(3, 4)).toBeCloseTo(5, 12)
  const dry = land(flat(0.1, { hscale: 50, sea: 0.6, flood: false }))
  expect(dry.height(3, 4)).toBeCloseTo(-5, 12)
  expect(dry.depth(3, 4)).toBe(0)
  const high = land(flat(0.9, { hscale: 50, sea: 0.6, flood: true }))
  expect(high.height(3, 4)).toBeCloseTo(35, 12)
  expect(high.depth(3, 4)).toBe(0)
})

// ---------------------------------------------------------------- painted layers

const layerOf = (strokes: Stroke[], at = [0, 0], size = 64, px = 64) => ({ at, size, px, strokes })
const stroke = (verb: Stroke['verb'], more: Partial<Stroke> = {}): Stroke => ({ verb, radius: 8, hardness: 0.5, strength: 3, level: 0, surface: 'road', path: [[0, 0]], ...more })
// A pixel's centre of a 64 m, 64-pixel layer on the origin: pixels are 1 m, centres on the half metre.
const P = (i: number) => -32 + 0.5 + i
const f = (d: number, r = 8, hardness = 0.5) => Math.min(1, Math.max(0, (1 - d / r) / (1 - hardness)))

test('raise and lower move the ground f·strength from where it was; flatten moves it f of the way to level', () => {
  const at = P(34), d = Math.hypot(at, at)
  for (const [verb, goal] of [['raise', 20 + 3], ['lower', 20 - 3], ['flatten', 5]] as const) {
    const one = land(flat(0.2, { layers: [layerOf([stroke(verb, { level: 5 })])] }))
    expect(one.raw(at, at)).toBeCloseTo(20 + (goal - 20) * f(d), 9)
    expect(one.raw(40, 40)).toBe(20)
  }
})

test('each verb over painted pixels moves them on from the painted ground', () => {
  const first = stroke('flatten', { level: 10, hardness: 1, radius: 20 })
  const at = P(33), d = Math.hypot(at, at)
  const over = (s: Stroke) => land(flat(0.2, { layers: [layerOf([first, s])] })).raw(at, at)
  expect(over(stroke('raise'))).toBeCloseTo(10 + 3 * f(d), 9)
  expect(over(stroke('lower'))).toBeCloseTo(10 - 3 * f(d), 9)
  expect(over(stroke('flatten', { level: 30 }))).toBeCloseTo(10 + 20 * f(d), 9)
  // Smooth and bench over ground painted flat at 10 leave it at 10.
  expect(over(stroke('smooth'))).toBeCloseTo(10, 9)
  expect(over(stroke('bench', { path: [[-5, 0], [5, 0]] }))).toBeCloseTo(10, 9)
  // A surface stroke moves no ground.
  expect(over(stroke('surface'))).toBeCloseTo(10, 9)
})

test('a soft edge over painted ground stays soft', () => {
  const hard = stroke('flatten', { level: 10, hardness: 1, radius: 30 })
  const soft = stroke('flatten', { level: 30, hardness: 0, radius: 12 })
  const l = land(flat(0.2, { layers: [layerOf([hard, soft])] }))
  // Out from the soft stroke's centre, the ground falls from 30 back to the hard stroke's 10 by its
  // falloff, with no step where the first stroke's weight is already whole.
  let last = Infinity
  for (let i = 32; i < 46; i++) {
    const x = P(i)
    const h = l.raw(x, P(32))
    expect(h).toBeCloseTo(10 + 20 * f(Math.hypot(x, P(32)), 12, 0), 9)
    expect(h).toBeLessThanOrEqual(last)
    last = h
  }
})

test('over partly painted pixels a stroke still moves the ground f of the way from where the paint left it', () => {
  const first = stroke('flatten', { level: 10, hardness: 0, radius: 20 })
  const second = stroke('raise', { strength: 6, hardness: 0, radius: 12, path: [[3, 0]] })
  const l = land(flat(0.2, { layers: [layerOf([first, second])] }))
  for (const i of [30, 33, 36, 39]) {
    const x = P(i), z = P(32)
    const h1 = 20 + (10 - 20) * f(Math.hypot(x, z), 20, 0)
    expect(l.raw(x, z)).toBeCloseTo(h1 + 6 * f(Math.hypot(x - 3, z), 12, 0), 9)
  }
})

test('smooth reads the ground as it was before the stroke, never pixels from its own stroke', () => {
  // A ridge: 1 m wide along z, 10 m high, on flat ground at 20.
  const ridge = stroke('flatten', { level: 30, hardness: 1, radius: 0.6, path: [[P(32), -30], [P(32), 30]] })
  const smooth = stroke('smooth', { radius: 4, hardness: 1, path: [[-10, 0], [10, 0]] })
  const l = land(flat(0.2, { layers: [layerOf([ridge, smooth])] }))
  const before = land(flat(0.2, { layers: [layerOf([ridge])] }))
  // Each pixel is the mean of five taps of the ridged ground: centre and ±2 m along x and z. A pixel
  // 2 m from the ridge reads it once; had it read the pixels its own stroke had already smoothed,
  // those next to it would be raised too.
  for (const i of [28, 29, 30, 31, 32, 33, 34, 35, 36]) {
    const x = P(i), z = P(32)
    const taps = [[x, z], [x + 2, z], [x - 2, z], [x, z + 2], [x, z - 2]].map(([a, b]) => before.raw(a, b))
    expect(l.raw(x, z)).toBeCloseTo(taps.reduce((s, h) => s + h, 0) / 5, 9)
  }
})

test('bench cuts a road flatter across the path than the bare ground, and follows the hill along it', () => {
  // A path up the tilted plane along x, from x −20 to 20, at z 0.
  const rising = (more: Parameters<typeof fieldOf>[1] = {}) => fieldOf([
    { id: 'n', op: 'noise', kind: 'value', freq: 3, seed: 5 },
    { id: 'hill', op: 'remap', input: 'n', inLo: 0, inHi: 1, outLo: 0, outHi: 1, ease: 'linear' },
  ], more)
  const bench = stroke('bench', { radius: 6, hardness: 1, path: [[-20, 0.5], [20, 0.5]] })
  const bare = land(rising())
  const cut = land(rising({ layers: [layerOf([bench], [0, 0], 64, 64)] }))
  let bareAcross = 0, cutAcross = 0, along = 0
  for (let x = -15.5; x <= 15.5; x += 1) {
    bareAcross += Math.abs(bare.raw(x, 3.5) - bare.raw(x, -2.5))
    cutAcross += Math.abs(cut.raw(x, 3.5) - cut.raw(x, -2.5))
    along += Math.abs(cut.raw(x, 0.5) - bare.raw(x, 0.5))
  }
  expect(bareAcross).toBeGreaterThan(1)
  expect(cutAcross).toBeLessThan(bareAcross / 20)
  // On the centre line the road is the hill itself.
  expect(along).toBeLessThan(1e-9)
})

test('a program edit carries a raised spot with it', () => {
  const layers = [layerOf([stroke('raise', { strength: 4, hardness: 1, radius: 3 })])]
  const before = land(flat(0.2, { layers }))
  const after = land(flat(0.35, { layers }))
  expect(before.raw(P(32), P(32))).toBeCloseTo(24, 9)
  expect(after.raw(P(32), P(32))).toBeCloseTo(39, 9)
})

test('paint feathers out over one pixel at a layer\'s edge', () => {
  const l = land(flat(0.2, { layers: [layerOf([stroke('flatten', { level: 50, hardness: 1, radius: 100 })], [0, 0], 8, 8)] }))
  // Pixel centres run from −3.5 to 3.5; at −4 the paint is half, from −4.5 out it is gone.
  expect(l.raw(-3.5, 0)).toBeCloseTo(50, 9)
  expect(l.raw(-4, 0)).toBeCloseTo(35, 9)
  expect(l.raw(-4.5, 0)).toBe(20)
})

test('a surface stroke paints its surface, which takes another\'s pixel only where it outweighs it, and sets cover and grip', () => {
  const road = stroke('surface', { surface: 'road', hardness: 1, radius: 10 })
  const l = land(flat(0.2, { layers: [layerOf([road])] }))
  expect(l.paint(P(32), P(32))).toEqual({ weight: 1, surface: 'road', cover: 0, grip: 0.4 })
  expect(l.paint(20, 20)).toEqual({ weight: 0, surface: undefined, cover: 1, grip: 1 })
  const soft = stroke('surface', { surface: 'moss', hardness: 0, radius: 10, path: [[6, 0]] })
  const both = land(flat(0.2, { layers: [layerOf([road, soft])] }))
  // Where the moss's f is 0.9 it does not outweigh the road's 1; beyond the road it paints.
  expect(both.paint(P(33), P(32)).surface).toBe('road')
  const x = P(46), fm = f(Math.hypot(x - 6, P(32)), 10, 0)
  const p = both.paint(x, P(32))
  expect(p.surface).toBe('moss')
  expect(p.weight).toBeCloseTo(fm, 9)
  expect(p.cover).toBeCloseTo(1 + 0.5 * fm, 9)
  // moss names no grip, so it grips as unpainted ground.
  expect(p.grip).toBe(1)
  expect(() => land(flat(0.2, { layers: [layerOf([stroke('surface', { surface: 'lava' })])] })).paint(0, 0)).toThrow('terrain3d stroke surface lava is none of the surfaces: road, moss')
})

test('stroke bakes into a layer\'s pixels, moves its version and every later layer it reaches, and drops the records it changed', () => {
  const f0 = flat(0.2, { layers: [layerOf([], [0, 0], 32, 32), layerOf([stroke('raise', { strength: 2, radius: 20, hardness: 1 })], [0, 0], 32, 32), layerOf([], [500, 500], 16, 16)] })
  const l = land(f0)
  const near = l.analyse(0.5, 0.5), far = l.analyse(400, 400)
  expect(near.height).toBeCloseTo(22, 9)
  expect(l.edits().layers.map(e => e.version)).toEqual([0, 0, 0])
  l.stroke(0, stroke('raise', { strength: 5, radius: 20, hardness: 1 }))
  // Layer 1 raised 2 over the new ground, so it rises with it; layer 2 is far away and stays.
  expect(l.raw(0.5, 0.5)).toBeCloseTo(27, 9)
  expect(l.edits().layers.map(e => e.version)).toEqual([1, 1, 0])
  expect(l.analyse(0.5, 0.5)).not.toBe(near)
  expect(l.analyse(0.5, 0.5).height).toBeCloseTo(27, 9)
  expect(l.analyse(400, 400)).toBe(far)
  // The file is untouched.
  expect(f0.layers[0].strokes).toEqual([])
  const g = reach(ANALYSIS)
  expect(l.rect(2)).toEqual([500 - 8.5 - g, 500 - 8.5 - g, 500 + 8.5 + g, 500 + 8.5 + g])
  expect(l.edits().land).toBe(l)
})

test('a later layer whose strokes read the ground a stroke changed is baked again, though its pixels are elsewhere', () => {
  // Layer 1 is 8 m across at the origin. Its bench reads its path out to x = 12, and its smooth reads
  // half its radius out: both read ground a stroke into layer 0 changes outside layer 1's pixels.
  const hilly = (layers: Field['layers']) => fieldOf([{ id: 'n', op: 'noise', kind: 'value', freq: 6, seed: 3 }], { layers })
  const bench = stroke('bench', { radius: 10, hardness: 1, path: [[12, 0], [-12, 0]] })
  const late = stroke('raise', { radius: 2, strength: 10, hardness: 1, path: [[12, 0]] })
  const one = land(hilly([layerOf([]), layerOf([bench], [0, 0], 8, 8)]))
  one.raw(0, 0)
  one.stroke(0, late)
  expect(one.version(1)).toBe(1)
  expect(one.raw(3.5, 0.5)).toBe(land(hilly([layerOf([late]), layerOf([bench], [0, 0], 8, 8)])).raw(3.5, 0.5))
  const smooth = stroke('smooth', { radius: 12, hardness: 1, path: [[3.5, 0.5]] })
  const far = stroke('raise', { radius: 1.5, strength: 20, hardness: 1, path: [[9.5, 0.5]] })
  const two = land(hilly([layerOf([]), layerOf([smooth], [0, 0], 8, 8)]))
  two.raw(0, 0)
  two.stroke(0, far)
  // Missed, this point stood 4 m off the ground a fresh bake gives.
  expect(two.raw(3.5, 0.5)).toBe(land(hilly([layerOf([far]), layerOf([smooth], [0, 0], 8, 8)])).raw(3.5, 0.5))
})

test('a drag bakes its path so far once each time, and ends where one bake of the whole path does', () => {
  const path = [[-20, -3], [-8, 2], [4, -1], [15, 6]]
  const drag = (verb: Stroke['verb']) => {
    const l = land(fieldOf(noisy(0.01), { layers: [layerOf([])] }))
    for (let n = 1; n <= path.length; n++) l.stroke(0, stroke(verb, { radius: 5, path: path.slice(0, n) }))
    const whole = land(fieldOf(noisy(0.01), { layers: [layerOf([stroke(verb, { radius: 5, path })])] }))
    for (let x = -30; x <= 30; x += 1.7) for (let z = -12; z <= 12; z += 1.3) expect(l.raw(x, z)).toBe(whole.raw(x, z))
    expect(l.version(0)).toBe(path.length)
    expect(l.paint(4, -1)).toEqual(whole.paint(4, -1))
  }
  for (const verb of ['raise', 'smooth', 'bench', 'surface'] as const) drag(verb)
})

test('an unsaved stroke survives a stroke into an earlier layer, and a new land keeps it until its file holds it', () => {
  const s1 = stroke('raise', { radius: 6, strength: 4, path: [[2, 2], [9, 4]] })
  const s0 = stroke('flatten', { radius: 10, hardness: 0.3, level: 5, path: [[0, 0]] })
  const layers = (a: Stroke[], b: Stroke[]) => [layerOf(a), layerOf(b, [4, 4], 32, 32)]
  const l = land(flat(0.2, { layers: layers([], []) }))
  l.stroke(1, s1)
  l.stroke(0, s0)
  expect(l.unsaved(1)).toBe(s1)
  const saved = land(flat(0.2, { layers: layers([s0], [s1]) }))
  for (let x = -12; x <= 14; x += 1.1) expect(l.raw(x, 3)).toBe(saved.raw(x, 3))
  // Made again from a file that holds neither stroke, the new land keeps both; from one that holds
  // them, neither.
  const next = land(flat(0.25, { layers: layers([], []) }), l)
  expect([next.unsaved(0), next.unsaved(1)]).toEqual([s0, s1])
  expect(next.raw(5, 3)).toBe(land(flat(0.25, { layers: layers([s0], [s1]) })).raw(5, 3))
  const held = land(flat(0.2, { layers: layers([s0], [structuredClone(s1)]) }), l)
  expect([held.unsaved(0), held.unsaved(1)]).toEqual([undefined, undefined])
})

test('an empty point breaks a stroke\'s path into runs, and nothing between them is painted', () => {
  const runs = stroke('raise', { radius: 4, hardness: 0.5, strength: 3, path: [[-20, 0], [-10, 0], [], [10, 0], [20, 0], []] })
  const l = land(flat(0.2, { layers: [layerOf([runs])] }))
  // The gap between x = −10 and x = 10 is untouched; each run is painted as its own path.
  expect(l.raw(0, 0)).toBe(20)
  expect(l.raw(-5.5, 0)).toBe(20)
  const left = land(flat(0.2, { layers: [layerOf([stroke('raise', { radius: 4, hardness: 0.5, strength: 3, path: [[-20, 0], [-10, 0]] })])] }))
  const right = land(flat(0.2, { layers: [layerOf([stroke('raise', { radius: 4, hardness: 0.5, strength: 3, path: [[10, 0], [20, 0]] })])] }))
  for (const x of [-21.5, -15.5, -9.5, 9.5, 15.5, 21.5]) expect(l.raw(x, 1.5)).toBe((x < 0 ? left : right).raw(x, 1.5))
  // A run of one point is painted round that point; a bench finds its road on the runs alone.
  const dot = land(flat(0.2, { layers: [layerOf([stroke('raise', { radius: 4, strength: 3, path: [[], [5, 5], []] })])] }))
  expect(dot.raw(5.5, 5.5)).toBeCloseTo(20 + 3 * f(Math.hypot(0.5, 0.5), 4), 9)
  const bench = land(flat(0.2, { layers: [layerOf([stroke('bench', { radius: 4, path: [[-20, 0], [-10, 0], [], [10, 0], [20, 0]] })])] }))
  expect(bench.raw(0.5, 0.5)).toBe(20)
})

test('through reads the ground as a layer leaves it: the program and that layer and every one before it', () => {
  const up = stroke('raise', { radius: 10, strength: 4 })
  const l = land(flat(0.2, { layers: [layerOf([up]), layerOf([stroke('flatten', { radius: 12, hardness: 1, level: 50 })], [0, 0], 32, 32)] }))
  const alone = land(flat(0.2, { layers: [layerOf([up])] }))
  for (const x of [-9.3, 0.5, 4.1]) {
    expect(l.through(0, x, 1.7)).toBe(alone.raw(x, 1.7))
    expect(l.through(1, x, 1.7)).toBe(l.raw(x, 1.7))
  }
  expect(l.through(0, 0.5, 0.5)).toBeCloseTo(20 + 4 * f(Math.SQRT1_2, 10), 9)
  expect(l.raw(0.5, 0.5)).toBeCloseTo(50, 9)
  expect(() => l.through(2, 0, 0)).toThrow('terrain3d has no layer 2')
})

test('a land keeps at most `records` land records, the one asked for longest ago going first, made again the same', () => {
  const l = land(fieldOf(noisy(0.01), { analysis: { ...ANALYSIS, records: 3 } }))
  const [a, b, c, d] = [[1, 2], [30, -4], [-17, 9], [55, 55]]
  const ask = (p: number[]) => l.analyse(p[0], p[1])
  const values = (r: LandRecord) => keys.map(k => r[k])
  const ra = ask(a), rb = ask(b), rc = ask(c)
  const firstB = values(rb)
  // Asked for again, a is the newest: b is the one asked for longest ago, and d pushes it out.
  expect(ask(a)).toBe(ra)
  const rd = ask(d)
  expect(ask(a)).toBe(ra)
  expect(ask(c)).toBe(rc)
  const again = ask(b)
  expect(again).not.toBe(rb)
  expect(values(again)).toEqual(firstB)
  // b came back in place of d, the one asked for longest ago by then.
  expect(ask(d)).not.toBe(rd)
  expect(() => land(fieldOf(noisy(0.01), { analysis: { ...ANALYSIS, records: 0 } }))).toThrow('terrain3d analysis records 0 is not a whole number above 0')
})

test('a stroke that replaces a layer\'s unsaved stroke changes the ground the one it replaced had changed', () => {
  // A drag on layer 0 that starts at A and is then replaced by a stroke at B, far off: the ground at
  // A goes back, and layer 1, which lies over A only and raises what is under it, is baked again.
  const layers = (a: Stroke[], b: Stroke[]) => [layerOf(a, [0, 0], 64, 64), layerOf(b, [-20, 0], 12, 12)]
  const atA = stroke('flatten', { radius: 5, hardness: 0.6, level: 40, path: [[-20, 0]] })
  const atB = stroke('raise', { radius: 4, strength: 3, path: [[20, 10]] })
  const up = stroke('raise', { radius: 4, strength: 2, path: [[-20, 0]] })
  const l = land(fieldOf(noisy(0.01), { layers: layers([], [up]) }))
  const record = l.analyse(-20, 0).height
  l.stroke(0, atA)
  expect(l.analyse(-20, 0).height).not.toBeCloseTo(record, 3)
  l.stroke(0, atB)
  const fresh = land(fieldOf(noisy(0.01), { layers: layers([atB], [up]) }))
  for (let x = -30; x <= 30; x += 1.3) expect(l.raw(x, 0.4)).toBe(fresh.raw(x, 0.4))
  expect(l.version(1)).toBe(2)
  expect(l.analyse(-20, 0).height).toBe(fresh.analyse(-20, 0).height)
})

test('discard puts a layer back as it was before its unsaved stroke, bakes again the later layers that read it, and drops the records', () => {
  // Layer 1 lies beside the stroke, which reaches x = 9, and its bench levels its pixels to the
  // ground at the origin, so it reads the stroked ground though its pixels are elsewhere.
  const layers = (a: Stroke[], b: Stroke[]) => [layerOf(a), layerOf(b, [14, 0], 8, 8)]
  const later = stroke('bench', { radius: 14, hardness: 1, path: [[0, 0]] })
  const s = stroke('raise', { radius: 6, hardness: 0.3, strength: 6, path: [[0, 0], [3, 2]] })
  const file = () => fieldOf(noisy(0.01), { layers: layers([], [later]) })
  const l = land(file()), bare = land(file())
  l.stroke(0, s)
  // Read between the stroke and the discard: the stroked ground, layer 1 over it, and a record.
  const stroked = [l.raw(0, 0), l.raw(11.5, 0.5), l.analyse(1, 1).height]
  expect(stroked[0]).toBeGreaterThan(bare.raw(0, 0) + 3)
  expect(stroked[1]).not.toBe(bare.raw(11.5, 0.5))
  expect(stroked[2]).not.toBe(bare.analyse(1, 1).height)
  const v1 = l.version(1)
  l.discard(0)
  expect(l.unsaved(0)).toBeUndefined()
  expect(l.version(0)).toBe(2)
  expect(l.version(1)).toBe(v1 + 1)
  expect(l.edits().layers.map(e => e.version)).toEqual([2, v1 + 1])
  for (let x = -20; x <= 20; x += 1.1) for (let z = -10; z <= 12; z += 2.3) {
    expect(l.raw(x, z)).toBe(bare.raw(x, z))
    expect(l.paint(x, z)).toEqual(bare.paint(x, z))
  }
  const values = (r: LandRecord) => keys.map(k => r[k])
  expect(values(l.analyse(1, 1))).toEqual(values(bare.analyse(1, 1)))
  // The next land, from a file that never held the stroke, has none to keep; a second discard does
  // nothing, and a layer that is not there throws.
  expect(land(file(), l).unsaved(0)).toBeUndefined()
  l.discard(0)
  expect(l.version(0)).toBe(2)
  expect(() => l.discard(5)).toThrow('terrain3d has no layer 5')
})

// ---------------------------------------------------------------- the land record and rules

test('the land record reads relief, slope, aspect, position, curvature, form and water off the ground', () => {
  // Level ground 50 m up: nothing rises or falls.
  const level = land(flat(0.5))
  const r = level.analyse(10, 10)
  expect(r.height).toBeCloseTo(50, 9)
  expect(r.relief).toBeCloseTo(0.5, 9)
  expect(r.slope).toBeCloseTo(0, 12)
  expect(r.position).toBeCloseTo(0, 9)
  expect(r.form).toBe(0)
  expect(r.occlusion).toBe(0)
  expect(r.cliffAbove).toBe(0)
  expect(r.water).toBe(0)
  expect(level.analyse(10, 10)).toBe(r)
  // A pit dug by a crater: its floor is a hollow whose every direction rises.
  const pit = land(fieldOf([{ id: 'k', op: 'craters', freq: 1, seed: 4, radius: [80, 80], depth: 0.5, rim: 0, rimWidth: 0.1, ejecta: 0 }]))
  const cx = (hash(0, 0, 4) / 2 ** 32 - 0.5) * WORLD, cz = (hash(0, 0, 4 ^ 0x5bd1e995) / 2 ** 32 - 0.5) * WORLD
  const floor = pit.analyse(cx, cz)
  expect(floor.form).toBe(9)
  expect(floor.position).toBeLessThan(0)
  expect(floor.plan).toBeGreaterThan(0)
  expect(floor.occlusion).toBeGreaterThan(0)
  expect(floor.wet).toBeGreaterThan(0)
  // On its wall the slope faces the centre: downhill from a point east of it is west, −x.
  const wall = pit.analyse(cx + 40, cz)
  expect(wall.slope).toBeGreaterThan(0.1)
  expect(wall.aspect).toBeCloseTo(-Math.PI / 2, 6)
  // A flooded pit holds water, and its record says how deep.
  const sea = land(fieldOf([{ id: 'k', op: 'craters', freq: 1, seed: 4, radius: [80, 80], depth: 0.5, rim: 0, rimWidth: 0.1, ejecta: 0 }], { flood: true, sea: 0.4 }))
  expect(sea.analyse(cx, cz).water).toBeCloseTo(50 - 20, 6)
})

test('shape is a clamped ramp, inverted when lo > hi; a rule reads the record; a rule on no key throws naming it', () => {
  expect(shape(0.5, 0, 1)).toBe(0.5)
  expect(shape(2, 0, 1)).toBe(1)
  expect(shape(0.25, 1, 0)).toBe(0.75)
  expect(shape(-1, 1, 0)).toBe(1)
  expect(shape(0.3, 0.3, 0.3)).toBe(1)
  expect(shape(0.2, 0.3, 0.3)).toBe(0)
  const l = land(flat(0.3))
  expect(l.ramp({ q: 'relief', lo: 0, hi: 0.6 }, 0, 0)).toBeCloseTo(0.5, 9)
  expect(keys).toContain('wet')
  const list = [{ q: 'slope', lo: 0, hi: 1 }, { q: 'steepness', lo: 0, hi: 1 }]
  expect(() => rules(list, 'scatter pack firs')).toThrow('scatter pack firs rule 1 reads steepness, which is none of the land record\'s keys')
  expect(() => land(flat(0.3, { bands: [{ colour: '#000', amount: 1, rules: [] }, { colour: '#fff', amount: 1, rules: [{ q: 'height2', lo: 0, hi: 1 }] }] }))).toThrow('terrain3d band 1 rule 0 reads height2')
})

test('a land is made only of looks it can draw: every edge, every detail layer\'s kind, rules, fade, noise and maps', () => {
  const NOISE = { freqs: [0.1, 1], weights: [0.6, 0.4] }
  const tint: Field['detail'][number] = { kind: 'tint', noise: NOISE, base: 1, range: 0.3 }
  const texture: Field['detail'][number] = { kind: 'texture', map: 'grass', scale: 4, project: 'top', sharp: 4, vary: 0.5, colour: '#ffffff', strength: 1, blend: 'over' }
  const made = (more: Partial<Field>) => () => land(flat(0.3, more))
  // Every key of the record, every band and every surface may be read.
  expect(shows(flat(0.3))).toEqual(['band:0', 'surface:road', 'surface:moss'])
  expect(made({ detail: [{ ...tint, where: [{ q: 'slope', lo: 0, hi: 1 }, { q: 'band:0', lo: 0, hi: 1 }, { q: 'surface:moss', lo: 1, hi: 0 }], edge: { width: 0.2, ragged: 0.3, scale: 0.5 }, fade: [10, 90] }, texture] })).not.toThrow()
  expect(made({ detail: [{ ...tint, where: [{ q: 'band:1', lo: 0, hi: 1 }] }] })).toThrow('terrain3d detail 0 rule 0 reads band:1, which is none of the land record\'s keys (height, relief, slope, aspect, profile, plan, position, occlusion, form, cliffAbove, cliffBelow, wet, water) nor band:0, surface:road, surface:moss')
  expect(made({ detail: [{ ...tint, kind: 'swirl' } as unknown as Field['detail'][number]] })).toThrow('terrain3d detail 0 is a swirl, which is none of tint, patch, bump, rough, texture')
  expect(made({ detail: [{ ...tint, fade: [90, 10] }] })).toThrow('terrain3d detail 0 fade [90,10] is not [near, far], near below far')
  expect(made({ detail: [{ ...tint, noise: { freqs: [1, 2], weights: [1] } }] })).toThrow('terrain3d detail 0 noise has 2 freqs and 1 weights')
  expect(made({ detail: [{ ...tint, noise: { ...NOISE, offset: [1] } }] })).toThrow('terrain3d detail 0 noise offset and stretch are each [x, z]')
  expect(made({ detail: [{ ...tint, edge: { width: 0, ragged: 0, scale: 1 } }] })).toThrow('terrain3d detail 0 edge width 0 is not above 0 and at most 1')
  expect(made({ detail: [{ ...texture, map: '' }] })).toThrow('terrain3d detail 0 names no map')
  expect(made({ detail: [{ ...texture, project: 'side' } as unknown as Field['detail'][number]] })).toThrow('terrain3d detail 0 project side is none of top, tri')
  expect(made({ detail: [{ ...texture, blend: 'add' } as unknown as Field['detail'][number]] })).toThrow('terrain3d detail 0 blend add is none of over, multiply')
  expect(made({ detail: [{ ...texture, scale: 0 }] })).toThrow('terrain3d detail 0 scale 0 is not above 0')
  expect(made({ bands: [{ colour: '#000', amount: 1, rules: [], edge: { width: 0.1, ragged: 0.2, scale: 0 } }] })).toThrow('terrain3d band 0 edge scale 0 is not above 0')
  expect(made({ surfaces: { road: { colour: '#000', cover: 0, edge: { width: 2, ragged: 0, scale: 1 } } } })).toThrow('terrain3d surface road edge width 2 is not above 0 and at most 1')
})

test('occludes says whether the ground rises above the segment between two points', () => {
  const pit = land(fieldOf([{ id: 'k', op: 'craters', freq: 1, seed: 4, radius: [80, 80], depth: 0.5, rim: 0.2, rimWidth: 0.1, ejecta: 0 }]))
  const cx = (hash(0, 0, 4) / 2 ** 32 - 0.5) * WORLD, cz = (hash(0, 0, 4 ^ 0x5bd1e995) / 2 ** 32 - 0.5) * WORLD
  const inside = [cx, pit.height(cx, cz) + 2, cz], out = [cx + 200, pit.height(cx + 200, cz) + 2, cz]
  expect(pit.occludes(inside, out)).toBe(true)
  expect(pit.occludes([inside[0], 100, inside[2]], [out[0], 100, out[2]])).toBe(false)
})

// ---------------------------------------------------------------- the queries, through w


let files = 0
// A truth of a scene whose `world.terrain3d` names a json file holding `field`, and its `w`.
function truthOf(field: Field) {
  const url = `/terrain3d-test/${++files}.json`
  written(url, JSON.stringify(field))
  const scene: Scene = {
    world: { terrain3d: { field: 'place' }, loader: { assets: { place: { type: 'json', url, preload: true } } } },
    prefabs: { loader: {}, probe: {} },
    actors: [{ is: 'loader' }, { is: 'probe' }],
  }
  let w!: W
  const t = boot(scene, { loader, probe: { before(_me, _dt, got) { w = got } } })
  t.step(1 / 60)
  return { t, w, url }
}

test('two truths of one field hold byte-identical heights, and so does a land made apart from them', () => {
  const field = fieldOf(noisy(0.01), { layers: [layerOf([stroke('raise'), stroke('smooth', { path: [[-4, 0], [9, 3]] })])] })
  const a = truthOf(field), b = truthOf(structuredClone(field))
  const apart = land(structuredClone(field))
  const grid = (h: (x: number, z: number) => number) => {
    const out = new Float64Array(41 * 41)
    for (let j = 0; j <= 40; j++) for (let i = 0; i <= 40; i++) out[j * 41 + i] = h(i * 3.7 - 70, j * 2.9 - 50)
    return new Uint8Array(out.buffer)
  }
  const ha = grid((x, z) => heightAt(a.w, x, z))
  expect(grid((x, z) => heightAt(b.w, x, z))).toEqual(ha)
  expect(grid(apart.height)).toEqual(ha)
  expect(rawAt(a.w, 3, 4)).toBe(apart.raw(3, 4))
  expect(depthAt(a.w, 3, 4)).toBe(0)
})

test('the truth\'s land is made again only when the field\'s content changes', () => {
  const field = fieldOf(noisy(0.01))
  const { t, w, url } = truthOf(field)
  const first = edits(w).land
  // A file written again with the same content keeps the land; a new content makes a new one.
  written(url, JSON.stringify(field))
  t.step(1 / 60)
  expect(edits(w).land).toBe(first)
  const h = heightAt(w, 30, 30)
  written(url, JSON.stringify({ ...field, program: { ...field.program, hscale: 200 } }))
  expect(edits(w).land).not.toBe(first)
  expect(heightAt(w, 30, 30)).not.toBe(h)
  expect(landOf(structuredClone(field))).not.toBe(first)
})

test('a field that cannot be made throws on the first query of it', () => {
  const { w } = truthOf(fieldOf([{ id: 'a', op: 'scale', input: 'nope', by: 1 }]))
  expect(() => heightAt(w, 0, 0)).toThrow('terrain3d node a reads input nope')
})

test('over 20 cm of noise, restsAt moves less than a single sample does', () => {
  // Level ground under 20 cm of grit in cells 0.7 m across, and a body 1.2 m across.
  const { w } = truthOf(fieldOf(noisy(0.002).slice(1, 3), { hscale: 100 }))
  let one = 0, rests = 0
  for (let i = 0; i < 400; i++) {
    const x = 50 + i * 0.05
    one += Math.abs(heightAt(w, x + 0.05, 20) - heightAt(w, x, 20))
    rests += Math.abs(restsAt(w, x + 0.05, 20, 1.2) - restsAt(w, x, 20, 1.2))
  }
  expect(one).toBeGreaterThan(1)
  expect(rests).toBeLessThan(one * 0.6)
})

test('a ray hits the ground within 1 cm, and one that never meets it hits nothing', () => {
  const { w } = truthOf(fieldOf(noisy(0.01)))
  for (const [ox, oz, dx, dz] of [[0, 0, 1, 0.3], [-100, 40, 0.2, -1], [120, -60, -0.7, -0.7]]) {
    const origin = [ox, heightAt(w, ox, oz) + 30, oz]
    const hit = ray(w, origin, [dx, -0.25, dz], 2000)!
    expect(hit).toBeDefined()
    expect(Math.abs(hit[1] - heightAt(w, hit[0], hit[2]))).toBeLessThan(0.01)
    // Every point on the way there is above the ground.
    const len = Math.hypot(hit[0] - origin[0], hit[2] - origin[2])
    for (let s = 0.5; s < len - 0.5; s += 0.5) {
      const t = s / len
      expect(origin[1] + (hit[1] - origin[1]) * t).toBeGreaterThan(heightAt(w, origin[0] + (hit[0] - origin[0]) * t, origin[2] + (hit[2] - origin[2]) * t))
    }
  }
  expect(ray(w, [0, 500, 0], [0, 1, 0], 1000)).toBeUndefined()
})
