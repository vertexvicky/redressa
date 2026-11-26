import { describe, it, expect } from 'vitest';
import { generateIdempotencyKey } from '../../packages/backend/src/services/deduplication.service';

describe('Deduplication Service', () => {
  describe('generateIdempotencyKey', () => {
    it('generates consistent keys for same input', () => {
      const key1 = generateIdempotencyKey('REQ-001', 'REQUEST_CLOSED');
      const key2 = generateIdempotencyKey('REQ-001', 'REQUEST_CLOSED');
      expect(key1).toBe(key2);
    });

    it('generates different keys for different request IDs', () => {
      const key1 = generateIdempotencyKey('REQ-001', 'REQUEST_CLOSED');
      const key2 = generateIdempotencyKey('REQ-002', 'REQUEST_CLOSED');
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different event types', () => {
      const key1 = generateIdempotencyKey('REQ-001', 'REQUEST_CLOSED');
      const key2 = generateIdempotencyKey('REQ-001', 'OTHER_EVENT');
      expect(key1).not.toBe(key2);
    });

    it('returns a hex string', () => {
      const key = generateIdempotencyKey('REQ-001', 'REQUEST_CLOSED');
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
