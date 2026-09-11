# PLAT-2 — Les écrans par rôle, et les affiches QR

**Branche** `plat2/role-screens`, créée depuis `rebuild/social-first-v2` (`585ddc2`).
**Base** : quatre migrations appliquées en production le 2026-09-11.
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
| Routes dont l'empreinte diffère **autrement** | **2**, toutes deux causées par un lot voisin (détail ci-dessous) |
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

1. **`/platform/organizations`**, +231 caractères. **Aucune ligne de code de
   cette page n'est touchée par PLAT-2.** Vérifié en base : **quatre
   organisations `qa-f1-*` ont été créées entre 18:20 et 18:51** par la
   campagne e2e d'un lot voisin (la suite F1 crée 2 organisations par
   campagne — c'est le motif connu de `QA_DATA.md` §3), et `qa-f1b-shared` a
   été renommée pendant sa campagne. C'est le contenu de la table qui a bougé
   sous le relevé. Même cause que l'écart n° 3 de PLAT-1.

2. **`/platform/audit`**, +535 caractères. **Quatre lignes de journal
   `customer_notes_read`** écrites entre 18:38 et 18:46 — c'est l'action
   d'audit **d'OS-2**, qui tourne en parallèle. Vérifié en base : ce sont les
   SEULES lignes écrites depuis le relevé « avant », et aucune ne vient de
   PLAT-2 (la suite de permissions de ce lot tourne en transaction annulée et
   ne laisse rien).

### 1.3 Le seul changement volontaire à une surface existante, et pourquoi

Trois écrans hérités **faisaient défiler la page entière latéralement sur un
téléphone** : PLAT-1 §15.5 les avait consignés comme un défaut « ni créé ni
corrigé ». Deux sont corrigés ici — `/platform/team` (187 px de défilement
parasite) et `/platform/acquisition/jobs` (585 px) — **par la même ligne qui
corrige les trois écrans neufs de ce lot**. Détail en §8.2.

Le troisième, `/platform/acquisition/sources`, déborde encore de 241 px : c'est
un **vrai** débordement de mise en page (`body.scrollWidth` = 631), pas le même
défaut. Hors périmètre, consigné en §12.

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
et `is_overdue, et le commentaire de la fonction dit lui-même que « c'est la
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
| QR ≥ 8 cm | **9 cm** de côté, mesuré dans le flux de la page par un test. La marge d'un centimètre n'est pas décorative : un QR plastifié, scanné de biais dans un salon mal éclairé, perd de la marge de correction. |
| Le code en clair, en tout petit, sous le QR | présent, espacé, précédé de « QR abîmé ? Saisissez plutôt ce code » |
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
exécutée AVANT la fabrication**, en français et en anglais, et refuse
d'imprimer en nommant le mot fautif — si une traduction future introduisait
une promesse, cent affiches ne partiraient pas à l'imprimeur avec elle.

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
**Propriétaires vérifiés objet par objet avant écriture** : les deux fonctions
redéfinies et les seize tables lues ou modifiées appartiennent toutes à
`postgres` — aucune moitié de migration possible.

| Migration | Contenu | Retour arrière |
|---|---|---|
| `20260911200000_plat2_support.sql` | 4 droits, 2 tables, 3 types, 1 séquence, 2 déclencheurs d'ajout seul, 6 RPC de ticket, 3 dossiers, 2 actions | **testé** |
| `20260911200100_plat2_moderation.sql` | 1 droit, 3 colonnes et 2 contraintes sur `posts`, **2 RPC redéfinies**, 5 files de lecture | **testé** |
| `20260911200200_plat2_crm_prospect_insight.sql` | 3 fonctions de lecture (statistiques, relances, pipeline) | **testé** |
| `20260911200300_plat2_qr_posters.sql` | 2 droits, 2 tables, 1 type, 8 RPC dont **la seule anonyme** | **testé** |

**`create or replace` et jamais `drop` + `create`** sur les deux fonctions
existantes : une signature inchangée conserve son ACL. Un DROP obligerait à
re-matérialiser les concessions, et c'est ainsi qu'on perd un droit sans s'en
apercevoir (le piège de P1PRO, rappelé par PLAT-1 §7).

### 6.1 Le test de retour arrière

Bac d'essai **fidèle** (`db/tests/b3_restore_sandbox.sh`) : restauration sans
`--no-owner`, en `supabase_admin`, base possédée par `postgres` comme en
production. **0 erreur `pg_restore`**, propriétaires conservés (104 objets
`postgres`, 39 `supabase_admin`), 137 tables portant une ACL explicite.

Puis : instantané ACL → les quatre migrations → la suite de permissions → les
quatre retours arrière **dans l'ordre inverse** → nouvel instantané.

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

### 6.3 Le contrat de surface anonyme : 44 → 45

**Une RPC, et une seule** : `resolve_poster_code`. **C'est une décision, pas un
oubli** — un client qui scanne une affiche dans un salon n'a pas de compte, et
lui en demander un pour lire « cette affiche n'est pas encore active » serait
absurde. Ce qu'elle rend à un anonyme est exactement ce qui est **déjà
public** : l'état du code et, s'il est attribué, le slug du salon et son
établissement — la même information que le QR de file imprimé par le salon
lui-même (F1). Elle ne rend ni le lot, ni l'auteur de l'attribution, ni le
prospect destinataire, ni la moindre liste d'établissements à qui ne peut pas
attribuer.

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

`db/tests/verify_plat2.sql` — **136 assertions**, une seule transaction
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
| **D** (13) | **support : pas de CRM, pas de facturation, pas de modération, pas d'onboarding** — et les trois actions de premier niveau qui, elles, passent, motif obligatoire compris |
| **E** (25) | modération : **masquer sans motif refusé**, « mauvaise note » **hors vocabulaire**, **le modérateur ne remet pas en ligne, l'admin si**, le tampon posé puis effacé, **le modérateur sans CRM**, les deux files partagées enfin visibles au modérateur ET au commercial, l'arbitrage des revendications rivales, le support qui ne voit rien de tout ça |
| **F** (13) | commercial : le pipeline **par origine**, les statistiques **réelles**, `is_published=false` qui rend des zéros et **le dit**, l'état des relances, **aucune note client**, le stagiaire borné à sa zone et **qui ne publie pas** |
| **G** (45) | les affiches : génération réservée, codes **distincts et non devinables**, tous libres, le journal des lots ; le patron multi-établissements qui voit **les siens et eux seuls** ; **l'attribution hors de chez soi refusée** ; **le détournement refusé, y compris par celui qui a posé l'affiche** ; le barber salarié et le client refusés ; **le stagiaire borné à sa zone** ; la révocation réservée, motivée ; la réattribution interne ; **les cinq comportements de scan** ; la lettre, sa preuve, et **son absence de preuve** ; le crochet de revendication |
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
| `npm run test` (Vitest) | **813 / 813**, 92 fichiers (+1 sauté : la fabrication des PDF archivés, qui n'écrit sur disque que sur demande) |
| `npm run build` | **succès** — graphe d'entrée **230,8 Ko gzip sous le budget de 240**, aucune famille interdite |
| `db/tests/verify_plat2.sql` (production) | **136 assertions vertes, 0 résidu** |
| `db/tests/verify_plat1.sql` (production) | **verte** |
| `db/tests/probe_public_rpcs.sh --strict` | **vert** — toutes les lectures publiques en 200 |
| `db/tests/x3_anon_surface.sh --strict` | **vert** — 143 tables balayées en anonyme et en authentifié-sans-droit, contrat de surface à **45** RPC, aucune dérive |
| Relevé des 33 routes, avant / après | **31 identiques**, 2 écarts externes (§1.2) |
| `npm run e2e` — suite PLAT-2 | **36 / 36**, 390 px et 1440 px |
| `npm run e2e` — campagne complète | voir §8.4 |
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

### 8.2 La QA navigateur — quatre défauts trouvés à l'œil, pas en relisant

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

**4. Deux `<main>` imbriqués** sur l'écran public de scan — la coque consumer
en fournit déjà un. Deux repères principaux pour un lecteur d'écran. axe ne
l'attrape pas sous les étiquettes WCAG AA ; c'est faux quand même. Corrigé.

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
| Commits | 6 (+ le rapport) |
| Fichiers touchés | 60, **aucun hors périmètre** |
| `apps/mobile` | **intouché** (interdit par le lot) |
| `apps/web/src/features/pro-*` | **intouché** (interdit par le lot — OS-2 y travaille) |
| `apps/web/package.json` | **intouché** — aucune dépendance ajoutée |
| Fusion | **aucune** |

Les commits :

```
c9af700  fix(plat2): la barre de navigation passe à la ligne au lieu de cacher cinq liens
bc63d64  fix(plat2): le défilement horizontal à 390 px, et trois contrastes mesurés
8131591  feat(plat2): les quatre écrans par rôle, le scan d'affiche et le PDF imprimable
3ec1482  docs(plat2): l'addendum B5 est renommé, l'invariant d'ordre reste
c6eb6b6  docs(plat2): nommer le piège de rejeu avec l'addendum d'effacement de B5
7626d84  feat(plat2): le socle base des quatre écrans par rôle et des affiches QR
```

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

8. **Un message de commit a exécuté ses propres apostrophes inversées.** Écrit
   en heredoc non protégé, `sm` a été interprété comme une commande shell et
   le mot a disparu du message. Corrigé par `--amend`.

---

## 12. Cases non cochées, avec la raison exacte

| Case | Raison |
|---|---|
| **axe sans violation sérieuse** | Les deux seules violations restantes sont les défauts de **palette héritée** nommés par PLAT-1 (4,48:1 et 3,57:1), présents jusque sur la page de connexion. Les corriger veut dire repeindre toute la console et détruire la preuve d'équivalence du §1. Ce lot en a **retiré trois** et n'en a ajouté aucune. Décision de produit. |
| **`/platform/acquisition/sources` déborde encore** | 241 px de défilement horizontal à 390 px, et c'est un **vrai** débordement de mise en page (`body.scrollWidth` = 631), pas le défaut de peinture corrigé ici. Écran hérité, hors périmètre, **consigné pour PLAT-3**. |
| **Le PDF n'est pas vérifié à l'œil** | Il est vérifié **structurellement** (xref valide objet par objet, pages comptées, textes présents, QR mesuré à 9 cm) et **fonctionnellement** (le QR des fichiers archivés décode vers la bonne URL). Mais **aucun moteur de rendu PDF n'existe sur cette machine** : ni poppler, ni ghostscript, et le Chromium sans tête télécharge les PDF au lieu de les afficher. **Ouvrez `docs/reports/plat2/pdf/`** — c'est la seule vérification visuelle possible, et elle vous appartient. |
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
