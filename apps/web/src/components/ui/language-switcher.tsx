import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-context'
import { useUpdateProfilePreferences } from '@/lib/queries/profile'
import { SUPPORTED_LOCALES, LOCALE_LABELS, setExplicitLocale, type SupportedLocale } from '@/lib/locale'
import { changeLocale } from '@/i18n'
import { cn } from '@/lib/cn'

/**
 * A manual pick here is "explicit" — it outranks profile/geo/browser
 * detection forever (see src/lib/locale.ts) until the user changes it
 * again, matches FADEUP master prompt section 22: "Changing language must
 * happen without logout. Persist preference."
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const updatePreferences = useUpdateProfilePreferences(user?.id)

  async function handleSelect(locale: SupportedLocale) {
    setExplicitLocale(locale)
    await changeLocale(locale)
    if (user) updatePreferences.mutate({ locale })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'px-2', className)}
        aria-label={t('language.select')}
      >
        <Languages className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{t('language.label')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {SUPPORTED_LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onSelect={() => void handleSelect(locale)}
            aria-checked={i18n.language === locale}
            role="menuitemradio"
          >
            {LOCALE_LABELS[locale]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
