# FADEUP

## Identity

FadeUp is a production-grade multi-tenant SaaS for modern barbershops.

This repository is completely independent from Jasmean OS.

## Absolute project isolation

Allowed project root:

/opt/fadeup

Forbidden:

/opt/jasmean-os

Never modify:

- Jasmean OS source
- Jasmean OS containers
- Jasmean OS databases
- Jasmean OS Docker networks
- Jasmean OS Docker volumes
- Jasmean OS configuration
- unrelated Nginx virtual hosts

Never execute commands against /opt/jasmean-os.

## Stack

Frontend:

- React
- TypeScript
- Vite
- Tailwind CSS

Application:

- TanStack Query
- React Hook Form
- Zod

Backend:

- Supabase self-hosted
- PostgreSQL
- Supabase Auth
- PostgREST
- Realtime
- Storage
- Row Level Security

Infrastructure:

- Docker
- Docker Compose
- Nginx
- TLS

## Multi-tenancy

Primary tenant entity:

organizations

Never build business data without tenant isolation.

Business resources must contain organization_id or have an immutable ownership chain leading to an organization.

Never trust organization_id submitted by frontend code.

Every feature must explicitly consider tenant boundaries.

A user belonging to one organization must never be able to read, modify, delete, or infer private data belonging to another organization.

## Database

All schema changes must be reproducible SQL migrations.

Always consider:

- RLS
- foreign keys
- indexes
- constraints
- tenant isolation
- auditability
- timestamps

Use the Supabase and Postgres skills before significant database work.

Never make undocumented schema changes directly in production.

## Security

RLS must protect exposed tenant tables.

Never expose service_role or secret server credentials to frontend code.

Never expose PostgreSQL directly to the public Internet.

Never rely only on frontend authorization.

Authorization must be enforced server-side and/or through PostgreSQL RLS.

Treat tenant data as inaccessible by default.

## UI/UX

Use ui-ux-director whenever creating or substantially modifying UI.

All important screens must support:

- mobile
- tablet
- desktop
- loading
- empty
- error
- success states

Barber interfaces prioritize:

- speed
- touch usability
- large actionable controls
- minimum interaction count
- realtime feedback

Customer interfaces prioritize:

- minimal friction
- clarity
- fast booking
- fast queue interactions
- mobile-first usability

Avoid generic AI-generated SaaS dashboards.

The FadeUp interface must feel intentionally designed and consistent across the entire product.

## Development workflow

Before completing a feature:

1. inspect existing architecture
2. understand the business objective
3. use product architecture skill
4. analyze multi-tenancy
5. analyze database impact
6. analyze permissions and RLS
7. implement migrations
8. implement application code
9. review UI/UX
10. implement loading, empty, error and success states
11. test
12. typecheck
13. build
14. security review
15. verify actual application behavior
16. summarize modifications

## Docker safety

FadeUp must remain completely isolated from Jasmean OS.

Never execute destructive global Docker commands.

Do not use:

docker system prune
docker volume prune
docker network prune

Never use:

docker compose down -v

unless explicitly authorized and the consequences are understood.

Never stop, restart, delete or modify unrelated containers.

All FadeUp Docker resources should use clear FadeUp-specific naming where possible.

Examples:

- fadeup-web
- fadeup-supabase
- fadeup-network
- fadeup-* volumes

## Quality

Do not claim completion because code compiles.

Verify actual application behavior.

A feature is not complete until:

- its expected behavior works
- permissions are correct
- tenant isolation is correct
- responsive behavior is correct
- error states work
- production build succeeds
- no critical security issue remains

## Product

The product name is:

FadeUp

Never refer to the product as "Barber OS".

"Barber", "barbershop" and similar words may be used only to describe the target industry, users or business domain.
