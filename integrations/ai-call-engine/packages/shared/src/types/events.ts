/** Event types supported by the AI Call Engine */
export enum EventType {
  REQUEST_CLOSED = 'REQUEST_CLOSED',
}

/** Processing status of an event */
export enum EventStatus {
  RECEIVED = 'RECEIVED',
  VALIDATING = 'VALIDATING',
  VALIDATED = 'VALIDATED',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DUPLICATE = 'DUPLICATE',
}

/** Customer contact information */
export interface CustomerInfo {
  name: string;
  phone: string;
}

/** Request details from the external application */
export interface RequestInfo {
  title: string;
  status: string;
  resolution: string;
}

/** Customer consent for automated calling */
export interface ConsentInfo {
  automatedCallAllowed: boolean;
  consentReference: string;
}

/** Metadata about the event */
export interface EventMetadata {
  organization: string;
  closedAt: string;
  closedBy?: string;
  language?: 'en' | 'hi' | 'ta';
}

/** Payload for a REQUEST_CLOSED event from the external application */
export interface RequestClosedEvent {
  event: EventType;
  requestId: string;
  customer: CustomerInfo;
  request: RequestInfo;
  metadata: EventMetadata;
  consent: ConsentInfo;
}

/** Persisted event record */
export interface EventRecord {
  id: string;
  requestId: string;
  eventType: EventType;
  status: EventStatus;
  payload: RequestClosedEvent;
  callId?: string;
  failureReason?: string;
  idempotencyKey: string;
  createdAt: string;
  processedAt?: string;
}
