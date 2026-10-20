// The browser side. Loads the scene's plugins from `../plugins/<name>/<name>.plugin.ts`, takes
// packets from the one plugin with a mounted `pipe`, and gives each row a `<kind>.client.ts`
// next to the page (setup, tick, remove). No client file, no actor.
// The file exports a function of the plugin's own name and this calls it once, so the renderer,
// the pipe, the actors and the keys belong to this client alone and go when it closes: a page makes
// a new client each time the seat moves to another scene, and that one starts with none of them.
// `wire` holds the last packet's step, ack and rows, the page's folder and scene, and `send`,
// which numbers each message and returns that number, or 0 when the pipe refused it.
// `close` ends the client: every actor's `remove`, then every plugin's `close` in the reverse of
// the order the scene names them, so a plugin is still whole while the ones after it let go of it,
// then the pipe's `close`. A frame after that does nothing.
import type { Arg, Pipe, Row, Scene } from './engine.ts'

export type Wire = { n: number; ack: number; rows: Row[]; send(id: number, action: string, ...args: Arg[]): number; home: string; scene: Scene }
export type Plugins = Record<string, any> & { wire: Wire }
export type Actor = {
  setup(row: Row, plugins: Plugins): void
  tick(row: Row, plugins: Plugins): void | false
  remove(plugins: Plugins): void
}
export type Client = Awaited<ReturnType<typeof client>>

export async function client(scene: Scene, home: string) {
  if (!scene.plugins) throw new Error('scene names no plugins')
  let seq = 0
  const order: any[] = []
  const pipe = (): Pipe => {
    const mounted = order.filter(p => 'pipe' in p && p.pipe)
    if (mounted.length !== 1) throw new Error(`${mounted.length} wire plugins mounted, need 1`)
    return mounted[0].pipe
  }
  const wire: Wire = { n: 0, ack: 0, rows: [], home, scene, send: (id, action, ...args) => { const s = ++seq; return pipe().send({ seq: s, n: wire.n, id, action, args }) ? s : 0 } }
  const plugins: Plugins = { wire }
  for (const name of scene.plugins) {
    const mod = await import(`../plugins/${name}/${name}.plugin.ts`)
    if (!(name in mod)) throw new Error(`${name}.plugin.ts does not export ${name}`)
    const made = mod[name]()
    plugins[name] = made
    order.push(made)
  }
  const actors = new Map<number, Actor>()
  let synced = false
  let closed = false
  const me = {
    plugins,
    get n() { return wire.n },
    get rows() { return wire.rows },
    async frame() {
      if (closed || !order.some(p => 'pipe' in p && p.pipe)) return
      for (const pkt of pipe().take()) {
        synced = true
        wire.n = pkt.n
        wire.ack = pkt.ack
        wire.rows = pkt.rows
        for (const id of pkt.ended) {
          actors.get(id)?.remove(plugins)
          actors.delete(id)
        }
        for (const id of pkt.born) {
          const row = pkt.rows.find(r => r.id === id)
          if (!row) throw new Error(`truth says row ${id} was born but did not send it`)
          const actor: Actor | undefined = await import(/* @vite-ignore */ new URL(`${row.kind}.client.ts?row=${id}`, home).href).catch(() => undefined)
          if (closed) return
          if (!actor) continue
          actor.setup(row, plugins)
          actors.set(id, actor)
        }
      }
      if (!synced) return
      for (const p of order) if ('tick' in p) await p.tick(plugins)
      for (const r of wire.rows) actors.get(r.id)?.tick(r, plugins)
      for (const p of order) if ('afterTick' in p) await p.afterTick(plugins)
    },
    close() {
      if (closed) return
      closed = true
      for (const actor of actors.values()) actor.remove(plugins)
      actors.clear()
      for (const p of [...order].reverse()) if ('close' in p) p.close(plugins)
      for (const p of order) if ('pipe' in p && p.pipe) p.pipe.close()
    },
  }
  return me
}
