import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import { getSupabase } from './lib/supabase'
import { scoreAndSortVacancies, type ScoredVacancy } from './services/scoring'

// ===================== ТИПЫ =====================

type Profile = {
  id: string
  email: string
  full_name: string | null
  city: string | null
  desired_position: string | null
  salary_expectation: number | null
  skills: string[]
}

type VacancyRow = {
  id: string
  external_id: string | null
  source: string
  title: string
  company: string
  city: string | null
  remote: boolean
  salary_min: number | null
  salary_max: number | null
  currency: string
  description: string
  requirements: string[]
  benefits: string[]
  url: string
  published_at: string
  fetched_at: string
  expires_at: string | null
}

const EMPTY_PROFILE: Omit<Profile, 'id' | 'email'> = {
  full_name: '',
  city: '',
  desired_position: '',
  salary_expectation: null,
  skills: [],
}

// ===================== УТИЛИТЫ ФОРМАТИРОВАНИЯ =====================

function formatSalary(min: number | null, max: number | null, currency: string): string {
  const symbol = currency === 'RUB' ? '₽' : currency
  if (min == null && max == null) return 'Зарплата не указана'
  if (min != null && max != null) return `${min.toLocaleString('ru-RU')} – ${max.toLocaleString('ru-RU')} ${symbol}`
  if (min != null) return `от ${min.toLocaleString('ru-RU')} ${symbol}`
  return `до ${(max ?? 0).toLocaleString('ru-RU')} ${symbol}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return iso
  }
}

function scoreColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500 text-white'
  if (score >= 60) return 'bg-green-500 text-white'
  if (score >= 40) return 'bg-yellow-500 text-slate-900'
  if (score >= 20) return 'bg-orange-500 text-white'
  return 'bg-red-400 text-white'
}

// ===================== КОМПОНЕНТ ДАШБОРДА =====================

function Dashboard() {
  const navigate = useNavigate()
  const [state, setState] = useState<'loading' | 'authed' | 'guest' | 'misconfigured'>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [vacancies, setVacancies] = useState<VacancyRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cityFilter, setCityFilter] = useState('')
  const [remoteOnly, setRemoteOnly] = useState(false)

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
      const uid = sessionData.session.user.id

      const [profileRes, vacanciesRes] = await Promise.all([
        sb.from('profiles').select('*').eq('id', uid).single(),
        sb.from('vacancies').select('*').order('published_at', { ascending: false }).limit(50),
      ])
      if (cancelled) return

      if (profileRes.error) {
        const code = (profileRes.error as unknown as { code?: string }).code
        if (code === 'PGRST116') {
          setProfile({ id: uid, email: sessionData.session.user.email ?? '', ...EMPTY_PROFILE })
        } else {
          setLoadError(`Не удалось загрузить профиль: ${profileRes.error.message}`)
        }
      } else {
        const p = profileRes.data as Partial<Profile>
        setProfile({
          id: uid,
          email: sessionData.session.user.email ?? '',
          full_name: p.full_name ?? '',
          city: p.city ?? '',
          desired_position: p.desired_position ?? '',
          salary_expectation: p.salary_expectation ?? null,
          skills: Array.isArray(p.skills) ? (p.skills as string[]) : [],
        })
      }

      if (vacanciesRes.error) {
        setLoadError((prev) => prev ? `${prev}\n${vacanciesRes.error!.message}` : vacanciesRes.error.message)
        setVacancies([])
      } else {
        setVacancies(((vacanciesRes.data ?? []) as VacancyRow[]))
      }

      setState('authed')
    }
    load()
    return () => { cancelled = true }
  }, [])

  // 🔑 КЛЮЧЕВАЯ ПРАВКА: useMemo ВЫНЕСЕН ВЫШЕ всех ранних возвратов.
  // Теперь он вызывается ВСЕГДА, независимо от значения state.
  // Внутри memo проверяем условия безопасности (профиль загружен? вакансии есть?),
  // но сам факт вызова хука не зависит от этих условий.
  const scoredVacancies: ScoredVacancy<VacancyRow>[] = useMemo(() => {
    if (!profile || vacancies.length === 0) return []
    const filtered = vacancies.filter((v) => {
      if (remoteOnly && !v.remote) return false
      if (cityFilter.trim()) {
        const needle = cityFilter.trim().toLowerCase()
        const matchesCity = v.city?.toLowerCase().includes(needle) ?? false
        if (!matchesCity && !v.remote) return false
      }
      return true
    })
    return scoreAndSortVacancies(profile.skills, filtered)
  }, [profile, vacancies, cityFilter, remoteOnly])

  // Все хуки уже вызваны. Дальше можно спокойно делать ранние возвраты —
  // они больше не влияют на порядок вызова хуков.
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

  const hasSkills = !!profile && profile.skills.length > 0

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
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
          <p role="alert" className="whitespace-pre-line text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {loadError}
          </p>
        )}

        {profile ? (
          <ProfileForm profile={profile} onSaved={setProfile} />
        ) : (
          !loadError && <p className="text-slate-500">Подготовка формы…</p>
        )}

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">Рекомендованные вакансии</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remoteOnly}
                  onChange={(e) => setRemoteOnly(e.target.checked)}
                  className="rounded border-slate-300 text-primary focus:ring-primary/40"
                />
                Только удалённые
              </label>
              <input
                type="text"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                placeholder="Фильтр по городу…"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary w-48"
              />
            </div>
          </div>

          {!hasSkills ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              Заполни ключевые навыки в профиле выше, чтобы получать персональные рекомендации.
            </p>
          ) : scoredVacancies.length === 0 ? (
            <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
              По текущим фильтрам вакансий не найдено. Попробуй снять ограничение по городу или удалить фильтр.
            </p>
          ) : (
            <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {scoredVacancies.map((v) => (
                <li key={v.id}>
                  <VacancyCard vacancy={v} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

// ===================== КАРТОЧКА ВАКАНСИИ =====================

function VacancyCard({ vacancy }: { vacancy: ScoredVacancy<VacancyRow> }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className="bg-white/80 backdrop-blur-sm rounded-xl border border-slate-200 shadow-md p-6 space-y-3 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900 truncate">{vacancy.title}</h3>
          <p className="text-sm text-slate-600 truncate">{vacancy.company}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${scoreColor(vacancy.score)}`}>
          {vacancy.score}%
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>{vacancy.remote ? '🌍 Удалённо' : `📍 ${vacancy.city ?? '—'}`}</span>
        <span>💰 {formatSalary(vacancy.salary_min, vacancy.salary_max, vacancy.currency)}</span>
        <span>🗓 {formatDate(vacancy.published_at)}</span>
        <span>🔗 {vacancy.source}</span>
      </div>

      {vacancy.matchedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {vacancy.matchedSkills.map((s) => (
            <span key={s} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-0.5">
              ✓ {s}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-2 space-y-2">
        <p className={`text-sm text-slate-700 ${expanded ? '' : 'line-clamp-3'}`}>{vacancy.description}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-slate-600 hover:text-primary underline-offset-2 hover:underline"
          >
            {expanded ? 'Свернуть описание' : 'Развернуть описание'}
          </button>
          <a
            href={vacancy.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-block text-xs rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50 transition"
          >
            Подробнее ↗
          </a>
          <button
            type="button"
            onClick={() => alert('Интеграция с откликами появится в Фазе 6 (Шаг 31+).')}
            className="inline-block text-xs rounded-lg bg-primary hover:bg-blue-700 text-white px-3 py-1.5 transition"
          >
            Откликнуться
          </button>
        </div>
      </div>
    </article>
  )
}

// ===================== ФОРМА ПРОФИЛЯ =====================

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: (next: Profile) => void }) {
  const [fullName, setFullName] = useState(profile.full_name ?? '')
  const [city, setCity] = useState(profile.city ?? '')
  const [position, setPosition] = useState(profile.desired_position ?? '')
  const [salary, setSalary] = useState<string>(profile.salary_expectation != null ? String(profile.salary_expectation) : '')
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
    const skills = Array.from(new Set(skillsText.split(',').map((s) => s.trim()).filter(Boolean)))
    const trimmedSalary = salary.trim()
    const parsedSalary = trimmedSalary === '' ? null : Number(trimmedSalary)
    if (parsedSalary !== null && (!Number.isFinite(parsedSalary) || parsedSalary < 0)) {
      setMsg({ kind: 'err', text: 'Зарплата должна быть неотрицательным числом.' })
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
      const { data, error } = await sb.from('profiles').update(payload).eq('id', profile.id).select().single()
      if (error) {
        setMsg({ kind: 'err', text: error.message })
        return
      }
      const savedSkills = Array.isArray((data as Partial<Profile>).skills) ? ((data as Profile).skills as string[]) : []
      onSaved({
        id: (data as Profile).id,
        email: (data as Profile).email,
        full_name: (data as Profile).full_name ?? '',
        city: (data as Profile).city ?? '',
        desired_position: (data as Profile).desired_position ?? '',
        salary_expectation: (data as Profile).salary_expectation ?? null,
        skills: savedSkills,
      })
      setMsg({ kind: 'ok', text: 'Профиль сохранён. Рекомендации обновлены.' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Неизвестная ошибка.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white/80 backdrop-blur-sm rounded-xl border border-slate-200 shadow-md p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-slate-900">Мой профиль</h2>
        <p className="text-xs text-slate-500 break-all">Email: {profile.email}</p>
      </div>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Имя и фамилия"><TextInput value={fullName} onChange={setFullName} disabled={busy} placeholder="Иван Петров" /></Field>
        <Field label="Город"><TextInput value={city} onChange={setCity} disabled={busy} placeholder="Москва" /></Field>
        <Field label="Желаемая должность"><TextInput value={position} onChange={setPosition} disabled={busy} placeholder="Frontend-разработчик" /></Field>
        <Field label="Ожидаемая зарплата (₽)"><TextInput type="number" min={0} step={1000} value={salary} onChange={setSalary} disabled={busy} placeholder="150000" /></Field>
        <div className="md:col-span-2">
          <Field label="Ключевые навыки (через запятую)">
            <TextInput value={skillsText} onChange={setSkillsText} disabled={busy} placeholder="React, TypeScript, Node.js" />
          </Field>
        </div>
        {msg && (
          <p role={msg.kind === 'err' ? 'alert' : undefined} className={`md:col-span-2 text-sm rounded-lg px-3 py-2 border ${msg.kind === 'ok' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200'}`}>
            {msg.text}
          </p>
        )}
        <div className="md:col-span-2">
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary hover:bg-blue-700 text-white font-semibold py-2.5 transition disabled:opacity-60">
            {busy ? 'Сохраняем…' : 'Сохранить профиль'}
          </button>
        </div>
      </form>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<label className="block"><span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>{children}</label>)
}

function TextInput({
  onChange,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { onChange: (v: string) => void }) {
  return (
    <input
      {...rest}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-60"
    />
  )
}

// ===================== ЭКСПОРТ ПРИЛОЖЕНИЯ =====================

export default function App() {
  return (
    <Router basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </Router>
  )
}
