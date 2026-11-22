import type {
  DeviceDataPointsPayload,
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
import { API_PATHS, apiPath } from './generated/routes';

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
      const response = await client.requestJson<DeviceListPayload>(apiPath(API_PATHS.getDevicesMine));
      return response.devices;
    },
    async getBySerial(serial: number) {
      const response = await client.requestJson<DevicePayload>(apiPath(API_PATHS.getDevicesSerial, { serial: serial }));
      return response.device;
    },
    async getUptime(serial: number) {
      const response = await client.requestJson<DeviceUptimePayload>(apiPath(API_PATHS.getDevicesSerialUptime, { serial: serial }));
      return response.uptime;
    },
    async listLogs(serial: number, query: DeviceLogFilterQuery = {}) {
      const params = new URLSearchParams();
      if (query.page) params.set('page', String(query.page));
      if (query.pageSize) params.set('pageSize', String(query.pageSize));
      appendLogFilters(params, query);
      const search = params.toString();
      return client.requestJson<DeviceLogListPayload>(
        apiPath(API_PATHS.getDevicesSerialLogs, { serial: serial }, search ? `?${search}` : ''),
      );
    },
    async exportLogs(serial: number, query: DeviceLogExportQuery) {
      const params = new URLSearchParams();
      params.set('format', query.format);
      appendLogFilters(params, query);
      return client.requestRawText(apiPath(API_PATHS.getDevicesSerialLogsExport, { serial: serial }, params.toString()));
    },
    async exportDataPoints(serial: number, query: DeviceDataExportQuery) {
      const params = new URLSearchParams();
      params.set('from', query.from);
      params.set('to', query.to);
      params.set('format', query.format);
      return client.requestRawText(apiPath(API_PATHS.getDevicesSerialDataExport, { serial: serial }, params.toString()));
    },
    async getDataPoints(serial: number, options?: { period?: string; from?: string; to?: string; countOnly?: boolean }) {
      const params = new URLSearchParams();
      if (options?.period) params.set('period', options.period);
      if (options?.from) params.set('from', options.from);
      if (options?.to) params.set('to', options.to);
      if (options?.countOnly) params.set('countOnly', 'true');
      const query = params.toString();
      const path = apiPath(API_PATHS.getDevicesSerialData, { serial: serial }, query ? `?${query}` : '');
      return client.requestJson<DeviceDataPointsPayload>(path);
    },
    async dataFill(serial: number, input: { start: string; end: string; intervalSeconds: number }) {
      return client.requestJson<{ serial: number; count: number }>(apiPath(API_PATHS.postDevicesSerialDataFill, { serial: serial }), {
        method: 'POST',
        body: input,
      });
    },
    async deleteDataPoints(serial: number, timestamps: (Date | string)[]) {
      return client.requestJson<{ serial: number; removed: number }>(apiPath(API_PATHS.deleteDevicesSerialData, { serial: serial }), {
        method: 'DELETE',
        body: { timestamps },
      });
    },
    async query(serial: number, input: DeviceQueryRequest) {
      return client.requestJson<DeviceQueryPayload>(apiPath(API_PATHS.postDevicesSerialQuery, { serial: serial }), {
        method: 'POST',
        body: input,
      });
    },
    async queryDevices(serials: number[], input: DeviceQueryRequest) {
      return client.requestJson<DeviceQueryPayload>(apiPath(API_PATHS.postDevicesQuery), {
        method: 'POST',
        body: { ...input, serials },
      });
    },
    async update(serial: number, input: { name?: string; locationId?: string }) {
      const response = await client.requestJson<DeviceUpdatePayload>(apiPath(API_PATHS.patchDevicesSerial, { serial: serial }), {
        method: 'PATCH',
        body: input,
      });
      return response.device;
    },
    async unlink(serial: number) {
      return client.requestJson<DeviceUnlinkPayload>(apiPath(API_PATHS.deleteDevicesSerial, { serial: serial }), {
        method: 'DELETE',
      });
    },
    async requestPairing(input: { serial: number; name?: string }) {
      return client.requestJson<DevicePairingRequestPayload>(apiPath(API_PATHS.postDevicesPair), {
        method: 'POST',
        body: input,
      });
    },
    async linkByCode(code: string, locationId?: string) {
      return client.requestJson<DeviceLinkPayload>(apiPath(API_PATHS.postDevicesLink), {
        method: 'POST',
        body: { code, locationId },
      });
    },
    async fetchPairingToken(code: string) {
      return client.requestJson<DevicePairingTokenPayload>(apiPath(API_PATHS.getDevicesPairCode, { code: code }), {
        method: 'GET',
        auth: false,
      });
    },
    async listTokens(serial: number) {
      const response = await client.requestJson<DeviceTokenListPayload>(apiPath(API_PATHS.getDevicesSerialTokens, { serial: serial }));
      return response.tokens;
    },
    async revokeToken(serial: number, id: string) {
      await client.requestJson<null>(apiPath(API_PATHS.deleteDevicesSerialTokensId, { serial: serial, id: id }), { method: 'DELETE' });
    },
  };
}