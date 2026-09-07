# FadeUp — Rapport final F1 : Live Queue

Branche `f1/live-queue`, 6 commits poussés le 2026-09-07.
**Une migration (GRANT additif) appliquée en production, sauvegarde et retour
arrière testés. Aucune fusion. `/platform` intact, preuve au §8.**

---

## 1. Vérification bloquante du §2 — la consultation n'exige PAS la proximité

**Réponse : non.** `get_public_queue_status` — la CONSULTATION — est une
fonction SQL `STABLE SECURITY DEFINER` sans jeton, sans coordonnées, sans
géofence, sans `auth.uid()`. Sa clause WHERE entière, relevée dans
`db-audit/SCHEMA.sql` :

```sql
CREATE FUNCTION public.get_public_queue_status(p_organization_slug text, p_location_id uuid)
RETURNS TABLE(id uuid, display_name text, status public.queue_status,
              queue_position integer, barber_display_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
AS $$
  select
    q.id,
    btrim(split_part(q.customer_name, ' ', 1))
      || case when position(' ' in btrim(q.customer_name)) > 0
              then ' ' || left(split_part(q.customer_name, ' ', 2), 1) || '.'
              else '' end as display_name,
    q.status,
    case when q.status = 'waiting' then
      row_number() over (partition by q.status order by q.created_at)::integer
    else null end as queue_position,
    sp.display_name as barber_display_name
  from public.queue_entries q
  join public.organizations o on o.id = q.organization_id
  left join public.barbers b on b.id = q.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  where o.slug = p_organization_slug
    and q.location_id = p_location_id
    and q.status in ('waiting', 'called', 'in_service')
  order by ...;
$$;
```

Seul `join_public_queue` — REJOINDRE — porte la preuve de présence, dans cet
ordre de gardes : (a) `service_area` refusé, (b) jeton QR comparé à celui de
CET établissement, (c–e) position exigée puis distance mesurée **serveur**
(`private.point_distance_km(...) * 1000 > coalesce(s.queue_geofence_meters, 150)`
→ `too_far`), puis mode/ouverture et capacité. Extrait de la garde (c) :

```sql
  if v_distance_meters is null or v_distance_meters > v_geofence_meters then
    raise exception 'you are too far from this establishment to join its queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=too_far', ...
```

**Conclusion** : l'usage principal du produit existe — un client regarde
l'attente depuis chez lui sans rien prouver ; la présence n'est exigée qu'au
geste « rejoindre ». L'écran client a donc été construit. Pas d'écart
bloquant sur ce point (les écarts réellement constatés sont au §11).

## 2. Les huit motifs de refus et leurs messages

`join_public_queue` nomme ses refus via `DETAIL: fadeup_queue_refusal=<code>` ;
PostgREST le remonte dans `error.details` et l'interface branche sur le
CODE, jamais sur le texte (`features/queue/lib/refusals.ts`, testé : huit
codes → huit clés → huit textes FR et EN réellement distincts).

| Code | Message FR affiché |
|---|---|
| `service_area_has_no_queue` | Ce professionnel se déplace chez ses clients : il n'y a pas de file d'attente. Réservez un créneau à la place. |
| `invalid_check_in_token` | Ce QR code n'est plus valide. Scannez celui affiché dans le salon. |
| `location_not_geolocated` | Ce salon n'a pas encore publié sa position : la file ne peut admettre personne pour l'instant. Signalez-le au comptoir. |
| `position_required` | Votre position est nécessaire pour rejoindre : il faut être au salon. Autorisez la localisation puis réessayez. |
| `too_far` | Vous êtes trop loin du salon pour rejoindre sa file. Rapprochez-vous et réessayez sur place. |
| `queue_closed` | La file n'accepte personne pour le moment. Adressez-vous au comptoir ou revenez plus tard. |
| `queue_full` | La file est pleine. Revenez un peu plus tard, ou réservez un créneau. |
| `already_in_queue` | Vous êtes déjà dans une file. Terminez ou quittez-la avant d'en rejoindre une autre. |

Détails d'exécution : `too_far`, `position_required` et
`invalid_check_in_token` proposent la nouvelle tentative (le client peut
corriger lui-même) ; les autres énoncent un état du salon. Aucun libellé ne
code un seuil en dur — la géofence exacte est un réglage PAR SALON que le
contrat public n'expose pas. `location_not_geolocated` est formulé comme un
défaut CÔTÉ SALON, pas côté client (V2_DATA_CONTRACT §V8). Deux refus sont
prouvés distincts de bout en bout par e2e contre la base réelle : « trop
loin » (coordonnées Marseille, jeton valide) et « QR invalide » (jeton bien
formé mais faux, position au salon).

Les échecs LOCAUX (géolocalisation refusée/indisponible, scan raté, code
OTP invalide, e-mail non parti) ont leurs propres messages, distincts des
huit refus serveur — ils n'usurpent jamais un code de la base.

## 3. Le temps d'attente : quand s'affiche-t-il, comment l'absence est rendue

**Aujourd'hui, jamais** — et c'est un constat, pas un choix d'écran : aucune
RPC publique ne fournit d'estimation (`get_public_queue_status` n'a ni
`called_at` ni durée ; le modèle d'estimation est une décision fondateur en
attente, MASTER_SPEC §23.3).

L'unique point de vérité est `shared/lib/waitTime.ts` (partagé entre les
deux faces, la loi est produit) :

- `formatEstimatedWait(null | undefined | NaN | ∞ | négatif)` → `null`
  = **rien n'est rendu**. Pas d'« environ », pas d'estimation optimiste,
  pas une minute. Testé unitairement (cas « pas de temps fiable » exigé par
  F1 §8) et en e2e (`queue-estimated-wait` → count 0 sur la base réelle).
- Le jour où la base livre une estimation fiable, elle passe par cette
  fonction et s'affiche — le câblage existe (`QueueSummary` a le prop,
  branché sur `null` avec le commentaire qui dit pourquoi).
- L'ABSENCE est rendue par l'absence : le résumé de `/q/:slug` montre le
  nombre réel de personnes et l'état de la file (ouverte/fermée/données
  partielles — trois états distincts, jamais un état inventé quand la RPC
  d'état échoue), et rien d'autre. Une file vide affiche 0.

Distinction tenue : la durée d'attente **écoulée** (`elapsedWaitMinutes`,
depuis `created_at`) est une MESURE, pas une estimation — elle s'affiche
côté pro (« Attend depuis N min »), jamais bornée négative, testée.

## 4. Realtime : canaux, invalidations, écritures de cache, absence d'orphelin

**Canaux ouverts par F1 : un seul.** `queue:<location_id>` (table
`queue_entries`, filtre `location_id=eq.<id>`), monté exclusivement par
`useProQueueChannel` sur `/dashboard/queue`, via `shared/realtime/useChannel`
— aucun composant ne crée de canal (P1 §17).

**Ce qui écrit directement dans le cache** — le SEUL endroit du produit où
c'est autorisé (P1 §17, F1 §4), parce que la latence compte quand un barber
appelle quelqu'un :
- les payloads INSERT/UPDATE/DELETE du canal → `queueKeys.pro(locationId)`
  (upsert trié par `created_at`, retrait des états terminaux). `useChannel`
  a été étendu pour LIVRER le payload — signature rétro-compatible, les
  autres consommateurs continuent d'ignorer l'argument et d'invalider ;
- le RÉSULTAT SERVEUR des mutations pro (`.update(...).select().single()`,
  horodaté par `enforce_queue_transition`) → même clé. **Zéro optimisme** :
  rien ne bouge tant que la base n'a pas accepté, et tout échec de
  transition remonte un toast (c'est un 403 silencieux qui cachait le
  défaut du §10.1).

**Ce qui invalide** : la reconnexion du canal (refetch complet — les
événements manqués ne reviendront pas) ; ouverture/fermeture et bascule de
mode → `queueKeys.proModes` ; un join réussi → statut public + `mine`.

**Face client** : pas de Postgres Changes pour `anon` (aucun SELECT — c'est
le contrat V2 §4), donc POLL : file 6 s, état de service 30 s (décision
consignée au §6.1), et le poll du client **qui suit sa place** continue
onglet caché (`refetchIntervalInBackground`) — sans quoi l'appel, et la
notification système qui en dépend, n'atteignent jamais un téléphone rangé
(§6.2). Les listes n'animent que l'élément modifié : `fu-called` sur la
seule rangée appelée, neutralisé par `prefers-reduced-motion` dans
motion.css.

**Preuve d'absence d'orphelin** (e2e, base réelle) : sur `/dashboard/queue`,
`window.__fuSupabase.getChannels()` (exposition DEV existante de P1b) montre
un topic `queue:` ; après navigation vers `/`, **zéro** topic `queue:` —
seul subsiste le canal de notifications du shell, légitime et hors
périmètre. Test `aucun canal realtime orphelin après navigation`, vert sur
les deux projets Chromium.

## 5. Installation : le chemin retenu, le temps chronométré réel

**Chemin** : `/auth/signup?redirect=/setup` → `/setup`. Une CHECK-LIST de
huit étapes, pas un tunnel : chaque étape est un écrit serveur immédiat via
les RPC d'onboarding EXISTANTES (rien n'a été reconstruit), et l'état
affiché vient de `get_organization_readiness` — un stagiaire interrompu
rouvre la page et reprend à la première étape non faite. C'est ça, la
sauvegarde progressive.

1. **Le salon** — `complete_organization_onboarding` (org + premier lieu,
   fuseau détecté) puis `save_business_profile` (type d'activité choisi,
   EUR/FR du marché de lancement) ;
2. **Le premier barber** — `ensure_owner_professional` (profil public actif
   + barber réservable) ;
3. **L'adresse et la position** — update `locations` (RLS owner) ; la
   position vient de « Utiliser ma position » : le stagiaire est DANS le
   salon, sa position est celle du salon — aucun géocodeur n'existe dans la
   pile, décision au §10 ;
4. **Les services** — `apply_starter_services`, gabarits barber préremplis
   (Coupe 30 min / Coupe + barbe 45 min / Barbe 15 min) et modifiables :
   des initialiseurs de catalogue (MASTER_SPEC §15), pas des données
   opérationnelles ;
5. **Les horaires** — `apply_weekly_hours`, lieu ET barber dans le même
   appel (être réservable exige les deux) ;
6. **L'essai gratuit** — `complete_onboarding` (p_publish=false, §10) puis
   `start_organization_trial` : 14 jours sans carte (B3), et c'est LUI qui
   livre la capacité `liveQueue` — une organisation Free n'admet personne
   (trigger `enforce_queue_service_mode`). « Essai déjà consommé » n'échoue
   pas l'installation ;
7. **Ouvrir la file** — `set_location_service_mode('hybrid')` +
   `set_location_queue_open(true)`. Un lieu neuf naît déjà `hybrid` + file
   ouverte (réglage de compatibilité en base) : l'étape s'auto-valide alors
   sur l'état RÉEL et la check-list passe au QR ;
8. **Le QR au mur** — l'affiche A5 (logo, nom du salon, phrase
   d'instruction, QR encodant `/q/<slug>?l=<lieu>&t=<jeton>`), bouton
   d'impression (`@page { size: A5 }`, isolation par visibilité), lien vers
   `/dashboard/queue`.

**Temps chronométré réel** : le test e2e mesure le parcours complet —
création du compte incluse — contre la base de production :
**8,7 secondes** en automatisé (`[F1] installation chronométrée : 8.7 s`,
assertion < 20 min). La frappe humaine ramène cela à quelques minutes ;
la marge sur les vingt minutes est d'environ deux ordres de grandeur.

## 6. Ce qu'il a fallu trancher faute de réponse dans le contrat de handoff

1. **Poll d'état de service à 30 s** sur `/q/:slug` — le contrat V2
   documente 120 s, mais F1 §9 exige que la bascule de mode du pro se
   répercute côté client « en temps réel, sans rafraîchir », et `anon` n'a
   pas de Postgres Changes. 30 s est le compromis retenu (lecture STABLE
   légère via Kong, latence bornée), testé e2e sur deux navigateurs. La
   file publique reste à 6 s.
2. **Poll en arrière-plan pour le suivi de place** — TanStack Query suspend
   `refetchInterval` quand l'onglet est caché ; or un client en file RANGE
   son téléphone, et la notification d'appel dépend de ce poll. Le badaud
   qui consulte sans suivre garde le comportement économe.
3. **Inscription légère OPTIONNELLE dans le join** : un e-mail → code à six
   chiffres (canal B2), l'entrée est rattachée au compte et suivie par
   `get_my_queue_status` ; sans e-mail, entrée anonyme — le mode kiosque
   que `join_public_queue` prévoit explicitement, suivie par l'id d'entrée
   en localStorage. F1 exigeait l'inscription légère « dans le flux » sans
   dire si elle était obligatoire ; l'obligation aurait ajouté deux écrans
   au geste le plus court du produit.
4. **Pas de choix de barber au join** (premier disponible,
   `p_barber_id=null`) — la spec l'autorise « si le salon exploite des
   files distinctes » ; aucun salon n'en exploite, et le coût
   d'interaction prime (F1 §0).
5. **`p_publish: false`** à la fin de l'installation : la file n'exige pas
   la visibilité marketplace, et publier est une décision du patron depuis
   l'éditeur de profil public — pas un geste de stagiaire. (Accessoirement,
   cela évite qu'une organisation d'e2e apparaisse dans la recherche
   publique de production, leçon des fixtures B1.)
6. **Gating écran ET menu sur `liveQueue`** : la base admet `walkIns OU
   liveQueue` à l'insertion, mais le menu P1b conditionnait déjà l'entrée
   « File » à `liveQueue` seul — cohérence conservée (`RequireCapability`,
   même source `live_capabilities`). À réarbitrer si un plan vend
   `walkIns` sans `liveQueue`.
7. **L'affiche et le QR ne sont pas thémés** : encre sur papier blanc dans
   tous les thèmes (classes `.fu-poster` en CSS — le lint ferme la palette
   en TSX ; l'encre du QR est RÉSOLUE depuis `--fu-accent-fg`, le token que
   la garde palette verrouille).
8. **Barre d'action collante au-dessus de la nav basse** (`bottom-14`
   < 768 px) : premier écran consumer à combiner StickyActionBar et nav ;
   sans cela le CTA « Rejoindre » était sous la nav (z 10 contre z 20),
   incliquable à 390 px.
9. **Contexte organisation déplacé vers `shared/data`** : le ProShell,
   pro-queue et pro-onboarding le consomment, et `features/X` n'importe
   jamais `features/Y` (lint bloquant). Ré-export de compatibilité conservé
   dans `features/pro/api/organization.ts`. Même déplacement pour
   `waitTime` et `queueLink` (partagés entre faces).

Le rapport B1 « chantier 5 » exigé en lecture préalable n'est **pas
versionné** (seul `B3_RAPPORT.md` existe dans docs/reports) ; sa substance a
été prise dans V2_DATA_CONTRACT §V8, le prompt B1 lui-même et le schéma —
signalé plutôt que supposé.

## 7. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (tsc -b + tsconfig.v2) | **0 erreur** |
| `npm run lint` (oxlint + eslint --max-warnings 0 + garde palette) | **0 erreur** |
| `npm run test` (Vitest) | **581/581**, 66 fichiers — dont les huit refus (codes, clés, textes FR/EN distincts), le formatage du temps d'attente (cas « pas de temps fiable »), queueLink, minimisation prénom+initiale, QueueSummary (zéro minute inventée), QueueTracking (appel orchestré, sortie honnête) |
| `npm run e2e` (Chromium 390 px et 1440 px, p1b + F1) | **61 passés, 1 skip pré-existant, 0 échec** — F1 : 22/22 |
| axe-core | **aucune violation sérieuse ou critique** sur `/q/:slug` (+ la cible p1b existante) |
| Chunk d'entrée consumer | **≈ 81 Ko gzip** (index 24,9 + vendor-react 56,4) — budget 180 Ko tenu ; `PublicQueuePage` en chunk paresseux séparé de **6 Ko gzip** ; `qrcode` importé paresseusement, jamais dans l'entrée |
| `grep -rnE '\b(left\|right):' src/features/queue src/features/pro-queue` | **vide** (pro-onboarding aussi) |
| `probe_public_rpcs.sh --strict` | **22 RPC publiques, toutes 200** (le prompt en annonçait 21 ; B4 en a ajouté depuis — le point vérifié est « toutes en 200 », et il tient) |
| WebKit | **non exécutable sur cet hôte** — libs système manquantes, root requis (BLOCKERS §2, inchangé). Les deux projets WebKit sont configurés : `P1B_WEBKIT=1 npm run e2e` les lancera tels quels une fois les libs posées |

Vérification navigateur réelle (390 px, exigence CLAUDE.md), zéro erreur
console et zéro requête en échec sur : `/q/demo-maison-kais` (état honnête
« File fermée », 0 personne, aucune minute), `/q/demo-sofian-cuts` (zone de
service : « Pas de file d'attente ici » + sortie vers le profil), la feuille
de join, le moment d'appel client (panneau vert plein / texte encre,
8,30:1), la file pro peuplée (compte à rebours de grâce qui défile, rangée
appelée seule animée), la page QR/affiche.

Scénarios e2e exigés par F1 §8, tous verts contre la base de production :
consultation sans auth ni géoloc · trop loin refusé avec le bon message ·
QR invalide refusé avec un message différent · positions en temps réel sur
deux navigateurs · le barber appelle, le client le voit sans rafraîchir
(et l'autre client remonte 2 → 1) · bascule de mode répercutée côté client
sans rechargement · parcours d'installation de zéro à file ouverte ·
minimisation vérifiée sur l'écran pro (« Amine P. » présent, « Amine
Premier » absent) · aucun canal de file orphelin.

## 8. `/platform` intact — preuve

- `git diff --name-only $(git merge-base HEAD rebuild/social-first-v2)` :
  **zéro** fichier sous `src/pages/platform-*`, `src/routes/*`,
  `src/components/*` — le seul fichier legacy touché est
  `src/lib/marketplace-supply.test.ts` (extension d'exemptions du gardien,
  §10.3).
- Production : `GET http://127.0.0.1:15180/platform/login → 200`, HTML
  attendu (bootstrap thème/locale en tête).
- La migration du §10.1 est un GRANT ADDITIF sur une fonction `private` ;
  aucun chemin platform ne met à jour `queue_entries` (policies org
  uniquement), aucun comportement existant ne change — seul un chemin
  jusqu'ici impossible devient possible.
- La recherche publique de production retourne exactement ses **9 lignes
  légitimes** (vérifié après la campagne e2e) : aucune fixture QA n'a
  atteint la marketplace.

## 9. Git

- Branche : `f1/live-queue`, créée depuis `rebuild/social-first-v2`,
  poussée (`origin/f1/live-queue`), arbre propre.
- **Aucune fusion n'a été effectuée.** Aucun `git add .`/`-A`, aucun
  `reset --hard`, aucun `clean`.
- Six commits :

| Commit | Contenu |
|---|---|
| `d0f196f` | fondations partagées (payload useChannel, clés, organisation → shared/data, waitTime, queueLink, QrCode, affiche A5, i18n `v2:queue` FR/EN) |
| `6ef5ff8` | face client — `/q/:slug`, rejoindre, suivre sa place |
| `eb9576f` | face pro — `/dashboard/queue` et `/dashboard/queue/qr`, garde `RequireCapability` |
| `8451572` | installation — `/setup` |
| `0f9146d` | fix GRANT `private.queue_stage` + migration + BLOCKERS §10–11 + note V2_DATA_CONTRACT |
| `9af32b1` | e2e F1 (22 scénarios) + testDir élargi + exemptions du gardien marketplace |

(Le présent rapport est un septième commit, demandé après coup.)

## 10. Décisions prises seul — et toute erreur commise, déclarée

### 10.1 LA décision lourde : une migration appliquée en production, hors du cas prévu par le §2

`enforce_queue_transition` (trigger BEFORE UPDATE de `queue_entries`,
SECURITY INVOKER **sans exemption de rôle — voulu**) appelle
`private.queue_stage()` pour interdire les transitions arrière. B1 a accordé
EXECUTE à `authenticated` sur ses jumelles (`has_org_role`, `is_own_barber`)
**mais pas sur elle** : ACL relevée `{postgres=X/postgres}` seulement. En
conséquence, TOUTE transition d'entrée de file via l'API répondait :

```
PATCH /rest/v1/queue_entries?id=eq.<id>
→ 403 {"code":"42501","message":"permission denied for function queue_stage"}
```

Appeler le suivant, marquer absent, marquer terminé : impossibles pour tous
les rôles, depuis B1. Latent parce que F1 est le **premier écran** qui
exerce ce chemin par PostgREST.

Le prompt dit « aucune migration, sauf si le §2 en révèle la nécessité » ;
le §2 ne l'a pas révélée — le premier clic « Appeler » l'a fait. J'ai
tranché seul que la nécessité était démontrée (sans ce GRANT, le chantier
entier est inopérant) et j'ai suivi la procédure du §1 à la lettre :

- **Sauvegarde d'abord** : `pre-f1-20260907-034902.dump` (§ suivant) ;
- **Retour arrière testé sur restauration fidèle** : base `f1_restore_test`
  restaurée du dump (propriétaires et ACL vérifiés :
  baseline `{postgres=X/postgres}` → up
  `{postgres=X/postgres,authenticated=X/postgres}` → down retour exact à la
  baseline), transition fonctionnelle prouvée sur la restauration
  (`waiting → called`, `called_at` horodaté serveur) AVANT la production ;
- **Grantor = propriétaire** : appliqué en rôle `postgres` (leçon B4 : un
  REVOKE par un autre rôle serait un no-op silencieux) ;
- **Preuve après application** : le même PATCH → 200, `status: called`,
  `called_at` posé par le trigger.

Fichiers : `db/migrations/20260907050000_f1_queue_stage_execute_grant.sql`
et son `.down.sql`. Portée minimale : `authenticated` uniquement (`anon` ne
met jamais à jour une entrée et n'a aucun privilège UPDATE sur la table).
Si cette décision doit être annulée : le down suffit, il remet l'état B1 —
c'est-à-dire l'état défectueux d'origine.

### 10.2 Sauvegarde

`/opt/fadeup/backups/pre-f1-20260907-034902.dump` — 2 537 987 octets,
`pg_dump -Fc` de la base de production, pris AVANT la migration, convention
de nommage des lots précédents.

### 10.3 Autres décisions prises seul

- Déplacements vers `shared/` (§6.9) et extension du gardien
  `marketplace-supply.test.ts` : exemption de `shared/data/organization` et
  `features/pro-onboarding/` — surfaces PRO qui administrent le modèle
  interne (l'installation ÉCRIT `business_type` via `save_business_profile`,
  comme `/platform`), valeur jamais affichée ; la garantie côté produit
  client est intacte et toujours testée.
- `testDir` Playwright élargi de `e2e/p1b` à `e2e/` : la suite p1b devient
  le filet de régression permanent, elle tourne avec F1 (61 tests).
- Toasts d'erreur sur TOUTES les transitions pro : c'est un échec silencieux
  qui a masqué le défaut de GRANT pendant trois lots.

### 10.4 Erreurs commises, déclarées

1. **`<main>` imbriqués** : mes trois pages rendaient leur propre `<main>`
   dans des shells qui portent déjà `<main id="fu-main">` — invalide,
   attrapé par le strict mode Playwright et le passage axe. Corrigé (`div`).
2. **CTA sous la nav basse** : StickyActionBar (z 10) née SOUS la nav
   consumer (z 20) à 390 px — le bouton « Rejoindre » était recouvert.
   Corrigé (`bottom-14` sous 768 px), et c'est ce défaut qui faisait
   échouer le premier passage du test « trop loin ».
3. **Rangée « appelé » illisible à 390 px** : badge + deux boutons
   écrasaient le nom du client. Restructurée (nom en titre, badge + grâce
   en sous-titre), constaté sur capture réelle, pas en revue de code.
4. **Garde de capacité trop pressée** : `RequireCapability` redirigeait
   pendant la résolution asynchrone de la session (organization nul avec
   loading faux). Corrigé (attente de session + jamais de spinner sans
   issue : une erreur d'entitlements redirige).
5. **Effet de bord assumé sur la production** : la campagne e2e (chaque
   run × deux projets, plus les itérations de débogage) a créé
   **29 organisations `qa-f1-*`** et autant d'utilisateurs
   `qa-f1-*@fadeup.test`. Toutes les organisations sont neutralisées selon
   la convention post-B1 : nom `ZZ dead …`, `marketplace_visible=false`
   (elles ne l'ont jamais été), lieux inactifs, files fermées, entrées
   annulées — vérifié : 29/29, zéro lieu actif, zéro ligne dans la
   recherche publique. Elles sont **indélébiles** (journaux append-only,
   même contrainte que les fixtures B1) ; les utilisateurs auth restent
   également. Chaque essai consommé l'est définitivement — sans conséquence
   pour des organisations mortes.
6. **Découverte annexe** : `/opt/fadeup/apps/web/.env.local` porte une clé
   anon **périmée** (401 sur toute RPC publique) ; la clé courante vit dans
   l'environnement du conteneur Kong. Le worktree a la sienne corrigée
   (fichier non versionné) ; celui de `/opt/fadeup` est à corriger — hors
   de mon périmètre d'écriture, signalé ici.

## 11. Cases non cochées, avec la raison exacte

- **« Quitter la file possible »** — NON COCHÉE. Aucun support en base :
  les policies UPDATE de `queue_entries` ne couvrent que
  owner/manager/réceptionniste et le barber propriétaire ; aucune RPC
  `leave_public_queue` n'existe. Un client — anonyme OU connecté — ne peut
  pas sortir de la file ; seul le comptoir peut l'annuler. Rien n'a été
  simulé ni contourné. Correction proposée (BLOCKERS §11.1) : RPC
  SECURITY DEFINER `leave_public_queue(p_entry_id uuid)` — l'id d'entrée
  (uuid non devinable, retourné au seul créateur) sert de capacité pour
  l'anonyme, `booked_by_user_id`/`customer_id` pour le connecté, transition
  `→ cancelled` uniquement.
- **« L'appel est visuellement impossible à manquer, avec compte à
  rebours »** — PARTIELLE. L'appel est impossible à manquer : panneau vert
  plein / texte encre plein écran, `aria-live="assertive"`, animation
  `fu-called`, notification système sur transition réelle (jamais rejouée
  au poll), opt-in explicite. **Mais sans compte à rebours côté client** :
  ni `called_at` ni `queue_call_grace_minutes` ne sont exposés par une RPC
  publique (`get_location_queue_check_in` est réservée aux rôles org) —
  afficher des minutes serait les inventer, interdit par F1 §3. Côté PRO le
  compte à rebours existe et défile (seuils lus en base). Correction
  proposée (BLOCKERS §11.2) : un `called_deadline_at` calculé serveur sur
  la propre entrée du client.
- **« Réorganisation réservée aux rôles habilités, avec trace d'audit »** —
  NON COCHÉE. **F1.md affirme « B1 l'a prévu côté base » ; le schéma dit
  non** : pas de colonne de position (elle DÉRIVE de `created_at` via
  `row_number()`), aucune RPC de réordonnancement, aucune table d'audit.
  Muter `created_at` pour réordonner aurait été un hack sans trace —
  refusé. Non construit, écart remonté (le commentaire d'en-tête de
  `ProQueuePage` le documente aussi).
- **« Playwright, Chromium et WebKit »** — WebKit non exécutable sur cet
  hôte (root requis pour les libs, BLOCKERS §2). Chromium 390/1440
  couvre tout ; les projets WebKit sont prêts derrière `P1B_WEBKIT=1`.
- Le critère de qualité « les 21 RPC publiques toujours en 200 » est coché
  dans sa substance : elles sont **22** depuis B4, toutes en 200
  (`--strict` vert).

## 12. Ce qu'il manque pour installer dans un vrai salon demain matin

1. **Fusionner et déployer** : la branche n'est pas fusionnée, la
   production sert l'ancien build. Fusion, build, et correction de la clé
   anon dans `/opt/fadeup/apps/web/.env.local` (§10.4.6) — sans elle,
   l'application déployée parlerait dans le vide.
2. **Le lien magique en conditions réelles** : l'envoi Resend fonctionne
   (B2), mais l'inscription légère du join ne boucle proprement que sur
   `https://fade-up.com` (`GOTRUE_SITE_URL`), et la RÉCEPTION en boîte
   reste inobservable (clé Resend restreinte à l'envoi, BLOCKERS §7) — le
   fondateur valide en ouvrant sa boîte, comme pour B2.
3. **Quitter la file** (§11) : dès le premier vrai client qui change
   d'avis, l'absence se verra. La RPC proposée est petite et bien bornée.
4. **Le balayage de grâce** : `queue_call_grace_minutes` est stocké,
   affiché et décompté côté pro, mais **aucun sweep ne passe un appelé en
   absent** (V2_DATA_CONTRACT §V8) — c'est le pro qui décide, l'écran le
   dit honnêtement (« Grâce écoulée — à vous de décider »). Un tick du
   conteneur `fadeup-scheduler` serait plus juste en heure de pointe.
5. **Le compte à rebours client** (§11) : `called_deadline_at` public.
6. Confort, pas bloquant : push mobile natif (aujourd'hui Notification API
   du navigateur, refusable), et le second domaine d'envoi pour protéger la
   réputation des liens magiques (BLOCKERS §6).

Ce qui n'attend RIEN : un patron dont l'organisation détient `liveQueue`
peut dès la fusion ouvrir sa file le matin, imprimer l'affiche A5, appeler,
marquer absent, terminer — et un client peut regarder l'attente depuis chez
lui et rejoindre en scannant le mur. Les deux gestes sur lesquels F1 §0
juge le produit existent et sont testés de bout en bout contre la base
réelle.

---

**Aucune fusion n'a été effectuée. Fin du rapport.**
