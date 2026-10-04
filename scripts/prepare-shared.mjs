import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyWorkspaceProof } from '../../shared/scripts/workspace-build-provenance.mjs'

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sharedRoot = resolve(mobileRoot, '../shared')
const manifest = JSON.parse(readFileSync(resolve(mobileRoot, 'package.json'), 'utf8'))
const declared = { ...manifest.dependencies, ...manifest.devDependencies }
const packages = Object.keys(declared).filter(
  (name) => name.startsWith('@offgrid/') && String(declared[name]).startsWith('file:../shared/')
)

try {
  verifyWorkspaceProof(sharedRoot, { directory: mobileRoot, packages })
  console.log(`Using verified Shared artifacts (${packages.length} Mobile contracts).`)
} catch (cause) {
  console.log(
    `Shared artifacts need a rebuild: ${cause instanceof Error ? cause.message : String(cause)}`
  )
  const result = spawnSync('npm', ['run', 'build:shared'], {
    cwd: mobileRoot,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  verifyWorkspaceProof(sharedRoot, { directory: mobileRoot, packages })
}
