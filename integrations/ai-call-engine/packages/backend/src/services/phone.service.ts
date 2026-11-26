import { validatePhone, validateIndianPhone, maskPhone, INDIAN_PHONE_REGEX } from '@ai-call-engine/shared';

export function validatePhoneForCalling(phone: string): { valid: boolean; error?: string; warnings?: string[] } {
  const basicResult = validatePhone(phone);
  if (!basicResult.valid) return basicResult;

  const warnings: string[] = [];

  if (!INDIAN_PHONE_REGEX.test(phone)) {
    warnings.push('Non-Indian phone number detected. Indian calling may require specific provider configuration.');
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

export function maskPhoneNumber(phone: string): string {
  return maskPhone(phone);
}
