import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * X1 — le contrat qui compte est négatif : sans DSN, rien ne part ; avec DSN,
 * aucune PII ne survit à beforeSend/beforeBreadcrumb. Le SDK est mocké — le
 * test verrouille NOTRE configuration, l'envoi réel a été vérifié une fois
 * contre un puits local (rapport X1).
 */

const init = vi.fn()
const captureException = vi.fn()
vi.mock('@sentry/react', () => ({ init, captureException }))

async function freshModule() {
  vi.resetModules()
  return import('./errorReporting')
}

beforeEach(() => {
  init.mockClear()
  captureException.mockClear()
  vi.unstubAllEnvs()
})

describe('sans DSN', () => {
  it('init et report sont des no-op', async () => {
    const mod = await freshModule()
    mod.initErrorReporting()
    mod.reportError(new Error('x'), 'error-boundary')
    await vi.waitFor(() => expect(init).not.toHaveBeenCalled())
    expect(captureException).not.toHaveBeenCalled()
  })
})

describe('avec DSN', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@example.ingest.sentry.io/1')
  })

  it('charge le SDK et rejoue les erreurs signalées avant la fin du chargement', async () => {
    const mod = await freshModule()
    const boom = new Error('early')
    mod.reportError(boom, 'mutation')
    mod.initErrorReporting()
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(boom, { tags: { fadeup_context: 'mutation' } }),
    )
  })

  it('beforeSend supprime identité, en-têtes, cookies et query string', async () => {
    const mod = await freshModule()
    mod.initErrorReporting()
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce())
    const options = init.mock.calls[0]![0]
    expect(options.sendDefaultPii).toBe(false)
    expect(options.tracesSampleRate).toBe(0)
    const event = options.beforeSend({
      user: { email: 'leak@example.com' },
      request: {
        url: 'https://fade-up.com/auth/callback?email=leak@example.com#access_token=SECRET',
        headers: { Authorization: 'Bearer x' },
        cookies: 'sb=x',
        data: { phone: '0612345678' },
        query_string: 'email=leak@example.com',
      },
    })
    expect(event.user).toBeUndefined()
    expect(event.request.url).toBe('https://fade-up.com/auth/callback')
    expect(event.request.headers).toBeUndefined()
    expect(event.request.cookies).toBeUndefined()
    expect(event.request.data).toBeUndefined()
    expect(event.request.query_string).toBeUndefined()
  })

  it('beforeBreadcrumb jette la console et tronque les URL', async () => {
    const mod = await freshModule()
    mod.initErrorReporting()
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce())
    const options = init.mock.calls[0]![0]
    expect(options.beforeBreadcrumb({ category: 'console', message: 'leak@example.com' })).toBeNull()
    const crumb = options.beforeBreadcrumb({
      category: 'fetch',
      data: { url: 'https://api/rest/v1/rpc/x?email=eq.leak@example.com', from: '/a?t=1', to: '/b#h' },
    })
    expect(crumb.data.url).toBe('https://api/rest/v1/rpc/x')
    expect(crumb.data.from).toBe('/a')
    expect(crumb.data.to).toBe('/b')
  })
})
