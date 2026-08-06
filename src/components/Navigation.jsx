import { Link, useLocation } from 'react-router-dom'

const links = [
  { to: '/', label: 'Home' },
  { to: '/analyze', label: 'Analyze' },
  { to: '/queue', label: 'Queue' },
  { to: '/history', label: 'History' },
  { to: '/dashboard', label: 'Dashboard' },
]

function Navigation() {
  const location = useLocation()
  const isActive = (path) => location.pathname === path

  return (
    <nav className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        {/* Logo — the subtitle is decorative, so it yields first when space is tight. */}
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-semibold text-white">
            R
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-900">Relay AI</div>
            <div className="hidden text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:block">
              Customer Triage
            </div>
          </div>
        </Link>

        {/* Links — scroll horizontally on narrow screens rather than pushing the
            page wider, which would make every page scroll sideways. */}
        <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              aria-current={isActive(to) ? 'page' : undefined}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive(to)
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}

export default Navigation
