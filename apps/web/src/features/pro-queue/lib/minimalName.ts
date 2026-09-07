/**
 * Minimisation B2, appliquée aussi à la face pro (F1 §4) : prénom et
 * initiale seulement. La base garde le nom complet pour l'opérationnel ;
 * l'écran n'en montre jamais plus que nécessaire. Même règle que
 * `get_public_queue_status` applique côté serveur pour le public.
 */
export function formatMinimalName(fullName: string): string {
  const trimmed = fullName.trim()
  if (trimmed === '') return ''
  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex === -1) return trimmed
  const first = trimmed.slice(0, spaceIndex)
  const rest = trimmed.slice(spaceIndex + 1).trim()
  const initial = rest.charAt(0)
  return initial ? `${first} ${initial.toLocaleUpperCase()}.` : first
}
