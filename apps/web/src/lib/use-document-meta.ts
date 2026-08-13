import { useEffect } from 'react'

interface DocumentMetaOptions {
  title: string
  description: string
  /**
   * Emits `<meta name="robots" content="noindex, nofollow">` for this route.
   * Use on any page that must never become indexable public content — e.g.
   * a shared Fade Passport, whose token-bearing URL is authorization in
   * itself and must not end up in a search index.
   */
  noIndex?: boolean
}

/**
 * Sets `document.title` and the `<meta name="description">` tag for the
 * current route, restoring the previous values on unmount.
 *
 * Real, honest limitation of this approach: FadeUp is a client-rendered Vite
 * SPA with no SSR/prerendering yet. This hook only ever helps two
 * things — the visible browser tab/history entry, and crawlers that execute
 * JavaScript before indexing (Google generally does). It does nothing for
 * non-JS-executing crawlers or social-media link unfurlers (Slack, iMessage,
 * X/Twitter, etc.) — those fetch the raw HTML of `index.html` and never run
 * this code, so they will always see the static base `<title>`/description/
 * Open Graph tags baked into `index.html`, never this per-route content.
 * Correct per-page Open Graph previews for unfurling would require real SSR
 * or prerendering, which isn't part of this stack.
 */
export function useDocumentMeta({ title, description, noIndex = false }: DocumentMetaOptions): void {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const createdMeta = !meta
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'description')
      document.head.appendChild(meta)
    }
    const previousDescription = meta.getAttribute('content')
    meta.setAttribute('content', description)

    let robotsMeta: HTMLMetaElement | null = null
    if (noIndex) {
      robotsMeta = document.createElement('meta')
      robotsMeta.setAttribute('name', 'robots')
      robotsMeta.setAttribute('content', 'noindex, nofollow')
      document.head.appendChild(robotsMeta)
    }

    return () => {
      document.title = previousTitle
      if (createdMeta) {
        meta.remove()
      } else if (previousDescription !== null) {
        meta.setAttribute('content', previousDescription)
      }
      robotsMeta?.remove()
    }
  }, [title, description, noIndex])
}
