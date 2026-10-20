import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { searchForWorkspaceRoot } from 'vite'
import { defineWorkspace } from 'vitest/config'

// `.test.ts` runs in node, as the engine, addons, plugins, games and the editor's server do.
// `.test.tsx` renders React in jsdom with Testing Library. Neither reaches into `.claude/`, where
// an agent's worktree holds another checkout of the repo. A page in jsdom imports only files Vite
// may serve: the repo's, and a test's sandbox of it (`editor/test/editor.ts`), in the system's
// temp folder, where a scene a test adds is written and its sim imported from.
// `.view.test.tsx` holds the tests that attach a game view to the session (`session.attach`), so
// the game's client is made and draws its frames in jsdom: a game booted, built and drawn on the
// CPU, seconds a test. They are left out of every run but `yarn test:view`, which sets VIEW.
const outside = ['node_modules/**', 'dist/**', '.claude/**']
const dom = { environment: 'jsdom', setupFiles: ['./editor/test/setup.ts'] }
const serve = { fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync(tmpdir())] } }

export default defineWorkspace([
  { extends: './vite.config.ts', test: { name: 'node', include: ['**/*.test.ts'], exclude: outside, environment: 'node' } },
  { extends: './vite.config.ts', test: { name: 'dom', include: ['**/*.test.tsx'], exclude: [...outside, '**/*.view.test.tsx'], ...dom }, server: serve },
  ...(process.env.VIEW ? [{ extends: './vite.config.ts', test: { name: 'view', include: ['**/*.view.test.tsx'], exclude: outside, ...dom }, server: serve }] : []),
])
