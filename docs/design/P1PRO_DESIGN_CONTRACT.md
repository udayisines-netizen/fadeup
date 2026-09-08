# P1PRO — CONTRAT DE DESIGN DE L'OS PROFESSIONNEL

**Pendant pro de `D1_DESIGN_CONTRACT.md`** (2026-09-08). D1 régit la surface
client ; ce document régit l'espace professionnel (`/dashboard`, `/setup`,
thème `pro`). Les trois lots d'OS qui suivent s'y conforment. Si une décision
visuelle manque ici, c'est un défaut de P1PRO : remonte-le, ne l'invente pas.

Références : D1_DESIGN_CONTRACT.md (lois communes re-signées) ·
MASTER_SPEC.md §14/§17 · V2_DATA_CONTRACT.md · le code fait foi pour les
valeurs (`apps/web/src/styles/tokens-pro.css`, `theme.css`, `motion.css`).
Écrans de preuve : `/dashboard` (accueil) et `/dashboard/requests`
(demandes), construits par ce lot.

---

## 0. CE QUI EST RÉVOQUÉ DE P1c — pour le pro, nommément

D1 a nommé ses révocations côté client. Voici celles du pro. Sont RÉVOQUÉS :

1. **« La rangée à filet fin comme seule primitive pro »** (la pratique de
   P1c §16 « dense » appliquée partout). La rangée RESTE la primitive des
   listes denses (agenda, file, historique, CRM, catalogue, équipe), mais
   les surfaces de décision — accueil, demandes, insights — se composent en
   **BLOCS** : des panneaux bordés (`--fu-border`, fond `--fu-surface`,
   rayon `--radius-card`) qui organisent la page à la manière de Notion.
   La hiérarchie vient de l'agencement des blocs, pas de la décoration.
2. **« Les chiffres au fil du texte »**. Les nombres deviennent du contenu
   principal : chaque écran de décision a **UN chiffre dominant** en
   `text-fu-3xl`/`text-fu-4xl` Geist Mono, les autres en secondaire. Jamais
   douze cartes de KPI identiques — quand tout a la même taille, le patron
   ne sait pas quoi regarder.
3. **« Un seul moment orchestré par écran » et « pas de motion »** (P1 §15
   appliqué au pro comme « rien »). Le registre pro est SOBRE MAIS PRÉSENT :
   les trois changements d'état réels sont animés (voir §5), le reste ne
   l'est pas.
4. **Rayons P1b** `card 12` → la hiérarchie D1 vaut aussi au pro :
   contrôle 8 / carte 16 / modale 16 / feuille 20 (tokens partagés de
   `theme.css`).

## 0bis. CE QUI NE CHANGE PAS (re-signé par P1PRO)

- **Geist reste la police du pro** (mesuré P1a : Poppins +33 % de hauteur à
  14 px). **Geist Mono + `tabular-nums` pour tout chiffre** : prix, heures,
  durées, positions, compteurs, échéances.
- **Fond sombre** `--fu-canvas #080f0d` / surfaces `#0f1a16`. **Zéro ombre
  au pro** : la hiérarchie passe par la valeur de fond et les bordures
  (`--fu-border` 10 %, `--fu-border-strong` 20 %). La seule exception
  reste `--fu-shadow-sticky` sous la barre d'action collante.
- **Couleurs d'état confinées au pro** : ambre `--fu-state-warn` (attente,
  retard, échéance qui approche), rouge `--fu-state-danger` (annulation,
  conflit, refus). Jamais exposées au consumer. Jamais la couleur seule :
  toujours un libellé ou une icône avec.
- **Encre sur vert pour tout CTA vert** (`--fu-accent-fg` sur
  `--fu-accent`, 8,30:1). Blanc sur vert INTERDIT — garde lint.
- **Étiquettes de section** : `font-fu-mono text-fu-xs tracking-widest`,
  l'idiome posé par P1c et déjà en production sur la file. C'est LA seule
  exception à l'interdit « majuscules espacées » — réservée aux têtes de
  bloc pro.
- **Lois produit** : aucune donnée fabriquée, `null` distinct de zéro,
  états vides honnêtes avec une action, WCAG AA, cibles 44 px mobile,
  focus visible, propriétés logiques CSS (RTL), le bleu n'existe pas.
- **Capacité absente = non rendue.** Jamais grisée, jamais cadenassée
  (`RequireCapability`, `PRO_NAV` conditionnel). Le rôle conditionne de
  même : ce qu'un rôle ne doit pas voir n'existe pas dans son DOM.

---

## 1. Le cas de référence — et ce qu'il change

**L'OS pro se compose pour le grand écran** (patron assis devant ses
chiffres) **et s'adapte au mobile** (barber debout, pro qui arrive d'un
e-mail sur son téléphone). C'est l'INVERSE du client, et c'est assumé.

Concrètement :

- ≥ 1024 px : latérale de navigation (existante, `ProShell`) + contenu en
  **grille de blocs** (2 colonnes de composition sur l'accueil, listes
  pleine largeur sur les surfaces denses). Le desktop est COMPOSÉ — jamais
  une colonne mobile étirée ni un centrage à 600 px.
- < 1024 px : les blocs s'empilent dans l'ordre de priorité opérationnelle,
  le tiroir remplace la latérale, les actions dominantes restent
  atteignables au pouce (barre collante si nécessaire, au-dessus de 44 px).
- Tout écran pro DOIT être pleinement utilisable en 390 px — MASTER_SPEC
  §14 l'exige. « Utilisable » = toutes les actions accessibles, aucun
  débordement horizontal, cibles 44 px.

## 2. Les trois références, traduites en règles

| Référence | Ce qu'on prend | Ce qu'on ne prend PAS |
|---|---|---|
| **Notion** | la structure en blocs, la hiérarchie par l'agencement, rien ne crie | le blanc, la légèreté typographique |
| **Apple Music** | le sombre profond, la typographie grande et confiante des titres, la latérale claire, la respiration là où elle a du sens | l'aération générale (un agenda n'est pas une bibliothèque à parcourir) |
| **Rigueur financière** | les nombres en très grand, Geist Mono, les tendances lisibles d'un coup d'œil, la hiérarchie stricte entre ce qui compte et le reste | la grille de KPI, le tableau de bord bancaire, la dataviz décorative |

## 3. LA FRONTIÈRE AÉRATION / DENSITÉ — la décision structurante

**La règle : on AÈRE ce qui se DÉCIDE, on DENSIFIE ce qui se BALAIE.**

Une surface est DENSE quand le professionnel y balaie une série d'objets
homogènes (créneaux, entrées de file, clients, prestations) pour en trouver
un ou en suivre l'évolution. Une surface est AÉRÉE quand le professionnel
doit y comprendre une situation et prendre une décision (accepter, trancher,
comprendre un chiffre).

| Surface | Régime | Forme |
|---|---|---|
| Accueil (`/dashboard`) | **AÉRÉ en composition** — blocs NOW / NEXT / demandes / chiffre dominant | blocs bordés, chiffre display, marges 16–24 px |
| — dont le fil TODAY | **DENSE à l'intérieur de son bloc** | rangées à filet fin, 1 ligne par rendez-vous |
| — dont le bloc QUEUE | **DENSE à l'intérieur de son bloc** | rangées position + prénom, compteur mono |
| Demandes à traiter (`/dashboard/requests`) | **AÉRÉ** — c'est l'écran de décision par excellence | un bloc par demande, échéance display, trois actions |
| Historique des demandes | **DENSE** | rangées à filet fin, issue en badge |
| Agenda | **DENSE** | huit heures visibles d'un coup, rangées/grille serrées |
| File (`/dashboard/queue`) | **DENSE** (existant F1b, conforme) | rangées, compteur display |
| Clients / CRM | **DENSE** | rangées |
| Catalogue, équipe | **DENSE** | rangées |
| Insights | **AÉRÉ** — un chiffre dominant, une lecture, une action | blocs, display, phrases (« insight > data dump ») |
| Réglages, billing | **AÉRÉ** mais sobre | blocs de formulaire |
| États vides, onboarding | **AÉRÉS** | une phrase honnête + une action |

Un agent en aval ne doit jamais avoir à deviner : si sa surface n'est pas
dans ce tableau, il applique la règle en gras et le CONSIGNE dans son
rapport.

Mesures du régime dense : ligne de rangée 44–52 px, texte 14 px
(`text-fu-sm`), méta en `--fu-text-secondary`, filet `--fu-border`,
AUCUN espace vertical décoratif entre rangées. Mesures du régime aéré :
padding de bloc 16 px (mobile) / 20–24 px (desktop), un seul niveau
d'imbrication de blocs, jamais de bloc vide décoratif.

## 4. Le traitement des chiffres

- **Un chiffre domine par écran de décision** : `text-fu-4xl` (44 px)
  en ≥ 1024, `text-fu-3xl` (32 px) en mobile, Geist Mono, tabular-nums,
  `--fu-text-primary`. L'accueil du patron : le revenu du jour. L'accueil
  du barber : ses prestations restantes. Les demandes : le temps restant de
  la plus urgente.
- Les chiffres secondaires : `text-fu-xl` max, même famille, libellé 14 px
  en secondaire SOUS le chiffre (jamais au-dessus en majuscules — les
  étiquettes tracking-widest coiffent les BLOCS, pas les nombres).
- **`null` n'est pas zéro** : une donnée absente s'affiche « — » avec un
  libellé honnête. Un revenu de 0 € un jour sans prestation terminée est un
  VRAI zéro et s'affiche. Une organisation sans historique n'affiche pas
  une grille de zéros : elle affiche l'état vide (§7).
- Les montants passent par `Money` (price_cents + devise de
  l'organisation). Aucune agrégation côté client qui invente une donnée :
  le revenu du jour est la somme des prix configurés des prestations
  TERMINÉES du jour — c'est un calcul, pas une invention, et il est nommé
  « revenu calculé » dans l'interface.
- Tendances : uniquement quand la période de comparaison existe réellement.
  Pas de « +12 % » sur un historique de trois jours.

## 5. La motion pro — registre sobre, jamais absent

Un outil ouvert cent fois par jour supporte mal le spectacle. Les ressorts
et transitions partagées de D1 restent au CLIENT. Le pro est en **CSS
seul** (`motion.css`), pas de Framer dans le chunk pro.

| Geste | Implémentation | Pourquoi |
|---|---|---|
| Retour à la pression | `fu-press` (scale .985, 120 ms) | retour immédiat |
| **Arrivée d'une nouvelle demande** | `fu-rise-in` sur la nouvelle entrée + `fu-update-flash` | un changement d'état réel : le voir évite de rafraîchir |
| **Mouvement d'une position de file** | FLIP F1b conservé + `fu-number-in` sur le compteur | idem |
| **Passage à « terminé »** | `fu-update-flash` sur la rangée puis sortie en fondu court | idem |
| Apparition des données | fondu court, JAMAIS de saut de mise en page (squelettes aux dimensions finales) | stabilité |
| Échéance < 15 min | le chiffre passe en `--fu-state-warn` (sans clignoter) | signal, pas décor |

**Ce qui n'est PAS animé** : la navigation entre sections, l'ouverture d'un
panneau ou d'un tiroir (apparition immédiate ou fondu < 100 ms), le survol
d'une rangée (changement de fond instantané `--fu-surface-hover`), les
étiquettes, les badges.

`prefers-reduced-motion` supprime translations et échelles, garde les
fondus < 100 ms — la neutralisation globale de `theme.css` s'applique.

## 6. Hiérarchie des CTA

- **primary** (vert plein `--fu-accent`, texte ENCRE `--fu-accent-fg`) :
  UN par surface, l'action qui fait avancer le métier — « Accepter » sur
  une demande, « Terminé » sur le rendez-vous en cours, « Appeler le
  suivant » sur la file.
- **secondary** (contour) : l'alternative honnête — « Proposer un autre
  horaire », « Voir l'agenda ».
- **tertiary** (texte) : navigation, « Voir tout ».
- **destructive** (rouge, réservé au pro) : « Refuser », « Annuler la
  réservation » — TOUJOURS derrière une confirmation quand un client
  attend derrière (refus de demande, annulation salon). Jamais l'action
  la plus accessible d'un groupe.
- `disabled` atténue sans cacher ; une capacité ABSENTE ne rend rien du
  tout (§0bis).

## 7. États

- **Vide sans historique** (organisation neuve) : une phrase qui dit ce que
  la surface montrera, une action réelle pour y arriver (« Partagez votre
  profil », « Ouvrez votre file », « Créez une réservation »). PAS de
  zéros décoratifs, pas de graphique vide.
- **Vide conjoncturel** (aucun rendez-vous aujourd'hui) : le dire
  simplement + l'action utile (bloquer un créneau, voir demain).
- **Chargement** : squelettes aux dimensions finales dans les blocs ;
  jamais un spinner plein écran sur l'accueil.
- **Erreur** : bloc d'erreur avec retry, `toAppError`, jamais le texte brut
  de l'API.
- **Expiré/urgent** : l'échéance qui défile est un compteur mono ; sous
  15 min elle passe en `--fu-state-warn` ; une demande expirée SORT de la
  liste (le backend la balaie ; l'UI ne propose jamais une action que la
  RPC refusera).

## 8. Rôles et capacités — qui voit quoi

Autorité : `membership_role` (lu du membership) + `get_organization_entitlements`
(`live_capabilities`). Le frontend CONDITIONNE, il n'autorise pas (RLS fait
foi).

| Élément | owner / manager | receptionist | barber | solo_professional* |
|---|---|---|---|---|
| Revenu (jour, montants agrégés) | ✓ | — | — | ✓ |
| Demandes (accepter/proposer/refuser) | ✓ | ✓ | — | ✓ |
| Agenda équipe / filtre par barber | ✓ | ✓ | vue équipe selon rôle, SA journée par défaut | — (pas d'entrée équipe) |
| File complète | ✓ | ✓ | sa file d'abord | ✓ |
| Équipe, billing, réglages | ✓ (billing : owner) | — | — | ✓ |

\* solo_professional = organisation sans équipe : AUCUNE entrée d'équipe ne
se rend (pas de filtre barber, pas de nav équipe, pas de « par barber »).

Un rôle qui ne voit pas un chiffre ne voit pas non plus son emplacement
vide : la composition se refait sans lui.

## 9. Écran de preuve 1 — l'accueil (`/dashboard`)

TODAY / NOW / NEXT / QUEUE (MASTER_SPEC §14), composé ainsi :

- **En-tête** : la date du jour, le lieu (si plusieurs), rien d'autre.
- **Le chiffre dominant** (bloc hero) : revenu calculé du jour pour
  owner/manager/solo (somme des prestations terminées, prix configurés) ;
  prestations restantes de SA journée pour un barber. Secondaires dessous :
  rendez-vous du jour, terminées, en attente de demandes (ambre si > 0).
- **NOW** : ce qui est au fauteuil (rendez-vous en cours ou client appelé),
  action « Terminé » en un geste (primary).
- **NEXT** : le prochain rendez-vous, l'heure en mono.
- **QUEUE** : compteur + premières entrées denses, lien vers la file
  (rendu seulement si capacité liveQueue).
- **TODAY** : le fil chronologique dense de la journée.
- **Demandes en attente** : bloc d'appel avec compte + échéance la plus
  proche, ambre, lien vers `/dashboard/requests` (rendu si des demandes
  existent ou si la capacité de les recevoir existe).

Desktop ≥ 1024 : hero + NOW/NEXT en colonne principale, QUEUE + demandes en
colonne latérale, TODAY dessous en pleine largeur. Mobile : NOW → demandes →
NEXT → chiffre → QUEUE → TODAY (l'opérationnel d'abord, debout).

## 10. Écran de preuve 2 — les demandes (`/dashboard/requests`)

Le pro arrive d'un e-mail, souvent en mobile. Comprendre en trois secondes,
répondre en un geste.

- **Liste des demandes en attente**, la plus urgente en tête (échéance la
  plus proche). Chaque bloc : service + prix, date/heure demandées (mono),
  barber si choisi, prénom du client, **échéance qui défile** (compteur
  mono, ambre < 15 min).
- **Trois actions** : Accepter (primary, la plus grande cible), Proposer un
  autre horaire (secondary → feuille de contre-proposition sur les
  créneaux RÉELS de `get_available_slots`), Refuser (destructive +
  confirmation — un client attend derrière).
- **Un salon Free accepte sans mur.** L'incitation (essai 14 j) apparaît
  APRÈS une acceptation réussie, bannière fermable, jamais bloquante,
  jamais avant.
- **En attente du client** : les contre-proposition envoyées, avec le
  créneau proposé et leur échéance (blocs, plus calmes, sans action
  d'acceptation pro).
- **Historique** (dense) : les demandes traitées et leur issue —
  confirmée, refusée, expirée, contre-proposée puis acceptée/refusée.
  C'est la preuve de ce que FadeUp apporte.
- **Coordonnées** : exactement ce que la RPC expose, jamais plus. La RPC
  n'expose le contact qu'aux rôles gestionnaires d'une organisation
  revendiquée ; un profil non revendiqué ne reçoit JAMAIS de coordonnées
  (garde B2 — `customer_display_name` réduit à l'écriture).
- **Realtime** : nouvelle demande apparaît sans rafraîchir (`useChannel`,
  canal par contexte), demande expirée sort de la liste.

## 11. La contre-proposition — contrat produit

Tranché par P1PRO (détail technique : migration + rapport) :

- Proposer un autre horaire DÉPLACE la demande sur le créneau proposé, qui
  est **RETENU** (la ligne `pending` participe à l'exclusion de
  chevauchement). L'horaire d'origine est libéré.
- La demande d'origine DEVIENT la contre-proposition : une seule ligne, un
  seul état, pas de double réservation.
- **Échéance client** : `min(starts_at proposé, now + TTL de
  l'organisation)` — le compte à rebours redémarre, jamais au-delà de
  l'heure proposée.
- Le client ACCEPTE (→ confirmé, le salon est notifié) ou REFUSE (→ la
  demande se clôt, résolution « cancelled_by_customer » ; le salon avait
  déjà dit non à l'horaire d'origine, on ne le fait pas revivre) ou ne
  répond pas (→ expiration normale, balayage existant).
- Tant qu'une contre-proposition attend le client, le salon ne peut PLUS
  « accepter » (le consentement a changé de camp) ; il peut toujours
  refuser.
- Côté client : la contre-proposition s'affiche dans Réservations avec les
  deux horaires (demandé barré / proposé en évidence) et les deux actions ;
  `pending-request` ne dit jamais « réservé ».

## 12. Libellés d'état — « Réservable » vs « Sur demande »

Côté DÉCOUVERTE client (mais tranché ici car c'est la capacité PRO qui
pilote) :

- `accepts_immediate_booking = true` → badge « Réservable », CTA
  « Réserver ».
- `accepts_immediate_booking = false` (mode autorise la réservation mais
  pas de capacité commerciale : non revendiqué OU Free) → badge
  **« Sur demande »**, CTA « Demander un créneau ». Le client sait AVANT le
  tunnel qu'il enverra une demande sous échéance.
- **Un seul badge sur la carte** : « Sur demande » rend « Pas encore géré
  sur FadeUp » redondant sur la CARTE (supprimé) ; l'explication de
  revendication reste sur le PROFIL et la feuille.
- Source : `get_public_booking_capability` (une organisation) /
  `get_public_booking_capabilities` (lot de la recherche).

## 13. Architecture d'exécution (rappels bloquants, inchangés)

`features/X` n'importe jamais `features/Y`. Client Supabase :
`features/*/api/**` et `shared/data/**`. Clés Query par fabriques
(`shared/data/keys.ts` — y compris les clés pro). Chercher la RPC avant
d'écrire une requête. Realtime via `useChannel`, invalidation de clés
(l'écriture directe de cache reste réservée à la file). i18n : namespace
`v2`, section `pro`, zéro chaîne en dur, fr + en. Icônes :
`shared/ui/icons.ts` seulement.

## 14. Questions que ce contrat ne tranche PAS (pour les lots d'OS)

1. **La grille de l'agenda** (jour mobile / semaine par ressource desktop) :
   la densité est fixée (§3), le langage visuel des créneaux, conflits et
   blocs de temps reste à définir.
2. **La dataviz Insights** : encre/verts, pas de bleu, un chiffre dominant —
   le langage des courbes/cohortes n'est pas défini.
3. **Les libellés d'audience de la file** (« Appelé » côté pro vs « C'est
   votre tour » côté client) — hérité de P1, toujours ouvert.
4. **Le CRM** : la rangée client (quelles méta, quel geste principal).
5. **La réservation manuelle et le blocage de temps** : formes de
   formulaire dense à définir sur l'agenda.
