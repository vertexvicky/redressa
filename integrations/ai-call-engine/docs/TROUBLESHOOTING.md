# Troubleshooting Guide

Use this guide to diagnose and resolve common issues with AI Call Engine.

---

## 1. Module Not Found Errors (`@ai-call-engine/shared` or `vitest`)

**Symptoms:**
- `Error: Cannot find module '@ai-call-engine/shared'`
- `ERR_MODULE_NOT_FOUND` when running `npm run dev` or `npm start`

**Causes & Fixes:**
1. **Dependencies not installed from root**: Run `npm install` at the repository root (`ai-call-engine/`), not inside individual package folders.
2. **Shared package not built**: If running compiled JS (`npm start`), build workspaces first:
   ```bash
   npm run build
   ```
3. **Stale `node_modules`**: Clean and reinstall:
   ```bash
   npm run clean && npm install
   ```

---

## 2. Database Initialization Failures

**Symptoms:**
- `SqliteError: unable to open database file`
- `better-sqlite3` native binding error (`ERR_DLOPEN_FAILED`)

**Causes & Fixes:**
1. **Missing directory**: Ensure the parent directory of `DATABASE_PATH` exists and is writable (e.g., `./data` locally or `/app/data` in Docker).
2. **Permissions in Docker**: The container runs as non-root `appuser` (UID `1001`). Ensure the mounted volume is writable by UID `1001`.
3. **Node version mismatch after upgrade**: Rebuild native `better-sqlite3` bindings:
   ```bash
   npm rebuild better-sqlite3
   ```

---

## 3. Authentication Failures (`401 Unauthorized`)

**Symptoms:**
- API returns `401 Unauthorized` on `POST /api/events/request-closed` or `POST /api/calls`.

**Causes & Fixes:**
1. **Missing header**: Include `Authorization: Bearer <token>`.
2. **Token mismatch**: Verify your request token exactly matches `API_AUTH_TOKEN` in `.env` (check for trailing spaces or quotes).
3. **`.env` not loaded**: Confirm `.env` exists in the root or backend working directory and restart the server after editing it.

---

## 4. Call Not Initiating (Provider Config Issues)

**Symptoms:**
- Event returns `202 Accepted`, but calls move to `FAILED` or stay `QUEUED`.

**Causes & Fixes:**
1. **Using `vapi` without credentials**: If `VOICE_PROVIDER=vapi`, verify `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, and `VAPI_ASSISTANT_ID` are all set and valid.
2. **Testing locally with `vapi` set**: Switch to `VOICE_PROVIDER=mock` and `DEMO_MODE=true` for offline/local testing.
3. **Invalid phone format**: Phone numbers must be in strict E.164 format starting with `+` (e.g., `+919876543210`, not `9876543210`).
4. **Suppressed number**: Check if the phone number was added to the suppression list.

---

## 5. Webhook Not Received (`POST /api/webhooks/voice`)

**Symptoms:**
- Calls are placed via Vapi, but call status never updates from `RINGING` to `COMPLETED`.

**Causes & Fixes:**
1. **Localhost URL unreachable**: External providers like Vapi cannot reach `http://localhost:4000`. Use a public HTTPS domain or tunnel (e.g., `ngrok http 4000`) during development.
2. **HTTP instead of HTTPS**: Most voice providers require an HTTPS endpoint with a valid TLS certificate.
3. **Firewall / Reverse Proxy blocking**: Ensure your ingress/firewall allows `POST /api/webhooks/voice` without requiring your internal `API_AUTH_TOKEN` Bearer header.
4. **Signature mismatch**: Ensure `VAPI_WEBHOOK_SECRET` in `.env` matches the secret configured in your Vapi dashboard.

---

## 6. Duplicate Event Errors (`409 Conflict`)

**Symptoms:**
- `POST /api/events/request-closed` returns `409 Conflict` (`DUPLICATE_EVENT`).

**Causes & Fixes:**
- AI Call Engine enforces idempotency per `(requestId, event)` pair.
- **In external apps**: Treat `409` as safe idempotent handling (the call was already queued).
- **In manual testing**: Use a unique `requestId` for each new test request (e.g., `REQ-TEST-$(date +%s)`).

---

## 7. Rate Limit Exceeded (`429 Too Many Requests`)

**Symptoms:**
- Requests fail with HTTP `429`.

**Causes & Fixes:**
- Default limit is `RATE_LIMIT_MAX=100` requests per `RATE_LIMIT_WINDOW_MS=900000` (15 minutes) per IP.
- Increase `RATE_LIMIT_MAX` in `.env` for high-throughput backends or load testing.
- If running behind a reverse proxy, ensure the proxy forwards `X-Forwarded-For` properly so all clients don't share one proxy IP.

---

## 8. TypeScript Compilation Errors

**Symptoms:**
- `npm run build` or `npm run lint` fails with `tsc` errors.

**Causes & Fixes:**
1. **Build order**: `@ai-call-engine/shared` must compile before `backend` and `frontend`. Always run `npm run build` from the root (not `tsc` inside `backend` alone).
2. **Node.js / TypeScript version**: Confirm Node.js >= 18 (`node -v`) and run `npm install` to ensure workspace `@types/*` packages are installed.

---

## 9. Docker Build Issues

**Symptoms:**
- `docker compose build` fails during `npm install` or `npm run build`.

**Causes & Fixes:**
1. **Build context**: Run `docker compose -f docker/docker-compose.yml up --build` from the project root or inside `docker/` (note `context: ..` in `docker/docker-compose.yml`).
2. **Missing `.env` file**: `docker-compose.yml` references `../.env`. Copy `.env.example` to `.env` before running `docker compose up`.
3. **Native module build tools on Alpine**: `better-sqlite3` uses prebuilds or requires `python3 make g++` on `node:18-alpine` if a prebuild isn't available for your CPU architecture (e.g., ARM64 vs x86_64). Add `RUN apk add --no-cache python3 make g++` before `npm install` in `docker/Dockerfile` if compilation is needed on your host architecture.
