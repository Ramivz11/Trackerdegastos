import type { CategoryRule } from '../types'

/**
 * Busca la primera regla activa cuyo patrón aparezca en el texto.
 * Las reglas vienen ordenadas por prioridad descendente desde la API.
 */
export function matchRule(
  text: string,
  rules: CategoryRule[],
): CategoryRule | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  return (
    rules.find((r) => r.is_active && r.pattern && t.includes(r.pattern.toLowerCase())) ??
    null
  )
}

/** Categoría sugerida para una descripción, o null si ninguna regla aplica. */
export function suggestCategory(
  text: string,
  rules: CategoryRule[],
): string | null {
  return matchRule(text, rules)?.category_id ?? null
}
