# P1a — Direction visuelle

Date : 2026-09-04. Artefacts : `design/p1a/directions/direction-{a,b,c}.html`
(+ captures `.png`). **Trois directions sœurs appliquées au même écran réel** —
une carte de résultat de recherche et un en-tête de profil barber à 390 px —
alimentées par de vraies lectures de la base de production.

## Données réelles utilisées (requêtes documentées)

```sql
select … from public.search_public_professionals(p_entity_type => 'shop');
-- → Side Agency · side-agency · 19 rue Danton · Antony (92) · barbershop
--   starting_price_cents=2500 · is_open_now=false · queue_waiting_count=0

select * from public.get_public_barber('side-agency', <barber_id>);
-- → Barber Test · titre « Barbr Test » · bio vide · avatar vide

select * from public.list_public_barber_services('side-agency', <barber_id>);
-- → Coupe 30 min 25,00 € · Coupe + barbe 60 min 40,00 € · Taper 30 min 25,00 €

select * from public.get_public_service_state('side-agency', <location_id>);
-- → effective_service_mode=hybrid · booking_accepting_new_entries=false · queue_open=true

select * from public.get_public_professional('<professional_id>');
-- → 0 ligne (profil professionnel non public)
```

Aucune donnée fabriquée. Les absences produisent des états vides honnêtes,
tous visibles dans les trois rendus : pas de note (aucun avis en base), pas de
photo (aucun média), pas d'abonnés ni de Suivre (profil professionnel non
public), « Fermé actuellement » (réel), Réserver à l'état réel
(`booking_accepting_new_entries=false`), « File ouverte — rejoindre sur
place » (réel, et conforme à la règle présence physique). La base n'a qu'une
organisation vivante — un jeu réduit, mais réel, et le titre réel
« Barbr Test » (faute comprise) révèle plus qu'un lorem ipsum.

Le logo (`apps/web/public/brand/fadeup-mark-primary.png`, copie conforme du
master) est **identique dans les trois pages**, jamais altéré.

## Les trois directions

Constantes (ADN commun) : clair d'abord, Geist Sans/Geist Mono, vert = signal
et jamais peinture, logo canonique, aucune métadonnée en chapelet de points
médians, aucun libellé majuscules-espacées, rayon hiérarchisé.

**A — Éditorial minimal.** Blanc pur, conduite typographique (nom en 30 px
serré, échelle brutale entre identité et métadonnées), hairlines à ~10 %
d'encre au lieu de boîtes, zéro ombre, vert réduit à trois gestes : le point
« live » de la file, le soulignement du lien d'établissement, la surface douce.
CTA principal en encre. Rayon minimal (contrôles 6 px, avatar plein).

**B — Précision culturelle.** Le média mène : la carte s'ouvre sur un cadre
16:9 — honnêtement déclaré vide aujourd'hui — et l'en-tête de profil devient
un **moment de marque sombre** (`#0F1A16`) sur un produit clair. Vert assumé :
CTA plein vert, puce de file cerclée `#28E18E`. Rayons plus francs
(média 16 / contrôle 8 / puce 999), graisse 800 sur l'identité.

**C — Luxe produit.** Poli d'application native : surfaces blanches posées sur
un fond `#F7F9F8`, **une seule ombre** douce réservée aux surfaces porteuses
d'action, groupes de contenu à la iOS, rayons continus (surface 20 /
contrôle 12), identité centrée, vert = CTA et états vivants uniquement.

## Sélection : **A — Éditorial minimal**

1. **Pour le client** : c'est la lecture la plus rapide des trois — la
   hiérarchie nom → état → prix → action tient en un balayage vertical, sans
   chrome à décoder. La carte rétrogradée en rangée hairline augmente la
   densité de comparaison en recherche (l'échec R5R : « minimalism became
   missing information » — ici l'information est dense, c'est la décoration
   qui est absente).
2. **Désirable pour un barber** : la précision presque mode (échelle
   typographique brutale, blanc discipliné, aucun artifice SaaS) est le
   registre des marques que les barbers partagent réellement — c'est une page
   qu'on n'a pas honte de mettre dans une bio. Et elle met le travail futur en
   valeur : quand les médias arriveront, des photos sur du blanc hairline
   valent une galerie ; B, lui, expose aujourd'hui des cadres vides.
3. **Passe à l'échelle dans Pro** : le langage « hiérarchie par la valeur de
   fond, les bordures et la typographie, pas par l'ombre » est exactement la
   règle de l'interface sombre dense (MASTER_SPEC §15). A se transpose au Pro
   sombre sans traduction ; C repose sur l'élévation, qui ne survit pas à la
   densité opérationnelle sombre.
4. **Soutient la conversion** : rien ne concurrence le CTA — pas d'ombre
   concurrente (l'inversion Book/Follow de R5 est structurellement
   impossible), le prix « à partir de » est le seul chiffre en gras de la
   carte, l'état réel est adjacent à l'action qu'il conditionne.
5. **Fonctionne avec le logo canonique** : l'anneau dimensionnel est le seul
   objet « riche » d'une page par ailleurs plate — le contraste maximal le
   fait exister. B le répète (cadre média + marque = deux anneaux à l'écran) ;
   C l'entoure de surfaces arrondies qui rivalisent avec sa géométrie.

**Emprunts actés aux deux sœurs** (dans le système, pas de nouvelle
exploration) : le sombre sélectif de B devient le vocabulaire des moments de
marque (Passport, marketing, campagnes) ; l'unique ombre portée de C devient
le token d'élévation des barres collantes et feuilles (`--fu-shadow-3`).

## Ce que l'exploration a falsifié

- **B au présent** : sans contrat média, « le média mène » produit des cadres
  vides étiquetés — précisément le défaut reproché à V3 (« beautiful empty
  software »). B redevient pertinent quand `posts/post_media` existeront ;
  son cadrage est noté pour P4, pas pour la fondation.
- **Blanc sur vert** : illisible (2,33:1). Le texte de CTA sur vert primaire
  est **l'encre `#080F0D` (8,30:1)** — règle système, voir P1A_TOKENS.md.
- **Le vert pur comme couleur de texte** sur blanc échoue aussi (2,33:1) ;
  les liens et textes verts utilisent `--fu-brand-deep #00875A` (4,55:1).

## Points restés ouverts (à trancher avant P1b)

1. CTA « Réserver » consumer : encre pleine (A pur) ou vert plein (geste B)
   sur les surfaces de conversion majeures — les deux respectent le système ;
   recommandation : vert plein réservé au CTA transactionnel dominant,
   encre pour le reste. À valider visuellement par le fondateur.
2. L'en-tête de profil peut-il utiliser le moment sombre de B pour les
   profils **revendiqués** (récompense visuelle de la revendication) ?
3. Navigation consumer : 5 onglets avec Feed (P1a §2.3) vs 4 sans Feed
   (MASTER_SPEC §20) — contradiction documentaire non tranchée ici.
