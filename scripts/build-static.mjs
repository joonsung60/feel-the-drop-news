// Static build for Cloudflare Pages.
// Temporarily moves admin/api/proxy out of the tree so `output: 'export'`
// can succeed (route handlers and proxy are unsupported by static export),
// runs `next build` with BUILD_STATIC=1, and restores the files on exit.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const STASH = '.cf-build-stash'
const DISCOVERY_MANIFEST = `${STASH}/discovery-manifest.json`
const STATIC_ROUTE_PATHS = new Set(['app/feed.xml'])
const STASH_CANDIDATES = [
  ['app/admin', `${STASH}/app/admin`],
  ['app/api', `${STASH}/app/api`],
  ['proxy.ts', `${STASH}/proxy.ts`],
  ['worker', `${STASH}/worker`],
]
const PATHS = STASH_CANDIDATES.filter(([src]) => !STATIC_ROUTE_PATHS.has(src))

function stash() {
  for (const [src, dst] of PATHS) {
    if (existsSync(src)) {
      mkdirSync(dirname(dst), { recursive: true })
      renameSync(src, dst)
    }
  }
}

function restore() {
  for (const [src, dst] of PATHS) {
    if (existsSync(dst)) {
      const parent = dirname(src)
      if (parent && parent !== '.') mkdirSync(parent, { recursive: true })
      renameSync(dst, src)
    }
  }
  try {
    rmSync(STASH, { recursive: true, force: true })
  } catch {}
}

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  restore()
}

process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('SIGTERM', () => { cleanup(); process.exit(143) })

let status = 0
try {
  const generateStaticFiles = spawnSync(process.execPath, ['scripts/generate-static-files.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, DISCOVERY_MANIFEST_PATH: DISCOVERY_MANIFEST },
  })
  if ((generateStaticFiles.status ?? 1) !== 0) {
    process.exit(generateStaticFiles.status ?? 1)
  }

  stash()
  // Use webpack: Turbopack in Next.js 16.2 silently no-ops `output: 'export'`
  // (build completes but no `out/` directory is produced).
  const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], {
    stdio: 'inherit',
    env: { ...process.env, BUILD_STATIC: '1' },
  })
  status = result.status ?? 1
  if (status === 0) {
    const validation = spawnSync(
      process.execPath,
      ['scripts/validate-discoverability.mjs', DISCOVERY_MANIFEST, 'out'],
      { stdio: 'inherit', env: process.env }
    )
    status = validation.status ?? 1
  }
} finally {
  cleanup()
}

process.exit(status)
