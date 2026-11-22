export type AlertMetric = 'temperature' | 'humidity' | 'airPressure';

export type AlertOperator = 'lt' | 'gt';

export type AlertLogic = 'and' | 'or';

export type AlertCondition = {
  metric: AlertMetric;
  operator: AlertOperator;
  value: number;
};

export type DeviceAlert = {
  id: string;
  serial: number;
  teamId: string;
  name: string;
  enabled: boolean;
  logic: AlertLogic;
  conditions: AlertCondition[];
  integrationIds: string[];
  /** Minutes between repeated notifications while the alert stays firing. */
  repeatIntervalMinutes: number;
  /** Whether the rule matched the most recently evaluated reading. */
  firing: boolean;
  lastTriggeredAt?: Date;
  lastNotifiedAt?: Date;
  /** Webhook delivery is suppressed until this instant. */
  mutedUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AlertListPayload = {
  alerts: DeviceAlert[];
};

export type AlertPayload = {
  alert: DeviceAlert;
};

export type AlertCreateRequest = {
  name: string;
  enabled?: boolean;
  logic: AlertLogic;
  conditions: AlertCondition[];
  integrationIds: string[];
  repeatIntervalMinutes: number;
  mutedUntil?: Date | null;
};

export type AlertUpdateRequest = Partial<AlertCreateRequest>;

/** Outcome of delivering a test notification to one configured integration. */
export type AlertTestResult = {
  integrationId: string;
  ok: boolean;
  status?: number;
  error?: string;
};

export type AlertTestPayload = {
  results: AlertTestResult[];
};

export const ALERT_METRICS: readonly AlertMetric[] = ['temperature', 'humidity', 'airPressure'];

export const ALERT_OPERATORS: readonly AlertOperator[] = ['lt', 'gt'];

export const ALERT_LOGIC: readonly AlertLogic[] = ['and', 'or'];

export const ALERT_MAX_CONDITIONS = 6;
export const ALERT_MIN_REPEAT_MINUTES = 1;
export const ALERT_MAX_REPEAT_MINUTES = 10_080;
export const ALERT_NAME_MAX_LENGTH = 64;
