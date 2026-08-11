const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

/** Normalizes and validates an email address: trims, lowercases. Returns null for anything that doesn't look like a real address rather than storing garbage. */
export function normalizeEmail(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null
}

/** Normalizes a social handle: strips a leading @ and any full URL prefix, lowercases. */
export function normalizeSocialHandle(raw: string | undefined | null): string | null {
  if (!raw) return null
  let s = raw.trim()
  if (!s) return null

  const urlMatch = s.match(/(?:instagram|tiktok|facebook|twitter|x)\.com\/(?:@)?([a-zA-Z0-9_.]+)/i)
  if (urlMatch?.[1]) {
    s = urlMatch[1]
  } else {
    s = s.replace(/^@/, '')
  }

  s = s.toLowerCase().replace(/\/$/, '')
  return s || null
}
