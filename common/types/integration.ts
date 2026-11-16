export type IntegrationProvider = 'discord' | 'slack' | 'webhook';

export type Integration = {
  id: string;
  teamId: string;
  name: string;
  provider: IntegrationProvider;
  webhookUrl: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type IntegrationListPayload = {
  integrations: Integration[];
};

export type IntegrationPayload = {
  integration: Integration;
};

export type IntegrationCreateRequest = {
  name: string;
  provider: IntegrationProvider;
  webhookUrl: string;
};

export type IntegrationUpdateRequest = {
  name?: string;
  provider?: IntegrationProvider;
  webhookUrl?: string;
  enabled?: boolean;
};

export type IntegrationTestPayload = {
  ok: boolean;
  status?: number;
  error?: string;
};