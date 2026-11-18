#!/usr/bin/env node
/**
 * Ship one verified change, in one command.
 *
 * The rule this exists for: a finished change is committed and pushed, not held
 * in a working tree waiting for permission. That rule is easy to state and easy
 * to forget at the end of a long turn, so it lives here instead of in prose.
 *
 * Usage:
 *   node ship.mjs --message "what changed and why"            patch bump
 *   node ship.mjs --message-file msg.txt --bump minor
 *   node ship.mjs --message "…" --bump none --skip-tests      docs-only change
 *   node ship.mjs --message "…" --port 60127                  also live-smoke the host
 *
 * What it does, in order:
 *   1. refuses to run outside this repository, or with a rebase/merge in progress;
 *   2. runs the suite (and the live smoke test when a port is given);
 *   3. bumps the version in package.json;
 *   4. commits everything staged and unstaged, with the message given;
 *   5. pushes to main with the connected GitHub token, no interactive prompt.
 *
 * It never force-pushes. A non-fast-forward push is reported and left alone.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

function flag(name) {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : null
}

function has(name) {
  return args.includes(name)
}

const message = flag('--message')
const messageFile = flag('--message-file')
const bump = flag('--bump') ?? 'patch'
const port = flag('--port')
const skipTests = has('--skip-tests')
const dryRun = has('--dry-run')

function fail(text) {
  console.error(`ship: ${text}`)
  process.exit(1)
}

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  if (result.error) return { status: 1, stdout: '', stderr: String(result.error.message) }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function git(...argv) {
  return run('git', argv)
}

/* ------------------------------------------------------------------ guards */

if (!message && !messageFile) fail('a message is required: --message "…" or --message-file path')
if (!['none', 'patch', 'minor', 'major'].includes(bump)) fail(`unknown bump "${bump}" (none|patch|minor|major)`)

const top = git('rev-parse', '--show-toplevel')
if (top.status !== 0) fail('not a git repository')
if (path.resolve(top.stdout.trim()) !== path.resolve(repoRoot)) {
  fail(`run this from the repository root (${top.stdout.trim()})`)
}

for (const inProgress of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD']) {
  if (fs.existsSync(path.join(repoRoot, '.git', inProgress))) fail(`a ${inProgress} is in progress; finish it first`)
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()
if (branch !== 'main') fail(`on branch "${branch}"; this ships main`)

let body = message
if (!body && messageFile) {
  const resolved = path.resolve(repoRoot, messageFile)
  body = fs.readFileSync(resolved, 'utf8').trim()
  // A message file inside the repository is transient by nature: this command
  // stages everything, so it would be committed as part of the change it
  // describes. Read it, then consume it.
  if (resolved.startsWith(repoRoot + path.sep)) {
    fs.rmSync(resolved, { force: true })
    console.log(`ship: consumed the message file ${path.relative(repoRoot, resolved)}`)
  }
}
if (!body || body.length < 8) fail('the message is too short to be a record of the change')

const status = git('status', '--porcelain').stdout.trim()
if (status.length === 0 && bump === 'none') fail('nothing to ship')

/* ------------------------------------------------------------------- checks */

if (!skipTests) {
  console.log('ship: test suite')
  const suite = run(process.execPath, [path.join(repoRoot, 'test', 'run-all.mjs')])
  const tail = `${suite.stdout}${suite.stderr}`.trim().split('\n').slice(-2).join(' ')
  if (suite.status !== 0) fail(`the suite failed — nothing shipped\n${tail}`)
  console.log(`ship:   ${tail}`)
} else {
  console.log('ship: test suite skipped (--skip-tests)')
}

if (port) {
  console.log(`ship: live smoke on port ${port}`)
  const smoke = run(process.execPath, [path.join(repoRoot, 'smoke-live.mjs'), port])
  const tail = `${smoke.stdout}${smoke.stderr}`.trim().split('\n').slice(-2).join(' ')
  if (smoke.status !== 0) fail(`the live smoke test failed — nothing shipped\n${tail}`)
  console.log(`ship:   ${tail}`)
}

/* ------------------------------------------------------------------ version */

const pkgPath = path.join(repoRoot, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const previous = String(pkg.version ?? '0.0.0')
const parts = previous.split('.').map((part) => Number.parseInt(part, 10) || 0)
if (bump === 'patch') parts[2] += 1
if (bump === 'minor') {
  parts[1] += 1
  parts[2] = 0
}
if (bump === 'major') {
  parts[0] += 1
  parts[1] = 0
  parts[2] = 0
}
const next = parts.join('.')
console.log(`ship: version ${previous} -> ${next}${bump === 'none' ? ' (unchanged)' : ''}`)
if (dryRun) {
  console.log('ship: dry run — nothing written, nothing committed, nothing pushed')
  process.exit(0)
}
if (bump !== 'none') {
  pkg.version = next
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

/* ------------------------------------------------------------------ commit */

const added = git('add', '-A')
if (added.status !== 0) fail(`could not stage the change: ${added.stderr.trim()}`)

const summaryFile = path.join(os.tmpdir(), `wrenchbench-ship-${process.pid}.txt`)
fs.writeFileSync(summaryFile, `${body}\n`)
const committed = git('commit', '-F', summaryFile)
fs.rmSync(summaryFile, { force: true })
if (committed.status !== 0) fail(`commit failed: ${committed.stderr.trim()}`)
const sha = git('rev-parse', '--short', 'HEAD').stdout.trim()
console.log(`ship: committed ${sha}`)

/* -------------------------------------------------------------------- push */

const authPath = path.join(process.env.USERPROFILE ?? os.homedir(), '.dsh', '.dsh-github-connect', 'auth.json')
let token = null
try {
  token = JSON.parse(fs.readFileSync(authPath, 'utf8')).token ?? null
} catch {
  token = null
}
if (!token) fail(`no GitHub token at ${authPath}; the commit is local and unpushed`)

// The token reaches git through a throwaway askpass helper, never through a
// remote URL, an argument list or a file inside the repository.
const helper = path.join(os.tmpdir(), `wrenchbench-askpass-${process.pid}.cmd`)
fs.writeFileSync(helper, `@echo off\r\necho ${token}`, 'ascii')
const push = spawnSync(
  'git',
  ['-c', 'credential.helper=', '-c', `core.askPass=${helper}`, 'push', 'origin', 'main'],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_ASKPASS: helper,
      GIT_ASKPASS_REQUIRE: 'force',
      GIT_TERMINAL_PROMPT: '0',
    },
  },
)
fs.rmSync(helper, { force: true })

const output = `${push.stdout ?? ''}${push.stderr ?? ''}`.replaceAll(token, '***').trim()
if (push.status !== 0) {
  console.error(output)
  fail(`push refused — the commit ${sha} is local. Reconcile with origin/main by hand; this never force-pushes.`)
}

const remote = git('remote', 'get-url', 'origin').stdout.trim().replace(/\.git$/, '').replace(/^.*github\.com[:/]/, 'https://github.com/')
console.log(`ship: pushed to main`)
console.log(`\n  ${remote}/commit/${sha}   (v${next})\n`)
