/**
 * Honest placeholder for V3 destinations that a later phase rebuilds.
 * Typography only — the V3 empty-state rule (no sad icons, no fake content).
 */
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { V3_ROUTES } from '@/customer-v3/routes'
import '@/ui-v3/ui-v3.css'

export function V3PlaceholderPage() {
  const { t } = useTranslation('v3')
  useDocumentMeta({ title: t('placeholder.title'), description: t('placeholder.body'), noIndex: true })

  return (
    <div
      data-fu-v3
      style={{
        minHeight: '60dvh',
        display: 'grid',
        placeContent: 'center',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 className="v3-h1">{t('placeholder.title')}</h1>
      <p className="v3-body" style={{ color: 'var(--v3-ink-soft)', maxInlineSize: '28rem' }}>
        {t('placeholder.body')}
      </p>
      <Link to={V3_ROUTES.landing} className="v3-btn v3-btn--quiet v3-press" style={{ justifySelf: 'center' }}>
        {t('placeholder.back')}
      </Link>
    </div>
  )
}
