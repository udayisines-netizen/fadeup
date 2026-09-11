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
