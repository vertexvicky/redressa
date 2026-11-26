import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../packages/backend/src/index';
import { initDb, closeDb, resetDb } from '../../packages/backend/src/database';

let app: ReturnType<typeof createApp>;
let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  await initDb();
  app = createApp();
  request = supertest(app) as any;
});

afterAll(() => {
  closeDb();
  resetDb();
});

describe('POST /api/webhooks/voice', () => {
  it('processes valid webhook payload', async () => {
    const res = await request
      .post('/api/webhooks/voice')
      .send({
        message: {
          type: 'call.ended',
          call: { id: 'mock-call-123', status: 'completed', duration: 30 },
          timestamp: new Date().toISOString(),
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
