import { describe, it, expect } from 'vitest';
import {
  validatePhone, validateIndianPhone, maskPhone,
  INDIAN_PHONE_REGEX, INTERNATIONAL_PHONE_REGEX,
} from '../../packages/shared/src/schemas/phone';

describe('Phone Validation', () => {
  describe('validateIndianPhone', () => {
    it('accepts valid Indian mobile numbers', () => {
      expect(validateIndianPhone('+919876543210').valid).toBe(true);
      expect(validateIndianPhone('+916000000000').valid).toBe(true);
      expect(validateIndianPhone('+917999999999').valid).toBe(true);
      expect(validateIndianPhone('+918123456789').valid).toBe(true);
    });

    it('rejects numbers not starting with +91', () => {
      expect(validateIndianPhone('9876543210').valid).toBe(false);
      expect(validateIndianPhone('+19876543210').valid).toBe(false);
    });

    it('rejects numbers starting with 0-5 after +91', () => {
      expect(validateIndianPhone('+910123456789').valid).toBe(false);
      expect(validateIndianPhone('+915123456789').valid).toBe(false);
    });

    it('rejects wrong length', () => {
      expect(validateIndianPhone('+9198765432').valid).toBe(false);
      expect(validateIndianPhone('+9198765432101').valid).toBe(false);
    });

    it('rejects empty input', () => {
      expect(validateIndianPhone('').valid).toBe(false);
    });
  });

  describe('validatePhone', () => {
    it('accepts valid international numbers', () => {
      expect(validatePhone('+919876543210').valid).toBe(true);
      expect(validatePhone('+14155551234').valid).toBe(true);
      expect(validatePhone('+442071234567').valid).toBe(true);
    });

    it('rejects numbers without +', () => {
      expect(validatePhone('919876543210').valid).toBe(false);
    });

    it('rejects too short numbers', () => {
      expect(validatePhone('+1234').valid).toBe(false);
    });

    it('rejects empty input', () => {
      expect(validatePhone('').valid).toBe(false);
    });
  });

  describe('maskPhone', () => {
    it('masks Indian numbers correctly', () => {
      const masked = maskPhone('+919876543210');
      expect(masked).toContain('3210');
      expect(masked).toContain('X');
      expect(masked.startsWith('+')).toBe(true);
    });

    it('masks international numbers correctly', () => {
      const masked = maskPhone('+14155551234');
      expect(masked).toContain('1234');
      expect(masked).toContain('X');
    });

    it('handles short numbers gracefully', () => {
      expect(maskPhone('+1234')).toBe('+1234');
    });

    it('handles empty string', () => {
      expect(maskPhone('')).toBe('');
    });
  });

  describe('regex patterns', () => {
    it('INDIAN_PHONE_REGEX matches valid Indian numbers', () => {
      expect(INDIAN_PHONE_REGEX.test('+919876543210')).toBe(true);
      expect(INDIAN_PHONE_REGEX.test('+911234567890')).toBe(false);
    });

    it('INTERNATIONAL_PHONE_REGEX matches valid international numbers', () => {
      expect(INTERNATIONAL_PHONE_REGEX.test('+919876543210')).toBe(true);
      expect(INTERNATIONAL_PHONE_REGEX.test('+14155551234')).toBe(true);
      expect(INTERNATIONAL_PHONE_REGEX.test('9876543210')).toBe(false);
    });
  });
});
