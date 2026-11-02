/**
 * Эвристический скоринг вакансий по профилю пользователя.
 * Использует ту же формулу, что и SQL-функция match_score_vacancy(),
 * чтобы результаты клиентской ленты и серверного дайджеста совпадали.
 */

export type ScoredVacancy<T extends { requirements: string[] }> = T & {
  /** Балл совпадения 0..100 */
  score: number
  /** Какие именно навыки пользователя совпали с требованиями */
  matchedSkills: string[]
}

/**
 * Считает балл совпадения для одной вакансии.
 * @param userSkills Массив навыков из profiles.skills (может быть пустым/null).
 * @param vacancy Требования вакансии (объект с полем requirements: string[]).
 * @returns Новый объект вакансии с полями score и matchedSkills.
 */
export function scoreVacancy<T extends { requirements: string[] }>(
  userSkills: string[] | null | undefined,
  vacancy: T
): ScoredVacancy<T> {
  const reqs = vacancy.requirements ?? []
  
  // Защита от пустых данных: если нет требований или навыков -> балл 0.
  if (!userSkills || userSkills.length === 0 || reqs.length === 0) {
    return { ...vacancy, score: 0, matchedSkills: [] }
  }

  // Нормализуем оба списка к нижнему регистру для case-insensitive сравнения.
  // Важно: делаем копию Set, чтобы не мутировать исходный массив.
  const userSet = new Set(userSkills.map(s => s.toLowerCase().trim()))
  
  const matched: string[] = []
  for (const req of reqs) {
    const normalizedReq = req.toLowerCase().trim()
    if (userSet.has(normalizedReq)) {
      matched.push(req) // сохраняем оригинальный регистр для отображения
    }
  }

  // Формула идентична SQL: (matched / total) * 100, округление до целого.
  const score = Math.round((matched.length / reqs.length) * 100)

  return { ...vacancy, score, matchedSkills: matched }
}

/**
 * Пачковый скоринг: принимает массив вакансий и возвращает отсортированный по убыванию балла.
 * Удобно вызывать один раз при загрузке ленты, вместо N отдельных вызовов scoreVacancy().
 */
export function scoreAndSortVacancies<T extends { requirements: string[] }>(
  userSkills: string[] | null | undefined,
  vacancies: T[]
): ScoredVacancy<T>[] {
  return vacancies
    .map(v => scoreVacancy(userSkills, v))
    .sort((a, b) => b.score - a.score)
}
