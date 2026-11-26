import { describe, it, expect, beforeEach } from 'vitest';

// Test the queue by importing the class mechanism
// We need to test the queue logic, so let's create a fresh queue
describe('Job Queue', () => {
  // Simple queue test - just validate the structure works
  it('should be importable', async () => {
    const { callQueue } = await import('../../packages/backend/src/queue/index');
    expect(callQueue).toBeDefined();
    expect(typeof callQueue.add).toBe('function');
    expect(typeof callQueue.start).toBe('function');
    expect(typeof callQueue.stop).toBe('function');
    expect(typeof callQueue.getStats).toBe('function');
  });
});
