import { z } from 'zod';

/** Indian mobile numbers: +91 followed by 10 digits starting with 6-9 */
export const INDIAN_PHONE_REGEX = /^\+91[6-9]\d{9}$/;

/** International E.164 phone numbers */
export const INTERNATIONAL_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

export const phoneSchema = z.string().regex(INTERNATIONAL_PHONE_REGEX, 'Phone number must be in E.164 format (e.g. +919876543210)');

export const indianPhoneSchema = z.string().regex(INDIAN_PHONE_REGEX, 'Must be a valid Indian mobile number (+91XXXXXXXXXX)');

/** Mask a phone number, keeping country code prefix and last 4 digits visible */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return phone;
  const last4 = phone.slice(-4);
  const prefix = phone.slice(0, phone.length - 10 > 0 ? phone.length - 10 : 1);
  const masked = 'X'.repeat(phone.length - prefix.length - 4);
  return `${prefix}${masked}${last4}`;
}

/** Validate an Indian mobile phone number */
export function validateIndianPhone(phone: string): { valid: boolean; error?: string } {
  if (!phone) return { valid: false, error: 'Phone number is required' };
  if (!phone.startsWith('+91')) return { valid: false, error: 'Indian numbers must start with +91' };
  if (!INDIAN_PHONE_REGEX.test(phone)) return { valid: false, error: 'Invalid Indian mobile number format. Expected +91 followed by 10 digits starting with 6-9' };
  return { valid: true };
}

/** Validate any E.164 phone number */
export function validatePhone(phone: string): { valid: boolean; error?: string } {
  if (!phone) return { valid: false, error: 'Phone number is required' };
  if (!phone.startsWith('+')) return { valid: false, error: 'Phone number must start with +' };
  if (!INTERNATIONAL_PHONE_REGEX.test(phone)) return { valid: false, error: 'Invalid phone number format. Expected E.164 format (e.g. +919876543210)' };
  return { valid: true };
}
