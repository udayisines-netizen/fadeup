import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { SUPPORTED_LOCALES, resolveInitialLocale, isRtl } from '@/lib/locale'

/**
 * Namespaces are organized by product domain (common, marketing, auth,
 * platform, owner, barber, customer, booking, queue, legal, ...) per the
 * FADEUP master prompt — never one giant translation file. Only `common`
 * exists so far (shared nav/footer/theme/language chrome); further
 * namespaces are added alongside the UI they translate as each area is
 * localized, not created empty ahead of time.
 */
const resources = {
  en: { common: () => import('@/locales/en/common.json') },
  fr: { common: () => import('@/locales/fr/common.json') },
  es: { common: () => import('@/locales/es/common.json') },
  de: { common: () => import('@/locales/de/common.json') },
  it: { common: () => import('@/locales/it/common.json') },
  pt: { common: () => import('@/locales/pt/common.json') },
  ar: { common: () => import('@/locales/ar/common.json') },
  'zh-CN': { common: () => import('@/locales/zh-CN/common.json') },
  ja: { common: () => import('@/locales/ja/common.json') },
  ru: { common: () => import('@/locales/ru/common.json') },
} as const

async function loadNamespace(locale: string, namespace: string) {
  const loader = (resources as Record<string, Record<string, () => Promise<{ default: object }>>>)[locale]?.[
    namespace
  ]
  if (!loader) return {}
  const mod = await loader()
  return mod.default
}

let initPromise: Promise<typeof i18n> | null = null

/**
 * Initializes i18next with a synchronously-resolved initial locale (no
 * network dependency — see `resolveInitialLocale`) so first paint never
 * blocks on a translation fetch. Idempotent: safe to call from multiple
 * entry points (main.tsx, tests).
 */
export function initI18n(): Promise<typeof i18n> {
  if (initPromise) return initPromise

  const initialLocale = resolveInitialLocale()

  initPromise = loadNamespace(initialLocale, 'common').then((common) =>
    i18n
      .use(initReactI18next)
      .init({
        lng: initialLocale,
        fallbackLng: 'en',
        supportedLngs: [...SUPPORTED_LOCALES],
        ns: ['common'],
        defaultNS: 'common',
        resources: { [initialLocale]: { common } },
        interpolation: { escapeValue: false },
        returnEmptyString: false,
      })
      .then(() => {
        // Single source of truth for <html lang>/dir — fires on every
        // language change regardless of caller (switcher click, profile
        // sync, tests), so no call site needs to remember to set these.
        i18n.on('languageChanged', (lng) => {
          document.documentElement.setAttribute('lang', lng)
          document.documentElement.setAttribute('dir', isRtl(lng) ? 'rtl' : 'ltr')
        })
        return i18n
      }),
  )

  return initPromise
}

/** Loads (if needed) and switches to a locale, for the language switcher. */
export async function changeLocale(locale: string): Promise<void> {
  if (!i18n.hasResourceBundle(locale, 'common')) {
    const common = await loadNamespace(locale, 'common')
    i18n.addResourceBundle(locale, 'common', common)
  }
  await i18n.changeLanguage(locale)
}

export default i18n
