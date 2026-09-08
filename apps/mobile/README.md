# FadeUp — application iOS (M1a)

Application cliente native (Expo SDK 57, React Native 0.86, expo-router).
Périmètre M1a : socle, onboarding, recherche, profils publics. La file, la
réservation, le feed et le compte arrivent en M1b ; Sign in with Apple, les
liens universels, le push et la publication en M1c.

## Lancer dans Expo Go (iPhone réel)

1. Copier `.env.example` vers `.env.local` et renseigner la clé anon
   (publique par construction — valeur `ANON_KEY` de `infra/supabase/.env`).
2. `npm install`
3. Depuis un poste sur le MÊME réseau que l'iPhone : `npx expo start`,
   puis scanner le QR avec l'appareil photo.
   Depuis ce VPS (réseaux différents) : `npx expo start --tunnel`.
4. L'application parle à l'API de production (`https://fade-up.com`) —
   données réelles, aucune donnée fabriquée.

## Commandes

| Commande | Effet |
|---|---|
| `npm run typecheck` | TypeScript strict |
| `npm test` | tests de logique (vitest, Node — aucun simulateur requis) |
| `npm run lint` | eslint (config Expo + React Compiler) |
| `npm run check:drift` | la logique copiée d'apps/web n'a pas dérivé |
| `npx expo export --platform ios` | preuve de compilation du bundle Hermes |

## Architecture

Voir `docs/prompts/M1a.md` §5 et le rapport `docs/reports/M1A_RAPPORT.md`.
Règles : `features/*` n'importe jamais une autre feature ; le client
Supabase n'est importé que par `features/*/api/**` et `shared/data/**` ;
i18n en namespace `v2`, catalogues copiés du web (garde anti-dérive).
