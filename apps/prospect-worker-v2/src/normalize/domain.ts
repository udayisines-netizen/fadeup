/** Extracts and normalizes a registrable-ish domain from a URL for dedup matching: lowercase host, strips a leading www., strips port. Not full public-suffix-list-aware — good enough for "same website" matching without a heavy dependency. */
export function normalizeDomain(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  return host || null
}

/** Normalizes a URL for storage: lowercased scheme+host, preserves path/query, strips a trailing slash on a bare path. */
export function normalizeUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`)
    url.hostname = url.hostname.toLowerCase()
    let result = url.toString()
    if (result.endsWith('/') && url.pathname === '/' && !url.search && !url.hash) {
      result = result.slice(0, -1)
    }
    return result
  } catch {
    return null
  }
}
