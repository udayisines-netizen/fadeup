import { useEffect } from 'react'

interface DocumentMetaOptions {
  title: string
  description: string
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
export function useDocumentMeta({ title, description }: DocumentMetaOptions): void {
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

    return () => {
      document.title = previousTitle
      if (createdMeta) {
        meta.remove()
      } else if (previousDescription !== null) {
        meta.setAttribute('content', previousDescription)
      }
    }
  }, [title, description])
}
