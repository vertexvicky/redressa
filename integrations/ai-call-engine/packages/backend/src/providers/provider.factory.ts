import { VoiceAIProvider } from '@ai-call-engine/shared';
import { config } from '../config';
import { VapiAdapter } from './vapi/vapi.adapter';
import { MockAdapter } from './mock/mock.adapter';
import { logger } from '../config/logger';

let providerInstance: VoiceAIProvider | null = null;

export function getVoiceProvider(): VoiceAIProvider {
  if (providerInstance) return providerInstance;

  switch (config.voiceProvider) {
    case 'vapi':
      if (!config.vapi.apiKey) {
        throw new Error('VAPI_API_KEY is required when VOICE_PROVIDER=vapi');
      }
      providerInstance = new VapiAdapter({
        provider: 'vapi',
        apiKey: config.vapi.apiKey,
        phoneNumberId: config.vapi.phoneNumberId,
        assistantId: config.vapi.assistantId,
        webhookSecret: config.vapi.webhookSecret,
      });
      break;
    case 'mock':
    default:
      providerInstance = new MockAdapter();
      break;
  }

  logger.info({ provider: providerInstance.getProviderName() }, 'Voice provider initialised');
  return providerInstance;
}

/** For testing: reset the provider singleton */
export function resetVoiceProvider(): void {
  providerInstance = null;
}
