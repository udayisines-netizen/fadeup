# FadeUp — exploitation (X1) : sauvegardes, supervision

Source versionnée des scripts d'exploitation. L'exécution vit dans `~/ops/`
(copie déployée + secrets), installée par :

```bash
infra/ops/install.sh
```

Idempotent ; à relancer après toute modification des scripts.

## 1. Ce qui tourne (crontab de l'utilisateur `fadeup`)

| Quand | Quoi | Rôle |
|---|---|---|
| toutes les 5 min | `monitor.sh` | disque ≥ 80 %, MemAvailable < 250 Mo, 13 conteneurs running/healthy, battement scheduler < 300 s, dernière sauvegarde < 26 h |
| toutes les 15 min | `probe-rpcs.sh` | les 21 RPC publiques en `anon` via Kong (`db/tests/probe_public_rpcs.sh --strict`) |
| 04:15 chaque jour | `backup.sh` | dump complet + tar storage, chiffrés, rétention 7/4/3, copie distante si configurée |
| 04:45 le dimanche | `restore-check.sh` | restauration du dernier dump dans une base jetable, comptes tables/fonctions/policies |
| 06:05 chaque jour | `monitor.sh --daily` | expiration TLS `fade-up.com` (alerte < 14 j) |

Journal : `~/ops/ops.log`. Il ne grossit que sur événement (les passes
silencieuses n'écrivent presque rien) ; le surveiller entre dans l'alerte
disque à 80 % bien avant d'être un problème.

## 2. Sauvegardes

**Mécanisme.** `pg_dump -Fc` de toute la base, exécuté dans
`fadeup-supabase-db` (même binaire que le serveur), plus une archive tar de
`infra/supabase/volumes/storage` (les fichiers des buckets, que `pg_dump` ne
couvre pas). Contrôle anti-troncature (`pg_restore --list` + taille minimale),
puis chiffrement **GPG symétrique AES-256** — la base contient des coordonnées
clients ; rien ne part ni ne reste en clair.

**Rétention** dans `/opt/fadeup/backups/auto/` : 7 quotidiennes,
4 hebdomadaires (dimanche), 3 mensuelles (le 1ᵉʳ). ~2,5 Mo par dump
aujourd'hui, soit < 50 Mo au régime de croisière ; la taille est vérifiée par
l'alerte disque globale.

**La passphrase est la sauvegarde.** Elle est dans `~/ops/backup.passphrase`
(chmod 600, générée à l'installation). **Le fondateur doit la copier dans un
gestionnaire de mots de passe hors serveur** : si le disque meurt, les copies
distantes chiffrées ne s'ouvrent qu'avec elle.

```bash
cat ~/ops/backup.passphrase   # à copier, une fois, dans un coffre hors serveur
```

**Restauration manuelle** (jour d'incident) :

```bash
gpg --decrypt --passphrase-file ~/ops/backup.passphrase \
    -o /tmp/restore.dump /opt/fadeup/backups/auto/daily/db-<stamp>.dump.gpg
docker cp /tmp/restore.dump fadeup-supabase-db:/tmp/
docker exec fadeup-supabase-db pg_restore -U supabase_admin -d <base> /tmp/restore.dump
```

`restore-check.sh` fait exactement cela chaque dimanche dans une base jetable
et alerte si les comptes restaurés sont inférieurs aux comptes vivants.

### Copie hors serveur — ce que le fondateur doit fournir

Sans copie distante, une panne de disque emporte les sauvegardes avec la
base. Étapes exactes :

1. **Créer un stockage objet compatible S3** (OVH Object Storage, Scaleway,
   Backblaze B2, AWS S3 — indifférent) : un bucket, p. ex. `fadeup-backups`,
   dans une région UE (RGPD), avec un **utilisateur/clé dédié limité à ce
   bucket** (access key + secret key).
2. **Installer rclone** (aucun root requis) :
   `curl https://rclone.org/install.sh | bash -s -- --to ~/bin` — ou
   téléchargement manuel du binaire dans `~/bin`.
3. **Configurer le remote** : `rclone config` → `n` → nom `fadeup-offsite` →
   type `s3` → fournisseur correspondant → saisir les deux clés + endpoint
   région. Les clés restent dans `~/.config/rclone/rclone.conf` (hors git).
4. **Activer** : dans `~/ops/.env`, renseigner
   `BACKUP_REMOTE=fadeup-offsite:fadeup-backups/prod`.
5. **Vérifier** : `~/ops/backup.sh` à la main, puis
   `rclone ls fadeup-offsite:fadeup-backups/prod/daily` doit lister le dump
   du jour. La passe quotidienne synchronise ensuite les trois répertoires
   (le sync applique aussi la rétention côté distant).

Tant que `BACKUP_REMOTE` est vide, `backup.sh` envoie **un rappel par
semaine** — assez pour ne pas oublier, pas assez pour être ignoré.

### Décision — volumes de stockage

Les trois buckets (`passport-photos`, `post-media`, `review-photos`) sont
sauvegardés **quotidiennement, avec le dump**, dans la même passe :

- ils sont sur un backend fichier local
  (`infra/supabase/volumes/storage`), invisible de `pg_dump`, et les
  métadonnées (`storage.objects`) sont dans le dump — restaurer l'un sans
  l'autre donnerait des lignes pointant vers des fichiers absents ;
- ils sont vides aujourd'hui (4 Ko) : le coût est nul maintenant et le
  mécanisme existe avant que le premier fichier client n'arrive ;
- le jour où le volume dépassera ~1 Go, passer le tar quotidien en
  `rclone sync` incrémental dédié — noté ici pour ce jour-là.

## 3. Supervision et alertes

**Canal.** `alert.sh` appelle l'API Resend **directement depuis l'hôte, en
curl**. Il ne dépend ni de la base, ni du scheduler, ni de Kong, ni d'aucun
conteneur — précisément parce que l'e-mail applicatif (`email_outbox`)
tombe avec ce qu'on surveille. Il survit donc à toute panne de la pile
FadeUp. Ce qu'il ne couvre pas : l'hôte mort, le réseau coupé, Resend en
panne. Pour ce résidu :

**À faire par le fondateur (10 min)** :
1. créer un compte gratuit sur un moniteur HTTP externe (UptimeRobot ou
   équivalent) avec deux sondes vers `https://fade-up.com/` et
   `https://fade-up.com/rest/v1/` (toutes les 5 min, alerte e-mail). C'est le
   seul témoin qui voit l'hôte disparaître ;
2. créer un check « dead-man » gratuit sur healthchecks.io (période 5 min,
   grâce 10 min) et coller son URL de ping dans `~/ops/.env` :
   `HEALTHCHECKS_PING_URL=https://hc-ping.com/<uuid>`. À partir de là, si
   cron ou le script de supervision meurent, c'est healthchecks.io qui
   alerte — la supervision est elle-même surveillée.

**Anti-bruit.** Chaque alerte est à état : un envoi à la bascule, un rappel
par 24 h si la condition persiste, un message `[FadeUp OK]` au
rétablissement. Les seuils sont choisis pour signifier « agir maintenant »
(disque 80 % = il reste ~7 Go ; TLS 14 j = le renouvellement automatique,
qui agit à J-30, est cassé).

**Conteneur `fadeup-prospect-worker-v2`** : arrêté volontairement
(`Exited (0)`) au moment de X1 — exclu de la liste surveillée. L'ajouter à
`EXPECTED_CONTAINERS` dans `~/ops/.env` le jour où il doit tourner en continu.

## 4. Suivi d'erreurs frontend

Voir `apps/web/README-sentry.md` (intégration Sentry, DSN à fournir par le
fondateur, filtrage PII, cartes source).
