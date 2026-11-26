import { describe, it, expect } from 'vitest';
import { MockAdapter } from '../../packages/backend/src/providers/mock/mock.adapter';

describe('Mock Provider Adapter', () => {
  const adapter = new MockAdapter();

  it('returns provider name as "mock"', () => {
    expect(adapter.getProviderName()).toBe('mock');
  });

  it('initiates a call and returns a provider call ID', async () => {
    const result = await adapter.initiateCall({
      to: '+919876543210',
      customerName: 'Test Customer',
      organizationName: 'Test Org',
      requestId: 'REQ-001',
      resolution: 'Resolved',
      language: 'en',
    });

    expect(result.providerCallId).toBeTruthy();
    expect(result.providerCallId).toContain('mock-');
    expect(result.status).toBe('ringing');
  });

  it('returns call status', async () => {
    const call = await adapter.initiateCall({
      to: '+919876543210',
      customerName: 'Test',
      organizationName: 'Org',
      requestId: 'REQ-002',
      resolution: 'Done',
      language: 'en',
    });

    const status = await adapter.getCallStatus(call.providerCallId);
    expect(status.providerCallId).toBe(call.providerCallId);
    expect(status.status).toBeTruthy();
  });

  it('ends a call without error', async () => {
    const call = await adapter.initiateCall({
      to: '+919876543210',
      customerName: 'Test',
      organizationName: 'Org',
      requestId: 'REQ-003',
      resolution: 'Done',
      language: 'en',
    });

    await expect(adapter.endCall(call.providerCallId)).resolves.not.toThrow();
  });

  it('validates webhooks (always true in mock)', () => {
    expect(adapter.validateWebhook({}, '', '')).toBe(true);
  });

  it('handles webhooks', async () => {
    const result = await adapter.handleWebhook({ providerCallId: 'test-123', status: 'completed' }, {});
    expect(result.providerCallId).toBe('test-123');
    expect(result.status).toBe('completed');
  });
});
