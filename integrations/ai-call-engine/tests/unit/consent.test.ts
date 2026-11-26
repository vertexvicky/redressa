import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateConsent, addToSuppressionList, isPhoneSuppressed,
  removeFromSuppressionList, clearSuppressionList,
} from '../../packages/backend/src/services/consent.service';

describe('Consent Service', () => {
  beforeEach(() => {
    clearSuppressionList();
  });

  describe('validateConsent', () => {
    it('accepts valid consent', () => {
      expect(validateConsent({ automatedCallAllowed: true, consentReference: 'CONSENT-001' }).valid).toBe(true);
    });

    it('rejects when automatedCallAllowed is false', () => {
      const result = validateConsent({ automatedCallAllowed: false, consentReference: 'CONSENT-001' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not consented');
    });

    it('rejects empty consent reference', () => {
      const result = validateConsent({ automatedCallAllowed: true, consentReference: '' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reference');
    });

    it('rejects whitespace-only consent reference', () => {
      const result = validateConsent({ automatedCallAllowed: true, consentReference: '   ' });
      expect(result.valid).toBe(false);
    });
  });

  describe('Suppression List', () => {
    it('adds and checks phone numbers', () => {
      addToSuppressionList('+919876543210');
      expect(isPhoneSuppressed('+919876543210')).toBe(true);
      expect(isPhoneSuppressed('+919876543211')).toBe(false);
    });

    it('removes phone numbers', () => {
      addToSuppressionList('+919876543210');
      removeFromSuppressionList('+919876543210');
      expect(isPhoneSuppressed('+919876543210')).toBe(false);
    });

    it('clears all entries', () => {
      addToSuppressionList('+919876543210');
      addToSuppressionList('+919876543211');
      clearSuppressionList();
      expect(isPhoneSuppressed('+919876543210')).toBe(false);
      expect(isPhoneSuppressed('+919876543211')).toBe(false);
    });
  });
});
