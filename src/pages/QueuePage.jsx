import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { triageMessage, runPooled, splitMessages, parseImportedJson } from '../utils/triage'
import { appendHistory } from '../utils/history'
import AutoTextarea from '../components/AutoTextarea'

const URGENCY_ORDER = ['High', 'Medium', 'Low']

const groupStyles = {
  High: { dot: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700 ring-rose-600/20' },
  Medium: { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  Low: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
}

// How many analyses run at once. Kept low because free-tier keys rate limit
// aggressively; requestTriage retries the 429s that still get through.
const CONCURRENCY = 2

function QueuePage() {
  const [input, setInput] = useState('')
  const [items, setItems] = useState([])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState('')
  const [saveNote, setSaveNote] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [collapsedGroups, setCollapsedGroups] = useState({})

  // Read synchronously inside the worker loop so Cancel takes effect on the very
  // next item rather than after the whole batch drains.
  const stopRef = useRef(false)
  const fileRef = useRef(null)

  const pending = splitMessages(input)
  const done = items.filter((item) => item.status === 'done')
  const progress = items.length > 0 ? Math.round((done.length / items.length) * 100) : 0

  const run = async (messages) => {
    if (messages.length === 0) {
      setError('Paste at least one message, or import a JSON file.')
      return
    }

    setError('')
    setSaveNote('')
    setExpandedId(null)
    stopRef.current = false
    setIsRunning(true)

    const queued = messages.map((message, index) => ({
      id: `${Date.now()}-${index}`,
      message,
      status: 'pending',
      result: null,
    }))
    setItems(queued)

    const completed = []
    await runPooled(
      queued,
      async (item) => {
        setItems((prev) =>
          prev.map((row) => (row.id === item.id ? { ...row, status: 'running' } : row))
        )
        const result = await triageMessage(item.message)
        completed.push(result)
        setItems((prev) =>
          prev.map((row) => (row.id === item.id ? { ...row, status: 'done', result } : row))
        )
        return result
      },
      { limit: CONCURRENCY, shouldStop: () => stopRef.current }
    )

    // Persist whatever finished, including after a cancel — work already paid
    // for should not be thrown away.
    const { saved, error: saveError, dropped, replaced } = appendHistory(completed)
    if (!saved) {
      setSaveNote(`Analyzed ${completed.length}, but saving to history failed: ${saveError}`)
    } else if (completed.length > 0) {
      setSaveNote(
        `Saved ${completed.length} ${completed.length === 1 ? 'analysis' : 'analyses'} to History.` +
          (replaced > 0 ? ` Replaced ${replaced} earlier ${replaced === 1 ? 'analysis' : 'analyses'} of the same messages.` : '') +
          (dropped > 0 ? ` Trimmed ${dropped} of the oldest to stay within browser storage.` : '')
      )
    }

    setIsRunning(false)
  }

  const handleImport = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const messages = parseImportedJson(await file.text())
      setInput(messages.join('\n\n'))
      setError('')
    } catch (err) {
      setError(`Could not read ${file.name}: ${err.message}`)
    } finally {
      // Allow re-importing the same file.
      event.target.value = ''
    }
  }

  const reset = () => {
    setInput('')
    setItems([])
    setError('')
    setSaveNote('')
    setExpandedId(null)
  }

  // Completed rows, bucketed by urgency and ordered worst-first within each
  // bucket — the queue exists to answer "what do I pick up next".
  const grouped = URGENCY_ORDER.map((level) => ({
    level,
    rows: done
      .filter((item) => item.result.urgency === level)
      .sort((a, b) => (b.result.urgencyDetail?.score ?? 0) - (a.result.urgencyDetail?.score ?? 0)),
  }))

  const fallbackCount = done.filter((item) => item.result.source === 'mock').length

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Triage queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Analyze a batch of messages at once and work them worst-first.
        </p>
      </header>

      {/* Input */}
      <div className="surface p-5">
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="batch" className="text-sm font-medium text-slate-700">
            Customer messages
          </label>
          <span className="text-xs tabular-nums text-slate-400">
            {pending.length} {pending.length === 1 ? 'message' : 'messages'}
          </span>
        </div>
        <AutoTextarea
          id="batch"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'Paste messages, separated by a blank line…\n\nOur production server is down\n\nHow do I download my invoice?'}
          minHeight={192}
          disabled={isRunning}
        />

        {error && (
          <p role="alert" className="mt-2 text-sm text-rose-600">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isRunning ? (
            <button onClick={() => (stopRef.current = true)} className="btn-ghost flex-1">
              Cancel
            </button>
          ) : (
            <button onClick={() => run(pending)} className="btn-primary flex-1">
              Analyze {pending.length > 0 ? `${pending.length} ` : ''}
              {pending.length === 1 ? 'message' : 'messages'}
            </button>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isRunning}
            className="btn-ghost"
          >
            Import JSON
          </button>
          <button onClick={reset} disabled={isRunning} className="btn-ghost">
            Clear
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            className="hidden"
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Separate messages with a blank line. JSON import accepts an array of strings, or objects
          with a <code className="font-sans">message</code> field.
        </p>
      </div>

      {/* Progress */}
      {items.length > 0 && (
        <div className="surface mt-6 p-5" aria-live="polite">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">
              {isRunning ? 'Analyzing…' : 'Complete'}
            </span>
            <span className="tabular-nums text-slate-500">
              {done.length}/{items.length} analyzed
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          {saveNote && <p className="mt-3 text-xs text-slate-500">{saveNote}</p>}

          {fallbackCount > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-600/10">
              {fallbackCount} of {done.length} used the offline keyword fallback — the AI service
              was unavailable or rate limited for those. They are marked below.
            </p>
          )}
        </div>
      )}

      {/* Results, worst first */}
      {done.length > 0 && (
        <div className="stagger mt-6 space-y-4">
          {grouped.map(({ level, rows }) => {
            if (rows.length === 0) return null
            const isCollapsed = collapsedGroups[level]
            return (
              <section key={level} className="surface overflow-hidden">
                <button
                  onClick={() =>
                    setCollapsedGroups((prev) => ({ ...prev, [level]: !prev[level] }))
                  }
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 rounded-full ${groupStyles[level].dot}`} />
                    <span className="text-sm font-semibold text-slate-800">{level} urgency</span>
                    <span className="text-sm tabular-nums text-slate-400">{rows.length}</span>
                  </span>
                  <span
                    className={`text-slate-300 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                  >
                    ▾
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="stagger divide-y divide-slate-100 border-t border-slate-100">
                    {rows.map((item) => {
                      const r = item.result
                      const isOpen = expandedId === item.id
                      return (
                        <div key={item.id}>
                          <button
                            onClick={() => setExpandedId(isOpen ? null : item.id)}
                            aria-expanded={isOpen}
                            className="flex w-full items-start justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-slate-50"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-800">
                                {r.summary || r.message}
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                  {r.category}
                                </span>
                                <span className="rounded-md bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
                                  → {r.team}
                                </span>
                                <span className="text-xs tabular-nums text-slate-400">
                                  {r.urgencyDetail?.score}/100
                                </span>
                                {r.urgencyDetail?.divergent && (
                                  <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/10">
                                    signals disagree
                                  </span>
                                )}
                                {r.source === 'mock' && (
                                  <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/10">
                                    offline fallback
                                  </span>
                                )}
                              </div>
                            </div>
                            <span
                              className={`mt-1 text-slate-300 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                            >
                              ▾
                            </span>
                          </button>

                          {isOpen && (
                            <div className="space-y-4 bg-slate-50/50 px-5 py-4">
                              <div>
                                <div className="mb-1.5 text-xs font-medium text-slate-400">
                                  Full message
                                </div>
                                <p className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
                                  {r.message}
                                </p>
                              </div>
                              <div>
                                <div className="mb-1.5 text-xs font-medium text-slate-400">
                                  Recommended action
                                </div>
                                <p className="rounded-lg bg-white p-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
                                  {r.recommendedAction}
                                </p>
                              </div>
                              {r.suggestedReply && (
                                <div>
                                  <div className="mb-1.5 flex items-center justify-between">
                                    <span className="text-xs font-medium text-slate-400">
                                      Suggested reply
                                    </span>
                                    <button
                                      onClick={() => navigator.clipboard.writeText(r.suggestedReply)}
                                      className="btn-ghost px-3 py-1 text-xs"
                                    >
                                      Copy reply
                                    </button>
                                  </div>
                                  <p className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
                                    {r.suggestedReply}
                                  </p>
                                </div>
                              )}
                              <div>
                                <div className="mb-1.5 text-xs font-medium text-slate-400">
                                  AI reasoning
                                </div>
                                <div className="prose prose-sm max-w-none rounded-lg bg-white p-3 text-slate-700 ring-1 ring-inset ring-slate-200 prose-p:my-1">
                                  <ReactMarkdown>{r.reasoning}</ReactMarkdown>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default QueuePage
