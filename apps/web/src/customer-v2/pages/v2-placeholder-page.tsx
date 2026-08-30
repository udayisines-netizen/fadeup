import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { V2_ROUTES } from '@/customer-v2/routes'

/**
 * The four destinations that exist so the shell is whole, and no further.
 *
 * ============================================================================
 * A ROUTE, NOT A FEATURE
 * ============================================================================
 *
 * R5R.1A builds Home. Marketplace, Book, Appointments and Profile are named
 * here because a five-tab navigation whose tabs lead nowhere is not a shell
 * that can be reviewed — a reviewer cannot judge whether the selection state,
 * the indicator motion or the desktop header behave correctly if four of the
 * five targets 404.
 *
 * So each renders one honest screen: what will live here, which lot builds it,
 * and a way back. It does not pretend to be a loading state, it does not show
 * an empty list that implies the feature exists and returned nothing, and it
 * carries no placeholder content that could be mistaken for real data.
 *
 * The lot names are deliberate. This page is read by the product owner during
 * the visual gate, and "R5R.1B" tells them exactly when to expect it in a way
 * "Coming soon" does not.
 */
/** The four surfaces this lot stops short of. */
export type V2PlaceholderSurface = 'marketplace' | 'book' | 'appointments' | 'profile'

export function V2PlaceholderPage({
  surface,
  lot,
}: {
  surface: V2PlaceholderSurface
  /** The roadmap lot that will build this surface, e.g. `R5R.1B`. */
  lot: string
}) {
  const { t } = useTranslation()

  // Built from the discriminator rather than looked up in a constant map: a
  // module-level map of user-facing words is evaluated before any language
  // exists, which is the shape `no-untranslated-status-maps` exists to reject.
  const title = t(`customer-app:v2.placeholder.${surface}.title`)
  const body = t(`customer-app:v2.placeholder.${surface}.body`)

  useDocumentMeta({
    title: t('customer-app:v2.placeholder.documentTitle', { surface: title }),
    description: body,
    noIndex: true,
  })

  return (
    <div className="max-w-[36rem] py-8 md:py-12">
      <p className="text-v2-eyebrow font-semibold uppercase tracking-[0.09em] text-v2-ink-mute">
        {t('customer-app:v2.placeholder.eyebrow', { lot })}
      </p>

      <h1 className="mt-2 text-v2-heading font-semibold tracking-[-0.025em] text-v2-ink md:text-v2-heading-lg">
        {title}
      </h1>

      <p className="mt-3 text-v2-body text-v2-ink-soft">{body}</p>

      <Link
        to={V2_ROUTES.home}
        className="v2-press mt-6 inline-flex h-11 items-center gap-2 rounded-v2-2 border border-v2-edge bg-v2-paper px-4 text-v2-meta font-semibold text-v2-ink hover:bg-v2-fill"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.9} aria-hidden="true" />
        {t('customer-app:v2.placeholder.backHome')}
      </Link>
    </div>
  )
}
