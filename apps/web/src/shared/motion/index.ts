/*
 * Aides Web Animations API du système motion V2 (P1c §4) — le pendant
 * impératif de styles/motion.css, pour les mouvements qui dépendent d'une
 * MESURE (réordonnancement de liste) ou d'un déclenchement ponctuel.
 *
 * Chaque aide respecte `prefers-reduced-motion` : sous reduce, aucune
 * translation ni échelle — au mieux un fondu sous 100 ms.
 * CSS + WAAPI uniquement. Pas de Framer Motion.
 */

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function durations() {
  const styles = getComputedStyle(document.documentElement)
  return {
    instant: parseFloat(styles.getPropertyValue('--fu-dur-instant')) || 120,
    state: parseFloat(styles.getPropertyValue('--fu-dur-state')) || 220,
    surface: parseFloat(styles.getPropertyValue('--fu-dur-surface')) || 320,
    ease: styles.getPropertyValue('--fu-ease').trim() || 'cubic-bezier(0.2, 0, 0, 1)',
  }
}

/** Bascule sociale (Follow, Like) : l'objet actionné confirme d'un pop. */
export function pop(element: Element): void {
  if (prefersReducedMotion()) return
  const { state, ease } = durations()
  element.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.4 }, { transform: 'scale(1)' }],
    { duration: state, easing: ease },
  )
}

/** Mise à jour realtime : flash discret de L'ÉLÉMENT modifié, jamais de la liste. */
export function flashUpdate(element: Element): void {
  const { surface, ease } = durations()
  if (prefersReducedMotion()) {
    // Sous reduce : signal d'opacité bref, sans translation ni couleur animée.
    element.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 80, easing: 'linear' })
    return
  }
  element.animate(
    [{ backgroundColor: 'var(--fu-surface-brand)' }, { backgroundColor: 'transparent' }],
    { duration: surface, easing: ease },
  )
}

/**
 * Mouvement de file (FLIP) : après réordonnancement DOM, rejoue le
 * déplacement mesuré de l'élément modifié — et de lui seul.
 * Usage : const d = measureDelta(el) → réordonner → playReorder(el, d).
 */
export function measureTop(element: Element): number {
  return element.getBoundingClientRect().top
}

export function playReorder(element: Element, previousTop: number): void {
  if (prefersReducedMotion()) return
  const delta = previousTop - element.getBoundingClientRect().top
  if (delta === 0) return
  const { state, ease } = durations()
  element.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], {
    duration: state,
    easing: ease,
  })
}

/** Succès de réservation — LE moment orchestré de son écran (coche puis suite). */
export function celebrateSuccess(markElement: Element): void {
  if (prefersReducedMotion()) {
    markElement.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 90, easing: 'linear' })
    return
  }
  const { surface, ease } = durations()
  markElement.animate(
    [
      { opacity: 0, transform: 'scale(0.6)' },
      { transform: 'scale(1.08)', offset: 0.55 },
      { opacity: 1, transform: 'scale(1)' },
    ],
    { duration: surface, easing: ease },
  )
}
