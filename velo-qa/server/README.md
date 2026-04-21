# @veloqa/server

Fastify + Prisma + PostgreSQL API.

Current phase: **1.1–1.4** (auth + workspaces). See [`tracker/TRACKER.md`](../tracker/TRACKER.md).

## Layout

```
src/
  index.ts            — entrypoint
  app.ts              — Fastify builder (testable)
  env.ts              — validated env (zod)
  db.ts               — Prisma client singleton
  logger.ts           — pino config
  errors.ts           — typed HTTP errors
  plugins/            — cross-cutting Fastify plugins (auth, rate-limit)
  modules/
    auth/             — register, login, refresh, verify, logout
    workspaces/       — CRUD + invites + membership
  lib/
    password.ts       — argon2id wrapper
    tokens.ts         — JWT + refresh token helpers
    mailer.ts         — dev = stdout, prod = pluggable
prisma/
  schema.prisma
```

## Environment

See `../.env.example`.
