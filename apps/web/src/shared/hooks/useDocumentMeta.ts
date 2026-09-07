import { useEffect } from 'react'

export interface DocumentMetaInput {
  /** Titre complet de l'onglet (le suffixe de marque est ajouté ici). */
  title: string | null
  description?: string | null
  /** Image de partage — SEULEMENT quand elle existe réellement (loi produit). */
  image?: string | null
  url?: string | null
}

interface MetaTarget {
  attr: 'property' | 'name'
  key: string
  value: (meta: DocumentMetaInput) => string | null | undefined
}

const TARGETS: readonly MetaTarget[] = [
  { attr: 'name', key: 'description', value: (m) => m.description },
  { attr: 'property', key: 'og:title', value: (m) => m.title },
  { attr: 'property', key: 'og:description', value: (m) => m.description },
  { attr: 'property', key: 'og:image', value: (m) => m.image },
  { attr: 'property', key: 'og:url', value: (m) => m.url },
  { attr: 'name', key: 'twitter:title', value: (m) => m.title },
  { attr: 'name', key: 'twitter:description', value: (m) => m.description },
  { attr: 'name', key: 'twitter:image', value: (m) => m.image },
]

function upsertMeta(attr: 'property' | 'name', key: string, content: string): () => void {
  const selector = `meta[${attr}="${key}"]`
  const existing = document.head.querySelector<HTMLMetaElement>(selector)
  if (existing) {
    const previous = existing.getAttribute('content')
    existing.setAttribute('content', content)
    return () => {
      if (previous === null) existing.removeAttribute('content')
      else existing.setAttribute('content', previous)
    }
  }
  const created = document.createElement('meta')
  created.setAttribute(attr, key)
  created.setAttribute('content', content)
  document.head.appendChild(created)
  return () => created.remove()
}

/**
 * F2 — métadonnées de partage par écran (titre d'onglet, description, Open
 * Graph, Twitter). Restaure les valeurs de base d'index.html au démontage.
 *
 * LIMITE HONNÊTE, à connaître : cette application est une SPA sans rendu
 * serveur (non-goal MASTER_SPEC §22) ; les dérouleurs de liens qui
 * n'exécutent pas JavaScript (WhatsApp, Slack, iMessage…) ne verront QUE les
 * balises statiques d'index.html. Ce hook sert le navigateur, l'historique et
 * les robots qui exécutent JS. Servir un OG par profil aux autres exigera un
 * pré-rendu côté serveur — décision d'infrastructure hors périmètre F2,
 * consignée au rapport.
 */
export function useDocumentMeta(meta: DocumentMetaInput): void {
  const { title, description, image, url } = meta

  useEffect(() => {
    if (!title) return
    const previousTitle = document.title
    document.title = title
    const restores = TARGETS.flatMap((target) => {
      const value = target.value({ title, description, image, url })
      return value ? [upsertMeta(target.attr, target.key, value)] : []
    })
    return () => {
      document.title = previousTitle
      for (const restore of restores) restore()
    }
  }, [title, description, image, url])
}
