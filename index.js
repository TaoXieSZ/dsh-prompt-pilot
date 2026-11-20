/**
 * Prompt Pilot — Host half.
 *
 * Two jobs:
 *  1. Turn real session/repository state into deterministic "signals" (an
 *     interrupted turn, an open pull request, a dirty worktree).
 *  2. Ask the model for a couple of short next-step prompts written against that
 *     same state.
 *
 * Both travel to the browser over one read-only HTTP resource route, so the
 * Client half never needs a generated Remote surface and never folds session
 * events itself.
 */
import { execFile } from 'node:child_process'

/** Node budget for each git/gh probe. A suggestion rail is never worth a stall. */
const PROBE_TIMEOUT_MS = 4000
/** Wall clock for one model call; the rail renders without it past this point. */
const LLM_TIMEOUT_MS = 12000
/** Signals are cheap but not free; one probe serves a burst of rail renders. */
const SIGNAL_TTL_MS = 20000
/** Model output is reused until the session log advances. */
const AI_TTL_MS = 5 * 60 * 1000
/** How many trailing session events the signal scanner reads. */
const TAIL_EVENTS = 400
/**
 * Rail capacity. Repository signals are pushed first because they name a
 * concrete object, so a busy repository still leaves room for at least one
 * model-written prompt.
 */
const MAX_CHIPS = 4

export const inject = ['webServer', 'sessions']

/**
 * Spawn one command with a hard timeout and no shell.
 * @param {string} file - executable.
 * @param {readonly string[]} args - argument vector.
 * @param {{cwd?: string, timeout?: number}} [options] - spawn options.
 * @returns {Promise<string>} trimmed stdout.
 */
function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout ?? PROBE_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout).trim())),
    )
  })
}

/**
 * Concatenate the plain-text blocks of one message body.
 * @param {unknown} content - message content blocks.
 * @returns {string} the text.
 */
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * Read the tail of one session log.
 * @param {object} session - live session.
 * @returns {readonly object[]} trailing events, oldest first.
 */
function tailEvents(session) {
  const end = Number(session.seq)
  const from = Math.max(0, end - TAIL_EVENTS)
  return session.snapshotEvents(from, end)
}

/**
 * Map a Turn end reason to the wording the rail interpolates.
 * @param {string} kind - `TurnEndReason` discriminant.
 * @param {object | undefined} reason - the abort cause, when present.
 * @returns {string | undefined} a normalized reason, or undefined when this Turn should not be offered.
 */
function resumeReason(kind, reason) {
  // A user pressing Stop is an instruction, not an accident: offering to resume
  // it would argue with the user. A fork is a deliberate branch, not a loss.
  if (kind === 'forked') return undefined
  if (kind === 'aborted' && reason?.kind === 'user') return undefined
  switch (kind) {
    case 'max-tokens': return 'limit'
    case 'interrupted': return 'interrupted'
    case 'blocked': return 'blocked'
    case 'error': return 'error'
    case 'aborted': return 'cancelled'
    default: return 'unknown'
  }
}

/**
 * Was the last Turn left unfinished — aborted, interrupted, failed, or cut off?
 * A Turn still running is in flight, not resumable.
 * @param {readonly object[]} events - session tail.
 * @returns {{resumable: boolean, reason?: string}} the turn verdict.
 */
function turnVerdict(events) {
  let lastEnd
  let lastStartSeq = -1
  for (const event of events) {
    if (event.type === 'turn/start') lastStartSeq = Number(event.seq)
    else if (event.type === 'turn/end') lastEnd = event
  }
  if (lastEnd === undefined) return { resumable: false }
  if (lastStartSeq > Number(lastEnd.seq)) return { resumable: false }
  const kind = lastEnd.data?.reason?.kind
  if (kind === undefined || kind === 'completed') return { resumable: false }
  const reason = resumeReason(kind, lastEnd.data?.reason?.reason)
  if (reason === undefined) return { resumable: false }
  return { resumable: true, reason }
}

/**
 * How many user messages the tail holds. This is the coarse "the user has said
 * something new" signal the suggestion cache keys on.
 * @param {readonly object[]} events - session tail.
 * @returns {number} the count.
 */
function userMessageCount(events) {
  let count = 0
  for (const event of events) if (event.type === 'user/message') count += 1
  return count
}

/**
 * The last few human/model exchanges, compacted for a suggestion prompt.
 * @param {readonly object[]} events - session tail.
 * @param {number} limit - maximum messages.
 * @returns {Array<{role: string, text: string}>} oldest first.
 */
function recentMessages(events, limit) {
  const out = []
  for (let index = events.length - 1; index >= 0 && out.length < limit; index -= 1) {
    const event = events[index]
    if (event.type === 'user/message') {
      const text = textOf(event.data?.content)
      if (text !== '') out.push({ role: 'user', text: text.slice(0, 1200) })
    } else if (event.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content)
      if (text !== '') out.push({ role: 'assistant', text: text.slice(0, 1200) })
    }
  }
  return out.reverse()
}

/**
 * Probe the repository behind one session.
 * @param {string | undefined} cwd - working directory.
 * @returns {Promise<{branch?: string, dirty?: string[], ahead?: number, pr?: object} | undefined>} repository facts, or undefined outside a repo.
 */
async function repoFacts(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return undefined
  let root
  try {
    root = await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel'])
  } catch {
    return undefined
  }
  const facts = { root }
  try {
    facts.branch = await run('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'])
  } catch {
    return facts
  }
  try {
    const status = await run('git', ['-C', root, 'status', '--porcelain'])
    facts.dirty = status === '' ? [] : status.split('\n').slice(0, 40)
  } catch {
    facts.dirty = []
  }
  facts.pr = await openPullRequest(root, facts.branch)
  return facts
}

/**
 * The open pull request whose head is this branch, if `gh` knows one.
 * @param {string} root - repository root.
 * @param {string} branch - current branch.
 * @returns {Promise<{number: number, title: string, url: string, base: string} | undefined>} the pull request.
 */
async function openPullRequest(root, branch) {
  if (typeof branch !== 'string' || branch === '' || branch === 'HEAD') return undefined
  try {
    const raw = await run(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json', 'number,title,url,baseRefName'],
      { cwd: root, timeout: 6000 },
    )
    const parsed = JSON.parse(raw || '[]')
    const first = Array.isArray(parsed) ? parsed[0] : undefined
    if (first === undefined) return undefined
    return {
      number: first.number,
      title: String(first.title ?? ''),
      url: String(first.url ?? ''),
      base: String(first.baseRefName ?? ''),
    }
  } catch {
    return undefined
  }
}

/**
 * Resolve an LLM route from the profile's default selection, tolerating the
 * selection shape it is read from.
 * @param {unknown} selection - `agentDefaultModel.currentSelection()`.
 * @returns {{provider: string, model: string, reasoningEffort?: string} | undefined} a usable route.
 */
function routeOf(selection) {
  if (selection === null || typeof selection !== 'object') return undefined
  const value = /** @type {Record<string, any>} */ (selection)
  const provider = typeof value.provider === 'string' ? value.provider : value.route?.provider
  const model = typeof value.model === 'string' ? value.model : (value.model?.id ?? value.model?.model ?? value.id)
  if (typeof provider !== 'string' || typeof model !== 'string') return undefined
  const effort = typeof value.reasoningEffort === 'string' ? value.reasoningEffort : undefined
  return effort === undefined ? { provider, model } : { provider, model, reasoningEffort: effort }
}

/** System prompt: one job, one shape, nothing else. */
const SUGGESTION_SYSTEM = [
  'You write the next-step chips a coding agent shows above its message box.',
  'Return ONLY a JSON object: {"suggestions":[{"label":"...","prompt":"..."}]}.',
  'Write 2 or 3 suggestions, ordered most-useful first.',
  'label: at most 5 words, imperative, no trailing period, no numbering.',
  'prompt: one or two sentences the user could send as-is; reference concrete files, commands, or findings from the context.',
  'Cover genuinely different directions; never restate what the assistant just offered.',
  'Write both fields in the same language as the most recent user message.',
].join(' ')

/**
 * Ask the model for suggestions written against this session.
 * @param {object} llm - the `llm` service.
 * @param {{provider: string, model: string, reasoningEffort?: string}} route - call route.
 * @param {string} context - rendered observation block.
 * @param {AbortSignal} signal - caller cancellation.
 * @returns {Promise<{items: Array<{label: string, prompt: string}>, raw: string}>} parsed suggestions and the raw reply.
 */
async function generateSuggestions(llm, route, context, signal) {
  const chunks = []
  let failure
  const iterator = llm.stream({
    provider: route.provider,
    model: route.model,
    system: SUGGESTION_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: context }] }],
    // A reasoning-heavy default would spend this budget before writing a word,
    // so the call asks for a plain, small reply rather than inheriting the
    // conversation's effort.
    maxTokens: 1500,
    temperature: 0.5,
    signal,
  })
  for await (const chunk of iterator) {
    if (chunk.type === 'text-delta') chunks.push(chunk.text)
    else if (chunk.type === 'finish') {
      const reason = chunk.reason
      if (reason?.kind === 'error' || reason?.kind === 'aborted') failure = reason.failure ?? { message: reason.kind }
    }
  }
  const raw = chunks.join('')
  if (failure !== undefined) throw new Error(`model call failed: ${failure.message ?? 'unknown'}`)
  return { items: parseSuggestions(raw), raw }
}

/**
 * Pull the suggestion array out of a model reply that should be JSON.
 * @param {string} raw - model output.
 * @returns {Array<{label: string, prompt: string}>} well-formed suggestions.
 */
function parseSuggestions(raw) {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = text.search(/[[{]/)
  if (start < 0) return []
  const candidate = text.slice(start)
  for (const end of [candidate.lastIndexOf('}'), candidate.lastIndexOf(']')]) {
    if (end <= 0) continue
    try {
      const parsed = JSON.parse(candidate.slice(0, end + 1))
      const list = Array.isArray(parsed) ? parsed : parsed.suggestions
      if (!Array.isArray(list)) continue
      const out = []
      for (const item of list) {
        const label = typeof item?.label === 'string' ? item.label.trim() : ''
        const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : ''
        if (label === '' || prompt === '') continue
        out.push({ label: label.slice(0, 60), prompt: prompt.slice(0, 600) })
        if (out.length === 3) break
      }
      if (out.length > 0) return out
    } catch {
      /* try the next boundary */
    }
  }
  return []
}

/** Render the observation block the model reads. */
function renderContext({ branch, facts, verdict, messages }) {
  const lines = []
  if (branch !== undefined) lines.push(`Branch: ${branch}`)
  if (facts?.pr !== undefined) {
    lines.push(`Open pull request: #${facts.pr.number} "${facts.pr.title}" (into ${facts.pr.base})`)
  }
  if (facts?.dirty !== undefined) {
    lines.push(
      facts.dirty.length === 0
        ? 'Worktree: clean'
        : `Worktree: ${facts.dirty.length} uncommitted change(s):\n${facts.dirty.slice(0, 12).join('\n')}`,
    )
  }
  if (verdict?.resumable === true) lines.push(`The previous turn ended early (${verdict.reason}).`)
  if (messages.length > 0) {
    lines.push('', 'Recent exchange (oldest first):')
    for (const message of messages) lines.push(`[${message.role}] ${message.text}`)
  }
  return lines.join('\n')
}

/**
 * Host plugin body.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 */
export function apply(ctx) {
  /** @type {Map<string, {at: number, value: unknown}>} */
  const signalCache = new Map()
  /** @type {Map<string, {at: number, value: unknown}>} */
  const aiCache = new Map()
  /** @type {Map<string, Promise<unknown>>} */
  const aiInFlight = new Map()

  /** @param {object} session - live session. */
  function workingDirectoryOf(session) {
    const fromHeader = session?.header?.cwd
    if (typeof fromHeader === 'string' && fromHeader !== '') return fromHeader
    const service = ctx.get('workingDirectory')
    if (service === undefined) return undefined
    try {
      return service.get(session)
    } catch {
      return undefined
    }
  }

  /** @param {object} session - live session. */
  async function signalsFor(session) {
    const key = String(session.id)
    const cached = signalCache.get(key)
    if (cached !== undefined && Date.now() - cached.at < SIGNAL_TTL_MS) return cached.value
    const events = tailEvents(session)
    const verdict = turnVerdict(events)
    const facts = await repoFacts(workingDirectoryOf(session))
    const value = {
      verdict,
      facts,
      messages: recentMessages(events, 6),
      userMessages: userMessageCount(events),
    }
    signalCache.set(key, { at: Date.now(), value })
    return value
  }

  /**
   * Model suggestions for this exact session state, shared across concurrent
   * rail renders and reused until the log advances.
   * @param {object} session - live session.
   * @param {{verdict: object, facts: object, messages: object[]}} signals - current signals.
   * @returns {Promise<{items: Array<{label: string, prompt: string}>, note?: string, route?: object, selection?: unknown}>}
   */
  async function suggestionsFor(session, signals) {
    const llm = ctx.get('llm')
    const defaults = ctx.get('agentDefaultModel')
    if (llm === undefined) return { items: [], note: 'no-llm-service' }
    if (defaults === undefined) return { items: [], note: 'no-default-model-service' }
    let selection
    try {
      selection = defaults.currentSelection?.()
    } catch (error) {
      return { items: [], note: `selection-failed: ${error?.message ?? error}` }
    }
    const route = routeOf(selection)
    if (route === undefined) return { items: [], note: 'unresolvable-model-route', selection }
    // Cache on what the *user* last contributed, not on the event sequence: the
    // sequence moves on every streamed chunk, which would turn one reply into a
    // model call per poll.
    const cacheKey = `${session.id}:${signals.userMessages}`
    const cached = aiCache.get(cacheKey)
    if (cached !== undefined && Date.now() - cached.at < AI_TTL_MS) return { items: cached.value, route }
    const pending = aiInFlight.get(cacheKey)
    if (pending !== undefined) return { items: await pending, route }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
    const context = renderContext({
      branch: signals.facts?.branch,
      facts: signals.facts,
      verdict: signals.verdict,
      messages: signals.messages,
    })
    const work = generateSuggestions(llm, route, context, controller.signal)
      .then((value) => {
        aiCache.set(cacheKey, { at: Date.now(), value: value.items })
        return value
      })
      .finally(() => {
        clearTimeout(timer)
        aiInFlight.delete(cacheKey)
      })
    aiInFlight.set(cacheKey, work)
    try {
      const value = await work
      return {
        items: value.items,
        route,
        ...(value.items.length === 0 ? { note: 'empty-reply', raw: value.raw.slice(0, 600) } : {}),
      }
    } catch (error) {
      const note = String(error?.message ?? error)
      ctx.logger?.warn?.('prompt-pilot: model suggestions unavailable: %s', note)
      return { items: [], note, route }
    }
  }

  /** Build the rail payload for one session. */
  async function suggest(sessionId, wantAi, wantDebug) {
    const session = ctx.sessions.get(sessionId)
    if (session === undefined) return { chips: [], reason: 'unknown-session' }
    const signals = await signalsFor(session)
    const chips = []
    if (signals.verdict.resumable === true) {
      chips.push({ id: 'resume', kind: 'resume', reason: signals.verdict.reason ?? 'unknown' })
    }
    const pr = signals.facts?.pr
    if (pr !== undefined) chips.push({ id: 'pr', kind: 'pr', pr })
    const dirty = signals.facts?.dirty ?? []
    if (dirty.length > 0) chips.push({ id: 'changes', kind: 'changes', count: dirty.length })
    let ai
    if (wantAi) {
      ai = await suggestionsFor(session, signals)
      for (const [index, item] of ai.items.entries()) {
        chips.push({ id: `ai-${index + 1}`, kind: 'ai', label: item.label, prompt: item.prompt })
      }
    }
    const payload = { chips: chips.slice(0, MAX_CHIPS), branch: signals.facts?.branch, ai: wantAi }
    if (wantDebug === true) {
      payload.debug = {
        cwd: workingDirectoryOf(session),
        repo: signals.facts?.root,
        turnReason: signals.verdict.reason,
        messages: signals.messages.length,
        aiNote: ai?.note,
        aiRaw: ai?.raw,
        route: ai?.route,
        selection: ai?.selection,
      }
    }
    return payload
  }

  /** The PR diff for the sidebar tab. */
  async function pullRequestDiff(sessionId, wanted) {
    const session = ctx.sessions.get(sessionId)
    if (session === undefined) return { ok: false, error: 'unknown-session' }
    const facts = await repoFacts(workingDirectoryOf(session))
    if (facts?.root === undefined) return { ok: false, error: 'not-a-repository' }
    const pr = facts.pr
    if (pr === undefined) return { ok: false, error: 'no-open-pull-request' }
    if (wanted !== undefined && wanted !== pr.number) return { ok: false, error: 'pull-request-changed' }
    try {
      const [diff, view] = await Promise.all([
        run('gh', ['pr', 'diff', String(pr.number)], { cwd: facts.root, timeout: 15000 }),
        run('gh', ['pr', 'view', String(pr.number), '--json', 'title,body,state,mergedAt,additions,deletions,changedFiles'], {
          cwd: facts.root,
          timeout: 8000,
        }).catch(() => '{}'),
      ])
      let meta = {}
      try {
        meta = JSON.parse(view || '{}')
      } catch {
        meta = {}
      }
      return { ok: true, pr: { ...pr, ...meta }, diff, branch: facts.branch }
    } catch (error) {
      return { ok: false, error: 'gh-failed', message: String(error?.message ?? error) }
    }
  }

  const respond = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })

  /**
   * What the browser half reports about its own render. Without browser control
   * this is the only way to tell "the rail never mounted" apart from "the rail
   * mounted and hid itself", so it is deliberately always on and bounded.
   */
  const telemetry = { requests: 0, lastPath: null, lastAt: null, pings: [] }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/plugin/prompt-pilot',
        resource: async (request) => {
          const url = new URL(request.url)
          const sessionId = url.searchParams.get('sessionId') ?? ''
          telemetry.requests += 1
          telemetry.lastPath = url.pathname
          telemetry.lastAt = Date.now()
          try {
            // A bounded, self-reported trace from the browser half.
            if (url.pathname === '/plugin/prompt-pilot/ping') {
              telemetry.pings.push({
                at: Date.now(),
                session: sessionId,
                draftLen: url.searchParams.get('draft'),
                phase: url.searchParams.get('phase'),
                chips: url.searchParams.get('chips'),
                status: url.searchParams.get('status'),
                note: url.searchParams.get('note'),
              })
              if (telemetry.pings.length > 20) telemetry.pings.shift()
              return respond({ ok: true })
            }
            if (url.pathname === '/plugin/prompt-pilot/diag') {
              return respond({
                requests: telemetry.requests,
                lastPath: telemetry.lastPath,
                lastAt: telemetry.lastAt,
                pings: telemetry.pings,
                signalsCached: [...signalCache.keys()],
                aiCached: [...aiCache.keys()],
              })
            }
            if (url.pathname === '/plugin/prompt-pilot/suggest') {
              return respond(
                await suggest(
                  sessionId,
                  url.searchParams.get('ai') !== '0',
                  url.searchParams.get('debug') === '1',
                ),
              )
            }
            if (url.pathname === '/plugin/prompt-pilot/pr') {
              const raw = url.searchParams.get('number')
              return respond(await pullRequestDiff(sessionId, raw === null ? undefined : Number(raw)))
            }
            return respond({ error: 'not-found' }, 404)
          } catch (error) {
            ctx.logger?.warn?.('prompt-pilot: request failed: %s', error?.message ?? error)
            return respond({ error: 'internal', message: String(error?.message ?? error) }, 500)
          }
        },
      }),
    'prompt-pilot: suggestion route',
  )
}
