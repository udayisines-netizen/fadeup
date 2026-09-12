import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * PLAT-2 — LE FORMATAGE DE LA CONSOLE, dans la langue de L'APPLICATION.
 *
 * `Number.prototype.toLocaleString()` et `Date.prototype.toLocaleString()`
 * appelés sans argument prennent la locale du NAVIGATEUR. Un interne qui a
 * choisi le japonais dans FadeUp lisait donc ses dates et ses nombres dans la
 * langue de son système — la séparation exacte que la règle de globalisation
 * du CLAUDE.md interdit, et que l'écran de modération de ce lot évitait déjà
 * seul. Ce module la ferme pour tous.
 *
 * Une valeur absente rend le tiret cadratin, jamais « Invalid Date » ni une
 * chaîne vide qui ferait croire à une donnée manquante côté serveur.
 */
export function usePlatformIntl() {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const language = i18n.language
    const parse = (value: string | null | undefined): Date | null => {
      if (!value) return null
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? null : date
    }
    return {
      /** Un nombre, groupé selon la langue de l'application. */
      number: (value: number | null | undefined): string =>
        typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(language) : '—',
      /** Une date seule. */
      date: (value: string | null | undefined): string => parse(value)?.toLocaleDateString(language) ?? '—',
      /** Une date et une heure. */
      dateTime: (value: string | null | undefined): string => parse(value)?.toLocaleString(language) ?? '—',
    }
  }, [i18n.language])
}
