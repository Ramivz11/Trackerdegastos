import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Inicio', icon: '🏠', end: true },
  { to: '/transacciones', label: 'Movimientos', icon: '🧾', end: false },
  { to: '/recurrentes', label: 'Pagos', icon: '🔔', end: false },
  { to: '/reportes', label: 'Reportes', icon: '📊', end: false },
  { to: '/ajustes', label: 'Ajustes', icon: '⚙️', end: false },
]

export default function Layout() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-md">
      <main className="safe-top px-4 pb-28 pt-4">
        <Outlet />
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md justify-around border-t border-white/5 bg-slate-900/95 backdrop-blur">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition ${
                isActive ? 'text-brand' : 'text-slate-400'
              }`
            }
          >
            <span className="text-xl">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
