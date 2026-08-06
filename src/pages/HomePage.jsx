import { Link, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { useLiveHistory } from '../hooks/useLiveHistory'

const urgencyBadge = {
  High: 'bg-rose-50 text-rose-700 ring-rose-600/10',
  Medium: 'bg-amber-50 text-amber-700 ring-amber-600/10',
  Low: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10',
}

function summarize(history) {
  const today = new Date().toDateString()
  const todayCount = history.filter(
    (item) => new Date(item.timestamp).toDateString() === today
  ).length

  return {
    stats: { total: history.length, today: todayCount },
    recentActivity: history.slice(-3).reverse(),
  }
}

function HomePage() {
  const navigate = useNavigate()
  const history = useLiveHistory()
  const { stats, recentActivity } = useMemo(() => summarize(history), [history])

  const tryExample = () => {
    const examples = [
      "Our payment failed and we can't access our account",
      'The dashboard is loading very slowly',
      'Can you add a dark mode feature?',
    ]
    const random = examples[Math.floor(Math.random() * examples.length)]
    // Router state rather than localStorage: the value belongs to this one
    // navigation, and a stale key can otherwise resurface on a later visit.
    navigate('/analyze', { state: { message: random } })
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      {/* Hero */}
      <header className="mb-12 max-w-2xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/10">
          AI-powered triage
        </span>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">
          Customer message triage,
          <br />
          handled for you.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-slate-500">
          Relay AI categorizes, prioritizes, and routes incoming customer messages so your team
          can handle more volume without hiring additional support staff.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/analyze" className="btn-primary">
            Analyze a message
          </Link>
          <button onClick={tryExample} className="btn-ghost">
            Try an example
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="mb-10 grid grid-cols-2 gap-4 sm:max-w-md">
        <div className="surface p-5">
          <div className="text-3xl font-semibold tracking-tight text-slate-900">{stats.total}</div>
          <div className="mt-1 text-sm text-slate-500">Total analyzed</div>
        </div>
        <div className="surface p-5">
          <div className="text-3xl font-semibold tracking-tight text-slate-900">{stats.today}</div>
          <div className="mt-1 text-sm text-slate-500">Analyzed today</div>
        </div>
      </div>

      {/* Recent activity */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Recent activity
        </h2>

        {recentActivity.length > 0 ? (
          <div className="surface divide-y divide-slate-100">
            {recentActivity.map((item, index) => (
              <Link
                key={index}
                to="/history"
                className="flex items-start justify-between gap-4 p-4 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-700">{item.message}</p>
                  <div className="mt-2 flex items-center gap-2">
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
                  </div>
                </div>
                <span className="whitespace-nowrap text-xs text-slate-400">
                  {new Date(item.timestamp).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="surface flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-sm text-slate-500">No messages analyzed yet.</p>
            <Link to="/analyze" className="btn-primary mt-4">
              Analyze your first message
            </Link>
          </div>
        )}
      </section>
    </div>
  )
}

export default HomePage
