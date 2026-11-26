export interface AICallConfig {
  apiUrl: string;
  authToken: string;
}

export interface AICallProps {
  config: AICallConfig;
  defaultCountryCode?: string;
  labels?: Partial<AICallLabels>;
  colors?: Partial<AICallColors>;
  onCallStarted?: (callId: string) => void;
  onCallEnded?: (callId: string, outcome?: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

export interface AICallLabels {
  title: string;
  phoneLabel: string;
  phonePlaceholder: string;
  customerNameLabel: string;
  customerNamePlaceholder: string;
  organizationLabel: string;
  organizationPlaceholder: string;
  requestIdLabel: string;
  requestIdPlaceholder: string;
  resolutionLabel: string;
  resolutionPlaceholder: string;
  startButton: string;
  endButton: string;
  statusLabel: string;
}

export interface AICallColors {
  primary: string;
  primaryHover: string;
  danger: string;
  dangerHover: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
}

export interface CallState {
  callId: string | null;
  status: string | null;
  error: string | null;
  isLoading: boolean;
  duration: number | null;
  outcome: string | null;
}
