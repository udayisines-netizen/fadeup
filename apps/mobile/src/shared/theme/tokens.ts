import { Platform, type TextStyle, type ViewStyle } from 'react-native'

/**
 * D1 transposé en natif — la TABLE de correspondance avec
 * apps/web/src/styles/tokens-consumer.css + theme.css (le code web fait foi
 * pour les valeurs ; ce module fait foi côté mobile).
 *
 * Le natif change la DÉCLARATION, jamais l'intention (M1a §4) :
 *   - les ombres CSS multicouches deviennent shadow* iOS (+ elevation
 *     Android) — teintées d'encre (#080F0D), jamais grises ;
 *   - `var(--font-fu-sans)` devient un nom de police chargée par expo-font ;
 *   - l'échelle text-fu-* garde ses valeurs : 12 (badges SEULEMENT) /
 *     14 plancher / 16 / 20 / 24 / 32 / 44.
 *
 * Les LOIS ne changent pas : encre sur vert pour tout CTA vert
 * (#080F0D sur #00C27A, 8,30:1 — blanc sur vert INTERDIT, 2,33:1), null
 * n'est pas zéro, le bleu n'existe pas, le logo est le seul dégradé.
 */

export const color = {
  /* Fond clair D1 — papier teinté vert, surfaces blanches qui se détachent. */
  canvas: '#F6F8F7',
  surface: '#FFFFFF',
  surfaceSubtle: '#F2F5F3',
  surfaceBrand: '#E6FFF3',

  textPrimary: '#080F0D' /* 19,36:1 */,
  textSecondary: 'rgba(8, 15, 13, 0.62)' /* 5,48:1 */,
  textTertiary: 'rgba(8, 15, 13, 0.42)',

  border: 'rgba(8, 15, 13, 0.1)',
  borderStrong: 'rgba(8, 15, 13, 0.18)',

  accent: '#00C27A',
  accentPressed: '#00875A',
  /** Encre sur vert — la loi. JAMAIS #FFFFFF sur l'accent (2,33:1). */
  accentFg: '#080F0D',
  accentSoft: '#E6FFF3',
  /** Vert TEXTE — approfondi D1 : 5,04:1 sur le papier #F6F8F7. */
  accentText: '#007A52',
  /** Encre décorative du monogramme de repli (jamais pour du texte). */
  brandWatermark: 'rgba(0, 135, 90, 0.18)',

  success: '#007A52',
  danger: '#B23F3C',

  focus: '#00875A',
  scrim: 'rgba(8, 15, 13, 0.48)',

  /* Thème `moment` (sombre composé #071310) — D1 §9, complété par M1b depuis
     apps/web/src/styles/tokens-moment.css (le web fait foi pour les valeurs).
     Deux écrans le rendent : le suivi de file et la confirmation de
     réservation. PAS une inversion mécanique : le vert vif reprend de la
     force, l'encre sur vert reste la loi (jamais de blanc sur vert). */
  moment: {
    canvas: '#071310',
    surface: '#0D1F18',
    surfaceSubtle: '#0A1A14',
    textPrimary: '#EAF6F0' /* ≈16:1 sur le fond */,
    textSecondary: 'rgba(234, 246, 240, 0.66)',
    textTertiary: 'rgba(234, 246, 240, 0.4)',
    border: 'rgba(234, 246, 240, 0.12)',
    borderStrong: 'rgba(234, 246, 240, 0.22)',
    accent: '#00C27A',
    accentPressed: '#28E18E',
    accentFg: '#080F0D' /* encre sur vert, 8,30:1 — jamais blanc */,
    accentSoft: 'rgba(40, 225, 142, 0.16)',
    accentText: '#2FE59B',
    success: '#28E18E',
    danger: '#F2827C' /* lisible sur sombre — texte uniquement */,
    focus: '#28E18E',
    scrim: 'rgba(0, 0, 0, 0.66)',
    brandWatermark: 'rgba(40, 225, 142, 0.1)',
  },
} as const

/** Hiérarchie de rayons D1 (jamais un rayon uniforme). */
export const radius = {
  control: 8,
  card: 16,
  media: 10,
  modal: 16,
  sheet: 20,
  avatar: 9999,
} as const

/** Échelle typographique — 12 réservé aux badges, RIEN de lisible sous 14. */
export const fontSize = {
  badge: 12,
  sm: 14,
  base: 16,
  lg: 20,
  xl: 24,
  display: 32,
  hero: 44,
} as const

/**
 * Familles chargées par expo-font (voir app/_layout) — Poppins est
 * l'interface CLIENT (D1 §1), Geist Mono porte TOUTE donnée numérique
 * alignée (prix, horaires, positions, distances).
 */
export const font = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const

/** Chiffres à chasse fixe — obligatoire sur toute donnée numérique alignée. */
export const tabularNums: TextStyle = {
  fontFamily: font.mono,
  fontVariant: ['tabular-nums'],
}

export const spacing = (n: number): number => n * 4

/**
 * Élévation D1 → ombres natives. Teinte d'encre (#080F0D), opacités calées
 * sur les ombres CSS de tokens-consumer.css ; `elevation` porte Android.
 */
const inkShadow = (opacity: number, radiusPx: number, offsetY: number, elevation: number): ViewStyle =>
  Platform.select<ViewStyle>({
    android: { elevation, shadowColor: '#080F0D' },
    default: {
      shadowColor: '#080F0D',
      shadowOpacity: opacity,
      shadowRadius: radiusPx,
      shadowOffset: { width: 0, height: offsetY },
    },
  }) as ViewStyle

export const shadow = {
  /** Carte au repos (--fu-shadow-card). */
  card: inkShadow(0.07, 14, 4, 3),
  /** Carte pressée/survolée (--fu-shadow-card-hover). */
  cardPressed: inkShadow(0.1, 20, 6, 6),
  /** La feuille au-dessus de la liste (--fu-shadow-sheet). */
  sheet: inkShadow(0.18, 28, -8, 16),
  /** Barre collante (--fu-shadow-sticky). */
  sticky: inkShadow(0.06, 16, -4, 8),
} as const

/** Durées de motion (theme.css) — 120 retour immédiat / 220 état / 320 feuille. */
export const duration = {
  instant: 120,
  state: 220,
  sheet: 320,
} as const

/** Le ressort D1 de la feuille (stiffness 420 / damping 36 — D1 §8). */
export const sheetSpring = { stiffness: 420, damping: 36, mass: 1 } as const

/** Cible tactile minimale (WCAG / lois re-signées D1). */
export const touchTarget = 44
