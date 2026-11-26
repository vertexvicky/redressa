# Installation Guide

Follow these steps to install, configure, and verify the AI Call Engine locally.

## 1. Prerequisites

Ensure the following tools are installed on your machine:

- **Node.js**: v18.0.0 or higher (`node -v`)
- **npm**: v9+ (`npm -v`, bundled with Node.js)
- **Git** or archive extraction utility (if installing from a `.zip` package)

## 2. Extract the Project

If you received the project as a ZIP archive, extract it and navigate into the project root:

```bash
unzip ai-call-engine.zip -d ai-call-engine
cd ai-call-engine
```

## 3. Install Dependencies

Run `npm install` from the **repository root** so all workspace packages (`packages/shared`, `packages/backend`, `packages/frontend`) are linked automatically:

```bash
npm install
```

## 4. Create Environment Configuration

Copy `.env.example` to `.env` in the root directory:

```bash
# Linux / macOS
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

## 5. Configure `API_AUTH_TOKEN`

Generate a strong random token and set `API_AUTH_TOKEN` in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Update `.env`:

```env
API_AUTH_TOKEN=<paste-generated-hex-token-here>
```

> **Important:** Never use the default `change-me-to-a-secure-random-token` value in staging or production.

## 6. Configure Voice Provider

### Option A: Mock Provider (Local Development & Testing)

By default, `.env.example` uses the mock provider so you can test the entire flow without external telephony credentials:

```env
VOICE_PROVIDER=mock
DEMO_MODE=true
```

### Option B: Vapi (Production Outbound AI Calls)

To place real phone calls using Vapi, update `.env`:

```env
VOICE_PROVIDER=vapi
DEMO_MODE=false
VAPI_API_KEY=your-vapi-private-api-key
VAPI_PHONE_NUMBER_ID=your-vapi-phone-number-id
VAPI_ASSISTANT_ID=your-vapi-assistant-id
VAPI_WEBHOOK_SECRET=your-vapi-webhook-hmac-secret
```

See [Voice Providers](./PROVIDERS.md) for detailed Vapi setup instructions.

## 7. Start the Development Server

Start the backend server in watch/dev mode from the root directory:

```bash
npm run dev
```

The server listens on `http://localhost:4000` (or the `PORT` defined in `.env`) and automatically initializes the SQLite database at `DATABASE_PATH` (`./data/ai-call-engine.sqlite`).

## 8. Verify with the Health Endpoint

In a second terminal, check that the server is healthy:

```bash
curl http://localhost:4000/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

## 9. Run the Built-in Demo

Run the demo script to simulate an end-to-end call flow using the mock provider:

```bash
npm run demo
```

## 10. Trigger a Test Call Event via cURL

Send a `REQUEST_CLOSED` event while `npm run dev` is running:

```bash
curl -X POST http://localhost:4000/api/events/request-closed \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-API_AUTH_TOKEN>" \
  -d '{
    "event": "REQUEST_CLOSED",
    "requestId": "REQ-INSTALL-001",
    "customer": {
      "name": "Aarav Sharma",
      "phone": "+919876543210"
    },
    "request": {
      "title": "Billing Inquiry",
      "status": "CLOSED",
      "resolution": "Your invoice adjustment has been processed and credited."
    },
    "metadata": {
      "organization": "Acme Support",
      "closedAt": "2026-01-01T10:00:00Z"
    },
    "consent": {
      "automatedCallAllowed": true,
      "consentReference": "CONSENT-INSTALL-001"
    }
  }'
```

You should receive HTTP `202 Accepted` with an `eventId` and `"status": "QUEUED"`.

## Troubleshooting Common Install Issues

- **`better-sqlite3` native build errors**: Ensure Python 3 and C++ build tools are installed (on Windows: `npm install --global windows-build-tools` or Visual Studio Build Tools; on Ubuntu/Debian: `sudo apt-get install build-essential python3`; on macOS: `xcode-select --install`).
- **`Cannot find module '@ai-call-engine/shared'`**: Make sure you ran `npm install` from the **root** directory rather than inside `packages/backend`, and run `npm run build:shared` if running compiled outputs.
- **Node version mismatch**: Check `node -v`. Upgrade to Node.js 18+ via `nvm` or the official installer if you are on Node 16 or earlier.
- **Port 4000 already in use**: Change `PORT=4001` in `.env` or stop the conflicting process.

For more help, see [Troubleshooting](./TROUBLESHOOTING.md).
