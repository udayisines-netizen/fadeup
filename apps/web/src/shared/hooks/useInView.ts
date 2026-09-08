import { useCallback, useRef, useState } from 'react'

/**
 * D1 — visibilité d'un élément dans le viewport (IntersectionObserver).
 * Usage : le CTA inline du profil modèle X est LE CTA dominant tant qu'il
 * est visible ; la barre collante ne se montre qu'une fois qu'il est sorti
 * de l'écran — jamais deux verts pleins en même temps (P1 §9).
 *
 * CALLBACK ref, pas un objet ref : l'élément observé n'existe pas pendant
 * les états de chargement (rendus précoces), un effet à dépendances vides
 * ne l'observerait jamais. La callback attache/détache l'observateur au
 * moment exact où l'élément entre ou sort du DOM.
 *
 * L'état INITIAL est « visible » : au premier rendu, l'élément suivi vient
 * d'apparaître dans le document — présumer l'inverse ferait coexister la
 * paire inline ET la barre collante le temps d'un cadre (deux CTA
 * identiques dans l'arbre, l'interdit exact que ce hook sert). Sans
 * IntersectionObserver (vieux moteurs, jsdom), l'élément reste réputé
 * visible : un seul CTA, toujours.
 */
export function useInView(): [(element: Element | null) => void, boolean] {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const [inView, setInView] = useState(true)

  const ref = useCallback((element: Element | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!element || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry?.isIntersecting ?? false)
    })
    observer.observe(element)
    observerRef.current = observer
  }, [])

  return [ref, inView]
}
