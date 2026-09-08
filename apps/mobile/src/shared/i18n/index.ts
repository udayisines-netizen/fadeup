import AsyncStorage from '@react-native-async-storage/async-storage'
import { getLocales } from 'expo-localization'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import frCommon from './locales/fr/common.json'
import frAuth from './locales/fr/auth.json'
import frNav from './locales/fr/nav.json'
import frErrors from './locales/fr/errors.json'
import frStates from './locales/fr/states.json'
import frEmpty from './locales/fr/empty.json'
import frQueue from './locales/fr/queue.json'
import frProfile from './locales/fr/profile.json'
import frDiscovery from './locales/fr/discovery.json'
import frHome from './locales/fr/home.json'
import frBooking from './locales/fr/booking.json'
import frMobile from './locales/fr/mobile.json'
import enCommon from './locales/en/common.json'
import enAuth from './locales/en/auth.json'
import enNav from './locales/en/nav.json'
import enErrors from './locales/en/errors.json'
import enStates from './locales/en/states.json'
import enEmpty from './locales/en/empty.json'
import enQueue from './locales/en/queue.json'
import enProfile from './locales/en/profile.json'
import enDiscovery from './locales/en/discovery.json'
import enHome from './locales/en/home.json'
import enBooking from './locales/en/booking.json'
import enMobile from './locales/en/mobile.json'

/**
 * i18n mobile — MÊME espace de noms `v2` et MÊMES sections que le web (les
 * catalogues sont copiés verbatim, garde anti-dérive dans scripts/) ; le
 * mobile AJOUTE sa section `mobile` (onboarding, onglets en attente) sans
 * jamais modifier une section web.
 *
 * Sélection de langue (globalisation, CLAUDE.md) :
 *   1. choix explicite persistant (AsyncStorage) s'il existe ;
 *   2. sinon la langue de l'appareil (expo-localization) ;
 *   3. repli `en`. Le lancement n'expose que fr/en (contrainte
 *      `profiles_locale_valid` en autorise dix — moteur préservé).
 *
 * La section web `demo` n'est pas embarquée : la route /demo est un shell de
 * composition web, sans équivalent mobile.
 */

export const V2_NAMESPACE = 'v2' as const
export const V2_LOCALES = ['fr', 'en'] as const
export type V2Locale = (typeof V2_LOCALES)[number]

const OVERRIDE_KEY = 'fu.locale.override.v1'

const BUNDLES: Record<V2Locale, object> = {
  fr: {
    common: frCommon,
    auth: frAuth,
    nav: frNav,
    errors: frErrors,
    states: frStates,
    empty: frEmpty,
    queue: frQueue,
    profile: frProfile,
    discovery: frDiscovery,
    home: frHome,
    booking: frBooking,
    mobile: frMobile,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    nav: enNav,
    errors: enErrors,
    states: enStates,
    empty: enEmpty,
    queue: enQueue,
    profile: enProfile,
    discovery: enDiscovery,
    home: enHome,
    booking: enBooking,
    mobile: enMobile,
  },
}

function deviceLocale(): V2Locale {
  const tags = getLocales()
  for (const tag of tags) {
    const lang = tag.languageCode?.toLowerCase()
    if (lang === 'fr' || lang === 'en') return lang
  }
  return 'en'
}

let initialized = false

/** Initialise i18next de façon SYNCHRONE (langue appareil), puis applique
 *  l'override persisté dès qu'AsyncStorage répond — pas d'écran d'attente. */
export function initI18n(): typeof i18n {
  if (initialized) return i18n
  initialized = true

  void i18n.use(initReactI18next).init({
    resources: {
      fr: { [V2_NAMESPACE]: BUNDLES.fr },
      en: { [V2_NAMESPACE]: BUNDLES.en },
    },
    lng: deviceLocale(),
    fallbackLng: 'en',
    defaultNS: V2_NAMESPACE,
    ns: [V2_NAMESPACE],
    interpolation: { escapeValue: false },
    returnNull: false,
  })

  // Le rendu statique web d'Expo (router-server) exécute ce module sous
  // Node, où le backend web d'AsyncStorage attend `window`. La sortie web
  // n'est qu'un véhicule de QA — l'override ne s'applique qu'à l'exécution.
  if (typeof window !== 'undefined') {
    void AsyncStorage.getItem(OVERRIDE_KEY).then((stored) => {
      if (stored === 'fr' || stored === 'en') {
        if (stored !== i18n.language) void i18n.changeLanguage(stored)
      }
    })
  }

  return i18n
}

/** Choix de langue explicite — persisté, prime sur la langue de l'appareil. */
export async function setLocaleOverride(locale: V2Locale): Promise<void> {
  await i18n.changeLanguage(locale)
  try {
    await AsyncStorage.setItem(OVERRIDE_KEY, locale)
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
}
