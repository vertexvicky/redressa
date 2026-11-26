import { ConsentInfo } from '@ai-call-engine/shared';
import { logger } from '../config/logger';

/** In-memory suppression list — phones that have opted out of automated calls */
const suppressionList = new Set<string>();

export function validateConsent(consent: ConsentInfo): { valid: boolean; error?: string } {
  if (!consent) return { valid: false, error: 'Consent information is required' };
  if (!consent.automatedCallAllowed) return { valid: false, error: 'Customer has not consented to automated calls' };
  if (!consent.consentReference || consent.consentReference.trim() === '') {
    return { valid: false, error: 'Consent reference is required' };
  }
  return { valid: true };
}

export function addToSuppressionList(phone: string): void {
  suppressionList.add(phone);
  logger.info({ phone: phone.slice(-4) }, 'Phone added to suppression list');
}

export function isPhoneSuppressed(phone: string): boolean {
  return suppressionList.has(phone);
}

export function removeFromSuppressionList(phone: string): void {
  suppressionList.delete(phone);
  logger.info({ phone: phone.slice(-4) }, 'Phone removed from suppression list');
}

export function clearSuppressionList(): void {
  suppressionList.clear();
}
