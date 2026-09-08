import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '@/shared/hooks/useDocumentMeta'
import { WithdrawalForm } from '@/features/legal/components/WithdrawalForm'
import { parseProfessionalRef } from '@/features/legal/api/legal'

/**
 * X2 — la page d'information des professionnels référencés (article 14 RGPD).
 *
 * Publique, sans authentification, indexable. Elle est atteinte depuis chaque
 * fiche non revendiquée (lien sous l'explication « créé à partir de sources
 * publiques »), depuis l'e-mail d'information envoyé à la publication
 * (`?pro=<handle>&t=<jeton>#withdraw`), et directement.
 *
 * Elle est aussi la « mesure appropriée » de l'article 14(5)(b) : quand un
 * prospect n'a pas d'adresse e-mail, l'information directe est impossible et
 * c'est CETTE page, publiquement accessible, qui la remplace.
 *
 * Le ton : un professionnel qui découvre que son établissement est publié
 * sans son accord doit comprendre pourquoi, et voir immédiatement la sortie.
 * Ni juridique illisible, ni commercial déguisé. Les mentions définitives
 * relèvent d'un avis juridique (hors périmètre X2) — la structure et le texte
 * de travail sont posés ici.
 */
export function ProfessionalsDataPage() {
  const { t } = useTranslation('v2')
  const [searchParams] = useSearchParams()

  const proParam = searchParams.get('pro')
  const initialRef = proParam ? parseProfessionalRef(proParam) : null
  const token = searchParams.get('t')

  useDocumentMeta({
    title: t('legal.data.metaTitle'),
    description: t('legal.data.metaDescription'),
  })

  const sectionTitle = 'text-fu-lg font-semibold text-[var(--fu-text-primary)]'
  const body = 'mt-2 text-fu-base leading-relaxed text-[var(--fu-text-secondary)]'

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-8" data-testid="professionals-data-page">
      <h1 className="text-fu-2xl font-semibold tracking-tight text-[var(--fu-text-primary)]">
        {t('legal.data.title')}
      </h1>
      <p className="mt-3 text-fu-base leading-relaxed text-[var(--fu-text-secondary)]">{t('legal.data.intro')}</p>

      <div className="mt-8 flex flex-col gap-7">
        <section aria-labelledby="x2-controller">
          <h2 id="x2-controller" className={sectionTitle}>{t('legal.data.controller.title')}</h2>
          <p className={body}>
            {t('legal.data.controller.body')}{' '}
            <a
              href={`mailto:${t('legal.data.controller.contact')}`}
              className="font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
            >
              {t('legal.data.controller.contact')}
            </a>
          </p>
        </section>

        <section aria-labelledby="x2-purpose">
          <h2 id="x2-purpose" className={sectionTitle}>{t('legal.data.purpose.title')}</h2>
          <p className={body}>{t('legal.data.purpose.body')}</p>
          <p className={body}>{t('legal.data.purpose.unmanaged')}</p>
        </section>

        <section aria-labelledby="x2-categories">
          <h2 id="x2-categories" className={sectionTitle}>{t('legal.data.categories.title')}</h2>
          <p className={body}>{t('legal.data.categories.body')}</p>
        </section>

        <section aria-labelledby="x2-sources">
          <h2 id="x2-sources" className={sectionTitle}>{t('legal.data.sources.title')}</h2>
          <p className={body}>{t('legal.data.sources.body')}</p>
          <p className={body}>{t('legal.data.sources.exact')}</p>
        </section>

        <section aria-labelledby="x2-retention">
          <h2 id="x2-retention" className={sectionTitle}>{t('legal.data.retention.title')}</h2>
          <p className={body}>{t('legal.data.retention.body')}</p>
        </section>

        <section aria-labelledby="x2-rights">
          <h2 id="x2-rights" className={sectionTitle}>{t('legal.data.rights.title')}</h2>
          <p className={body}>{t('legal.data.rights.body')}</p>
          <p className={body}>{t('legal.data.rights.claimNote')}</p>
        </section>

        <section aria-labelledby="x2-emails">
          <h2 id="x2-emails" className={sectionTitle}>{t('legal.data.emails.title')}</h2>
          <p className={body}>{t('legal.data.emails.body')}</p>
        </section>

        {/* L'ancre #withdraw est celle des e-mails d'information — stable. */}
        <section
          id="withdraw"
          aria-labelledby="x2-withdraw"
          className="scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--fu-border)] p-4 md:p-6"
        >
          <h2 id="x2-withdraw" className={sectionTitle}>{t('legal.withdrawal.title')}</h2>
          <p className={`${body} mb-5`}>{t('legal.withdrawal.body')}</p>
          <WithdrawalForm initialRef={initialRef} token={token} />
        </section>
      </div>
    </div>
  )
}

export default ProfessionalsDataPage
