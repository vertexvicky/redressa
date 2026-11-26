/**
 * AI Call Engine — Integration Example
 *
 * This file shows how your external application's backend should send
 * a REQUEST_CLOSED event to the AI Call Engine after an official
 * closes a customer request.
 *
 * Usage:
 *   npx tsx examples/integration-example.ts
 */

const AI_CALL_ENGINE_URL = process.env.AI_CALL_ENGINE_URL || 'http://localhost:4000';
const API_TOKEN = process.env.API_AUTH_TOKEN || 'change-me-to-a-secure-random-token';

async function notifyRequestClosed(
  requestId: string,
  customer: { name: string; phone: string },
  resolution: string,
  organization: string,
) {
  console.log(`\nSending REQUEST_CLOSED event for ${requestId}...`);

  const response = await fetch(`${AI_CALL_ENGINE_URL}/api/events/request-closed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify({
      event: 'REQUEST_CLOSED',
      requestId,
      customer,
      request: {
        title: 'Customer Request',
        status: 'CLOSED',
        resolution,
      },
      metadata: {
        organization,
        closedAt: new Date().toISOString(),
      },
      consent: {
        automatedCallAllowed: true,
        consentReference: `CONSENT-${requestId}`,
      },
    }),
  });

  const result = await response.json();
  console.log(`Status: ${response.status}`);
  console.log('Response:', JSON.stringify(result, null, 2));

  if (result.success) {
    console.log(`\n✅ Event accepted! Event ID: ${result.data.eventId}`);
    console.log('The AI Call Engine will automatically initiate the phone call.');

    // Optionally poll for status
    console.log('\nPolling event status...');
    await new Promise(r => setTimeout(r, 2000));

    const statusRes = await fetch(`${AI_CALL_ENGINE_URL}/api/events/${result.data.eventId}`, {
      headers: { 'Authorization': `Bearer ${API_TOKEN}` },
    });
    const statusResult = await statusRes.json();
    console.log('Event status:', JSON.stringify(statusResult.data, null, 2));
  } else {
    console.error('❌ Event rejected:', result.error);
  }
}

// Example usage
notifyRequestClosed(
  'REQ-2024-001',
  { name: 'Priya Patel', phone: '+919876543210' },
  'Your broadband connection issue has been fixed. The faulty cable has been replaced and your connection speed should now be back to normal.',
  'NetConnect Services',
).catch(console.error);
