import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, tooltips } from '@codemirror/view';
import {
  IconAlertCircle,
  IconBolt,
  IconBraces,
  IconCoin,
  IconCommand,
  IconCopy,
  IconCopyCheck,
  IconCornerDownLeft,
  IconDownload,
  IconExternalLink,
  IconKeyboard,
  IconPlayerPlay,
  IconSparkle2,
  IconWand,
  IconTable,
} from '@tabler/icons-react';
import {
  MAX_BOOST_QUERY_POINTS,
  MAX_QUERY_POINTS_BY_TYPE,
  MAX_STANDARD_QUERY_POINTS,
  estimateQueryComputeUnits,
  formatBoostRequiredMessage,
  formatTql,
  getPlanFeaturesForUser,
  getQueryBoostRequiredSteps,
  validateQuery,
  type CreditBalance,
  type DeviceQueryPayload,
  type DeviceSummary,
  type QueryDraft,
  type QueryType,
  type SelfUser,
} from '@common';
import { api } from '../../lib/api';
import { formatCredits } from '../../lib/credits';
import { downloadRows, slugifyFilename, type ExportRow } from '../../lib/export';
import { EXTERNAL_URLS } from '../../lib/externalUrls';
import { tqlAutocompletion, tqlHover, tqlLanguage, tqlLinter } from '../../lib/tqlEditor';
import { Button, Input, ToggleDropdown, Tooltip } from '../common';
import { createQueryDraft } from './utils';
import './QueriesPanel.css';

const MAX_PREVIEW_ROWS = 250;
const MAX_JSON_PREVIEW_CHARS = 100_000;
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export interface QueriesPanelProps {
  user: SelfUser;
  credits: CreditBalance | null;
  onCreditsChange?: (credits: CreditBalance) => void;
}

function resultRows(result: unknown): ExportRow[] {
  if (Array.isArray(result)) {
    return result.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date)) {
        return item as ExportRow;
      }
      return { value: item };
    });
  }

  if (result && typeof result === 'object' && !(result instanceof Date)) {
    return [result as ExportRow];
  }

  return [{ value: result }];
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '—';
    }
  }
  return String(value);
}

function joinColumns(rows: ExportRow[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

function toDateTimeLocal(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function deviceOptionLabel(device: DeviceSummary): string {
  const name = device.name?.trim();
  return name ? `${name} (${device.serial})` : `Device ${device.serial}`;
}

/** Device label for the context picker: name only, with a serial added only for duplicate names. */
function buildDeviceOptions(devices: DeviceSummary[]): string[] {
  const baseLabels = devices.map((device) => device.name?.trim() || `Device ${device.serial}`);
  const occurrences = new Map<string, number>();
  for (const label of baseLabels) {
    occurrences.set(label, (occurrences.get(label) ?? 0) + 1);
  }
  return devices.map((device, index) => {
    const label = baseLabels[index]!;
    return occurrences.get(label)! > 1 ? `${label} (${device.serial})` : label;
  });
}

function formatQueryDuration(durationMs: number): string {
  const milliseconds = Math.max(0, Math.round(durationMs));
  if (milliseconds < 1000) return `${milliseconds.toLocaleString()} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds - minutes * 60).toFixed(1)}s`;
}

/** Copy via the Clipboard API, falling back to execCommand when it is unavailable or blocked. */
async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back to the legacy copy path below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.style.userSelect = 'text';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    // Leave copied as false when the browser blocks legacy copying.
  } finally {
    textarea.remove();
  }
  if (!copied) throw new Error('Unable to copy to clipboard.');
}

type CopyFeedbackButtonProps = {
  value: string;
  label: string;
  className?: string;
};

const COPY_FEEDBACK_MS = 1400;

function CopyFeedbackButton({ value, label, className = '' }: CopyFeedbackButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleCopy = async () => {
    try {
      await copyToClipboard(value);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setCopied(true);
      timeoutRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      // Leave the normal icon in place if the browser blocks clipboard access.
    }
  };

  return (
    <button
      type="button"
      className={`queries-panel__copy-button ${copied ? 'is-copied' : ''} ${className}`}
      onClick={() => void handleCopy()}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
    >
      <span className="queries-panel__copy-icons" aria-hidden="true">
        <IconCopy className="queries-panel__copy-icon" size={14} strokeWidth={1.75} />
        <IconCopyCheck className="queries-panel__copy-success-icon" size={14} strokeWidth={1.75} />
      </span>
    </button>
  );
}

export const QueriesPanel = ({ user, credits, onCreditsChange }: QueriesPanelProps) => {
  const planFeatures = useMemo(() => getPlanFeaturesForUser(user), [user]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isDevicesLoading, setIsDevicesLoading] = useState(true);
  const [draft, setDraft] = useState<QueryDraft>(() => createQueryDraft());
  const [pointCount, setPointCount] = useState<number | null>(null);
  const [isCountLoading, setIsCountLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<DeviceQueryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');

  const deviceOptions = useMemo(() => buildDeviceOptions(devices), [devices]);
  const selectedSerials = useMemo(
    () => devices
      .filter((device) => draft.context.serials.includes(device.serial))
      .map((device) => device.serial),
    [devices, draft.context.serials],
  );
  const selectedSerialsKey = selectedSerials.join(',');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await api.devices.listMine();
        if (!cancelled) setDevices(loaded);
      } catch {
        if (!cancelled) setDevices([]);
      } finally {
        if (!cancelled) setIsDevicesLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (devices.length === 0) return;
    setDraft((current) => (
      current.context.serials.length > 0
        ? current
        : { ...current, context: { serials: devices.map((device) => device.serial) } }
    ));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [devices]);

  const rangeError = useMemo(() => {
    if (!draft.range.from || !draft.range.to) return 'Select both a start and an end date.';
    const from = Date.parse(draft.range.from);
    const to = Date.parse(draft.range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return 'Enter valid start and end dates.';
    if (from > to) return 'Start must be before end.';
    return null;
  }, [draft.range.from, draft.range.to]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!selectedSerialsKey || rangeError) {
      setPointCount(null);
      setIsCountLoading(false);
      return;
    }
    let cancelled = false;
    setIsCountLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const serials = selectedSerialsKey.split(',').map(Number);
    const timer = setTimeout(() => {
      Promise.all(
        serials.map((deviceSerial) => api.devices.getDataPoints(deviceSerial, {
          from: draft.range.from,
          to: draft.range.to,
          countOnly: true,
        })),
      )
        .then((responses) => {
          if (!cancelled) {
            setPointCount(responses.reduce((sum, response) => sum + response.totalCount, 0));
            setIsCountLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPointCount(null);
            setIsCountLoading(false);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedSerialsKey, draft.range.from, draft.range.to, rangeError]);

  const trimmedQuery = draft.query.trim();
  const validation = useMemo(() => {
    if (!trimmedQuery) return { valid: false, error: 'Enter a TQL query before running it.' };
    return validateQuery(trimmedQuery);
  }, [trimmedQuery]);

  const boostOnlySteps = useMemo(() => {
    if (!validation.valid) return [];
    try {
      return getQueryBoostRequiredSteps(trimmedQuery);
    } catch {
      return [];
    }
  }, [trimmedQuery, validation.valid]);

  const effectivePointCount = pointCount === null
    ? undefined
    : Math.min(pointCount, MAX_QUERY_POINTS_BY_TYPE[draft.type]);
  const creditRate = draft.type === 'boost'
    ? planFeatures.boostedQueryCostCredits
    : planFeatures.queryCostCredits;
  const computeEstimate = useMemo(() => {
    if (!validation.valid) return null;
    try {
      return estimateQueryComputeUnits(trimmedQuery, effectivePointCount);
    } catch {
      return null;
    }
  }, [trimmedQuery, validation.valid, effectivePointCount]);
  const creditCost = Math.max(0.1, (computeEstimate?.units ?? 0) * creditRate);
  const exceedsComputeLimit = Boolean(
    planFeatures.queryComputeUnitLimit
    && computeEstimate
    && computeEstimate.units > planFeatures.queryComputeUnitLimit,
  );

  const tooManyPointsMessage = pointCount !== null && pointCount > MAX_BOOST_QUERY_POINTS
    ? `This range contains ${pointCount.toLocaleString()} data points, which is too many. Narrow it to ${MAX_BOOST_QUERY_POINTS.toLocaleString()} points or fewer.`
    : null;
  const boostStepMessage = draft.type === 'standard' && boostOnlySteps.length > 0
    ? formatBoostRequiredMessage(boostOnlySteps)
    : null;
  const pointsBoostMessage = draft.type === 'standard'
    && pointCount !== null
    && pointCount > MAX_STANDARD_QUERY_POINTS
    ? `This range contains ${pointCount.toLocaleString()} data points. Switch Query Type to Boost to continue.`
    : null;
  const boostRequiredMessage = !tooManyPointsMessage
    ? boostStepMessage ?? pointsBoostMessage
    : null;
  const noPointsMessage = pointCount === 0
    ? 'There are no data points in the selected range for the selected devices.'
    : null;

  const errors = useMemo(() => {
    const list: string[] = [];
    if (error) list.push(error);
    if (!selectedSerialsKey && !isDevicesLoading) list.push('Select at least one device context.');
    if (noPointsMessage) list.push(noPointsMessage);
    if (rangeError) list.push(rangeError);
    if (!validation.valid) list.push(validation.error ?? 'This TQL query is invalid.');
    if (exceedsComputeLimit) {
      list.push(`This query exceeds your plan's compute unit limit of ${planFeatures.queryComputeUnitLimit}.`);
    }
    if (credits && credits.available < creditCost) {
      list.push('You do not have enough credits to run this query.');
    }
    return list.filter((message, index) => list.indexOf(message) === index);
  }, [
    error,
    selectedSerialsKey,
    isDevicesLoading,
    noPointsMessage,
    rangeError,
    validation.valid,
    validation.error,
    exceedsComputeLimit,
    planFeatures.queryComputeUnitLimit,
    credits,
    creditCost,
  ]);

  const canRun = validation.valid
    && selectedSerials.length > 0
    && !rangeError
    && !isCountLoading
    && !tooManyPointsMessage
    && !boostRequiredMessage
    && !noPointsMessage
    && !exceedsComputeLimit
    && (!credits || credits.available >= creditCost)
    && !isRunning;

  const patchDraft = (patch: Partial<QueryDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const handleFormat = () => {
    if (!trimmedQuery || !validation.valid) return;
    try {
      const formatted = formatTql(trimmedQuery);
      if (formatted !== draft.query) patchDraft({ query: formatted });
    } catch {
      // Leave the editor text untouched if formatting fails.
    }
  };

  const handleRun = async () => {
    if (selectedSerials.length === 0 || isCountLoading || !validation.valid || !canRun) return;
    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.devices.queryDevices(selectedSerials, {
        query: trimmedQuery,
        from: draft.range.from,
        to: draft.range.to,
        type: draft.type,
      });
      setResult(response);
      if (onCreditsChange) {
        try {
          const fresh = await api.credits.me();
          onCreditsChange(fresh);
        } catch {
          // Ignore credit refresh failures; the query already succeeded.
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run query');
    } finally {
      setIsRunning(false);
    }
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleRun();
    }
  };

  const rows = useMemo(() => (result ? resultRows(result.result) : []), [result]);
  const columns = useMemo(() => joinColumns(rows.slice(0, MAX_PREVIEW_ROWS)), [rows]);
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS);
  const primaryDevice = selectedSerials.length === 1
    ? devices.find((device) => device.serial === selectedSerials[0])
    : undefined;
  const contextLabel = primaryDevice
    ? deviceOptionLabel(primaryDevice)
    : selectedSerials.length > 1
      ? `${selectedSerials.length}-devices`
      : 'no-device';
  const exportBasename = slugifyFilename(
    `${contextLabel}-query-${new Date().toISOString().slice(0, 10)}`,
    `devices-${selectedSerials.join('-') || 'query'}-query`,
  );
  const jsonText = useMemo(() => JSON.stringify(result?.result ?? null, null, 2), [result]);
  const jsonTooLarge = jsonText.length > MAX_JSON_PREVIEW_CHARS;

  const handleExport = (format: 'csv' | 'json') => {
    if (!result || rows.length === 0) return;
    downloadRows(rows, format, exportBasename);
  };

  return (
    <div className="dashboard-queries">
      <div className="queries-panel__content">
        <section className="queries-panel__settings">
          <div className="queries-panel__settings-grid">
            <ToggleDropdown
              label="Query context"
              options={isDevicesLoading ? ['Loading devices…'] : deviceOptions}
              value={isDevicesLoading
                ? []
                : deviceOptions.filter((_, index) => selectedSerials.includes(devices[index]!.serial))}
              onChange={(labels) => patchDraft({
                context: {
                  serials: devices
                    .filter((_, index) => labels.includes(deviceOptions[index]!))
                    .map((device) => device.serial),
                },
              })}
              placeholder={isDevicesLoading ? 'Loading devices…' : 'Select devices'}
              className="queries-panel__context"
            />
            <div className="queries-panel__range">
              <Input
                type="datetime-local"
                label="From"
                value={toDateTimeLocal(draft.range.from)}
                onChange={(event) => patchDraft({
                  range: { ...draft.range, from: fromDateTimeLocal(event.target.value) },
                })}
              />
              <Input
                type="datetime-local"
                label="To"
                value={toDateTimeLocal(draft.range.to)}
                onChange={(event) => patchDraft({
                  range: { ...draft.range, to: fromDateTimeLocal(event.target.value) },
                })}
              />
            </div>
          </div>

          <div className="queries-panel__mode-row">
            <div className="queries-panel__type" role="group" aria-label="Query type">
              {(['standard', 'boost'] as QueryType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`queries-panel__type-btn ${draft.type === type ? 'is-active' : ''}`}
                  onClick={() => patchDraft({ type })}
                  aria-pressed={draft.type === type}
                >
                  {type === 'boost' && <IconSparkle2 size={14} strokeWidth={1.75} />}
                  {type === 'standard' ? 'Standard' : 'Boost'}
                </button>
              ))}
            </div>
            <span className="queries-panel__point-note">
              {isCountLoading
                ? 'Counting points…'
                : pointCount === null
                  ? 'Point count unavailable'
                  : `${pointCount.toLocaleString()} points in range`}
            </span>
            <div className="queries-panel__run-group">
              <a
                className="queries-panel__docs-link"
                href={EXTERNAL_URLS.tqlDocs}
                target="_blank"
                rel="noopener noreferrer"
              >
                TQL docs
                <IconExternalLink size={13} strokeWidth={1.75} />
              </a>
              {computeEstimate && (
                <div className="queries-panel__cost">
                  <Tooltip content="Credits this query will cost.">
                    <span className="queries-panel__badge">
                      <IconCoin size={13} strokeWidth={2} />
                      {formatCredits(creditCost)} credits
                    </span>
                  </Tooltip>
                  <Tooltip content="Relative compute cost of this query. Higher means more work.">
                    <span className="queries-panel__badge">
                      <IconBolt size={13} strokeWidth={2} />
                      {computeEstimate.units} CU
                    </span>
                  </Tooltip>
                </div>
              )}
              <Button
                variant="primary"
                onClick={() => void handleRun()}
                isLoading={isRunning}
                disabled={!canRun}
              >
                <IconPlayerPlay size={15} strokeWidth={2} />
                Run
                <span
                  className="queries-panel__keybind"
                  aria-label={`${IS_MAC ? 'Command' : 'Keyboard'} then Enter`}
                >
                  {IS_MAC
                    ? <IconCommand size={12} strokeWidth={1.75} />
                    : <IconKeyboard size={12} strokeWidth={1.75} />}
                  <IconCornerDownLeft size={12} strokeWidth={1.75} />
                </span>
              </Button>
            </div>
          </div>
        </section>

        {(boostRequiredMessage || tooManyPointsMessage) && (
          <div className="queries-panel__warning" role="alert">
            <IconAlertCircle size={17} strokeWidth={1.75} />
            <span>{boostRequiredMessage ?? tooManyPointsMessage}</span>
            {boostRequiredMessage && (
              <Button variant="secondary" onClick={() => patchDraft({ type: 'boost' })}>
                <IconSparkle2 size={14} strokeWidth={1.75} />
                Switch to Boost
              </Button>
            )}
          </div>
        )}

        {errors.length > 0 && (
          <div className="queries-panel__error" role="alert">
            <IconAlertCircle size={17} strokeWidth={1.75} />
            <div className="queries-panel__error-list">
              {errors.map((message, index) => (
                <div key={index} className="queries-panel__error-item">{message}</div>
              ))}
            </div>
          </div>
        )}

        <div className="queries-panel__editor" onKeyDown={handleEditorKeyDown}>
          <CodeMirror
            value={draft.query}
            height="260px"
            theme={oneDark}
            extensions={[
              tqlLanguage,
              tqlAutocompletion,
              tqlLinter,
              tqlHover,
              tooltips({ parent: document.body }),
              EditorView.contentAttributes.of({
                spellcheck: 'false',
                autocorrect: 'off',
                autocapitalize: 'off',
                translate: 'no',
              }),
              EditorView.lineWrapping,
            ]}
            basicSetup={{ autocompletion: false }}
            onChange={(value) => patchDraft({ query: value })}
          />
        </div>

        <div className="queries-panel__editor-actions">
          <Button
            variant="secondary"
            className="queries-panel__format-button"
            onClick={handleFormat}
            disabled={!validation.valid}
            title="Format TQL"
          >
            <IconWand size={14} strokeWidth={1.75} />
            Format
          </Button>
        </div>

        {result && (
          <div className="queries-panel__results">
            <div className="queries-panel__results-header">
              <div className="queries-panel__results-stats">
                <span>
                  {result.totalCount.toLocaleString()} points queried in {formatQueryDuration(result.durationMs)}
                </span>
              </div>
              <div className="queries-panel__result-actions">
                <div className="queries-panel__view-toggle" role="group" aria-label="Result view">
                  <button
                    type="button"
                    className={`queries-panel__view-btn ${viewMode === 'table' ? 'is-active' : ''}`}
                    onClick={() => setViewMode('table')}
                  >
                    <IconTable size={14} strokeWidth={2} />
                    Table
                  </button>
                  <button
                    type="button"
                    className={`queries-panel__view-btn ${viewMode === 'json' ? 'is-active' : ''}`}
                    onClick={() => setViewMode('json')}
                  >
                    <IconBraces size={14} strokeWidth={2} />
                    JSON
                  </button>
                </div>
                {viewMode === 'json' && !jsonTooLarge && (
                  <CopyFeedbackButton
                    value={jsonText}
                    label="Copy JSON"
                    className="queries-panel__json-copy"
                  />
                )}
                <Button variant="secondary" onClick={() => handleExport('csv')} disabled={rows.length === 0}>
                  <IconDownload size={15} strokeWidth={1.75} />
                  CSV
                </Button>
                <Button variant="secondary" onClick={() => handleExport('json')} disabled={rows.length === 0}>
                  <IconDownload size={15} strokeWidth={1.75} />
                  JSON
                </Button>
              </div>
            </div>

            {viewMode === 'table' ? (
              rows.length === 0 ? (
                <div className="queries-panel__empty">The query returned no rows.</div>
              ) : (
                <div className="queries-panel__table-wrap">
                  <table className="queries-panel__table">
                    <thead>
                      <tr>
                        {columns.map((column) => <th key={column}>{column}</th>)}
                        <th className="queries-panel__copy-cell" aria-label="Copy row" />
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, index) => (
                        <tr key={index}>
                          {columns.map((column) => (
                            <td key={column} title={displayCell(row[column])}>
                              {displayCell(row[column])}
                            </td>
                          ))}
                          <td className="queries-panel__copy-cell">
                            <CopyFeedbackButton
                              value={JSON.stringify(row, null, 2)}
                              label={`Copy row ${index + 1}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : jsonTooLarge ? (
              <div className="queries-panel__empty">
                JSON output is too large to display. Use the JSON download button above to save the full result.
              </div>
            ) : (
              <pre className="queries-panel__json">{jsonText}</pre>
            )}

            {viewMode === 'table' && rows.length > MAX_PREVIEW_ROWS && (
              <p className="queries-panel__preview-note">
                Showing the first {MAX_PREVIEW_ROWS.toLocaleString()} of {rows.length.toLocaleString()} rows.
                Export to download the full result.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default QueriesPanel;
