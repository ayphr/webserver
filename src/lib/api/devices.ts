import type {
  DeviceDataPointsPayload,
  DeviceForecastLockedPayload,
  DeviceForecastPayload,
  DeviceLinkPayload,
  DeviceListPayload,
  DeviceLogEvent,
  DeviceLogLevel,
  DeviceLogListPayload,
  DeviceLogListQuery,
  DevicePairingRequestPayload,
  DevicePairingTokenPayload,
  DevicePayload,
  DeviceQueryPayload,
  DeviceQueryRequest,
  DeviceTokenListPayload,
  DeviceUptimePayload,
  DeviceUnlinkPayload,
  DeviceUpdatePayload,
} from '@common';
import type { RequestClient } from './client';

/** Local filter type keeps query serialization explicit for all supported params. */
export type DeviceLogFilterQuery = DeviceLogListQuery & {
  level?: DeviceLogLevel;
  event?: DeviceLogEvent;
  q?: string;
  from?: string;
  to?: string;
};

export type DeviceLogExportQuery = Omit<DeviceLogFilterQuery, 'page' | 'pageSize'> & {
  format: 'csv' | 'json';
};

export type DeviceDataExportQuery = {
  from: string;
  to: string;
  format: 'csv' | 'json';
};

function appendLogFilters(params: URLSearchParams, query: DeviceLogFilterQuery) {
  if (query.level) params.set('level', query.level);
  if (query.event) params.set('event', query.event);
  if (query.q) params.set('q', query.q);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
}

export function createDevicesApi(client: RequestClient) {
  return {
    async listMine() {
      const response = await client.requestJson<DeviceListPayload>('/api/devices/mine');
      return response.devices;
    },
    async getBySerial(serial: number) {
      const response = await client.requestJson<DevicePayload>(`/api/devices/${serial}`);
      return response.device;
    },
    async getUptime(serial: number) {
      const response = await client.requestJson<DeviceUptimePayload>(`/api/devices/${serial}/uptime`);
      return response.uptime;
    },
    async listLogs(serial: number, query: DeviceLogFilterQuery = {}) {
      const params = new URLSearchParams();
      if (query.page) params.set('page', String(query.page));
      if (query.pageSize) params.set('pageSize', String(query.pageSize));
      appendLogFilters(params, query);
      const search = params.toString();
      return client.requestJson<DeviceLogListPayload>(
        `/api/devices/${serial}/logs${search ? `?${search}` : ''}`,
      );
    },
    async exportLogs(serial: number, query: DeviceLogExportQuery) {
      const params = new URLSearchParams();
      params.set('format', query.format);
      appendLogFilters(params, query);
      return client.requestRawText(`/api/devices/${serial}/logs/export?${params.toString()}`);
    },
    async exportDataPoints(serial: number, query: DeviceDataExportQuery) {
      const params = new URLSearchParams();
      params.set('from', query.from);
      params.set('to', query.to);
      params.set('format', query.format);
      return client.requestRawText(`/api/devices/${serial}/data/export?${params.toString()}`);
    },
    async getDataPoints(serial: number, options?: { period?: string; from?: string; to?: string; countOnly?: boolean }) {
      const params = new URLSearchParams();
      if (options?.period) params.set('period', options.period);
      if (options?.from) params.set('from', options.from);
      if (options?.to) params.set('to', options.to);
      if (options?.countOnly) params.set('countOnly', 'true');
      const query = params.toString();
      const path = `/api/devices/${serial}/data${query ? `?${query}` : ''}`;
      return client.requestJson<DeviceDataPointsPayload>(path);
    },
    async getForecast(serial: number, horizonSeconds?: number) {
      const params = new URLSearchParams();
      if (horizonSeconds) params.set('horizon', String(horizonSeconds));
      const query = params.toString();
      const path = `/api/devices/${serial}/forecast${query ? `?${query}` : ''}`;
      return client.requestJson<DeviceForecastPayload | DeviceForecastLockedPayload>(path);
    },
    async dataFill(serial: number, input: { start: string; end: string; intervalSeconds: number }) {
      return client.requestJson<{ serial: number; count: number }>(`/api/devices/${serial}/data/fill`, {
        method: 'POST',
        body: input,
      });
    },
    async deleteDataPoints(serial: number, timestamps: (Date | string)[]) {
      return client.requestJson<{ serial: number; removed: number }>(`/api/devices/${serial}/data`, {
        method: 'DELETE',
        body: { timestamps },
      });
    },
    async query(serial: number, input: DeviceQueryRequest) {
      return client.requestJson<DeviceQueryPayload>(`/api/devices/${serial}/query`, {
        method: 'POST',
        body: input,
      });
    },
    async queryDevices(serials: number[], input: DeviceQueryRequest) {
      return client.requestJson<DeviceQueryPayload>('/api/devices/query', {
        method: 'POST',
        body: { ...input, serials },
      });
    },
    async update(serial: number, input: { name?: string; locationId?: string }) {
      const response = await client.requestJson<DeviceUpdatePayload>(`/api/devices/${serial}`, {
        method: 'PATCH',
        body: input,
      });
      return response.device;
    },
    async unlink(serial: number) {
      return client.requestJson<DeviceUnlinkPayload>(`/api/devices/${serial}`, {
        method: 'DELETE',
      });
    },
    async requestPairing(input: { serial: number; name?: string }) {
      return client.requestJson<DevicePairingRequestPayload>('/api/devices/pair', {
        method: 'POST',
        body: input,
      });
    },
    async linkByCode(code: string, locationId?: string) {
      return client.requestJson<DeviceLinkPayload>('/api/devices/link', {
        method: 'POST',
        body: { code, locationId },
      });
    },
    async fetchPairingToken(code: string) {
      return client.requestJson<DevicePairingTokenPayload>(`/api/devices/pair/${encodeURIComponent(code)}`, {
        method: 'GET',
        auth: false,
      });
    },
    async listTokens(serial: number) {
      const response = await client.requestJson<DeviceTokenListPayload>(`/api/devices/${serial}/tokens`);
      return response.tokens;
    },
    async revokeToken(serial: number, id: string) {
      await client.requestJson<null>(`/api/devices/${serial}/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}