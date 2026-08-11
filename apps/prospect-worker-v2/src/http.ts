import { HttpError } from './quota.js'

export interface FetchJsonOptions extends RequestInit {
  timeoutMs?: number
  maxResponseBytes?: number
}

// Some adapters (Geoapify, Instagram) pass credentials as a query
// parameter rather than a header — see src/sources/geoapify.ts /
// instagram.ts. Error messages built from `url` are logged
// (structured logs) and persisted (prospect_jobs.last_error, readable by
// every platform role including platform_support) — so the URL must NEVER
// appear in an error/log with its secret intact. Every error path below
// goes through this redaction, never the raw url.
const SECRET_QUERY_PARAMS = ['apikey', 'access_token', 'key', 'token']

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const param of SECRET_QUERY_PARAMS) {
      for (const existingKey of [...parsed.searchParams.keys()]) {
        if (existingKey.toLowerCase() === param) {
          parsed.searchParams.set(existingKey, 'REDACTED')
        }
      }
    }
    return parsed.toString()
  } catch {
    // Not a parseable absolute URL (e.g. a relative path in a test) —
    // nothing to redact.
    return url
  }
}

/** fetch() with a hard timeout and a response-size cap — every adapter/crawler request goes through this, never a bare fetch(). Throws HttpError(statusCode) for non-2xx so src/retry.ts can classify it correctly. */
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const text = await fetchText(url, options)
  return JSON.parse(text) as T
}

export async function fetchText(url: string, options: FetchJsonOptions = {}): Promise<string> {
  const { timeoutMs = 15_000, maxResponseBytes = 5 * 1024 * 1024, ...init } = options

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // Node's fetch sends no Accept header by default, which some servers
    // (Overpass's Apache mod_negotiation among them) reject outright with
    // 406 Not Acceptable rather than a sane default. A default User-Agent
    // is equally important — several providers 403/406 a UA-less request.
    // Both are overridable per-call via options.headers.
    const headers = new Headers({ accept: '*/*', 'user-agent': 'FadeUpProspectWorker/2.0 (+https://fadeup.app)' })
    if (init.headers) {
      for (const [key, value] of new Headers(init.headers)) {
        headers.set(key, value)
      }
    }

    let response: Response
    try {
      response = await fetch(url, { ...init, headers, signal: controller.signal })
    } catch (cause) {
      // fetch()'s own thrown errors (DNS failure, aborted, connection
      // reset, ...) don't normally embed the query string, but redact
      // defensively anyway — see redactUrl()'s comment above. Preserves
      // the original error's `name` (AbortError, TypeError, ...) so
      // src/retry.ts's classifyError() still sees it — only the MESSAGE
      // is replaced.
      const message = cause instanceof Error ? cause.message : String(cause)
      const wrapped = new Error(`request to ${redactUrl(url)} failed: ${message}`, { cause })
      if (cause instanceof Error) wrapped.name = cause.name
      throw wrapped
    }

    if (!response.ok) {
      throw new HttpError(`${response.status} ${response.statusText} for ${redactUrl(url)}`, response.status)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > maxResponseBytes) {
      throw new Error(`response for ${redactUrl(url)} exceeds max size (${contentLength} > ${maxResponseBytes} bytes)`)
    }

    if (!response.body) {
      return await response.text()
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxResponseBytes) {
          await reader.cancel()
          throw new Error(`response for ${redactUrl(url)} exceeded max size while streaming (${maxResponseBytes} bytes)`)
        }
        chunks.push(value)
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8')
  } finally {
    clearTimeout(timeout)
  }
}
