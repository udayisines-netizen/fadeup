import { useTranslation } from 'react-i18next'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Globe } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  setExplicitLocale,
  type SupportedLocale,
} from '@/lib/locale'
import { changeLocale } from '@/i18n'
import { useUpdateProfilePreferences } from '@/lib/queries/profile'

/**
 * The explicit language override, available to EVERYONE — the discovery and
 * anonymous-booking audience most of all. The review found the switcher had
 * retreated behind the signed-in Profile, which silently dropped the
 * "explicit language override" preservation rule for exactly the visitors
 * the marketplace exists for; both legacy shells carry one in their headers,
 * and now both v2 shells do again.
 *
 * Persistence is the existing three-layer order: explicit choice outranks
 * detection forever (localStorage), and the profile row makes it roam — but
 * only when a session exists to write it.
 */
export function LanguageMenu() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const updatePreferences = useUpdateProfilePreferences(user?.id)

  const activeLocale: SupportedLocale = isSupportedLocale(i18n.language) ? i18n.language : 'en'

  const changeLanguage = async (locale: SupportedLocale) => {
    setExplicitLocale(locale)
    await changeLocale(locale)
    if (user) updatePreferences.mutate({ locale })
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t('customer-app:v2.profilePage.language')}
        className="v2-press inline-flex h-11 w-11 items-center justify-center rounded-v2-2 text-v2-ink-soft hover:bg-v2-fill hover:text-v2-ink"
      >
        <Globe className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.8} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-fu-v2
          align="end"
          sideOffset={6}
          className="v2-plate z-40 max-h-80 min-w-[12rem] overflow-y-auto py-1 text-v2-ink"
        >
          <DropdownMenu.RadioGroup
            value={activeLocale}
            onValueChange={(value) => void changeLanguage(value as SupportedLocale)}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <DropdownMenu.RadioItem
                key={locale}
                value={locale}
                className="flex min-h-11 cursor-pointer select-none items-center gap-2.5 px-3 py-2 text-v2-meta outline-none data-[highlighted]:bg-v2-fill"
              >
                <span className="flex-1">{LOCALE_LABELS[locale]}</span>
                {locale === activeLocale ? (
                  <Check className="h-4 w-4 text-v2-green" strokeWidth={2} aria-hidden="true" />
                ) : null}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
