# PLAT-2 — Les écrans par rôle, et les affiches QR

**Branche** `plat2/role-screens`, créée depuis `rebuild/social-first-v2` (`585ddc2`).
**Base** : cinq migrations appliquées en production le 2026-09-11.
**Fusion** : aucune.

---

## 1. La preuve que `/platform` est intact

C'est le point le plus important du rapport, alors il passe en premier, et il
est **mesuré** plutôt qu'affirmé.

### Le protocole, repris tel quel de PLAT-1

Le relevé de PLAT-1 (`apps/web/e2e/plat1/platform-baseline.mjs`) parcourt les
**33 routes** de la surface — 3 portes publiques, 27 routes gardées, la
redirection de la garde, une route inexistante — et produit pour chacune : code
HTTP, URL finale, titre, thème, police calculée, intertitres, liens de
navigation, nombre de tableaux, de boutons, de champs, longueur du texte,
débordement à 390 px, erreurs console, réponses ≥ 400, plus deux captures.

**L'« avant » a été relevé AVANT la première ligne de ce lot**, sur ce worktree
resté au commit de départ. L'« après » l'a été sur le même serveur, contre la
même base, avec le même compte et le même navigateur.

Empreintes : `docs/reports/plat2/avant/avant.json` et
`docs/reports/plat2/apres/apres.json`. Captures : 66 de chaque côté.
Comparateur : `apps/web/e2e/plat2/compare-baseline.mjs`.

### Le résultat

| | |
|---|---|
| Routes comparées | **33** — la liste des chemins est identique des deux côtés |
| Routes **supprimées, renommées ou déplacées** | **0** (le comparateur échoue si la liste change) |
| Empreintes identiques une fois les **5 liens de navigation neufs** neutralisés | **31** |
| … dont strictement identiques champ à champ | 5 |
| … dont ne différant QUE par la barre de navigation | 26 |
| Routes dont l'empreinte diffère **autrement** | **2**, aucune causée par le CODE de ce lot — l'une par les campagnes e2e (les miennes comprises), l'autre par un lot voisin (§1.2) |
| Erreurs console, avant / après | **0 / 0** |
| Réponses HTTP ≥ 400, avant / après | **0 / 0** |
| Routes débordant horizontalement à 390 px, avant / après | **3 → 1** (deux CORRIGÉES, voir §1.3) |

### 1.1 L'écart voulu : cinq liens de plus

Le lot livre cinq écrans. Leurs cinq liens apparaissent dans la barre de
navigation, donc `navLinks`, `textLength` (+39 caractères, exactement) et
`bodyTextHead` changent sur toutes les routes gardées. **C'est ce que le lot
devait faire.** Le comparateur retire ces cinq liens et exige l'identité sur
tout le reste — titre, thème, police, intertitres, tableaux, boutons, champs,
code HTTP, URL finale, erreurs, échecs réseau.

### 1.2 Les deux écarts restants — ni l'un ni l'autre n'est de PLAT-2

1. **`/platform/organizations`**, +1 047 caractères. **Aucune ligne de code de
   cette page n'est touchée par PLAT-2.** Vérifié en base : **vingt et une
   organisations `qa-f1-*` ont été créées entre 18:19 et 20:12** par les
   campagnes e2e — celles d'un lot voisin **et les miennes**. C'est le motif
   connu de `QA_DATA.md` §3 : la suite F1 crée 2 organisations par campagne,
   parce que son premier test EST l'installation d'un salon. **La moitié de
   cet écart est donc de ma main, et je ne l'attribue pas au voisin.** C'est
   le contenu de la table qui a bougé sous le relevé, pas la page — même
   cause que l'écart n° 3 de PLAT-1, et le même coût connu d'une campagne
   complète.

2. **`/platform/audit`**, +654 caractères. **Cinq lignes de journal
   `customer_notes_read`** — c'est l'action d'audit **d'OS-2**, qui tourne en
   parallèle. Vérifié en base : ce sont les SEULES lignes écrites depuis le
   relevé « avant », et aucune ne vient de PLAT-2 (la suite de permissions de
   ce lot tourne en transaction annulée et ne laisse rien).

### 1.3 Ce que ce lot change VOLONTAIREMENT dans la surface existante

Cinq primitives partagées de `/platform` sont touchées, **chacune pour un
défaut mesuré, jamais pour un goût**. Une seule se voit dans l'empreinte ;
les quatre autres ne changent ni un texte, ni une structure, ni un compte.

| Primitive | Défaut mesuré | Effet sur l'empreinte |
|---|---|---|
| `index.css` → conteneur de tableau | trois écrans **faisaient défiler la page entière** latéralement sur un téléphone — PLAT-1 §15.5 les avait consignés « ni créés ni corrigés » | **visible** : `/platform/team` (187 px) et `/platform/acquisition/jobs` (585 px) passent de « déborde » à « ne déborde pas » |
| `navbar.tsx` | cinq liens **inatteignables** sur 1440 px, défaut introduit par ce lot | aucun (mêmes liens, même texte) |
| `metric.tsx` | contraste 2,41:1 | aucun |
| `page-header.tsx` | contraste 2,26:1 | aucun |
| `segmented-control.tsx` | contraste 4,14:1 | aucun |

Détail et mesures en §8.2 et §8.3.

Le troisième écran hérité qui débordait, `/platform/acquisition/sources`,
déborde encore de 241 px : c'est un **vrai** débordement de mise en page
(`body.scrollWidth` = 631), pas le défaut de peinture corrigé ici. Hors
périmètre, consigné en §12.

### 1.4 La garde d'accès

**Au moins aussi stricte, et strictement plus stricte sur un point.**
`moderate_review` et `moderate_post` exigeaient un motif **facultatif** ;
elles l'exigent désormais, pris dans un vocabulaire fermé, et **remettre en
ligne devient un geste d'administrateur** (§3.2). Aucune garde n'est
assouplie. Aucune policy n'est élargie : les cinq écrans lisent par des RPC
`SECURITY DEFINER` gardées, dont le périmètre est écrit en un seul endroit.

---

## 2. Le modèle de ticket

### 2.1 Ce qui existait : rien

Vérifié avant d'écrire : **aucune table `*ticket*` n'existe en base**, et
aucune RPC n'en approche. Le support n'avait pas de file. Il fallait donc la
créer.

### 2.2 Ce que j'ai créé

| Objet | Rôle |
|---|---|
| `public.support_tickets` | le ticket : référence lisible au téléphone (`T-00001`, une séquence et non un aléa), origine, sujet, statut, assignation, ce qu'il concerne, **son échéance**, sa résolution |
| `public.support_ticket_messages` | **l'historique des échanges, en AJOUT SEUL** — déclencheur sans aucune exemption de rôle, le motif exact de `platform_audit_log` |
| 6 RPC | ouvrir, lister, ouvrir la fiche, écrire un message, assigner, résoudre |
| 4 droits | `support.tickets`, `support.dossier`, `queue.remove`, `email.resend` — fondateur, admin, support |

**Quatre contraintes de forme portent les règles**, plutôt que l'interface :
un ticket résolu porte sa date **et** son mot de résolution ; un ticket
d'origine RGPD porte la demande qu'il traite ; un seul ticket ouvert par
demande de retrait ; un message ne se modifie ni ne s'efface.

### 2.3 Ce qui ouvre un ticket : deux origines sur quatre, et c'est dit

| Origine | État | Pourquoi |
|---|---|---|
| `phone` | **BRANCHÉE** | le support décroche et saisit. C'est le plus simple, et le lot demandait de commencer par là. |
| `gdpr_withdrawal` | **BRANCHÉE** | ouverte à la main **depuis** une demande de retrait, d'un bouton. Le ticket **recopie alors l'échéance de la demande**, il ne la recalcule pas : c'est la promesse faite au professionnel par X2, pas une durée que le support redécide. |
| `report` | **NON branchée** | aucun déclencheur n'ouvre de ticket sur `review_reports`. La RPC **refuse** cette origine (`origin_not_wired`) au lieu de laisser croire qu'un circuit existe. |
| `inbound_email` | **NON branchée** | FadeUp n'a **pas de MX de réception** (verrou déclaré par X2) : rien n'arrive. Même refus. |

**Ce qui reste à brancher**, explicitement : un déclencheur sur
`review_reports` pour la troisième, et une réception d'e-mail pour la
quatrième. L'écran le dit en une phrase sous le formulaire, plutôt que de
proposer deux origines mortes.

### 2.4 Les 72 heures

`list_marketplace_withdrawal_requests` existe depuis B2 avec `hours_remaining`
et `is_overdue`, et le commentaire de la fonction dit lui-même que « c'est la
colonne sur laquelle un écran `/platform` doit alerter ». PLAT-1 §15.7
constatait que **cet écran n'existait pas** et que « les 72 heures ne sont pour
l'instant tenues par personne ».

Elles le sont maintenant. L'écran support porte la file des retraits **en tête
de page, avant la file de tickets** : ce qui est en retard en bandeau rouge, ce
qui approche du délai (sous 12 h) en bandeau ambre, et le compte à rebours
**lu de la base** — jamais recalculé côté client — rafraîchi toutes les
soixante secondes. Un test unitaire lui passe un `hours_remaining` négatif
avec une `deadline_at` incohérente pour prouver que c'est bien la valeur
serveur qui est rendue.

---

## 3. Les quatre écrans : ce que chaque rôle voit, et ne voit pas

La règle est celle de PLAT-1 : **ce qui n'est pas permis n'est pas rendu.**
Jamais grisé, jamais cadenassé — absent. Et quand l'écran entier n'est pas
pour le rôle, il rend une phrase qui le DIT, pas un tableau vide.

| | support | modération | commercial | terrain | affiches |
|---|:-:|:-:|:-:|:-:|:-:|
| fondateur, admin | ● | ● | ● | ● | ● |
| support | ● | | | | |
| modérateur | | ● | | | |
| commercial | | ● *(2 onglets)* | ● | ● | |
| stagiaire | | | | ● | |

### 3.1 `/platform/support` — la file de tickets

**Voit** : les retraits RGPD et leur échéance ; la file de tickets, triée par
la base (retard d'abord, puis échéance, puis date — l'écran **ne retrie pas**) ;
le ticket et son fil ; les trois dossiers en lecture.

**Les dossiers sont assemblés par des `SECURITY DEFINER` qui ÉCRIVENT AU
JOURNAL à chaque consultation.** C'est la raison d'être du choix : « chaque
consultation de dossier est tracée » est **impossible avec une policy** — une
policy ne peut pas écrire. Seule une fonction le peut. Corollaire technique
assumé : ces requêtes ne se rafraîchissent jamais toutes seules (ni au focus,
ni sur intervalle), pour qu'une ligne d'audit corresponde à un humain qui a
regardé, et non à un onglet resté ouvert.

**Actions de premier niveau**, chacune conditionnée à son droit et **chacune
exigeant un motif** (le serveur refuse sans) : annuler un rendez-vous, sortir
quelqu'un d'une file, renvoyer un e-mail transactionnel. Cette dernière
**poste un nouvel e-mail** plutôt que de rejouer l'ancien : la ligne d'origine
et son `dedupe_key` restent intacts, et le journal d'envoi garde les deux
faits. Elle refuse un e-mail qui a rebondi (X2 a posé la liste d'opposition
pour ça) et tout ce qui n'est pas transactionnel (B2 tient la cadence).

**Ne voit PAS** : aucun prospect, aucun pipeline, aucune statistique de
prospect, aucune file de modération, aucun geste de paiement, aucune
candidature. L'abonnement du salon est rendu **en lecture** avec une phrase
qui dit que ce n'est pas un oubli. Vérifié à deux étages : sept assertions SQL
(D1–D7) et un test unitaire qui **relit le fichier source** — un test de rendu
ne dirait rien d'un hook importé « pour plus tard ».

### 3.2 `/platform/moderation` — cinq onglets

**Avis, posts, signalements** (`moderation.content`) ; **onboardings,
revendications** (`onboarding.review`, partagé avec le commercial — décision
du fondateur).

**Masquer exige un motif**, pris dans le vocabulaire fermé des cinq motifs de
`reviews_moderation_reason_valid`. « La note est mauvaise » n'y est pas
représentable, et l'écran le DIT à trois endroits plutôt qu'une fois.

**Annuler est un geste d'administrateur.** Nouveau droit `moderation.revert`,
fondateur et admin seulement. Le modérateur masque ; il ne défait pas. Sans
cette règle, « réversible par un admin » ne voudrait rien dire de plus que
« réversible ». **Décision prise seule, §10.3.**

`posts` **n'avait aucune colonne de modération** — vérifié avant de créer :
B4 a posé `visibility = 'hidden'`, pas le tampon. Un post masqué par la
modération était donc indiscernable d'un post que son auteur avait lui-même
rendu privé. Trois colonnes (`hidden_at`, `hidden_by`, `hidden_reason`) le
réparent, et l'écran distingue désormais les deux cas en toutes lettres.

**L'arbitrage des revendications concurrentes.** `review_professional_claim`
verrouillait déjà l'identité et fermait les demandes rivales — lu et vérifié
avant d'écrire quoi que ce soit. Ce qui manquait était de **VOIR** le conflit :
`competing_pending` compte les autres demandes vivantes sur le même profil, la
file est triée les contestées en tête, l'écran les groupe par profil avec leur
preuve, et la confirmation **annonce la fermeture automatique des rivales
avant le clic**.

**Le défaut que les deux derniers onglets réparent.** Depuis PLAT-1,
`onboarding.review` est porté par le fondateur, l'admin, **le commercial et le
modérateur** — mais `professional_applications_select` et
`professional_claims_select` exigent `is_platform_admin()`. Autrement dit :
**un modérateur et un commercial pouvaient VALIDER une candidature qu'ils ne
pouvaient pas LIRE.** C'est le défaut de PLAT-1 §12.7 dans l'autre sens : une
garde d'entrée qui dit oui sur une file invisible. Réparé par deux RPC
gardées, sans élargir les policies.

**Ne voit PAS de CRM** : aucun prospect, aucun pipeline, aucune campagne
(assertions E16–E18). Le commercial, lui, ne voit ni les avis, ni les posts,
ni les signalements (E13–E15).

### 3.3 `/platform/sales` — l'atelier du commercial

**Le pipeline avec les DEUX ORIGINES**, dans l'ordre du tunnel et non dans
l'ordre alphabétique, terrain et Worker V2 en deux colonnes distinctes. Un
salon vu de ses yeux par un stagiaire ne vaut pas une fiche scrapée, et le
commercial doit le savoir **avant** d'appeler — donc dans le comptage, pas
seulement sur la fiche.

**Les statistiques du prospect.** R3 a construit ces mesures ; **aucun écran ne
les montrait**. MASTER_SPEC §5 les appelle « un levier commercial de premier
plan ». Elles sont rendues en grand : vues de fiche (fenêtre de 90 jours et
total), dernière vue, tentatives de réservation, demandes d'intérêt et
demandes **en attente**, abonnés, vues en résultat de recherche.

**Et la règle qui ne se négocie pas** : `is_published = false` veut dire que la
fiche n'est pas en ligne, donc que tous les compteurs valent zéro **parce
qu'il n'y a rien à mesurer**. L'écran ne rend alors **aucune grille de
compteurs** — il rend une phrase. Le test n'assère pas que les nombres valent
zéro, il assère que **les libellés sont absents**. C'est la différence entre
un argument de vente et un mensonge.

**L'état des relances.** B2 tient trois touches par demande, heures calmes
8 h–21 h dans le fuseau du destinataire, désabonnement définitif. L'écran rend
`touches_sent`/3, le modèle, le statut et les dates de chaque touche, et
surtout **`block_reason`** — le motif calculé par B2 lui-même qui explique
pourquoi la prochaine ne part pas. **Aucun bouton « relancer maintenant »** :
un test parcourt tous les boutons de l'écran et échoue si un libellé y
ressemble. Les échanges saisis à la main sont dans un panneau visuellement
distinct : ce ne sont pas les mêmes objets.

**Publier sur la marketplace** (`marketplace.publish`) passe par une
confirmation qui **nomme l'information RGPD de l'article 14 et la
responsabilité légale** avant que quoi que ce soit ne parte.

**Ne voit AUCUNE note client privée.** OS-2 pose ce modèle en parallèle ; le
droit `customer_notes.read` n'appartient pas au commercial. PLAT-2 ne rend
`customers.notes` sur **aucune** de ses surfaces, ni au support ni au
commercial, et un test relit le source pour l'interdire.

### 3.4 `/platform/field` — le seul écran interne dessiné pour le téléphone

**Carte par défaut, liste en second**, `SegmentedControl` entre les deux.
Dessiné pour 390 px d'abord : un champ par ligne, cibles ≥ 44 px, action
principale collée en bas dans la zone du pouce, formulaire en feuille montante.

**Aucun filtre de zone côté client**, et c'est écrit en commentaire au-dessus
de la requête : ce qui borne le stagiaire est
`private.platform_prospect_visible()` de PLAT-1. Un `.filter()` ici n'aurait
été qu'une garde d'interface, c'est-à-dire rien.

**La carte dit ce qu'elle ne peut pas montrer** : les coordonnées de
`prospect_locations` sont saisies à la main et souvent absentes. Plutôt que de
faire disparaître ces fiches en silence, l'écran annonce leur nombre et offre
la liste. Un défaut trouvé et corrigé en cours de route : la première version
affichait « aucun salon » quand la carte ne pouvait rien placer alors que la
liste en avait — un état vide **mensonger**.

**La saisie terrain** exige l'observation, comme le serveur. Les sept refus
nommés de `capture_field_prospect` sont traduits en phrases, dont le doublon :
« ce salon est déjà connu dans cette ville, rien n'a été fusionné » — la RPC
ne fusionne jamais, l'humain tranche.

**Il ne publie pas.** Aucun bouton, aucun import : un test relit le source.

### 3.5 Les cinq liens de navigation

`support.tickets` pour le support ; `moderation.content || onboarding.review`
pour la modération (partagée) ; `crm.read` pour le commercial ; `crm.zone_read
|| crm.field_capture` pour le terrain — si bien que le commercial y accède
aussi, mais y voit tout, pas une zone ; `poster.manage` pour les affiches.

---

## 4. Les affiches QR

### 4.1 Le problème, et pourquoi le code est une indirection

Le fondateur veut imprimer cent affiches **avant** de savoir quels salons les
recevront. Un QR qui encoderait le lien de file d'un salon ne peut donc pas
être imprimé à l'avance. **Le QR encode un CODE**, et le code est une
indirection dont l'état change.

### 4.2 Le modèle d'états

`public.poster_batches` (le journal des lots : quand, combien — et « lesquels »
se lit en joignant) et `public.posters` (le code, son état, son établissement,
son auteur, sa révocation, et sa trace d'envoi postal).

**Les codes sont non devinables** : dix symboles en base32 de Crockford — ni
I, ni L, ni O, ni U, les quatre qui se confondent à l'oral et à la lecture d'un
papier abîmé — tirés de `gen_random_bytes` (CSPRNG de pgcrypto), sans biais de
modulo (256 est un multiple de 32). Soit plus de 10¹⁵ combinaisons, et un code
qui se dicte au téléphone.

**Trois contraintes de forme portent les états** : une affiche attribuée porte
son établissement, son auteur et sa date ; une révocation porte son motif ;
**une affiche libre n'est attribuée à personne** — sans cette dernière, un code
libre pourrait porter un établissement résiduel et le scan y renverrait.

### 4.3 Le scan décide selon l'état ET selon qui scanne

| état | scanné par | ce qui est rendu |
|---|---|---|
| libre | quelqu'un d'habilité | **proposition d'attribution**, avec le choix explicite de l'établissement |
| libre | un client | « cette affiche n'est pas encore active » — et **aucune proposition** |
| attribué | n'importe qui | **la file du salon**, sans écran intermédiaire |
| révoqué | n'importe qui | un message clair, aucune proposition |
| inconnu ou mal formé | n'importe qui | « ce code n'existe pas », et rien de plus |

Un code mal formé **ne touche même pas la table** : la réponse est la même que
pour un code inconnu, pour ne rien apprendre à qui tâtonne.

### 4.4 Les gardes, côté serveur

- **Un patron n'attribue qu'à SES établissements** — vérifié sur `memberships`,
  rôles **owner et manager seulement**. Ni barber salarié, ni réceptionniste,
  ni client. Assertions G9 à G16, et un test e2e qui appelle la RPC
  directement.
- **Un stagiaire n'attribue que dans SES zones** — la même question que pose
  `capture_field_prospect`. Assertions G17 à G20.
- **Une affiche attribuée n'est pas détournable** — ni par un autre patron, ni
  par celui qui l'a posée vers un autre établissement. Il faut passer par une
  révocation, qui laisse une trace et un motif. G12, G13, et le test e2e qui
  essaie avec le jeton du **fondateur** et reçoit `already_assigned`.
- **Seul un interne révoque et réattribue** (`poster.manage`), motif
  obligatoire. Un patron qui scanne une affiche révoquée est refusé. G21–G26.

**Multi-établissements** : la liste est rendue par
`list_my_poster_locations()`, l'écran affiche un choix explicite, et
l'attribution reste un GESTE — un seul établissement est pré-sélectionné,
jamais attribué tout seul. Attribuer au « premier » établissement d'un patron
qui en a trois collerait l'affiche au mauvais mur, et seul un interne pourrait
défaire.

**Salon non revendiqué** : quand le code est parti par la poste vers un
prospect dont la fiche est **publiée et non revendiquée**, le scan rend un
chemin vers la revendication. C'est le crochet du lot : l'affiche physique
amène à la revendication, qui amène à l'essai. Le handle n'est rendu **que si
la fiche est déjà publique** — sinon ce serait exposer un prospect qui n'a
rien demandé.

### 4.5 Le PDF

**Écrit à la main, sans aucune dépendance** : `apps/web/package.json` n'a pas
bougé. Les bibliothèques du marché pèsent entre 300 Ko et 1 Mo pour un besoin
qui tient en trois primitives, et le budget du graphe d'entrée est une
contrainte du dépôt.

| Exigence | Ce qui est livré |
|---|---|
| QR ≥ 8 cm | **9,00 cm** de côté — mesuré non pas dans le code mais **dans les fichiers archivés** : 255,1 pt sur chacune des deux pages d'affiche. La marge d'un centimètre n'est pas décorative : un QR plastifié, scanné de biais dans un salon mal éclairé, perd de la marge de correction. |
| Le code en clair, en tout petit, sous le QR | présent dans les deux documents (13 pt sur l'affiche, 20 pt sur la lettre), espacé, précédé de « QR abîmé ? Saisissez plutôt ce code » |
| Une accroche | « Votre tour, en direct sur votre téléphone. » |
| Le logo | **le VRAI logo**, en vecteur : les tracés de `public/brand/` traduits en instructions PDF (arcs elliptiques et quadratiques convertis en cubiques). Une commande de tracé non gérée **lève** au lieu de dessiner un faux logo. |

**LA PREUVE QUI COMPTE : le QR imprimé se relit.** Vérifier qu'un carré de neuf
centimètres existe ne prouve rien — un carré noir aussi mesure neuf
centimètres. Un test **rembobine le flux de la page**, rejoue ses rectangles
sur une trame et la passe à **jsQR**, le décodeur qui sert déjà au scanner de
FadeUp. Rejoué sur les **fichiers archivés** :

```
affiche-fr.pdf  page 1 : QR lu → https://fade-up.com/a/QAPFREE001
affiche-fr.pdf  page 2 : QR lu → https://fade-up.com/a/QAPASGND03
envoi-fr.pdf    page 1 : QR lu → https://fade-up.com/a/QAPFREE001   (la lettre)
envoi-fr.pdf    page 2 : QR lu → https://fade-up.com/a/QAPFREE001   (l'affiche)
```

Les deux documents sont dans `docs/reports/plat2/pdf/`. **Ouvrez-les.**

**AUCUNE PROMESSE DE NOTIFICATION.** Elles n'existent pas avant M1c. Le texte
dit ce qui est vrai aujourd'hui : « Scannez ce code : vous voyez votre place
dans la file en direct, vous pouvez donc sortir prendre un café en la
surveillant. » Et ce n'est pas qu'une relecture : une **liste noire est
exécutée AVANT la fabrication** et refuse d'imprimer en nommant le mot fautif —
si une traduction future introduisait une promesse, cent affiches ne
partiraient pas à l'imprimeur avec elle.

Vérifié de mon côté sur les **60 chaînes réellement imprimables** (les dix clés
du PDF × les six langues d'impression), liste noire élargie aux six langues
(`notif`, `alert`, `aviso`, `avviso`, `recordatorio`, `promemoria`, `lembrete`,
`Erinnerung`, `benachricht`, `remind`, `SMS`, `push`, « on vous prévient »,
« vous serez »…) : **aucune promesse**. Et aucune de ces 60 chaînes ne contient
un caractère que les polices standard ne savent pas écrire.

**La limite des polices, déclarée.** Les polices standard d'un PDF sont
encodées en WinAnsi : le latin étendu passe, le japonais, l'arabe, le russe et
le chinois **non** — ils exigeraient d'embarquer une police de plusieurs
mégaoctets. Le PDF se choisit donc parmi **six langues** (fr, en, es, it, pt,
de), indépendamment de la langue de l'interface, et l'écran dit pourquoi.
`canEncodeWinAnsi` est consulté **avant** de fabriquer : un caractère
inimprimable fait refuser, jamais imprimer des points d'interrogation.

### 4.6 Le journal des lots

`list_poster_batches()` rend, par lot : le libellé, la note, le total, la
répartition **libre / attribuée / révoquée / envois préparés**, qui l'a créé et
quand. C'est le journal exigé ; ouvrir un lot déplie ses affiches.

---

## 5. La lettre

**Ce qui est personnalisé** : le nom du salon, son adresse postale, le code,
et **un élément de preuve tiré de l'analytics réelle**. Tout le reste est
générique et traduit.

**L'élément de preuve** vient de `get_prospect_acquisition_stats` : le nombre
de vues de la fiche (total et fenêtre de 90 jours), la date de la dernière, et
le nombre de demandes d'intérêt reçues. Il est rédigé par l'écran, nombres et
dates formatés par `Intl` dans la langue du PDF.

**Et quand l'analytics ne dit rien, la lettre part SANS élément de preuve.**
`prepare_poster_letter` rend `proof = null` ; l'écran l'annonce par un
avertissement **avant** de fabriquer ; le générateur saute l'encadré entier.
**Aucune phrase de repli chiffrée.** Deux assertions le verrouillent (G38 avec
preuve, G39 sans) et un test du générateur vérifie que l'encadré disparaît.

**Un envoi = un seul PDF** : la lettre puis l'affiche, le même code sur les
deux. Préparer une lettre **marque l'affiche comme partie par la poste** vers
ce prospect — et c'est ce marquage qui, plus tard, fait que le scan propose la
revendication si le salon n'est pas revendiqué. Elle ne se prépare que sur une
affiche **libre** : en préparer une pour un code déjà attribué enverrait le
patron vers un salon qui n'est pas le sien.

---

## 6. Migrations

Sauvegarde avant toute écriture :
`/opt/fadeup/backups/pre-plat2-20260911-173414.dump` (3,5 Mo, `pg_dump -Fc`).

**Toutes appliquées en `postgres`** (règle 1 de `DB_OWNERSHIP.md`).
**Propriétaires vérifiés objet par objet avant écriture** : les fonctions
redéfinies et les seize tables lues ou modifiées appartiennent toutes à
`postgres` — aucune moitié de migration possible.

| Migration | Contenu | Retour arrière |
|---|---|---|
| `20260911200000_plat2_support.sql` | 4 droits, 2 tables, 3 types, 1 séquence, 2 déclencheurs d'ajout seul, 6 RPC de ticket, 3 dossiers, 2 actions | **testé** |
| `20260911200100_plat2_moderation.sql` | 1 droit, 3 colonnes et 2 contraintes sur `posts`, **2 RPC redéfinies**, 5 files de lecture | **testé** |
| `20260911200200_plat2_crm_prospect_insight.sql` | 3 fonctions de lecture (statistiques, relances, pipeline) | **testé** |
| `20260911200300_plat2_qr_posters.sql` | 2 droits, 2 tables, 1 type, 8 RPC dont **la seule anonyme** | **testé** |
| `20260911230000_plat2_review_hardening.sql` | les durcissements de la revue indépendante : 5 RPC redéfinies, 1 policy resserrée, 1 ACL de séquence révoquée (§16) | **testé** |

**`create or replace` et jamais `drop` + `create`** sur les deux fonctions
existantes : une signature inchangée conserve son ACL. Un DROP obligerait à
re-matérialiser les concessions, et c'est ainsi qu'on perd un droit sans s'en
apercevoir (le piège de P1PRO, rappelé par PLAT-1 §7).

### 6.1 Le test de retour arrière

Bac d'essai **fidèle** (`db/tests/b3_restore_sandbox.sh`) : restauration sans
`--no-owner`, en `supabase_admin`, base possédée par `postgres` comme en
production. **0 erreur `pg_restore`**, propriétaires conservés (104 objets
`postgres`, 39 `supabase_admin`), 137 tables portant une ACL explicite.

Puis : instantané ACL → les migrations → la suite de permissions → les retours
arrière **dans l'ordre inverse** → nouvel instantané.

(Le chiffre de 4 464 lignes et les zéros qui suivent portent sur les **quatre
premières** migrations, mesurés avant que la revue n'en ajoute une cinquième.
Celle-ci a été montée et redescendue sur le même bac d'essai, et appliquée en
production avec un relevé ACL avant/après : **le seul privilège retiré est
celui de la séquence de tickets**, volontairement, et rien d'autre n'a bougé.)

| | |
|---|---|
| Lignes d'ACL comparées | **4 464** |
| **Écarts** | **0** |
| Objets résiduels (tables, types, colonnes, séquences, fonctions, droits) | **0** |
| Corps des deux fonctions redéfinies, après retour arrière | **identiques à la production, au caractère près** (diffé, pas affirmé) |

### 6.2 Ce qu'un retour arrière DÉTRUIT — à savoir avant de l'ordonner

Écrit en tête de chaque fichier `down`, et repris ici parce qu'un fondateur
qui ne lit que ce rapport doit l'avoir sous les yeux :

- **`…200000` détruit TOUS LES TICKETS et tout leur historique d'échanges.**
  Les tables sont supprimées, pas vidées.
- **`…200300` détruit TOUS LES CODES D'AFFICHE et leurs attributions.** Les
  affiches **déjà imprimées** deviennent des papiers morts : leur QR pointera
  sur un code inconnu. Tant qu'aucun lot n'a été imprimé, cela ne coûte rien ;
  après une impression, cela coûte le papier.
- **`…200100` détruit la trace de modération des posts** — qui a masqué,
  quand, pourquoi. Les posts masqués **restent masqués** (`visibility` n'est
  pas touchée) mais redeviennent indiscernables d'un masquage par l'auteur.
  Et les deux RPC reprennent leur corps d'avant : motif facultatif, aucune
  garde d'annulation. Le retour arrière est donc **strictement moins strict**
  que l'état après ce lot. C'est le sens d'un retour arrière, et c'est écrit
  pour qu'on le sache.
- **`…200200` ne détruit aucune donnée** : trois fonctions de lecture.
- **`…230000` ne détruit aucune donnée non plus**, mais son retour arrière est
  **moins strict sur cinq points** — une affiche postée redevient
  préemptable, un stagiaire peut de nouveau énumérer les codes, une lettre
  peut repartir vers un salon non publié, un renvoi d'e-mail cesse de
  consulter la liste d'opposition, et le drapeau de réattribution redevient
  toujours faux. C'est écrit en tête du fichier.

### 6.3 Le contrat de surface anonyme : 44 → 45

**Une RPC, et une seule** : `resolve_poster_code`. **C'est une décision, pas un
oubli** — un client qui scanne une affiche dans un salon n'a pas de compte, et
lui en demander un pour lire « cette affiche n'est pas encore active » serait
absurde. Ce qu'elle rend à un anonyme est exactement ce qui est **déjà
public** : l'état du code et, s'il est attribué, le slug du salon et son
établissement — la même information que le QR de file imprimé par le salon
lui-même (F1). Elle ne rend ni le lot, ni l'auteur de l'attribution, ni la moindre liste
d'établissements à qui ne peut pas attribuer.

**RECTIFICATION, apportée par la revue.** Une première version de ce rapport
écrivait « ni le prospect destinataire ». C'était FAUX, et la même phrase avait
été recopiée dans le commentaire de l'allowlist — c'est-à-dire dans le contrat
de sécurité lui-même. Sur un code **libre et déjà posté**, la fonction rend le
`handle` et le nom d'affichage du professionnel, **parce que c'est le crochet
que le lot demande** : « un salon non revendiqué : l'affiche devient un point
d'entrée vers la revendication ». Le handle est public ; ce qui est neuf, et
qu'il faut nommer, c'est **l'association « ce code d'affiche a été posté à ce
commerce »**, rendue à qui tient le code. Le code est non devinable et
physiquement dans l'enveloppe ou sur le mur : c'est le même modèle de menace
que le QR de file imprimé par le salon (F1). **Le comportement est voulu ; le
texte qui le décrivait était faux, et il est corrigé des deux côtés.**

L'allowlist de `db/tests/x3_anon_surface.sh` est mise à jour **dans le même
commit que la migration**, avec le motif écrit dedans. Les 25 autres RPC
neuves sont `revoke all from public, anon` puis `grant execute to
authenticated`, explicitement (règle 4 de `DB_OWNERSHIP.md`).

### 6.4 Le piège de rejeu avec B5, trouvé par contact entre sessions

B5 (`b5/missing-contracts`, non fusionnée, migrations appliquées en
production) redéfinit `reject_support_ticket_message_mutation()` — ma fonction
d'ajout seul — pour y ouvrir **une seule** porte : le caviardage d'un fil dont
le sujet a effacé son compte. Le DELETE y reste refusé à tout le monde.
Vérifié de mon côté : **mes assertions B19, B20 et B21 restent vertes avec sa
version** — UPDATE, DELETE et TRUNCATE refusés au plus haut privilège.

**Mais son horodatage était ANTÉRIEUR au mien.** Un rejeu à blanc depuis les
seules migrations, dans l'ordre des noms, aurait appliqué B5 **puis** ma
migration — et mon `create or replace`, qui ne connaît pas le caviardage,
aurait **écrasé sa porte**. L'effacement de compte se serait cassé sur un fil
de support, silencieusement, à la première suppression réelle. En production
l'ordre d'application le masquait.

Signalé à B5, qui a renommé son addendum en `20260911210000_…`, donc après le
mien. **Ni ma CI ni la sienne n'aurait vu ce trou** : il n'existe que dans le
rejeu à blanc, que personne ne fait. L'invariant est écrit au-dessus du corps
concerné : toute redéfinition future de cette fonction doit passer **après**
`20260911200000`.

---

## 7. La suite de permissions

`db/tests/verify_plat2.sql` — **151 assertions**, une seule transaction
terminée par `ROLLBACK` (règle 1 de `QA_DATA.md`). **Passée contre la
production : 0 ligne résiduelle**, vérifié après coup — 0 ticket, 0 compte, et
la table des affiches revenue à ses 3 fixtures marquées (§14), pas une de
plus.

```bash
docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
  -v ON_ERROR_STOP=1 -q < db/tests/verify_plat2.sql
```

Elle appelle **les RPC**, jamais l'interface : X3 a prouvé deux fois qu'une
garde d'interface n'existe pas.

| | Ce qu'elle couvre |
|---|---|
| **A** (8) | la grille : l'anonyme et le compte extérieur n'ont rien ; le fondateur porte tout sauf le droit borné du stagiaire ; le stagiaire porte **exactement trois droits, nommés** ; le support porte les quatre droits d'appel et **aucun droit d'affiche ni d'annulation** ; le commercial n'a ni support ni modération |
| **B** (22) | les tickets : qui ouvre, qui ne peut pas (commercial, modérateur, stagiaire, anonyme), **les deux origines non branchées refusées**, l'échéance RGPD **recopiée de la demande**, la résolution sans son mot refusée, l'assignation à un non-support refusée, les genres de message réservés, et **le fil en AJOUT SEUL — UPDATE, DELETE et TRUNCATE refusés en `reset role`** |
| **C** (8) | les dossiers : le support lit les trois, **les trois consultations sont au journal**, le commercial, le stagiaire et l'anonyme sont refusés, un identifiant nul est refusé et non rendu vide |
| **D** (14) | **support : pas de CRM, pas de facturation, pas de modération, pas d'onboarding** — et les trois actions de premier niveau qui, elles, passent, motif obligatoire compris |
| **E** (25) | modération : **masquer sans motif refusé**, « mauvaise note » **hors vocabulaire**, **le modérateur ne remet pas en ligne, l'admin si**, le tampon posé puis effacé, **le modérateur sans CRM**, les deux files partagées enfin visibles au modérateur ET au commercial, l'arbitrage des revendications rivales, le support qui ne voit rien de tout ça |
| **F** (13) | commercial : le pipeline **par origine**, les statistiques **réelles**, `is_published=false` qui rend des zéros et **le dit**, l'état des relances, **aucune note client**, le stagiaire borné à sa zone et **qui ne publie pas** |
| **G** (59) | les affiches : génération réservée, codes **distincts et non devinables**, tous libres, le journal des lots ; le patron multi-établissements qui voit **les siens et eux seuls** ; **l'attribution hors de chez soi refusée** ; **le détournement refusé, y compris par celui qui a posé l'affiche** ; le barber salarié et le client refusés ; **le stagiaire borné à sa zone** ; la révocation réservée, motivée, **et impossible deux fois** ; la réattribution interne, **distinguée au journal** ; **les cinq comportements de scan** ; la lettre, sa preuve, **son absence de preuve**, et **son refus vers un salon non publié** ; le crochet de revendication ; et les six assertions de la revue : **une affiche postée ne se préempte pas, mais son destinataire la reçoit**, et **personne n'énumère la table** |
| **H** (2) | **les treize familles d'action de ce lot ont réellement écrit au journal**, et ce journal reste en ajout seul au plus haut privilège |

`verify_plat1.sql` a dû être corrigée : ses deux assertions de comptage
portaient sur un nombre absolu de droits (« le fondateur en a 17 »), et
**OS-2 a ajouté `customer_notes.read` pendant ma session**, ce qui les faisait
rougir pour une raison étrangère à PLAT-1. Elles portent désormais sur
l'INVARIANT — tout le catalogue sauf `crm.zone_read` — et sur les droits
nommés. Elle reste verte contre la production.

---

## 8. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (`tsc -b` + `tsconfig.v2` strict) | **0 erreur** |
| `npm run lint` (oxlint + eslint `--max-warnings 0` + garde palette) | **0 erreur**, garde palette verte |
| `npm run test` (Vitest) | **819 / 819**, 93 fichiers (+1 sauté : la fabrication des PDF archivés, qui n'écrit sur disque que sur demande) |
| `npm run build` | **succès** — graphe d'entrée **230,4 Ko gzip sous le budget de 240**, aucune famille interdite |
| `db/tests/verify_plat2.sql` (production) | **151 assertions vertes, 0 résidu** |
| `db/tests/verify_plat1.sql` (production) | **verte** |
| `db/tests/probe_public_rpcs.sh --strict` | **vert** — toutes les lectures publiques en 200 |
| `db/tests/x3_anon_surface.sh --strict` | **vert** — 143 tables balayées en anonyme et en authentifié-sans-droit, contrat de surface à **45** RPC, aucune dérive |
| Relevé des 33 routes, avant / après | **31 identiques**, 2 écarts externes (§1.2) |
| `npm run e2e` — suite PLAT-2 | **36 / 36**, 390 px et 1440 px, rejouée sur l'état final |
| `npm run e2e` — campagne complète, **sur l'arbre livré** | **259 verts**, 4 rouges (2 quota Resend, 2 fixture dépendante de l'heure — prouvées, §8.5), 38 emportés par deux groupes en série |
| … et la cascade levée : tout sauf ces deux groupes | **249 / 249**, 0 rouge |
| axe, 7 écrans × 2 largeurs | voir §8.3 |

### 8.1 Les tests unitaires neufs

**Par écran** : chacun verrouille que le rôle qui n'a pas le droit obtient la
phrase de refus **et que les requêtes ne sont même pas montées** — pas
seulement que le tableau est vide. Plusieurs **relisent le fichier source** :
un test de rendu ne dirait rien d'un hook importé « pour plus tard ».

**Sur le PDF** (14 tests) : structure valide, **chaque décalage de la table
xref pointe sur le début réel de son objet** (un décalage faux produit un PDF
que certains lecteurs réparent en silence et que d'autres refusent — le défaut
qui ne se voit qu'à l'impression), QR ≥ 8 cm mesuré dans le flux, code en
clair présent, parenthèses et accents échappés en WinAnsi et non en UTF-8,
lettre avec et **sans** preuve, refus d'encoder le japonais et l'arabe, et
**le QR qui décode**.

### 8.2 La QA navigateur — cinq défauts trouvés à l'œil, pas en relisant

C'est la partie du lot où regarder a rapporté le plus.

**1. Le défilement horizontal, et une sonde qui mentait.** Six écrans faisaient
défiler la **page entière** latéralement sur un téléphone : les trois neufs de
ce lot (93 à 496 px) et deux des trois hérités que PLAT-1 avait consignés. Le
défilement allait **dans du vide** — `elementFromPoint` ne rend rien là-bas —
signature d'un débordement de **peinture** remonté au défileur racine, alors
que le tableau est bien dans son conteneur `overflow-x: auto`.

L'heuristique du relevé PLAT-1 (`documentElement.scrollWidth > clientWidth`)
**répond vrai sur des pages qui ne défilent pas**. La seule mesure qui ne ment
pas est de **tenter** de faire défiler la page et de regarder où elle
s'arrête : c'est ce que fait `apps/web/e2e/plat2/overflow-probe.mjs`.

Trois correctifs essayés et **mesurés** : `max-width: 100%`, `overflow-x:
clip` sur le conteneur, `overflow-x: clip` sur `body` — **aucun effet**. Seul
`contain: paint` sur `.fu-scroll-shadow-x` ramène le défilement à **zéro**, sur
les six écrans, et le tableau continue de défiler à l'intérieur de son
conteneur (559, 258 et 56 px de défilement interne conservés, vérifié).
Une ligne, six écrans.

**2. La barre de navigation cachait cinq liens.** La rangée défile
latéralement, **barre de défilement masquée**. À huit entrées elle tenait ; à
treize, les dernières — dont « Team » et « Audit log » — sont devenues
invisibles sur un écran de 1440 px, **sans le moindre indice qu'elles
existaient encore**. Mesuré : conteneur plafonné à 1024 px, rangée en
demandant 1059, **8 liens atteignables sur 13**. Défaut **introduit par ce
lot**, trouvé en **regardant la capture**. Au-delà du point de rupture `sm` la
rangée passe désormais à la ligne : **13 sur 13**, en-tête de 92 px sur deux
rangs. Sous `sm`, le défilement reste le comportement.

**3. Les marqueurs de la carte terrain** faisaient 32 px de zone touchable. À
32 px, le pouce d'un stagiaire debout dans la rue rate la fiche. Ils font
désormais **44 px de zone pour 32 px de rond visible** : c'est le `padding`
transparent qui porte la cible, pas le dessin.

**4. Une clé de traduction s'affichait EN BRUT** sur la page publique de scan :
`poster.inactive.signedOut`, le nom de la clé, en clair, sous les yeux d'un
client. **Rien dans la chaîne de validation ne l'a vue** — i18next replie en
silence sur la clé, `locale-completeness` ne compare que les locales entre
elles (toutes deux incomplètes, donc d'accord), rendu vert, typecheck vert, et
axe ne s'intéresse pas au sens des mots. Il a fallu **regarder la capture**.
Un test de parité relit désormais le fichier source ; le même contrôle passé à
la main sur les cinq écrans de `/platform` et la barre de navigation n'a trouvé
**aucune autre** clé manquante.

**5. Deux `<main>` imbriqués** sur l'écran public de scan — la coque consumer
en fournit déjà un. Deux repères principaux pour un lecteur d'écran. axe ne
l'attrape pas sous les étiquettes WCAG AA ; c'est faux quand même. Corrigé.

**Ce que ces cinq défauts ont en commun** : aucun n'était visible dans le code,
aucun n'a fait rougir un test, et quatre sur cinq ont été trouvés en
**regardant une image**. C'est l'argument entier du §« vérification navigateur
d'abord » du CLAUDE.md, et il a payé cinq fois dans ce lot.

### 8.3 axe

Balayage sur **les six écrans neufs plus la page publique de scan**, à 1440 px
et à 390 px : `docs/reports/plat2/axe/axe.json`, captures à côté.

**Trois défauts de contraste ont été trouvés et CORRIGÉS**, tous dans des
primitives **partagées** de `/platform` que le balayage à quatre écrans de
PLAT-1 n'avait jamais exercées :

| Primitive | Avant | Après |
|---|---|---|
| `Metric.context` (`ink-300` sur blanc) | **2,41:1** | 4,62:1 — passe |
| `PageHeader.meta` (`ink-300` sur `paper-50`) | **2,26:1** | 4,48:1 |
| `SegmentedControl`, option non sélectionnée | **4,14:1** | ~7,5:1 — passe |

`ink-300` n'est pas un état désactivé : c'est du texte qu'on doit lire.

**Après correction, les SEULES violations qui restent sur les sept écrans sont
les DEUX défauts de palette héritée que PLAT-1 avait nommés, aux ratios
exacts** : `--color-ink-500` (#66766e) sur `--color-paper-50` (#f5f8f6) =
**4,48:1** (il manque 0,02 pour AA), et blanc sur `--color-accent-600`
(#0d9b5f) = **3,57:1** (le bouton primaire de toute la console).

**Ce lot n'introduit donc aucune classe de défaut neuve, et en retire trois.**
L'écran public de scan, qui porte la palette V2 et non celle de `/platform`,
est à **zéro violation** aux deux largeurs.

La case « axe sans violation sérieuse » **reste non cochée**, pour la raison
exacte de PLAT-1 §9bis : corriger la cause veut dire modifier deux jetons de
la palette héritée, ce qui repeindrait **tous** les écrans de la console et
détruirait par construction la preuve d'équivalence du §1. Le lot dit « c'est
une surface existante, ne la refais pas ». Décision de produit, pas
d'implémentation.

**Cibles tactiles.** Hors en-tête, plus rien n'est sous 44 px sur l'écran
terrain sauf les boutons de zoom de maplibre (29 px) — c'est son contrôle, pas
le mien. Sur les écrans de bureau (support, modération, commercial, affiches),
les boutons secondaires font 36 px et les liens de tableau 20 px : c'est la
densité de la console héritée, ni améliorée ni aggravée par ce lot.

### 8.4 La campagne e2e complète

`apps/web/e2e/plat2/platform-plat2.spec.ts` — **36 tests, 36 verts**, en
390 px et en 1440 px (3,0 min) :

- la navigation **rôle par rôle** : le fondateur voit les cinq écrans neufs ;
  le support a sa file et **ni le CRM ni la modération ni les affiches** ; le
  modérateur a la modération et **pas** la file de support ; le commercial a
  le CRM **et la modération partagée** ; le stagiaire **n'a que le terrain** ;
  et **rien n'est grisé** à la place d'un lien absent ;
- un écran interdit **rend une phrase, pas un tableau vide** ;
- **les cinq comportements de scan**, sans compte, y compris le code mal formé
  qui ne produit **aucune erreur console** ;
- et six refus **avec la RPC appelée DIRECTEMENT depuis la page**, jeton du
  compte en main, exactement comme le ferait quelqu'un qui ouvre la console du
  navigateur : le commercial n'ouvre pas de ticket (`403
  fadeup_support_refusal=not_authorized`), ne lit aucun dossier
  (`dossier_not_authorized`), le modérateur ne remet rien en ligne
  (`revert_requires_admin`), le stagiaire ne génère aucun lot
  (`not_authorized`), **une affiche attribuée résiste même au fondateur**
  (`already_assigned`), et un rôle sans droit d'affiche obtient **zéro**
  établissement attribuable.

---

## 9. Git

| | |
|---|---|
| Branche | `plat2/role-screens`, depuis `rebuild/social-first-v2` (`585ddc2`) |
| Commits | 10 |
| Fichiers touchés | **aucun hors périmètre** |
| Poussée | `origin/plat2/role-screens` |
| `apps/mobile` | **intouché** (interdit par le lot) |
| `apps/web/src/features/pro-*` | **intouché** (interdit par le lot — OS-2 y travaille) |
| `apps/web/package.json` | **intouché** — aucune dépendance ajoutée |
| Fusion | **aucune** |

Les commits, du plus ancien au plus récent :

```
7626d84  feat(plat2): le socle base des quatre écrans par rôle et des affiches QR
c6eb6b6  docs(plat2): nommer le piège de rejeu avec l'addendum d'effacement de B5
3ec1482  docs(plat2): l'addendum B5 est renommé, l'invariant d'ordre reste
8131591  feat(plat2): les quatre écrans par rôle, le scan d'affiche et le PDF imprimable
bc63d64  fix(plat2): le défilement horizontal à 390 px, et trois contrastes mesurés
c9af700  fix(plat2): la barre de navigation passe à la ligne au lieu de cacher cinq liens
0511a87  fix(plat2): la suite de permissions comptait la table des affiches entière
ab5d226  fix(plat2): une clé de traduction s'affichait EN BRUT sur la page publique
efc07c7  fix(plat2): les trouvailles de la revue indépendante
         docs(plat2): le rapport et ses preuves
```

**LES PREUVES SONT DANS LE DÉPÔT.** `docs/reports/plat2/` porte les deux
empreintes JSON, les 132 captures avant/après, le relevé axe et ses captures,
et les deux PDF. La revue indépendante a relevé qu'elles n'y étaient pas au
moment où elle est passée, et que le rapport s'appuyait dessus à chaque point
clé : un fichier qui ne survit pas à un `git clean` n'est pas une preuve.

**Fichiers partagés touchés, à connaître pour la fusion** : `app/routes.tsx`
(6 routes ajoutées, aucune modifiée), `routes/platform-layout.tsx` (5 liens),
`lib/types.ts` (7 droits ajoutés à l'union), les dix
`src/locales/*/platform.json`, et **trois primitives partagées** —
`components/ui/table.tsx` via `index.css`, `metric.tsx`, `page-header.tsx`,
`segmented-control.tsx`, `navbar.tsx` — chacune pour un défaut mesuré (§8.2,
§8.3), jamais pour un goût.

---

## 10. Décisions prises seules

1. **Le ticket porte son échéance, il ne la recalcule pas.** Pour un retrait
   RGPD, `due_at` est **recopié** de `marketplace_withdrawal_requests.deadline_at`.
   Même raisonnement que `platform_support_sessions.expires_at` de PLAT-1 : un
   changement de règle plus tard ne doit pas réécrire une promesse déjà faite
   au professionnel.

2. **Les dossiers passent par des RPC, pas par des policies élargies.** PLAT-1
   §13 laissait « la lecture complète pour traiter un appel » non cochée en
   refusant d'élargir une quarantaine de policies locataires sans écran pour
   les exercer. Ce lot ne les élargit pas davantage. Deux raisons, et la
   seconde est la vraie : le périmètre lu est **écrit dans la fonction**,
   lisible d'un coup d'œil, au lieu d'être la somme de quarante policies ; et
   **« chaque consultation est tracée » est impossible avec une policy** — une
   policy ne peut pas écrire.

3. **Annuler une modération est un geste d'administrateur.** Nouveau droit
   `moderation.revert`, fondateur et admin. Le modérateur masque, il ne défait
   pas. Lecture littérale des deux moitiés de la spec (« le modérateur masque,
   il n'efface pas » + « un administrateur peut annuler ») ; sans elle,
   « réversible par un admin » ne dit rien de plus que « réversible ».
   **À ratifier.**

4. **`poster.assign` va jusqu'au stagiaire, `poster.manage` s'arrête à
   l'admin.** C'est le stagiaire qui est dans le salon, l'affiche à la main ;
   il reste borné à ses zones par la même question que pose la saisie terrain.
   Générer, révoquer, réattribuer — les gestes qui décident du sort d'un objet
   physique déjà parti à l'impression — restent au fondateur et à l'admin.

5. **Le scan d'une affiche attribuée mène à la file en CONSULTATION, pas en
   check-in.** `join_public_queue` exige le jeton de check-in du salon **et**
   la géofence ; le QR de l'affiche ne porte **pas** ce jeton. Je ne l'ai pas
   ajouté : ce serait élargir une capacité que F1 protège, et le lot dit
   « garde d'accès au moins aussi stricte ». L'accroche reste donc vraie —
   on voit la file en direct. **Si le fondateur veut que l'affiche serve aussi
   de point de check-in, c'est une décision de PLAT-3**, pas un oubli (§12).

6. **PLAT-2 ne rend `customers.notes` nulle part**, ni au support ni au
   commercial, alors que seul le commercial est explicitement exclu. OS-2
   définit ce modèle **en parallèle de ce lot** : un périmètre qu'un autre lot
   est en train de poser ne s'ouvre pas d'avance. (OS-2 a depuis livré
   `customer_notes.read` et `list_customer_notes()`, qui trace ses lectures —
   c'est par là qu'il faudra passer, le jour venu.)

7. **Le PDF est écrit à la main.** Justifié en §4.5. Conséquence assumée : six
   langues d'impression sur dix, déclarée à l'écran.

8. **Le code d'affiche est en base32 de Crockford**, pas en hexadécimal : un
   code qu'on dicte au téléphone ne doit pas contenir I, L, O ni U, et 10
   symboles hexadécimaux ne feraient que 10¹² combinaisons contre 10¹⁵.

9. **Une seule RPC anonyme, `resolve_poster_code`.** Justifiée en §6.3.

10. **`contain: paint` sur le conteneur de tableau**, qui corrige aussi deux
    écrans hérités. Une ligne à la cause plutôt que trois rustines. §8.2.

11. **Les énumérés profonds des dossiers** (statut de rendez-vous, d'entrée de
    file, d'e-mail, état de revendication, plan, essai) sont rendus **bruts**,
    comme la base les stocke. Vingt-cinq clés de plus coûtaient deux cent
    cinquante traductions pour des valeurs que seul un interne lit.
    **À ratifier.**

12. **Les assertions de comptage de `verify_plat1.sql` portent désormais sur
    l'invariant**, pas sur un nombre absolu. Un lot voisin qui ajoute un droit
    ne doit pas faire rougir la suite d'un autre.

---

## 11. Erreurs commises, déclarées

1. **La sonde de débordement de PLAT-1 est fausse, et je l'ai crue d'abord.**
   `documentElement.scrollWidth > clientWidth` répond vrai sur des pages qui
   ne défilent pas. J'ai passé plusieurs mesures à chercher un élément
   fautif qui n'existait pas, avant de comprendre qu'il fallait **tenter de
   faire défiler la page** au lieu de lire un nombre. Le relevé de PLAT-1
   garde l'ancienne heuristique — je ne l'ai pas modifié, pour que les deux
   empreintes restent comparables — mais la mesure qui fait foi est
   désormais `overflow-probe.mjs`, et c'est écrit dedans.

2. **J'ai ajouté cinq liens de navigation sans regarder ce que ça faisait à la
   barre.** Elle défile, sa barre de défilement est masquée, et cinq entrées
   sont devenues inatteignables sur un écran de 1440 px. Le défaut est resté
   dans le dépôt entre deux commits. Trouvé en **regardant une capture**, pas
   en relisant du code, ce qui est exactement ce que le lot exige et ce que
   j'aurais dû faire plus tôt.

3. **Trois de mes fixtures e2e portaient un code d'affiche invalide.**
   `QAPLAT2FRE` contient un `L`, exclu de l'alphabet de Crockford. La
   contrainte `posters_code_shape` a refusé l'insertion — la contrainte a fait
   son travail, mais elle aurait pu être la production.

4. **Deux `<main>` imbriqués** sur l'écran public de scan, jusqu'à ce que la
   campagne e2e bute sur un sélecteur ambigu. Le test a trouvé un défaut d'HTML
   que je n'avais pas vu, et axe ne l'aurait pas attrapé.

5. **Trois assertions de ma propre suite lisaient des tables que le rôle
   testé ne peut pas lire** (`marketplace_withdrawal_requests` pour le
   support, `posts` masqués et `professional_claims` pour le modérateur). Elles
   rendaient zéro ligne et j'ai d'abord lu ça comme un défaut du lot. C'en est
   l'inverse : les policies faisaient exactement leur travail, et c'est ma
   suite qui posait la question au mauvais endroit. Réécrites pour passer par
   les RPC gardées — ce qui teste au passage que ces RPC sont bien le SEUL
   chemin.

6. **Ma suite comptait la table des affiches ENTIÈRE**, et non le lot qu'elle
   venait de créer. Elle était verte quand la table était vide ; **le jour où
   j'y ai mis trois fixtures e2e, elle est devenue rouge** — pour une raison
   qui n'avait rien à voir avec ce qu'elle testait. C'est exactement le défaut
   que je venais de corriger dans `verify_plat1.sql` (un comptage absolu qu'un
   lot voisin fait bouger), et je l'ai reproduit dans la mienne. Bornée au lot
   qu'elle crée, plus une assertion de plus : **un patron ne voit AUCUNE
   affiche libre**, même celles d'un lot de fixture.

7. **Une commande de tracé SVG non gérée était AVALÉE en silence** par la
   liste d'arguments de la commande précédente : le logo serait sorti faux
   sans la moindre erreur. Trouvé par un test que j'avais écrit pour vérifier
   le contraire, et qui échouait. Le tokeniseur refuse désormais toute lettre
   hors de son alphabet.

8. **Une clé de traduction manquante s'est affichée EN BRUT sur la page
   publique de scan** — `poster.inactive.signedOut`, sous les yeux d'un client
   qui scanne une affiche. **Rien ne l'a attrapée** : i18next replie en
   silence sur la clé elle-même, `locale-completeness` ne compare que les
   locales entre elles (toutes deux incomplètes, donc d'accord), le rendu
   était vert, le typecheck aussi, et axe ne s'intéresse pas au sens des mots.
   Trouvée en **regardant la capture** prise par le balayage axe. Corrigée, et
   un test de parité relit désormais la page pour que le regard ne soit plus
   nécessaire. Le même contrôle passé sur les cinq écrans de `/platform` et la
   barre de navigation : **aucune autre clé manquante**.

9. **Un message de commit a exécuté ses propres apostrophes inversées.** Écrit
   en heredoc non protégé, `sm` a été interprété comme une commande shell et
   le mot a disparu du message. Corrigé par `--amend`.

10. **J'ai coché « typecheck 0 » sans l'avoir relancé en entier.** J'avais
    passé `tsconfig.app.json` et Vitest, pas le script `npm run typecheck`,
    qui enchaîne aussi le projet strict. Le `build` ne l'attrape pas non plus
    (`vite build` ne typecheck pas). **Une case cochée à tort est le pire
    défaut d'un rapport**, et c'est une revue qui l'a trouvée, pas moi.

11. **J'ai écrit un test qui mesurait la mauvaise chose, et il a caché le
    défaut qu'il devait garder.** Le contrôle « QR ≥ 8 cm » mesurait le carré
    blanc de FOND au lieu du symbole. Il ne vérifiait pas l'exigence : il la
    contournait par construction, et il est resté vert pendant que le symbole
    faisait 7,05 cm. La leçon est plus large que ce lot : **une assertion qui
    ne peut pas échouer est une case cochée à vide.** Les tests neufs de ce
    lot ont tous été vérifiés EN LES CASSANT.

12. **Mon rapport attribuait à `resend_platform_email` une consultation de la
    liste d'opposition qu'elle ne faisait pas**, et à `resolve_poster_code` une
    discrétion sur le prospect destinataire qu'elle n'avait pas. Deux
    affirmations écrites sur la foi de l'intention, pas de la mesure. La
    première est corrigée dans le code ; la seconde dans le texte (§6.3).

13. **J'ai écrit une lettre imprimable qui promettait une action impossible à
    son destinataire.** Trois phrases, trois fausses (§16, B3). Elles
    seraient parties sur du papier.

### 11bis. L'assertion creuse — trois cas, trois lots, une seule faute

Ce n'est pas une leçon que je tire de mon seul lot : **trois sessions l'ont
trouvée le même après-midi, chacune de son côté, et chacune sur son propre
code.**

| Lot | L'assertion | Pourquoi elle ne prouvait rien |
|---|---|---|
| **PLAT-2** | « le QR fait au moins 8 cm » | elle mesurait le **carré blanc de fond**, pas le symbole — verte à 9 cm pendant que le symbole faisait 7,05 |
| **OS-2** | « les seuils viennent de la BASE, pas d'une constante » | elle attendait `20` et `5` — **exactement les défauts SQL**. Verte que la valeur vienne de la base ou d'une constante |
| **P1PRO** (trouvé par OS-2) | « le rendez-vous apparaît dans NEXT » | la fixture réserve à `now + 3 h` et teste « aujourd'hui » : après 21 h UTC, elle rougit alors que **l'écran a raison** |

**La faute est la même à chaque fois : l'assertion ne peut pas distinguer
l'hypothèse qu'elle valide de celle qu'elle devrait exclure.** Elle est verte
dans les deux mondes. Ce n'est pas un test faible, c'est une case cochée à
vide — et elle est plus dangereuse qu'un test absent, parce qu'elle occupe la
place.

Le remède est le même aussi, et il tient en deux gestes :

1. **choisir une valeur que seule la bonne hypothèse peut produire** — un
   seuil inhabituel plutôt qu'un défaut, l'emprise des modules plutôt que la
   boîte, un horaire borné à la journée plutôt qu'un décalage relatif ;
2. **vérifier le test en le CASSANT** avant de lui faire confiance. Les tests
   neufs de ce lot l'ont tous été ; celui du QR, qui ne l'avait pas été, est
   précisément celui qui a laissé passer le défaut.

Je ne l'écris pas dans un document de méthode : personne ne m'a mandaté pour
en ouvrir un, et la discipline de périmètre l'interdit. Mais **le même
paragraphe figure dans le rapport d'OS-2**, avec les mêmes trois cas et
l'attribution croisée. Deux rapports qui disent la même chose sont un dossier
remontable ; un document qu'aucun lot n'avait mandat d'écrire n'en est pas un.

---

## 12. Cases non cochées, avec la raison exacte

| Case | Raison |
|---|---|
| **axe sans violation sérieuse** | Les deux seules violations restantes sont les défauts de **palette héritée** nommés par PLAT-1 (4,48:1 et 3,57:1), présents jusque sur la page de connexion. Les corriger veut dire repeindre toute la console et détruire la preuve d'équivalence du §1. Ce lot en a **retiré trois** et n'en a ajouté aucune. Décision de produit. |
| **`/platform/acquisition/sources` déborde encore** | 241 px de défilement horizontal à 390 px, et c'est un **vrai** débordement de mise en page (`body.scrollWidth` = 631), pas le défaut de peinture corrigé ici. Écran hérité, hors périmètre, **consigné pour PLAT-3**. |
| **Le PDF n'est pas vérifié à l'œil** | Il est vérifié **structurellement** (xref objet par objet, `/Length` à l'octet près, pages comptées, textes présents, **symbole mesuré à 9,00 cm sur le fichier archivé**) et **fonctionnellement** (le QR décode vers la bonne URL, syndromes Reed-Solomon tous nuls). Mais **aucun moteur de rendu PDF n'existe sur cette machine** : ni poppler, ni ghostscript, et le Chromium sans tête télécharge les PDF au lieu de les afficher — vérifié par la revue indépendante. **Ouvrez `docs/reports/plat2/pdf/`** — c'est la seule vérification visuelle possible, et elle vous appartient. |
| **Le logo imprimé est le dérivé MONOCHROME** | Géométrie exacte de la marque, en vecteur, byte-identique au fichier source — mais ce fichier-là déclare « 16 à 32 px uniquement ». L'affiche l'imprime à 1,6 cm. Mon écrivain PDF n'a aucune primitive d'image, donc le master PNG lui est inimprimable. **À trancher par le fondateur** (§16). |
| **La vue en tant que « agit en son nom »** | Toujours pas livrée, et PLAT-2 ne l'a pas livrée non plus. PLAT-1 §5 l'avait requalifiée : le cadre existe (trace, échéance, garde de paiement, bandeau), **l'élévation de lecture n'existe pas**. L'écran de modération offre l'entrée **en disant ce qu'elle fait et ce qu'elle ne fait pas**, plutôt que de laisser croire l'inverse. Reste PLAT-3. |
| **La recherche de client pour le support** | **Il n'existe aucune recherche de client par téléphone ou par e-mail** : X3 a fermé les oracles d'existence et aucune RPC d'annuaire client n'existe. Le dossier client n'est donc atteignable que **depuis un ticket qui le référence**. L'écran le dit en une phrase. C'est le manque le plus gênant du lot pour un support qui décroche : voir §13. |
| **« Installer un salon » pour le stagiaire** | **Aucun contrat « installer au nom de » n'existe.** Vérifié en base : `private.assert_organization_creation_authorized()` n'autorise la création que par `create_organization()` — qui fait de **l'appelant** le propriétaire — ou par l'approbation d'une candidature. Si le stagiaire ouvrait `/setup` avec son compte, il créerait un salon qui lui appartient. L'écran offre donc le lien **accompagné de la vérité** : le patron s'installe avec SON compte, sur le téléphone du stagiaire s'il le faut. Il manque un **contrat serveur**, pas un écran. |
| **Les origines `report` et `inbound_email`** | Déclarées dans le modèle, **refusées** par la RPC, absentes de l'écran. Il manque un déclencheur sur `review_reports` d'un côté, un MX de réception de l'autre (verrou X2). §2.3. |
| **`database.types.ts` régénéré intégralement** | Comme PLAT-1 : le générateur local produit une forme différente, et une régénération complète mêlerait des centaines de lignes sans rapport. **Seules les deux RPC que la surface V2 appelle** ont été ajoutées à la main, avec le motif écrit à côté. À faire en une fois, avec un générateur épinglé. |

---

## 13. Ce que PLAT-3 devra trancher

1. **La recherche de client pour le support.** C'est le manque le plus gênant
   de ce lot. Un support qui décroche n'a aujourd'hui aucun moyen de trouver
   le dossier de l'appelant s'il n'existe pas déjà un ticket qui le référence.
   Il faut une RPC d'annuaire **gardée par `support.dossier` et traçante** —
   pas un filtre côté client, et pas une policy : c'est une recherche sur des
   données personnelles, elle doit laisser une trace comme les dossiers.

2. **L'affiche doit-elle aussi servir de check-in ?** Aujourd'hui elle mène à
   la file en **consultation**. Lui donner le jeton de check-in ferait d'elle
   un vrai point d'entrée dans la file — l'affiche est un objet physique dans
   le salon, exactement comme le QR du comptoir, et la géofence resterait. Je
   ne l'ai pas fait seul parce que cela élargit une capacité que F1 protège.
   **Décision de produit.**

3. **Ce que « voir comme le propriétaire » ouvre exactement.** Toujours la case
   la plus importante, deux lots de suite.

4. **La granularité de la zone** (PLAT-1 §15.4), maintenant qu'un écran
   terrain existe et qu'un stagiaire va vraiment s'en servir.

5. **`/platform/acquisition/sources`**, 241 px de débordement réel à 390 px.

6. **La densité tactile de la console sur téléphone.** Les écrans de bureau
   gardent des boutons de 36 px et des liens de tableau de 20 px. C'est la
   densité héritée ; si `/platform` doit être utilisable au doigt ailleurs que
   sur l'écran terrain, c'est un chantier en soi.

7. **Le correctif d'OS-2 sur le défaut de B5 doit migrer dans la branche de
   B5.** OS-2 a trouvé, prouvé et corrigé en production un défaut de B5 : trois
   fonctions de **trigger** non-`SECURITY DEFINER` appelaient des fonctions
   `private` neuves sans `grant execute to authenticated` (règle 4 de
   `DB_OWNERSHIP.md`, oubliée), ce qui rendait **403** toute transition de
   file, toute mise à jour de rendez-vous par un barber et toute écriture
   d'avis. Le correctif est
   `db/migrations/20260911220000_os2_hotfix_b5_private_grants.sql`, **sur la
   branche `os2/operations`** — il appartient à B5 et doit y migrer, sinon il
   disparaît si la branche de B5 part la première. La session B5 était
   terminée quand OS-2 l'a trouvé ; je le consigne ici pour que la trace
   survive aux deux sessions. **Et la leçon est la même que celle de X3 :
   un test psql en `postgres` ne verra jamais ce trou** — il faut une session
   `authenticated` réelle.

8. **Les énumérés bruts des dossiers** (§10.11) et **l'identité de l'interne
   côté professionnel** (PLAT-1 §11.3), toujours à ratifier.

9. **La suite F1 fabrique deux organisations par campagne, et le tas grossit
   vite.** Vingt et une en un après-midi, à trois lots qui rejouent leurs
   campagnes. `QA_DATA.md` §3 la nomme déjà comme l'exception connue, et
   `BLOCKERS` §12.2 comme un chantier de réécriture. Convenu avec le lot
   voisin : cela mérite d'être remonté **une fois, comme chantier à part**,
   plutôt que redéclaré par chaque lot qui en hérite le compte.

10. **Le logo imprimable** : accepter le dérivé monochrome hors de sa plage,
    ou donner à l'écrivain PDF une primitive d'image (§16).

11. **Le libellé du canal « SMS » dans le CRM.** L'énuméré
    `prospect_outreach_channel` porte `sms` parce qu'un commercial peut
    CONSIGNER un échange par SMS qu'il a eu lui-même. Mais « FadeUp n'utilise
    pas de SMS » est une règle produit, et un libellé nu le contredisait à
    l'écran. Il dit désormais « SMS (consigné à la main) ». **À ratifier** :
    faut-il retirer la valeur de l'énuméré, ou assumer la distinction ?

---

## 14. Données de test laissées en place

**Un lot d'affiches** marqué « ZZ dead QA PLAT2 e2e »
(`9a20e100-0000-0000-0000-000000000001`), **trois codes** : `QAPFREE001`
(libre), `QAPREVKD02` (révoqué), `QAPASGND03` (attribué à `qa-f1b-shared`).
Marqués **avant** création, comme l'exige la règle 2 de `QA_DATA.md`. La suite
e2e s'en sert et se saute proprement s'ils disparaissent.

Pour les retirer :

```sql
delete from public.posters where batch_id = '9a20e100-0000-0000-0000-000000000001';
delete from public.poster_batches where id = '9a20e100-0000-0000-0000-000000000001';
```

**Aucune organisation, aucun compte, aucun ticket** n'a été créé par ce lot :
la suite de permissions tourne en transaction annulée, et les comptes
`qa-plat1-*` de PLAT-1 ont été réutilisés tels quels. Vérifié après passage en
production : 0 ticket, 0 affiche hors fixtures, 0 compte `qa-plat2-*`.

---

## 15. La campagne e2e complète, et ce qu'elle a rougi

**283 verts, 4 rouges, 1 instable, 3 sautés** (31 min), toutes suites
antérieures comprises. Et les quatre rouges sont **vérifiés, pas excusés**.

**MESURÉE SUR `8131591`, PAS SUR L'ARBRE LIVRÉ** — je le dis avant de donner
le chiffre, parce que la distinction appartient au lecteur. Entre les deux,
quatre commits, dont celui des trouvailles de la revue, qui touche **cinq
primitives partagées de `/platform`**. Seule ma propre suite (36/36) avait été
rejouée sur l'état final. La campagne a donc été **relancée en entier sur
`4a386fe`** dès que le runner s'est libéré ; son résultat est en §8.5, et
c'est celui qui fait foi.

| Rouge | Cause établie | Preuve |
|---|---|---|
| `f1/live-queue` — temps réel sur deux navigateurs | **croisement de campagnes.** Un lot voisin a relancé la sienne pendant la mienne, sur `qa-f1b-shared` — le motif exact de `QA_DATA.md` règle 2b, mesuré le 2026-09-07 | **rejouées en ISOLÉ immédiatement après : 44/44 vertes.** C'est la preuve, pas l'explication |
| `f1b/barber-queues` — compte à rebours | idem | idem |
| `f4/booking-funnel` — inscription légère OTP, aux DEUX largeurs | **cause externe** : `fadeup-supabase-auth` répond `550 You have reached your daily email sending quota`. Tout test qui traverse un envoi réel échoue aujourd'hui | verrou déjà consigné par X2 et M1b ; signalé par le lot voisin avant ma campagne |
| `os1/agenda` (instable, passé au 2ᵉ essai) | `create_appointment_as_business` → `location_unavailable` pendant la fenêtre de croisement | passé au réessai |

### 8.5 La campagne REJOUÉE sur l'arbre livré — `4a386fe`

Le runner libéré, la campagne a été relancée **en entier sur le commit
expédié**, dans une base que le lot voisin venait de neutraliser.

**259 verts, 4 rouges, 3 sautés, 38 non exécutés** (23 min).

**Les 38 « non exécutés » ne sont PAS des tests ignorés** : les deux suites qui
rougissent sont en `test.describe.configure({ mode: 'serial' })`
(`f4/booking-funnel.spec.ts:32`, `p1pro/pro-direction.spec.ts:37`), et un échec
y interrompt tout le reste du groupe. C'est aussi ce qui explique l'écart avec
les 283 de la première campagne : **une cascade, pas une régression** — le
groupe p1pro est plus gros que celui de f1.

**Les quatre rouges, et aucun n'est de ce lot :**

| Rouge | Cause, MESURÉE |
|---|---|
| `f4/booking-funnel` — inscription légère OTP, aux deux largeurs | **quota Resend épuisé**, verrou externe déjà consigné par X2 et M1b |
| `p1pro/pro-direction` — la demande en temps réel, aux deux largeurs | **une fixture dépendante de l'heure**, et je l'ai prouvée plutôt que supposée (ci-dessous) |

**La fixture P1PRO, mesurée en base.** Elle réserve à `now + 2 h` par le tunnel
réel. À 21:54 UTC, cela tombe **vendredi 23:54** sur un lieu QA en UTC dont les
horaires ferment à **23:59**. La plus COURTE prestation du salon dure 15
minutes : le rendez-vous finirait **samedi 00:09**, après la fermeture.
`book_public_appointment` refuse, correctement, avec
`fadeup_booking_refusal=outside_hours` :

```
 service        durée  début demandé   fin calculée   fermeture
 Barbe          15 min  Fri 23:54       Sat 00:09      23:59
 Coupe          30 min  Fri 23:54       Sat 00:24      23:59
 Coupe + barbe  45 min  Fri 23:54       Sat 00:39      23:59
```

**Le serveur a raison, la fixture a tort** : elle suppose que « dans deux
heures » tient toujours dans la journée ouvrée. Le lot voisin a trouvé la même
famille sur la même suite à quelques minutes d'écart, par un autre symptôme
(NEXT légitimement vide après 21 h UTC). C'est le troisième cas de
l'**assertion creuse** du §11bis, et le correctif engage ce que « NEXT » doit
dire près de minuit — **une question de produit, pas un `+ 2 h` à changer en
`+ 1 h`.** Suite d'un autre lot : consigné, pas corrigé.

**La suite PLAT-2, elle, est verte : 36/36**, aux deux largeurs.

**Et la cascade a été levée, pas déduite.** Toutes les suites SAUF les deux
groupes en série ont été relancées sur le même arbre :

```
npx playwright test e2e/d1 e2e/f1 e2e/f1b e2e/f2 e2e/f3 e2e/os1 e2e/p1b e2e/plat1 e2e/plat2
  249 passed, 3 skipped, 0 failed  (19,8 min)
```

**249 sur 249.** Autrement dit : sur l'arbre livré, **tout ce qui n'est pas
bloqué par le quota Resend ou par la fenêtre horaire passe**, aux deux
largeurs, et les 38 non exécutés de la campagne complète étaient bien la
cascade de deux groupes en série — pas des tests silencieusement cassés.

Les deux seules suites que je ne peux pas rendre vertes ce soir sont celles
dont l'obstacle n'est pas dans le code : un quota d'envoi épuisé, et une
horloge à 21 h 54 UTC.

---

**Ce que ça a coûté, et que je ne cache pas** : les campagnes — les miennes
comprises — ont créé **21 organisations `qa-f1-*`** dans la production. C'est
le coût connu et documenté d'une campagne complète (`QA_DATA.md` §3, 2 par
campagne), et c'est ce qui fait bouger l'empreinte de
`/platform/organizations` (§1.2). Toutes marquées « ZZ dead », toutes
invisibles de la marketplace.

**La règle de coordination, appliquée et resserrée.** J'ai attendu que le
runner se libère, prévenu le lot voisin, et repris la main quand il me l'a
rendue. Nous avons convenu d'une règle plus stricte que « aucun processus
Playwright ne tourne » : **on ne lance qu'après un « le runner est à toi »
explicite.** L'absence de processus n'est pas une permission.

---

## 16. La revue indépendante, et ce qu'elle a trouvé

Une revue adversariale a été lancée sur le lot avec pour consigne de chercher
des défauts. **Elle en a trouvé quatorze, dont deux bloquants.** Tous sont
corrigés. Ce §16 existe parce qu'un rapport qui ne dit pas ce qu'une revue lui
a repris n'est pas un rapport.

### Les deux bloquants

**B1 — `npm run typecheck` ÉCHOUAIT au HEAD, et ma case était cochée.** Sur un
test que je venais d'ajouter. J'avais relancé `tsconfig.app.json` et Vitest,
**pas le script complet**, qui inclut le projet strict `tsconfig.v2`. Le
`build` passe sans le voir, parce que `vite build` ne typecheck pas. Corrigé
et re-mesuré.

**B2 — LE QR NE FAISAIT PAS 9 cm MAIS 7,05 — sous le plancher de 8 exigé par
le lot.** La zone de silence — quatre modules de chaque côté sur trente-sept,
soit **21,6 % de la boîte** — était comptée DEDANS. Et le défaut a tenu parce
que **le test censé le prouver mesurait le CARRÉ BLANC DE FOND** : il ne
vérifiait pas l'exigence, il la contournait par construction. `QR_SYMBOL` est
désormais le côté du SYMBOLE, la zone de silence s'ajoute autour, et le test
mesure **l'emprise des modules noirs**. Vérifié en le cassant : à 7 cm il
échoue en nommant l'écart (198,4 pt attendus ≥ 226,8). Mesure finale sur les
fichiers archivés : **symbole 9,00 cm, emprise totale 11,48 cm**.

**B3 — LA LETTRE IMPRIMÉE MENTAIT**, sur du papier qu'on ne rattrape plus.
Trois affirmations, trois fausses :

- « scannez-le et **il devient le vôtre** » — **impossible pour le
  destinataire** : `assign_poster` exige une ligne `memberships` sur un
  établissement actif, et un prospect qui reçoit la lettre n'a ni compte, ni
  organisation. Il tombait sur « cette affiche n'est pas encore active ».
- « **votre salon y est déjà référencé** » — **jamais vérifié** :
  `prepare_poster_letter` ne regardait pas `is_published`, alors qu'elle le
  testait déjà pour décider de l'élément de preuve. Une lettre pouvait donc
  affirmer une fiche qui n'existe pas.
- « la revendication est gratuite **et immédiate** », sur l'écran public de
  scan — elle passe par la file de modération humaine **que ce lot livre
  lui-même**.

Les trois textes sont réécrits **dans les dix langues**, et la RPC refuse
désormais une lettre vers un salon dont la fiche n'est pas publiée
(`prospect_not_published`, assertion G39b).

### Le défaut le plus grave après les bloquants

**Une affiche PARTIE PAR LA POSTE se faisait préempter.** Mesuré par la revue,
pas déduit : pendant les jours où l'enveloppe voyage, le code reste `free`, et
`assign_poster` n'exigeait rien de plus. N'importe quel porteur de
`poster.assign` pouvait se le donner ; le patron destinataire ouvrait son
enveloppe, scannait, et tombait sur la file **d'un autre salon** — sans
recours, puisqu'une affiche attribuée ne se détourne pas.

**Et il y avait un amplificateur** : `posters_select` acceptait
`poster.assign`, si bien qu'un stagiaire **énumérait par PostgREST tous les
codes libres avec leur destinataire** et choisissait lequel préempter, sans
jamais passer par la RPC censée porter la garde.

Réparé **aux deux étages** — parce qu'une garde de RPC sans la policy qui va
avec est une porte fermée dans un mur absent :

- `assign_poster` réserve un code posté à son destinataire (le salon vers
  lequel le prospect a converti) ou à un porteur de `poster.manage` ;
- `posters_select` ne rend plus la table qu'à `poster.manage` et au patron de
  l'établissement **attribué**. Un porteur de `poster.assign` attribue en
  SCANNANT ; il n'a aucun besoin de lire la table.

Six assertions neuves (G42 à G47) le verrouillent, dont **G43b : le salon
destinataire, lui, reçoit bien son affiche** — une garde qui bloquerait aussi
le bon destinataire ne serait pas une garde, ce serait une panne.

### Les huit autres

| Trouvaille | Suite donnée |
|---|---|
| `reassigned_after_revocation` était **toujours faux** : le drapeau se lisait APRÈS le `returning into`, où l'état vaut déjà « attribué » | lu avant ; assertions G51/G52 |
| **Révoquer deux fois écrasait le motif d'origine** | refusé (`already_revoked`) ; G48/G49 |
| `resend_platform_email` **ne consultait jamais la liste d'opposition** de X2 — que mon rapport lui attribuait pourtant | elle la consulte (`email_suppressed`) ; D11b |
| **Le support ne pouvait assigner AUCUN ticket, pas même à lui-même** : `list_platform_team()` lui rend zéro ligne, et l'écran rendait une phrase à la place du champ. Le serveur, lui, autorisait | bouton « m'attribuer ce ticket », qui ne demande aucun annuaire |
| Les deux écrans de support affichaient **le code de refus BRUT** à côté du message serveur — « cet e-mail a rebondi · `email_bounced` » — alors que les deux autres écrans du lot traduisaient déjà | 18 motifs traduits en dix langues. **Les tests qui exigeaient le code brut gardaient le défaut** : ils exigent la phrase |
| Le CRM renvoyait vers `/platform/applications/:id`, **que son rôle ne peut pas lire** — l'écran de modération du même lot documente ce piège et refuse déjà le lien | lien retiré, contradiction interne levée |
| **25 `toLocaleString()` sans argument** : dates et nombres dans la langue du NAVIGATEUR, pas de l'application | `usePlatformIntl()`, sur le modèle que l'écran de modération avait déjà seul |
| `support_ticket_reference_seq`, **première séquence de `public`**, naissait `anon=rwU` : le durcissement d'ACL de X3 ne couvre pas les séquences | révoquée ; le seul écart d'ACL de la migration, dans le sens strict |
| Une **chaîne française écrite EN BASE** (« non assigné »), irrattrapable par l'interface | jeton traduit par l'écran |
| Un **caractère coréen** dans la traduction japonaise de la lettre | corrigé ; balayage des dix locales, aucun autre |

### Ce que la revue a vérifié et trouvé EXACT

Elle a rejoué le retour arrière de bout en bout sur sa propre restauration
fidèle, avec un périmètre **plus large que le mien** (27 068 lignes : ACL de
relations, de fonctions, de schémas, de types, de colonnes, séquences de tous
les schémas, privilèges par défaut, ACL de base) : **zéro écart**. Elle a
confirmé les 4 464 lignes, les 104/39 propriétaires, les 137 ACL de table, et
les deux corps de fonction identiques au caractère près — en comparant leurs
md5 avant, pendant et après, plutôt qu'en me croyant. Elle a re-appliqué les
quatre montantes après les retours arrière : `rc=0` sur les quatre.

Elle a vérifié le PDF **objet par objet** : les neuf décalages xref tombent
tous exactement sur `N 0 obj`, les `/Length` correspondent à l'octet près, et
elle a **décodé le QR indépendamment de jsQR** — trame reconstruite, format
lu, démasquage, zigzag, et **les 26 syndromes Reed-Solomon des 70 mots-codes
tous nuls**. Elle a confirmé que les tracés du logo sont **byte-identiques**
aux fichiers de marque.

Et elle a confirmé, en appelant les RPC, que les gardes tiennent : le patron
hors de chez lui, le fondateur lui-même sur une affiche attribuée, les cas
nuls tous traités, aucune garde en forme `colonne = auth.uid()`, et **aucune
RPC de PLAT-2 n'appelant une SECURITY DEFINER dont la garde interne se
réévalue au détriment de l'appelant** — le défaut n° 7 de PLAT-1 n'est pas
reproduit.

### Deux trouvailles mineures NON corrigées, déclarées

- **Le retour arrière de la migration de modération laisse trois numéros
  d'attribut morts** sur `public.posts` (`relnatts` 10 → 13), cumulatifs à
  chaque cycle. Mon §6.1 dit « 0 colonne résiduelle » : c'est vrai au niveau
  `information_schema`, **faux au niveau `pg_attribute`**. Portée pratique
  nulle (≈ 530 cycles avant le plafond de 1 600, et un `pg_dump`/restore
  renumérote), et le corriger exigerait de reconstruire la table.
- **Le logo imprimé est le dérivé MONOCHROME**, dont le fichier de marque dit
  « 16 à 32 px uniquement ; au-delà, toujours le master ». L'affiche
  l'imprime à 1,6 cm, soit ≈ 189 px à 300 dpi. La cause est technique : mon
  écrivain PDF n'a **aucune primitive d'image** (pas de XObject), donc le
  master PNG est inimprimable par ce module. Je rectifie donc ce que
  j'écrivais : c'est **la géométrie exacte de la marque, en vecteur**, mais
  c'est le dérivé monochrome, hors de sa plage d'usage déclarée. **À trancher
  par le fondateur** : accepter le dérivé à cette taille, ou ajouter
  l'embarquement d'images au module.
