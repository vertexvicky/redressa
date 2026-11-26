import { z } from 'zod';

export const customerInfoSchema = z.object({
  name: z.string().min(1, 'Customer name is required'),
  phone: z.string().min(1, 'Phone number is required').regex(/^\+[1-9]\d{6,14}$/, 'Invalid phone number format'),
});

export const requestInfoSchema = z.object({
  title: z.string().min(1, 'Request title is required'),
  status: z.literal('CLOSED', { errorMap: () => ({ message: 'Request status must be CLOSED' }) }),
  resolution: z.string().min(1, 'Resolution is required'),
});

export const consentInfoSchema = z.object({
  automatedCallAllowed: z.literal(true, {
    errorMap: () => ({ message: 'Automated call consent must be true' }),
  }),
  consentReference: z.string().min(1, 'Consent reference is required'),
});

export const eventMetadataSchema = z.object({
  organization: z.string().min(1, 'Organization name is required'),
  closedAt: z.string().min(1, 'Closed-at timestamp is required'),
  closedBy: z.string().optional(),
  language: z.enum(['en', 'hi', 'ta']).optional(),
});

export const requestClosedEventSchema = z.object({
  event: z.literal('REQUEST_CLOSED', {
    errorMap: () => ({ message: 'Event type must be REQUEST_CLOSED' }),
  }),
  requestId: z.string().min(1, 'Request ID is required'),
  customer: customerInfoSchema,
  request: requestInfoSchema,
  metadata: eventMetadataSchema,
  consent: consentInfoSchema,
});

export type RequestClosedEventInput = z.infer<typeof requestClosedEventSchema>;
