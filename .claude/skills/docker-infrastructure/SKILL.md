---
name: docker-infrastructure
description: Safely manage FadeUp Docker infrastructure without affecting Jasmean OS.
---

# Docker Infrastructure

Allowed project:

/opt/fadeup

Forbidden project:

/opt/jasmean-os

Never modify unrelated:

- containers
- networks
- volumes
- databases
- reverse proxy configurations

Never use destructive global Docker commands.

Forbidden unless explicitly authorized:

docker system prune
docker volume prune
docker network prune
docker compose down -v
docker rm against unrelated containers

FadeUp infrastructure must remain independently deployable and removable.
