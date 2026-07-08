import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Accounts from './pages/Accounts'
import CardStatements from './pages/CardStatements'
import Goals from './pages/Goals'
import Recurring from './pages/Recurring'
import Reports from './pages/Reports'
import Categories from './pages/Categories'
import Settings from './pages/Settings'
import { runRecurringCatchUp } from './lib/recurring'

function Protected() {
  const { user, loading } = useAuth()

  // Al iniciar sesión, pone al día los gastos recurrentes automáticos.
  useEffect(() => {
    if (user) {
      runRecurringCatchUp(user.id).catch((e) =>
        console.error('Catch-up recurrentes falló:', e),
      )
    }
  }, [user])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Cargando…
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <DataProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="transacciones" element={<Transactions />} />
          <Route path="cuentas" element={<Accounts />} />
          <Route path="tarjetas/:id" element={<CardStatements />} />
          <Route path="metas" element={<Goals />} />
          <Route path="recurrentes" element={<Recurring />} />
          <Route path="reportes" element={<Reports />} />
          <Route path="categorias" element={<Categories />} />
          <Route path="ajustes" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DataProvider>
  )
}

function Root() {
  const { user, loading } = useAuth()
  return (
    <Routes>
      <Route
        path="/login"
        element={
          loading ? null : user ? <Navigate to="/" replace /> : <Login />
        }
      />
      <Route path="/*" element={<Protected />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </BrowserRouter>
  )
}
