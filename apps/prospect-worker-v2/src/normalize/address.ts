/** Normalizes free-text address fragments for storage/comparison: trims, collapses whitespace. Deliberately does NOT attempt full postal address parsing/validation — sources rarely agree on structure closely enough for that to be worth the complexity here. */
export function normalizeAddressLine(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  return trimmed || null
}

export function normalizeCity(raw: string | undefined | null): string | null {
  const trimmed = normalizeAddressLine(raw)
  if (!trimmed) return null
  // Title-case for consistent display (Paris, not PARIS or paris) without
  // touching diacritics — this is a display value, not a match key.
  return trimmed
    .toLowerCase()
    .split(/(\s|-)/)
    .map((part) => (part === ' ' || part === '-' ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

export function normalizePostalCode(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  return trimmed || null
}

/** Validates/normalizes an ISO 3166-1 alpha-2 country code. Returns null for anything that isn't exactly 2 letters — never guesses a country from a free-text name. */
export function normalizeCountryCode(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null
}
