# FadeUp — Spec de référence V2

**Autorité** : ce document prime sur tout autre `.md` du repo. Les documents de `docs/frontend/` (hors celui-ci), `docs/design/` et `docs/v2/` décrivent une version supprimée et sont périmés.
**Sources** : décisions produit du fondateur (septembre 2026) + schéma de production (`/opt/fadeup/db-audit/SCHEMA.sql`) + constats vérifiés du rapport P1a.
**Usage** : les prompts P1a à P5 s'y réfèrent. Aucun ne redéfinit ce qui est ici.

---

## 1. Ce qu'est FadeUp

Le réseau social, la marketplace et le système d'exploitation de la culture barber.

FadeUp n'est pas : un logiciel de rendez-vous, un SaaS de gestion de salon, un annuaire, un réseau social généraliste, un clone d'Instagram ou de TikTok, un produit de messagerie.

Boucle client : découvrir → faire confiance → réserver → être servi → relation → revenir.
Boucle pro : attirer → convertir → servir → fidéliser → croître.

Quatre couches produit : **FadeUp Network** (découverte, confiance, conversion), **Fade Passport** (identité, relation, rétention), **FadeUp Pro** (opérer, mesurer, croître), **Worker V2** (découvrir, enrichir, publier, revendiquer, convertir).

Dosage : **80 % marketplace, 20 % social.** Le social nourrit la découverte et la confiance, il ne devient jamais un réseau généraliste.

Marché de lancement : **Île-de-France**, densité avant dispersion. Marché suivant : Londres.
Langues product-ready : **FR et EN uniquement.** Le moteur reste internationalisable, RTL compris.

**Commission sur les réservations : 0 %.** Le client final ne paie rien à FadeUp.

### Cinq surfaces

| Surface | Public | Thème |
|---|---|---|
| Consumer | clients | clair |
| Pro | barbers et salons | sombre |
| Marketing | prospects pros | sombre éditorial |
| Platform | équipe FadeUp | sombre |
| Worker | acquisition, sans interface | — |

---

## 2. Lois produit — jamais enfreintes

**BOOK est le CTA transactionnel dominant. FOLLOW est le CTA social secondaire.**
Aucune action Message primaire : il n'y a pas de messagerie native dans le périmètre.

Social-first ne signifie pas : feed infini générique, messages privés, stories, direct, hashtags, commentaires, clone de TikTok.

Règles sociales actuelles : likes publics, **pas de commentaires**, **pas de hashtags**, jusqu'à 10 médias par publication, vidéo jusqu'à 60 secondes.

**Fade Passport existe automatiquement pour tout client enregistré.** La langue produit ne contient jamais « Créez votre Fade Passport » ni « Obtenez votre Fade Passport ».

**Pas de SMS.** Canaux client : application et push, Fade Passport et Wallet, e-mail.

**Offre marketplace = Independent + Barbershop, exactement.** Un barber salarié reste une identité publique et sociale forte, suivable et réservable via son salon, mais n'est jamais un résultat de recherche autonome.

**Interdiction absolue de fabriquer des données** : abonnés, likes, avis, notes, clients vérifiés, réservations, demande, disponibilité, file, temps d'attente, revenu, célébrités, analytics, preuve sociale. Une donnée absente produit un **état vide honnête**. FadeUp publie des profils scrapés : sa crédibilité repose entièrement sur le fait qu'il ne ment jamais sur ce qu'il affiche.

---

## 3. Navigation consumer — verrouillée

**Cinq onglets, dans cet ordre : Accueil · Recherche · Feed · Réservations · Compte.**

**Book n'est jamais un onglet.** C'est le CTA transactionnel dominant, contextuel : il vit sur un profil, sur une carte de résultat, dans une barre d'action collante. Un onglet « Réserver » sans barber ni salon sélectionné n'a pas d'objet.

Interdit : réordonner, renommer, ajouter Messagerie, ajouter Passport comme sixième onglet, ajouter un bouton flottant générique.

- **Accueil** : recherche et localisation, prochaine réservation ou file active, « réserver à nouveau », près de vous, profils suivis.
- **Recherche** : liste d'abord, carte en onglet. Filtres en feuille plein écran sur mobile, panneau latéral sur desktop. État en URL.
- **Feed** : abonnements et découverte locale entremêlés, classement algorithmique, curseur temporel. Pas un feed infini générique : chaque contenu garde un chemin vers la réservation.
- **Réservations** : à venir, historique, rebooking, file en cours.
- **Compte** : profil, Passport, favoris, abonnements, langue, notifications.

---

## 4. Modèle économique

### Plans — le catalogue en base fait foi

| Code | Prix | Unité |
|---|---|---|
| `free` | 0 € | par entité |
| `solo` | 19 €/mois | un professionnel |
| `essential` | 29 €/mois | par établissement |
| `pro` | 49 €/mois | par établissement |
| `business` | 79 €/mois | par établissement |
| famille `multi_salon` | 99 / 149 / 249 €/mois | multi-établissements |

**`pro` est le plan mis en avant commercialement.**

Ces prix sont ceux de `public.commercial_plans`. **Ils font autorité.** Toute grille antérieure — 20/35/49/69 € — est caduque. Aucun écran n'affiche un prix qui ne vient pas de la base : le catalogue est lu, jamais codé en dur.

Facturation **par établissement, jamais par fauteuil ni par barber** — huit barbers coûtent le même prix que deux. L'équipe est incluse dans les plans shop.

### Mécaniques commerciales — à construire

Trois décisions produit n'ont aucun support en base et restent à créer avant P3 :

- **Annuel** : dix mois payés, douze servis. Aucune colonne ni ligne de tarif annuel aujourd'hui.
- **Essai** : 14 jours sans carte bancaire. À l'échéance sans souscription, retour au `free` — aucune donnée supprimée, les fonctions payantes deviennent indisponibles.
- **Stripe** : zéro table de facturation. Encaissement, changement de plan en libre-service, résiliation mensuelle.

Tant que ces trois éléments n'existent pas, l'écran Billing de P3 ne peut afficher que le plan courant et la grille lue en base — ni souscription, ni changement, ni essai.

### Ce que chaque plan ouvre

**Free Network** — visibilité et entrée dans le réseau : profil public, revendication, signaux de demande réelle, publication sociale de base, marketplace si éligible. Pas d'accès à l'OS professionnel.
**Independent / Essential** — la vraie réservation, la Live Queue, les insights de base.
**Pro** — analytics avancés, tunnel d'acquisition, analytics social, intelligence client, CRM avancé, rétention, performance marketplace, analytics de file.
**Scale** — automatisation, déclencheurs de cycle de vie, cohortes, prévision, LTV, utilisation et rentabilité, permissions, audit, reporting avancés.

### Règles de gating

- **Aucun quota artificiel sur les réservations.** Les limites correspondent à de vraies capacités.
- Gating propre : pas de surfacturation automatique, données conservées.
- **Publication sociale de base ouverte à tout profil revendiqué, y compris gratuit.**
- L'interface se conditionne aux entitlements (`get_organization_entitlements`, `my_organization_has_capability`), jamais à un nom de plan codé en dur. Retour constaté : une ligne avec `live_capabilities[]` et `packaged_capabilities[]`.
- **Une capacité absente ne s'affiche pas grisée avec un cadenas. Elle n'est pas rendue.**

Promotions : créées, activées, datées depuis `/platform`. **Aucune remise codée en dur.**

---

## 5. Boucle d'acquisition

Le Worker agrège des profils depuis des sources publiques multiples — Google et sources business, sites, annuaires, Instagram et TikTok en complément. Jamais de dépendance à une seule plateforme. Déduplication et provenance tracées. **Les données revendiquées priment toujours sur le scraping.**

Ces profils sont publiés **clairement marqués comme non revendiqués**. Un client y envoie une demande. Elle sort en `pending`, un e-mail part au professionnel, et **la demande en attente est l'argument de vente**.

> **ÉCART MAJEUR constaté en P1a.** `book_public_appointment` insère toujours `confirmed` ; le commentaire du code le dit explicitement. Le `pending` n'est atteignable que par report client. **L'amont de la boucle n'existe pas.** L'aval est correct : `expires_at` plafonné par `least(expires_at, starts_at)`, TTL organisation à 24 h, balayage par le conteneur `fadeup-scheduler` (pas de `pg_cron`). Retour : `id, starts_at, ends_at, status, claim_token`. **Chantier base et worker, prioritaire, hors périmètre frontend.**

### Règles

**Transparence, sans exception.** Le client sait qu'il envoie une demande, pas qu'il a un rendez-vous. Écran : demande envoyée, service, date et heure, attente de confirmation, échéance, possibilité de chercher une alternative. **Jamais une intention présentée comme une confirmation.**

**Expiration** : 24 h maximum, et jamais au-delà de l'heure demandée.
Un pro revendiqué avec disponibilité opérationnelle **produit une confirmation immédiate**. Le `pending` est le tunnel Free et non revendiqué.

**E-mail au prospect** : « Un client souhaite réserver chez vous sur FadeUp. » Service, plage horaire, lieu, bouton pour voir la demande et revendiquer. Trois touches : immédiate, +8 h, dernier rappel avant expiration. **E-mail uniquement.**

**Données personnelles avant vérification** : prénom ou initiale, service, horaire. **Jamais le téléphone ni l'e-mail complet.**

**Pas de demandes offertes.** L'ancienne règle — une, puis cinq demandes acceptées gratuitement après revendication — est **abandonnée**. Aucun compteur, aucune garde de quota dans `confirm_booking_request`.

Le crochet de conversion est ailleurs, et il est plus fort : **la revendication est gratuite et instantanée, et la demande en attente est visible immédiatement après.** Le professionnel voit son client réel avant de choisir quoi que ce soit. C'est ça qui convertit, pas un nombre d'acceptations offertes.

Ensuite, un chemin unique : **l'essai de 14 jours sans carte bancaire**, qui ouvre le produit complet — agenda, file, CRM, statistiques. Un quota d'acceptations n'aurait prouvé qu'une chose, que FadeUp amène des clients ; l'essai prouve tout le reste, c'est-à-dire ce pour quoi le professionnel paiera.

Motif d'abandon, à ne pas ré-arbitrer sans raison nouvelle : un compteur crée une falaise — à la demande de trop, le pro découvre le mur payant en même temps qu'il perd un client réel. Une échéance se voit venir et se décide à froid. Et une mécanique unique se raconte en une phrase dans l'e-mail au prospect ; deux mécaniques non cumulables demandent un paragraphe et une FAQ, au pire endroit possible du tunnel.

**Non-réponse** : « La demande n'a pas été confirmée à temps », puis des alternatives proches capables d'assurer un service équivalent. **Jamais présenté comme une confirmation ni comme un no-show.**

### Revendication

Preuves : e-mail de domaine, téléphone business, site ou réseau officiel, codes, documents. Validation **automatique si la preuve est forte, manuelle si ambiguë**. Revendications concurrentes : blocage de la seconde et arbitrage manuel — jamais « dernier arrivé gagne ».

Le professionnel récupère : identité, vrais abonnés FadeUp, vues de profil, demandes reçues, demandes actives, historique de provenance.

Un barber salarié peut revendiquer **son identité personnelle**. Cela n'en fait pas une offre marketplace autonome.

**Follows autorisés avant revendication** — moteur d'acquisition majeur.

Retrait de la marketplace : **72 h maximum** après validation.

### Données publiables

Nom, catégorie, adresse ou zone de service, site, liens sociaux, données professionnelles publiques légitimes. Photos, horaires et tarifs **seulement si provenance et droits le permettent**. Jamais d'activité opérationnelle inventée.

**Les notes Google ne sont jamais présentées comme des avis FadeUp.** Toute donnée externe apparaît comme telle, avec attribution.

### Mesure

Tunnel réel calculé : `discovered → claim → activated → paid`, par période, cohorte et source. Aucun objectif codé. Les statistiques du prospect — vues réelles, follows, tentatives de réservation — lui sont montrées : c'est un levier commercial de premier plan.

---

## 6. Réservation

Parcours court : **Profil → Réserver → Service → Barber si nécessaire → Date et heure → Confirmé.**

- **Pas de réservation anonyme.** Inscription ultra-légère dans le flux : lien magique, code à usage unique, contact minimal.
- Fenêtre : jusqu'à **90 jours** à l'avance, jusqu'à **15 minutes** avant si la disponibilité est réelle.
- **Un service principal par réservation.** Multi-service en V1+.
- Depuis un profil barber : barber présélectionné. Depuis un profil salon : barber choisi ou **premier professionnel disponible**.
- Prix affiché = prix attendu. Toute variation connue est explicite **avant** confirmation. Override par professionnel possible.
- Pas de tarification dynamique au lancement.
- **Annulation libre jusqu'à 12 h avant.** Annulation tardive historisée, sans pénalité financière fictive.
- **No-show : aucune restriction automatique du client.** Enregistré, alerte contextuelle discrète au professionnel.
- Report en libre-service. Annulation par le salon : notification immédiate, rebooking, alternatives. Pas de compensation automatique.
- Réservations futures simultanées : **5 par défaut**, réglable depuis `/platform`, surchargeable par salon.
- Plusieurs salons le même jour si les créneaux ne se chevauchent pas.
- Note libre courte et optionnelle.
- Rappels : push ou e-mail à ~24 h, rappel court à ~2 h si pertinent. **Pas de SMS.**
- Confirmation la veille possible, mais **l'absence de réponse n'annule jamais**.
- « Réserver à nouveau » : même barber et même service préremplis, prochain créneau réellement disponible.

---

## 7. Live Queue

Objet opérationnel réel. **Jamais un décor avec un faux temps d'attente.**

- **Présence physique exigée** : géofence de **150 m** combinée au **QR du salon**.
- Temps d'attente estimé affiché **seulement** si les données sont fiables. Sinon, aucune minute affichée.
- Après appel : **5 minutes** de grâce par défaut, réglable par salon. Absent : sorti, peut rejoindre si la file reste ouverte.
- Le client voit **sa position exacte et le nombre de personnes devant**. **Jamais l'identité de qui que ce soit.**
- Choix du barber si le salon exploite des files distinctes, sinon premier disponible.
- Réorganisation manuelle par les rôles habilités, avec audit.
- Capacité : **20 personnes par barber** par défaut, réglable `/platform`, surchargeable par salon.
- Mode hybride : **les rendez-vous sont protégés à leur heure** ; les walk-ins consomment la capacité restante.

> **ÉCART constaté en P1a.** `join_public_queue` accepte aujourd'hui une entrée **sans preuve de présence**. Ni QR ni géofence en base. À corriger avant toute mise en production de la file.

Waitlist : V1+. Premier éligible arrivé, **aucun favoritisme pour un client fidèle**.

---

## 8. Découverte

- **Ne pas déclencher la géolocalisation à l'ouverture.** La demander au moment d'un usage qui en dépend. Refus : recherche manuelle par ville, quartier, adresse.
- Rayon par défaut **10 km** en zone urbaine.
- Tri par défaut : **score FadeUp**. Formule à concevoir plus tard, **architecture modulaire, sans poids codés en dur dispersés**.
- **Payer ne donne pas un meilleur classement organique.** La mise en avant sponsorisée viendra plus tard, achetée depuis Pro, et **sera clairement marquée**.
- Recherche par style — fade, taper, burst fade, dégradé — en plus du nom, du service, du lieu.
- Filtres : disponibilité, distance, prix, ouvert maintenant, type de service, file quand elle est réelle.
- **« Disponible maintenant » = peut réellement servir dans les 60 prochaines minutes**, par créneau ou par file. Être ouvert ne suffit pas.
- Zéro résultat : élargissement progressif, zones voisines, alternatives. **Jamais de résultat inventé.**
- Barber mobile : type Independent avec zone de service. **Jamais de fausse adresse physique.**
- Prix « à partir de » : minimum réel des services actifs et réservables.

> **PIÈGE constaté en P1a.** `search_public_professionals` restreint bien via `p_entity_type='shop'`, mais **le défaut `NULL` retourne aussi les barbers salariés comme résultats autonomes**, ce qui viole la loi produit du §2. À corriger en base, ou à forcer systématiquement côté front.

---

## 9. Profils publics

### Identité à trois couches

| Table | Rôle |
|---|---|
| `professionals` | identité publique portable — `handle` unique, revendication, visibilité. Survit au changement de salon. |
| `barbers` | lien d'emploi : organisation + profil staff + professionnel. **La** table de rattachement. |
| `staff_profiles` | profil interne à l'organisation, rattaché à un lieu. |

**Ne jamais créer de table de rattachement supplémentaire.** Un professionnel qui change de salon garde handle, abonnés et historique public.

`organizations.business_type` : `solo_professional | barbershop | hair_salon | mixed_salon | multi_location`. C'est cette valeur qui conditionne l'interface pro.

### Hiérarchies

**Profil barber** : média et avatar → identité → état revendiqué ou vérifié → handle et accroche → **« Travaille chez [Salon] »** cliquable → localisation → **RÉSERVER** → Suivre → signaux opérationnels réels → portfolio → services → preuve sociale → avis.

**Profil salon** : imagerie du lieu → identité → note si réelle → adresse et état d'ouverture → **RÉSERVER** → Suivre → Services → Équipe → Réalisations → Avis → Horaires et à propos.

### Règles

- Tous les membres publics pertinents sont visibles. **CTA de réservation seulement pour ceux qui sont réellement réservables.**
- Portfolio non obligatoire. Pas de plafond arbitraire : pagination et chargement paresseux, première tranche de 30 éléments.
- Le barber publie son travail ; le propriétaire ou manager gère la galerie du lieu selon ses permissions.
- Handle visible surtout dans profil, social et partage. Les salons ont aussi un handle.
- Réservation indisponible : **le profil reste visible**, Suivre et portfolio accessibles, le CTA affiche l'état réel ou une alternative.
- Horaires : semaine plus état ouvert/fermé maintenant.
- **Abonnés : public. « Coupes réalisées » : jamais.** Préférer « Clients vérifiés » quand la preuve est solide.

### Claimed, verified, preuve sociale

**Claimed et Verified sont deux concepts distincts.** Un profil peut être revendiqué sans traitement « vérifié » spectaculaire.

Non revendiqué doit paraître **transparent, neutre, digne de confiance — ni dangereux, ni spam**. Direction de langue : « Pas encore géré sur FadeUp ». **Jamais de badge d'alerte rouge.**

**Cinq métriques visuellement distinctes** : Followers, Verified Clients, Rating, Reviews, Likes. **Followers ≠ Verified Clients.** Ne jamais les agréger en un compteur unique.

---

## 10. Fade Passport

Produit signature, intégré au profil, à la réservation et au Wallet. Ni caché dans les réglages, ni imposé par un onboarding envahissant.

- **Créé automatiquement pour tout client enregistré.** Constat P1a : trigger `AFTER INSERT ON customer_profiles`, idempotent. Conforme.
- Le professionnel n'accède qu'aux informations nécessaires à une relation active et autorisée. **Partage explicite pour le sensible**, avec expiration.
- Les **notes privées du professionnel appartiennent au CRM**, pas au Passport.
- Portable d'un salon à l'autre.
- Numéro principalement interne ; QR ou identifiant visible seulement quand utile.
- Photos réutilisables en social **uniquement avec consentement explicite**.

ADN visuel : personnel, premium, persistant, reconnaissable, natif Wallet. Inspiration Apple Wallet possible, mais **jamais l'aspect** d'une carte bancaire, d'un wallet crypto, d'un pass NFT ou d'une carte d'embarquement.

---

## 11. Social

- **Aucun commentaire. Aucun hashtag.** Pas maintenant.
- **Pas de publication client.** Le client peut contribuer une photo en tant qu'avis, avec consentement.
- Tout profil professionnel revendiqué peut publier, y compris en Free.
- **Média obligatoire.** Jusqu'à 10 médias. Vidéo **60 secondes maximum**.
- Lien vers un service : **optionnel**. Sans lien, c'est du portfolio. Avec lien, conversion directe « réserver cette coupe ».
- **Le contenu Instagram scrapé n'entre jamais comme contenu FadeUp natif** sans les droits.
- Likes publics. Identification d'autres professionnels : V1+.
- Partage externe : feuille native, lien, Instagram et WhatsApp.
- Classement algorithmique. Signaux : relation, proximité, fraîcheur, engagement, capacité à être réservé. Suggestions **fortement locales**.
- Non connecté : profils et travaux publics consultables ; personnalisation et interaction persistante exigent une connexion.
- Notifications sociales : follow et likes importants.

**Abonnement automatique** possible après interaction réelle éligible. Le client en est informé et peut se désabonner. **Un désabonnement explicite est définitif : une nouvelle réservation ne force jamais un nouveau follow.**
> Constat P1a : `ON CONFLICT DO NOTHING` avec pierre tombale `unfollowed` durable. **Conforme, pas de bug.**

---

## 12. Avis

**À créer entièrement — rien en base.**

- Éligibilité : **uniquement après un service terminé**, avec relation vérifiable.
- **1 à 5 étoiles, commentaire facultatif.** Note globale seule en V1.
- **Un seul acte d'avis par le client.** Il alimente la réputation du barber **et** du salon.
- Réponse publique du professionnel autorisée.
- Suppression : modération pour fraude, abus, données personnelles, haine, conflit d'intérêt. **Jamais « supprimer parce que la note est mauvaise ».**
- Fenêtre : **30 jours** après la prestation.
- **Les avis Google ne sont jamais intégrés comme avis FadeUp.**

---

## 13. Notifications

Canaux : **push applicatif, Wallet et Fade Passport, e-mail. Pas de SMS. WhatsApp hors V1.**

Priorité client : confirmation → modification ou annulation → rappel → appel et état de file → rebooking et avis.
Priorité pro : nouvelle réservation → annulation ou report → file et walk-in → alertes opérationnelles → signaux de demande et de revendication.

- Préférences par catégorie et canal, **sauf transactionnel et sécurité**.
- Marketing : **~2 sollicitations par semaine maximum**. Transactionnel selon nécessité.
- Transactionnel immédiat, digest optionnel pour le reste, **heures calmes respectées** pour le non urgent.
- **Aucune messagerie native.**
- Téléphone du client visible aux seuls rôles autorisés, pour une relation opérationnelle justifiée. Téléphone du salon visible s'il le publie.
- Après la prestation : remerciement → demande d'avis → rebooking au bon moment.

---

## 14. FadeUp Pro

Un système d'exploitation, pas un calendrier.

- **Accueil : TODAY / NOW / NEXT / QUEUE.**
- Trois actions dominantes : gérer le prochain rendez-vous, gérer la file et les walk-ins, créer ou modifier une réservation ou un client.
- Mobile et tablette pour l'opérationnel, desktop pour calendrier large, management, CRM, analytics.
- Agenda : **mobile en vue journée chronologique, desktop en vue semaine par ressource.**
- Barber salarié : son agenda par défaut, accès équipe selon rôle. Propriétaire, manager, réceptionniste peuvent modifier l'agenda d'un autre.
- Réservation manuelle, blocage de temps ponctuel et récurrent.
- « Terminé » en **un geste**.
- **Aucune saisie de montant encaissé.** Le revenu se calcule depuis le prix configuré. POS et caisse comptable hors périmètre V1.
- Indicateurs patron : réservations, prestations terminées, revenu calculé, panier moyen, clients récurrents, taux de répétition, utilisation, no-show, file, acquisition et conversion, rétention.
- Catalogue prérempli par métier, puis contrôle total du professionnel.
- Ajout d'équipe par invitation e-mail ou lien sécurisé.
- **Départ d'un barber** : réservations futures du salon **réassignées**, historique conservé, identité professionnelle personnelle distincte de la propriété du salon.
- CRM : identité, historique, prochaines réservations, fréquence, relation, notes privées.

FadeUp Pro ne doit ressembler ni à un admin SaaS générique, ni à une démo shadcn, ni à un tableau de bord fintech, ni à douze cartes de KPI en grille.

**Insight > data dump.** L'analytics doit répondre : que s'est-il passé ? pourquoi ? que faire ensuite ?

---

## 15. Onboarding professionnel

**Cinq étapes maximum, objectif cinq minutes pour être réellement réservable.**

Obligatoire : identité et contact, type d'activité, lieu ou zone de service, fuseau horaire, au moins un service avec durée et prix, disponibilité, éléments légaux.

Catalogue prérempli. Sauvegarde progressive, reprise, rappels, check-list. **Jamais de fausse capacité de réservation avant que les données critiques soient complètes.**

Validation automatique si les preuves suffisent, revue humaine si risque ou ambiguïté. Accompagnement guidé et support humain pour les premiers professionnels.

---

## 16. Compte client

Accueil d'un client récurrent : prochaine réservation ou file active → réserver à nouveau → profils suivis et près de vous → Fade Passport → activité pertinente.

Pas de programme de points FadeUp en V1. Le Passport peut transporter les programmes de fidélité réels des salons.

Historique complet, photos seulement quand elles existent et sont autorisées. Suppression de compte en libre-service : données personnelles supprimées ou anonymisées, données transactionnelles nécessaires conservées selon la loi.

---

## 17. Identité visuelle

### Personnalité

**Oui** : premium, culturel, moderne, confiant, social, natif consumer, rapide, digne de confiance, désirable, précis, global.
**Non** : corporate, SaaS générique, logiciel de salon générique, crypto, web3, startup IA, tableau de bord bancaire, interface de jeu, marketplace bon marché, cliché de barbershop.

Le test : un barber doit **vouloir** partager son profil. Un client doit sentir que FadeUp a sa place à côté des meilleures applications de son téléphone. Un patron doit trouver Pro assez sérieux pour faire tourner son commerce.

### Logo — verrouillé

Asset canonique : `/opt/fadeup/img/fadeup-mark-primary.png` (1254×1254, md5 `46351c8dc45b1cf330bcdbdacae872f3`). Anneau tressé vert, abstrait, circulaire, dimensionnel, **non lettriste**.

**Interdit** : le redessiner, le régénérer, l'approximer, en faire un F, ajouter un F, changer le nombre de formes entrelacées, aplatir sa géométrie, écraser le fichier source.

Lisibilité mesurée : parfait à 512 px, lisible à 64, tresse fusionnée à 32, illisible à 16. Un micro-mark simplifié est un **dérivé technique secondaire** pour favicon et icône d'application — il ne remplace jamais le master.

**Le logo est le seul élément à dégradé de l'interface.**

### Direction retenue — A, Éditorial minimal

Blanc tournant fort, conduite typographique, vert très retenu, hiérarchie produit très lisible, cartes rétrogradées en rangées à filet fin pour la densité de comparaison.

Emprunts actés : le sombre sélectif pour les moments de marque et le Passport ; une ombre unique pour les barres d'action collantes.

**Consumer : clair d'abord.** Le logo est déjà spectaculaire ; l'interface autour ne doit pas devenir bruyante. **Le vert est un signal de marque, pas de la peinture** — il ne couvre pas les surfaces.

**Pro : sombre, dense.** La hiérarchie passe par la valeur de fond et les bordures, pas par l'ombre.

**Marketing et Platform : sombre éditorial.**

### Palette

--fu-brand-primary 
#00C27A
--fu-brand-interaction 
#28E18E
--fu-brand-deep 
#00875A
--fu-brand-soft 
#E6FFF3
--fu-ink 
#080F0D
--fu-dark-surface 
#0F1A16


Contrastes mesurés : texte principal sur blanc 19,36:1 ; secondaire 5,48:1 ; **encre sur vert 8,30:1** ; sombre 15,48:1 et 6,55:1.

**Blanc sur vert est interdit : 2,33:1.** C'est l'échec exact de la version précédente.

**CTA transactionnel dominant : vert plein, texte encre.** Réservé au CTA dominant. Follow reste secondaire, **jamais vert plein**.

**Le bleu ne devient jamais silencieusement la couleur primaire de FadeUp.** Un lien bleu par défaut, un focus bleu du navigateur, une teinte d'information bleue : chacun est une fuite.

### Typographie — deux rôles

**Marque** : **Poppins** — logo, wordmark, print, signalétique, page marketing. Déjà produit, intouché.

**Interface** : **Geist Sans**, famille unique. **Geist Mono** pour horaires, durées, prix en colonne, identifiants.

Échelle : 12 / 14 / 16 / 20 / 24 / 32 / 44 / 60. Le 12 px est réservé aux badges et puces ; **aucun texte lisible sous 14 px**. Corps à 16 px minimum, ligne sous 72 caractères. `tabular-nums` sur toute donnée numérique alignée. Arabe : IBM Plex Sans Arabic en chargement conditionnel.

Poppins n'entre pas dans l'interface : trop large pour une ligne d'agenda dense — mesuré en P1a à +33 % de hauteur contre Geist — et elle décroche en petit corps. Repli documenté sur Switzer, non activé.

### Formes et élévation

**Le rayon est hiérarchisé, pas uniforme.** Catégories distinctes : contrôle, carte, média, modale, feuille, avatar, icône d'application. Tout à 24 px est un marqueur d'interface générée.

Cinq niveaux d'élévation : plat, subtil, collant ou interactif, feuille ou modale, overlay exceptionnel. Ombres discrètes.

### Iconographie

Contour d'abord, épaisseur constante, natif consumer, précis, minimal. **Consumer et Pro partagent la même famille d'icônes.** Pas d'icône décorative.

### À proscrire

Défauts Tailwind non retouchés, aspect shadcn brut, grandes cartes arrondies génériques, dégradés violets SaaS, glassmorphisme partout, titres géants vides de sens, sections immenses et vides, admin B2B générique, icônes décoratives aléatoires, libellés en majuscules espacées au-dessus des titres, métadonnées jointes par points médians, un seul mot du titre coloré, flèche « → » collée aux liens, même ombre grise sous toutes les cartes, marqueurs `01 / 02 / 03` sur ce qui n'est pas une séquence.

---

## 18. Architecture

Une seule application, `apps/web`, découpée par routes et shells.

src/
app/routes.tsx
app/shells/{ConsumerShell,ProShell,MarketingShell,PlatformShell}.tsx
features/
discovery/ professional-profile/ organization-profile/
booking/ queue/ passport/ reviews/ social/ feed/ account/
pro-today/ pro-agenda/ pro-requests/ pro-queue/ pro-catalog/
pro-team/ pro-crm/ pro-insights/ pro-billing/ pro-settings/
platform-*/ marketing/
shared/{ui,data,realtime,i18n,lib,hooks,theme}


`features/*` importe `shared/*`, **jamais une autre feature**. Lint bloquant.

Bundles `pro`, `platform` et `marketing` chargés paresseusement. Budgets : entrée consumer sous 180 Ko gzip, route la plus lourde sous 120 Ko gzip additionnels.

**Stack** : la pile réelle du dépôt fait foi (React 19, Tailwind 4, router 7, oxlint). `/platform` est en production dessus ; toute rétrogradation est un risque disproportionné. TypeScript `strict`, aucun `any`, aucun `@ts-ignore`. `noUncheckedIndexedAccess` à activer progressivement.

**Pas de bibliothèque de composants tierce.** Radix est autorisé comme primitif sans style, pour l'accessibilité et le comportement. shadcn/ui : référence de lecture, jamais dépendance.

**Couche data** : TanStack Query exclusivement. Fabriques de clés par domaine, aucune clé en dur dans un composant. Le client Supabase n'est importé que par `features/*/api/`. Optimisme réservé à like, follow, favori — **jamais** sur une réservation, une entrée en file, une annulation.

**Règle absolue : chercher la RPC avant d'écrire une requête.** La base porte 186 fonctions. `.from('appointments').select()` là où `get_my_appointments()` existe contourne la logique métier et les garde-fous RLS.

### La route `/demo`

Tout ce qui est construit à partir de P1 vit sur `/demo`, **avec de vraies données et de vraies RPC** — ce sont les squelettes réels que P2 à P5 complètent, pas des maquettes jetables. Protégée par `VITE_ENABLE_DEMO`, en `noindex`, absente de toute navigation.

La galerie de primitives reste séparée sur `/dev/ui`, derrière `import.meta.env.DEV`.

---

## 19. Realtime, i18n, motion, responsive, accessibilité

**Realtime** — centralisé dans `shared/realtime/`, aucun composant ne crée un canal. Tables publiées : `appointments`, `queue_entries`, `notifications`, `location_service_settings`, `service_mode_overrides`, `time_blocks`, `memberships`. Un canal par contexte. Les événements invalident des clés Query ; écriture directe dans le cache réservée à la file. Backoff exponentiel plafonné à 30 s, refetch complet à la reconnexion, indicateur hors ligne après 10 s, nettoyage au démontage.

**i18n** — FR et EN complets. Zéro chaîne en dur, lint bloquant. **Propriétés logiques CSS uniquement, aucun `left` ni `right`.** Tout en UTC : affichage pro dans le fuseau du lieu, affichage client dans celui de l'appareil, mention explicite quand ils diffèrent. `Intl` pour nombres, dates, devises, durées. La contrainte `profiles_locale_valid` autorise dix valeurs ; le sélecteur n'en expose que `fr` et `en`.

**Motion** — un seul moment orchestré par écran. 120 ms retour immédiat, 220 ms transition d'état, 320 ms feuille ou modale, courbe `cubic-bezier(0.2, 0, 0, 1)`. La motion répond à une action et montre ce qui a changé. **`prefers-reduced-motion: reduce` supprime translations et échelles, garde l'opacité sous 100 ms — non négociable.** Les listes realtime n'animent que l'élément modifié. À éviter : rebond exagéré, animations lentes, ressorts permanents, flou dramatique, motion décorative.

**Responsive** — mobile-first strict, ruptures 390 / 430 / 768 / 1024 / 1440. **Desktop composé intentionnellement, pas du mobile étiré.** Aucune largeur en dur hors tokens.

**Accessibilité** — WCAG AA sur l'interface essentielle : focus visible, interaction clavier, cibles tactiles de 44 px, états sémantiques, libellés lecteur d'écran, motion réduite, contraste suffisant. **Ne jamais reposer sur la seule couleur pour signaler un état.**

---

## 20. États — tous, pas seulement les heureux

Génériques : `DEFAULT`, `HOVER`, `PRESSED`, `FOCUS`, `DISABLED`, `LOADING`, `SKELETON`, `EMPTY`, `ERROR`, `SUCCESS`.

Spécifiques FadeUp : `UNCLAIMED`, `CLAIMED`, `VERIFIED`, `FREE`, `TRIAL`, `PAID`, `BOOKABLE`, `NOT BOOKABLE`, `AVAILABLE`, `UNAVAILABLE`, `PENDING REQUEST`, `CONFIRMED`, `QUEUE OPEN`, `QUEUE FULL`, `QUEUE CLOSED`, `CALLED`, `MISSED`, `REALTIME UPDATE`, `OFFLINE`, `RECONNECTING`, `PARTIAL DATA`.

**Chaque état vide propose une action.** Un cul-de-sac est un défaut.

---

## 21. Ce qui reste à créer en base

Le graphe social existe : `professional_follows`, `organization_follows`, `customer_favorites`, avec leurs RPC. **Ne pas les recréer.**

Manquent :
- **Publications** : `posts`, `post_media`, `post_services`, `post_likes`. **Pas de `post_comments`.** Bucket `post-media`, non public, URL signées, calqué sur `passport-photos`.
- **Avis** : note 1 à 5, commentaire facultatif, lien vers le rendez-vous terminé, rattachement au professionnel **et** à l'organisation, réponse publique, signalement, agrégation de réputation.
- **Preuve de présence en file** : QR et géofence.
- **Wallet** : passes Apple et Google.
- **Création de `pending`** dans le tunnel d'acquisition.
- **Alignement du catalogue tarifaire et tables Stripe.**

**Conventions à respecter** — le schéma existant est cohérent : nommage des contraintes en `<table>_<règle>`, trigger `set_updated_at` sur toute table datée, fonction de garde `check_<table>_consistency` quand une ligne référence deux entités devant appartenir à la même organisation, accès public par RPC `security definer` nommée `get_public_*` / `list_public_*` / `search_public_*`, **RLS activée sans exception**.

---

## 22. Non-goals

- **Paiement client en ligne, sous toutes ses formes.** Paiement sur place. Stripe sert **uniquement** aux abonnements professionnels.
- Commission sur les réservations.
- Commentaires, hashtags, publication client, messagerie native, stories, direct.
- SMS et WhatsApp.
- POS et caisse comptable.
- Réservation de groupe, réservation pour un tiers, multi-service, recherche enregistrée, tarification dynamique. Tous V1+.
- Application mobile native ; migration Next.js ou rendu serveur.
- Tout ce qui touche `prospect_*`, `outreach_*`, `ml_*`, `whatsapp_*`, `api_source_*` côté frontend. Le Worker n'a pas d'interface ; seulement des lectures depuis `/platform`.

---

## 23. Décisions du fondateur en attente

1. ~~Grille tarifaire~~ — **TRANCHÉ** : le catalogue en base fait foi (0/19/29/49/79 € + famille multi_salon). Restent à construire : annuel, essai 14 jours, tables Stripe.
2. **Priorité du chantier base** : création du `pending`, défaut de `search_public_professionals`, preuve de présence en file. **Le premier conditionne toute la boucle d'acquisition.**
3. **Formule du score FadeUp**, mécanique de la mise en avant sponsorisée, modèle d'estimation du temps d'attente. Architecture modulaire exigée dès maintenant, implémentation plus tard.
