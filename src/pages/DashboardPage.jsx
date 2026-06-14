import { useState } from 'react'

const urgencyMeta = {
  High: { dot: 'bg-rose-500', text: 'text-rose-600' },
  Medium: { dot: 'bg-amber-500', text: 'text-amber-600' },
  Low: { dot: 'bg-emerald-500', text: 'text-emerald-600' },
}

function loadDashboard() {
  const history = JSON.parse(localStorage.getItem('triageHistory') || '[]')
  const today = new Date().toDateString()
  const todayMessages = history.filter(
    (item) => new Date(item.timestamp).toDateString() === today
  )

  const highUrgency = history.filter((h) => h.urgency === 'High').length
  const totalDays = history.length > 0 ? 7 : 1

  const categories = {}
  history.forEach((item) => {
    categories[item.category] = (categories[item.category] || 0) + 1
  })

  const urgency = { High: 0, Medium: 0, Low: 0 }
  history.forEach((item) => {
    urgency[item.urgency] = (urgency[item.urgency] || 0) + 1
  })

  return {
    stats: {
      total: history.length,
      today: todayMessages.length,
      highUrgencyPercent:
        history.length > 0 ? Math.round((highUrgency / history.length) * 100) : 0,
      avgPerDay: Math.round(history.length / totalDays),
    },
    categoryData: Object.entries(categories).map(([name, count]) => ({ name, count })),
    urgencyData: urgency,
  }
}

function DashboardPage() {
  const [{ stats, categoryData, urgencyData }] = useState(loadDashboard)

  const statCards = [
    { label: 'Total messages', value: stats.total },
    { label: 'Today', value: stats.today },
    { label: 'High urgency', value: `${stats.highUrgencyPercent}%` },
    { label: 'Avg per day', value: stats.avgPerDay },
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Overview of message triage analytics.</p>
      </header>

      {/* Stat cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.label} className="surface p-5">
            <div className="text-sm text-slate-500">{card.label}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Category distribution */}
        <div className="surface p-6">
          <h2 className="mb-5 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Category distribution
          </h2>
          {categoryData.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No data yet</p>
          ) : (
            <div className="space-y-4">
              {categoryData.map((cat) => {
                const percentage = stats.total > 0 ? (cat.count / stats.total) * 100 : 0
                return (
                  <div key={cat.name}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span className="text-slate-600">{cat.name}</span>
                      <span className="tabular-nums text-slate-400">
                        {cat.count} · {percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Urgency breakdown */}
        <div className="surface p-6">
          <h2 className="mb-5 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Urgency breakdown
          </h2>
          {stats.total === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No data yet</p>
          ) : (
            <div className="space-y-1">
              {['High', 'Medium', 'Low'].map((level) => (
                <div
                  key={level}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 rounded-full ${urgencyMeta[level].dot}`} />
                    <span className="text-sm text-slate-600">{level}</span>
                  </div>
                  <span className={`text-xl font-semibold tabular-nums ${urgencyMeta[level].text}`}>
                    {urgencyData[level]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Insights */}
      {(stats.highUrgencyPercent > 30 || stats.today > 10 || stats.total === 0) && (
        <div className="surface mt-6 bg-slate-50/60 p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Insights
          </h2>
          <div className="space-y-2 text-sm text-slate-600">
            {stats.highUrgencyPercent > 30 && (
              <p>
                High urgency messages are {stats.highUrgencyPercent}% of total volume — consider
                additional support resources.
              </p>
            )}
            {stats.today > 10 && <p>High activity today with {stats.today} messages analyzed.</p>}
            {stats.total === 0 && <p>Start by analyzing some messages to see insights here.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export default DashboardPage
