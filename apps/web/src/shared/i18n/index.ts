import i18n, { initI18n } from '@/i18n'
import { resolveInitialLocale } from '@/lib/locale'
import { V2_NAMESPACE, V2_LOCALES, type V2Locale } from '@/shared/i18n/namespaces'

/**
 * PERF — chargement par locale (remplace l'import statique des DEUX langues) :
 * fr et en réunis pesaient ~38 Ko de JSON dans l'entrée consumer, payés par
 * tout le monde à chaque premier chargement. Chaque locale est désormais un
 * chunk dynamique (voir `locales/<lng>/index.ts`).
 *
 * Garanties conservées :
 *   · la locale ACTIVE est enregistrée AVANT le premier rendu (main.tsx
 *     attend `registerV2Bundles()` comme il attendait déjà `initI18n()`) —
 *     aucune clé brute au premier écran ;
 *   · l'AUTRE locale est chargée en tâche de fond immédiatement après, donc
 *     le repli en (parité fr/en vérifiée) et la bascule de langue restent
 *     disponibles quelques instants après le premier écran ;
 *   · la bascule elle-même attend `ensureV2Locale` (LanguageSwitcher), ce qui
 *     ferme la fenêtre de course si l'utilisateur bascule avant la fin du
 *     chargement de fond.
 */

const loaders: Record<V2Locale, () => Promise<{ default: Record<string, object> }>> = {
  fr: () => import('@/shared/i18n/locales/fr'),
  en: () => import('@/shared/i18n/locales/en'),
}

const pending = new Map<V2Locale, Promise<void>>()

/**
 * Charge et enregistre une locale v2 (idempotent via `pending`, une seule
 * requête par locale). PAS de raccourci `hasResourceBundle` avant l'attente
 * d'`initI18n` : i18next n'attache les fonctions de store à l'instance QUE
 * pendant `init()` — les appeler avant est un TypeError (mesuré).
 */
export function ensureV2Locale(locale: V2Locale): Promise<void> {
  let p = pending.get(locale)
  if (!p) {
    // Le téléchargement du bundle part tout de suite (parallèle d'initI18n
    // depuis main.tsx) ; l'ENREGISTREMENT, lui, attend l'init — le store
    // i18next n'existe pas avant.
    p = Promise.all([loaders[locale](), initI18n()]).then(([{ default: sections }]) => {
      if (!i18n.hasResourceBundle(locale, V2_NAMESPACE)) {
        // Each section sits under its own zone, so a full key always reads
        // `<zone>.<élément>.<variante>` — e.g. `v2:auth.login.submit`.
        i18n.addResourceBundle(locale, V2_NAMESPACE, { ...sections }, true, false)
      }
    })
    pending.set(locale, p)
  }
  return p
}

/** La locale v2 portée par une langue i18next quelconque (v2 ne parle que fr/en). */
export function toV2Locale(language: string): V2Locale {
  return language === 'fr' || language.startsWith('fr-') ? 'fr' : 'en'
}

/**
 * Enregistre le bundle v2 de la locale ACTIVE sur l'instance i18next
 * partagée (voir namespaces.ts pour le namespace unique étanche), puis lance
 * le chargement de fond de l'autre locale. À attendre avant le premier rendu.
 *
 * Idempotent, et sûr avant ou après la résolution d'`initI18n()` tant que
 * l'instance i18next existe (c'est le cas, à la portée module).
 */
export async function registerV2Bundles(): Promise<void> {
  // `resolveInitialLocale` (synchrone, localStorage/navigateur) permet de
  // lancer ce chargement EN PARALLÈLE d'`initI18n()` depuis main.tsx —
  // l'instance n'a pas encore de langue à ce moment-là.
  const active = toV2Locale(i18n.language ?? resolveInitialLocale())
  await ensureV2Locale(active)
  for (const locale of V2_LOCALES) {
    if (locale !== active) void ensureV2Locale(locale)
  }
}
