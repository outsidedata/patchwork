// The browser half of box3dvehicle on a page of a scene of the test's own, booted, loaded and viewed
// over a loopback as a game's page is: its dust, thrown from the land a mod hands it. The car's rows
// are written by the test, a chassis and four wheels with no rule to move them, and the car's row
// naming them, as box3dvehicle's server half names its parts; each wheel stands where the test puts
// it and goes as fast as the test says. The land is `field`'s, a game's own plugin of the test's,
// shipped beside the scene with its land for box3dvehicle (`field.box3dvehicle.ts`): `at` metres high
// at the origin, rising `slope` [x, z] a metre, so it is nowhere the rows' own height.
import { afterAll, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, type Row, type Scene } from '#engine/engine.ts'
import { accept, link, load, manager, view } from '#addons/scenemanager/scenemanager.addon.ts'
import { loopback } from '#addons/loopback/loopback.addon.ts'
import { written } from '#plugins/loader/loader.sim.ts'
import { scenemanager } from '#plugins/scenemanager/scenemanager.sim.ts'
import type { Effect } from '#plugins/particle3d/particle3d.plugin.ts'
import { corners, type Axle, type Vehicle } from './box3dvehicle.sim.ts'

const DT = 1 / 60
;(globalThis as any).addEventListener = () => {}
;(globalThis as any).removeEventListener = () => {}
let clock = 0
vi.spyOn(performance, 'now').mockImplementation(() => clock)

const EFFECTS_URL = '/box3dvehicle-plugin-test/effects.json'
written(EFFECTS_URL, JSON.stringify({ cap: 50, effects: { dust: [{ every: 0.05, life: [0.2, 0.2] }] } }))

const axle = (at: number, steered: boolean): Axle => ({
  at, track: 1.7, mount: 0.2,
  wheel: { radius: 0.36, width: 0.28, mass: 20, friction: 0.9, rollingResistance: 0 },
  spring: { stiffness: 16000, length: 0.55, travel: 0.3, sag: 0.1 },
  damper: { bump: 800, rebound: 1600 },
  bumpStop: { length: 0.06, stiffness: 30000 },
  antiRoll: 8000, driven: true, steered,
})
// Dust thrown from a wheel within 0.1 m of the land going faster than 1.5 m/s across it.
const vehicle: Vehicle = {
  body: { length: 3.6, width: 1.3, height: 0.5, mass: 600, center: [0.1, -0.1, 0], friction: 0.9, cabin: { at: -0.2, length: 1.9, width: 1.2, top: 1.2, topWidth: 1, height: 0.5 } },
  bodies: {},
  axles: [axle(1.25, true), axle(-1.25, false)],
  engine: { spinSpeed: 30, spinTorque: 300, brakeTorque: 600, coastTorque: 0 },
  steering: { angle: 0.5, hertz: 5, dampingRatio: 1, maxTorque: 1e4 },
  look: {
    paint: { body: 0, cabin: 0, trim: 0, glass: 0, light: 0, tail: 0, tyre: 0, rim: 0, spring: 0, damper: 0, arm: 0 },
    segments: 16, spokes: 5, rim: 0.6, coils: 6, coilRadius: 0.07, wire: 0.01, arm: 0.03,
    dust: { effect: 'dust', clear: 0.1, speed: 1.5 },
  },
}
const R = 0.36

const FIELD = { at: 0.4, slope: [0.2, -0.1] }
const fieldHeight = (x: number, z: number) => FIELD.at + FIELD.slope[0] * x + FIELD.slope[1] * z

const still = { pos: [0, 1, 0], rot: [0, 0, 0, 1], vel: [0, 0, 0] }
// A car's rows in a scene that lists `plugins` and ships what `shipped` lists, its land `land`.
const yardOf = (plugins: string[], shipped: string[], land?: string): Scene => ({
  world: {
    loader: { assets: { effects: { type: 'json', url: EFFECTS_URL, preload: true } } },
    particle3d: { effects: 'effects' },
    shipped: { plugins: shipped },
    field: FIELD,
    box3dvehicle: { chassis: 'body', wheel: 'tyre', joint: 'axle', vehicles: { car: vehicle }, ...(land && { mods: { land } }) },
  },
  prefabs: {
    engine: { dt: DT, width: 320, height: 200 }, scenemanager: { out: {} }, loader: {},
    render3d: { camera: { fov: 60, near: 0.1, far: 500, at: [0, 6, 12], look: [0, 0, 0] } },
    body: still, tyre: still, box3dvehicle: {},
  },
  actors: [{ is: 'scenemanager' }, { is: 'loader' }, { is: 'body' }, ...[0, 1, 2, 3].map(() => ({ is: 'tyre' })), { is: 'box3dvehicle', vehicle: 'car' }],
  plugins,
  seats: 1,
})
const scenes: Record<string, Scene> = {
  // The field's land, field shipped before box3dvehicle.
  dusty: yardOf(['scenemanager', 'loader', 'shipped', 'box3dvehicle', 'particle3d', 'render3d'], ['field'], 'field'),
  // No land named.
  bare: yardOf(['scenemanager', 'loader', 'shipped', 'box3dvehicle', 'particle3d', 'render3d'], ['field']),
  // The field's land, field shipped after box3dvehicle.
  late: yardOf(['scenemanager', 'loader', 'box3dvehicle', 'shipped', 'particle3d', 'render3d'], ['field'], 'field'),
  // terrain3d's land, and no terrain3d listed.
  unlisted: yardOf(['scenemanager', 'loader', 'box3dvehicle', 'particle3d', 'render3d'], [], 'terrain3d'),
}
const dir = mkdtempSync(join(tmpdir(), 'box3dvehicle-plugin-'))
afterAll(() => rmSync(dir, { recursive: true }))
const from = (p: string) => JSON.stringify(new URL(p, import.meta.url).pathname)
for (const [name, s] of Object.entries(scenes)) {
  writeFileSync(join(dir, `${name}.scene.json`), JSON.stringify(s))
  writeFileSync(join(dir, `${name}.sim.ts`), `
import { scenemanager } from ${from('../scenemanager/scenemanager.sim.ts')}
import { loader } from ${from('../loader/loader.sim.ts')}
import file from './${name}.scene.json' with { type: 'json' }
export const sim = { scenemanager, loader, body: {}, tyre: {}, box3dvehicle: {} }
export const scene = file
`)
}
mkdirSync(join(dir, 'plugins', 'field'), { recursive: true })
writeFileSync(join(dir, 'plugins', 'field', 'field.plugin.ts'), 'export function field() { return {} }\n')
writeFileSync(join(dir, 'plugins', 'field', 'field.box3dvehicle.ts'), `
export const land = (plugins: any) => {
  const { at, slope } = plugins.wire.scene.world.field
  return { height: (x: number, z: number) => at + slope[0] * x + slope[1] * z }
}
`)
const home = pathToFileURL(dir + '/').href

// A page on the scene `entry`, its car's row naming its parts, and its frames, not yet stepped.
async function open(entry: string) {
  const top: Scene = {
    world: {},
    plugins: ['scenemanager'],
    seats: 1,
    prefabs: { engine: { dt: DT }, scenemanager: { scenes: { [entry]: { file: `${entry}.scene.json`, suspend: false } }, dt: DT, entry, port: 0 } },
    actors: [{ is: 'scenemanager' }],
  }
  const truth = boot(structuredClone(top), { scenemanager })
  const yard = (await load(truth, home)).get(entry)!
  const surface = (s: Scene) => ({ addEventListener: () => {}, style: {} as any, width: s.prefabs.engine.width, height: s.prefabs.engine.height, remove() {} })
  const page = view(link(loopback(accept(manager(truth)))), top, home, (me, s) => { me.plugins.render3d.canvas = surface(s) })
  const frames = async (k: number) => {
    for (let i = 0; i < k; i++) { truth.step(DT); clock += DT * 1000; await page.frame() }
  }
  const wheels = yard.rows.filter(r => r.kind === 'tyre').sort((a, b) => a.id - b.id)
  Object.assign(yard.rows.find(r => r.kind === 'box3dvehicle')!.data, { chassis: yard.rows.find(r => r.kind === 'body')!.id, wheels: wheels.map(r => r.id) })
  return { page, frames, wheels }
}

// Each wheel under its corner, `lift` metres above the field's land, going `vel`.
function stand(wheels: Row[], vel: number[], lift = 0) {
  corners(vehicle).forEach((c, i) => {
    const x = c.mount[0], z = (c.side * c.axle.track) / 2
    Object.assign(wheels[i].data, { pos: [x, fieldHeight(x, z) + R + lift, z], vel })
  })
}
const dusts = (page: { client?: any }): Effect[] => page.client!.plugins.particle3d.effects.filter((fx: Effect) => fx.name === 'dust')

test('with a land mod named, a wheel on the land going faster than `speed` throws dust at the land under it, back from its way and up by half as much, until it slows or leaves the land', async () => {
  const { page, frames, wheels } = await open('dusty')
  // Each wheel 0.05 m off the land, within `clear`.
  stand(wheels, [3, 0, -4], 0.05)
  await frames(3)
  const thrown = dusts(page)
  expect(thrown).toHaveLength(4)
  corners(vehicle).forEach((c, i) => {
    const x = c.mount[0], z = (c.side * c.axle.track) / 2
    // The field's height there, not the wheel's bottom: the land the mod hands.
    expect(thrown[i].at[1]).toBeCloseTo(fieldHeight(x, z), 9)
    expect(thrown[i].at[0]).toBeCloseTo(x, 9)
    expect(thrown[i].at[2]).toBeCloseTo(z, 9)
    expect(thrown[i].dir).toEqual([-3 / 5, 0.5, 4 / 5])
    expect(thrown[i].life).toBe(Infinity)
  })
  // The first wheel lifted 0.2 m off the land, more than `clear`, and the rest slowed under `speed`.
  stand(wheels, [1, 0, 0])
  wheels[0].data.pos[1] += 0.2
  wheels[0].data.vel = [3, 0, -4]
  await frames(2)
  // Each stopped: its life cut to the age it had then, which particle3d has aged past since.
  for (const fx of thrown) {
    expect(fx.life).not.toBe(Infinity)
    expect(fx.life).toBeLessThanOrEqual(fx.age)
  }
  expect(dusts(page).filter(fx => fx.life === Infinity)).toHaveLength(0)
})

test('with no land mod named, no wheel throws dust, as on no ground', async () => {
  const { page, frames, wheels } = await open('bare')
  stand(wheels, [3, 0, -4])
  await frames(3)
  expect(dusts(page)).toHaveLength(0)
})

test('a scene with dust whose land is a plugin listed after box3dvehicle, or one it does not list, throws on the first frame', async () => {
  await expect((await open('late')).frames(3)).rejects.toThrow('box3dvehicle is listed before field, whose land it reads that frame')
  await expect((await open('unlisted')).frames(3)).rejects.toThrow('box3dvehicle\'s land is terrain3d\'s, which this scene does not list')
})
