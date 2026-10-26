# invite-backend

A small standalone Node/Hono service that invites newly-created Circles accounts
via the InvitationFarm, and records per-app signup attribution to a JSON file
(served at `GET /stats`).

It lives in this repo for convenience but is a **separate process** — it is NOT
part of the SvelteKit app build.

## ⚠️ Security — why it's safe to colocate here
- The SvelteKit app uses `adapter-static` (a pure static frontend). It has no
  server runtime and **never imports** anything from this folder — it only talks
  to this service over HTTP via `VITE_INVITE_BACKEND_URL`.
- This service holds `INVITER_PRIVATE_KEY`, a **hot wallet key**. It must stay
  server-side. It lives only in this folder's `.env` (gitignored) or your
  deployment's secret manager — never in the frontend bundle, never committed.
- The repo `.gitignore` ignores `.env` / `.env.*` everywhere, and this folder's
  `.gitignore` ignores `data/`. Only `.env.example` (no real values) is tracked.

**Never** fold this into the SvelteKit app (e.g. `+server.ts`) without switching
to `adapter-node` and auditing that the key cannot reach the client build.

## Run
```bash
cd invite-backend
cp .env.example .env   # fill INVITER_SAFE_ADDRESS + INVITER_PRIVATE_KEY
npm install
npm run dev            # http://localhost:8787
```

## Endpoints
- `POST /invite { account, app? }` — invite an account; `app` (host-supplied
  iframe origin) is recorded for attribution.
- `GET /health` — `{ ok: true }`.
- `GET /stats` — per-app signup counts (JSON file store).

## Deployment
The `Deploy to Droplet` workflow ships this folder on every push to `master`:
it rsyncs `invite-backend/` into `/opt/invite-backend/app` (never `.env`,
`data/` or `node_modules/`), runs `npm ci --ignore-scripts` when
`package-lock.json` changed, restarts the service and waits for `/health`.

One-time server setup:
- Service user: `useradd --system --no-create-home --shell /usr/sbin/nologin invite-backend`.
- Ownership: the code in `/opt/invite-backend/app` belongs to the deploy user;
  `.env` (mode 600) and `data/` belong to `invite-backend`, so the service can
  read its code but only write `data/`.
- Unit: install [`deploy/invite-backend.service`](deploy/invite-backend.service)
  to `/etc/systemd/system/`, then `systemctl daemon-reload` and
  `systemctl enable --now invite-backend`.
- Sudoers drop-in so the deploy user can restart it and nothing else:
  `<deploy user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart invite-backend`.
