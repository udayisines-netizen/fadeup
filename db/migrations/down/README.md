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
