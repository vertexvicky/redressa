import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../packages/backend/src/index';
import { initDb, closeDb, resetDb } from '../../packages/backend/src/database';
import { callQueue } from '../../packages/backend/src/queue';
import { registerCallWorker } from '../../packages/backend/src/queue/call.worker';
import { createValidPayload, TEST_AUTH_HEADER } from '../helpers';

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

describe('POST /api/events/request-closed', () => {
  it('returns 202 with valid payload', async () => {
    const payload = createValidPayload();
    const res = await request
      .post('/api/events/request-closed')
      .set(TEST_AUTH_HEADER)
      .send(payload);

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.eventId).toBeTruthy();
    expect(res.body.data.requestId).toBe(payload.requestId);
    expect(res.body.data.status).toBe('QUEUED');
  });

  it('returns 401 without auth', async () => {
    const res = await request
      .post('/api/events/request-closed')
      .send(createValidPayload());

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 with wrong token', async () => {
    const res = await request
      .post('/api/events/request-closed')
      .set({ Authorization: 'Bearer wrong-token' })
      .send(createValidPayload());

    expect(res.status).toBe(401);
  });

  it('returns 400 with invalid payload', async () => {
    const res = await request
      .post('/api/events/request-closed')
      .set(TEST_AUTH_HEADER)
      .send({ event: 'WRONG_TYPE' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 for duplicate events', async () => {
    const payload = createValidPayload({ requestId: 'REQ-DUPLICATE-TEST' });

    // First request should succeed
    const res1 = await request
      .post('/api/events/request-closed')
      .set(TEST_AUTH_HEADER)
      .send(payload);
    expect(res1.status).toBe(202);

    // Second request with same requestId should be duplicate
    const res2 = await request
      .post('/api/events/request-closed')
      .set(TEST_AUTH_HEADER)
      .send(payload);
    expect(res2.status).toBe(409);
  });

  it('returns 400 when consent is missing', async () => {
    const payload = createValidPayload();
    (payload.consent as any).automatedCallAllowed = false;

    const res = await request
      .post('/api/events/request-closed')
      .set(TEST_AUTH_HEADER)
      .send(payload);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/events/:id', () => {
  it('returns event by ID', async () => {
    const payload = createValidPayload();
    const createRes = await request
      .post('/api/events/request-closed')
      .set(TEST_AUTH_HEADER)
      .send(payload);

    const eventId = createRes.body.data.eventId;
    const res = await request
      .get(`/api/events/${eventId}`)
      .set(TEST_AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(eventId);
  });

  it('returns 404 for non-existent event', async () => {
    const res = await request
      .get('/api/events/nonexistent-id')
      .set(TEST_AUTH_HEADER);

    expect(res.status).toBe(404);
  });
});
