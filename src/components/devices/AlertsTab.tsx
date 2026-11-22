import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconAlertCircle,
  IconBell,
  IconBellOff,
  IconCheck,
  IconClock,
  IconCopy,
  IconEdit,
  IconSend,
  IconTrash,
} from '@tabler/icons-react';
import type {
  AlertCondition,
  AlertLogic,
  AlertMetric,
  AlertOperator,
  DeviceAlert,
  Integration,
} from '@common';
import { api } from '../../lib/api';
import type { AlertTestResult } from '../../lib/api/alerts';
import { toDate } from '../../lib/date';
import { formatDeviceRelativeTime } from '../../lib/deviceActivity';
import type { AlertRouteAction } from '../../lib/dashboardRoutes';
import { Button, Checkbox, ConfirmDialog, Input, Select, Tooltip } from '../common';
import './AlertsTab.css';

const METRIC_OPTIONS: { value: AlertMetric; label: string }[] = [
  { value: 'temperature', label: 'Temperature' },
  { value: 'humidity', label: 'Humidity' },
  { value: 'airPressure', label: 'Pressure' },
];

const OPERATOR_OPTIONS: { value: AlertOperator; label: string }[] = [
  { value: 'lt', label: 'is below' },
  { value: 'gt', label: 'is above' },
];

const REPEAT_OPTIONS = [
  { value: '1', label: 'Every minute' },
  { value: '5', label: 'Every 5 minutes' },
  { value: '10', label: 'Every 10 minutes' },
  { value: '15', label: 'Every 15 minutes' },
  { value: '30', label: 'Every 30 minutes' },
  { value: '60', label: 'Every hour' },
  { value: '180', label: 'Every 3 hours' },
  { value: '360', label: 'Every 6 hours' },
  { value: '720', label: 'Every 12 hours' },
  { value: '1440', label: 'Every day' },
];

const METRIC_META: Record<AlertMetric, { label: string; unit: string }> = {
  temperature: { label: 'Temperature', unit: '°C' },
  humidity: { label: 'Humidity', unit: '%' },
  airPressure: { label: 'Pressure', unit: 'hPa' },
};

function repeatLabel(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min while firing`;
  if (minutes === 60) return 'Every hour while firing';
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `Every ${days === 1 ? 'day' : `${days} days`} while firing`;
  }
  const hours = minutes / 60;
  return `Every ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours while firing`;
}

function conditionText(condition: AlertCondition): string {
  const meta = METRIC_META[condition.metric];
  return `${meta.label} ${condition.operator === 'lt' ? 'below' : 'above'} ${condition.value} ${meta.unit}`;
}

/** Local alias keeps mute handling explicit and tolerant of ISO-string revivals. */
type AlertWithMute = DeviceAlert & { mutedUntil?: Date | null };
type AlertStatusFilter = 'all' | 'firing' | 'idle' | 'disabled' | 'muted';
type AlertStatus = Exclude<AlertStatusFilter, 'all'>;

const STATUS_LABELS: Record<AlertStatus, string> = {
  firing: 'Firing',
  idle: 'Idle',
  disabled: 'Disabled',
  muted: 'Muted',
};

function activeMuteUntil(alert: AlertWithMute): Date | null {
  if (!alert.mutedUntil) return null;
  const until = toDate(alert.mutedUntil);
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return null;
  return until;
}

function alertStatus(alert: AlertWithMute): AlertStatus {
  if (activeMuteUntil(alert)) return 'muted';
  if (!alert.enabled) return 'disabled';
  return alert.firing ? 'firing' : 'idle';
}

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard is unavailable');
}

type DraftCondition = {
  metric: AlertMetric;
  operator: AlertOperator;
  value: string;
};

type Draft = {
  name: string;
  enabled: boolean;
  logic: AlertLogic;
  conditions: DraftCondition[];
  integrationIds: string[];
  repeatIntervalMinutes: number;
};

const emptyDraft: Draft = {
  name: '',
  enabled: true,
  logic: 'and',
  conditions: [{ metric: 'temperature', operator: 'gt', value: '30' }],
  integrationIds: [],
  repeatIntervalMinutes: 15,
};

function toDraft(alert: DeviceAlert): Draft {
  return {
    name: alert.name,
    enabled: alert.enabled,
    logic: alert.logic,
    conditions: alert.conditions.map((condition) => ({
      metric: condition.metric,
      operator: condition.operator,
      value: String(condition.value),
    })),
    integrationIds: [...alert.integrationIds],
    repeatIntervalMinutes: alert.repeatIntervalMinutes,
  };
}

export type AlertFormRoute = {
  alertId?: string;
  action?: AlertRouteAction;
};

type Props = {
  serial: number;
  deviceName: string;
  canManage: boolean;
  onNavigate?: (tab: string) => void;
  /** The alert form is driven by the dashboard URL when provided. */
  route?: AlertFormRoute | null;
  onRouteChange?: (route: AlertFormRoute) => void;
};

export function AlertsTab({ serial, deviceName, canManage, onNavigate, route, onRouteChange }: Props) {
  const [alerts, setAlerts] = useState<AlertWithMute[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>('all');
  const [duplicateSourceId, setDuplicateSourceId] = useState<string | null>(null);
  const [muteMenuId, setMuteMenuId] = useState<string | null>(null);
  const [customMuteValue, setCustomMuteValue] = useState('');
  const [mutingId, setMutingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, AlertTestResult[]>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formAction = route?.action;
  const formAlertId = formAction === 'edit' ? route?.alertId : undefined;
  const editing = formAction === 'edit'
    ? alerts.find((alert) => alert.id === formAlertId) ?? null
    : null;
  const showForm = Boolean(formAction);
  const duplicateSource = formAction === 'new' && duplicateSourceId
    ? alerts.find((alert) => alert.id === duplicateSourceId) ?? null
    : null;
  const draftKey = duplicateSource
    ? `duplicate:${duplicateSource.id}`
    : formAction === 'new'
      ? `new:${serial}`
      : formAction === 'edit'
        ? `edit:${formAlertId}`
        : 'none';

  const createDraft = useMemo<Draft>(() => ({
    ...emptyDraft,
    integrationIds: integrations
      .filter((integration) => integration.enabled)
      .slice(0, 1)
      .map((integration) => integration.id),
  }), [integrations]);
  const baseDraft = editing
    ? toDraft(editing)
    : duplicateSource
      ? { ...toDraft(duplicateSource), name: `${duplicateSource.name} (copy)`, enabled: false }
      : createDraft;
  const [draftOverride, setDraftOverride] = useState<{ key: string; draft: Draft } | null>(null);
  const draft = draftOverride?.key === draftKey ? draftOverride.draft : baseDraft;
  const setDraft = (updater: (current: Draft) => Draft) => {
    setDraftOverride({ key: draftKey, draft: updater(draft) });
  };

  const [formErrorState, setFormErrorState] = useState<{ key: string; message: string | null }>({ key: '', message: null });
  const formError = formErrorState.key === draftKey ? formErrorState.message : null;
  const setFormError = (message: string | null) => {
    setFormErrorState({ key: draftKey, message });
  };

  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DeviceAlert | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [alertList, integrationList] = await Promise.all([
          api.alerts.list(serial),
          api.integrations.listMine().catch(() => [] as Integration[]),
        ]);
        if (cancelled) return;
        setAlerts(alertList);
        setIntegrations(integrationList);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load alerts');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serial]);

  // Keep firing status fresh while the tab stays open.
  useEffect(() => {
    const interval = setInterval(() => {
      void api.alerts
        .list(serial)
        .then((list) => setAlerts(list))
        .catch(() => {
          // Silent refresh; the next poll or action surfaces errors.
        });
    }, 30_000);

    return () => clearInterval(interval);
  }, [serial]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const integrationsById = useMemo(
    () => new Map(integrations.map((integration) => [integration.id, integration])),
    [integrations],
  );

  const visibleAlerts = useMemo(
    () => alerts.filter((alert) => statusFilter === 'all' || alertStatus(alert) === statusFilter),
    [alerts, statusFilter],
  );

  const clearForm = () => {
    setDraftOverride(null);
    setFormError(null);
    setDuplicateSourceId(null);
    onRouteChange?.({});
  };

  const openCreate = () => {
    setDraftOverride(null);
    setFormError(null);
    setDuplicateSourceId(null);
    onRouteChange?.({ action: 'new' });
  };

  const openEdit = (alert: AlertWithMute) => {
    setDraftOverride(null);
    setFormError(null);
    setDuplicateSourceId(null);
    onRouteChange?.({ alertId: alert.id, action: 'edit' });
  };

  const openDuplicate = (alert: AlertWithMute) => {
    setDraftOverride(null);
    setFormError(null);
    setMuteMenuId(null);
    setDuplicateSourceId(alert.id);
    onRouteChange?.({ action: 'new' });
  };

  const toggleMuteMenu = (alert: AlertWithMute) => {
    if (muteMenuId === alert.id) {
      setMuteMenuId(null);
      return;
    }
    setCustomMuteValue(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
    setMuteMenuId(alert.id);
  };

  const updateMute = async (alert: AlertWithMute, mutedUntil: string | null) => {
    setMutingId(alert.id);
    setError(null);
    try {
      const updated = await api.alerts.update(serial, alert.id, { mutedUntil });
      setAlerts((current) => current.map((item) => (item.id === alert.id ? updated : item)));
      setMuteMenuId(null);
      setCustomMuteValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update alert mute');
    } finally {
      setMutingId(null);
    }
  };

  const muteFor = (alert: AlertWithMute, hours: number) => {
    void updateMute(alert, new Date(Date.now() + hours * 60 * 60 * 1000).toISOString());
  };

  const muteCustom = (alert: AlertWithMute) => {
    const until = new Date(customMuteValue);
    if (!customMuteValue || Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
      setError('Choose a mute expiry in the future.');
      return;
    }
    void updateMute(alert, until.toISOString());
  };

  const handleTest = async (alert: AlertWithMute) => {
    setTestingId(alert.id);
    setError(null);
    setTestResults((current) => {
      const next = { ...current };
      delete next[alert.id];
      return next;
    });
    try {
      const results = await api.alerts.testAlert(serial, alert.id);
      setTestResults((current) => ({ ...current, [alert.id]: results }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test alert');
    } finally {
      setTestingId(null);
    }
  };

  const handleCopyRule = async (alert: AlertWithMute) => {
    try {
      await copyText(JSON.stringify(alert, null, 2));
      setCopiedId(alert.id);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError('Unable to copy alert rule');
    }
  };

  const updateCondition = (index: number, patch: Partial<DraftCondition>) => {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, i) =>
        i === index ? { ...condition, ...patch } : condition,
      ),
    }));
  };

  const addCondition = () => {
    setDraft((current) => ({
      ...current,
      conditions: [
        ...current.conditions,
        { metric: 'humidity', operator: 'gt', value: '60' },
      ],
    }));
  };

  const removeCondition = (index: number) => {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.filter((_, i) => i !== index),
    }));
  };

  const toggleIntegration = (id: string, selected: boolean) => {
    setDraft((current) => ({
      ...current,
      integrationIds: selected
        ? [...current.integrationIds, id]
        : current.integrationIds.filter((currentId) => currentId !== id),
    }));
  };

  const repeatOptions = useMemo(() => {
    if (REPEAT_OPTIONS.some((option) => Number(option.value) === draft.repeatIntervalMinutes)) {
      return REPEAT_OPTIONS;
    }
    return [
      ...REPEAT_OPTIONS,
      { value: String(draft.repeatIntervalMinutes), label: repeatLabel(draft.repeatIntervalMinutes) },
    ].sort((a, b) => Number(a.value) - Number(b.value));
  }, [draft.repeatIntervalMinutes]);

  const handleSave = async () => {
    const name = draft.name.trim();
    if (!name) {
      setFormError('Give the alert a name');
      return;
    }
    if (draft.conditions.length === 0) {
      setFormError('Add at least one condition');
      return;
    }

    const conditions: AlertCondition[] = [];
    for (const condition of draft.conditions) {
      if (condition.value.trim() === '') {
        setFormError('Every condition needs a value');
        return;
      }
      const value = Number(condition.value);
      if (!Number.isFinite(value)) {
        setFormError('Condition values must be numbers');
        return;
      }
      conditions.push({ metric: condition.metric, operator: condition.operator, value });
    }

    setIsSaving(true);
    setFormError(null);

    try {
      if (editing) {
        const updated = await api.alerts.update(serial, editing.id, {
          name,
          enabled: draft.enabled,
          logic: draft.logic,
          conditions,
          integrationIds: draft.integrationIds,
          repeatIntervalMinutes: draft.repeatIntervalMinutes,
        });
        setAlerts((current) => current.map((alert) => (alert.id === editing.id ? updated : alert)));
      } else {
        const created = await api.alerts.create(serial, {
          name,
          enabled: draft.enabled,
          logic: draft.logic,
          conditions,
          integrationIds: draft.integrationIds,
          repeatIntervalMinutes: draft.repeatIntervalMinutes,
        });
        setAlerts((current) => [created, ...current]);
      }
      clearForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save alert');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = async (alert: DeviceAlert, enabled: boolean) => {
    setBusyId(alert.id);
    setError(null);
    try {
      const updated = await api.alerts.update(serial, alert.id, { enabled });
      setAlerts((current) => current.map((item) => (item.id === alert.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update alert');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    setBusyId(id);
    setError(null);
    try {
      await api.alerts.remove(serial, id);
      setAlerts((current) => current.filter((alert) => alert.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete alert');
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return <p className="alerts-tab__notice">Loading alerts…</p>;
  }

  if (showForm && formAction === 'edit' && !editing) {
    return (
      <div className="alerts-tab__notice">
        <p>This alert no longer exists.</p>
        <Button variant="secondary" onClick={clearForm}>Back to alerts</Button>
      </div>
    );
  }

  const formView = (
    <div className="alerts-tab__form-view">
      <div className="alerts-tab__header">
        <div className="alerts-tab__heading">
          <div>
            <h4 className="alerts-tab__title">
              {editing ? 'Edit alert' : duplicateSource ? 'Duplicate alert' : 'New alert'}
            </h4>
            <p className="alerts-tab__subtitle">
              {editing
                ? `Update this alert rule for ${deviceName}.`
                : duplicateSource
                  ? `Saving creates a new, disabled copy of "${duplicateSource.name}" for ${deviceName}.`
                  : `Create a new alert rule for ${deviceName}.`}
            </p>
          </div>
        </div>
      </div>

      <div className="alerts-tab__form">
        <Input
          label="Alert name"
          placeholder="e.g. Server room too hot"
          value={draft.name}
          maxLength={64}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          fullWidth
        />

        {draft.conditions.length > 1 && (
          <div className="alerts-tab__field">
            <span className="alerts-tab__field-label">Match</span>
            <div className="alerts-tab__logic-toggle" role="group" aria-label="Condition matching">
              <button
                type="button"
                className={`alerts-tab__logic-btn ${draft.logic === 'and' ? 'is-active' : ''}`}
                onClick={() => setDraft((current) => ({ ...current, logic: 'and' }))}
              >
                All
              </button>
              <button
                type="button"
                className={`alerts-tab__logic-btn ${draft.logic === 'or' ? 'is-active' : ''}`}
                onClick={() => setDraft((current) => ({ ...current, logic: 'or' }))}
              >
                Any
              </button>
            </div>
          </div>
        )}

        <div className="alerts-tab__field">
          <span className="alerts-tab__field-label">Conditions</span>
          <div className="alerts-tab__condition-list">
            {draft.conditions.map((condition, index) => (
              <div className="alerts-tab__condition-row" key={`condition-${index}`}>
                <Select
                  value={condition.metric}
                  options={METRIC_OPTIONS}
                  onChange={(event) =>
                    updateCondition(index, { metric: event.target.value as AlertMetric })
                  }
                  fullWidth
                />
                <Select
                  value={condition.operator}
                  options={OPERATOR_OPTIONS}
                  onChange={(event) =>
                    updateCondition(index, { operator: event.target.value as AlertOperator })
                  }
                  fullWidth
                />
                <div className="alerts-tab__value-input">
                  <Input
                    type="number"
                    step="0.1"
                    value={condition.value}
                    onChange={(event) => updateCondition(index, { value: event.target.value })}
                    fullWidth
                  />
                  <span className="alerts-tab__unit">{METRIC_META[condition.metric].unit}</span>
                </div>
                <button
                  type="button"
                  className="alerts-tab__remove-condition"
                  onClick={() => removeCondition(index)}
                  disabled={draft.conditions.length === 1}
                  aria-label="Remove condition"
                >
                  <IconTrash size={16} strokeWidth={1.9} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="alerts-tab__add-condition"
            onClick={addCondition}
            disabled={draft.conditions.length >= 6}
          >
            Add condition
          </button>
        </div>

        <div className="alerts-tab__field">
          <span className="alerts-tab__field-label">Send notifications to</span>
          {integrations.length === 0 ? (
            <p className="alerts-tab__field-empty">
              No integrations yet — alert will still track firing.
            </p>
          ) : (
            <div className="alerts-tab__integration-grid">
              {integrations.map((integration) => {
                const selected = draft.integrationIds.includes(integration.id);
                return (
                  <label
                    key={integration.id}
                    className={`alerts-tab__integration ${selected ? 'is-selected' : ''} ${integration.enabled ? '' : 'is-disabled'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => toggleIntegration(integration.id, event.target.checked)}
                    />
                    <span className="alerts-tab__integration-meta">
                      <span className="alerts-tab__integration-name">{integration.name}</span>
                      {!integration.enabled && (
                        <span className="alerts-tab__integration-provider">disabled</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="alerts-tab__field alerts-tab__field--half">
          <span className="alerts-tab__field-label">Repeat while still firing</span>
          <Select
            value={String(draft.repeatIntervalMinutes)}
            options={repeatOptions}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                repeatIntervalMinutes: Number(event.target.value),
              }))
            }
            fullWidth
          />

        </div>

        {formError && <p className="alerts-tab__error">{formError}</p>}

        <div className="alerts-tab__form-actions">
          <Checkbox
            label="Enabled"
            checked={draft.enabled}
            onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <Button variant="secondary" onClick={clearForm}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} isLoading={isSaving}>
            {editing ? 'Save' : duplicateSource ? 'Create copy' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="alerts-tab">
      {showForm ? (
        formView
      ) : (
        <>
          <div className="alerts-tab__header">
            <div className="alerts-tab__heading">
              <div>
                <h4 className="alerts-tab__title">Alerts</h4>
                <p className="alerts-tab__subtitle">
                  Watch {deviceName}&apos;s temperature, humidity and pressure, and push a notification when a rule fires.
                </p>
              </div>
            </div>
            <div className="alerts-tab__header-actions">
              <Select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as AlertStatusFilter)}
                aria-label="Filter alerts by status"
                options={[
                  { value: 'all', label: 'All statuses' },
                  { value: 'firing', label: 'Firing' },
                  { value: 'idle', label: 'Idle' },
                  { value: 'disabled', label: 'Disabled' },
                  { value: 'muted', label: 'Muted' },
                ]}
              />
              {canManage && (
                <Button variant="secondary" onClick={openCreate}>
                  New alert
                </Button>
              )}
            </div>
          </div>

          {statusFilter !== 'all' && (
            <p className="alerts-tab__filter-summary">
              Showing {visibleAlerts.length} of {alerts.length} alert{alerts.length === 1 ? '' : 's'}
              {' · '}
              <button type="button" className="alerts-tab__link" onClick={() => setStatusFilter('all')}>
                Clear filter
              </button>
            </p>
          )}

          {error && <p className="alerts-tab__error">{error}</p>}

          {integrations.length === 0 && (
            <div className="alerts-tab__banner">
              <div>
                <strong>No integrations configured.</strong>{' '}
                Alerts will still track their firing state, but notifications need a destination.
                {onNavigate && (
                  <button type="button" className="alerts-tab__link" onClick={() => onNavigate('integrations')}>
                    Add an integration
                  </button>
                )}
              </div>
            </div>
          )}

          {alerts.length === 0 ? (
            <div className="alerts-tab__empty">
              <h5>No alerts yet</h5>
              <p>
                Create a rule to get notified when temperature, humidity or pressure goes above or below a value.
              </p>
              {canManage && (
                <Button variant="primary" onClick={openCreate}>
                  Create your first alert
                </Button>
              )}
            </div>
          ) : visibleAlerts.length === 0 ? (
            <div className="alerts-tab__empty">
              <h5>No alerts match this filter</h5>
              <p>Try another status or clear the filter to see all alerts.</p>
              <Button variant="secondary" onClick={() => setStatusFilter('all')}>Clear filter</Button>
            </div>
          ) : (
            <div className="alerts-tab__list">
              {visibleAlerts.map((alert) => {
                const destinations = alert.integrationIds
                  .map((id) => integrationsById.get(id))
                  .filter((integration): integration is Integration => Boolean(integration));
                const mutedUntil = activeMuteUntil(alert);
                const status = alertStatus(alert);
                const results = testResults[alert.id];

                return (
                  <div
                    key={alert.id}
                    className={`alerts-tab__card ${status === 'firing' ? 'is-firing' : ''} ${status === 'disabled' ? 'is-disabled' : ''} ${status === 'muted' ? 'is-muted' : ''}`}
                  >
                    <div className="alerts-tab__card-top">
                      <div className="alerts-tab__card-title-group">
                        <Tooltip content={mutedUntil ? `Muted until ${mutedUntil.toLocaleString()}` : STATUS_LABELS[status]}>
                          <span className={`alerts-tab__status is-${status}`}>
                            <span className="alerts-tab__status-dot" />
                            {STATUS_LABELS[status]}
                          </span>
                        </Tooltip>
                        <h5 className="alerts-tab__name">{alert.name}</h5>
                      </div>
                      <div className="alerts-tab__card-actions">
                        <Tooltip content="Copy rule JSON">
                          <Button
                            variant="secondary"
                            onClick={() => void handleCopyRule(alert)}
                            aria-label="Copy rule JSON"
                          >
                            {copiedId === alert.id
                              ? <IconCheck size={14} strokeWidth={2} />
                              : <IconCopy size={14} strokeWidth={1.9} />}
                            {copiedId === alert.id ? 'Copied' : 'Copy JSON'}
                          </Button>
                        </Tooltip>
                        {canManage && (
                          <>
                            <Checkbox
                              label="Enabled"
                              checked={alert.enabled}
                              disabled={busyId === alert.id || mutingId === alert.id}
                              onChange={(event) => void handleToggle(alert, event.target.checked)}
                            />
                            <Button
                              variant="secondary"
                              onClick={() => openDuplicate(alert)}
                              disabled={busyId === alert.id}
                            >
                              <IconCopy size={14} strokeWidth={1.9} />
                              Duplicate
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => openEdit(alert)}
                              disabled={busyId === alert.id}
                            >
                              <IconEdit size={14} strokeWidth={1.9} />
                              Edit
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => toggleMuteMenu(alert)}
                              disabled={mutingId === alert.id}
                              aria-expanded={muteMenuId === alert.id}
                            >
                              <IconBellOff size={14} strokeWidth={1.9} />
                              Mute until
                            </Button>
                            {mutedUntil && (
                              <Button
                                variant="secondary"
                                onClick={() => void updateMute(alert, null)}
                                disabled={mutingId === alert.id}
                              >
                                <IconBell size={14} strokeWidth={1.9} />
                                Unmute
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              onClick={() => void handleTest(alert)}
                              disabled={Boolean(testingId) || busyId === alert.id}
                              aria-label={`Send test alert for ${alert.name}`}
                            >
                              <IconSend size={14} strokeWidth={1.9} />
                              {testingId === alert.id ? 'Sending...' : 'Send test'}
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => setDeleting(alert)}
                              disabled={busyId === alert.id}
                            >
                              <IconTrash size={14} strokeWidth={1.9} />
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {muteMenuId === alert.id && canManage && (
                      <div className="alerts-tab__mute-menu">
                        <span className="alerts-tab__mute-label">Mute for</span>
                        <Button variant="secondary" onClick={() => muteFor(alert, 1)} disabled={mutingId === alert.id}>1h</Button>
                        <Button variant="secondary" onClick={() => muteFor(alert, 24)} disabled={mutingId === alert.id}>24h</Button>
                        <Button variant="secondary" onClick={() => muteFor(alert, 24 * 7)} disabled={mutingId === alert.id}>7d</Button>
                        <div className="alerts-tab__mute-custom">
                          <span>Custom</span>
                          <Input
                            type="datetime-local"
                            value={customMuteValue}
                            aria-label="Custom mute expiry"
                            onChange={(event) => setCustomMuteValue(event.target.value)}
                          />
                          <Button variant="primary" onClick={() => muteCustom(alert)} disabled={mutingId === alert.id}>
                            Apply
                          </Button>
                        </div>
                        <Button variant="secondary" onClick={() => setMuteMenuId(null)}>Cancel</Button>
                      </div>
                    )}

                    <div className="alerts-tab__conditions">
                      {alert.conditions.map((condition, index) => (
                        <span key={`${condition.metric}-${index}`} className="alerts-tab__condition">
                          {conditionText(condition)}
                        </span>
                      ))}
                      <span className="alerts-tab__logic">{alert.logic === 'and' ? 'ALL must match' : 'ANY can match'}</span>
                    </div>

                    <div className="alerts-tab__card-footer">
                      <div className="alerts-tab__meta">
                        <span className="alerts-tab__meta-label">Send to</span>
                        {destinations.length === 0 ? (
                          <span className="alerts-tab__meta-empty">No destinations</span>
                        ) : (
                          <div className="alerts-tab__destinations">
                            {destinations.map((integration) => (
                              <span key={integration.id} className="alerts-tab__destination">
                                
                                {integration.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="alerts-tab__meta-row">
                        <span className="alerts-tab__repeat">
                          <IconClock size={14} strokeWidth={1.8} />
                          {repeatLabel(alert.repeatIntervalMinutes)}
                        </span>
                        <Tooltip content={alert.lastTriggeredAt
                          ? toDate(alert.lastTriggeredAt).toLocaleString()
                          : 'This rule has never fired'}>
                          <span className={`alerts-tab__last ${alert.firing ? 'is-recent' : ''}`}>
                            {alert.lastTriggeredAt
                              ? `Last fired ${formatDeviceRelativeTime(alert.lastTriggeredAt)}`
                              : 'Never fired'}
                          </span>
                        </Tooltip>
                      </div>
                      {mutedUntil && (
                        <span className="alerts-tab__muted-until">
                          <IconBellOff size={14} strokeWidth={1.8} />
                          Muted until {mutedUntil.toLocaleString()}
                        </span>
                      )}
                    </div>

                    {results && (
                      <div className="alerts-tab__test-results">
                        <span className="alerts-tab__test-title">Test results</span>
                        {results.length === 0 ? (
                          <span className="alerts-tab__test-empty">No integration returned a result.</span>
                        ) : results.map((result) => {
                          const integration = integrationsById.get(result.integrationId);
                          return (
                            <span
                              key={result.integrationId}
                              className={`alerts-tab__test-result ${result.ok ? 'is-ok' : 'is-failed'}`}
                            >
                              {result.ok
                                ? <IconCheck size={14} strokeWidth={2} />
                                : <IconAlertCircle size={14} strokeWidth={1.9} />}
                              <strong>{integration?.name ?? result.integrationId}</strong>
                              <span>
                                {result.ok
                                  ? `Delivered${result.status ? ` (${result.status})` : ''}`
                                  : result.error ?? (result.status ? `HTTP ${result.status}` : 'Failed')}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        title="Delete alert"
        confirmText="Delete alert"
        cancelText="Cancel"
        isDangerous
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      >
        <p>
          Delete <strong>{deleting?.name}</strong>? Notifications for this rule will stop immediately.
        </p>
      </ConfirmDialog>
    </div>
  );
}
