window.__ModuleLoader__.load({
  id: '@local/prompt-pilot',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Locale namespace for every user-visible string this plugin owns. */
    const NS = 'promptPilot'
    /** Right-sidebar tab implementation id: the key its body and title register under. */
    const PR_TAB_ID = '@local/prompt-pilot/pr'
    /** The tab type `openTab` names. */
    const PR_TAB_KIND = 'prompt-pilot.pr'
    /** Host resource route base. */
    const BASE = '/plugin/prompt-pilot'
    /** How often the rail re-reads signals while visible. */
    const POLL_MS = 30000
    /** A diff longer than this is truncated: the panel is for reading, not archiving. */
    const DIFF_LINE_CAP = 4000
    /** Rail capacity, matching the Host's own cap; repository chips come first. */
    const MAX_CHIPS = 4

    // ---------------------------------------------------------------- copy

    const DICTS = {
      en: {
        'rail.label': 'Suggested next steps',
        'rail.refresh': 'Refresh suggestions',
        'rail.loading': 'Reading the repository…',
        'rail.empty': 'No next step found right now',
        'rail.error': 'Suggestions could not be loaded.',
        'rail.retry': 'Retry',
        'rail.insert': 'Fills the message box',
        'rail.open': 'Opens in the right sidebar',
        'resume.label': 'Resume',
        'resume.hint': 'The last turn ended early — continue it',
        'resume.reason.interrupted': 'the app restarted',
        'resume.reason.cancelled': 'you stopped it',
        'resume.reason.limit': 'the token limit',
        'resume.reason.error': 'an error',
        'resume.reason.blocked': 'a block',
        'resume.reason.unknown': 'an interruption',
        'resume.prompt':
          'The previous turn ended before it finished because of {reason}. Re-read the last exchange and continue exactly where it stopped, without redoing completed work.',
        'pr.openLabel': 'Open PR #{number} diff',
        'pr.hint': 'Open this pull request’s diff in the right sidebar',
        'changes.label': 'Review changes',
        'changes.hint': '{count} uncommitted file(s) in the worktree',
        'changes.prompt':
          'Review the {count} uncommitted change(s) in this worktree. Summarize what changed and call out anything risky before I commit.',
        'pr.title': 'PR #{number}',
        'pr.loading': 'Loading the diff…',
        'pr.reload': 'Reload',
        'pr.github': 'Open on GitHub',
        'pr.empty': 'No changes in this pull request.',
        'pr.truncated': 'Showing the first {shown} of {total} diff lines.',
        'pr.files': '{count} file(s)',
        'pr.error.no-open-pull-request': 'No open pull request for this branch.',
        'pr.error.pull-request-changed': 'This tab names a pull request that changed. Open the current one instead.',
        'pr.error.not-a-repository': 'This session is not inside a git repository.',
        'pr.error.unknown-session': 'This session is no longer live.',
        'pr.error.gh-failed': 'The GitHub CLI could not read this pull request.',
        'pr.error.generic': 'The diff is unavailable.',
        'pr.retry': 'Retry',
        'pr.openCurrent': 'Open the current pull request',
      },
      zh: {
        'rail.label': '下一步建议',
        'rail.refresh': '刷新建议',
        'rail.loading': '正在读取仓库…',
        'rail.empty': '暂时没有下一步建议',
        'rail.error': '无法加载建议。',
        'rail.retry': '重试',
        'rail.insert': '填入输入框',
        'rail.open': '在右侧边栏打开',
        'resume.label': '继续',
        'resume.hint': '上一轮提前结束，从断点继续',
        'resume.reason.interrupted': '应用重启了',
        'resume.reason.cancelled': '你手动停止了',
        'resume.reason.limit': '达到 token 上限',
        'resume.reason.error': '发生了错误',
        'resume.reason.blocked': '被阻塞',
        'resume.reason.unknown': '一次中断',
        'resume.prompt':
          '上一轮在完成前就结束了（原因：{reason}）。重新阅读最近一轮对话，从真正中断的地方继续，不要重做已经完成的部分。',
        'pr.openLabel': '打开 PR #{number} 的 diff',
        'pr.hint': '在右侧边栏打开该 PR 的 diff',
        'changes.label': '评审改动',
        'changes.hint': '工作树中有 {count} 个未提交的文件',
        'changes.prompt':
          '评审当前工作树中 {count} 个未提交的改动。总结改了什么，并在提交前指出有风险的地方。',
        'pr.title': 'PR #{number}',
        'pr.loading': '正在加载 diff…',
        'pr.reload': '重新加载',
        'pr.github': '在 GitHub 中打开',
        'pr.empty': '该 PR 没有改动。',
        'pr.truncated': '共 {total} 行 diff，仅显示前 {shown} 行。',
        'pr.files': '{count} 个文件',
        'pr.error.no-open-pull-request': '当前分支没有已开启的 PR。',
        'pr.error.pull-request-changed': '此标签页指向的 PR 已变化，请改为打开当前的 PR。',
        'pr.error.not-a-repository': '当前会话不在 git 仓库中。',
        'pr.error.unknown-session': '该会话已不再活跃。',
        'pr.error.gh-failed': 'GitHub CLI 无法读取该 PR。',
        'pr.error.generic': '无法获取 diff。',
        'pr.retry': '重试',
        'pr.openCurrent': '打开当前的 PR',
      },
      ja: {
        'rail.label': '次にできること',
        'rail.refresh': '候補を更新',
        'rail.loading': 'リポジトリを確認しています…',
        'rail.empty': '今は次の候補がありません',
        'rail.error': '候補を読み込めませんでした。',
        'rail.retry': '再試行',
        'rail.insert': '入力欄に入れる',
        'rail.open': '右サイドバーで開く',
        'resume.label': '再開',
        'resume.hint': '前のターンが途中で終わりました',
        'resume.reason.interrupted': 'アプリの再起動',
        'resume.reason.cancelled': '手動の停止',
        'resume.reason.limit': 'トークン上限',
        'resume.reason.error': 'エラー',
        'resume.reason.blocked': 'ブロック',
        'resume.reason.unknown': '中断',
        'resume.prompt':
          '前のターンは完了前に終了しました（理由：{reason}）。直前のやり取りを読み直し、完了済みの作業をやり直さずに中断点から続けてください。',
        'pr.openLabel': 'PR #{number} の diff を開く',
        'pr.hint': 'この PR の diff を右サイドバーで開く',
        'changes.label': '変更をレビュー',
        'changes.hint': '未コミットのファイルが {count} 件あります',
        'changes.prompt':
          'ワークツリーにある未コミットの変更 {count} 件をレビューしてください。何が変わったかを要約し、コミット前に危険な点を指摘してください。',
        'pr.title': 'PR #{number}',
        'pr.loading': 'diff を読み込み中…',
        'pr.reload': '再読み込み',
        'pr.github': 'GitHub で開く',
        'pr.empty': 'この PR に変更はありません。',
        'pr.truncated': '全 {total} 行のうち最初の {shown} 行を表示しています。',
        'pr.files': '{count} ファイル',
        'pr.error.no-open-pull-request': 'このブランチに開いている PR はありません。',
        'pr.error.pull-request-changed': 'このタブの PR は変わりました。現在の PR を開き直してください。',
        'pr.error.not-a-repository': 'このセッションは git リポジトリ内ではありません。',
        'pr.error.unknown-session': 'このセッションはもう有効ではありません。',
        'pr.error.gh-failed': 'GitHub CLI がこの PR を読めませんでした。',
        'pr.error.generic': 'diff を取得できません。',
        'pr.retry': '再試行',
        'pr.openCurrent': '現在の PR を開く',
      },
    }

    // -------------------------------------------------------- translate

    const listeners = new Set()
    let translate = (key) => key

    /** Point the module at the active locale and repaint every mounted surface. */
    function adoptLocale(ctx) {
      try {
        translate = ctx.locale.bind(NS)
      } catch {
        // A namespace the registry does not know yet answers raw keys rather
        // than taking the whole surface down.
        translate = (key) => key
      }
      for (const listener of listeners) listener()
    }

    /** Re-read the active translate function whenever the locale changes. */
    function useTranslate() {
      const [fn, setFn] = useState(() => translate)
      useEffect(() => {
        const listener = () => setFn(() => translate)
        listeners.add(listener)
        listener()
        return () => { listeners.delete(listener) }
      }, [])
      return fn
    }

    /** Translate one key and fill its `{placeholders}`. */
    function fmt(t, key, params) {
      const template = t(key)
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]))
    }

    // ------------------------------------------------------------ icons

    const PATHS = {
      resume: 'M3 8a5 5 0 1 0 1.6-3.7M3 2.4V6h3.6',
      pr: 'M5 3.2a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0ZM13.8 3.2a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0ZM3.6 4.6v3.2a2.4 2.4 0 0 0 2.4 2.4h3.2M12.4 4.6v6.2a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0',
      changes: 'M2.4 4.6h11.2M2.4 8h7M2.4 11.4h4.4M12.6 7.2v5.2M10 10l2.6 2.6L15.2 10',
      ai: 'M8 1.8l1.5 3.4 3.4 1.5-3.4 1.5L8 11.6 6.5 8.2 3.1 6.7l3.4-1.5zM12.6 11.2l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7z',
      refresh: 'M13.4 8a5.4 5.4 0 1 1-1.7-3.9M13.6 2.2v3.4h-3.4',
      open: 'M6.2 3.4h6.4v6.4M12.6 3.4 6.4 9.6',
    }

    /** One 16px stroke glyph in `currentColor`. */
    function Glyph({ name }) {
      return h('svg', {
        viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
      }, h('path', { d: PATHS[name] ?? PATHS.ai }))
    }

    // ----------------------------------------------------------- styles

    const CSS = `
      /* Same dock geometry as the shipped dock rows (queue, todo, goal): align
         to the composer card column and centre in the column, never full-bleed. */
      .pp-rail {
        box-sizing: border-box;
        flex: none;
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin: 0 auto;
        width: calc(
          100% -
          var(--dsh-composer-side-clearance, 0px) -
          var(--dsh-composer-side-clearance, 0px) -
          var(--dsh-composer-dock-inset, 0px) -
          var(--dsh-composer-dock-inset, 0px)
        );
        max-width: calc(
          var(--dsh-composer-card-max-width, 100%) -
          var(--dsh-composer-dock-inset, 0px) -
          var(--dsh-composer-dock-inset, 0px)
        );
      }
      .pp-chip {
        display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px 0 9px;
        border-radius: var(--dsw-radius-sm, 8px);
        border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1));
        color: var(--dsw-alias-label-secondary);
        font: inherit; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 1;
        cursor: pointer; transition: color .12s ease, border-color .12s ease, background .12s ease;
        max-width: 100%;
      }
      .pp-chip:hover {
        color: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-border-l2);
        background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
      }
      .pp-chip:focus-visible, .pp-icon-button:focus-visible, .pp-recover:focus-visible {
        outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
        outline-offset: 1px;
      }
      .pp-chip[data-tone="resume"] .pp-glyph { color: var(--dsw-alias-state-warn-primary); }
      .pp-chip[data-tone="pr"] .pp-glyph { color: var(--dsw-alias-state-success-primary); }
      .pp-chip[data-tone="changes"] .pp-glyph { color: var(--dsw-alias-label-secondary); }
      .pp-chip[data-tone="ai"] .pp-glyph { color: var(--dsw-alias-brand-primary); }
      .pp-glyph { display: inline-flex; flex: none; }
      .pp-chip-open { margin-left: -1px; opacity: .7; }
      .pp-chip[data-act="panel"]:hover .pp-chip-open { opacity: 1; }
      .pp-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 26ch; }
      .pp-rail-spacer { flex: 1 1 auto; }
      .pp-rail-status { display: flex; align-items: center; gap: 8px; flex: 1 1 auto;
        font-size: var(--dsh-content-font-size-secondary, 13px); color: var(--dsw-alias-label-secondary); }
      .pp-recover { font: inherit; font-size: inherit; padding: 0; border: 0; background: none;
        color: var(--dsw-alias-brand-primary); cursor: pointer; text-decoration: underline; }
      .pp-icon-button {
        display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
        padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer;
        color: var(--dsw-alias-label-secondary); transition: color .12s ease, background .12s ease;
      }
      .pp-icon-button:hover {
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
      }
      .pp-icon-button[aria-busy="true"] .pp-glyph { animation: pp-spin 850ms linear infinite; }
      @keyframes pp-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .pp-icon-button[aria-busy="true"] .pp-glyph { animation: none; opacity: .5; }
      }

      .pp-pr { display: flex; flex-direction: column; height: 100%; min-height: 0;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
      .pp-pr-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        min-height: 41px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex: none; }
      .pp-pr-number { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
      .pp-pr-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap; max-width: 100%; }
      .pp-pr-stat { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .pp-pr-add { color: var(--dsw-alias-state-success-primary); }
      .pp-pr-del { color: var(--dsw-alias-state-error-primary); }
      .pp-pr-head a { margin-left: auto; font-size: 12px;
        color: var(--dsw-alias-link, var(--dsw-alias-brand-primary)); text-decoration: none; }
      .pp-pr-head a:hover { text-decoration: underline; }
      .pp-pr-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px 0 18px;
        font-family: var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
        font-size: 12px; line-height: 1.55; }
      .pp-diff-file { padding: 10px 12px 4px; font-weight: 600; color: var(--dsw-alias-label-primary);
        font-family: inherit; position: sticky; top: 0; background: var(--dsw-alias-bg-base); z-index: 1; }
      .pp-diff-hunk { padding: 4px 12px; color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-2); white-space: pre; }
      .pp-diff-line { display: block; padding: 0 12px; white-space: pre; }
      .pp-diff-line[data-kind="add"] {
        background: var(--dsw-alias-file-diff-added-bg, var(--dsw-alias-code-diff-added, transparent));
      }
      .pp-diff-line[data-kind="del"] {
        background: var(--dsw-alias-file-diff-removed-bg, var(--dsw-alias-code-diff-removed, transparent));
      }
      .pp-pr-note { padding: 10px 12px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .pp-pr-empty { padding: 24px 12px; text-align: center; font-size: 12px;
        color: var(--dsw-alias-label-secondary); }
      .pp-pr-recover { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px;
        padding: 0 12px; height: 28px; border-radius: var(--dsw-radius-sm, 8px);
        border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-specific-menu, transparent);
        color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
    `

    /** Component-local stylesheet: unmounting removes it. */
    function Styles() {
      return h('style', { 'data-prompt-pilot': '' }, CSS)
    }

    // ------------------------------------------------------------ host

    /**
     * The Client context of this plugin, captured in `apply`, plus the scope
     * that resolved the right Sidebar's services. Cordis throws on
     * `ctx.sidebarRight` from a context that did not inject it, so the handle
     * always comes from that scope or from `ctx.get`.
     */
    let runtime

    /** Read one JSON body from this plugin's Host route. */
    async function getJson(path, signal) {
      const response = await fetch(path, { signal, credentials: 'same-origin', headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }

    /** The right-Sidebar navigation face, when this profile has one. */
    function sidebarOf() {
      const scope = runtime?.sidebar
      if (scope !== undefined && scope.sidebarRight !== undefined) return scope.sidebarRight
      try {
        return runtime?.ctx?.get?.('sidebarRight')
      } catch {
        return undefined
      }
    }

    /** Open the pull-request diff tab, or reveal the sidebar when the tab type is absent. */
    function openPullRequestPanel(sessionId, number) {
      const sidebar = sidebarOf()
      if (sidebar === undefined) {
        runtime?.ctx?.layout?.openRightbar(true, false)
        return
      }
      sidebar.openTab(PR_TAB_KIND, {
        ...(number === undefined ? {} : { params: { sessionId, number } }),
        revealIfOpened: true,
      })
    }

    // ------------------------------------------------------------ rail

    /** Human wording for one normalised resume reason. */
    function reasonText(t, reason) {
      const key = `resume.reason.${reason ?? 'unknown'}`
      const text = t(key)
      return text === key ? t('resume.reason.unknown') : text
    }

    /** One rail entry rendered from a Host chip descriptor. */
    function chipView(t, chip) {
      switch (chip.kind) {
        case 'resume':
          return {
            tone: 'resume', glyph: 'resume', label: t('resume.label'),
            hint: t('resume.hint'),
            act: 'insert',
            prompt: fmt(t, 'resume.prompt', { reason: reasonText(t, chip.reason) }),
          }
        case 'pr':
          return {
            tone: 'pr', glyph: 'pr',
            label: fmt(t, 'pr.openLabel', { number: chip.pr?.number ?? '?' }),
            hint: t('pr.hint'),
            act: 'panel',
            number: chip.pr?.number,
          }
        case 'changes':
          return {
            tone: 'changes', glyph: 'changes',
            label: t('changes.label'),
            hint: fmt(t, 'changes.hint', { count: chip.count ?? 0 }),
            act: 'insert',
            prompt: fmt(t, 'changes.prompt', { count: chip.count ?? 0 }),
          }
        default:
          return {
            tone: 'ai', glyph: 'ai',
            label: String(chip.label ?? '').trim() || String(chip.prompt ?? '').slice(0, 40),
            hint: String(chip.prompt ?? ''),
            act: 'insert',
            prompt: String(chip.prompt ?? ''),
          }
      }
    }

    /**
     * The suggestion rail above the composer.
     *
     * Repository chips are fetched and shown first; the model-written set is a
     * second request that appends when it lands, so an available chip never
     * waits on a model call. The rail hides while the draft has text or the
     * input is mid-submission, and refetches when a send clears the draft.
     */
    function SuggestionRail(props) {
      const localT = useTranslate()
      const t = typeof props.t === 'function' ? props.t : localT
      const sessionId = props.sessionId
      // The dock contract supplies `useInput`; a missing one must not blank the
      // whole rail, so the row degrades to "no draft, plain phase" instead.
      const useInput = props.useInput
      const draft = useInput !== undefined ? useInput((state) => state.draft) : ''
      const phase = useInput !== undefined ? useInput((state) => state.phase) : 'plain'
      // A hook that resolves before the input machine publishes gives undefined;
      // never let that reach a string method and blank the whole row.
      const draftText = typeof draft === 'string' ? draft : ''
      const phaseText = typeof phase === 'string' ? phase : 'plain'
      const [state, setState] = useState({ status: 'loading', signals: [], ai: [], pending: true })
      const [nonce, setNonce] = useState(0)
      const [busy, setBusy] = useState(false)
      // A send clears the draft: that transition is the one moment fresh
      // suggestions are definitely stale.
      const wasDrafting = useRef(false)

      useEffect(() => {
        const empty = draftText.trim() === ''
        if (wasDrafting.current && empty && phaseText === 'plain') setNonce((value) => value + 1)
        wasDrafting.current = !empty
      }, [draftText, phaseText])

      const hidden = phaseText !== 'plain' || draftText.trim() !== ''
      const draftEmpty = draftText.trim() === ''
      const query = sessionId === undefined ? undefined : `${BASE}/suggest?sessionId=${encodeURIComponent(String(sessionId))}`

      // Report what this row sees, so a "nothing appeared" report can be told
      // apart from a render that never reached the page.
      useEffect(() => {
        if (sessionId === undefined) return
        const params = new URLSearchParams({
          sessionId: String(sessionId),
          draft: String(draftText.length),
          phase: phaseText,
          chips: String(state.signals.length + state.ai.length),
          status: `${state.status}${state.pending ? '/pending' : ''}`,
        })
        void fetch(`${BASE}/ping?${params.toString()}`, { credentials: 'same-origin' }).catch(() => {})
      }, [sessionId, draftEmpty, phaseText, state.signals.length, state.ai.length, state.status, state.pending])

      // Repository signals: cheap enough to poll, and never blocked by a model.
      useEffect(() => {
        if (query === undefined) return undefined
        const controller = new AbortController()
        let timer
        let stopped = false
        const load = async (manual) => {
          if (manual) setBusy(true)
          try {
            const fast = await getJson(`${query}&ai=0`, controller.signal)
            if (controller.signal.aborted) return
            setState((prev) => ({
              status: 'ready',
              signals: Array.isArray(fast.chips) ? fast.chips : [],
              ai: prev.ai,
              pending: prev.pending,
            }))
          } catch (error) {
            if (controller.signal.aborted) return
            setState((prev) => ({ status: 'error', signals: prev.signals, ai: [], pending: false }))
          } finally {
            if (manual && !controller.signal.aborted) setBusy(false)
          }
        }
        void load(true)
        // Keep the rail live while the page is visible; a hidden tab costs nothing.
        const schedule = () => {
          timer = setTimeout(async () => {
            if (stopped) return
            if (!document.hidden) await load(false)
            if (!stopped) schedule()
          }, POLL_MS)
        }
        schedule()
        return () => {
          stopped = true
          controller.abort()
          clearTimeout(timer)
        }
      }, [query, nonce])

      // Model-written prompts: only asked for while the row is actually on
      // screen, and once per mount, refresh, or visibility change. Restarting
      // this on every signal poll would turn one reply into a model call per
      // poll and leave the row empty for half a minute.
      useEffect(() => {
        if (query === undefined || hidden) return undefined
        const controller = new AbortController()
        let cancelled = false
        setState((prev) => ({ ...prev, pending: true }))
        getJson(query, controller.signal)
          .then((full) => {
            if (cancelled || controller.signal.aborted) return
            const chips = Array.isArray(full.chips) ? full.chips : []
            setState((prev) => ({
              status: 'ready',
              signals: prev.signals,
              ai: chips.filter((chip) => chip.kind === 'ai'),
              pending: false,
            }))
          })
          .catch(() => {
            // A failed model call must not empty a row that already has signals.
            if (!cancelled) setState((prev) => ({ ...prev, pending: false }))
          })
        return () => {
          cancelled = true
          controller.abort()
        }
      }, [query, hidden, nonce])

      const chips = state.signals.concat(state.ai).slice(0, MAX_CHIPS)
      const hasRow = !hidden

      const onPick = useCallback((chip) => {
        const view = chipView(t, chip)
        if (view.act === 'panel') {
          openPullRequestPanel(sessionId, view.number)
          return
        }
        const prompt = view.prompt
        if (typeof prompt !== 'string' || prompt === '') return
        props.inputActions.setDraft(prompt)
      }, [t, sessionId, props.inputActions])

      const onRefresh = useCallback(() => setNonce((value) => value + 1), [])
      // Keeping the pointer from stealing focus lets the caret stay where it was
      // while the chip fills the draft.
      const keepFocus = useCallback((event) => event.preventDefault(), [])

      // A row the user cannot see is a row that does not exist: loading, empty
      // and failed states all render something, so the plugin never looks dead.
      const status = state.status === 'error'
        ? h('span', { className: 'pp-rail-status', role: 'status' },
          t('rail.error'),
          h('button', { className: 'pp-recover', type: 'button', onMouseDown: keepFocus, onClick: onRefresh },
            t('rail.retry')))
        : state.status === 'loading' || state.pending
          ? h('span', { className: 'pp-rail-status', role: 'status' }, t('rail.loading'))
          : h('span', { className: 'pp-rail-status', role: 'status' }, t('rail.empty'))

      return h(React.Fragment, null,
        h(Styles),
        hasRow
          ? h('div', { className: 'pp-rail', role: 'group', 'aria-label': t('rail.label'), 'aria-busy': busy ? 'true' : 'false' },
            chips.length === 0 ? status : null,
            chips.map((chip) => {
              const view = chipView(t, chip)
              const action = view.act === 'panel' ? t('rail.open') : t('rail.insert')
              return h('button', {
                key: chip.id,
                type: 'button',
                className: 'pp-chip',
                'data-tone': view.tone,
                'data-act': view.act,
                title: `${view.label} — ${view.hint}. ${action}`,
                'aria-label': `${view.label} — ${view.hint}. ${action}`,
                onMouseDown: keepFocus,
                onClick: () => onPick(chip),
              },
              h('span', { className: 'pp-glyph' }, h(Glyph, { name: view.glyph })),
              h('span', { className: 'pp-chip-label' }, view.label),
              // A panel chip does something other than fill the composer, so it
              // says so before the click rather than after.
              view.act === 'panel'
                ? h('span', { className: 'pp-glyph pp-chip-open' }, h(Glyph, { name: 'open' }))
                : null)
            }),
            h('span', { className: 'pp-rail-spacer' }),
            h('button', {
              type: 'button',
              className: 'pp-icon-button',
              'aria-busy': busy ? 'true' : 'false',
              title: t('rail.refresh'),
              'aria-label': t('rail.refresh'),
              onMouseDown: keepFocus,
              onClick: onRefresh,
            }, h('span', { className: 'pp-glyph' }, h(Glyph, { name: 'refresh' }))))
          : null)
    }

    // ------------------------------------------------------- PR panel

    /**
     * Split a unified diff into renderable rows.
     *
     * Inside a hunk, `+++`/`---` are ordinary content lines, so the file headers
     * are only recognised before the first hunk.
     * @param {string} text - `gh pr diff` output.
     */
    function parseDiff(text) {
      const rows = []
      let inHunk = false
      for (const line of text.split('\n')) {
        if (line.startsWith('diff --git ')) {
          inHunk = false
          const match = / b\/(.+)$/.exec(line)
          rows.push({ kind: 'file', text: match === null ? line : match[1] })
        } else if (line.startsWith('@@')) {
          inHunk = true
          rows.push({ kind: 'hunk', text: line })
        } else if (!inHunk) {
          if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename |old mode|new mode|Binary files|GIT binary patch)/.test(line)) continue
          if (line === '') continue
          rows.push({ kind: 'meta', text: line })
        } else if (line.startsWith('+')) rows.push({ kind: 'add', text: line })
        else if (line.startsWith('-')) rows.push({ kind: 'del', text: line })
        else rows.push({ kind: 'ctx', text: line })
      }
      return rows
    }

    /** The pull-request diff, read from the Host and rendered as a unified diff. */
    function PullRequestBody(props) {
      const localT = useTranslate()
      const t = typeof props.t === 'function' ? props.t : localT
      const sessionId = props.sessionId
      const info = props.useTabInfo()
      const params = info?.tab?.navigation?.params
      const wanted = params?.number
      const [state, setState] = useState({ status: 'loading' })
      const [nonce, setNonce] = useState(0)

      useEffect(() => {
        const controller = new AbortController()
        setState({ status: 'loading' })
        const query = new URLSearchParams({ sessionId: String(sessionId) })
        if (wanted !== undefined) query.set('number', String(wanted))
        getJson(`${BASE}/pr?${query.toString()}`, controller.signal)
          .then((body) => {
            if (controller.signal.aborted) return
            if (body?.ok !== true) {
              setState({ status: 'error', code: String(body?.error ?? 'generic') })
              return
            }
            setState({ status: 'ready', pr: body.pr ?? {}, diff: String(body.diff ?? '') })
          })
          .catch(() => {
            if (!controller.signal.aborted) setState({ status: 'error', code: 'generic' })
          })
        return () => controller.abort()
      }, [sessionId, wanted, nonce])

      const head = state.status === 'ready'
        ? h('div', { className: 'pp-pr-head' },
          h('span', { className: 'pp-pr-number' }, `#${state.pr.number ?? wanted ?? ''}`),
          h('span', { className: 'pp-pr-title' }, state.pr.title ?? ''),
          typeof state.pr.additions === 'number'
            ? h('span', { className: 'pp-pr-stat' },
              h('span', { className: 'pp-pr-add' }, `+${state.pr.additions}`), ' ',
              h('span', { className: 'pp-pr-del' }, `−${state.pr.deletions ?? 0}`))
            : null,
          typeof state.pr.changedFiles === 'number'
            ? h('span', { className: 'pp-pr-stat' }, fmt(t, 'pr.files', { count: state.pr.changedFiles }))
            : null,
          h('button', {
            type: 'button', className: 'pp-icon-button', title: t('pr.reload'), 'aria-label': t('pr.reload'),
            onClick: () => setNonce((value) => value + 1),
          }, h('span', { className: 'pp-glyph' }, h(Glyph, { name: 'refresh' }))),
          typeof state.pr.url === 'string' && state.pr.url !== ''
            ? h('a', { href: state.pr.url, target: '_blank', rel: 'noreferrer noopener' }, t('pr.github'))
            : null)
        : null

      let body
      if (state.status === 'loading') {
        body = h('div', { className: 'pp-pr-note' }, t('pr.loading'))
      } else if (state.status === 'error') {
        // An unrecognised reason falls back to the generic sentence rather than
        // surfacing a raw dictionary key.
        const specific = t(`pr.error.${state.code}`)
        const changed = state.code === 'pull-request-changed'
        body = h('div', { className: 'pp-pr-empty', role: 'status' },
          h('div', null, specific === `pr.error.${state.code}` ? t('pr.error.generic') : specific),
          h('div', null,
            h('button', {
              type: 'button',
              className: 'pp-pr-recover',
              // A stale PR number can never succeed on retry, so offer the
              // current one instead of a button that always fails.
              onClick: () => (changed
                ? openPullRequestPanel(sessionId, undefined)
                : setNonce((value) => value + 1)),
            }, changed ? t('pr.openCurrent') : t('pr.retry'))))
      } else {
        const rows = parseDiff(state.diff)
        if (rows.length === 0) {
          body = h('div', { className: 'pp-pr-empty' }, t('pr.empty'))
        } else {
          const shown = rows.slice(0, DIFF_LINE_CAP)
          body = h(React.Fragment, null,
            shown.map((row, index) => h('div', {
              key: index,
              className: row.kind === 'file' ? 'pp-diff-file' : row.kind === 'hunk' ? 'pp-diff-hunk' : 'pp-diff-line',
              'data-kind': row.kind,
            }, row.text)),
            rows.length > shown.length
              ? h('div', { className: 'pp-pr-note' },
                fmt(t, 'pr.truncated', { shown: shown.length, total: rows.length }))
              : null)
        }
      }

      return h('div', { className: 'pp-pr' },
        h(Styles),
        head,
        h('div', { className: 'pp-pr-body' }, body))
    }

    /** The tab chip's text for a pull-request diff tab. */
    function PullRequestTitle(props) {
      const localT = useTranslate()
      const t = typeof props.t === 'function' ? props.t : localT
      const info = props.useTabInfo()
      const params = info?.tab?.navigation?.params
      const number = params?.number
      return h('span', null, number === undefined ? t('pr.title').replace(' #{number}', '') : fmt(t, 'pr.title', { number }))
    }

    // ---------------------------------------------------------- apply

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        runtime = { ctx }
        // Module-generation probe: proves which build the browser actually
        // loaded, which the slot registration alone cannot tell apart.
        void fetch(`${BASE}/ping?note=apply&status=module`, { credentials: 'same-origin' }).catch(() => {})
        // Register the dictionaries before binding them: `bind` on a namespace
        // this plugin never registered would leave `t` answering raw keys.
        ctx.effect(() => ctx.locale.register(NS, DICTS), 'prompt-pilot: dictionaries')
        adoptLocale(ctx)
        ctx.effect(() => ctx.on('locale/change', () => adoptLocale(ctx)), 'prompt-pilot: locale follow')
        ctx.effect(
          () => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
            name: 'conversation.input.dock', id: 'prompt-pilot', order: 15, locale: NS,
          }, SuggestionRail)),
          'prompt-pilot: suggestion rail',
        )
        // The diff panel needs the right Sidebar's tab registry; without it the
        // rail still works and its PR chip falls back to revealing the sidebar.
        ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope) => {
          runtime.sidebar = scope
          scope.effect(() => scope.sidebarRightTabs.register({
            id: PR_TAB_ID,
            kind: PR_TAB_KIND,
            title: () => translate('pr.title').replace(' #{number}', ''),
          }), 'prompt-pilot: PR tab type')
          scope.effect(
            () => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
              name: 'sidebar.right.pane.tab', key: PR_TAB_ID, locale: NS,
            }, PullRequestBody)),
            'prompt-pilot: PR tab body',
          )
          scope.effect(
            () => scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
              name: 'sidebar.right.pane.tab.title', key: PR_TAB_ID, locale: NS,
            }, PullRequestTitle)),
            'prompt-pilot: PR tab title',
          )
        })
      },
    }
  },
})
