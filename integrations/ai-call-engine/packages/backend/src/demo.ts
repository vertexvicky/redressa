import axios from 'axios';
import { AddressInfo } from 'net';
import { config } from './config';
import { logger } from './config/logger';
import { initDb, closeDb } from './database';
import { callQueue } from './queue';
import { registerCallWorker } from './queue/call.worker';
import { createApp } from './index';
import { EventType } from '@ai-call-engine/shared';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDemo(): Promise<void> {
  logger.info('[DEMO] ═══════════════════════════════════════════════════════════');
  logger.info('[DEMO] Starting AI Call Engine in MOCK / DEMO mode');
  logger.info('[DEMO] [MOCK] NO REAL PHONE CALLS WILL BE PLACED');
  logger.info('[DEMO] ═══════════════════════════════════════════════════════════');

  if (config.voiceProvider !== 'mock') {
    logger.warn(`[DEMO] VOICE_PROVIDER is "${config.voiceProvider}"; demo expects "mock" mode`);
  }

  await initDb();
  registerCallWorker();
  callQueue.start();

  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://localhost:${port}`;
  const authHeaders = { Authorization: `Bearer ${config.apiAuthToken}` };

  try {
    // 1. Health check
    const healthRes = await axios.get(`${baseUrl}/health`);
    logger.info({ health: healthRes.data.data }, '[DEMO] Health check passed');

    // 2. Send simulated REQUEST_CLOSED event
    const requestId = `REQ-DEMO-${Date.now()}`;
    const eventPayload = {
      event: EventType.REQUEST_CLOSED,
      requestId,
      customer: {
        name: 'Aarav Sharma',
        phone: '+919876543210',
      },
      request: {
        title: 'Broadband connection speed issue',
        status: 'CLOSED',
        resolution: 'Line profile updated and router firmware upgraded. Full speed restored.',
      },
      metadata: {
        organization: 'Acme Fiber Support',
        closedAt: new Date().toISOString(),
        closedBy: 'agent-01',
      },
      consent: {
        automatedCallAllowed: true,
        consentReference: 'CONSENT-DEMO-001',
      },
    };

    logger.info({ requestId }, '[DEMO] Sending simulated REQUEST_CLOSED event');
    const eventRes = await axios.post(`${baseUrl}/api/events/request-closed`, eventPayload, {
      headers: authHeaders,
    });
    const { eventId } = eventRes.data.data;
    logger.info({ eventId, response: eventRes.data.data }, '[DEMO] Event accepted');

    // 3. Poll event status until processed and callId is assigned
    let callId: string | undefined;
    for (let attempt = 0; attempt < 15; attempt++) {
      await sleep(250);
      const statusRes = await axios.get(`${baseUrl}/api/events/${eventId}`, {
        headers: authHeaders,
      });
      const eventRecord = statusRes.data.data;
      logger.info(
        { attempt: attempt + 1, status: eventRecord.status, callId: eventRecord.callId },
        '[DEMO] Polled event status',
      );

      if (eventRecord.callId) {
        callId = eventRecord.callId;
        break;
      }
    }

    if (!callId) {
      throw new Error('[DEMO] Timed out waiting for event to spawn a mock call');
    }

    // 4. Poll call status
    const callRes = await axios.get(`${baseUrl}/api/calls/${callId}`, {
      headers: authHeaders,
    });
    logger.info({ call: callRes.data.data }, '[DEMO] [MOCK] Polled simulated call status');

    // 5. Simulate mock provider webhook callback completing the call
    const dbCall = await import('./services/call.service').then(m => m.getCall(callId!));
    if (dbCall?.providerCallId) {
      logger.info({ providerCallId: dbCall.providerCallId }, '[DEMO] [MOCK] Simulating voice webhook callbacks');
      await axios.post(`${baseUrl}/api/webhooks/voice`, {
        providerCallId: dbCall.providerCallId,
        status: 'connected',
      });
      await axios.post(`${baseUrl}/api/webhooks/voice`, {
        providerCallId: dbCall.providerCallId,
        status: 'in-progress',
      });
      await axios.post(`${baseUrl}/api/webhooks/voice`, {
        providerCallId: dbCall.providerCallId,
        status: 'completed',
        message: { call: { id: dbCall.providerCallId, status: 'completed', duration: 24 } },
      });
    }

    const finalCallRes = await axios.get(`${baseUrl}/api/calls/${callId}`, {
      headers: authHeaders,
    });
    const finalEventRes = await axios.get(`${baseUrl}/api/events/${eventId}`, {
      headers: authHeaders,
    });

    logger.info({ finalCall: finalCallRes.data.data }, '[DEMO] [MOCK] Final simulated call record');
    logger.info({ finalEvent: finalEventRes.data.data }, '[DEMO] Final event record');
    logger.info('[DEMO] [MOCK] Demo complete — no real phone call was placed');
  } finally {
    callQueue.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeDb();
  }
}

runDemo().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, '[DEMO] Demo failed');
  callQueue.stop();
  closeDb();
  process.exit(1);
});
