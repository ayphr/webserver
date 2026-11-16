import { useEffect, useMemo, useState } from 'react';
import {
  IconBell,
  IconBrandDiscord,
  IconBrandSlack,
  IconClock,
  IconDroplet,
  IconEdit,
  IconGauge,
  IconPlugConnected,
  IconPlus,
  IconThermometer,
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
import { formatDeviceRelativeTime } from '../../lib/deviceActivity';
import { Button, Checkbox, ConfirmDialog, Input, Modal, Select } from '../common';
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

function metricIcon(metric: AlertMetric) {
  switch (metric) {
    case 'temperature':
      return <IconThermometer size={15} strokeWidth={1.9} />;
    case 'humidity':
      return <IconDroplet size={15} strokeWidth={1.9} />;
    default:
      return <IconGauge size={15} strokeWidth={1.9} />;
  }
}

function providerIcon(provider: Integration['provider']) {
  switch (provider) {
    case 'discord':
      return <IconBrandDiscord size={16} />;
    case 'slack':
      return <IconBrandSlack size={16} />;
    default:
      return <IconPlugConnected size={16} />;
  }
}

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

type Props = {
  serial: number;
  deviceName: string;
  canManage: boolean;
  onNavigate?: (tab: string) => void;
};

export function AlertsTab({ serial, deviceName, canManage, onNavigate }: Props) {
  const [alerts, setAlerts] = useState<DeviceAlert[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<DeviceAlert | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
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

  const integrationsById = useMemo(
    () => new Map(integrations.map((integration) => [integration.id, integration])),
    [integrations],
  );

  const firingCount = alerts.filter((alert) => alert.enabled && alert.firing).length;

  const openCreate = () => {
    setEditing(null);
    setDraft({
      ...emptyDraft,
      integrationIds: integrations.filter((integration) => integration.enabled).slice(0, 1).map((integration) => integration.id),
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEdit = (alert: DeviceAlert) => {
    setEditing(alert);
    setDraft(toDraft(alert));
    setFormError(null);
    setIsModalOpen(true);
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
      setIsModalOpen(false);
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

  return (
    <div className="alerts-tab">
      <div className="alerts-tab__header">
        <div className="alerts-tab__heading">
          <span className="alerts-tab__heading-icon">
            <IconBell size={20} strokeWidth={1.8} />
          </span>
          <div>
            <h4 className="alerts-tab__title">Alerts</h4>
            <p className="alerts-tab__subtitle">
              Watch {deviceName}&apos;s temperature, humidity and pressure, and push a notification when a rule fires.
            </p>
          </div>
        </div>
        {canManage && (
          <Button variant="secondary" onClick={openCreate}>
            <IconPlus size={16} strokeWidth={2} />
            New alert
          </Button>
        )}
      </div>

      <div className="alerts-tab__summary">
        <span className={`alerts-tab__summary-dot ${firingCount > 0 ? 'is-firing' : ''}`} />
        <span>
          {alerts.length === 0
            ? 'No alerts configured'
            : `${alerts.length} alert${alerts.length === 1 ? '' : 's'} · ${firingCount} firing`}
        </span>
        <span className="alerts-tab__summary-sep">·</span>
        <span>Checked on every telemetry upload</span>
      </div>

      {error && <p className="alerts-tab__error">{error}</p>}

      {integrations.length === 0 && (
        <div className="alerts-tab__banner">
          <IconPlugConnected size={18} strokeWidth={1.8} />
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
          <IconBell size={28} strokeWidth={1.5} />
          <h5>No alerts yet</h5>
          <p>
            Create a rule to get notified when temperature, humidity or pressure goes above or below a value.
          </p>
          {canManage && (
            <Button variant="primary" onClick={openCreate}>
              <IconPlus size={16} strokeWidth={2} />
              Create your first alert
            </Button>
          )}
        </div>
      ) : (
        <div className="alerts-tab__list">
          {alerts.map((alert) => {
            const destinations = alert.integrationIds
              .map((id) => integrationsById.get(id))
              .filter((integration): integration is Integration => Boolean(integration));

            return (
              <div
                key={alert.id}
                className={`alerts-tab__card ${alert.enabled && alert.firing ? 'is-firing' : ''} ${alert.enabled ? '' : 'is-disabled'}`}
              >
                <div className="alerts-tab__card-top">
                  <div className="alerts-tab__card-title-group">
                    <span
                      className={`alerts-tab__status ${alert.enabled && alert.firing ? 'is-firing' : 'is-idle'}`}
                    >
                      <span className="alerts-tab__status-dot" />
                      {alert.enabled ? (alert.firing ? 'Firing' : 'Idle') : 'Disabled'}
                    </span>
                    <h5 className="alerts-tab__name">{alert.name}</h5>
                  </div>
                  {canManage && (
                    <div className="alerts-tab__card-actions">
                      <Checkbox
                        label="Enabled"
                        checked={alert.enabled}
                        disabled={busyId === alert.id}
                        onChange={(event) => void handleToggle(alert, event.target.checked)}
                      />
                      <Button variant="secondary" onClick={() => openEdit(alert)} disabled={busyId === alert.id}>
                        <IconEdit size={14} strokeWidth={1.9} />
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => setDeleting(alert)}
                        disabled={busyId === alert.id}
                      >
                        <IconTrash size={14} strokeWidth={1.9} />
                        Delete
                      </Button>
                    </div>
                  )}
                </div>

                <div className="alerts-tab__conditions">
                  {alert.conditions.map((condition, index) => (
                    <span key={`${condition.metric}-${index}`} className="alerts-tab__condition">
                      {metricIcon(condition.metric)}
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
                            {providerIcon(integration.provider)}
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
                    <span className="alerts-tab__last">
                      {alert.lastTriggeredAt
                        ? `Last fired ${formatDeviceRelativeTime(alert.lastTriggeredAt)}`
                        : 'Never fired'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editing ? 'Edit alert' : 'New alert'}
        size="lg"
        showCancel={false}
      >
        <div className="alerts-tab__form">
          <Input
            label="Alert name"
            placeholder="e.g. Server room too hot"
            value={draft.name}
            maxLength={64}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            fullWidth
          />

          <div className="alerts-tab__field">
            <span className="alerts-tab__field-label">Condition matching</span>
            <div className="alerts-tab__logic-toggle" role="group" aria-label="Condition matching">
              <button
                type="button"
                className={`alerts-tab__logic-btn ${draft.logic === 'and' ? 'is-active' : ''}`}
                onClick={() => setDraft((current) => ({ ...current, logic: 'and' }))}
              >
                Match all
                <span>AND</span>
              </button>
              <button
                type="button"
                className={`alerts-tab__logic-btn ${draft.logic === 'or' ? 'is-active' : ''}`}
                onClick={() => setDraft((current) => ({ ...current, logic: 'or' }))}
              >
                Match any
                <span>OR</span>
              </button>
            </div>
          </div>

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
              <IconPlus size={14} strokeWidth={2} />
              Add condition
            </button>
          </div>

          <div className="alerts-tab__field">
            <span className="alerts-tab__field-label">Send notifications to</span>
            {integrations.length === 0 ? (
              <p className="alerts-tab__field-empty">
                No integrations yet. You can still save this alert to track when it fires.
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
                      <span className="alerts-tab__integration-icon">
                        {providerIcon(integration.provider)}
                      </span>
                      <span className="alerts-tab__integration-meta">
                        <span className="alerts-tab__integration-name">{integration.name}</span>
                        <span className="alerts-tab__integration-provider">
                          {integration.provider}
                          {integration.enabled ? '' : ' · disabled'}
                        </span>
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
            <span className="alerts-tab__field-hint">
              The first notification is sent as soon as the rule starts firing. This controls reminders after that.
            </span>
          </div>

          <div className="alerts-tab__enabled-row">
            <Checkbox
              label="Alert is enabled"
              checked={draft.enabled}
              onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
            />
          </div>

          {formError && <p className="alerts-tab__error">{formError}</p>}

          <div className="alerts-tab__form-actions">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleSave()} isLoading={isSaving}>
              {editing ? 'Save alert' : 'Create alert'}
            </Button>
          </div>
        </div>
      </Modal>

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
