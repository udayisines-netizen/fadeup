# P1 — Système motion FadeUp

Implémentation : `apps/web/src/styles/motion.css` (classes) +
`apps/web/src/shared/motion/index.ts` (aides WAAPI). Démonstration complète :
section « Motion » de `/dev/ui`, avec bascule de motion réduite.
**CSS + Web Animations API. Framer Motion interdit** (grep en critère).

## Durées et courbe

| Token | Valeur | Rôle |
|---|---|---|
| `--fu-dur-instant` | 120 ms | retour immédiat : pression, bascule |
| `--fu-dur-state` | 220 ms | transition d'état : sélection, pop, révélation |
| `--fu-dur-surface` | 320 ms | feuille, modale, changement de page, moments |
| `--fu-ease` | cubic-bezier(0.2, 0, 0, 1) | LA courbe — sortie rapide, arrivée posée |

## Comportements

| Interaction | Implémentation | Note |
|---|---|---|
| Pression | `.fu-press` (scale .97, 120 ms) | posé sur Button/IconButton/Chip |
| Survol | `transition-colors` 120 ms dans les primitives | couleur seulement, jamais de translation |
| Follow / Like | `pop(el)` WAAPI (scale 1→1.12→1, 220 ms) | l'objet actionné confirme |
| Feuille | `.fu-sheet-in` — bas <768, inline-end ≥768, variante RTL | 320 ms |
| Modale | `.fu-modal-in` — fondu + scale .96, keyframes portant le centrage (LTR/RTL) | 320 ms |
| Voile | `.fu-scrim-in` fondu | 320 ms |
| Changement de page | `.fu-page-in` — fondu SEUL | jamais de glissement de page |
| Révélation de contenu | `.fu-rise-in` (8 px + fondu) | **UNE par écran** |
| Succès de réservation | `celebrateSuccess(mark)` + `.fu-success-follow` (coche 320 ms, suite en fondu décalé 160 ms) | LE moment orchestré de cet écran |
| Mouvement de file | `measureTop(el)` → réordonner → `playReorder(el, top)` (FLIP 220 ms) | anime UNIQUEMENT l'élément modifié |
| État appelé | `.fu-called` (fond accent-soft → transparent, liseré accent persistant, 640 ms) | moment de marque de la file |
| Mise à jour realtime | `flashUpdate(el)` (fond brand → transparent, 320 ms) | l'élément modifié, jamais la liste |
| Passport | `.fu-passport-in` (12 px + scale .98 + fondu, 320 ms) | révélation du moment sombre |

## Principes non négociables

1. **Un seul moment orchestré par écran.** Les entrées en fondu-glissé sur
   chaque section et les hovers animés sur chaque carte sont le défaut
   générique — interdits.
2. La motion **répond à une action et montre ce qui a changé** (créneau
   verrouillé, position qui remonte, follow qui bascule). Elle informe,
   elle n'accompagne pas.
3. Les listes realtime **n'animent que l'élément modifié**.
4. Proscrits : rebond exagéré, animation lente, ressort permanent, flou
   dramatique, motion décorative, parallaxe.

## Motion réduite — non négociable

`prefers-reduced-motion: reduce` :
- règle globale (theme.css) : `animation-duration: .01ms`,
  `transition-property: opacity`, `transition-duration: 100ms` ;
- toutes les classes de motion.css vivent sous
  `@media (prefers-reduced-motion: no-preference)` — aucune translation,
  aucune échelle ne subsiste ;
- les aides WAAPI testent `prefersReducedMotion()` : transformations
  supprimées, au mieux un fondu < 100 ms (`flashUpdate`, `celebrateSuccess`).
Vérifié par le critère d'acceptation et simulable sur `/dev/ui`.

## Ce qui attend un écran réel (P2+)

Le succès de réservation, le mouvement de file et l'état appelé sont
implémentés et démontrés sur `/dev/ui`, mais leur cadence définitive se
règle sur les écrans réels (confirmation P2, Live Queue P2, TODAY P3) —
sans créer de nouveau vocabulaire : ces classes et aides sont le vocabulaire.
