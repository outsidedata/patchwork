---
name: going-multiplayer
description: Use in core, or any clone of it, when a game is played by more than one person over a network - running `<game>.server.ts` on node and opening `client.html`, the port, raising a scene's `seats` for a second player, what a player who finds the game full gets, sending each seat only what it needs (`interest`, `vision` and its fog of war, a `security` block), what a seat may send and what is dropped, prediction against lag, jitter and packet loss, trying a bad network before shipping (the loopback's network shape, the simulator, `?tap=`), chat and parties, and a new way to travel such as WebRTC as a transport addon. Also when someone says multiplayer, online, netcode, server and client, two players, a second seat, play with friends, latency, rubber-banding, "the second tab is blank", or fog of war.
---

# Going multiplayer

A game in core is played by more than one person when its manager runs on node behind a socket and
each person opens `client.html`. Every game `yarn new-game` writes already has both files (the list
is the header of `extensions/games/games.route.ts`), so nothing new carries a packet. The work is the
scene's seats, what each seat is sent, what each seat may send, and proving the game plays on a bad
network. The engine is frozen: nothing here edits `engine/`. A line that would tell a game to add a
guard, keep a layout, or never hand an addon a copy, so that the wire or a piece does not break,
means core is missing a piece: it is built in its home, with its test, and the line is never
written, here or in a game.

## When it applies

It applies to a game played over a network: running its server, opening its seats, the port, how many
seats a scene takes, what each seat is sent, what a seat may send as it reaches the server, prediction
against the network, trying a bad network, chat and parties, and a new transport.

It does not cover:

- making the game and its files in the first place: `starting-a-game`.
- accounts, logging in, and keeping a player's things between visits: `persisting-players`.
- putting the game where players on other machines reach it, and serving its pages: `shipping-a-game`.
- binding keys or a pad, the `player` row, where a seat starts and what it plays there:
  `input-and-seats`.
- a kind's own rules and acts: `designing-a-kind`. A plugin: `building-a-plugin`.

## The wire, as a game meets it

The wire is part of the base, which is finished (prime directive, The wire). Three pieces stand
between the engine and a game, and each does one thing:

- `scenemanager` (`addons/scenemanager/scenemanager.addon.ts`) gives a connection its seat.
  `accept(manager(truth))` is the server's side of every seat, handed to a transport; `link(wire)` is
  the page's side of one; `view` holds one client, for the scene the seat is on. It carries envelopes
  and never says how they travel. Each manager step it sends every connection a `Diff`, the rows
  changed since the newest envelope that page said it got, and the page's `link` rebuilds the whole
  packet before anything hears it. `backlog` on the manager's `scenemanager` prefab is how many
  envelopes back a diff may reach, 32 when it gives none.
- A transport carries whatever its two ends say and knows nothing of scenes or seats: `loopback`
  (`addons/loopback/loopback.addon.ts`), the page and the manager in one process, with a network of
  any shape when it is given one; `socket` (`addons/socket/socket.addon.ts`), a WebSocket between two
  processes.
- A page names its transport in one line, and every line of a page is the same in every game but the
  file names it imports: `index.html` a `loopback`, `client.html` a `dial`, `<game>.server.ts` a
  `serve`.

Nothing else carries a packet. A test or a tool that needs a page and a truth joined takes a
transport, `link(dial(url))` against a `serve` or `link(loopback(accept(row)))`, and never joins them
itself. The last test of `addons/socket/socket.addon.test.ts` fails any file in the repo, a game's
tests included, that opens a WebSocket or imports `ws`, other than the socket addon itself.

## What runs where

- `<game>.server.ts`, on node: boots the manager scene, `load`s every scene its table names (each a
  truth of its own, its loader files read from disk), `serve`s `accept` on the manager's `port`, and
  `run`s the manager, stepping it by its `engine.dt` as often as the real clock owes a step. Each
  manager step steps every scene whose entry says `suspend: false` and every scene a seat is in. It
  prints nothing while it runs.
- `client.html`, in the browser: `dial`s `ws://<the host the page came from>:<port>`, makes the `view`
  on it, and calls `frame()` on every `requestAnimationFrame`. It steps nothing. For the scene its
  seat is on it loads the browser half of each plugin the scene lists and each row's
  `<kind>.client.ts`, and the player plugin runs the seat's own presses ahead with the same
  `<kind>.sim.ts` files the server runs. `tap` wraps the dial: with `?tap=<name>` in the address it
  records the page, and without it the page is the view, untouched.
- `index.html`: the manager and the page in one tab, over a loopback. It is one seat on a truth of its
  own. A second tab of it is a second game, not a second player.

## The work

1. **Seats.** A scene that lists the `player` plugin takes as many seats as its scene file's `seats`
   says. `addons/player` gives each connection the lowest slot below `seats` that no seat holds,
   spawns its `player` row with that slot in `seat`, and the seat possesses that row. The game
   `yarn new-game` writes has `"seats": 1` and one `start` actor. For two players, the scene file,
   `games/<game>/<scene>.scene.json`, gets `"seats": 2` and a second `start` actor,
   `{ "is": "start", "slot": 1, "pos": [x, y] }`: one `actors` entry per slot, never a list of places
   on `world` (prime directive, question 1). The manager scene's own `seats` stays as it is, and
   nothing reads it: no connection is seated on the manager, and each child's own `seats` is the one
   that counts.

   A connection that finds every slot of the entry scene taken is closed by the socket with code 1013,
   and `dial` calls its `gone`. `client.html` hands `dial` no `gone`, so today that player's page
   draws nothing at all. That is what core does now, not how it must stay. A game that must tell a
   refused player it is full builds that in core: the page `make` writes (`client.html` in
   `extensions/games/games.route.ts`), with every game's `client.html` moved over to it, since every
   line of a page is the same in every game. Never a `gone` listener written into one game's page.

   On a loopback nothing is refused: `loopback` calls `accept` with nothing around it. So a page past
   the seats throws `no seat free: <n> declared` out of `link` in a page that holds the manager, and
   out of a simulation, which therefore runs no more pages than the entry scene has seats. A seat that
   a scene sends with `go` to a full scene stays where it is, and the scene may send it again. A scene
   that does not list `player`, such as a menu, takes a plain seat with no limit, so a game whose
   entry scene is a menu refuses nobody at the door.

   When a connection closes, `addons/player` ends its `player` row and frees its slot. What that row
   spawned ends itself when no `player` row names it, as the new game's `body.sim.ts` does. A page
   that comes back is a new seat with a higher seat number, and it may get the same slot, so a rule
   about who is who reads the slot off the `player` row, never the seat number.

2. **Run the server.** From the repo root:
   `node --experimental-strip-types games/<game>/<game>.server.ts`. It must be the root because on
   node the loader reads a catalogue url such as `/games/<game>/assets/<game>.json` as a path under
   the working directory (`plugins/loader/loader.sim.ts`). Or from the editor, `yarn editor <game>`:
   the Node panel's Run on node starts the same file in a child process from the root, shows what it
   prints and when it exits, and starts it again whenever a file it runs changes. Open a seat opens
   `client.html` in a new tab (`extensions/servers/servers.extension.tsx`; its commands are
   `servers.start`, `servers.seat`, `servers.state` and `servers.stop`). One server per port: a second
   one, started by hand beside the panel's or left over from earlier, dies with `EADDRINUSE`.

   The port is the manager's `scenemanager.port`. `yarn new-game` gives each game the port after the
   highest one the games in `games/` use, or 9001 when there are none, so no two games share a port.
   `serve` listens on every interface of the machine.

3. **Open the seats.** With `yarn editor <game>` running, open
   `http://localhost:5173/games/<game>/client.html` once per player, each in a window of its own.
   Chrome pauses `requestAnimationFrame` in a tab that is not in front, so of two tabs in one window
   only the front one plays, while the server keeps stepping. The editor's server answers only on
   `localhost`, so this puts every player on one machine. Players on other machines are
   `shipping-a-game`'s.

4. **Decide what each seat is sent.** A seat's packet holds the rows that every piece attached to the
   truth shows that seat, each without the fields a piece hides (`Piece` in `engine/engine.ts`). By
   default each seat is sent every row except the other seats' `player` rows, and never a child
   `scenemanager` row's `out`. Every row a seat is sent is copied to it every step, which is why a
   fixed number never rides on a row (prime directive, question 1). Three pieces send less. Each one
   limits what is sent, never what the rules know, and each is an addon (question 5):

   - Fields, by owner. A top-level `security` block in the scene file names, for each kind, the group
     of each field it lists, and the `player` prefab gets a `masks` list. A listed field of an owned
     row is sent only to seats whose masks share the owner's group (`me/<id>` is a group of one). The
     whole of it is the header of `addons/player/player.addon.ts`. An actor that reads such a field
     tests for it with `in`.
   - Team vision, the fog of war. The scene's `world.vision` (`cell`, `size`, `at`, `slot`, `teams`,
     `sight`, `always`) is read by `addons/vision`. `addons/player` attaches it by itself to a scene
     whose `world` has the block, the first time a seat joins. A row belongs to the team of the slot
     it holds in the field `slot` names, and a kind listed in `sight` sees that many cells. A row with
     no such field belongs to no team and is sent only to a team that sees its cell.

     On the game `yarn new-game` writes, the body has no slot field, so it belongs to no team. No seat
     is sent any body, not even its own, and the page's predicted `move` throws `no row <id>` at the
     body's `w.get`. So: give the `body` prefab a slot field, `"slot": 0`. In `player.sim.ts`, spawn
     the body with `slot: me.data.seat` beside its `pos`. In the block, `slot` names that field, `at`
     is `"pos"`, and `sight` is `{ "body": <cells> }`. Listing `body` in `always` instead puts it
     outside the fog.

     The page draws the fog with the `vision` plugin, listed in the scene's `plugins` before
     `render2d`. Its own `layer`, `unexplored` and `explored` sit in the same block. It draws on
     render2d's world, so the scene gives `world.render2d` with `ground`, `up`, `zoom`, `look` and
     `layers`, that layer among them. `place` reads `up`, so it is given even where nothing stands
     above the ground. For the new game, whose things stand in canvas pixels, the block is
     `"ground": [[1, 0], [0, 1]]`, `"up": [0, -1]`, `"zoom": 1` and `"look"` the canvas middle, so a
     world unit is a canvas pixel and the fog's cells sit where the bodies stand. The world lies under
     anything put straight on the stage, as `body.client.ts` puts its square. A thing the fog should
     cover is drawn on a layer of the world, at `place(pos)`. From then the body's `pos`, `speed` and
     `size` are in the world's units, one a canvas pixel under this ground but units all the same: its
     look draws its size scaled by `render2d.ground()`, and the headers `yarn new-game` wrote, which
     say pixels, say units (`writing-the-look`, render2d or render3d).

     A rule that must act only on what a team sees asks `sees(w.world, slot, row)`. The editor's
     Vision panel shows, for each slot, which rows are sent and which are not
     (`addons/vision/vision.extension.tsx`).
   - Area of interest. A top-level `interest` block, `{ "radius": r, "always": [kinds], "at": field }`,
     is read by `interest(truth, possessed)` (`addons/interest/interest.addon.ts`). A row with a `pos`
     farther than `radius` from the seat's centre, measured on x and y, is not sent. A row that walks
     out of range is in that seat's next `ended`, and one that walks back in is in its `born`. `at`
     names the field of the possessed `player` row that holds the centre row's id: `"body"` in the
     new game. Nothing in core attaches it today, so the block alone sends every seat every row.
     `interest` needs the truth and which row each seat possesses, and that lookup is held inside
     `addons/player`, which attaches vision the same way. A game that wants interest therefore builds
     that attach in its home: `addons/player`, beside its `vision` line, from the scene's `interest`
     block, tested in `addons/player/player.addon.test.ts`. Then `index.html`, `<game>.server.ts`,
     the simulator and every test that seats a player all get it, since each one seats through
     `join`. It never goes in `<game>.server.ts`. A page names no scene and holds no rule, and
     `index.html` and a simulation never run that file, so they would still send every row. The same
     change rewrites three docs so they say what the code does:
     - the header of `addons/player/player.addon.ts`, which names only vision among the pieces it
       attaches;
     - the header of `addons/interest/interest.addon.ts`, whose lookup paragraph says the caller
       hands `interest` the lookup. It names `addons/player` as the attacher instead, as
       `addons/vision/vision.addon.ts`'s header does;
     - this skill's lines that say nothing attaches it.

   Under vision and interest, a row with no place (a manager, a loader, a `player` row) and a kind
   listed in `always` go to every seat. `always` is for what every seat sees wherever it stands, the
   map's pieces: a kind listed there is outside the fog and outside the radius. The `start` rows have
   a `pos`, so a seat far from them is not sent them, which nothing in the new game minds.

   What the page runs ahead must be on the page. The player plugin takes the seat to be sent every
   row a step reads (`plugins/player/player.plugin.ts`). A predicted rule that reads a row the seat
   was not sent throws `no row <id>` on the page, as the new game's `move` does when its body is not
   sent. Under interest a seat's centre row is always within its own radius. Under vision a seat is
   sent its own team's rows wherever they stand, so each row its rules read carries its slot.

5. **Hold what a seat may send.** A page's message names a row, an act and its args. The engine runs
   it only when the row is the one the seat possesses, its `player` row, or the row's kind lists the
   act in `open`. A well-formed message that names a row not there, an act the kind does not have, or
   an act the seat may not send is refused: it runs nothing and gets no answer, but its number is
   still acked. A message sent on a visit that is over, sent before the page heard its seat had moved,
   is dropped by `connection`. That holds only for a message of the right shape, which step 6 makes
   the wire enforce.

   A kind reached through the `player` row lists no `open`; `w.call` runs its acts without the check,
   because the `player` act that called it already passed one. `scenemanager`'s `go` is open, so any
   seat may send itself to any scene the manager's table names, and the args it sends reach the next
   scene's `player` row as `arrive`. A connection behind `accounts` is seated on the entry scene and
   sent its packets from the first step, but what it sends, other than its log-in, is dropped until it
   logs in (`persisting-players`). What a player chose on the page, such as a volume or rebound keys,
   is a key of the store, which the server is never sent.

   Every arg arrives from outside the program, whatever the act's types say. Each act checks each arg:
   its type, that a number is finite, its range. The new game's `body.sim.ts` does this in its `move`.

6. **Make the server drop what it cannot read, before it faces other players.** Today one connection
   can stop the server with one message. Each of these was measured against a served manager:
   - text that is not JSON throws out of the socket addon's `JSON.parse`;
   - the JSON `5` or `null` throws out of the scenemanager's `accept` (`'got' in up`);
   - a `msg` of `null` throws out of the next step (`m.n`);
   - `args: 5` throws out of the step, which spreads them;
   - `action: 'valueOf'` at the seat's own `player` row throws out of the step. The engine finds an
     act by `kind.acts?.[action]`, which finds what every object inherits.

   Each throw leaves a message listener or the step, which stops the process and every seat on it.
   Before a player who is not you dials the server, and before `shipping-a-game` puts it where one
   can, the wire's own pieces drop these. The engine is untouched:
   - the socket addon drops a message its `JSON.parse` cannot read;
   - the scenemanager's `accept` drops an up that is not an object;
   - `connection`'s `take` drops a `msg` unless `seq`, `n` and `id` are numbers, `action` is a
     string and `args` is an array of `Arg`s. Where the named row is there, it also drops a `msg`
     whose `action` the row's kind has only by inheritance: `action in acts` but not
     `Object.hasOwn(acts, action)`. An action the kind does not have at all still goes on, because
     the engine refuses it and acks it. The player plugin's probe, a message whose action is `''`,
     measures the round trip of whole-steps prediction by that ack.

   Each fix has its test beside it: `addons/socket/socket.addon.test.ts` and
   `addons/scenemanager/scenemanager.addon.test.ts`. Each sends what is listed above, then checks that
   the server steps on and that every other seat is still sent its packets.

   A rule or an act that throws stops the server the same way: `run` steps the manager from a timer
   with no catch, the engine runs its step's listeners one after another (`step` in
   `engine/engine.ts`), and the scenemanager steps every scene in one listener (`load`) and sends each
   connection its packet in a listener of its own (`connection`). The throw is caught where those
   loops are, in the scenemanager addon: per scene, around each scene's step in `load`'s loop, and
   per connection, around each connection's work. Never around the whole manager step in `run`:
   there one scene's throw skips every scene after it and every connection's packet, and a throw that
   comes back every step freezes every seat behind one line of log. A scene that threw is half
   stepped, so it is not stepped again and its seats are let go; every throw is reported, naming the
   scene. Its test, in `addons/scenemanager/scenemanager.addon.test.ts`: a manager of two scenes and
   two seats, one on each, where one scene's rule throws every step, and the seat on the other keeps
   playing and is sent its packets. Persist's failed load, which throws out of every step by design
   (`advance` in `addons/persist/persist.addon.ts`), is the same case and needs nothing more. It is
   never a `try`, a `catch` or a `process.on` in one game's `<game>.server.ts`.

7. **Read prediction against the network.** The player plugin (`plugins/player/player.plugin.ts`, its
   Prediction and Clock headers) runs the seat's own press on the page before the server has it:

   - A press whose rule writes only the row it names, or a row whose act it calls, is drawn at the
     press. One whose rule spawns, ends a row, rolls the die, writes `world`, writes another row, or
     calls a plugin's row (as `go` does) is not run ahead, and waits a round trip for the packet.
   - Every other seat's rows are drawn as the packets bring them, the down leg late.
   - A sound or an effect is a ledger row whose kind is named in `world.player.ledgers`. Without that,
     a predicted press would play it once at the press and again when the packet comes
     (`input-and-seats`, Prediction and ledgers).
   - A scene whose rules keep state between steps, such as a physics world, sets `world.player.steps`.
     The page then runs whole steps over its own rows, and corrects and runs again when a packet
     differs.
   - The page's step is a clock of its own, placed by the packets of the last `world.player.window`
     seconds (2 when the scene gives none), so a late packet, or two on one frame, moves nothing drawn.
   - The steps the page runs ahead, its lead, are measured by acks, so before its first ack the page
     runs nothing ahead. A first press's act runs at once: the new game's `move` sets the body's
     `move` field, and the body is drawn a step on. But each packet puts it back where the server has
     it, so it is drawn moving on only once the ack comes. Played on the simulator with 50 ms each
     way, the first press's body went 4 px on and back until the ack, then on; a press made after
     that ack was drawn a frame after it went down, 47 ms before the server's step took it.

   What a bad network does, as the player plugin's tests play it: a lost press is drawn but never
   applied, and stays drawn until a later press's ack covers it; a duplicated press runs twice on the
   server; reordered presses are applied in the other order; jitter moves the page's step around; a
   server slower than the page costs a held frame for each step it falls behind, never a jump. The
   socket is TCP, so it loses, duplicates and reorders nothing. On a socket these come only from a
   network the loopback is told to have, or from a transport that does not keep TCP's promises.

8. **Try a bad network before shipping.** The game is played on bad networks on node, with no time
   passing (`addons/simulator/simulator.addon.ts`):

   - `simulate(run)` boots the manager scene `run.file` with `run.sim`, loading its scenes from
     `run.base`. It steps the server with the loop every server runs, on a clock of its own, and opens
     each page of `run.pages` as `view(link(loopback(accept(manager), time, net)))`. Each page has its
     own `up` and `down` legs, display and presses, and every frame, step, packet and message is
     written down as a record. A leg is the loopback's `Leg`: `delay`, `jitter`, `tail`, `loss`,
     `reorder`, `dup` and `burst`, every roll from one `seed`, so a run is the same bytes every time.
     `histogram`, `corrections`, `leads`, `late`, `packets`, `standoff` and `summary` read facts off
     the records for a test to state. Its pages load in node with no canvas, and no `mount` is needed.
   - From the command line:
     `node --experimental-strip-types addons/simulator/simulator.addon.ts run <config.json> [out.jsonl]`.
     A config is a run as JSON, with `game`, the path of the manager scene file from the root, in
     place of `file`, `sim` and `base`. It prints the summary.
   - In the editor, the simulator's Runs panel plays a config and keeps it as a recording (`sim.run`,
     `sim.read`, `sim.runs`).
   - In a real browser, `client.html?tap=<name>` records every frame through the editor's server into
     `addons/simulator/runs/<name>.jsonl`, a folder the first recording makes. `timing(records)` gives
     a simulation a recording's own timing, and `real(run)` plays pages over the real socket on real
     clocks.

   A simulation boots the manager and loads its scenes itself. It never runs `<game>.server.ts`, so
   anything only that file did is missing from a simulation.

## Chat and parties

`plugins/chat` and `plugins/party` are players talking and playing together. The game's sim builds
each server half, `chat(post, members)` and `party(post, here)`, and hands in
`post(w, to, kind, act, ...args)`: mail to the first row of `kind` in the truth `to` names. Each also
needs an account for each seat, which its `who` names, and accounts are `persisting-players`'.

Core ships no `post`. Mail between truths holds more than one truth, so it is an addon,
`addons/<name>/<name>.addon.ts`, that names no game and no kind:
- `post` is handed `w`, the truth the mail is sent from. Core already finds a truth's own state from
  `w` by its `w.world`, as `addons/vision`'s `sees` does.
- The mail arrives from a seat that possesses no row (`open()` with no row, in `engine/engine.ts`). So
  every act it carries is one a kind lists in `open`, which is why chat's `relay` and `hear`, and
  party's `ask`, `invited`, `uninvited` and `mirror`, are open.
- A `{ account }` address reaches the truth that account is in, which needs the accounts the
  connections carry.
- It is attached where `index.html`, `<game>.server.ts` and `simulate` all get it: each of them calls
  `load`, which boots every truth. Never a line in `<game>.server.ts`, and never a stand-in written
  inside a game.
- Its test, beside it, writes a manager of two scenes, as the socket's does, and mails from one to the
  other.

Each draws on `ui`'s panels, is listed before `ui` in the scene's `plugins`, and throws when it is
listed after it or the scene lists no `ui`. Chat throws when its row's `talk` holds `party` or
`whisper` and the scene's `security` block lists no `chatbox` `channels` (`chatbox: { channels: 'me' }`),
since every seat would otherwise be sent every whisper. Party always throws unless `security` lists
`partyseat` `account` and `invite` (`partyseat: { account: 'me', invite: 'me' }`). Drawing their
frames is `building-the-hud`'s. Their headers (`chat.sim.ts`, `chat.plugin.ts`, `party.sim.ts`,
`party.plugin.ts`) hold the rest.

## A new way to travel

WebRTC, or any other way to travel, is a new transport addon of the same shape as the loopback and the
socket, `addons/<name>/<name>.addon.ts`. It knows nothing of scenes, seats, games or kinds, and imports
from `engine/` and other addons, never from `games/`. Its server side is handed an `Accept<U, D>` and
its page side is a `Wire<U, D>`, both typed in `addons/loopback/loopback.addon.ts`, and `link` and
`accept` take it as they take the socket's. A game moves to it by changing the one transport line of
`client.html` and of `<game>.server.ts`. Its signalling, the offers and answers exchanged before a peer
connection opens, crosses the socket addon's `dial` and `serve` or `upgrades`, because no other file
may open a WebSocket. Node 22 has no `RTCPeerConnection`, and `ws` is the only network library in
`package.json`. So the server side of a WebRTC transport on node needs a new dependency, added to
`package.json` with the addon.

A channel that drops or reorders is already handled by the scenemanager's diffs. The page's `link`
drops an envelope whose base never arrived, and a second copy of one, and the server diffs each later
envelope against the newest one the page said it got. A lost press is a press lost, as in step 7. What
it hands `accept` arrives from outside the program, so it drops what it cannot read, as step 6 has the
socket do. The
addon's test sits beside it, `addons/<name>/<name>.addon.test.ts`, on a manager scene it writes itself,
as the socket's does. It checks that each page that connects gets a seat and loses it on close, that a
page finding no seat free is refused, that a press sent across a scene move is dropped, and that a page
is told once that its server has gone.

## What goes wrong

- The second player's page is blank. The scene still says `"seats": 1`, so the socket refused that
  connection with 1013, and `client.html` gives `dial` no `gone` to say so. Raise `seats` and add a
  `start` per slot. Telling a refused player is built in core's page template (step 1).
- A simulation given more pages than the entry scene has seats throws `no seat free`: the loopback
  refuses nobody.
- `world.vision` added to the new game, and no seat sees even its own body, and the page throws
  `no row <id>` on the first `move`: the body has no slot field (step 4).
- The fog drawn off the bodies: `world.render2d`'s world is not the canvas's pixels, or the things it
  should cover are drawn straight on the stage (step 4).
- One connection stops the server with one bad message, or one rule's throw stops it for every seat
  (step 6).
- A rule's throw caught around the whole manager step in `run`: one scene's throw skips every later
  scene and every connection's packet. It is caught per scene and per connection in the
  scenemanager's own loops (step 6).
- Two tabs in one window, and one of them frozen: Chrome paused the tab that is not in front. Use two
  windows.
- Two players tried as two tabs of `index.html`: that is two games. Use `client.html` against the
  server.
- The server dies with `EADDRINUSE`: one is already on that port, the Node panel's or a leftover one.
  Stop one of them.
- The server run from inside the game's folder cannot read its files. Run it from the root.
- A level won or stuck on the server stays won or stuck for every seat that enters it after, until
  the server is started again: `load` boots each scene once for the life of the process, and a
  `suspend: true` scene keeps its rows when the last seat leaves. A game that can be won or stuck
  needs a way back of its own, a restart act or an `enter` act that starts the level over
  (`scene-flow`, steps 4 and 6); which one is the person's to say, and they are told that without one
  the level stays as it was left.
- An `interest` block written into the scene, and every seat is still sent every row: nothing attaches
  it (step 4).
- A line added to `<game>.server.ts` or `client.html` to attach a piece, filter rows or show a readout.
  A page mounts things and nothing else, and `index.html` and the simulator never run that line.
- A test or a tool that opens a WebSocket of its own fails the socket addon's guard. Use
  `link(dial(url))`.
- An act that trusts its args. Every arg came off the network (step 5).
- Two pages dialled at the same moment take their slots in either order. A test that needs a given page
  on slot 0 dials the second page once the first is seated.
- A test that waits on the socket with `vi.waitFor` around `truth.step`. It retries every 50 ms for one
  second, about 20 steps, fewer than a walk across the screen takes. Step in a loop of the test's own,
  with a short wait between steps, until the condition holds.
- A fixed number put on a row is copied to every seat every step. It belongs on `world`, in the
  definition, or in a data file.

## How it is proven

- `games/<game>/<game>.server.test.ts`, beside the server file, boots the manager as that file does
  (`boot`, then `load` with `import.meta.url`) and calls `serve(0, accept(manager(truth)))` on a free
  port. It dials pages as `client.html` does, `link(dial(url))` with `url` the
  `ws://localhost:<port>` that `serve` handed back, one after another. It steps the truth by hand between short waits rather than calling `run`, so every step is
  the test's own. It reads what each page was sent off the envelopes that page hears, and what the
  truth holds off the scene's rows (`scene(manager(truth), '<scene>')`). It checks:
  - each page is sent its own `player` row and no other, and the other seat's public row;
  - one page past the last seat is refused, and its `gone` is called;
  - a seat that closes leaves its slot and its rows;
  - for each piece the scene uses, a seat is sent its own rows; a row moved out of reach is in that
    page's `ended`, then absent while the truth still holds it, and in its `born` when it comes back.
- The press check. This is the one list of it, for every game whose seat drives a body, on one seat
  or many: `tuning-feel` and `proving-a-game` point here. It sits beside the rule of the body the
  seat drives, in `<kind>.sim.test.ts` (`tuning-feel`, step 3), and a scene of more than one seat
  also gets it in `<game>.server.test.ts`, beside the server test above, with a page per seat. A
  simulation test calls `simulate` with the game's manager scene, sim and folder, and puts pages, no
  more than the seats, on legs of their own, with a `watch` of the bodies and the page's `own`,
  without which no rows are recorded. For each page, every fact of the list is required, each stated
  off the records:
  1. A press made once the page has its lead, after its first ack, is drawn moving within two frames
     of the press, and before the server's step takes it.
  2. A first press is not: before its first ack the page runs no step ahead, so the first press is
     drawn a step on at most and put back where the server has it on each packet. Under
     `world.player.steps` the page probes as it joins and has its ack at once, so no press comes
     before it.
  3. The frame-by-step comparison: from the frame of the first ack on, every frame draws the page's
     own body where the step record of the step that frame drew has it, the step whose
     `scenes[<scene>]` is the frame's `step`. It is what catches a snap: `corrections` counts only
     whole steps' reruns and reads 0 on the default however the page snaps. A page that fails it is
     drawing a snap, and how its press is run ahead is then chosen as `tuning-feel` says (step 2).
  4. A body that comes to rest ends on the server's rows: the last frame's rows equal the last
     step's. A body that never comes to rest, a kart on its circuit, is compared as fact 3 compares
     it, at the step each frame drew, since its last frame and the last step are of different steps.
  5. Each page's `corrections` and `histogram` say what the mechanism makes true of them: no
     correction without `world.player.steps`, and on a display at the step rate each frame from the
     join moving one step, a step more where the page's lead grew and one fewer where it fell.

  A press handed to a page as a `key` is the `KeyboardEvent.code` that `keyCode` from
  `plugins/player/player.plugin.ts` gives the key the game binds, never a mapping of the test's own.
  `simulate` makes its pages in node, so it is a `.test.ts`. A test that attaches a game view through
  the editor's session is a `.view.test.tsx`. On the game `yarn new-game` writes, its body moving
  along x for the right key, every assertion in this block, facts 1 (before the server's step), 2, 4
  and 5, held on ten seeds:

  ```ts
  // The key the game binds to move right: the generated player.client.ts binds the arrows in its own
  // table; a game that keeps its keys on the player definition (keys per slot) reads them there.
  const right = 'ArrowRight'
  const scene = file.prefabs.scenemanager.entry
  const leg = { delay: 50, jitter: 10 }
  const first = 500, second = 1500 // the second well past a round trip
  const records = await simulate({
    file: structuredClone(file) as Scene, sim, base: here, seed: 1, ms: 3000,
    pages: [{ display: { hz: 1 / DT }, up: leg, down: leg, presses: [first, second].flatMap(at =>
      [{ at, key: keyCode(right) }, { at: at + 200, key: keyCode(right), up: true }]) }],
    watch: { kinds: ['body'], fields: ['pos'], own: 'body' },
  })
  const frames = records.filter((r): r is FrameRecord => r.type === 'frame' && r.page === 0)
  const steps = records.filter((r): r is StepRecord => r.type === 'step')
  const sent = records.filter((r): r is MessageRecord => r.type === 'message' && r.page === 0)
  const x = (f: FrameRecord) => (f.rows[f.own!].pos as number[])[0]
  // When the page first drew its own body moved after `t`, and when the server took the press of `t`.
  const drawn = (t: number) => frames.find((f, i) => f.t > t && i > 0 && x(f) !== x(frames[i - 1]))!.t
  const taken = (t: number) => {
    const seq = sent.find(m => m.sent >= t)!.seq
    return steps.find(s => s.applied.some(a => a.page === 0 && a.seq === seq))!.t
  }
  const acked = frames.find(f => f.ack > 0)!.t
  expect(acked).toBeLessThan(second)
  // Before the first ack the first press is drawn a step on at most.
  const was = x(frames.filter(f => f.t < first).at(-1)!)
  for (const f of frames.filter(f => f.t > first && f.t < acked)) expect(x(f) - was).toBeLessThanOrEqual(defs.body.speed * DT)
  // After it, a press is drawn moving before the server's step takes it.
  expect(drawn(second)).toBeLessThan(taken(second))
  expect(frames.at(-1)!.rows).toEqual(steps.at(-1)!.rows![scene])
  // Without `world.player.steps` the page reruns no whole step, so it counts no correction.
  expect(corrections(records, 0).count).toBe(0)
  // On a display at the step rate each frame from the join moves one step, a step more where the
  // page's lead grew and one fewer where it fell.
  const drew = frames.filter(f => f.step !== null)
  const moved: Record<number, number> = {}
  for (let i = drew.findIndex(f => f.ack > 0) + 1; i < drew.length; i++) {
    const by = 1 + drew[i].lead - drew[i - 1].lead
    moved[by] = (moved[by] ?? 0) + 1
  }
  expect(histogram(records, 0).counts).toEqual(moved)
  ```

  Beside them, in the same test, fact 1's two frames and fact 3, the comparison that finds a snap:

  ```ts
  // Fact 1: a press after the ack is drawn moving within two frames of it.
  expect(drawn(second) - second).toBeLessThanOrEqual(2 * DT * 1000)
  // Fact 3: from the first ack on, each frame draws its own body where the server had it at the
  // step the frame drew. A frame of a step the run ended before has no step record to compare with.
  for (const f of frames.filter(f => f.t >= acked && f.step !== null)) {
    const s = steps.find(s => s.scenes[scene] === f.step)
    if (s) expect(f.rows[f.own!]).toEqual(s.rows![scene][f.own!])
  }
  ```

  A page fact 3 fails is drawing a snap, and its game chooses how a press is run ahead
  (`tuning-feel`, step 2) before the check is called met. The key, the speed, the step rate and the
  scene's name are read off the files; the times are the test's own. A scene with
  `world.player.steps` states its corrections from what the page could not run: another seat's
  press, or one of its own the server took late (`late`). A scene of several seats states every fact
  for every page, each page's own body by its own `own`.
- Run with `yarn vitest run games/<game>/<game>.server.test.ts`.
- Step 6's fixes are proven in the addons' own tests: the server sent each bad message keeps
  stepping and keeps serving its other seats, and a manager with one scene that throws every step
  keeps the seat on its other scene playing.
- When a change touches the wire or a piece, run the guards beside it. For the wire:
  `addons/socket/socket.addon.test.ts`, `addons/scenemanager/scenemanager.addon.test.ts` and
  `plugins/scenemanager/scenemanager.plugin.test.ts`. For what is sent:
  `addons/player/player.addon.test.ts`, `addons/interest/interest.addon.test.ts`,
  `addons/vision/vision.addon.test.ts` and `plugins/vision/vision.plugin.test.ts`. For prediction:
  `plugins/player/player.plugin.test.ts`. For the network: `addons/loopback/loopback.addon.test.ts`
  and `addons/simulator/simulator.addon.test.ts`.
- Played: the server running and `client.html` in two windows, each player moving and seeing the other
  move. For vision, the Vision panel. For a real session, a `?tap=` recording read in the Runs panel.
