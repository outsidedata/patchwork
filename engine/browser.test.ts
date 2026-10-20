// The browser side. A frame takes the packets, then ticks the plugins, then each row's actor with
// that row, then the plugins' afterTick, so an actor always draws the row the frame just took.
// An actor is `<kind>.client.ts` in the page's folder, and `frame()` calls its setup, tick and
// remove.
//
// The first test writes its scene here: two `faller` rows falling at different rates, and the
// faller's actor, written into a folder of its own, which is the page's folder the client loads it
// from. The engine takes packets from whatever pipe a plugin has mounted and does not care how it
// works, so the test's pipe is its own: every step's packet is handed to the scenemanager plugin,
// and every message it sends goes straight into the truth's inbox.
import { afterAll, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as path } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, type Msg, type Scene, type Sim } from './engine.ts'
import { client } from './browser.ts'

const DT = 1 / 60
const scene: Scene = {
  world: {},
  plugins: ['scenemanager', 'render3d'],
  seats: 1,
  prefabs: { engine: { dt: DT }, faller: { y: 300, vy: 0, g: 900 } },
  actors: [{ is: 'faller' }, { is: 'faller', g: 450 }],
}
const sim: Sim = {
  faller: { tick(me, dt) { me.data.vy -= me.data.g * dt; me.data.y += me.data.vy * dt } },
}

// The faller's actor draws a box at its row's y plus 10, and tags the box with the row's id.
const home = mkdtempSync(path(tmpdir(), 'browser-'))
writeFileSync(path(home, 'faller.client.ts'), `
let mesh
export function setup(row, plugins) {
  const { THREE, scene } = plugins.render3d
  mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 1), new THREE.MeshBasicMaterial())
  mesh.userData.row = row.id
  scene.add(mesh)
}
export function tick(row) { mesh.position.set(0, row.data.y + 10, 0) }
export function remove(plugins) { plugins.render3d.scene.remove(mesh) }
`)
afterAll(() => rmSync(home, { recursive: true }))

test('each actor draws the row of the packet taken in the same frame', async () => {
  const truth = boot(scene, sim)
  const me = await client(scene, pathToFileURL(home + '/').href)
  const seat = truth.open()
  me.plugins.scenemanager.mount({ send: (up: { msg: Msg }) => truth.inbox(seat, up.msg), hear() {}, close() {}, store: {} }, 'fall')
  truth.onStep(() => me.plugins.scenemanager.hand(truth.packet(seat)))
  const stage = me.plugins.render3d.scene
  let drawn = 0, off = 0
  for (let f = 0; f < 200; f++) {
    await me.frame()
    for (const r of me.rows.filter(r => r.kind === 'faller')) {
      const mesh = stage.children.find((m: any) => m.userData.row === r.id)
      off = Math.max(off, Math.abs(mesh.position.y - 10 - r.data.y))
      drawn++
    }
    truth.step(DT)
  }
  // The first frame comes before the first step, so it takes no packet; every frame after it
  // draws both fallers.
  expect(drawn).toBe(2 * 199)
  expect(off).toBe(0)
  // The two fall at different rates, so a box drawn from the other's row would be off.
  const [a, b] = me.rows.filter(r => r.kind === 'faller')
  expect(a.data.y).not.toBe(b.data.y)
  me.close()
})
