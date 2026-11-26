/** Standardised API error shape */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

/** Standardised API response wrapper */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

/** Response returned after event ingestion */
export interface EventResponse {
  eventId: string;
  requestId: string;
  status: string;
  message: string;
}

/** Call details returned by the API (phone is always masked) */
export interface CallResponse {
  id: string;
  eventId: string;
  requestId: string;
  maskedPhone: string;
  status: string;
  duration?: number;
  outcome?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
}
