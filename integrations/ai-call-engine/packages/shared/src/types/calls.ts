/** Lifecycle states of an outbound call */
export enum CallStatus {
  RECEIVED = 'RECEIVED',
  VALIDATING = 'VALIDATING',
  QUEUED = 'QUEUED',
  INITIATING = 'INITIATING',
  RINGING = 'RINGING',
  CONNECTED = 'CONNECTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  NO_ANSWER = 'NO_ANSWER',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/** Outcome classification of a completed call */
export enum CallOutcome {
  INFORMED = 'INFORMED',
  ESCALATION_REQUESTED = 'ESCALATION_REQUESTED',
  HUMAN_REQUESTED = 'HUMAN_REQUESTED',
  DISPUTE_RAISED = 'DISPUTE_RAISED',
  UNCLEAR = 'UNCLEAR',
  NO_RESPONSE = 'NO_RESPONSE',
  ERROR = 'ERROR',
}

/** Valid state transitions for the call status machine */
export const VALID_STATUS_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
  [CallStatus.RECEIVED]: [CallStatus.VALIDATING, CallStatus.CANCELLED],
  [CallStatus.VALIDATING]: [CallStatus.QUEUED, CallStatus.FAILED, CallStatus.CANCELLED],
  [CallStatus.QUEUED]: [CallStatus.INITIATING, CallStatus.CANCELLED],
  [CallStatus.INITIATING]: [CallStatus.RINGING, CallStatus.FAILED, CallStatus.CANCELLED],
  [CallStatus.RINGING]: [CallStatus.CONNECTED, CallStatus.NO_ANSWER, CallStatus.REJECTED, CallStatus.FAILED],
  [CallStatus.CONNECTED]: [CallStatus.IN_PROGRESS, CallStatus.FAILED],
  [CallStatus.IN_PROGRESS]: [CallStatus.COMPLETED, CallStatus.FAILED],
  [CallStatus.COMPLETED]: [],
  [CallStatus.FAILED]: [],
  [CallStatus.NO_ANSWER]: [],
  [CallStatus.REJECTED]: [],
  [CallStatus.CANCELLED]: [],
};

/** Check whether a status transition is allowed */
export function isValidTransition(from: CallStatus, to: CallStatus): boolean {
  const allowed = VALID_STATUS_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/** Persisted call record */
export interface CallRecord {
  id: string;
  eventId: string;
  requestId: string;
  maskedPhone: string;
  providerCallId?: string;
  status: CallStatus;
  duration?: number;
  outcome?: CallOutcome;
  startedAt?: string;
  endedAt?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}
