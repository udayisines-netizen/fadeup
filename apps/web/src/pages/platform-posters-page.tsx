import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { usePlatformIntl } from '@/lib/platform-intl'
import type { TFunction } from 'i18next'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import {
  useAssignPoster,
  useGeneratePosterBatch,
  useMyPosterLocations,
  usePosterBatches,
  usePosters,
  usePreparePosterLetter,
  useProspects,
  useRevokePoster,
  type GeneratedBatch,
  type PosterBatchRow,
  type PosterLetterData,
  type PosterRow,
  type PosterState,
} from '@/lib/queries/platform-plat2'
import {
  PDF_LOCALES,
  buildMailingPdf,
  buildPosterPdf,
  canPrintTexts,
  downloadPdf,
  type LetterCopy,
  type PdfLocale,
  type PosterCopy,
} from '@/shared/lib/posterDocuments'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader, SectionHeader } from '@/components/ui/page-header'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { TextField } from '@/components/ui/text-field'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import type { PlatformPermission } from '@/lib/types'

/**
 * /platform/posters — LES AFFICHES QR PRÉ-GÉNÉRÉES.
 *
 * Le geste que cet écran doit rendre évident : imprimer cent affiches AVANT
 * de savoir quels salons les recevront. Un lot de codes libres, un PDF prêt à
 * imprimer immédiatement, puis un journal qui dit ce que chaque lot est
 * devenu — libre, attribué, révoqué, parti par la poste.
 *
 * L'écran entier est conditionné par `poster.manage` (fondateur et admin) :
 * générer, révoquer, réattribuer et préparer un envoi décident du sort d'un
 * objet physique déjà parti à l'impression. `poster.assign`, qui va jusqu'au
 * stagiaire, sert AILLEURS — sur l'écran public de scan `/a/<code>`, livré
 * par un autre lot et auquel on ne touche pas ici.
 *
 * LE CONDITIONNEMENT N'AUTORISE RIEN. Chaque RPC repose la question côté
 * serveur : `generate_poster_batch`, `revoke_poster` et `prepare_poster_letter`
 * exigent `poster.manage`, `assign_poster` vérifie les `memberships` et les
 * zones, et une affiche attribuée n'est détournable par personne.
 */

/*
 * `poster.manage` est en base depuis 20260911200300_plat2_qr_posters (fondateur
 * et admin seulement) mais pas encore dans l'union `PlatformPermission` de
 * `src/lib/types.ts`, qui n'est pas un fichier de ce lot et qu'un autre agent
 * édite en parallèle. Le transtypage est donc LOCAL et documenté plutôt que
 * partagé : la valeur est exacte, seule la liste est en retard.
 */
const POSTER_MANAGE = 'poster.manage' as PlatformPermission

/**
 * LES MOTS QU'UNE AFFICHE FADEUP NE SAIT PAS TENIR AUJOURD'HUI.
 *
 * Les notifications applicatives n'existent pas avant M1c, et FadeUp n'envoie
 * pas de SMS du tout. Une affiche imprimée à cent exemplaires qui promettrait
 * « on vous prévient » serait un mensonge qu'aucun correctif logiciel ne
 * rattrape : le papier est déjà sur le mur.
 *
 * Ce qui est VRAI et ce que disent l'affiche et la lettre : on scanne, on voit
 * sa place dans la file EN DIRECT sur son téléphone, et on peut donc sortir
 * prendre un café en la surveillant.
 *
 * La liste est comparée sur du texte normalisé (minuscules, accents retirés),
 * donc « prévient » et « Prévenu » tombent sur « previen » et « prevenu ».
 * Elle sert deux fois : le test unitaire la passe sur les chaînes livrées, et
 * la fabrication refuse d'imprimer si une traduction future en introduit une.
 */
export const NOTIFICATION_WORDS = [
  'notif',
  'alert',
  'previen',
  'prevenu',
  'prevenir',
  'avertis',
  'avertir',
  'ping',
  'sms',
  'texto',
  'push',
  'benachricht',
  'avviso',
  'aviso',
] as const

/** Les clés dont la valeur finit DANS un PDF — celles que le test relit. */
export const PDF_TEXT_KEYS = [
  'pdfHeadline',
  'pdfAction',
  'pdfCodeLabel',
  'pdfFallback',
  'letterSalutation',
  'letterBody',
  'letterProofHeading',
  'letterCallToAction',
  'letterCodeLabel',
  'letterSignature',
  'proofViewsAllTime',
  'proofViewsWindow',
  'proofInterest',
  'proofLastView',
] as const

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** Le premier mot de promesse trouvé, ou `null`. */
export const findNotificationPromise = (texts: string[]): string | null => {
  for (const text of texts) {
    const haystack = normalize(text)
    for (const word of NOTIFICATION_WORDS) {
      if (haystack.includes(word)) return word
    }
  }
  return null
}

/**
 * Le bundle `platform` d'une langue de PDF, chargé à la demande.
 *
 * La langue du PDF est INDÉPENDANTE de celle de l'interface — un fondateur
 * qui travaille en français imprime pour un salon portugais — et i18next ne
 * garde en mémoire que la locale active. Ces imports dynamiques sont les
 * mêmes modules que ceux de `src/i18n` : le bundler les partage, aucun
 * doublon n'est téléchargé.
 */
const PLATFORM_BUNDLES: Record<PdfLocale, () => Promise<{ default: object }>> = {
  fr: () => import('@/locales/fr/platform.json'),
  en: () => import('@/locales/en/platform.json'),
  es: () => import('@/locales/es/platform.json'),
  it: () => import('@/locales/it/platform.json'),
  pt: () => import('@/locales/pt/platform.json'),
  de: () => import('@/locales/de/platform.json'),
}

type I18nInstance = ReturnType<typeof useTranslation>['i18n']

async function ensurePlatformBundle(i18n: I18nInstance, locale: PdfLocale): Promise<void> {
  if (i18n.hasResourceBundle(locale, 'platform')) return
  const bundle = await PLATFORM_BUNDLES[locale]()
  i18n.addResourceBundle(locale, 'platform', bundle.default, true, false)
}

/**
 * LA LANGUE CHOISIE, ET L'ANGLAIS DERRIÈRE.
 *
 * i18next retombe sur `fallbackLng` (en) quand une clé manque dans la langue
 * demandée — mais seulement si ce bundle-là est EN MÉMOIRE. Sans cette
 * seconde garantie, un fondateur qui travaille en français et imprime en
 * espagnol obtiendrait « posters.pdfHeadline » écrit en gros sur cent
 * affiches. Une phrase en anglais est un défaut de traduction ; une clé
 * brute imprimée est du papier à jeter.
 */
async function pdfTranslator(i18n: I18nInstance, locale: PdfLocale): Promise<TFunction> {
  await Promise.all([...new Set<PdfLocale>([locale, 'en'])].map((lng) => ensurePlatformBundle(i18n, lng)))
  return i18n.getFixedT(locale, 'platform')
}

/** L'origine telle qu'on la lit sur un mur : sans le protocole. */
const printableOrigin = (origin: string): string => origin.replace(/^https?:\/\//, '')

function posterCopyFrom(tt: TFunction, origin: string): PosterCopy {
  return {
    headline: tt('posters.pdfHeadline'),
    action: tt('posters.pdfAction'),
    codeLabel: tt('posters.pdfCodeLabel'),
    fallbackLabel: tt('posters.pdfFallback', { origin: printableOrigin(origin) }),
  }
}

function letterCopyFrom(tt: TFunction, proofLines: string[]): LetterCopy {
  return {
    salutation: tt('posters.letterSalutation'),
    body: tt('posters.letterBody'),
    proofHeading: tt('posters.letterProofHeading'),
    proofLines,
    callToAction: tt('posters.letterCallToAction'),
    signature: tt('posters.letterSignature'),
    codeLabel: tt('posters.letterCodeLabel'),
  }
}

/**
 * L'ÉLÉMENT DE PREUVE, RÉDIGÉ À PARTIR DE CE QUE L'ANALYTICS DIT VRAIMENT.
 *
 * `proof` vaut `null` quand elle ne dit rien : la lettre part alors sans
 * encadré, et surtout sans phrase de repli chiffrée. Une ligne n'est écrite
 * que si son nombre est non nul — « 0 vue de profil » est un argument de
 * vente à l'envers.
 *
 * Nombres et date sont formatés dans la langue du PDF, pas dans celle de
 * l'interface : c'est le patron qui lit la lettre.
 */
function proofLinesFrom(tt: TFunction, locale: string, proof: PosterLetterData['proof']): string[] {
  if (!proof) return []
  const number = new Intl.NumberFormat(locale)
  const lines: string[] = []
  if (proof.profile_views_all_time > 0) {
    lines.push(tt('posters.proofViewsAllTime', { value: number.format(proof.profile_views_all_time) }))
  }
  if (proof.profile_views_window > 0) {
    lines.push(
      tt('posters.proofViewsWindow', {
        days: number.format(proof.window_days),
        value: number.format(proof.profile_views_window),
      }),
    )
  }
  if (proof.interest_requests > 0) {
    lines.push(tt('posters.proofInterest', { value: number.format(proof.interest_requests) }))
  }
  if (proof.last_profile_view_at) {
    lines.push(
      tt('posters.proofLastView', {
        date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(proof.last_profile_view_at)),
      }),
    )
  }
  return lines
}

function addressLinesFrom(address: PosterLetterData['address']): string[] {
  const city = [address.postal_code, address.city].filter(Boolean).join(' ').trim()
  return [address.line, city, address.country].filter((line): line is string => Boolean(line && line.trim()))
}

/** Un nom de fichier qu'un système de fichiers accepte partout. */
function fileSlug(value: string): string {
  const slug = normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'lot'
}

/**
 * Les refus serveur portent un motif NOMMÉ (`fadeup_poster_refusal=…`, dans
 * `details` ou dans le message). L'afficher tel quel donnerait « new row
 * violates… » ; le traduire donne une phrase qui dit quoi faire. Ce qui n'est
 * pas reconnu retombe sur le message brut plutôt que sur rien.
 */
const REFUSAL_KEYS: Record<string, string> = {
  not_authorized: 'refusalNotAuthorized',
  revoke_not_authorized: 'refusalNotAuthorized',
  letter_not_authorized: 'refusalNotAuthorized',
  not_authenticated: 'refusalNotAuthenticated',
  reason_required: 'refusalReasonRequired',
  not_free: 'refusalNotFree',
  already_assigned: 'refusalAlreadyAssigned',
  revoked: 'refusalRevoked',
  unknown_code: 'refusalUnknownCode',
  location_not_mine: 'refusalLocationNotMine',
  count_out_of_range: 'refusalCountOutOfRange',
  label_required: 'refusalLabelRequired',
  prospect_not_visible: 'refusalProspectNotVisible',
  arguments_required: 'refusalArgumentsRequired',
  code_generator_exhausted: 'refusalGeneratorExhausted',
}

function refusalToken(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const candidates = ['details' in error ? error.details : null, 'hint' in error ? error.hint : null, getErrorMessage(error)]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const match = /fadeup_[a-z_]*refusal=([a-z_]+)/.exec(candidate)
    if (match) return match[1]!
  }
  return null
}

function useRefusalToast() {
  const { t } = useTranslation()
  const { toast } = useToast()
  return {
    ok: (title: string) => toast({ title, variant: 'success' as const }),
    fail: (title: string, error: unknown) => {
      const token = refusalToken(error)
      const known = token ? REFUSAL_KEYS[token] : undefined
      toast({
        title,
        description: known ? t(`platform:posters.${known}`) : getErrorMessage(error),
        variant: 'error',
      })
    },
  }
}

/**
 * LA FABRIQUE DES DEUX DOCUMENTS, et les deux refus honnêtes qui la gardent.
 *
 * 1. Aucune promesse de notification : si une traduction en introduit une, on
 *    refuse d'imprimer plutôt que de mentir sur cent murs.
 * 2. `canPrintTexts` AVANT toute fabrication : les polices standard d'un PDF
 *    n'écrivent ni le japonais, ni l'arabe, ni le russe, ni le chinois, et un
 *    PDF de points d'interrogation est pire qu'un refus. Le nom et l'adresse
 *    du salon passent le même contrôle — ils viennent de la base, pas de nous.
 */
function usePosterDocuments(pdfLocale: PdfLocale) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()

  function refuses(ourCopy: string[], everything: string[]): boolean {
    const promise = findNotificationPromise(ourCopy)
    if (promise) {
      toast({
        title: t('platform:posters.pdfPromise'),
        description: t('platform:posters.pdfPromiseBody', { word: promise }),
        variant: 'error',
      })
      return true
    }
    if (!canPrintTexts(everything)) {
      toast({
        title: t('platform:posters.pdfUnprintable'),
        description: t('platform:posters.pdfUnprintableBody'),
        variant: 'error',
      })
      return true
    }
    return false
  }

  return {
    /** Les affiches d'un lot : une page par code. */
    async posters(codes: string[], label: string): Promise<void> {
      const origin = window.location.origin
      const tt = await pdfTranslator(i18n, pdfLocale)
      const copy = posterCopyFrom(tt, origin)
      const texts = Object.values(copy)
      if (refuses(texts, texts)) return
      downloadPdf(buildPosterPdf(codes, origin, copy), `fadeup-affiches-${fileSlug(label)}.pdf`)
    },

    /** L'envoi complet : la lettre PUIS l'affiche, dans un seul PDF. */
    async mailing(letter: PosterLetterData): Promise<void> {
      const origin = window.location.origin
      const tt = await pdfTranslator(i18n, pdfLocale)
      const proofLines = proofLinesFrom(tt, pdfLocale, letter.proof)
      const posterCopy = posterCopyFrom(tt, origin)
      const letterCopy = letterCopyFrom(tt, proofLines)
      const addressLines = addressLinesFrom(letter.address)
      const ourCopy = [
        ...Object.values(posterCopy),
        letterCopy.salutation,
        letterCopy.body,
        letterCopy.proofHeading,
        letterCopy.callToAction,
        letterCopy.signature,
        letterCopy.codeLabel,
        ...proofLines,
      ]
      if (refuses(ourCopy, [...ourCopy, letter.business_name, ...addressLines])) return
      downloadPdf(
        buildMailingPdf(
          { code: letter.code, origin, businessName: letter.business_name, addressLines, copy: letterCopy },
          posterCopy,
        ),
        `fadeup-envoi-${fileSlug(letter.business_name)}-${letter.code}.pdf`,
      )
    },
  }
}

export function PlatformPostersPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  /*
   * LA GARDE EST UN RETOUR ANTICIPÉ, AVANT TOUT AUTRE HOOK : tant qu'elle
   * refuse, ni le journal des lots ni la liste des affiches ne sont montés,
   * donc aucune RPC n'est appelée par un rôle qui n'a rien à faire ici. Un
   * commercial, un support, un modérateur, un stagiaire lisent une phrase qui
   * dit pourquoi — pas un tableau vide qui ressemble à une panne.
   */
  if (!can(POSTER_MANAGE)) {
    return (
      <Container size="lg" className="py-8">
        <PageHeader title={t('platform:posters.title')} />
        <Card className="mt-6">
          <CardContent className="p-4 pt-4">
            <EmptyState
              className="border-none"
              title={t('platform:posters.noAccess')}
              description={t('platform:posters.noAccessBody')}
            />
          </CardContent>
        </Card>
      </Container>
    )
  }

  return <PostersDesk />
}

function PostersDesk() {
  const { t, i18n } = useTranslation()
  const [pdfLocale, setPdfLocale] = useState<PdfLocale>(defaultPdfLocale(i18n.language))
  const [openBatch, setOpenBatch] = useState<PosterBatchRow | null>(null)
  const documents = usePosterDocuments(pdfLocale)

  return (
    <Container size="lg" className="py-8">
      <PageHeader title={t('platform:posters.title')} subtitle={t('platform:posters.subtitle')} />

      <GenerateSection
        pdfLocale={pdfLocale}
        onPdfLocale={setPdfLocale}
        onDownloadPosters={(codes, label) => void documents.posters(codes, label)}
      />

      <BatchLog openBatchId={openBatch?.id ?? null} onOpen={setOpenBatch} />

      {openBatch ? (
        <BatchPosters
          batch={openBatch}
          pdfLocale={pdfLocale}
          onPdfLocale={setPdfLocale}
          onDownloadPosters={(codes, label) => void documents.posters(codes, label)}
          onDownloadMailing={(letter) => void documents.mailing(letter)}
        />
      ) : (
        <p className="mt-4 text-sm text-ink-500">{t('platform:posters.pickBatch')}</p>
      )}
    </Container>
  )
}

/** La langue de l'interface quand un PDF sait l'écrire ; le français sinon. */
function defaultPdfLocale(language: string): PdfLocale {
  const base = language.split('-')[0] ?? ''
  return (PDF_LOCALES as readonly string[]).includes(base) ? (base as PdfLocale) : 'fr'
}

/**
 * LE CHOIX DE LA LANGUE DU PDF, ET POURQUOI IL EST LIMITÉ À SIX.
 *
 * `PDF_LOCALES` est la liste des langues que les polices standard d'un PDF
 * savent écrire. Le japonais, l'arabe, le russe et le chinois exigeraient
 * d'embarquer une police de plusieurs mégaoctets : la limite est dite en une
 * phrase, sous le champ, plutôt que découverte devant un PDF illisible.
 */
function PdfLocaleField({ value, onChange }: { value: PdfLocale; onChange: (locale: PdfLocale) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1">
      <SelectField
        label={t('platform:posters.pdfLanguage')}
        value={value}
        onChange={(event) => onChange(event.target.value as PdfLocale)}
        options={PDF_LOCALES.map((locale) => ({
          value: locale,
          label: new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale,
        }))}
      />
      <p className="text-xs text-ink-500">{t('platform:posters.pdfLanguageHint')}</p>
    </div>
  )
}

interface GenerateFormValues {
  label: string
  count: number
  note: string
}

/**
 * GÉNÉRER UN LOT, PUIS IMPRIMER TOUT DE SUITE.
 *
 * Le téléchargement du PDF est proposé dans la seconde qui suit la
 * génération, au même endroit : c'est la raison d'être du geste, et les codes
 * viennent de la réponse de la RPC — aucun aller-retour de plus.
 */
function GenerateSection({
  pdfLocale,
  onPdfLocale,
  onDownloadPosters,
}: {
  pdfLocale: PdfLocale
  onPdfLocale: (locale: PdfLocale) => void
  onDownloadPosters: (codes: string[], label: string) => void
}) {
  const { t } = useTranslation()
  const refusal = useRefusalToast()
  const generate = useGeneratePosterBatch()
  const [generated, setGenerated] = useState<GeneratedBatch | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GenerateFormValues>({ defaultValues: { label: '', count: 100, note: '' } })

  async function onSubmit(values: GenerateFormValues) {
    try {
      const batch = await generate.mutateAsync({
        count: values.count,
        label: values.label.trim(),
        note: values.note.trim() || null,
      })
      setGenerated(batch)
      reset({ label: '', count: values.count, note: '' })
    } catch (error) {
      setGenerated(null)
      refusal.fail(t('platform:posters.generateError'), error)
    }
  }

  return (
    <section className="mt-8">
      <SectionHeader title={t('platform:posters.generate')} />
      <p className="mt-1 text-sm text-ink-500">{t('platform:posters.generateHint')}</p>
      <Card className="mt-3">
        <CardContent className="p-4 pt-4">
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex-1">
                <TextField
                  label={t('platform:posters.labelField')}
                  hint={t('platform:posters.labelHint')}
                  error={errors.label?.message}
                  autoComplete="off"
                  spellCheck={false}
                  {...register('label', { required: t('platform:posters.refusalLabelRequired') })}
                />
              </div>
              <div className="sm:w-40">
                <TextField
                  label={t('platform:posters.countField')}
                  hint={t('platform:posters.countHint')}
                  error={errors.count?.message}
                  type="number"
                  min={1}
                  max={500}
                  inputMode="numeric"
                  {...register('count', {
                    valueAsNumber: true,
                    required: t('platform:posters.refusalCountOutOfRange'),
                    min: { value: 1, message: t('platform:posters.refusalCountOutOfRange') },
                    max: { value: 500, message: t('platform:posters.refusalCountOutOfRange') },
                  })}
                />
              </div>
            </div>

            <Textarea label={t('platform:posters.noteField')} rows={2} {...register('note')} />

            <div className="sm:max-w-sm">
              <PdfLocaleField value={pdfLocale} onChange={onPdfLocale} />
            </div>

            <Button type="submit" isLoading={isSubmitting || generate.isPending} className="sm:self-start">
              {t('platform:posters.generateAction')}
            </Button>

            {generated ? (
              <Alert variant="success">
                <span className="flex flex-col items-start gap-2">
                  <span>
                    {t('platform:posters.generated', { label: generated.label, total: generated.code_count })} ·{' '}
                    {t('platform:posters.generatedBody')}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onDownloadPosters(generated.codes, generated.label)}
                  >
                    {t('platform:posters.downloadPosters')}
                  </Button>
                </span>
              </Alert>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </section>
  )
}

/** LE JOURNAL DES LOTS : quand, combien, et ce que chacun est devenu. */
function BatchLog({
  openBatchId,
  onOpen,
}: {
  openBatchId: string | null
  onOpen: (batch: PosterBatchRow | null) => void
}) {
  const { t } = useTranslation()
  const batchesQuery = usePosterBatches()

  return (
    <section className="mt-8">
      <SectionHeader title={t('platform:posters.batches')} meta={t('platform:posters.batchesHint')} />
      <div className="mt-3">
        {batchesQuery.isPending ? (
          <TableSkeleton />
        ) : batchesQuery.isError ? (
          <ErrorState
            title={t('platform:posters.batchesError')}
            description={getErrorMessage(batchesQuery.error)}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table label={t('platform:posters.batches')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('platform:posters.colBatch')}</TableHead>
                  <TableHead>{t('platform:posters.colTotal')}</TableHead>
                  <TableHead>{t('platform:posters.colFree')}</TableHead>
                  <TableHead>{t('platform:posters.colAssigned')}</TableHead>
                  <TableHead>{t('platform:posters.colRevoked')}</TableHead>
                  <TableHead>{t('platform:posters.colLetters')}</TableHead>
                  <TableHead>{t('platform:posters.colCreatedBy')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('platform:posters.colActions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(batchesQuery.data ?? []).length === 0 ? (
                  <TableStateRow colSpan={8}>
                    <EmptyState title={t('platform:posters.batchesEmpty')} className="border-none" />
                  </TableStateRow>
                ) : (
                  (batchesQuery.data ?? []).map((batch) => (
                    <BatchRow
                      key={batch.id}
                      batch={batch}
                      open={batch.id === openBatchId}
                      onToggle={() => onOpen(batch.id === openBatchId ? null : batch)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  )
}

function BatchRow({ batch, open, onToggle }: { batch: PosterBatchRow; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const intl = usePlatformIntl()
  return (
    <TableRow className={open ? 'bg-paper-50' : undefined}>
      <TableCell>
        <span className="block font-medium text-ink-950">{batch.label}</span>
        {batch.note ? <span className="block max-w-[20rem] text-xs text-ink-500">{batch.note}</span> : null}
      </TableCell>
      <TableCell className="tabular-nums text-ink-950">{batch.code_count}</TableCell>
      <TableCell className="tabular-nums text-ink-500">{batch.free_count}</TableCell>
      <TableCell className="tabular-nums text-ink-500">{batch.assigned_count}</TableCell>
      <TableCell className="tabular-nums text-ink-500">{batch.revoked_count}</TableCell>
      <TableCell className="tabular-nums text-ink-500">{batch.letters_prepared}</TableCell>
      <TableCell className="max-w-[14rem] truncate text-xs text-ink-500">
        <span className="block truncate">{batch.created_by_email ?? '—'}</span>
        <span className="block whitespace-nowrap">{intl.date(batch.created_at)}</span>
      </TableCell>
      <TableCell className="text-right">
        <Button variant="secondary" size="sm" onClick={onToggle}>
          {open ? t('platform:posters.closeBatch') : t('platform:posters.openBatch')}
        </Button>
      </TableCell>
    </TableRow>
  )
}

const STATE_VARIANT: Record<PosterState, BadgeVariant> = {
  free: 'info',
  assigned: 'success',
  revoked: 'danger',
}

/** LES AFFICHES D'UN LOT : le code, l'état, le salon, l'envoi, et les gestes. */
function BatchPosters({
  batch,
  pdfLocale,
  onPdfLocale,
  onDownloadPosters,
  onDownloadMailing,
}: {
  batch: PosterBatchRow
  pdfLocale: PdfLocale
  onPdfLocale: (locale: PdfLocale) => void
  onDownloadPosters: (codes: string[], label: string) => void
  onDownloadMailing: (letter: PosterLetterData) => void
}) {
  const { t } = useTranslation()
  const [stateFilter, setStateFilter] = useState<PosterState | 'all'>('all')
  const postersQuery = usePosters({ batchId: batch.id, state: stateFilter === 'all' ? null : stateFilter })
  const [revoking, setRevoking] = useState<PosterRow | null>(null)
  const [assigning, setAssigning] = useState<PosterRow | null>(null)
  const [mailing, setMailing] = useState<PosterRow | null>(null)

  const posters = postersQuery.data ?? []
  const label = batch.label

  return (
    <section className="mt-8">
      <SectionHeader
        title={t('platform:posters.batchPosters', { label })}
        action={
          posters.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onDownloadPosters(posters.map((poster) => poster.code), label)}
            >
              {t('platform:posters.downloadListed', { total: posters.length })}
            </Button>
          ) : null
        }
      />

      <div className="mt-3">
        <SegmentedControl
          ariaLabel={t('platform:posters.filterLabel')}
          value={stateFilter}
          onChange={setStateFilter}
          size="sm"
          options={[
            { value: 'all', label: t('platform:posters.filterAll') },
            { value: 'free', label: t('platform:posters.stateFree') },
            { value: 'assigned', label: t('platform:posters.stateAssigned') },
            { value: 'revoked', label: t('platform:posters.stateRevoked') },
          ]}
        />
      </div>

      {/* DIT À L'ÉCRAN, PAS SEULEMENT DANS LA MODALE : une affiche attribuée
          n'a aucun bouton pour la donner ailleurs, et sans cette phrase on
          chercherait celui qui n'existe pas. */}
      <p className="mt-2 text-xs text-ink-500">{t('platform:posters.revokeBody')}</p>

      <div className="mt-3">
        {postersQuery.isPending ? (
          <TableSkeleton />
        ) : postersQuery.isError ? (
          <ErrorState title={t('platform:posters.postersError')} description={getErrorMessage(postersQuery.error)} />
        ) : (
          <div className="overflow-x-auto">
            <Table label={t('platform:posters.batchPosters', { label })}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('platform:posters.colCode')}</TableHead>
                  <TableHead>{t('platform:posters.colState')}</TableHead>
                  <TableHead>{t('platform:posters.colShop')}</TableHead>
                  <TableHead>{t('platform:posters.colLetter')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('platform:posters.colActions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posters.length === 0 ? (
                  <TableStateRow colSpan={5}>
                    <EmptyState title={t('platform:posters.postersEmpty')} className="border-none" />
                  </TableStateRow>
                ) : (
                  posters.map((poster) => (
                    <PosterTableRow
                      key={poster.id}
                      poster={poster}
                      onRevoke={() => setRevoking(poster)}
                      onAssign={() => setAssigning(poster)}
                      onMail={() => setMailing(poster)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {revoking ? <RevokeDialog poster={revoking} onClose={() => setRevoking(null)} /> : null}
      {assigning ? <AssignDialog poster={assigning} onClose={() => setAssigning(null)} /> : null}
      {mailing ? (
        <LetterDialog
          poster={mailing}
          pdfLocale={pdfLocale}
          onPdfLocale={onPdfLocale}
          onDownload={onDownloadMailing}
          onClose={() => setMailing(null)}
        />
      ) : null}
    </section>
  )
}

function PosterTableRow({
  poster,
  onRevoke,
  onAssign,
  onMail,
}: {
  poster: PosterRow
  onRevoke: () => void
  onAssign: () => void
  onMail: () => void
}) {
  const { t } = useTranslation()
  const intl = usePlatformIntl()

  return (
    <TableRow>
      <TableCell>
        <span className="block whitespace-nowrap font-mono text-sm font-medium tracking-wider text-ink-950">
          {poster.code}
        </span>
        {poster.state === 'assigned' ? (
          // L'écran public de scan appartient à un autre lot : on n'en fournit
          // qu'un lien, pour vérifier ce que voit un client.
          <a
            href={`/a/${poster.code}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent-600 underline underline-offset-2"
          >
            {t('platform:posters.viewPublic')}
          </a>
        ) : null}
      </TableCell>
      <TableCell>
        <Badge variant={STATE_VARIANT[poster.state]}>{t(`platform:posters.state${capitalize(poster.state)}`)}</Badge>
        {poster.state === 'assigned' && poster.assigned_at ? (
          <span className="mt-1 block text-xs text-ink-500">
            {poster.assigned_by_email ? t('platform:posters.assignedBy', { email: poster.assigned_by_email }) : null}{' '}
            {t('platform:posters.onDate', { date: intl.date(poster.assigned_at) })}
          </span>
        ) : null}
        {poster.state === 'revoked' && poster.revoke_reason ? (
          <span className="mt-1 block max-w-[16rem] text-xs text-ink-500">
            {t('platform:posters.revokeReasonShown', { reason: poster.revoke_reason })}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-ink-500">
        {poster.organization_name ? (
          <>
            <span className="block text-ink-950">{poster.organization_name}</span>
            {poster.location_name ? <span className="block text-xs">{poster.location_name}</span> : null}
          </>
        ) : (
          <span className="text-xs">{t('platform:posters.noShop')}</span>
        )}
      </TableCell>
      <TableCell className="text-xs text-ink-500">
        {poster.letter_prospect_name ? (
          <>
            <span className="block">{t('platform:posters.letterSentTo', { name: poster.letter_prospect_name })}</span>
            {poster.letter_generated_at ? (
              <span className="block whitespace-nowrap">
                {t('platform:posters.onDate', { date: intl.date(poster.letter_generated_at) })}
              </span>
            ) : null}
          </>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          {poster.state === 'free' ? (
            <Button variant="secondary" size="sm" onClick={onMail}>
              {t('platform:posters.prepareLetter')}
            </Button>
          ) : null}
          {poster.state === 'revoked' ? (
            <Button variant="secondary" size="sm" onClick={onAssign}>
              {t('platform:posters.reassign')}
            </Button>
          ) : null}
          {poster.state === 'revoked' ? null : (
            <Button variant="danger" size="sm" onClick={onRevoke}>
              {t('platform:posters.revoke')}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

/**
 * RÉVOQUER — ET LE MOTIF EST OBLIGATOIRE. Le serveur refuse sans
 * (`reason_required`), et la contrainte `posters_revoked_shape` l'exige en
 * base : « révoqué » sans raison est une perte de matériel qu'on ne peut pas
 * expliquer au salon qui appelle.
 */
function RevokeDialog({ poster, onClose }: { poster: PosterRow; onClose: () => void }) {
  const { t } = useTranslation()
  const refusal = useRefusalToast()
  const revoke = useRevokePoster()
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('platform:posters.revokeTitle', { code: poster.code })}</DialogTitle>
          <DialogDescription>{t('platform:posters.revokeBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Textarea
            label={t('platform:posters.revokeReason')}
            hint={t('platform:posters.revokeReasonHint')}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </DialogBody>
        <DialogFooter>
          <Button
            variant="danger"
            isLoading={revoke.isPending}
            disabled={trimmed.length === 0}
            onClick={() =>
              revoke.mutate(
                { code: poster.code, reason: trimmed },
                {
                  onSuccess: () => {
                    refusal.ok(t('platform:posters.revoked'))
                    onClose()
                  },
                  onError: (error) => refusal.fail(t('platform:posters.revokeError'), error),
                },
              )
            }
          >
            {t('platform:posters.revokeConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * RÉATTRIBUER UNE AFFICHE RÉVOQUÉE. Une affiche ATTRIBUÉE ne se détourne pas :
 * elle n'a pas ce bouton, et le serveur refuserait (`already_assigned`). Le
 * choix de l'établissement vient de `list_my_poster_locations`, qui ne rend
 * que ce à quoi l'appelant a le droit d'attribuer.
 */
function AssignDialog({ poster, onClose }: { poster: PosterRow; onClose: () => void }) {
  const { t } = useTranslation()
  const refusal = useRefusalToast()
  const locationsQuery = useMyPosterLocations()
  const assign = useAssignPoster()
  const [locationId, setLocationId] = useState('')

  const locations = locationsQuery.data ?? []

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('platform:posters.reassignTitle', { code: poster.code })}</DialogTitle>
          <DialogDescription>{t('platform:posters.reassignBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {locationsQuery.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : locationsQuery.isError ? (
            <ErrorState
              title={t('platform:posters.locationsError')}
              description={getErrorMessage(locationsQuery.error)}
            />
          ) : locations.length === 0 ? (
            <EmptyState title={t('platform:posters.locationsEmpty')} className="border-none" />
          ) : (
            <SelectField
              label={t('platform:posters.location')}
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              options={[
                { value: '', label: '—' },
                ...locations.map((location) => ({
                  value: location.location_id,
                  label: [location.organization_name, location.location_name, location.city]
                    .filter(Boolean)
                    .join(' · '),
                })),
              ]}
            />
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            isLoading={assign.isPending}
            disabled={!locationId}
            onClick={() =>
              assign.mutate(
                { code: poster.code, locationId },
                {
                  onSuccess: () => {
                    refusal.ok(t('platform:posters.assigned'))
                    onClose()
                  },
                  onError: (error) => refusal.fail(t('platform:posters.assignError'), error),
                },
              )
            }
          >
            {t('platform:posters.reassignConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * LA LETTRE AU PATRON.
 *
 * Elle ne marche que sur une affiche LIBRE (le serveur refuse sinon :
 * `not_free`), et elle MARQUE l'affiche comme partie par la poste vers ce
 * prospect — c'est ce marquage qui, plus tard, fait que le scan du code
 * propose la revendication si le salon n'est pas revendiqué.
 *
 * DEUX TEMPS, ET C'EST DÉLIBÉRÉ. On prépare (le serveur répond ce qu'il sait
 * vraiment du prospect), PUIS on fabrique. Entre les deux, l'écran dit si
 * l'analytics a un élément de preuve à mettre dans la lettre — ou si elle n'a
 * rien, auquel cas la lettre part SANS preuve plutôt qu'avec un chiffre
 * inventé.
 */
function LetterDialog({
  poster,
  pdfLocale,
  onPdfLocale,
  onDownload,
  onClose,
}: {
  poster: PosterRow
  pdfLocale: PdfLocale
  onPdfLocale: (locale: PdfLocale) => void
  onDownload: (letter: PosterLetterData) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const refusal = useRefusalToast()
  const [search, setSearch] = useState('')
  const [prospectId, setProspectId] = useState('')
  const [prepared, setPrepared] = useState<PosterLetterData | null>(null)
  const prospectsQuery = useProspects({ search: useDebounced(search), limit: 50 })
  const prepare = usePreparePosterLetter()

  const prospects = prospectsQuery.data ?? []
  const addressLines = prepared ? addressLinesFrom(prepared.address) : []
  /*
   * À L'ÉCRAN, la preuve est rédigée dans la langue de l'INTERFACE — c'est
   * l'interne qui la relit avant d'imprimer. Le PDF, lui, la reprend dans la
   * langue choisie pour la lettre : c'est le patron qui la lit. Mêmes clés,
   * mêmes chiffres, deux lecteurs.
   */
  const proofLines = prepared
    ? proofLinesFrom(i18n.getFixedT(i18n.language, 'platform'), i18n.language, prepared.proof)
    : []

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('platform:posters.letterTitle', { code: poster.code })}</DialogTitle>
          <DialogDescription>{t('platform:posters.letterIntro')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {prepared ? null : (
            <>
              <p className="text-sm text-ink-500">{t('platform:posters.letterMarks')}</p>
              <TextField
                label={t('platform:posters.prospectSearch')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              {prospectsQuery.isPending ? (
                <Skeleton className="h-10 w-full" />
              ) : prospectsQuery.isError ? (
                <ErrorState
                  title={t('platform:posters.prospectsError')}
                  description={getErrorMessage(prospectsQuery.error)}
                />
              ) : prospects.length === 0 ? (
                <EmptyState title={t('platform:posters.prospectsEmpty')} className="border-none" />
              ) : (
                <SelectField
                  label={t('platform:posters.prospect')}
                  value={prospectId}
                  onChange={(event) => setProspectId(event.target.value)}
                  options={[
                    { value: '', label: '—' },
                    ...prospects.map((prospect) => ({
                      value: prospect.id,
                      label: [prospect.canonical_name, prospect.city].filter(Boolean).join(' · '),
                    })),
                  ]}
                />
              )}
              <PdfLocaleField value={pdfLocale} onChange={onPdfLocale} />
            </>
          )}

          {prepared ? (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-sm font-medium text-ink-950">{prepared.business_name}</p>
                {addressLines.length > 0 ? (
                  addressLines.map((line) => (
                    <p key={line} className="text-sm text-ink-500">
                      {line}
                    </p>
                  ))
                ) : (
                  <Alert variant="warning">{t('platform:posters.letterAddressMissing')}</Alert>
                )}
              </div>

              {/* L'analytics parle, ou elle ne dit rien — et alors on le DIT. */}
              {proofLines.length > 0 ? (
                <div>
                  <p className="text-sm text-ink-950">{t('platform:posters.proofIncluded')}</p>
                  <ul className="mt-1 list-inside list-disc text-sm text-ink-500">
                    {proofLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Alert variant="warning">{t('platform:posters.proofNone')}</Alert>
              )}

              <PdfLocaleField value={pdfLocale} onChange={onPdfLocale} />
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {prepared ? (
            <Button onClick={() => onDownload(prepared)}>{t('platform:posters.downloadMailing')}</Button>
          ) : (
            <Button
              isLoading={prepare.isPending}
              disabled={!prospectId}
              onClick={() =>
                prepare.mutate(
                  { code: poster.code, prospectId },
                  {
                    onSuccess: (data) => {
                      setPrepared(data)
                      refusal.ok(t('platform:posters.letterPrepared', { name: data.business_name }))
                    },
                    onError: (error) => refusal.fail(t('platform:posters.letterError'), error),
                  },
                )
              }
            >
              {t('platform:posters.prepareConfirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * La recherche de prospect part sur la frappe apaisée, pas sur chaque touche :
 * sans ce délai, taper « Bellecour » déclenche neuf requêtes dont huit sont
 * jetées avant d'être lues.
 */
function useDebounced(value: string, delay = 250): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
