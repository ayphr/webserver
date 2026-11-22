import { json, readJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import {
  createIntegration,
  deleteIntegration,
  getIntegrationById,
  getIntegrationsForTeamId,
  updateIntegration,
} from '../../lib/db';
import { canManageTeam } from '../../lib/db/teams';
import { parseName } from '../../lib/deviceValidation';
import { requireAlertsAndWebhooksPlan } from '../../lib/planAccess';
import { getTeamContext } from '../../lib/teamContext';
import { validateWebhookUrl } from '../../lib/webhookUrl';
import type { Integration, IntegrationProvider, User } from '@common';

const WEBHOOK_TIMEOUT_MS = 10_000;

const PROVIDERS: readonly IntegrationProvider[] = ['discord', 'slack', 'webhook'];

function parseProvider(value: unknown): IntegrationProvider | null {
  if (typeof value !== 'string') return null;
  if (!(PROVIDERS as readonly string[]).includes(value)) return null;
  return value as IntegrationProvider;
}

async function parseUrl(value: unknown): Promise<string | null> {
  const result = await validateWebhookUrl(value);
  return result.ok ? result.url : null;
}

const handleListMine = requireAuth(async (_request, user: User) => {
  const planError = await requireAlertsAndWebhooksPlan(user);
  if (planError) return planError;

  const { scopeUuid } = await getTeamContext(user);
  const integrations = await getIntegrationsForTeamId(scopeUuid);
  return json({ integrations });
});

const handleCreate = requireAuth(async (request, user: User) => {
  const planError = await requireAlertsAndWebhooksPlan(user);
  if (planError) return planError;

  const { team, scopeUuid } = await getTeamContext(user);
  if (team && !canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const body = await readJsonBody(request);
  const name = parseName(body?.name);
  if (!name) return json({ error: 'invalid name' }, 400);

  const provider = parseProvider(body?.provider);
  if (!provider) return json({ error: 'invalid provider' }, 400);

  const webhookUrl = await parseUrl(body?.webhookUrl);
  if (!webhookUrl) return json({ error: 'invalid webhook url' }, 400);

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
  const planError = await requireAlertsAndWebhooksPlan(user);
  if (planError) return planError;

  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const { scopeUuid } = await getTeamContext(user);
  const integration = await getIntegrationById(id);
  if (!integration) return json({ error: 'not found' }, 404);
  if (integration.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  return json({ integration });
});

const handleUpdate = requireAuth(async (request, user: User, params) => {
  const planError = await requireAlertsAndWebhooksPlan(user);
  if (planError) return planError;

  const { team, scopeUuid } = await getTeamContext(user);
  if (team && !canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

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
    const webhookUrl = await parseUrl(body.webhookUrl);
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
  const planError = await requireAlertsAndWebhooksPlan(user);
  if (planError) return planError;

  const { team, scopeUuid } = await getTeamContext(user);
  if (team && !canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const existing = await getIntegrationById(id);
  if (!existing) return json({ error: 'not found' }, 404);
  if (existing.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const deleted = await deleteIntegration(id, scopeUuid);
  if (!deleted) return json({ error: 'not found' }, 404);
  return json({ deleted: true });
});

const handleTest = requireAuth(async (_request, user: User, params) => {
  const planError = await requireAlertsAndWebhooksPlan(user);
  if (planError) return planError;

  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const { scopeUuid } = await getTeamContext(user);
  const integration = await getIntegrationById(id);
  if (!integration) return json({ error: 'not found' }, 404);
  if (integration.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const urlCheck = await validateWebhookUrl(integration.webhookUrl);
  if (!urlCheck.ok) {
    return json({ ok: false, error: urlCheck.reason }, 400);
  }

  const payload =
    integration.provider === 'slack'
      ? { text: `Test message from Ayphr integrations (${integration.name})` }
      : integration.provider === 'discord'
        ? { content: `Test message from Ayphr integrations (${integration.name})` }
        : { event: 'test', name: integration.name, message: 'Hello from Ayphr' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(urlCheck.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'error',
    });
    return json({ ok: response.ok, status: response.status });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'request failed' });
  } finally {
    clearTimeout(timeout);
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