import { RequestClosedEvent, EventType } from '../packages/shared/src/types/events';

export const TEST_AUTH_TOKEN = 'test-secret-token';
export const TEST_AUTH_HEADER = { Authorization: `Bearer ${TEST_AUTH_TOKEN}` };

export function createValidPayload(overrides?: Partial<RequestClosedEvent>): RequestClosedEvent {
  return {
    event: EventType.REQUEST_CLOSED,
    requestId: `REQ-TEST-${Date.now()}`,
    customer: {
      name: 'Test Customer',
      phone: '+919876543210',
    },
    request: {
      title: 'Test Request',
      status: 'CLOSED',
      resolution: 'Your issue has been resolved successfully.',
    },
    metadata: {
      organization: 'Test Organization',
      closedAt: new Date().toISOString(),
    },
    consent: {
      automatedCallAllowed: true,
      consentReference: 'CONSENT-TEST-001',
    },
    ...overrides,
  };
}
