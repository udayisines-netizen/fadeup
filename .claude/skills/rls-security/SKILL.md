---
name: rls-security
description: Design, audit and test Supabase/Postgres RLS policies for FadeUp.
---

# RLS Security

Treat tenant data as inaccessible by default.

For every exposed business table:

- enable RLS
- define SELECT policy
- define INSERT policy
- define UPDATE policy
- define DELETE policy where required

Test authorization for:

- organization owner
- manager
- receptionist
- barber
- customer
- unauthenticated user

Always test cross-tenant attacks.

Never rely exclusively on frontend permission checks.

Never expose service_role credentials to frontend code.
