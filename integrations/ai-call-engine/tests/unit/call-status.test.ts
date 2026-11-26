import { describe, it, expect } from 'vitest';
import { CallStatus, isValidTransition, VALID_STATUS_TRANSITIONS } from '../../packages/shared/src/types/calls';

describe('Call Status Transitions', () => {
  it('allows RECEIVED -> VALIDATING', () => {
    expect(isValidTransition(CallStatus.RECEIVED, CallStatus.VALIDATING)).toBe(true);
  });

  it('allows RECEIVED -> CANCELLED', () => {
    expect(isValidTransition(CallStatus.RECEIVED, CallStatus.CANCELLED)).toBe(true);
  });

  it('allows VALIDATING -> QUEUED', () => {
    expect(isValidTransition(CallStatus.VALIDATING, CallStatus.QUEUED)).toBe(true);
  });

  it('allows QUEUED -> INITIATING', () => {
    expect(isValidTransition(CallStatus.QUEUED, CallStatus.INITIATING)).toBe(true);
  });

  it('allows INITIATING -> RINGING', () => {
    expect(isValidTransition(CallStatus.INITIATING, CallStatus.RINGING)).toBe(true);
  });

  it('allows RINGING -> CONNECTED', () => {
    expect(isValidTransition(CallStatus.RINGING, CallStatus.CONNECTED)).toBe(true);
  });

  it('allows CONNECTED -> IN_PROGRESS', () => {
    expect(isValidTransition(CallStatus.CONNECTED, CallStatus.IN_PROGRESS)).toBe(true);
  });

  it('allows IN_PROGRESS -> COMPLETED', () => {
    expect(isValidTransition(CallStatus.IN_PROGRESS, CallStatus.COMPLETED)).toBe(true);
  });

  it('disallows COMPLETED -> anything', () => {
    expect(isValidTransition(CallStatus.COMPLETED, CallStatus.INITIATING)).toBe(false);
    expect(isValidTransition(CallStatus.COMPLETED, CallStatus.RECEIVED)).toBe(false);
  });

  it('disallows FAILED -> anything', () => {
    expect(isValidTransition(CallStatus.FAILED, CallStatus.RECEIVED)).toBe(false);
  });

  it('disallows backward transitions', () => {
    expect(isValidTransition(CallStatus.IN_PROGRESS, CallStatus.RECEIVED)).toBe(false);
    expect(isValidTransition(CallStatus.RINGING, CallStatus.QUEUED)).toBe(false);
  });

  it('allows failure from most active states', () => {
    expect(isValidTransition(CallStatus.VALIDATING, CallStatus.FAILED)).toBe(true);
    expect(isValidTransition(CallStatus.INITIATING, CallStatus.FAILED)).toBe(true);
    expect(isValidTransition(CallStatus.RINGING, CallStatus.FAILED)).toBe(true);
    expect(isValidTransition(CallStatus.CONNECTED, CallStatus.FAILED)).toBe(true);
    expect(isValidTransition(CallStatus.IN_PROGRESS, CallStatus.FAILED)).toBe(true);
  });

  it('all terminal states have empty transition arrays', () => {
    const terminalStates = [CallStatus.COMPLETED, CallStatus.FAILED, CallStatus.NO_ANSWER, CallStatus.REJECTED, CallStatus.CANCELLED];
    for (const state of terminalStates) {
      expect(VALID_STATUS_TRANSITIONS[state]).toEqual([]);
    }
  });
});
