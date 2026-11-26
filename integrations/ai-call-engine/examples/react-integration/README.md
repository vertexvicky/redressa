# React Integration Example

This example shows how to embed the `@ai-call-engine/frontend` `AICall` component inside an existing React application.

## Prerequisites

- React 18+
- A running instance of the AI Call Engine backend (default: `http://localhost:4000`)
- Your configured `API_AUTH_TOKEN`

## Setup

1. Install the frontend package in your React project (or copy `packages/frontend/src` into your app):

   ```bash
   # Option A: Link/install from the workspace
   npm install @ai-call-engine/frontend

   # Option B: Copy source directly
   cp -r ../../packages/frontend/src ./src/ai-call-engine
   ```

2. Configure CORS on the AI Call Engine backend so your React app origin is allowed (e.g., `CORS_ORIGIN=http://localhost:3000` in `.env`).

3. Import and render `<AICall />` in your application (see [src/App.tsx](./src/App.tsx)):

   ```tsx
   import { AICall } from '@ai-call-engine/frontend';

   export function App() {
     return (
       <AICall
         config={{
           apiUrl: 'http://localhost:4000',
           authToken: process.env.REACT_APP_AI_CALL_TOKEN!,
         }}
         onCallStarted={(callId) => console.log('Call started:', callId)}
         onCallEnded={(callId, outcome) => console.log('Call ended:', callId, outcome)}
         onError={(error) => console.error('Call error:', error)}
       />
     );
   }
   ```

## Security Note

Avoid embedding privileged server-side `API_AUTH_TOKEN` secrets directly in public browser bundles in production. Prefer proxying requests from your React frontend through your own authenticated backend API.
