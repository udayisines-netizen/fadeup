import tsParser from '@typescript-eslint/parser'
import boundaries from 'eslint-plugin-boundaries'
import i18next from 'eslint-plugin-i18next'

/**
 * P1b §12 — les trois règles bloquantes qu'oxlint ne couvre pas. oxlint
 * reste le runner principal (rapide, strict) ; `npm run lint` exécute LES
 * DEUX et échoue si l'un des deux échoue. Périmètre : l'arbre V2
 * (src/shared, src/features, src/app) — le code legacy /platform garde ses
 * propres règles.
 */

/* Classes de couleur Tailwind par défaut — la palette FadeUp est FERMÉE. */
const DEFAULT_TAILWIND_COLOR =
  '(?:^|[\\s:])(?:text|bg|border|ring|fill|stroke|outline|decoration|divide|accent|caret|shadow)-(?:white|black|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\\d{2,3})?)(?:$|[\\s/])'

export default [
  {
    files: ['src/shared/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { boundaries, i18next },
    settings: {
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/**', mode: 'full' },
        { type: 'feature', pattern: 'src/features/*/**', mode: 'full', capture: ['featureName'] },
        { type: 'app', pattern: 'src/app/**', mode: 'full' },
        // Le moteur legacy conservé (auth-context, i18n, locale, supabase…).
        { type: 'legacy', pattern: 'src/(lib|i18n|components|pages|routes|locales)/**', mode: 'full' },
      ],
      'boundaries/dependency-nodes': ['import', 'dynamic-import'],
      'boundaries/root-path': import.meta.dirname,
      // Résolution de l'alias @ → src pour que chaque import soit rattaché à
      // son élément (sans résolution, la règle ne voit rien).
      'import/resolver': { typescript: { project: './tsconfig.app.json' } },
    },
    rules: {
      /* ── Règle 1 : frontières ────────────────────────────────────────
         shared → shared (+ ponts legacy documentés) ;
         features/X → shared + features/X, JAMAIS features/Y ;
         app → tout. */
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'shared' } },
              allow: [{ to: { element: { type: 'shared' } } }, { to: { element: { type: 'legacy' } } }],
            },
            {
              from: { element: { type: 'feature' } },
              allow: [
                { to: { element: { type: 'shared' } } },
                { to: { element: { type: 'feature', captured: { featureName: '{{from.captured.featureName}}' } } } },
              ],
            },
            {
              from: { element: { type: 'app' } },
              allow: [
                { to: { element: { type: 'shared' } } },
                { to: { element: { type: 'feature' } } },
                { to: { element: { type: 'app' } } },
                { to: { element: { type: 'legacy' } } },
              ],
            },
          ],
        },
      ],

      /* ── Règle 2 : client Supabase confiné ──────────────────────────
         `@/shared/lib/supabase` est interdit partout ; les exceptions
         (features/x/api/**, infrastructure shared) sont rouvertes plus bas. */
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/shared/lib/supabase',
              message:
                'Le client Supabase est confiné à features/*/api/** (et à l’infrastructure shared data/realtime/hooks). Passe par une fonction API.',
            },
            {
              name: '@/lib/supabase',
              message: 'Code V2 : importe le client typé via une API de feature, jamais le client legacy.',
            },
          ],
        },
      ],

      /* ── Règle 3 : palette fermée ───────────────────────────────────
         Ni classe de couleur Tailwind par défaut, ni hexadécimal en dur
         dans le code V2 — toute couleur vient des tokens --fu-*. */
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${DEFAULT_TAILWIND_COLOR}/]`,
          message: 'Classe de couleur Tailwind par défaut interdite — utilise les tokens --fu-*.',
        },
        {
          selector: `TemplateElement[value.raw=/${DEFAULT_TAILWIND_COLOR}/]`,
          message: 'Classe de couleur Tailwind par défaut interdite — utilise les tokens --fu-*.',
        },
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{6}\\b/]',
          message: 'Hexadécimal en dur interdit dans le TSX — utilise les tokens --fu-*.',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{6}\\b/]',
          message: 'Hexadécimal en dur interdit dans le TSX — utilise les tokens --fu-*.',
        },
      ],

      /* ── i18n : zéro chaîne en dur dans le JSX V2. ──────────────────── */
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-text-only',
          'should-validate-template': true,
        },
      ],
    },
  },

  /* Exceptions à la règle 2 : la couche API des features et l'infrastructure
     data/realtime/session de shared sont LES endroits qui parlent à Supabase. */
  {
    files: [
      'src/features/*/api/**/*.{ts,tsx}',
      'src/shared/lib/**/*.ts',
      'src/shared/data/**/*.ts',
      'src/shared/realtime/**/*.{ts,tsx}',
      'src/shared/hooks/useSession.ts',
      'src/shared/hooks/useAccess.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  /* La galerie /dev/ui (DEV uniquement) étiquette ses sections avec des noms
     techniques de primitives — pas de la copie produit. */
  {
    files: ['src/features/dev-ui/**/*.tsx'],
    rules: {
      'i18next/no-literal-string': 'off',
    },
  },

  /* Les fixtures de test ne sont pas de la copie produit. */
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'i18next/no-literal-string': 'off',
    },
  },
]
