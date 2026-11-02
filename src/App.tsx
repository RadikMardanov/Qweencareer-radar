import { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import { getSupabase } from './lib/supabase'

/**
 * Защищённая заглушка дашборда.
 * - loading: ждём getSession (сохранённая сессия читается из localStorage).
 * - misconfigured: env не задан -> внятный баннер, без бесконечного редиректа.
 * - guest: нет сессии -> Navigate на /login (replace, чтобы не ломать «Назад»).
 * - authed: показываем id + выход.
 */
function Dashboard() {
  const navigate = useNavigate()
  const [state, setState] = useState<'loading' | 'authed' | 'guest' | 'misconfigured'>('loading')
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const sb = getSupabase()
      if (!sb) {
        if (!cancelled) setState('misconfigured')
        return
      }
      const { data } = await sb.auth.getSession()
      if (cancelled) return
      if (data.session) {
        setUserId(data.session.user.id)
        setState('authed')
      } else {
        setState('guest')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'loading') {
    return <p className="min-h-screen grid place-items-center text-slate-500">Загрузка…</p>
  }

  if (state === 'misconfigured') {
    return (
      <main className="min-h-screen grid place-items-center bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-md w-full bg-white/80 rounded-xl border border-amber-300 shadow-sm p-6 text-center">
          <h1 className="text-xl font-bold text-slate-900 mb-2">Дашборд недоступен</h1>
          <p className="text-slate-600 text-sm">
            Не заданы переменные Supabase. Проверь Secrets и блок <code className="bg-slate-100 px-1 rounded">env:</code> в workflow.
          </p>
        </div>
      </main>
    )
  }

  if (state === 'guest') {
    return <Navigate to="/login" replace />
  }

  async function handleLogout() {
    const sb = getSupabase()
    if (sb) await sb.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <main className="min-h-screen grid place-items-center bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-md w-full bg-white/80 backdrop-blur-sm rounded-xl border border-slate-200 shadow-md p-8 space-y-4 text-center">
        <h1 className="text-2xl font-extrabold text-slate-900">Карьерный радар</h1>
        <p className="text-slate-600">
          Ты вошёл. Здесь позже появится лента вакансий и AI-дайджест.
        </p>
        <p className="text-sm text-slate-500 break-all">
          ID пользователя: <span className="font-mono text-slate-700">{userId}</span>
        </p>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded-lg border border-slate-300 py-2 font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          Выйти
        </button>
      </div>
    </main>
  )
}

export default function App() {
  return (
    // basename = base из vite.config.ts; без него роутер ищет "/" по полному
    // пути /career-radar/ и не находит -> белый экран (уже чинили, держим).
    <Router basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </Router>
  )
}
