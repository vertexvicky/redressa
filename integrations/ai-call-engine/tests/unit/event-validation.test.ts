import { describe, it, expect } from 'vitest';
import { requestClosedEventSchema } from '../../packages/shared/src/schemas/events';

describe('Event Validation', () => {
  const validPayload = {
    event: 'REQUEST_CLOSED',
    requestId: 'REQ-1024',
    customer: { name: 'Test User', phone: '+919876543210' },
    request: { title: 'Test', status: 'CLOSED', resolution: 'Resolved' },
    metadata: { organization: 'Test Org', closedAt: '2026-01-01T00:00:00Z' },
    consent: { automatedCallAllowed: true, consentReference: 'CONSENT-001' },
  };

  it('accepts a valid REQUEST_CLOSED event', () => {
    const result = requestClosedEventSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects wrong event type', () => {
    const result = requestClosedEventSchema.safeParse({ ...validPayload, event: 'OTHER' });
    expect(result.success).toBe(false);
  });

  it('rejects non-CLOSED status', () => {
    const result = requestClosedEventSchema.safeParse({
      ...validPayload,
      request: { ...validPayload.request, status: 'OPEN' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when consent is false', () => {
    const result = requestClosedEventSchema.safeParse({
      ...validPayload,
      consent: { automatedCallAllowed: false, consentReference: 'CONSENT-001' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty requestId', () => {
    const result = requestClosedEventSchema.safeParse({ ...validPayload, requestId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid phone number', () => {
    const result = requestClosedEventSchema.safeParse({
      ...validPayload,
      customer: { name: 'Test', phone: '1234' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing customer name', () => {
    const result = requestClosedEventSchema.safeParse({
      ...validPayload,
      customer: { name: '', phone: '+919876543210' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing resolution', () => {
    const result = requestClosedEventSchema.safeParse({
      ...validPayload,
      request: { ...validPayload.request, resolution: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing consent reference', () => {
    const result = requestClosedEventSchema.safeParse({
      ...validPayload,
      consent: { automatedCallAllowed: true, consentReference: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects completely missing fields', () => {
    const result = requestClosedEventSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
