---
name: multitenant-architect
description: Enforce correct multi-tenant architecture throughout FadeUp.
---

# Multi-Tenant Architect

FadeUp is multi-tenant.

The primary tenant is organizations.

Every business resource must either:

- contain organization_id
- or have an immutable ownership relationship leading to an organization

Never trust organization_id from the browser without authorization.

Always analyze:

- cross-tenant isolation
- memberships
- roles
- locations
- RLS
- foreign keys
- indexes
- unique constraints

A user belonging to tenant A must never access tenant B data.
