# Redressa — Autonomous Closure-Verification AI Agent for Public Grievances

> *"We don't ask whether the ticket is closed. We ask whether the problem is solved, and whether the citizen was free to say so."*

## Monorepo Structure

```text
redressa/
  packages/shared/   # Shared Zod schemas, enums, and state machine transitions
  apps/api/          # Cloudflare Worker (Hono API, D1 Drizzle, Firestore Storage, Queues, Cron, Durable Objects)
  apps/web/          # React + Vite + TypeScript SPA (Silk White + Obsidian Dark, EN/TA)
```

## Local Setup (Under 15 Minutes)

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment Variables
1. Copy `.env.example` values into `apps/web/.env` (with `VITE_FIREBASE_*` and `VITE_API_BASE_URL=http://localhost:8787`).
2. Create `apps/api/.dev.vars` for local Worker secrets:
```env
GEMINI_API_KEY=your-google-ai-studio-key
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
ENCRYPTION_KEY=your-base64-32-byte-key
SIGNING_SECRET=your-hmac-secret
```
3. Update `FIREBASE_PROJECT_ID` in `apps/api/wrangler.jsonc`.

### 3. Apply Local D1 Migrations
```bash
pnpm db:migrate:local
```

### 4. Run Backend & Frontend Concurrently
```bash
pnpm dev
```
- API runs at `http://localhost:8787` (`/health` returns service status)
- Web SPA runs at `http://localhost:5173`

### 5. Run Typechecks, Tests & Dry-Run Builds
```bash
pnpm typecheck
pnpm test
pnpm build
```

## Production Deployment (Under 1 Hour)

### 1. Provision Cloudflare Resources
```bash
cd apps/api
npx wrangler d1 create redressa-db
npx wrangler queues create agent-events
npx wrangler queues create evidence-processing
```
Copy the generated `database_id` into `apps/api/wrangler.jsonc`.

### 2. Apply Remote Migrations & Set Secrets
```bash
pnpm db:migrate:remote
cd apps/api
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put SIGNING_SECRET
```

### 3. Configure Firebase Authentication & Firestore
1. In the Firebase Console, enable **Google** and **Anonymous** sign-in providers.
2. Enable **Cloud Firestore** in native mode (used to store chunked evidence blobs in `evidence_blobs` and `evidence_chunks`).
3. Generate a Firebase Service Account key (Project Settings → Service Accounts) and set `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` as Worker secrets.
4. Add your local (`localhost`), preview, and production domains to **Authentication → Settings → Authorized domains**.
5. Ensure `FIREBASE_PROJECT_ID` in `apps/api/wrangler.jsonc` matches your Firebase project ID.

### 4. Deploy API & Web SPA
```bash
pnpm deploy:api
pnpm deploy:web
```
