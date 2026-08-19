import { beforeAll, describe, expect, it } from 'vitest'
import { changeLocale, initI18n } from '@/i18n'

/**
 * <html lang> and <html dir>, driven by the language itself.
 *
 * These are set by ONE listener on i18next's `languageChanged`, registered in
 * i18n/index.ts — not by the language switcher, not by a layout, not by a
 * route. That matters: the switcher is only one of several things that can
 * change the language (a profile preference arriving after sign-in, GeoIP on a
 * first visit, a test). Any call site that had to remember to set `dir` itself
 * would eventually forget, and Arabic would render left-to-right.
 *
 * So this drives the language the way the app does and asserts on the document.
 */
describe('document language and direction', () => {
  beforeAll(async () => {
    await initI18n()
  })

  it('marks Arabic right-to-left', async () => {
    await changeLocale('ar')

    expect(document.documentElement.getAttribute('lang')).toBe('ar')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
  })

  it('resets to left-to-right on the way back out', async () => {
    await changeLocale('ar')
    await changeLocale('fr')

    // The failure this guards is one-way: setting rtl on entry and forgetting
    // to unset it leaves every later locale mirrored.
    expect(document.documentElement.getAttribute('lang')).toBe('fr')
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
  })

  it('loads the new language\'s strings, not just the tag', async () => {
    await changeLocale('fr')
    const i18n = (await initI18n())
    expect(i18n.t('booking:success.title')).toBe('Réservation confirmée')

    await changeLocale('ja')
    expect(i18n.t('booking:success.title')).toBe('予約が確定しました')

    // ...and switching back does not need a reload.
    await changeLocale('en')
    expect(i18n.t('booking:success.title')).toBe('Booking confirmed')
  })
})
