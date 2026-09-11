/**
 * PLAT-2 — un écrivain PDF minimal, SANS DÉPENDANCE.
 *
 * POURQUOI PAS UNE BIBLIOTHÈQUE. Le lot demande « un PDF prêt à imprimer ».
 * Les bibliothèques du marché pèsent entre 300 Ko et 1 Mo une fois dans le
 * paquet, pour un besoin qui tient en trois primitives : du texte, des
 * rectangles, des tracés vectoriels. `apps/web/package.json` n'a pas bougé
 * depuis PLAT-1 et ne bouge pas ici non plus — le budget du graphe d'entrée
 * est une contrainte du dépôt (PERF), et ce module est de toute façon
 * chargé paresseusement avec l'écran des affiches.
 *
 * CE QU'IL SAIT FAIRE, ET RIEN DE PLUS : pages A4, les deux polices
 * standard Helvetica (jamais embarquées, c'est le point), des rectangles
 * pleins, et des tracés remplis ou caressés en coordonnées PDF. C'est
 * exactement ce que demandent une affiche et une lettre.
 *
 * CE QU'IL NE SAIT PAS FAIRE, ET QUI EST DÉCLARÉ : les polices standard de
 * PDF sont encodées en WinAnsi. Le latin étendu passe (français, espagnol,
 * italien, portugais, allemand) ; le japonais, l'arabe, le russe et le
 * chinois NON — ils exigeraient d'embarquer une police CJK/arabe, c'est-à-dire
 * plusieurs mégaoctets. `canEncodeWinAnsi()` permet à l'appelant de le SAVOIR
 * et de le dire à l'utilisateur, au lieu d'imprimer des points d'interrogation.
 */

/** A4 portrait, en points PostScript (72 pt = 1 pouce). */
export const A4 = { width: 595.28, height: 841.89 } as const
/** Un centimètre, en points. */
export const CM = 72 / 2.54

export type PdfFont = 'Helvetica' | 'Helvetica-Bold'

export interface PdfRgb {
  r: number
  g: number
  b: number
}

/** Les quelques caractères que WinAnsi place hors Latin-1. */
const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
}

function winAnsiByte(ch: string): number | null {
  const extra = WIN_ANSI_EXTRA[ch]
  if (extra !== undefined) return extra
  const code = ch.codePointAt(0) ?? 0
  // Latin-1 moins la zone de contrôle haute, que WinAnsi réattribue.
  if (code >= 0x20 && code <= 0x7e) return code
  if (code >= 0xa0 && code <= 0xff) return code
  return null
}

/** Vrai si TOUT le texte est représentable par les polices standard. */
export function canEncodeWinAnsi(text: string): boolean {
  for (const ch of text) {
    if (ch === '\n') continue
    if (winAnsiByte(ch) === null) return false
  }
  return true
}

/**
 * Échappe et encode une chaîne pour une littérale PDF. Un caractère hors
 * WinAnsi devient U+FFFD plutôt que de disparaître : si l'appelant a ignoré
 * `canEncodeWinAnsi`, le défaut doit se VOIR sur la page, pas se taire.
 */
function pdfString(text: string): string {
  let out = '('
  for (const ch of text) {
    const byte = winAnsiByte(ch) ?? 0x3f
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += '\\'
    out += String.fromCharCode(byte)
  }
  return `${out})`
}

const n = (value: number) => (Math.round(value * 1000) / 1000).toString()

/** Un contenu de page en construction. Coordonnées PDF : y vers le HAUT. */
export class PdfPage {
  private readonly ops: string[] = []

  fillColor(color: PdfRgb): this {
    this.ops.push(`${n(color.r)} ${n(color.g)} ${n(color.b)} rg`)
    return this
  }

  strokeColor(color: PdfRgb): this {
    this.ops.push(`${n(color.r)} ${n(color.g)} ${n(color.b)} RG`)
    return this
  }

  rect(x: number, y: number, width: number, height: number, mode: 'fill' | 'stroke' = 'fill'): this {
    this.ops.push(`${n(x)} ${n(y)} ${n(width)} ${n(height)} re ${mode === 'fill' ? 'f' : 'S'}`)
    return this
  }

  text(x: number, y: number, value: string, options: { font?: PdfFont; size?: number; charSpacing?: number } = {}): this {
    const font = options.font === 'Helvetica-Bold' ? '/F2' : '/F1'
    const size = options.size ?? 12
    this.ops.push('BT')
    if (options.charSpacing) this.ops.push(`${n(options.charSpacing)} Tc`)
    this.ops.push(`${font} ${n(size)} Tf ${n(x)} ${n(y)} Td ${pdfString(value)} Tj`)
    if (options.charSpacing) this.ops.push('0 Tc')
    this.ops.push('ET')
    return this
  }

  /** Une suite d'instructions de tracé déjà en coordonnées PDF. */
  path(commands: string, mode: 'fill' | 'stroke', options: { lineWidth?: number; lineCap?: 0 | 1 | 2 } = {}): this {
    this.ops.push('q')
    if (options.lineWidth !== undefined) this.ops.push(`${n(options.lineWidth)} w`)
    if (options.lineCap !== undefined) this.ops.push(`${options.lineCap} J`)
    this.ops.push(commands)
    this.ops.push(mode === 'fill' ? 'f' : 'S')
    this.ops.push('Q')
    return this
  }

  toStream(): string {
    return this.ops.join('\n')
  }
}

/**
 * LARGEUR APPROCHÉE d'un texte en Helvetica, en millièmes de cadratin. Les
 * chasses sont celles des métriques Adobe standard, tronquées aux caractères
 * que ce module imprime. Elle sert à CENTRER, pas à justifier : une erreur
 * d'un millième sur un titre centré ne se voit pas, et embarquer les 229
 * chasses complètes pour ça serait du poids sans bénéfice.
 */
const HELVETICA_WIDTHS: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '{': 334, '|': 260, '}': 334,
}

const HELVETICA_BOLD_WIDTHS: Record<string, number> = {
  ' ': 278, '!': 333, '"': 474, '#': 556, '$': 556, '%': 889, '&': 722, "'": 238,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611,
  '@': 975, A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 333, '\\': 278, ']': 333, '^': 584, _: 556, '`': 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500, '{': 389, '|': 280, '}': 389,
}

export function textWidth(text: string, size: number, font: PdfFont = 'Helvetica'): number {
  const table = font === 'Helvetica-Bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
  let total = 0
  for (const ch of text) {
    // Les lettres accentuées ont la chasse de leur base : « é » comme « e ».
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    total += table[base] ?? table[ch] ?? 556
  }
  return (total * size) / 1000
}

/** Coupe un texte en lignes qui tiennent dans `maxWidth`. */
export function wrapText(text: string, maxWidth: number, size: number, font: PdfFont = 'Helvetica'): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let current = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word
      if (textWidth(candidate, size, font) > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    lines.push(current)
  }
  return lines
}

/** Assemble les pages en un PDF complet et rend ses octets. */
export function buildPdf(pages: PdfPage[], meta: { title: string } = { title: 'FadeUp' }): Uint8Array {
  const objects: string[] = []
  const pageCount = pages.length
  // 1 catalogue, 2 pages, 3..(2+n) pages, puis les contenus, puis 2 polices.
  const firstPageObj = 3
  const firstContentObj = firstPageObj + pageCount
  const fontRegularObj = firstContentObj + pageCount
  const fontBoldObj = fontRegularObj + 1
  const infoObj = fontBoldObj + 1

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  const kids = pages.map((_, i) => `${firstPageObj + i} 0 R`).join(' ')
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`)

  pages.forEach((_, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(A4.width)} ${n(A4.height)}] ` +
        `/Resources << /Font << /F1 ${fontRegularObj} 0 R /F2 ${fontBoldObj} 0 R >> >> ` +
        `/Contents ${firstContentObj + i} 0 R >>`,
    )
  })

  pages.forEach((page) => {
    const stream = page.toStream()
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })

  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`)
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`)
  objects.push(`<< /Title ${pdfString(meta.title)} /Producer ${pdfString('FadeUp')} >>`)

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    body += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  // Latin-1 : chaque unité de code est un octet, ce qui est exactement ce que
  // `pdfString` a produit. Un encodage UTF-8 décalerait toutes les positions
  // de la table xref dès le premier accent.
  const bytes = new Uint8Array(body.length)
  for (let i = 0; i < body.length; i += 1) bytes[i] = body.charCodeAt(i) & 0xff
  return bytes
}
