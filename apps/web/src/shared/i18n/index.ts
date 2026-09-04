import i18n from '@/i18n'
import { V2_NAMESPACE, V2_LOCALES, type V2Locale, type V2Section } from '@/shared/i18n/namespaces'

import frCommon from '@/shared/i18n/locales/fr/common.json'
import frAuth from '@/shared/i18n/locales/fr/auth.json'
import frNav from '@/shared/i18n/locales/fr/nav.json'
import frErrors from '@/shared/i18n/locales/fr/errors.json'
import frStates from '@/shared/i18n/locales/fr/states.json'
import frEmpty from '@/shared/i18n/locales/fr/empty.json'
import enCommon from '@/shared/i18n/locales/en/common.json'
import enAuth from '@/shared/i18n/locales/en/auth.json'
import enNav from '@/shared/i18n/locales/en/nav.json'
import enErrors from '@/shared/i18n/locales/en/errors.json'
import enStates from '@/shared/i18n/locales/en/states.json'
import enEmpty from '@/shared/i18n/locales/en/empty.json'

const BUNDLES: Record<V2Locale, Record<V2Section, object>> = {
  fr: { common: frCommon, auth: frAuth, nav: frNav, errors: frErrors, states: frStates, empty: frEmpty },
  en: { common: enCommon, auth: enAuth, nav: enNav, errors: enErrors, states: enStates, empty: enEmpty },
}

/**
 * Registers the V2 bundle on the shared i18next instance (see namespaces.ts
 * for why V2 is one airtight namespace). FR and EN are both registered
 * eagerly — they are the only product-ready locales and together weigh a few
 * kilobytes; eager registration means a language switch is instant and the
 * EN fallback is always present.
 *
 * Idempotent, and safe to call before or after `initI18n()` resolves as long
 * as i18next has been created (it is, at module scope).
 */
export function registerV2Bundles(): void {
  for (const locale of V2_LOCALES) {
    const sections = BUNDLES[locale]
    if (!i18n.hasResourceBundle(locale, V2_NAMESPACE)) {
      // Each section sits under its own zone, so a full key always reads
      // `<zone>.<élément>.<variante>` — e.g. `v2:auth.login.submit`.
      i18n.addResourceBundle(locale, V2_NAMESPACE, { ...sections }, true, false)
    }
  }
}
