# Down migrations

One `.down.sql` per B1 migration, restoring the schema to its state immediately
before the matching `db/migrations/<timestamp>_<name>.sql` was applied.

**Why a subdirectory.** `scripts/disposable-db-test.sh` and every other replay
path glob `db/migrations/*.sql` in filename order. A `.down.sql` sitting beside
its `.up` would be replayed right after it and would silently undo the
migration on every clean build. The nesting is what keeps the replay honest.

**How to run one.**

```bash
docker exec -i fadeup-supabase-db psql -U postgres -d <db> -v ON_ERROR_STOP=1 \
  < db/migrations/down/<timestamp>_<name>.down.sql
```

**What a down migration does and does not undo.** Each one reverses the DDL:
constraints, triggers, functions and columns return to their previous
definitions. None of them deletes rows written while the migration was live —
a queue entry admitted under the geofence, an identity published while
unclaimed. Where a reversal would leave data violating a restored constraint,
the script says so in its header and depublishes rather than deletes.

B1's five down scripts were each executed against a database restored from
`backups/pre-b1-*.dump`, in reverse order, before the corresponding migration
was applied to production. A rollback that has not been run does not exist.

## B4 (2026-09-07)

Sept downs, chacun exécuté avec succès contre une restauration fidèle de
`backups/pre-b4-*.dump` (pg_restore -U supabase_admin, sans `--no-owner`),
en ordre inverse, avant l'application en production. Particularités :

- `20260907120150_*.down.sql` doit tourner en **supabase_admin** (grantor
  `supabase_storage_admin`), comme son aller.
- `20260907120300_*.down.sql` (enum) refuse de tourner tant que des
  notifications sociales existent — il énonce le DELETE à faire au lieu de
  détruire ; il reconstruit le type et recrée
  `private.emit_booking_notification` dont la signature porte l'enum.
- Les deux downs de buckets ne vident jamais un bucket : un bucket non vide
  est laissé en place et signalé.

## OS-1 (2026-09-11)

Deux downs, chacun exécuté deux fois contre une restauration fidèle de
`backups/pre-os1-20260911-001947.dump` (pg_restore -U supabase_admin, sans
`--no-owner`), en ordre inverse, avant l'application en production — diff
ACL vide (`x3_acl_snapshot.sql`), définitions de `reschedule_appointment` et
`get_calendar_appointments` restaurées identiques (md5). Particularités :

- `20260911100000_*.down.sql` (série de blocages) tourne en **supabase_admin**
  (propriétaire de `time_blocks`), comme son aller.
- `20260911101000_*.down.sql` (agenda) REFUSE de tourner tant qu'un
  rendez-vous ACTIF porte un chevauchement forcé (le prédicat d'origine le
  mettrait en violation d'exclusion) ; il nomme la requête à faire au lieu
  de détruire. Prouvé : refus avec une ligne forcée, succès une fois la
  ligne annulée.

## OS-2 (2026-09-11)

Cinq downs, tous exécutés contre une restauration fidèle de
`backups/pre-os2-20260911-173341.dump` (pg_restore -U supabase_admin, sans
`--no-owner`), en ordre inverse (110400 → 110000), **avant** l'application en
production. Résultat mesuré : diff `x3_acl_snapshot.sql` **vide** entre l'état
d'origine et l'état après retour, aucun objet OS-2 résiduel (table
`customer_notes`, colonnes `services.archived_at`/`price_pending`, droit
`customer_notes.read`, les 27 fonctions), et les policies `memberships`
restaurées **identiques** à celles de la production (diff textuel vide sur
`pg_policies.qual`/`with_check`).

Tous tournent en **postgres** : OS-2 ne redéfinit aucun objet appartenant à
`supabase_admin` (DB_OWNERSHIP §3 règle 2, propriétaires vérifiés avant
écriture). Particularités :

- `20260911110300_*.down.sql` (équipe) **rétablit la faille d'escalade** que
  son aller corrige : après retour, un manager peut de nouveau rétrograder et
  retirer un owner. C'est le prix d'un retour fidèle, et c'est écrit en tête
  du fichier plutôt que corrigé en douce.
- `20260911110100_*.down.sql` (catalogue) retire `price_pending` : un service
  laissé « brouillon » redevient un service inactif à 0 — un état déjà
  représentable avant OS-2, donc aucune donnée perdue ni contrainte violée.
- `20260911110000_*.down.sql` (notes) supprime la table `customer_notes` et
  donc les notes écrites pendant la vie de la migration. C'est le SEUL down
  d'OS-2 qui détruit des lignes ; il n'y a pas d'alternative (la donnée
  n'existait nulle part avant lui) et il est dit ici plutôt que découvert.
  La colonne `customers.notes`, elle, retrouve son caractère écrivable et son
  contenu — vide — intacts.
- `20260911110200_*.down.sql` et `20260911110400_*.down.sql` ne retirent que
  des fonctions : les seuils réglés restent en base.
