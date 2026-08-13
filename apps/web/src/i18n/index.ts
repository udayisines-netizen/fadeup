import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { SUPPORTED_LOCALES, resolveInitialLocale, isRtl } from '@/lib/locale'

/**
 * Namespaces are organized by product domain (common, marketing, auth,
 * platform, owner, barber, customer, booking, queue, legal, ...) per the
 * FADEUP master prompt — never one giant translation file. Add a new
 * namespace by (1) creating `src/locales/<locale>/<name>.json` for every
 * locale in NAMESPACES below is auto-wired, (2) adding its name to
 * NAMESPACES here.
 */
const NAMESPACES = ['common', 'marketplace', 'customer-app'] as const
type Namespace = (typeof NAMESPACES)[number]

const LOADERS: Record<string, Record<Namespace, () => Promise<{ default: object }>>> = {
  en: {
    common: () => import('@/locales/en/common.json'),
    marketplace: () => import('@/locales/en/marketplace.json'),
    'customer-app': () => import('@/locales/en/customer-app.json'),
  },
  fr: {
    common: () => import('@/locales/fr/common.json'),
    marketplace: () => import('@/locales/fr/marketplace.json'),
    'customer-app': () => import('@/locales/fr/customer-app.json'),
  },
  es: {
    common: () => import('@/locales/es/common.json'),
    marketplace: () => import('@/locales/es/marketplace.json'),
    'customer-app': () => import('@/locales/es/customer-app.json'),
  },
  de: {
    common: () => import('@/locales/de/common.json'),
    marketplace: () => import('@/locales/de/marketplace.json'),
    'customer-app': () => import('@/locales/de/customer-app.json'),
  },
  it: {
    common: () => import('@/locales/it/common.json'),
    marketplace: () => import('@/locales/it/marketplace.json'),
    'customer-app': () => import('@/locales/it/customer-app.json'),
  },
  pt: {
    common: () => import('@/locales/pt/common.json'),
    marketplace: () => import('@/locales/pt/marketplace.json'),
    'customer-app': () => import('@/locales/pt/customer-app.json'),
  },
  ar: {
    common: () => import('@/locales/ar/common.json'),
    marketplace: () => import('@/locales/ar/marketplace.json'),
    'customer-app': () => import('@/locales/ar/customer-app.json'),
  },
  'zh-CN': {
    common: () => import('@/locales/zh-CN/common.json'),
    marketplace: () => import('@/locales/zh-CN/marketplace.json'),
    'customer-app': () => import('@/locales/zh-CN/customer-app.json'),
  },
  ja: {
    common: () => import('@/locales/ja/common.json'),
    marketplace: () => import('@/locales/ja/marketplace.json'),
    'customer-app': () => import('@/locales/ja/customer-app.json'),
  },
  ru: {
    common: () => import('@/locales/ru/common.json'),
    marketplace: () => import('@/locales/ru/marketplace.json'),
    'customer-app': () => import('@/locales/ru/customer-app.json'),
  },
}

async function loadNamespace(locale: string, namespace: Namespace) {
  const loader = LOADERS[locale]?.[namespace]
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

  initPromise = Promise.all(NAMESPACES.map((namespace) => loadNamespace(initialLocale, namespace))).then((bundles) => {
    const initialResources = Object.fromEntries(NAMESPACES.map((namespace, i) => [namespace, bundles[i]]))
    return i18n
      .use(initReactI18next)
      .init({
        lng: initialLocale,
        fallbackLng: 'en',
        supportedLngs: [...SUPPORTED_LOCALES],
        ns: [...NAMESPACES],
        defaultNS: 'common',
        resources: { [initialLocale]: initialResources },
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
      })
  })

  return initPromise
}

/** Loads (if needed) and switches to a locale, for the language switcher. */
export async function changeLocale(locale: string): Promise<void> {
  for (const namespace of NAMESPACES) {
    if (!i18n.hasResourceBundle(locale, namespace)) {
      const bundle = await loadNamespace(locale, namespace)
      i18n.addResourceBundle(locale, namespace, bundle)
    }
  }
  await i18n.changeLanguage(locale)
}

export default i18n
