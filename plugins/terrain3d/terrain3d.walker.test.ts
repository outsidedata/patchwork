// terrain3d's mod for walker, given to walker by one key of a scene each: `world.walker.mods.height`
// and `.depth` are 'terrain3d'. The test writes a manager and one child, `shore`, which `load` boots
// as a game's would: flooded hills, whose lowest hollows hold shallow water. `height` is the raw
// ground, under the water too, and `depth` the water over it; a body walked on walker's `groundOf`
// stands on the land where it is dry and wades on the bed where it is not. Its `probe` hands the test
// the child's `w`.
import { afterAll, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, type Scene, type W } from '#engine/engine.ts'
import { load, mod } from '#addons/scenemanager/scenemanager.addon.ts'
import { scenemanager } from '#plugins/scenemanager/scenemanager.sim.ts'
import { written } from '#plugins/loader/loader.sim.ts'
import { groundOf, stand, type Numbers } from '#plugins/walker/walker.sim.ts'
import { depth, height } from './terrain3d.walker.ts'
import { depthAt, heightAt, rawAt, type Field } from './terrain3d.sim.ts'

const DT = 1 / 60
// raw = hscale·(v − 0.25): where simplex v is under 0.25, about a tenth of the square the test reads, it is
// under water, less than 0.4 m deep.
const field: Field = {
  program: {
    world: 600, hscale: 4, sea: 0.625, flood: true, out: 'hills',
    nodes: [{ id: 'hills', op: 'noise', kind: 'simplex', freq: 6, seed: 5 }],
  },
  analysis: { slopeStep: 1.5, curveStep: 4, positionRadius: 18, occlusionRadius: 30, occlusionSteps: 5, cliffProbe: 12, cliffSlope: 0.5, cliffDrop: 7, flatAngle: 0.03, records: 50000 },
  bands: [{ colour: '#3e5722', amount: 1, rules: [] }],
  grain: { base: 1, range: 0 },
  detail: [],
  surfaces: {},
  layers: [],
}
const url = '/terrain3d-walker-test/shore.json'
written(url, JSON.stringify(field))

const K: Numbers = {
  radius: 0.35, height: 1.7, accel: 14, turnRate: 12, gravity: 20, jumpH: 0.9,
  step: 0.6, maxSlope: 0.7, slopeBand: 0.05, slide: 2, wade: 0.5, span: 0.5, probe: 1.5, seekSpeed: 1.5,
}
const BODY = { pos: [0, 0, 0], yaw: 0, vel: [0, 0, 0], grounded: false, speed: 0, want: [0, 0], face: null, jump: false, side: 0, turned: 0, sliding: false }

const top: Scene = {
  prefabs: { engine: { dt: DT }, scenemanager: { scenes: { shore: { file: 'shore.scene.json', suspend: false } }, dt: DT, entry: 'shore', port: 0 } },
  actors: [{ is: 'scenemanager' }],
  plugins: ['scenemanager'],
  seats: 1,
}
const shore = {
  world: {
    loader: { assets: { land: { type: 'json', url, preload: true } } },
    terrain3d: { field: 'land' },
    walker: { kinds: { body: K }, mods: { height: 'terrain3d', depth: 'terrain3d' } },
  },
  prefabs: { engine: { dt: DT }, scenemanager: { out: {} }, loader: {}, body: BODY, probe: {} },
  actors: [{ is: 'scenemanager' }, { is: 'loader' }, { is: 'probe' }],
  plugins: ['scenemanager'],
}

const dir = mkdtempSync(join(tmpdir(), 'terrain3d-walker-'))
const path = (p: string) => JSON.stringify(new URL(p, import.meta.url).pathname)
writeFileSync(join(dir, 'shore.scene.json'), JSON.stringify(shore))
writeFileSync(join(dir, 'shore.sim.ts'), `
import { scenemanager } from ${path('../scenemanager/scenemanager.sim.ts')}
import { loader } from ${path('../loader/loader.sim.ts')}
import { groundOf, walk } from ${path('../walker/walker.sim.ts')}
import file from './shore.scene.json' with { type: 'json' }
export const sim = {
  scenemanager, loader,
  body: { tick(me, dt, w) { walk(me, w, dt, groundOf(w)) } },
  probe: { before(_me, _dt, w) { globalThis.terrain3dWalker = w } },
}
export const scene = file
`)
afterAll(() => rmSync(dir, { recursive: true }))

async function booted() {
  const child = (await load(boot(structuredClone(top), { scenemanager }), pathToFileURL(dir + '/').href)).get('shore')!
  child.step(DT)
  return { child, w: (globalThis as { terrain3dWalker?: W }).terrain3dWalker! }
}

// A point every 2 m over a square 240 m across; `corners` is the five feet of a body at a point.
const grid = Array.from({ length: 121 * 121 }, (_, k) => [(k % 121) * 2 - 120, Math.floor(k / 121) * 2 - 120])
const corners = (x: number, z: number) => [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([a, b]) => [x + a * 0.5, z + b * 0.5])

test('the scene\'s keys give walker terrain3d\'s height and depth, loaded before the first step', async () => {
  const { child } = await booted()
  expect(mod(child.world, 'walker', 'height')).toBe(height)
  expect(mod(child.world, 'walker', 'depth')).toBe(depth)
})

test('height is the raw ground, the bed under the water too, and depth the water over it', async () => {
  const { w } = await booted()
  let wet = 0, dry = 0
  for (const [x, z] of grid) {
    expect(height(w, x, z)).toBe(rawAt(w, x, z))
    expect(depth(w, x, z)).toBe(depthAt(w, x, z))
    if (depth(w, x, z) > 0) {
      wet++
      expect(height(w, x, z)).toBeLessThan(heightAt(w, x, z))
      expect(height(w, x, z) + depth(w, x, z)).toBeCloseTo(0, 12)
    } else {
      dry++
      expect(height(w, x, z)).toBe(heightAt(w, x, z))
    }
  }
  expect(wet).toBeGreaterThan(50)
  expect(dry).toBeGreaterThan(50)
})

test('a body walked on walker\'s groundOf stands on the land where it is dry, and wades on the bed where it is not', async () => {
  const { child, w } = await booted()
  const ground = groundOf(w)
  const wet = grid.find(([x, z]) => corners(x, z).every(([a, b]) => depthAt(w, a, b) > 0.1))!
  const land = grid.find(([x, z]) => corners(x, z).every(([a, b]) => depthAt(w, a, b) === 0 && rawAt(w, a, b) > 0.5))!
  expect(wet).toBeDefined()
  expect(land).toBeDefined()
  expect(ground.depth!(wet[0], wet[1])).toBe(depthAt(w, wet[0], wet[1]))
  const bodies = [wet, land].map(([x, z]) => w.spawn('body', { pos: [x, rawAt(w, x, z) + 1, z] }))
  for (let i = 0; i < 180; i++) child.step(DT)
  for (const b of bodies) {
    const [x, y, z] = b.data.pos
    expect(b.data.grounded).toBe(true)
    expect(y).toBeCloseTo(stand(K, ground, x, z), 6)
  }
  // In the water, below the surface heightAt stands a seat's feet on; on the land, on it.
  expect(bodies[0].data.pos[1]).toBeLessThan(0)
  expect(bodies[1].data.pos[1]).toBeGreaterThan(0.5)
})
