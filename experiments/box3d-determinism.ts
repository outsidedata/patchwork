// Experiment: is Box3D (box3d.js inline) byte-identical run to run in one process, and how far does a
// world rebuilt from its bodies' motion every step (no warm starts, no contact memory) drift from one
// that keeps its memory? The first is what the truth's replay leans on; the second is what a page that
// rebuilds a world from a packet's rows would see.
import Box3D from 'box3d.js/inline'
const b3 = await Box3D()
type M = { pos: number[]; rot: number[]; vel: number[]; spin: number[] }
const DT = 1 / 60
function world() {
  const d = b3.b3DefaultWorldDef(); d.gravity = [0, -10, 0]
  const w = b3.b3CreateWorld(d)
  const g = b3.b3CreateBody(w, { ...b3.b3DefaultBodyDef(), position: [0, -1, 0] })
  b3.b3CreateBoxShape(g, b3.b3DefaultShapeDef(), 20, 1, 20)
  return w
}
function body(w: any, m: M) {
  const bd = b3.b3DefaultBodyDef()
  bd.type = b3.b3BodyType.b3_dynamicBody; bd.position = m.pos as any; bd.rotation = m.rot as any
  bd.linearVelocity = m.vel as any; bd.angularVelocity = m.spin as any
  const id = b3.b3CreateBody(w, bd)
  b3.b3CreateBoxShape(id, b3.b3DefaultShapeDef(), 0.5, 0.5, 0.5)
  return id
}
const read = (id: any): M => ({ pos: b3.b3Body_GetPosition([0, 0, 0], id), rot: b3.b3Body_GetRotation([0, 0, 0, 1], id), vel: b3.b3Body_GetLinearVelocity([0, 0, 0], id), spin: b3.b3Body_GetAngularVelocity([0, 0, 0], id) })
// A pyramid of 10 crates, one pushed.
const start = (): M[] => { const s: M[] = []; for (let r = 0; r < 4; r++) for (let i = 0; i < 4 - r; i++) s.push({ pos: [i - (3 - r) / 2 + 0.01 * r, 0.5 + r, 0], rot: [0, 0, 0, 1], vel: [0, 0, 0], spin: [0, 0, 0] }); s[0].vel = [3, 0, 1]; return s }
function kept(n: number) { const w = world(); const ids = start().map(m => body(w, m)); for (let i = 0; i < n; i++) b3.b3World_Step(w, DT, 4); const out = ids.map(read); b3.b3DestroyWorld(w); return out }
function rebuilt(n: number) { let s = start(); for (let i = 0; i < n; i++) { const w = world(); const ids = s.map(m => body(w, m)); b3.b3World_Step(w, DT, 4); s = ids.map(read); b3.b3DestroyWorld(w) } return s }
const bytes = (s: M[]) => JSON.stringify(s)
const err = (a: M[], b: M[]) => Math.max(...a.map((m, i) => Math.hypot(...m.pos.map((c, k) => c - b[i].pos[k]))))
const a = kept(180), b = kept(180)
console.log('kept twice, same bytes:', bytes(a) === bytes(b))
const r1 = rebuilt(180), r2 = rebuilt(180)
console.log('rebuilt twice, same bytes:', bytes(r1) === bytes(r2))
for (const n of [1, 5, 30, 180]) console.log(`after ${n} steps, rebuilt vs kept, max metres apart:`, err(kept(n), rebuilt(n)).toExponential(2))
