import { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import { getSupabase } from './lib/supabase'

/** Тип профиля строго соответствует колонкам public.profiles (Шаг 21). */
type Profile = {
  id: string
  email: string
  full_name: string | null
  city: string | null
  desired_position: string | null
  salary_expectation: number | null
  skills: string[]
}

const EMPTY_PROFILE: Omit<Profile, 'id' | 'email'> = {
  full_name: '',
  city: '',
  desired_position: '',
  salary_expectation: null,
  skills: [],
}

function Dashboard() {
  const navigate = useNavigate()
  // Четыре состояния вместо трёх: добавлено editing/loading сохранение отдельно от первичной загрузки.
  const [state, setState] = useState<'loading' | 'authed' | 'guest' | 'misconfigured'>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const sb = getSupabase()
      if (!sb) {
        if (!cancelled) setState('misconfigured')
        return
      }
      const { data: sessionData } = await sb.auth.getSession()
      if (cancelled) return
      if (!sessionData.session) {
        setState('guest')
        return
      }
      // Сессия есть -> тянем профиль. id берём из session.user.id, НЕ из отдельного запроса getUser(),
      // чтобы не делать лишний HTTP round-trip на каждый рендер дашборда.
      const userId = sessionData.session.user.id
      const { data, error } = await sb
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (cancelled) return
      if (error) {
        // PGRST116 == "no rows returned" -> профиль отсутствует (крайний случай, обычно триггер создаёт его).
        // Не считаем это фатальным: показываем пустую форму, чтобы пользователь мог заполнить данные.
        if ((error as unknown as { code?: string }).code === 'PGRST116') {
          setProfile({ id: userId, email: sessionData.session.user.email ?? '', ...EMPTY_PROFILE })
          setState('authed')
          return
        }
        setLoadError(error.message)
        setState('authed') // всё равно показываем оболочку с кнопкой «Выйти», чтобы не блокировать выход
        return
      }
      // Приводим skills к массиву строк на случай, если в БД лежит null или не-массив.
      const rawSkills = (data as Partial<Profile>).skills
      const skills = Array.isArray(rawSkills) ? (rawSkills as string[]) : []
      setProfile({
        id: (data as Profile).id,
        email: (data as Profile).email,
        full_name: (data as Profile).full_name ?? '',
        city: (data as Profile).city ?? '',
        desired_position: (data as Profile).desired_position ?? '',
        salary_expectation: (data as Profile).salary_expectation ?? null,
        skills,
      })
      setState('authed')
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
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-slate-900">Карьерный радар</h1>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white transition"
          >
            Выйти
          </button>
        </header>

        {loadError && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            Не удалось загрузить профиль: {loadError}. Можно попробовать выйти и войти снова.
          </p>
        )}

        {profile ? (
          <ProfileForm profile={profile} onSaved={setProfile} />
        ) : (
          !loadError && <p className="text-slate-500">Подготовка формы…</p>
        )}
      </div>
    </main>
  )
}

/**
 * Форма редактирования профиля.
 * - Предзаполняется данными из БД.
 * - Отправляет UPDATE только своих строк (.eq('id', profile.id)), политики RLS это пропускают.
 * - Навыки принимаются через запятую, пишутся в БД как JSON-массив строк.
 * - Пустая зарплата уходит как null, а не "" (integer-колонка не примет пустую строку).
 */
function ProfileForm({
  profile,
  onSaved,
}: {
  profile: Profile
  onSaved: (next: Profile) => void
}) {
  const [fullName, setFullName] = useState(profile.full_name ?? '')
  const [city, setCity] = useState(profile.city ?? '')
  const [position, setPosition] = useState(profile.desired_position ?? '')
  const [salary, setSalary] = useState<string>(
    profile.salary_expectation != null ? String(profile.salary_expectation) : ''
  )
  const [skillsText, setSkillsText] = useState((profile.skills ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMsg(null)

    const sb = getSupabase()
    if (!sb) {
      setMsg({ kind: 'err', text: 'Клиент Supabase не инициализирован.' })
      return
    }

    // Парсим навыки: делим по запятой, trim, фильтруем пустые, убираем дубликаты.
    const skills = Array.from(
      new Set(
        skillsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )

    // Пустая строка зарплаты -> null; иначе пробуем привести к целому числу.
    const trimmedSalary = salary.trim()
    const parsedSalary = trimmedSalary === '' ? null : Number(trimmedSalary)
    if (parsedSalary !== null && (!Number.isFinite(parsedSalary) || parsedSalary < 0)) {
      setMsg({ kind: 'err', text: 'Зарплатные ожидания должны быть неотрицательным числом.' })
      return
    }

    setBusy(true)
    try {
      const payload = {
        full_name: fullName.trim() || null,
        city: city.trim() || null,
        desired_position: position.trim() || null,
        salary_expectation: parsedSalary,
        skills,
      }
      const { data, error } = await sb
        .from('profiles')
        .update(payload)
        .eq('id', profile.id)
        .select()
        .single()

      if (error) {
        setMsg({ kind: 'err', text: error.message })
        return
      }
      // Обновляем локальное состояние тем, что реально легло в БД (включая possible null->'' нормализацию).
      const savedSkills = Array.isArray((data as Partial<Profile>).skills)
        ? ((data as Profile).skills as string[])
        : []
      onSaved({
        id: (data as Profile).id,
        email: (data as Profile).email,
        full_name: (data as Profile).full_name ?? '',
        city: (data as Profile).city ?? '',
        desired_position: (data as Profile).desired_position ?? '',
        salary_expectation: (data as Profile).salary_expectation ?? null,
        skills: savedSkills,
      })
      setMsg({ kind: 'ok', text: 'Профиль сохранён.' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Неизвестная ошибка.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white/80 backdrop-blur-sm rounded-xl border border-slate-200 shadow-md p-8 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Мой профиль</h2>
        <p className="text-sm text-slate-500 mt-1 break-all">Email: {profile.email}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Имя и фамилия">
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={busy}
            placeholder="Иван Петров"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-60"
          />
        </Field>

        <Field label="Город">
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            disabled={busy}
            placeholder="Москва"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-60"
          />
        </Field>

        <Field label="Желаемая должность">
          <input
            type="text"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            disabled={busy}
            placeholder="Frontend-разработчик"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-60"
          />
        </Field>

        <Field label="Ожидаемая зарплата (₽)">
          <input
            type="number"
            min={0}
            step={1000}
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            disabled={busy}
            placeholder="150000"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-60"
          />
        </Field>

        <Field label="Ключевые навыки (через запятую)">
          <input
            type="text"
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
            disabled={busy}
            placeholder="React, TypeScript, Node.js"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-60"
          />
        </Field>

        {msg && (
          <p
            role={msg.kind === 'err' ? 'alert' : undefined}
            className={`text-sm rounded-lg px-3 py-2 border ${
              msg.kind === 'ok'
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-red-700 bg-red-50 border-red-200'
            }`}
          >
            {msg.text}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-primary hover:bg-blue-700 text-white font-semibold py-2.5 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? 'Сохраняем…' : 'Сохранить профиль'}
        </button>
      </form>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
      {children}
    </label>
  )
}

export default function App() {
  return (
    // basename = base из vite.config.ts; держим неизменно с Шага 19.
    <Router basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </Router>
  )
}
