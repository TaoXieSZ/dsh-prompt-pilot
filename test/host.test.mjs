// Integration test for the Prompt Pilot Host half: the real module, a fake
// Cordis context, and a throwaway git repository as the working directory.
//
//   node test/host.test.mjs
//
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const api = await import(new URL('../index.js', import.meta.url))

// A clean repository with one commit, then one uncommitted edit: `changes`
// must appear, `pr` must not (no remote, so `gh` finds nothing).
const REPO = mkdtempSync(join(tmpdir(), 'prompt-pilot-fixture-'))
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { stdio: 'ignore' })
git('init')
git('-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'base')
writeFileSync(join(REPO, 'a.txt'), 'one\n')
git('add', 'a.txt')
git('-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-m', 'add a')
appendFileSync(join(REPO, 'a.txt'), 'two\n')

/** A session that was interrupted mid-turn, with one human/model exchange. */
const EVENTS = [
  { type: 'turn/start', seq: 1, data: { turn: 1 } },
  { type: 'user/message', seq: 2, data: { role: 'user', content: [{ type: 'text', text: 'Fix the flaky build' }] } },
  { type: 'assistant/message', seq: 3, data: { turn: 1, step: 1, stream: [], message: { role: 'assistant', content: [{ type: 'text', text: 'Looking at the CI logs.' }] } } },
  { type: 'turn/start', seq: 4, data: { turn: 2 } },
  { type: 'turn/end', seq: 5, data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'disposed' } } } },
]

const GOOD_REPLY = '```json\n{"suggestions":[{"label":"Re-run the failing test","prompt":"Re-run the flaky test and show the log."},{"label":"Bisect the regression","prompt":"Bisect recent commits to find the regression."}]}\n```'

/**
 * Build the fake context and apply the plugin.
 * @param {{llmReply?: string|null, selection?: object, cwd?: string}} options - fixture shape.
 */
function boot({ llmReply = null, selection = { provider: 'p', model: 'm' }, cwd = REPO } = {}) {
  const routes = []
  let llmCalls = 0
  const llm = llmReply === null ? undefined : {
    stream(options) {
      llmCalls += 1
      assert.equal(options.provider, 'p')
      assert.equal(options.model, 'm')
      assert.equal(options.reasoningEffort, undefined, 'reasoningEffort must not be forwarded')
      return (async function* () {
        for (const piece of [llmReply.slice(0, 10), llmReply.slice(10)]) {
          yield { type: 'text-delta', index: 0, text: piece }
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const session = {
    id: 's1',
    seq: 9,
    header: { cwd },
    snapshotEvents: (from, to) => EVENTS.filter((event) => event.seq >= from && event.seq < to),
  }
  const ctx = {
    effect: (fn) => { const dispose = fn(); return () => dispose?.() },
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection: () => selection }
      return undefined
    },
    logger: { warn: (...args) => console.log('  [warn]', ...args) },
    sessions: { get: (id) => (id === 's1' ? session : undefined) },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
  }
  api.apply(ctx)
  assert.equal(routes.length, 1, 'exactly one route')
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/plugin/prompt-pilot')
  return {
    hit: (path) => routes[0].resource(new Request(`http://127.0.0.1:1${path}`)),
    llmCalls: () => llmCalls,
  }
}

const kinds = (body) => body.chips.map((chip) => chip.kind)
const aiChips = (body) => body.chips.filter((chip) => chip.kind === 'ai')

try {
  // 1. Repository session, interrupted turn, model available.
  {
    const { hit, llmCalls } = boot({ llmReply: GOOD_REPLY })
    const body = await (await hit('/plugin/prompt-pilot/suggest?sessionId=s1&debug=1')).json()
    assert.deepEqual(kinds(body), ['resume', 'changes', 'ai', 'ai'], `kinds were ${JSON.stringify(kinds(body))}`)
    assert.ok(body.chips[1].count > 0, 'dirty count')
    assert.equal(aiChips(body)[0].label, 'Re-run the failing test')
    assert.equal(aiChips(body).length, 2)
    assert.equal(llmCalls(), 1)
    // git resolves the macOS /var → /private/var symlink in --show-toplevel.
    assert.equal(body.debug.repo, realpathSync(REPO))
    assert.equal(body.debug.turnReason, 'cancelled')
    assert.equal(body.debug.messages, 2)
    console.log('✓ repo + interrupted turn + model → resume, changes, ai×2')
  }

  // 2. ai=0 never calls the model.
  {
    const { hit, llmCalls } = boot({ llmReply: GOOD_REPLY })
    const body = await (await hit('/plugin/prompt-pilot/suggest?sessionId=s1&ai=0')).json()
    assert.deepEqual(kinds(body), ['resume', 'changes'])
    assert.equal(llmCalls(), 0)
    console.log('✓ ai=0 → deterministic chips only, no model call')
  }

  // 3. The rail cap keeps signals ahead of model prompts.
  {
    const { hit } = boot({ llmReply: '{"suggestions":[{"label":"A","prompt":"a"},{"label":"B","prompt":"b"},{"label":"C","prompt":"c"}]}' })
    const body = await (await hit('/plugin/prompt-pilot/suggest?sessionId=s1')).json()
    assert.equal(body.chips.length, 4, 'capped at four')
    assert.deepEqual(kinds(body), ['resume', 'changes', 'ai', 'ai'])
    console.log('✓ rail capped at four chips, signals first')
  }

  // 4. Outside a repository: no changes/PR chip, but resume survives.
  {
    const outside = mkdtempSync(join(tmpdir(), 'prompt-pilot-norepo-'))
    const { hit } = boot({ llmReply: GOOD_REPLY, cwd: outside })
    const body = await (await hit('/plugin/prompt-pilot/suggest?sessionId=s1&debug=1')).json()
    assert.deepEqual(kinds(body), ['resume', 'ai', 'ai'])
    assert.equal(body.debug.repo, undefined)
    assert.equal(body.branch, undefined)
    rmSync(outside, { recursive: true, force: true })
    console.log('✓ non-repo cwd → resume + ai only, no repository facts')
  }

  // 5. A model that answers prose instead of JSON degrades silently.
  {
    const { hit } = boot({ llmReply: 'Sure! Here are some ideas: keep going.' })
    const body = await (await hit('/plugin/prompt-pilot/suggest?sessionId=s1&debug=1')).json()
    assert.deepEqual(kinds(body), ['resume', 'changes'])
    assert.equal(body.debug.aiNote, 'empty-reply')
    assert.match(body.debug.aiRaw, /Sure!/)
    console.log('✓ prose reply → no ai chips, debug names the raw reply')
  }

  // 6. No model service at all is not an error.
  {
    const { hit } = boot({ llmReply: null })
    const body = await (await hit('/plugin/prompt-pilot/suggest?sessionId=s1&debug=1')).json()
    assert.deepEqual(kinds(body), ['resume', 'changes'])
    assert.equal(body.debug.aiNote, 'no-llm-service')
    console.log('✓ missing llm service → deterministic chips, note recorded')
  }

  // 7. Unknown session and unknown sub-path.
  {
    const { hit } = boot({ llmReply: GOOD_REPLY })
    const unknown = await (await hit('/plugin/prompt-pilot/suggest?sessionId=nope')).json()
    assert.deepEqual(unknown, { chips: [], reason: 'unknown-session' })
    const missing = await hit('/plugin/prompt-pilot/nope')
    assert.equal(missing.status, 404)
    console.log('✓ unknown session and unknown sub-path answer correctly')
  }

  // 8. The PR endpoint degrades with a named reason instead of throwing.
  {
    const { hit } = boot({ llmReply: GOOD_REPLY })
    const body = await (await hit('/plugin/prompt-pilot/pr?sessionId=s1')).json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'no-open-pull-request')
    console.log('✓ PR endpoint without an open PR → {ok:false, error:"no-open-pull-request"}')
  }

  // 9. A finished turn produces no resume chip.
  {
    EVENTS[4] = { type: 'turn/end', seq: 5, data: { turn: 2, reason: { kind: 'completed' } } }
    const { hit } = boot({ llmReply: GOOD_REPLY })
    const body = await (await hit('/plugin/prompt-pilot/suggest?sessionId=s1&ai=0')).json()
    assert.deepEqual(kinds(body), ['changes'])
    console.log('✓ completed turn → no resume chip')
  }

  // 10. A user cancel is an instruction: no Resume chip.
  {
    EVENTS[4] = { type: 'turn/end', seq: 5, data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } } }
    const { hit } = boot({ llmReply: GOOD_REPLY })
    const body = await (await hit('/plugin/prompt-pilot/suggest?sessionId=s1&ai=0')).json()
    assert.deepEqual(kinds(body), ['changes'])
    console.log('✓ user cancel → no resume chip')
  }

  // 11. A fork is deliberate: no Resume chip.
  {
    EVENTS[4] = { type: 'turn/end', seq: 5, data: { turn: 2, reason: { kind: 'forked' } } }
    const { hit } = boot({ llmReply: GOOD_REPLY })
    const body = await (await hit('/plugin/prompt-pilot/suggest?sessionId=s1&ai=0')).json()
    assert.deepEqual(kinds(body), ['changes'])
    console.log('✓ forked turn → no resume chip')
  }

  // 12. A token-limit stop is resumable and phrased as the limit.
  {
    EVENTS[4] = { type: 'turn/end', seq: 5, data: { turn: 2, reason: { kind: 'max-tokens' } } }
    const { hit } = boot({ llmReply: GOOD_REPLY })
    const body = await (await hit('/plugin/prompt-pilot/suggest?sessionId=s1&ai=0&debug=1')).json()
    assert.deepEqual(kinds(body), ['resume', 'changes'])
    assert.equal(body.chips[0].reason, 'limit')
    console.log('✓ max-tokens stop → resume with reason "limit"')
  }

  console.log('\nall host checks passed')
} finally {
  rmSync(REPO, { recursive: true, force: true })
}
