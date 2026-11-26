import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../packages/backend/src/index';
import { initDb, closeDb, resetDb } from '../../packages/backend/src/database';
import { callQueue } from '../../packages/backend/src/queue';
import { registerCallWorker } from '../../packages/backend/src/queue/call.worker';
import { TEST_AUTH_HEADER } from '../helpers';

let app: ReturnType<typeof createApp>;
let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  await initDb();
  app = createApp();
  registerCallWorker();
  callQueue.start();
  request = supertest(app) as any;
});

afterAll(() => {
  callQueue.stop();
  closeDb();
  resetDb();
});

describe('POST /api/calls', () => {
  it('returns 201 for valid manual call', async () => {
    const res = await request
      .post('/api/calls')
      .set(TEST_AUTH_HEADER)
      .send({
        phone: '+919876543210',
        customerName: 'Test Customer',
        organizationName: 'Test Org',
        requestId: 'REQ-MANUAL-001',
        resolution: 'Your issue has been resolved.',
        language: 'en',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
  });

  it('returns 401 without auth', async () => {
    const res = await request
      .post('/api/calls')
      .send({
        phone: '+919876543210',
        customerName: 'Test',
        organizationName: 'Org',
        requestId: 'REQ-001',
        resolution: 'Done',
      });

    expect(res.status).toBe(401);
  });

  it('returns 400 with invalid phone', async () => {
    const res = await request
      .post('/api/calls')
      .set(TEST_AUTH_HEADER)
      .send({
        phone: '1234',
        customerName: 'Test',
        organizationName: 'Org',
        requestId: 'REQ-001',
        resolution: 'Done',
      });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/calls/:id', () => {
  it('returns 404 for non-existent call', async () => {
    const res = await request
      .get('/api/calls/nonexistent-id')
      .set(TEST_AUTH_HEADER);

    expect(res.status).toBe(404);
  });
});
