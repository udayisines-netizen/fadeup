---
name: production-release
description: Validate FadeUp before production deployments.
---

# Production Release

Before production deployment:

1. git status
2. dependency check
3. lint
4. TypeScript check
5. tests
6. production build
7. migration validation
8. RLS/security audit
9. Docker Compose validation
10. database backup
11. deployment
12. container health checks
13. application health checks
14. log inspection

Block deployment when critical validation fails.
