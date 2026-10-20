// terrain3d's mod for flight3d, given to flight3d by one key of a scene: `world.flight3d.mods.ground`
// is 'terrain3d'. The test writes a manager and one child, `hills`, which `load` boots as a game's
// would, with a plane diving steeply onto the hills; it crashes on terrain3d's height. Its `probe`
// hands the test the child's `w`.
import { afterAll, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, type Scene, type Truth } from '#engine/engine.ts'
import { load, mod } from '#addons/scenemanager/scenemanager.addon.ts'
import { scenemanager } from '#plugins/scenemanager/scenemanager.sim.ts'
import { written } from '#plugins/loader/loader.sim.ts'
import { contact, modelOf, rotate, type Flight, type Plane } from '#plugins/flight3d/flight3d.sim.ts'
import { ground } from './terrain3d.flight3d.ts'
import { heightAt, type Field } from './terrain3d.sim.ts'

const DT = 1 / 60
const field: Field = {
  program: {
    world: 600, hscale: 30, sea: 0.5, flood: false, out: 'hills',
    nodes: [{ id: 'hills', op: 'noise', kind: 'simplex', freq: 12, seed: 3 }],
  },
  analysis: { slopeStep: 1.5, curveStep: 4, positionRadius: 18, occlusionRadius: 30, occlusionSteps: 5, cliffProbe: 12, cliffSlope: 0.5, cliffDrop: 7, flatAngle: 0.03, records: 50000 },
  bands: [{ colour: '#3e5722', amount: 1, rules: [] }],
  grain: { base: 0.84, range: 0.32 },
  detail: [],
  surfaces: {},
  layers: [],
}
// One plane, a light high-winged single on a nosewheel, and the row it starts as.
const flight: Flight = {
  gravity: 9.81,
  air: { density: 1.225, scaleHeight: 8500, calm: 0.5 },
  materials: { engineDensity: 40, wingDensity: 10, structureDrag: 0.00005 },
  overspeed: 1.05,
  sweep: 1,
  planes: {
    monoplane: {
      airframe: {
        structureMass: 880, maxThrust: 2700, propSpeed: 39.6, throttleRate: 0.5, wingArea: 16.2, span: 11, incidence: 0.063,
        clAlpha: 5.2, clPostStall: 1, alphaStall: 0.32, stallBlend: 0.05, cd0: 0.0365, oswald: 0.8, cdFlatPlate: 1.2, brakeCd: 0.06,
        cyBeta: -0.6, clDeltaA: 0.15, clP: -0.45, cm0: 0.0067, cmAlpha: -1, cmQ: -12, cmDeltaE: 1, cnBeta: 0.08, cnR: -0.2, cnDeltaR: 0.06,
        maxAileron: 0.3, maxElevator: 0.35, maxRudder: 0.35, aileronRate: 2, elevatorRate: 2, rudderRate: 2,
        rGyrRoll: 1.5, rGyrPitch: 1.4, rGyrYaw: 1.8, engineTorque: 474, engineInertia: 3, engineSpin: 283,
      },
      gear: {
        wheels: [
          { at: [0, -1.14, -1.7], radius: 0.18, spring: 45000, damper: 3300, roll: 0.02, grip: 0.8, brake: false, steer: 0.17 },
          { at: [-1.27, -1.1, 0.35], radius: 0.22, spring: 58000, damper: 6200, roll: 0.02, grip: 0.8, brake: true, steer: 0 },
          { at: [1.27, -1.1, 0.35], radius: 0.22, spring: 58000, damper: 6200, roll: 0.02, grip: 0.8, brake: true, steer: 0 },
        ],
        brakeGrip: 0.5, sink: 3.5, retract: 0, drag: 0,
        touch: [[-5.5, 0.87, -0.2], [5.5, 0.87, -0.2], [0, -0.965, -2.35], [0, -0.62, 0], [0, -0.35, 5.6]],
      },
      look: { model: 'monoplane', spin: 40, airbrake: -0.52, gear: 0 },
    },
  },
}
const prefab: Plane = {
  type: 'monoplane', pos: [0, 0, 0], rot: [0, 0, 0, 1], vel: [0, 0, 0], spin: [0, 0, 0], aileron: 0, elevator: 0, rudder: 0,
  pitch: 0, roll: 0, yaw: 0, throttle: 0, throttling: 0, airbrake: 0, brake: 0, gear: 1, gearDown: true, press: [], crashed: false,
}

const url = '/terrain3d-flight3d-test/hills.json'
written(url, JSON.stringify(field))

const top: Scene = {
  prefabs: { engine: { dt: DT }, scenemanager: { scenes: { hills: { file: 'hills.scene.json', suspend: false } }, dt: DT, entry: 'hills', port: 0 } },
  actors: [{ is: 'scenemanager' }],
  plugins: ['scenemanager'],
  seats: 1,
}
const hills = {
  world: {
    loader: { assets: { land: { type: 'json', url, preload: true } } },
    terrain3d: { field: 'land' },
    flight3d: { ...flight, mods: { ground: 'terrain3d' } },
  },
  prefabs: { engine: { dt: DT }, scenemanager: { out: {} }, loader: {}, flight3d: prefab, probe: {} },
  actors: [
    { is: 'scenemanager' }, { is: 'loader' },
    // Nose 60° down, flying 80 m/s along it, from 200 m.
    { is: 'flight3d', pos: [10, 200, -30], rot: [-Math.sin(Math.PI / 6), 0, 0, Math.cos(Math.PI / 6)], vel: [0, -80 * Math.sin(Math.PI / 3), -80 * Math.cos(Math.PI / 3)], throttle: 1 },
    { is: 'probe' },
  ],
  plugins: ['scenemanager'],
}

const dir = mkdtempSync(join(tmpdir(), 'terrain3d-flight3d-'))
const path = (p: string) => JSON.stringify(new URL(p, import.meta.url).pathname)
writeFileSync(join(dir, 'hills.scene.json'), JSON.stringify(hills))
writeFileSync(join(dir, 'hills.sim.ts'), `
import { scenemanager } from ${path('../scenemanager/scenemanager.sim.ts')}
import { loader } from ${path('../loader/loader.sim.ts')}
import { flight3d } from ${path('../flight3d/flight3d.sim.ts')}
import file from './hills.scene.json' with { type: 'json' }
export const sim = {
  scenemanager, loader, flight3d,
  probe: { after(_me, _dt, w) { globalThis.hills = w } },
}
export const scene = file
`)
afterAll(() => rmSync(dir, { recursive: true }))

const run = (t: Truth, k: number) => { for (let i = 0; i < k; i++) t.step(DT) }
const child = async () => (await load(boot(structuredClone(top), { scenemanager }), pathToFileURL(dir + '/').href)).get('hills')!

test('the scene\'s one key gives flight3d terrain3d\'s ground, loaded before the first step', async () => {
  expect(mod((await child()).world, 'flight3d', 'ground')).toBe(ground)
})

test('a plane dived onto the hills crashes on terrain3d\'s height and stays there', async () => {
  const hills = await child()
  run(hills, 300)
  const w = (globalThis as any).hills
  const p = hills.rows.find(r => r.kind === 'flight3d')!.data
  expect(p.crashed).toBe(true)
  // It lies where it first went into terrain3d's ground: a wheel pressed into heightAt there, a touch
  // point under it, or its centre on it.
  const height = (x: number, z: number) => heightAt(w, x, z)
  const gear = modelOf(w.world.flight3d, p.type).gear
  const into = Math.min(
    p.pos[1] - height(p.pos[0], p.pos[2]),
    ...gear.touch.map(t => { const at = rotate(p.rot, t).map((c, i) => c + p.pos[i]); return at[1] - height(at[0], at[2]) }),
    ...contact(p, gear, height).press.map(c => -c),
  )
  expect(into).toBeLessThanOrEqual(1e-9)
  expect(p.pos[1]).toBeGreaterThanOrEqual(height(p.pos[0], p.pos[2]) - 1e-9)
  expect(ground(w, p.pos[0], p.pos[2])).toBe(heightAt(w, p.pos[0], p.pos[2]))
  const where = [...p.pos]
  run(hills, 60)
  expect(hills.rows.find(r => r.kind === 'flight3d')!.data.pos).toEqual(where)
})
