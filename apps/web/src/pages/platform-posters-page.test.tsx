import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ToastProvider } from '@/components/ui/toast'
import {
  PDF_TEXT_KEYS,
  PlatformPostersPage,
  findNotificationPromise,
} from '@/pages/platform-posters-page'
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
} from '@/lib/queries/platform-plat2'
import { buildPosterPdf, canPrintTexts, downloadPdf } from '@/shared/lib/posterDocuments'
import type { PlatformPermission } from '@/lib/types'

vi.mock('@/routes/require-platform-role', () => ({ usePlatformPermissions: vi.fn() }))
vi.mock('@/lib/queries/platform-plat2', () => ({
  usePosterBatches: vi.fn(),
  usePosters: vi.fn(),
  useGeneratePosterBatch: vi.fn(),
  useRevokePoster: vi.fn(),
  useAssignPoster: vi.fn(),
  useMyPosterLocations: vi.fn(),
  usePreparePosterLetter: vi.fn(),
  useProspects: vi.fn(),
}))

/*
 * Le générateur de PDF est RÉEL partout ailleurs (il est testé chez lui) ;
 * ici on l'espionne, parce que ce qu'on veut prouver n'est pas son dessin
 * mais l'ordre des gestes : `canPrintTexts` est consulté AVANT toute
 * fabrication, et rien n'est fabriqué quand il dit non.
 */
vi.mock('@/shared/lib/posterDocuments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/posterDocuments')>()
  return {
    ...actual,
    canPrintTexts: vi.fn(() => true),
    buildPosterPdf: vi.fn(() => new Uint8Array([1])),
    buildMailingPdf: vi.fn(() => new Uint8Array([1])),
    downloadPdf: vi.fn(),
  }
})

const mockPermissions = vi.mocked(usePlatformPermissions)
const mockBatches = vi.mocked(usePosterBatches)
const mockPosters = vi.mocked(usePosters)
const mockGenerate = vi.mocked(useGeneratePosterBatch)
const mockRevoke = vi.mocked(useRevokePoster)
const mockAssign = vi.mocked(useAssignPoster)
const mockLocations = vi.mocked(useMyPosterLocations)
const mockLetter = vi.mocked(usePreparePosterLetter)
const mockProspects = vi.mocked(useProspects)
const mockCanPrint = vi.mocked(canPrintTexts)
const mockBuildPoster = vi.mocked(buildPosterPdf)
const mockDownload = vi.mocked(downloadPdf)

/**
 * LES CHAÎNES LIVRÉES, PAS UNE COPIE DE CONFORT.
 *
 * Tant que le lot qui rassemble les traductions de PLAT-2 ne les a pas
 * fusionnées, elles vivent dans le fichier de clés livré avec cet écran ;
 * ensuite, dans `src/locales/<lng>/platform.json` sous `posters`. Le test lit
 * la source qui existe, dans cet ordre, et EXIGE d'en trouver une : sans
 * cela, « aucune promesse de notification » ne prouverait rien.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const DELIVERED_KEYS =
  '/tmp/claude-1002/-home-fadeup-worktrees-plat2/44d74f03-fbb3-400c-a363-b70477b7a7a8/scratchpad/plat2-i18n/posters.json'

function deliveredStrings(locale: 'fr' | 'en'): Record<string, string> | null {
  if (existsSync(DELIVERED_KEYS)) {
    const parsed = JSON.parse(readFileSync(DELIVERED_KEYS, 'utf8')) as Record<string, Record<string, string>>
    if (parsed[locale]) return parsed[locale]
  }
  const merged = resolve(HERE, `../locales/${locale}/platform.json`)
  if (existsSync(merged)) {
    const parsed = JSON.parse(readFileSync(merged, 'utf8')) as { posters?: Record<string, string> }
    if (parsed.posters) return parsed.posters
  }
  return null
}

function query(data: unknown, extra: Record<string, unknown> = {}) {
  return { data, isPending: false, isError: false, isSuccess: true, error: null, ...extra } as never
}

function mutation(extra: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: undefined, ...extra } as never
}

function grant(...permissions: string[]) {
  mockPermissions.mockReturnValue({
    permissions: permissions as PlatformPermission[],
    can: (permission: PlatformPermission) => permissions.includes(permission),
  })
}

function renderPage() {
  return render(
    <ToastProvider>
      <PlatformPostersPage />
    </ToastProvider>,
  )
}

describe('PlatformPostersPage — /platform/posters', () => {
  beforeAll(() => {
    const en = deliveredStrings('en')
    if (!en) throw new Error('les clés `posters` ne sont introuvables ni au scratchpad ni dans src/locales')
    for (const lng of new Set([i18n.language, i18n.resolvedLanguage ?? 'en', 'en'])) {
      i18n.addResourceBundle(lng, 'platform', { posters: en }, true, true)
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockCanPrint.mockReturnValue(true)
    grant('poster.manage', 'poster.assign')
    mockBatches.mockReturnValue(query([]))
    mockPosters.mockReturnValue(query([]))
    mockGenerate.mockReturnValue(mutation())
    mockRevoke.mockReturnValue(mutation())
    mockAssign.mockReturnValue(mutation())
    mockLocations.mockReturnValue(query([]))
    mockLetter.mockReturnValue(mutation())
    mockProspects.mockReturnValue(query([]))
  })

  it("dit à un commercial que l'écran n'est pas pour lui, et ne monte aucune requête", () => {
    // Un commercial porte `poster.assign` (il attribue une affiche sur le
    // terrain) mais PAS `poster.manage` : générer un lot, révoquer et
    // préparer un envoi restent au fondateur et aux admins.
    grant('crm.read', 'marketplace.publish', 'poster.assign')

    renderPage()

    expect(screen.getByText("This desk isn't visible with your role")).toBeInTheDocument()
    expect(
      screen.getByText(
        'Generating a batch, revoking a poster and preparing a mailing are reserved to the founder and the admins.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate the batch' })).toBeNull()
    expect(screen.queryByLabelText('Batch label')).toBeNull()
    // La garde est un retour anticipé : aucun hook de données n'est monté.
    expect(mockBatches).not.toHaveBeenCalled()
    expect(mockPosters).not.toHaveBeenCalled()
  })

  it('ouvre sur le geste du lot : un libellé, un nombre, une note facultative', () => {
    renderPage()

    expect(screen.getByLabelText('Batch label')).toBeInTheDocument()
    const count = screen.getByLabelText('How many posters')
    expect(count).toHaveAttribute('min', '1')
    expect(count).toHaveAttribute('max', '500')
    expect(screen.getByLabelText('Note (optional)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate the batch' })).toBeInTheDocument()
  })

  it("propose le PDF juste après la génération, et consulte canPrintTexts AVANT de fabriquer", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      batch_id: 'b-1',
      label: 'Octobre',
      code_count: 2,
      created_at: '2026-09-11T09:00:00.000Z',
      codes: ['ABCDEFGHJK', '0123456789'],
    })
    mockGenerate.mockReturnValue(mutation({ mutateAsync }))

    renderPage()

    await user.type(screen.getByLabelText('Batch label'), 'Octobre')
    await user.click(screen.getByRole('button', { name: 'Generate the batch' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ count: 100, label: 'Octobre', note: null }))

    const download = await screen.findByRole('button', { name: 'Download the poster PDF' })
    await user.click(download)

    await waitFor(() => expect(mockBuildPoster).toHaveBeenCalled())

    // L'ORDRE EST LE SUJET : on demande d'abord si les polices standard
    // savent écrire ces textes, on fabrique ensuite.
    expect(mockCanPrint).toHaveBeenCalled()
    expect(mockCanPrint.mock.invocationCallOrder[0]!).toBeLessThan(mockBuildPoster.mock.invocationCallOrder[0]!)

    // Et ce sont bien les textes livrés qui sont contrôlés puis imprimés.
    const inspected = mockCanPrint.mock.calls[0]![0]
    expect(inspected).toContain(deliveredStrings('en')!.pdfHeadline)
    expect(findNotificationPromise(inspected)).toBeNull()

    expect(mockBuildPoster).toHaveBeenCalledWith(
      ['ABCDEFGHJK', '0123456789'],
      window.location.origin,
      expect.objectContaining({ headline: deliveredStrings('en')!.pdfHeadline }),
    )
    expect(mockDownload).toHaveBeenCalledWith(expect.any(Uint8Array), 'fadeup-affiches-octobre.pdf')
  })

  it("refuse d'imprimer des points d'interrogation quand les polices ne suivent pas", async () => {
    const user = userEvent.setup()
    mockCanPrint.mockReturnValue(false)
    mockGenerate.mockReturnValue(
      mutation({
        mutateAsync: vi.fn().mockResolvedValue({
          batch_id: 'b-1',
          label: 'Octobre',
          code_count: 1,
          created_at: '2026-09-11T09:00:00.000Z',
          codes: ['ABCDEFGHJK'],
        }),
      }),
    )

    renderPage()

    await user.type(screen.getByLabelText('Batch label'), 'Octobre')
    await user.click(screen.getByRole('button', { name: 'Generate the batch' }))
    await user.click(await screen.findByRole('button', { name: 'Download the poster PDF' }))

    expect(await screen.findByText('These texts cannot be printed')).toBeInTheDocument()
    expect(mockBuildPoster).not.toHaveBeenCalled()
    expect(mockDownload).not.toHaveBeenCalled()
  })

  it('ne promet aucune notification dans les textes imprimés, en français comme en anglais', () => {
    for (const locale of ['fr', 'en'] as const) {
      const strings = deliveredStrings(locale)
      expect(strings, `clés ${locale} introuvables`).not.toBeNull()

      const printed = PDF_TEXT_KEYS.map((key) => strings![key])
      // Une clé manquante rendrait le contrôle vide : on l'exige d'abord.
      for (const [index, value] of printed.entries()) {
        expect(value, `${locale}.${PDF_TEXT_KEYS[index]}`).toBeTruthy()
      }
      expect(findNotificationPromise(printed as string[]), `${locale} promet une notification`).toBeNull()
    }
  })

  it('attrape bien une promesse — sinon le contrôle précédent ne prouverait rien', () => {
    expect(findNotificationPromise(['Nous vous préviendrons dès que votre tour approche.'])).toBe('previen')
    expect(findNotificationPromise(['We will send you an alert when it is your turn.'])).toBe('alert')
    expect(findNotificationPromise(['Vous recevrez un SMS.'])).toBe('sms')
    expect(findNotificationPromise(['Scannez, suivez votre tour en direct, sortez prendre un café.'])).toBeNull()
  })

  it('dit pourquoi la langue du PDF est limitée à six, et propose exactement celles-là', () => {
    renderPage()

    const select = screen.getByLabelText('PDF language')
    expect(select).toBeInTheDocument()
    expect(
      screen.getByText(
        'Independent from the interface language. Six languages only: the standard PDF fonts cannot write Japanese, Arabic, Russian or Chinese, and embedding a font that covers them would weigh several megabytes.',
      ),
    ).toBeInTheDocument()
    expect(select.querySelectorAll('option')).toHaveLength(6)
  })

  it("rend le journal des lots avec sa répartition, et dit qu'il est vide quand il l'est", () => {
    renderPage()
    expect(screen.getByText('No batch has been generated yet.')).toBeInTheDocument()

    mockBatches.mockReturnValue(
      query([
        {
          id: 'b-1',
          label: 'Impression octobre',
          note: 'Tournée de Lyon',
          code_count: 100,
          free_count: 60,
          assigned_count: 30,
          revoked_count: 4,
          letters_prepared: 6,
          created_by_email: 'fondateur@fade-up.com',
          created_at: '2026-09-10T08:00:00.000Z',
        },
      ]),
    )
    renderPage()

    expect(screen.getByText('Impression octobre')).toBeInTheDocument()
    expect(screen.getByText('Tournée de Lyon')).toBeInTheDocument()
    expect(screen.getByText('fondateur@fade-up.com')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(1)
  })

  it("montre l'échec du journal plutôt qu'un tableau vide", () => {
    mockBatches.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('permission denied for function list_poster_batches'),
    } as never)

    renderPage()

    expect(screen.getByText("Couldn't load the batch log")).toBeInTheDocument()
    expect(screen.queryByText('No batch has been generated yet.')).toBeNull()
  })
})
