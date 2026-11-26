import { useState, useCallback, useRef, useEffect } from 'react';
import type { AICallConfig, CallState } from '../types';

interface StartCallParams {
  phone: string;
  customerName: string;
  organizationName: string;
  requestId: string;
  resolution: string;
  language?: string;
}

export function useAICall(config: AICallConfig) {
  const [callState, setCallState] = useState<CallState>({
    callId: null,
    status: null,
    error: null,
    isLoading: false,
    duration: null,
    outcome: null,
  });

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const pollCallStatus = useCallback(
    (callId: string) => {
      stopPolling();
      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${config.apiUrl}/api/calls/${callId}`, {
            headers: { Authorization: `Bearer ${config.authToken}` },
          });
          if (!res.ok) return;
          const json = (await res.json()) as { data: { status: string; duration?: number; outcome?: string } };
          if (!mountedRef.current) return;

          const data = json.data;
          const terminalStatuses = ['COMPLETED', 'FAILED', 'NO_ANSWER', 'REJECTED', 'CANCELLED'];

          setCallState(prev => ({
            ...prev,
            status: data.status,
            duration: data.duration ?? prev.duration,
            outcome: data.outcome ?? prev.outcome,
          }));

          if (terminalStatuses.includes(data.status)) {
            stopPolling();
            setCallState(prev => ({ ...prev, isLoading: false }));
          }
        } catch {
          // Ignore polling errors
        }
      }, 3000);
    },
    [config.apiUrl, config.authToken, stopPolling],
  );

  const startCall = useCallback(
    async (params: StartCallParams) => {
      setCallState({
        callId: null,
        status: 'INITIATING',
        error: null,
        isLoading: true,
        duration: null,
        outcome: null,
      });

      try {
        const res = await fetch(`${config.apiUrl}/api/calls`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.authToken}`,
          },
          body: JSON.stringify(params),
        });

        const json = (await res.json()) as {
          data: { id: string; status: string };
          error?: { message?: string };
        };

        if (!res.ok) {
          throw new Error(json.error?.message || 'Failed to start call');
        }

        const callId = json.data.id;
        setCallState(prev => ({
          ...prev,
          callId,
          status: json.data.status,
        }));

        pollCallStatus(callId);
        return callId;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setCallState(prev => ({
          ...prev,
          error: message,
          isLoading: false,
          status: 'FAILED',
        }));
        throw err;
      }
    },
    [config.apiUrl, config.authToken, pollCallStatus],
  );

  const endCall = useCallback(async () => {
    if (!callState.callId) return;

    try {
      await fetch(`${config.apiUrl}/api/calls/${callState.callId}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.authToken}` },
      });

      stopPolling();
      setCallState(prev => ({
        ...prev,
        status: 'CANCELLED',
        isLoading: false,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to end call';
      setCallState(prev => ({ ...prev, error: message }));
    }
  }, [callState.callId, config.apiUrl, config.authToken, stopPolling]);

  const resetState = useCallback(() => {
    stopPolling();
    setCallState({
      callId: null,
      status: null,
      error: null,
      isLoading: false,
      duration: null,
      outcome: null,
    });
  }, [stopPolling]);

  return { callState, startCall, endCall, resetState };
}
