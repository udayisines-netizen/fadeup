import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * F2 — twMerge doit CONNAÎTRE l'échelle typographique maison : sans cette
 * extension, `text-fu-base` est classé comme une COULEUR de texte et écrase
 * silencieusement `text-[color:var(--fu-accent-fg)]` posé avant lui — c'est
 * exactement ainsi que le CTA primaire perdait son encre sur vert (attrapé
 * par le test ProfileCtaBar, corrigé dans Button.tsx + ici).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['fu-xs', 'fu-sm', 'fu-base', 'fu-lg', 'fu-xl', 'fu-2xl', 'fu-3xl', 'fu-4xl'] }],
    },
  },
})

/** Merges class lists with Tailwind-aware conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
