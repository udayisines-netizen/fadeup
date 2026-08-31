/**
 * The temporary frontend reset placeholder.
 *
 * The visible FadeUp web application (customer, professional, public and
 * marketing surfaces) was purged on 2026-09-01 — see
 * `docs/frontend/WEB_UI_PURGE_INVENTORY.md`. Nothing has replaced it yet.
 *
 * This component exists ONLY to prove that React boots, the router resolves,
 * CSS loads, i18n initialises and `apps/web` still builds and serves. It is
 * deliberately not a design: no navigation, no cards, no product preview, no
 * marketing, no imagery. The next task begins the real FadeUp design; this
 * file is expected to be deleted then.
 *
 * Its one sentence goes through the localization system rather than being
 * hardcoded, so the no-hardcoded-strings guard keeps zero exemptions and a
 * visitor still reads the notice in their own language.
 */
import { useTranslation } from 'react-i18next'

export function ResetPlaceholder() {
  const { t } = useTranslation('common')

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeContent: 'center',
        gap: '0.5rem',
        padding: '2rem',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#101512',
        background: '#ffffff',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 650, letterSpacing: '-0.01em' }}>
        FadeUp
      </h1>
      <p style={{ margin: 0, fontSize: '0.9375rem', color: '#5a6862' }}>
        {t('reset.inProgress')}
      </p>
    </main>
  )
}

export default ResetPlaceholder
