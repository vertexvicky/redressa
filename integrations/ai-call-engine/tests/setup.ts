import { beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.API_AUTH_TOKEN = 'test-secret-token';
process.env.VOICE_PROVIDER = 'mock';
process.env.DEMO_MODE = 'true';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_PATH = ':memory:';
process.env.CORS_ORIGIN = '*';
process.env.DEFAULT_LANGUAGE = 'en';
process.env.MAX_CALL_DURATION = '300';
process.env.MAX_RETRY_ATTEMPTS = '3';
process.env.RETRY_DELAY_BASE_MS = '100';
process.env.RATE_LIMIT_MAX = '1000';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
