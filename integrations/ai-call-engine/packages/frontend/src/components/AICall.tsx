import React, { useState, useMemo } from 'react';
import { useAICall } from '../hooks/useAICall';
import type { AICallProps, AICallLabels, AICallColors } from '../types';

const DEFAULT_LABELS: AICallLabels = {
  title: 'AI Call Engine',
  phoneLabel: 'Phone Number',
  phonePlaceholder: 'Enter phone number',
  customerNameLabel: 'Customer Name',
  customerNamePlaceholder: 'Enter customer name',
  organizationLabel: 'Organization',
  organizationPlaceholder: 'Enter organization name',
  requestIdLabel: 'Request ID',
  requestIdPlaceholder: 'e.g. REQ-1024',
  resolutionLabel: 'Resolution',
  resolutionPlaceholder: 'Enter resolution details...',
  startButton: 'Start Call',
  endButton: 'End Call',
  statusLabel: 'Status',
};

const DEFAULT_COLORS: AICallColors = {
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  danger: '#dc2626',
  dangerHover: '#b91c1c',
  background: '#f8fafc',
  surface: '#ffffff',
  text: '#1e293b',
  textSecondary: '#64748b',
  border: '#e2e8f0',
  success: '#16a34a',
  warning: '#d97706',
  error: '#dc2626',
};

const COUNTRY_CODES = [
  { code: '+91', country: 'IN', label: '🇮🇳 +91' },
  { code: '+1', country: 'US', label: '🇺🇸 +1' },
  { code: '+44', country: 'GB', label: '🇬🇧 +44' },
  { code: '+61', country: 'AU', label: '🇦🇺 +61' },
  { code: '+971', country: 'AE', label: '🇦🇪 +971' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ta', label: 'Tamil' },
];

export function AICall({ config, defaultCountryCode = '+91', labels: labelOverrides, colors: colorOverrides, onCallStarted, onCallEnded, onError, className }: AICallProps) {
  const labels = useMemo(() => ({ ...DEFAULT_LABELS, ...labelOverrides }), [labelOverrides]);
  const colors = useMemo(() => ({ ...DEFAULT_COLORS, ...colorOverrides }), [colorOverrides]);
  const { callState, startCall, endCall, resetState } = useAICall(config);

  const [countryCode, setCountryCode] = useState(defaultCountryCode);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [organization, setOrganization] = useState('');
  const [requestId, setRequestId] = useState('');
  const [resolution, setResolution] = useState('');
  const [language, setLanguage] = useState('en');

  const isActive = callState.status !== null && !['COMPLETED', 'FAILED', 'NO_ANSWER', 'REJECTED', 'CANCELLED'].includes(callState.status);

  const handleStartCall = async () => {
    const fullPhone = `${countryCode}${phoneNumber}`;
    try {
      const callId = await startCall({
        phone: fullPhone,
        customerName,
        organizationName: organization,
        requestId,
        resolution,
        language,
      });
      if (callId && onCallStarted) onCallStarted(callId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start call';
      if (onError) onError(msg);
    }
  };

  const handleEndCall = async () => {
    await endCall();
    if (callState.callId && onCallEnded) onCallEnded(callState.callId, callState.outcome ?? undefined);
  };

  const handleReset = () => {
    resetState();
    setPhoneNumber('');
    setCustomerName('');
    setOrganization('');
    setRequestId('');
    setResolution('');
  };

  const getStatusColor = (status: string | null): string => {
    if (!status) return colors.textSecondary;
    const map: Record<string, string> = {
      INITIATING: colors.warning, RINGING: colors.warning, CONNECTED: colors.success,
      IN_PROGRESS: colors.success, COMPLETED: colors.success, QUEUED: colors.warning,
      FAILED: colors.error, NO_ANSWER: colors.error, REJECTED: colors.error, CANCELLED: colors.textSecondary,
    };
    return map[status] || colors.textSecondary;
  };

  // ── Inline styles ──
  const styles = {
    container: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: '480px',
      margin: '0 auto',
      backgroundColor: colors.surface,
      borderRadius: '12px',
      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
      border: `1px solid ${colors.border}`,
      overflow: 'hidden',
    } as React.CSSProperties,
    header: {
      padding: '20px 24px',
      borderBottom: `1px solid ${colors.border}`,
      backgroundColor: colors.background,
    } as React.CSSProperties,
    title: {
      margin: 0,
      fontSize: '18px',
      fontWeight: 600,
      color: colors.text,
    } as React.CSSProperties,
    body: { padding: '24px' } as React.CSSProperties,
    fieldGroup: { marginBottom: '16px' } as React.CSSProperties,
    label: {
      display: 'block',
      fontSize: '13px',
      fontWeight: 500,
      color: colors.textSecondary,
      marginBottom: '6px',
    } as React.CSSProperties,
    input: {
      width: '100%',
      padding: '10px 12px',
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      fontSize: '14px',
      color: colors.text,
      backgroundColor: colors.surface,
      outline: 'none',
      boxSizing: 'border-box' as const,
      transition: 'border-color 0.2s',
    } as React.CSSProperties,
    phoneRow: {
      display: 'flex',
      gap: '8px',
    } as React.CSSProperties,
    select: {
      padding: '10px 8px',
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      fontSize: '14px',
      color: colors.text,
      backgroundColor: colors.surface,
      outline: 'none',
      cursor: 'pointer',
    } as React.CSSProperties,
    textarea: {
      width: '100%',
      padding: '10px 12px',
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      fontSize: '14px',
      color: colors.text,
      backgroundColor: colors.surface,
      outline: 'none',
      boxSizing: 'border-box' as const,
      minHeight: '80px',
      resize: 'vertical' as const,
      fontFamily: 'inherit',
    } as React.CSSProperties,
    buttonRow: {
      display: 'flex',
      gap: '12px',
      marginTop: '20px',
    } as React.CSSProperties,
    primaryButton: {
      flex: 1,
      padding: '12px',
      backgroundColor: colors.primary,
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'background-color 0.2s',
    } as React.CSSProperties,
    dangerButton: {
      flex: 1,
      padding: '12px',
      backgroundColor: colors.danger,
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'background-color 0.2s',
    } as React.CSSProperties,
    disabledButton: {
      opacity: 0.5,
      cursor: 'not-allowed',
    } as React.CSSProperties,
    statusSection: {
      marginTop: '20px',
      padding: '16px',
      backgroundColor: colors.background,
      borderRadius: '8px',
      border: `1px solid ${colors.border}`,
    } as React.CSSProperties,
    statusBadge: (color: string) => ({
      display: 'inline-block',
      padding: '4px 12px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: 600,
      color: '#fff',
      backgroundColor: color,
    }) as React.CSSProperties,
    errorBox: {
      marginTop: '12px',
      padding: '12px',
      backgroundColor: '#fef2f2',
      border: '1px solid #fecaca',
      borderRadius: '8px',
      color: colors.error,
      fontSize: '13px',
    } as React.CSSProperties,
    infoRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: '8px',
      fontSize: '13px',
      color: colors.textSecondary,
    } as React.CSSProperties,
    spinner: {
      display: 'inline-block',
      width: '16px',
      height: '16px',
      border: '2px solid #e2e8f0',
      borderTopColor: colors.primary,
      borderRadius: '50%',
      animation: 'aicall-spin 0.8s linear infinite',
      marginRight: '8px',
      verticalAlign: 'middle',
    } as React.CSSProperties,
  };

  const isFormValid = phoneNumber.length >= 6 && customerName.trim() && organization.trim() && requestId.trim() && resolution.trim();

  return (
    <div style={styles.container} className={className} role="region" aria-label={labels.title}>
      {/* Spinner keyframe */}
      <style>{`@keyframes aicall-spin { to { transform: rotate(360deg); } }`}</style>

      <div style={styles.header}>
        <h2 style={styles.title}>{labels.title}</h2>
      </div>

      <div style={styles.body}>
        {/* Phone Number */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>{labels.phoneLabel}</label>
          <div style={styles.phoneRow}>
            <select
              style={styles.select}
              value={countryCode}
              onChange={e => setCountryCode(e.target.value)}
              disabled={isActive || callState.isLoading}
              aria-label="Country code"
            >
              {COUNTRY_CODES.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <input
              style={{ ...styles.input, flex: 1 }}
              type="tel"
              placeholder={labels.phonePlaceholder}
              value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
              disabled={isActive || callState.isLoading}
              aria-label={labels.phoneLabel}
            />
          </div>
        </div>

        {/* Customer Name */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>{labels.customerNameLabel}</label>
          <input
            style={styles.input}
            type="text"
            placeholder={labels.customerNamePlaceholder}
            value={customerName}
            onChange={e => setCustomerName(e.target.value)}
            disabled={isActive || callState.isLoading}
          />
        </div>

        {/* Organization */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>{labels.organizationLabel}</label>
          <input
            style={styles.input}
            type="text"
            placeholder={labels.organizationPlaceholder}
            value={organization}
            onChange={e => setOrganization(e.target.value)}
            disabled={isActive || callState.isLoading}
          />
        </div>

        {/* Request ID */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>{labels.requestIdLabel}</label>
          <input
            style={styles.input}
            type="text"
            placeholder={labels.requestIdPlaceholder}
            value={requestId}
            onChange={e => setRequestId(e.target.value)}
            disabled={isActive || callState.isLoading}
          />
        </div>

        {/* Resolution */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>{labels.resolutionLabel}</label>
          <textarea
            style={styles.textarea}
            placeholder={labels.resolutionPlaceholder}
            value={resolution}
            onChange={e => setResolution(e.target.value)}
            disabled={isActive || callState.isLoading}
          />
        </div>

        {/* Language */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Language</label>
          <select
            style={{ ...styles.select, width: '100%' }}
            value={language}
            onChange={e => setLanguage(e.target.value)}
            disabled={isActive || callState.isLoading}
            aria-label="Language"
          >
            {LANGUAGES.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        {/* Buttons */}
        <div style={styles.buttonRow}>
          {!isActive && callState.status === null ? (
            <button
              style={{
                ...styles.primaryButton,
                ...(!isFormValid || callState.isLoading ? styles.disabledButton : {}),
              }}
              onClick={handleStartCall}
              disabled={!isFormValid || callState.isLoading}
              aria-label={labels.startButton}
            >
              {callState.isLoading && <span style={styles.spinner} />}
              {labels.startButton}
            </button>
          ) : isActive ? (
            <button
              style={styles.dangerButton}
              onClick={handleEndCall}
              aria-label={labels.endButton}
            >
              {labels.endButton}
            </button>
          ) : (
            <button
              style={styles.primaryButton}
              onClick={handleReset}
              aria-label="New Call"
            >
              New Call
            </button>
          )}
        </div>

        {/* Status Display */}
        {callState.status && (
          <div style={styles.statusSection}>
            <div style={styles.infoRow}>
              <span>{labels.statusLabel}</span>
              <span style={styles.statusBadge(getStatusColor(callState.status))}>
                {callState.status}
              </span>
            </div>
            {callState.callId && (
              <div style={styles.infoRow}>
                <span>Call ID</span>
                <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{callState.callId.slice(0, 8)}…</span>
              </div>
            )}
            {callState.duration !== null && (
              <div style={styles.infoRow}>
                <span>Duration</span>
                <span>{callState.duration}s</span>
              </div>
            )}
            {callState.outcome && (
              <div style={styles.infoRow}>
                <span>Outcome</span>
                <span>{callState.outcome}</span>
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {callState.error && (
          <div style={styles.errorBox} role="alert">
            ⚠️ {callState.error}
          </div>
        )}
      </div>
    </div>
  );
}
