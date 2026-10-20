# core

Patchwork: an engine, the plugins and addons built on it, and an editor, shipped as source. A game
is made by cloning this repo. Nothing is published to npm: every plugin is a folder you can read,
change and commit, and its documentation is the header of its own file.

## Getting started

```
git clone --origin upstream https://github.com/billautomata/core.git mygame
cd mygame
yarn install
yarn new-game mygame
yarn editor mygame
```

`--origin upstream` names core's remote `upstream`, leaving `origin` for your own repo.

`yarn new-game <name>` writes `games/<name>/`: one scene, `main`, on render2d, with a seat that
starts at a `start` actor and moves a square with the arrow keys. It is what the editor's
File → New Game writes. Play it from `games/<name>/index.html`, or run its server with
`node --experimental-strip-types games/<name>/<name>.server.ts` and open `client.html`. Run it again
to make a second game.

Before writing code, read `.claude/CLAUDE.md` and `.claude/skills/prime-directive/SKILL.md`: where
every new thing goes. Beside it in `.claude/skills/` are the phase skills, one for each kind of work:
making a game (`starting-a-game` through `auditing-a-game`) and distributing it
(`going-multiplayer`, `persisting-players`, `shipping-a-game`). Your agent reads them too.

## Your repo

It has two remotes:

- `upstream`: core. You read from it and never push to it.
- `origin`: your own repo, which you add when you make it (`git remote add origin <url>`, then
  `git push -u origin master`).

Everything you change is a commit in your repo: your game, a new plugin such as
`plugins/terrain4d/`, an edit to core's own `plugins/terrain3d/`. You push to `origin`.

## Taking core's updates

1. `git fetch upstream`: downloads core's new commits. It changes none of your files.
2. `git switch -c update-core`: a branch to merge on, so `master` is untouched until the merge is
   proven.
3. `git merge upstream/master`: joins core's changes into yours.
4. `yarn install`, `yarn tsc`, the tests beside what core changed, and your game played.
5. `git switch master`, `git merge update-core`, `git push origin master`.

Git merges line by line, file by file:

- A file only you have (`plugins/terrain4d/`, `games/mygame/`): core has no such file, so the merge
  never touches it.
- A file only core changed: takes core's version.
- A file both changed, in different places: both changes kept.
- A file both changed on the same lines, a file one side deleted and the other changed, or a file
  both created at the same path (core later ships its own `terrain4d`): the merge stops and names
  the file, with both versions marked inside it. Nothing is overwritten. You, or your agent, write
  what the lines should be and commit; `git merge --abort` puts everything back as it was before
  step 3.
- `yarn.lock` in conflict: take core's (`git checkout --theirs yarn.lock`) and run `yarn install`,
  which writes it again with both sides' dependencies.

A merge with no conflict can still break your game: core renames a function `terrain4d` calls, and
the lines never touched each other. Step 4 is how that is found: `yarn tsc` names every call that
no longer matches, and the tests and the game show the rest.

## Giving back

A plugin worth having in core goes to core as a pull request from a fork of core on GitHub; once
merged, the next update brings it back as core's.
