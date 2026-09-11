import { create as createQr } from 'qrcode'
import { A4, CM, PdfPage, buildPdf, canEncodeWinAnsi, textWidth, wrapText, type PdfRgb } from '@/shared/lib/pdf'
import { svgPathToPdfOps } from '@/shared/lib/svgPathToPdf'
import {
  FADEUP_MARK_ARCS,
  FADEUP_MARK_STROKE_WIDTH,
  FADEUP_MARK_VIEWBOX,
  FADEUP_WORDMARK_PATH,
  FADEUP_WORDMARK_VIEWBOX,
} from '@/shared/lib/fadeupBrandPaths'

/**
 * PLAT-2 — LES DEUX DOCUMENTS IMPRIMABLES.
 *
 * L'AFFICHE, pour le client dans le salon : le QR en grand, une accroche
 * tournée vers le bénéfice, le logo, et le code EN CLAIR en tout petit sous
 * le QR — pour le cas où l'impression est abîmée et où quelqu'un doit le
 * dicter au téléphone.
 *
 * LA LETTRE, pour le patron qui la reçoit par la poste : son nom, son
 * adresse, et UN ÉLÉMENT DE PREUVE tiré de l'analytics réelle. Le reste est
 * générique.
 *
 * DEUX RÈGLES QUE CE MODULE NE PEUT PAS ENFREINDRE
 *
 * 1. **Aucune promesse de notification.** Les notifications applicatives
 *    n'existent pas avant M1c. L'accroche dit ce qui est VRAI aujourd'hui :
 *    on scanne, on suit son tour EN DIRECT sur son téléphone, on peut sortir.
 *    Aucun « on vous prévient », aucun « vous recevrez une alerte ».
 *    Le texte vient de l'appelant (il est traduit) ; c'est à l'écran des
 *    affiches de ne pas fournir une accroche menteuse, et les chaînes livrées
 *    par ce lot respectent la règle.
 * 2. **Aucune preuve inventée.** `letter.proof` peut valoir `null` : la
 *    lettre part alors SANS élément de preuve, pas avec une phrase de repli
 *    chiffrée.
 */

const INK: PdfRgb = { r: 0.031, g: 0.059, b: 0.051 }
const MUTED: PdfRgb = { r: 0.4, g: 0.463, b: 0.431 }
const WHITE: PdfRgb = { r: 1, g: 1, b: 1 }

/**
 * LE QR FAIT NEUF CENTIMÈTRES DE CÔTÉ — le lot en exige huit au minimum. La
 * marge d'un centimètre n'est pas décorative : un QR imprimé puis plastifié,
 * scanné de biais dans un salon mal éclairé, perd de la marge de correction,
 * et c'est la taille du module qui la rend.
 */
const QR_SIZE = 9 * CM

/** La zone de silence exigée par la norme : quatre modules de chaque côté. */
const QR_QUIET_MODULES = 4

function drawQr(page: PdfPage, value: string, x: number, y: number, size: number): void {
  const qr = createQr(value, { errorCorrectionLevel: 'M' })
  const modules = qr.modules
  const total = modules.size + QR_QUIET_MODULES * 2
  const cell = size / total

  page.fillColor(WHITE).rect(x, y, size, size)
  page.fillColor(INK)
  for (let row = 0; row < modules.size; row += 1) {
    // Les modules noirs d'une même ligne sont fusionnés en un seul rectangle :
    // un QR de 33 modules donne sinon un millier d'ordres de dessin, et
    // certaines imprimantes laissent apparaître un liseré blanc entre deux
    // rectangles adjacents.
    let runStart: number | null = null
    for (let col = 0; col <= modules.size; col += 1) {
      const filled = col < modules.size && modules.data[row * modules.size + col] === 1
      if (filled && runStart === null) runStart = col
      if (!filled && runStart !== null) {
        page.rect(
          x + (QR_QUIET_MODULES + runStart) * cell,
          y + size - (QR_QUIET_MODULES + row + 1) * cell,
          (col - runStart) * cell,
          cell,
        )
        runStart = null
      }
    }
  }
}

function drawMark(page: PdfPage, x: number, y: number, size: number, color: PdfRgb): void {
  page.strokeColor(color)
  const transform = { viewBox: FADEUP_MARK_VIEWBOX, x, y, width: size }
  const scale = size / FADEUP_MARK_VIEWBOX.width
  for (const arc of FADEUP_MARK_ARCS) {
    // Bouts ronds et largeur de trait mise à l'échelle comme la géométrie :
    // c'est ce qui rend les trois arcs identiques au fichier de marque.
    page.path(svgPathToPdfOps(arc, transform), 'stroke', {
      lineWidth: FADEUP_MARK_STROKE_WIDTH * scale,
      lineCap: 1,
    })
  }
}

function drawWordmark(page: PdfPage, x: number, y: number, width: number, color: PdfRgb): void {
  page.fillColor(color)
  page.path(svgPathToPdfOps(FADEUP_WORDMARK_PATH, { viewBox: FADEUP_WORDMARK_VIEWBOX, x, y, width }), 'fill')
}

function centered(page: PdfPage, text: string, y: number, size: number, font: 'Helvetica' | 'Helvetica-Bold'): void {
  page.text((A4.width - textWidth(text, size, font)) / 2, y, text, { font, size })
}

export interface PosterCopy {
  /** L'accroche, courte, tournée vers le bénéfice. */
  headline: string
  /** La phrase d'action. Jamais de promesse de notification. */
  action: string
  /** Le libellé au-dessus du code en clair. */
  codeLabel: string
  /** L'adresse à taper si le QR est illisible, sans le code. */
  fallbackLabel: string
}

export interface PosterDocumentInput {
  code: string
  /** L'origine publique, pour construire l'URL encodée dans le QR. */
  origin: string
  copy: PosterCopy
}

/** L'URL qu'encode le QR d'une affiche. Courte, pour un QR à gros modules. */
export function posterUrl(origin: string, code: string): string {
  return new URL(`/a/${encodeURIComponent(code)}`, origin).toString()
}

function posterPage(input: PosterDocumentInput): PdfPage {
  const page = new PdfPage()
  const { copy } = input
  page.fillColor(WHITE).rect(0, 0, A4.width, A4.height)

  // Le logo en tête : le mark, puis le wordmark, alignés sur la même ligne
  // de base optique.
  const markSize = 1.6 * CM
  const wordmarkWidth = 4.6 * CM
  const logoWidth = markSize + 0.5 * CM + wordmarkWidth
  const logoX = (A4.width - logoWidth) / 2
  const logoY = A4.height - 3.2 * CM
  drawMark(page, logoX, logoY, markSize, INK)
  const wordmarkHeight = (FADEUP_WORDMARK_VIEWBOX.height / FADEUP_WORDMARK_VIEWBOX.width) * wordmarkWidth
  drawWordmark(page, logoX + markSize + 0.5 * CM, logoY + (markSize - wordmarkHeight) / 2, wordmarkWidth, INK)

  // L'accroche, sur au plus trois lignes.
  page.fillColor(INK)
  const headlineSize = 30
  const headlineLines = wrapText(copy.headline, A4.width - 4 * CM, headlineSize, 'Helvetica-Bold').slice(0, 3)
  let cursor = A4.height - 5 * CM
  for (const line of headlineLines) {
    centered(page, line, cursor, headlineSize, 'Helvetica-Bold')
    cursor -= headlineSize * 1.2
  }

  // LE QR, centré, neuf centimètres.
  const qrY = cursor - 0.8 * CM - QR_SIZE
  drawQr(page, posterUrl(input.origin, input.code), (A4.width - QR_SIZE) / 2, qrY, QR_SIZE)

  // LE CODE EN CLAIR, en tout petit sous le QR. C'est le filet quand
  // l'impression est abîmée : il se dicte au téléphone.
  page.fillColor(MUTED)
  centered(page, copy.codeLabel, qrY - 0.7 * CM, 9, 'Helvetica')
  page.fillColor(INK)
  const codeSize = 13
  page.text(
    (A4.width - textWidth(input.code, codeSize, 'Helvetica-Bold') - 2 * codeSize * 0.12) / 2,
    qrY - 1.3 * CM,
    input.code,
    { font: 'Helvetica-Bold', size: codeSize, charSpacing: codeSize * 0.12 },
  )

  // La phrase d'action, en bas.
  page.fillColor(INK)
  const actionSize = 15
  let actionCursor = qrY - 2.6 * CM
  for (const line of wrapText(copy.action, A4.width - 5 * CM, actionSize, 'Helvetica').slice(0, 3)) {
    centered(page, line, actionCursor, actionSize, 'Helvetica')
    actionCursor -= actionSize * 1.35
  }

  page.fillColor(MUTED)
  centered(page, copy.fallbackLabel, 1.8 * CM, 9, 'Helvetica')
  return page
}

/** Une affiche par code, dans un seul PDF prêt à imprimer. */
export function buildPosterPdf(codes: string[], origin: string, copy: PosterCopy): Uint8Array {
  return buildPdf(
    codes.map((code) => posterPage({ code, origin, copy })),
    { title: 'FadeUp' },
  )
}

export interface LetterCopy {
  /** « Madame, Monsieur, » ou l'équivalent local. */
  salutation: string
  /** Deux ou trois paragraphes génériques, séparés par des sauts de ligne. */
  body: string
  /** Introduit l'élément de preuve. Reçoit le nombre déjà formaté. */
  proofHeading: string
  proofLines: string[]
  /** Ce qu'il faut faire du code. */
  callToAction: string
  signature: string
  codeLabel: string
}

export interface LetterDocumentInput {
  code: string
  origin: string
  businessName: string
  addressLines: string[]
  copy: LetterCopy
}

/**
 * LA LETTRE. Ce qui est personnalisé : le nom du salon, son adresse, le code,
 * et l'élément de preuve — qui est passé DÉJÀ RÉDIGÉ par l'appelant, parce
 * que le formatage d'un nombre et d'une date dépend de la langue et que ce
 * module ne connaît pas la locale.
 */
function letterPage(input: LetterDocumentInput): PdfPage {
  const page = new PdfPage()
  const { copy } = input
  const margin = 2.5 * CM
  const contentWidth = A4.width - margin * 2
  page.fillColor(WHITE).rect(0, 0, A4.width, A4.height)

  const markSize = 1.3 * CM
  drawMark(page, margin, A4.height - 2.4 * CM, markSize, INK)
  const wordmarkWidth = 3.6 * CM
  const wordmarkHeight = (FADEUP_WORDMARK_VIEWBOX.height / FADEUP_WORDMARK_VIEWBOX.width) * wordmarkWidth
  drawWordmark(page, margin + markSize + 0.4 * CM, A4.height - 2.4 * CM + (markSize - wordmarkHeight) / 2, wordmarkWidth, INK)

  // Le bloc adresse, à droite, à la hauteur d'une fenêtre d'enveloppe.
  page.fillColor(INK)
  let cursor = A4.height - 5.5 * CM
  page.text(A4.width / 2, cursor, input.businessName, { font: 'Helvetica-Bold', size: 11 })
  cursor -= 15
  page.fillColor(MUTED)
  for (const line of input.addressLines.filter(Boolean)) {
    page.text(A4.width / 2, cursor, line, { size: 10 })
    cursor -= 13
  }

  page.fillColor(INK)
  cursor = A4.height - 9 * CM
  page.text(margin, cursor, copy.salutation, { size: 11 })
  cursor -= 22

  for (const line of wrapText(copy.body, contentWidth, 11)) {
    page.text(margin, cursor, line, { size: 11 })
    cursor -= 15
  }

  // L'ÉLÉMENT DE PREUVE, dans un encadré. Absent quand l'analytics ne dit
  // rien : l'appelant passe alors `proofLines` vide, et le bloc entier saute.
  if (copy.proofLines.length > 0) {
    cursor -= 10
    const boxHeight = 22 + copy.proofLines.length * 15
    page.strokeColor(MUTED).rect(margin, cursor - boxHeight + 12, contentWidth, boxHeight, 'stroke')
    page.fillColor(INK)
    page.text(margin + 12, cursor - 6, copy.proofHeading, { font: 'Helvetica-Bold', size: 11 })
    let proofCursor = cursor - 24
    for (const line of copy.proofLines) {
      page.text(margin + 12, proofCursor, line, { size: 11 })
      proofCursor -= 15
    }
    cursor = cursor - boxHeight - 4
  }

  cursor -= 18
  for (const line of wrapText(copy.callToAction, contentWidth, 11)) {
    page.text(margin, cursor, line, { size: 11 })
    cursor -= 15
  }

  // LE CODE, en clair et en gros : c'est l'objet de la lettre.
  cursor -= 14
  page.fillColor(MUTED).text(margin, cursor, copy.codeLabel, { size: 9 })
  cursor -= 22
  page.fillColor(INK).text(margin, cursor, input.code, { font: 'Helvetica-Bold', size: 20, charSpacing: 2.4 })

  // Un QR de rappel, petit : la lettre n'est pas l'affiche, elle donne le
  // chemin le plus court à un patron qui a son téléphone en main.
  drawQr(page, posterUrl(input.origin, input.code), A4.width - margin - 3 * CM, cursor - 3.4 * CM, 3 * CM)

  page.fillColor(INK)
  for (const line of wrapText(copy.signature, contentWidth - 4 * CM, 11)) {
    cursor -= 34
    page.text(margin, cursor, line, { size: 11 })
    cursor += 19
  }
  return page
}

export function buildLetterPdf(input: LetterDocumentInput): Uint8Array {
  return buildPdf([letterPage(input)], { title: 'FadeUp' })
}

/** Les deux documents d'un même envoi, dans un seul PDF : lettre puis affiche. */
export function buildMailingPdf(input: LetterDocumentInput, posterCopy: PosterCopy): Uint8Array {
  return buildPdf([letterPage(input), posterPage({ code: input.code, origin: input.origin, copy: posterCopy })], {
    title: 'FadeUp',
  })
}

/**
 * Les langues que les polices standard de PDF savent écrire. Le japonais,
 * l'arabe, le russe et le chinois EXIGERAIENT d'embarquer une police entière
 * (plusieurs mégaoctets) : l'écran doit le dire plutôt que d'imprimer des
 * points d'interrogation. Vérifié au moment du rendu par `canEncodeWinAnsi`.
 */
export const PDF_LOCALES = ['fr', 'en', 'es', 'it', 'pt', 'de'] as const
export type PdfLocale = (typeof PDF_LOCALES)[number]

/** Vrai si tous ces textes sont imprimables par les polices standard. */
export function canPrintTexts(texts: string[]): boolean {
  return texts.every(canEncodeWinAnsi)
}

/** Déclenche le téléchargement d'un PDF fabriqué en mémoire. */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Révoqué au tour de boucle suivant : révoquer tout de suite annule le
  // téléchargement sur certains navigateurs.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
