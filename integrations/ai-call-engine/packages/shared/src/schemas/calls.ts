import { z } from 'zod';

export const manualCallRequestSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Invalid phone number'),
  customerName: z.string().min(1, 'Customer name is required'),
  organizationName: z.string().min(1, 'Organization name is required'),
  requestId: z.string().min(1, 'Request ID is required'),
  resolution: z.string().min(1, 'Resolution is required'),
  language: z.enum(['en', 'hi', 'ta']).default('en'),
});

export type ManualCallRequestInput = z.infer<typeof manualCallRequestSchema>;

export const callIdParamSchema = z.object({
  id: z.string().min(1, 'Call ID is required'),
});
