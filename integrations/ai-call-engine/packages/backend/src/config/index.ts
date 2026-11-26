import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env.example') });

export interface AppConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
  apiAuthToken: string;
  voiceProvider: 'vapi' | 'mock';
  vapi: {
    apiKey: string;
    phoneNumberId: string;
    assistantId: string;
    webhookSecret: string;
  };
  defaultLanguage: 'en' | 'hi' | 'ta';
  maxCallDuration: number;
  maxRetryAttempts: number;
  retryDelayBaseMs: number;
  rateLimit: {
    max: number;
    windowMs: number;
  };
  corsOrigin: string;
  databasePath: string;
  demoMode: boolean;
  callbackWebhookUrl: string;
  callbackWebhookSecret: string;
}

function getEnv(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val !== undefined && val !== '') return val;
  if (fallback !== undefined) return fallback;
  return '';
}

export const config: AppConfig = {
  port: parseInt(getEnv('PORT', '4000'), 10),
  nodeEnv: getEnv('NODE_ENV', 'development'),
  logLevel: getEnv('LOG_LEVEL', 'info'),
  apiAuthToken: getEnv('API_AUTH_TOKEN', 'change-me-to-a-secure-random-token'),
  voiceProvider: (getEnv('VOICE_PROVIDER', 'mock') as 'vapi' | 'mock'),
  vapi: {
    apiKey: getEnv('VAPI_API_KEY'),
    phoneNumberId: getEnv('VAPI_PHONE_NUMBER_ID'),
    assistantId: getEnv('VAPI_ASSISTANT_ID'),
    webhookSecret: getEnv('VAPI_WEBHOOK_SECRET'),
  },
  defaultLanguage: (getEnv('DEFAULT_LANGUAGE', 'en') as 'en' | 'hi' | 'ta'),
  maxCallDuration: parseInt(getEnv('MAX_CALL_DURATION', '300'), 10),
  maxRetryAttempts: parseInt(getEnv('MAX_RETRY_ATTEMPTS', '3'), 10),
  retryDelayBaseMs: parseInt(getEnv('RETRY_DELAY_BASE_MS', '5000'), 10),
  rateLimit: {
    max: parseInt(getEnv('RATE_LIMIT_MAX', '100'), 10),
    windowMs: parseInt(getEnv('RATE_LIMIT_WINDOW_MS', '900000'), 10),
  },
  corsOrigin: getEnv('CORS_ORIGIN', 'http://localhost:3000'),
  databasePath: getEnv('DATABASE_PATH', './data/ai-call-engine.sqlite'),
  demoMode: getEnv('DEMO_MODE', 'true') === 'true',
  callbackWebhookUrl: getEnv('CALLBACK_WEBHOOK_URL'),
  callbackWebhookSecret: getEnv('CALLBACK_WEBHOOK_SECRET'),
};
