// The WebSocket wire: a page and the server's side of its seat in two processes. It carries
// whatever the two ends say to each other as JSON, `U` up and `D` down, and knows nothing about
// what they are.
//
// `serve(port, accept)` runs on node: each connection is handed to `accept`, the server's side of
// one seat (`Accept` in the loopback addon), and a connection `accept` throws on is closed with
// 1013 and the error. It hands back the port it listens on, which is a free one the machine chose
// when `port` is 0. `upgrades(accept)` is the same on an HTTP server someone else holds: it listens
// on no port, and its `upgrade` is handed each request to upgrade that the server's holder has
// found is for it. `dial(url, gone)` runs in the page: a wire, which `link` in the scenemanager addon
// is handed. A send before the socket is open waits for it. `gone` is called once the socket closes
// but by the wire's own `close`: the server went away, or was never there.
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WebSocket as Socket, WebSocketServer as Server } from 'ws'
import type { Accept, Wire } from '#addons/loopback/loopback.addon.ts'

// Each connection `wss` makes, handed to `accept`.
function seats<U, D>(wss: Server, accept: Accept<U, D>) {
  wss.on('connection', (ws: Socket) => {
    let seat: ReturnType<Accept<U, D>>
    try { seat = accept(down => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(down)) }) }
    catch (e) { ws.close(1013, String(e)); return }
    ws.on('message', bytes => seat.take(JSON.parse(bytes.toString())))
    ws.on('close', () => seat.close())
  })
  return () => new Promise<void>(r => { for (const c of wss.clients) c.terminate(); wss.close(() => r()) })
}

export async function serve<U, D>(port: number, accept: Accept<U, D>) {
  const { WebSocketServer } = await import('ws')
  const wss = new WebSocketServer({ port })
  const close = seats(wss, accept)
  await new Promise<void>(r => wss.on('listening', () => r()))
  return { port: (wss.address() as { port: number }).port, close }
}

export async function upgrades<U, D>(accept: Accept<U, D>) {
  const { WebSocketServer } = await import('ws')
  const wss = new WebSocketServer({ noServer: true })
  const close = seats(wss, accept)
  return {
    upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req)),
    close,
  }
}

export function dial<U, D>(url: string, gone?: () => void): Wire<U, D> {
  return fan => {
    const ws = new WebSocket(url)
    const queued: string[] = []
    let closing = false, told = false
    ws.onmessage = e => fan(JSON.parse(String(e.data)))
    ws.onopen = () => { for (const s of queued.splice(0)) ws.send(s) }
    // A browser says `close` after an `error`; Node says only `error` of a socket nobody answered.
    // Either is the server gone, said once.
    const lost = () => {
      if (closing || told) return
      told = true
      gone?.()
    }
    ws.onerror = lost
    ws.onclose = lost
    return {
      send: up => { const s = JSON.stringify(up); ws.readyState === ws.OPEN ? ws.send(s) : queued.push(s) },
      close: () => {
        closing = true
        ws.close()
      },
    }
  }
}
