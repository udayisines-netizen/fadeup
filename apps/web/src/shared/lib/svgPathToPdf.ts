/**
 * PLAT-2 — traduction d'un tracé SVG en instructions de tracé PDF.
 *
 * POURQUOI. Le logo FadeUp est VERROUILLÉ (MASTER_SPEC §17) et il vit en SVG.
 * Le redessiner « à peu près » dans le PDF, ou le remplacer par le mot
 * « FadeUp » composé en Helvetica, ce serait imprimer un autre logo. Ce module
 * traduit la géométrie EXACTE : même tracé, en vecteur, dans le PDF.
 *
 * CE QU'IL COUVRE : M/m, L/l, H/h, V/v, C/c, Q/q (converti en cubique),
 * A/a (arc elliptique converti en cubiques), Z/z. C'est l'ensemble exact des
 * commandes qu'emploient `fadeup-wordmark.svg` (M, L, Q) et
 * `fadeup-mark-monochrome.svg` (M, A). Une commande inconnue LÈVE, au lieu de
 * produire un logo silencieusement faux.
 *
 * L'AXE Y EST INVERSÉ. SVG descend, PDF monte. La transformation est passée
 * par l'appelant sous forme d'échelle et d'origine, et appliquée ici point
 * par point — plutôt que par un `cm` PDF, pour que la largeur de trait reste
 * celle qu'on demande et non celle que l'échelle déforme.
 */

export interface SvgToPdfTransform {
  /** Le coin du viewBox SVG. */
  viewBox: { x: number; y: number; width: number; height: number }
  /** Où poser le coin BAS-GAUCHE de la boîte, en coordonnées PDF. */
  x: number
  y: number
  /** La largeur voulue en points ; la hauteur suit le rapport du viewBox. */
  width: number
}

interface Point {
  x: number
  y: number
}

const n = (value: number) => (Math.round(value * 1000) / 1000).toString()

/** Convertit un arc elliptique SVG en une suite de cubiques. */
type Cubic = [Point, Point, Point]

function arcToCubics(from: Point, rx: number, ry: number, rotationDeg: number, largeArc: boolean, sweep: boolean, to: Point): Cubic[] {
  if (rx === 0 || ry === 0) return [[from, from, to]]
  const phi = (rotationDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const dx2 = (from.x - to.x) / 2
  const dy2 = (from.y - to.y) / 2
  const x1p = cosPhi * dx2 + sinPhi * dy2
  const y1p = -sinPhi * dx2 + cosPhi * dy2

  let rxa = Math.abs(rx)
  let rya = Math.abs(ry)
  // Rayons trop petits pour joindre les deux points : SVG impose de les
  // agrandir plutôt que d'abandonner le tracé.
  const lambda = (x1p * x1p) / (rxa * rxa) + (y1p * y1p) / (rya * rya)
  if (lambda > 1) {
    const scale = Math.sqrt(lambda)
    rxa *= scale
    rya *= scale
  }

  const sign = largeArc === sweep ? -1 : 1
  const numerator = rxa * rxa * rya * rya - rxa * rxa * y1p * y1p - rya * rya * x1p * x1p
  const denominator = rxa * rxa * y1p * y1p + rya * rya * x1p * x1p
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator))
  const cxp = (coefficient * rxa * y1p) / rya
  const cyp = (-coefficient * rya * x1p) / rxa
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
    const value = Math.acos(Math.min(1, Math.max(-1, dot / len)))
    return ux * vy - uy * vx < 0 ? -value : value
  }

  const theta1 = angle(1, 0, (x1p - cxp) / rxa, (y1p - cyp) / rya)
  let deltaTheta = angle((x1p - cxp) / rxa, (y1p - cyp) / rya, (-x1p - cxp) / rxa, (-y1p - cyp) / rya)
  if (!sweep && deltaTheta > 0) deltaTheta -= 2 * Math.PI
  if (sweep && deltaTheta < 0) deltaTheta += 2 * Math.PI

  // Un quart de tour par cubique : l'erreur maximale est alors inférieure au
  // millième de rayon, très en dessous de la résolution d'une imprimante.
  const segments = Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2))
  const step = deltaTheta / segments
  const alpha = (4 / 3) * Math.tan(step / 4)

  const pointAt = (t: number): Point => ({
    x: cx + rxa * Math.cos(t) * cosPhi - rya * Math.sin(t) * sinPhi,
    y: cy + rxa * Math.cos(t) * sinPhi + rya * Math.sin(t) * cosPhi,
  })
  const derivativeAt = (t: number): Point => ({
    x: -rxa * Math.sin(t) * cosPhi - rya * Math.cos(t) * sinPhi,
    y: -rxa * Math.sin(t) * sinPhi + rya * Math.cos(t) * cosPhi,
  })

  const out: Cubic[] = []
  for (let i = 0; i < segments; i += 1) {
    const t1 = theta1 + i * step
    const t2 = t1 + step
    const p1 = pointAt(t1)
    const p2 = pointAt(t2)
    const d1 = derivativeAt(t1)
    const d2 = derivativeAt(t2)
    out.push([
      { x: p1.x + alpha * d1.x, y: p1.y + alpha * d1.y },
      { x: p2.x - alpha * d2.x, y: p2.y - alpha * d2.y },
      p2,
    ])
  }
  return out
}

/**
 * Les seules lettres qu'un tracé peut porter : les commandes gérées, plus le
 * « e » d'un exposant. Sans ce contrôle, une commande non gérée serait
 * AVALÉE par la liste d'arguments de la commande précédente — le tracé
 * sortirait faux SANS erreur, ce qui est exactement le défaut qu'on refuse
 * sur un logo.
 */
const ALLOWED_LETTERS = new Set('MmLlHhVvCcQqAaZzEe'.split(''))

function tokenize(path: string): { command: string; args: number[] }[] {
  for (const ch of path) {
    if (/[A-Za-z]/.test(ch) && !ALLOWED_LETTERS.has(ch)) {
      throw new Error(`commande de tracé SVG non gérée : ${ch}`)
    }
  }
  const out: { command: string; args: number[] }[] = []
  const pattern = /([MmLlHhVvCcQqAaZz])([^MmLlHhVvCcQqAaZz]*)/g
  let match = pattern.exec(path)
  while (match) {
    const args = ((match[2] ?? '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    out.push({ command: match[1] ?? '', args })
    match = pattern.exec(path)
  }
  return out
}

/**
 * Rend les instructions de tracé PDF correspondant au chemin SVG donné,
 * placées et mises à l'échelle par `transform`.
 */
export function svgPathToPdfOps(path: string, transform: SvgToPdfTransform): string {
  const { viewBox } = transform
  const scale = transform.width / viewBox.width
  const height = viewBox.height * scale
  // SVG descend, PDF monte : l'ordonnée est retournée dans la boîte.
  const toPdf = (p: Point) => ({
    x: transform.x + (p.x - viewBox.x) * scale,
    y: transform.y + height - (p.y - viewBox.y) * scale,
  })

  const ops: string[] = []
  let current: Point = { x: 0, y: 0 }
  let start: Point = { x: 0, y: 0 }

  const moveTo = (p: Point) => {
    const q = toPdf(p)
    ops.push(`${n(q.x)} ${n(q.y)} m`)
  }
  const lineTo = (p: Point) => {
    const q = toPdf(p)
    ops.push(`${n(q.x)} ${n(q.y)} l`)
  }
  const curveTo = (c1: Point, c2: Point, p: Point) => {
    const a = toPdf(c1)
    const b = toPdf(c2)
    const q = toPdf(p)
    ops.push(`${n(a.x)} ${n(a.y)} ${n(b.x)} ${n(b.y)} ${n(q.x)} ${n(q.y)} c`)
  }

  for (const { command, args } of tokenize(path)) {
    const relative = command === command.toLowerCase()
    const base = () => (relative ? current : { x: 0, y: 0 })
    // `noUncheckedIndexedAccess` : un argument absent vaut 0 plutôt qu'undefined.
    // Les bornes de boucle garantissent déjà la présence ; ce repli rend la
    // garantie lisible par le compilateur au lieu de la lui faire croire.
    const arg = (index: number): number => args[index] ?? 0
    switch (command.toUpperCase()) {
      case 'M': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const b = base()
          const p = { x: b.x + arg(i), y: b.y + arg(i + 1) }
          if (i === 0) {
            moveTo(p)
            start = p
          } else {
            lineTo(p)
          }
          current = p
        }
        break
      }
      case 'L': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const b = base()
          const p = { x: b.x + arg(i), y: b.y + arg(i + 1) }
          lineTo(p)
          current = p
        }
        break
      }
      case 'H': {
        for (const value of args) {
          const p = { x: (relative ? current.x : 0) + value, y: current.y }
          lineTo(p)
          current = p
        }
        break
      }
      case 'V': {
        for (const value of args) {
          const p = { x: current.x, y: (relative ? current.y : 0) + value }
          lineTo(p)
          current = p
        }
        break
      }
      case 'C': {
        for (let i = 0; i + 5 < args.length; i += 6) {
          const b = base()
          const c1 = { x: b.x + arg(i), y: b.y + arg(i + 1) }
          const c2 = { x: b.x + arg(i + 2), y: b.y + arg(i + 3) }
          const p = { x: b.x + arg(i + 4), y: b.y + arg(i + 5) }
          curveTo(c1, c2, p)
          current = p
        }
        break
      }
      case 'Q': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const b = base()
          const q = { x: b.x + arg(i), y: b.y + arg(i + 1) }
          const p = { x: b.x + arg(i + 2), y: b.y + arg(i + 3) }
          // Quadratique -> cubique : les deux points de contrôle sont aux
          // deux tiers du chemin vers le point de contrôle quadratique.
          curveTo(
            { x: current.x + (2 / 3) * (q.x - current.x), y: current.y + (2 / 3) * (q.y - current.y) },
            { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
            p,
          )
          current = p
        }
        break
      }
      case 'A': {
        for (let i = 0; i + 6 < args.length; i += 7) {
          const b = base()
          const p = { x: b.x + arg(i + 5), y: b.y + arg(i + 6) }
          for (const [c1, c2, end] of arcToCubics(current, arg(i), arg(i + 1), arg(i + 2), arg(i + 3) !== 0, arg(i + 4) !== 0, p)) {
            curveTo(c1, c2, end)
          }
          current = p
        }
        break
      }
      case 'Z': {
        ops.push('h')
        current = start
        break
      }
      default:
        // Une commande inconnue produirait un logo faux sans le dire.
        throw new Error(`commande de tracé SVG non gérée : ${command}`)
    }
  }
  return ops.join('\n')
}
