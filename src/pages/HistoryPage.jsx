import { useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { loadHistory, clearHistory as clearStoredHistory } from '../utils/history'

const urgencyBadge = {
  High: 'bg-rose-50 text-rose-700 ring-rose-600/10',
  Medium: 'bg-amber-50 text-amber-700 ring-amber-600/10',
  Low: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10',
}

const CSV_COLUMNS = [
  'timestamp',
  'category',
  'urgency',
  'sentiment',
  'team',
  'confidence',
  'language',
  'tags',
  'message',
  'summary',
  'recommendedAction',
]

function toCsv(rows) {
  const escape = (value) => {
    const str = Array.isArray(value) ? value.join('; ') : String(value ?? '')
    return `"${str.replace(/"/g, '""')}"`
  }
  const header = CSV_COLUMNS.join(',')
  const body = rows.map((row) => CSV_COLUMNS.map((col) => escape(row[col])).join(','))
  return [header, ...body].join('\n')
}

function HistoryPage() {
  const [history, setHistory] = useState(loadHistory)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedKey, setExpandedKey] = useState(null)

  const clearHistory = () => {
    if (window.confirm('Clear all analysis history? This cannot be undone.')) {
      clearStoredHistory()
      setHistory([])
    }
  }

  const exportCsv = () => {
    const csv = toCsv([...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)))
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `triage-history-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Newest first.
  const sortedHistory = [...history].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  )

  const query = search.trim().toLowerCase()
  const filteredHistory = sortedHistory.filter((item) => {
    if (filter !== 'all' && item.category !== filter) return false
    if (!query) return true
    const haystack = [item.message, item.summary, item.category, (item.tags || []).join(' ')]
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })

  const categories = [...new Set(history.map((item) => item.category))]

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">History</h1>
          <p className="mt-1 text-sm text-slate-500">Review and manage past analyses.</p>
        </div>
        {history.length > 0 && (
          <div className="flex gap-2">
            <button onClick={exportCsv} className="btn-ghost">
              Export CSV
            </button>
            <button
              onClick={clearHistory}
              className="btn-ghost text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            >
              Clear all
            </button>
          </div>
        )}
      </header>

      {history.length > 0 && (
        <>
          {/* Search */}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages, summaries, tags…"
            className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />

          {/* Filters */}
          <div className="mb-6 flex flex-wrap gap-2">
            {[{ name: 'all', count: history.length }, ...categories.map((c) => ({
              name: c,
              count: history.filter((h) => h.category === c).length,
            }))].map((tab) => (
              <button
                key={tab.name}
                onClick={() => setFilter(tab.name)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === tab.name
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {tab.name === 'all' ? 'All' : tab.name} ({tab.count})
              </button>
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {filteredHistory.length === 0 ? (
        <div className="surface flex flex-col items-center justify-center px-6 py-20 text-center">
          <p className="text-sm text-slate-500">
            {history.length === 0 ? 'No history yet.' : 'No matches for your search.'}
          </p>
          {history.length === 0 && (
            <Link to="/analyze" className="btn-primary mt-4">
              Analyze a message
            </Link>
          )}
        </div>
      ) : (
        <div className="stagger space-y-3">
          {filteredHistory.map((item) => {
            // Keyed by identity, not array position: filtering or searching
            // reorders the list, and a positional key would leave a different
            // row expanded than the one that was clicked.
            const key = `${item.timestamp}-${item.message.slice(0, 32)}`
            const isOpen = expandedKey === key
            return (
              <div key={key} className="surface overflow-hidden">
                <button
                  className="flex w-full items-start justify-between gap-4 p-4 text-left transition-colors hover:bg-slate-50"
                  aria-expanded={isOpen}
                  onClick={() => setExpandedKey(isOpen ? null : key)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-400">
                      {new Date(item.timestamp).toLocaleString()}
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-slate-800">
                      {item.summary || item.message}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {item.category}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          urgencyBadge[item.urgency] || urgencyBadge.Low
                        }`}
                      >
                        {item.urgency}
                      </span>
                      {item.team && (
                        <span className="rounded-md bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
                          → {item.team}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`mt-1 text-slate-300 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    ▾
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 p-4">
                    <div>
                      <div className="mb-1.5 text-xs font-medium text-slate-400">Full message</div>
                      <p className="rounded-lg bg-white p-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
                        {item.message}
                      </p>
                    </div>

                    {(item.sentiment || item.tags?.length > 0) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {item.sentiment && (
                          <span className="rounded-md bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                            {item.sentiment}
                          </span>
                        )}
                        {(item.tags || []).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md bg-white px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div>
                      <div className="mb-1.5 text-xs font-medium text-slate-400">Recommended action</div>
                      <p className="rounded-lg bg-white p-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
                        {item.recommendedAction}
                      </p>
                    </div>

                    {item.suggestedReply && (
                      <div>
                        <div className="mb-1.5 text-xs font-medium text-slate-400">Suggested reply</div>
                        <p className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
                          {item.suggestedReply}
                        </p>
                      </div>
                    )}

                    <div>
                      <div className="mb-1.5 text-xs font-medium text-slate-400">AI reasoning</div>
                      <div className="prose prose-sm max-w-none rounded-lg bg-white p-3 text-slate-700 ring-1 ring-inset ring-slate-200 prose-p:my-1">
                        <ReactMarkdown>{item.reasoning}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default HistoryPage
