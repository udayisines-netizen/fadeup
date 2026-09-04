import { useTranslation } from 'react-i18next'
import { changeLocale } from '@/i18n'
import { setExplicitLocale } from '@/lib/locale'
import { V2_LOCALES, type V2Locale } from '@/shared/i18n/namespaces'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'

/**
 * Sélecteur de langue de lancement : fr et en UNIQUEMENT (la contrainte
 * `profiles_locale_valid` en autorise dix ; le moteur reste international,
 * seul le sélecteur est restreint). Le choix est explicite et persistant —
 * il survit au rechargement via le mécanisme legacy éprouvé.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation('v2')
  const current: V2Locale = i18n.language === 'fr' ? 'fr' : 'en'

  return (
    <SegmentedControl
      label={t('common.language.label')}
      options={V2_LOCALES.map((locale) => ({ value: locale, label: t(`common.language.${locale}`) }))}
      value={current}
      onValueChange={(value) => {
        const locale = value === 'fr' ? 'fr' : 'en'
        setExplicitLocale(locale)
        void changeLocale(locale)
      }}
      className={className}
    />
  )
}
