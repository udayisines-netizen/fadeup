# FadeUp — Propriété des objets de base et rôles de migration

Écrit par X3 (2026-09-07), après le troisième lot mordu par le même piège
(B3 §12, F1b, BLOCKERS §9). Ce document dit à un futur lot **sous quel rôle
s'exécuter, ce qu'il possédera, et comment ne pas laisser une migration
s'appliquer à moitié**.

## 1. L'état des lieux (mesuré en production, 2026-09-07)

| Périmètre | postgres | supabase_admin | supabase_storage_admin |
|---|---|---|---|
| Tables `public` | 96 | 34 | — |
| Tables `storage` | — | — | 10 |
| Fonctions `public` | 227 | 25 | — |
| Fonctions `private` | 91 | 17 | — |

Les objets `supabase_admin` viennent des lots MASTER appliqués sous ce rôle
(dont `complete_onboarding`, `get_organization_readiness`, les gardes
`assert_organization_creation_authorized` et `guard_marketplace_publication`,
et la chaîne prospects/outreach/ML de Worker V2). Les objets storage
appartiennent au service storage, comme partout chez Supabase.

## 2. Les trois faits qui font le piège

1. **`postgres` n'est PAS superuser** sur cette instance (rolsuper = false ;
   il a createrole et bypassrls, rien de plus). Il possède le schéma, donc il
   peut **supprimer** une fonction de `supabase_admin`… mais pas la
   **recréer à l'identique** ni la redéfinir (`CREATE OR REPLACE` refuse :
   « must be owner »). Une migration `postgres` qui touche un objet
   `supabase_admin` s'applique donc À MOITIÉ avant d'échouer — pire qu'un
   refus net (B3 §12, F1b).
2. **`supabase_admin` EST superuser.** Un `GRANT`/`REVOKE` exécuté par un
   superuser agit *comme le propriétaire de l'objet* : il atteint les grants
   de `postgres`, de `supabase_admin` ET de `supabase_storage_admin` sans
   no-op. À l'inverse, un `REVOKE` exécuté par `postgres` sur un grant
   concédé par `supabase_storage_admin` est un **no-op silencieux** (mesuré
   en B4 sur `storage.objects`).
3. **`CREATE OR REPLACE FUNCTION` conserve le propriétaire et l'ACL**
   existants quand un superuser l'exécute. C'est ce qui permet à une
   migration `supabase_admin` de corriger une fonction de `postgres` sans en
   changer la propriété.

## 3. La doctrine

**Règle 1 — le rôle d'application par défaut est `postgres`.**
Tout objet NEUF (table, fonction, policy, trigger) est créé par une migration
appliquée en `postgres` et lui appartient. C'est le régime de tous les lots
depuis B1.

**Règle 2 — avant de REDÉFINIR un objet existant, vérifie son propriétaire.**

```sql
select p.oid::regprocedure, p.proowner::regrole
from pg_proc p where p.oid = 'public.ma_fonction(uuid)'::regprocedure;
```

Si le propriétaire est `supabase_admin` (ou si la migration touche des grants
`storage.*`), la migration — le FICHIER ENTIER, pas la moitié — s'applique en
`supabase_admin` :

```bash
docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
  -v ON_ERROR_STOP=1 < db/migrations/<fichier>.sql
```

et le dit dans son en-tête (« À APPLIQUER EN supabase_admin », précédent :
`20260907120150_b4_storage_grant_hardening.sql`, puis les quatre migrations
X3).

**Règle 3 — jamais de moitié de migration.** Une migration qui mélange des
objets `postgres` et des redéfinitions `supabase_admin` s'applique en
`supabase_admin`, en entier — `CREATE OR REPLACE` par le superuser préserve
propriétaires et ACL des deux familles (règle 2.3). Le bac d'essai fidèle
(`db/tests/b3_restore_sandbox.sh`, restauration SANS `--no-owner`) est le
filet : il refuse exactement ce que la production refusera.

**Règle 4 — depuis X3, les grants d'une RPC neuve sont EXPLICITES.**
Les ACL par défaut sont durcies (`20260907173000`) : une fonction neuve de
`public` ne naît plus exécutable par `anon`/`authenticated`/`PUBLIC` ; une
fonction neuve de `private` ne naît plus exécutable par `PUBLIC` ; une table
neuve ne porte plus TRUNCATE/TRIGGER/REFERENCES/MAINTAIN pour les rôles
client. Toute migration qui crée une RPC destinée au front DOIT écrire :

```sql
grant execute on function public.ma_rpc(...) to anon;            -- si publique
grant execute on function public.ma_rpc(...) to authenticated;   -- si connectée
```

L'oubli se voit immédiatement : 401 en HTTP, et la suite
`db/tests/x3_anon_surface.sh` le liste.

**Effet de bord assumé** : le REVOKE global vaut pour tous les schémas où
`postgres`/`supabase_admin` créent des fonctions. Après un futur
`CREATE/ALTER EXTENSION` (exécuté par `supabase_admin`), les NOUVELLES
fonctions d'extension ne seront plus PUBLIC-exécutables — si un chemin client
en dépend, l'accorder explicitement.

## 4. Uniformiser la propriété ? Non — décision argumentée

Transférer les 42 fonctions de `supabase_admin` vers `postgres` est tentant
(un seul rôle de migration pour toujours) et **refusé**, pour trois raisons :

1. **Ça changerait la sémantique d'exécution.** Ces fonctions sont presque
   toutes SECURITY DEFINER : elles s'exécutent avec les droits de leur
   PROPRIÉTAIRE. Aujourd'hui c'est un superuser ; après transfert, un
   non-superuser. Toute dépendance enfouie à un pouvoir superuser (GUC
   protégé, objet d'un autre service) casserait en silence, précisément le
   genre de régression que ce lot combat.
2. **Une partie appartient à Supabase de fait.** `storage.*` est géré par le
   service storage ; le transférer serait s'approprier un objet qu'un
   `ALTER EXTENSION`/upgrade Supabase s'attend à posséder.
3. **Le coût du statu quo est faible maintenant qu'il est écrit.** Le piège
   coûtait cher parce qu'il était inconnu ; la règle 2 le réduit à une
   vérification d'une ligne.

Ce qui est fait à la place : la doctrine ci-dessus, l'en-tête « À APPLIQUER
EN … » dans chaque migration concernée, et le bac d'essai fidèle comme
vérité. Si un futur lot doit toucher une fonction `supabase_admin` de manière
répétée, le transfert se décide **fonction par fonction**, tracé
(`ALTER FUNCTION ... OWNER TO postgres` + re-grant, dans une migration
dédiée), jamais en masse.

## 5. Ce qu'un lot vérifie avant de livrer (checklist)

- [ ] `proowner` de chaque objet redéfini → rôle d'application choisi.
- [ ] Grants EXPLICITES sur chaque RPC neuve (règle 4).
- [ ] `revoke execute on function ... from public` n'est PLUS nécessaire sur
      les fonctions neuves (le défaut est durci) mais reste inoffensif.
- [ ] Bac d'essai fidèle : up, verify, down, **ACL comparées** —
      `db/tests/x3_acl_snapshot.sql` avant/après, diff vide (au marqueur
      `(implicite)` près, documenté dans X3_RAPPORT.md §7).
- [ ] Concédant vérifié avant tout REVOKE (`aclexplode`, colonne grantor).
