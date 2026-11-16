import { json, readJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import {
  createIntegration,
  deleteIntegration,
  getIntegrationById,
  getIntegrationsForTeamId,
  updateIntegration,
} from '../../lib/db';
import { getTeamScopeUuid, getTeamForUser, canManageTeam } from '../../lib/db/teams';
import type { Integration, IntegrationProvider, User } from '@common';

const MAX_NAME_LENGTH = 64;
const MAX_URL_LENGTH = 2048;

const PROVIDERS: readonly IntegrationProvider[] = ['discord', 'slack', 'webhook'];

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

function parseProvider(value: unknown): IntegrationProvider | null {
  if (typeof value !== 'string') return null;
  if (!(PROVIDERS as readonly string[]).includes(value)) return null;
  return value as IntegrationProvider;
}

function parseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > MAX_URL_LENGTH) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

const handleListMine = requireAuth(async (_request, user: User) => {
  const scopeUuid = await getTeamScopeUuid(user);
  const integrations = await getIntegrationsForTeamId(scopeUuid);
  return json({ integrations });
});

const handleCreate = requireAuth(async (request, user: User) => {
  const team = await getTeamForUser(user);
  if (team && !canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const body = await readJsonBody(request);
  const name = parseName(body?.name);
  if (!name) return json({ error: 'invalid name' }, 400);

  const provider = parseProvider(body?.provider);
  if (!provider) return json({ error: 'invalid provider' }, 400);

  const webhookUrl = parseUrl(body?.webhookUrl);
  if (!webhookUrl) return json({ error: 'invalid webhook url' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);

  const integration: Integration = {
    id: crypto.randomUUID(),
    teamId: scopeUuid,
    name,
    provider,
    webhookUrl,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const created = await createIntegration(integration);
  return json({ integration: created }, 201);
});

const handleGet = requireAuth(async (_request, user: User, params) => {
  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);
  const integration = await getIntegrationById(id);
  if (!integration) return json({ error: 'not found' }, 404);
  if (integration.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  return json({ integration });
});

const handleUpdate = requireAuth(async (request, user: User, params) => {
  const team = await getTeamForUser(user);
  if (team && !canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);
  const existing = await getIntegrationById(id);
  if (!existing) return json({ error: 'not found' }, 404);
  if (existing.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const body = await readJsonBody(request);
  const updates: Partial<Integration> = {};

  if (body?.name !== undefined) {
    const name = parseName(body.name);
    if (!name) return json({ error: 'invalid name' }, 400);
    updates.name = name;
  }
  if (body?.provider !== undefined) {
    const provider = parseProvider(body.provider);
    if (!provider) return json({ error: 'invalid provider' }, 400);
    updates.provider = provider;
  }
  if (body?.webhookUrl !== undefined) {
    const webhookUrl = parseUrl(body.webhookUrl);
    if (!webhookUrl) return json({ error: 'invalid webhook url' }, 400);
    updates.webhookUrl = webhookUrl;
  }
  if (body?.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return json({ error: 'invalid enabled' }, 400);
    updates.enabled = body.enabled;
  }

  const updated = await updateIntegration(id, updates);
  if (!updated) return json({ error: 'not found' }, 404);
  return json({ integration: updated });
});

const handleDelete = requireAuth(async (_request, user: User, params) => {
  const team = await getTeamForUser(user);
  if (team && !canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);
  const existing = await getIntegrationById(id);
  if (!existing) return json({ error: 'not found' }, 404);
  if (existing.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const deleted = await deleteIntegration(id, scopeUuid);
  if (!deleted) return json({ error: 'not found' }, 404);
  return json({ deleted: true });
});

const handleTest = requireAuth(async (_request, user: User, params) => {
  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);
  const integration = await getIntegrationById(id);
  if (!integration) return json({ error: 'not found' }, 404);
  if (integration.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const payload =
    integration.provider === 'slack'
      ? { text: `Test message from Ayphr integrations (${integration.name})` }
      : integration.provider === 'discord'
        ? { content: `Test message from Ayphr integrations (${integration.name})` }
        : { event: 'test', name: integration.name, message: 'Hello from Ayphr' };

  try {
    const response = await fetch(integration.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return json({ ok: response.ok, status: response.status });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'request failed' });
  }
});

export {
  handleListMine as handleIntegrationsListMine,
  handleCreate as handleIntegrationCreate,
  handleGet as handleIntegrationGet,
  handleUpdate as handleIntegrationUpdate,
  handleDelete as handleIntegrationDelete,
  handleTest as handleIntegrationTest,
};