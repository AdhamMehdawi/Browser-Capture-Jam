# Assumptions & Decisions

Decisions made on behalf of the user during the build. Revisit any of these by saying "revisit assumption N".

---

## A1 — Hosting strategy (FRD §9.1)
**Decision:** Self-hosted docker-compose is the primary target for MVP. A `docker-compose.yml` will bring up Postgres + MinIO + server + web locally and in any VPS. Vercel/Railway/S3 remains compatible because the server is a plain Fastify app and the web is Next.js; we avoid platform-specific features.
**Why:** Velo QA is positioned as an open-source alternative to jam.dev; a one-command self-host path is the core selling point. Managed hosting can be layered on later without rework.

## A2 — Offline queue (FRD §9.2)
**Decision:** **Deferred to v1.1.** MVP uploads require network at capture time; failures surface a retry toast but do not persist across browser restarts.
**Why:** Bug-capture tools are typically used on a live page where the network is already working. Offline queueing adds IndexedDB schema, quota handling, and background-sync plumbing that can ship post-MVP without invalidating the capture envelope format.

## A3 — Webcam compositing (FRD §9.3)
**Decision:** **Deferred (FR-C4 is v1.1).** When it lands, compose client-side: the extension records a second `MediaRecorder` stream from `getUserMedia` and the viewer renders it as a floating PiP `<video>` over the main player. No server ffmpeg in v1.1.
**Why:** Client-side composition keeps the ingest server stateless, avoids a heavy ffmpeg dependency, and lets the viewer toggle/move the webcam overlay after the fact.

---

## A4 — Package manager
**Decision:** pnpm workspaces.
**Why:** Fastest install, strict peer deps, first-class monorepo support. Lockfile committed.

## A5 — Node version
**Decision:** Node 20 LTS (`.nvmrc` → `20`).
**Why:** Fastify 4, Prisma 5, Next 14 all well-supported on 20. 22 is LTS but 20 has the widest CI coverage.

## A6 — TypeScript style
**Decision:** `"strict": true`, `"noUncheckedIndexedAccess": true`, ESM (`"type": "module"`) across the monorepo. Server compiles with `tsx` for dev, `tsc` for prod.
**Why:** Strict mode catches auth/permission bugs at compile time — the class of bugs we most want to avoid in an app that handles sessions and workspace ACLs.

## A7 — Email verification delivery in dev
**Decision:** In dev (`NODE_ENV !== 'production'`), verification and invite links are logged to the server's stdout instead of being sent by SMTP. Production wires in a pluggable mailer interface (Resend or SMTP).
**Why:** Keeps `pnpm dev` zero-config. SMTP/Resend creds are a v1 concern.

## A8 — JWT algorithm
**Decision:** HS256 with a single `JWT_SECRET` env var for MVP. Rotate to RS256 if/when we need asymmetric verification from the extension.
**Why:** Extension never verifies JWTs locally — it just relays them — so symmetric is fine and simpler.

## A9 — Refresh token rotation
**Decision:** Refresh tokens are single-use. Each `/auth/refresh` issues a new refresh + access and revokes the old refresh (`revokedAt`). Reuse of a revoked token invalidates all sessions for that user ("refresh token replay" defense).
**Why:** Standard OWASP guidance; low cost to implement now, hard to retrofit later.

## A10 — Personal workspace on signup
**Decision:** Registration auto-creates a workspace named `"{user's first name}'s Workspace"` (or email localpart if no name) with the user as `owner`. Users can rename or delete it later.
**Why:** Every Jam must belong to a workspace, so a user with zero workspaces is a broken state. Auto-provisioning keeps the onboarding path one step.
