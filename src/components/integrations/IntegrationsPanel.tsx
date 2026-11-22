import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Input, Select, Modal, Checkbox, Tooltip } from '../common';
import { IconPlugConnected, IconBrandDiscord, IconBrandSlack, IconPlus, IconTrash, IconEdit, IconSend } from '@tabler/icons-react';
import type { Integration, IntegrationProvider, IntegrationCreateRequest, IntegrationUpdateRequest } from '@common';
import './IntegrationsPanel.css';

const PROVIDER_OPTIONS = [
  { value: 'discord', label: 'Discord' },
  { value: 'slack', label: 'Slack' },
  { value: 'webhook', label: 'Custom webhook' },
];

type Draft = {
  name: string;
  provider: IntegrationProvider;
  webhookUrl: string;
};

const emptyDraft: Draft = {
  name: '',
  provider: 'discord',
  webhookUrl: '',
};

function providerIcon(provider: IntegrationProvider) {
  switch (provider) {
    case 'discord':
      return <IconBrandDiscord size={18} />;
    case 'slack':
      return <IconBrandSlack size={18} />;
    default:
      return <IconPlugConnected size={18} />;
  }
}

export function IntegrationsPanel({ isManager = false }: { isManager?: boolean }) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Integration | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await api.integrations.listMine();
      setIntegrations(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEdit = (item: Integration) => {
    setEditing(item);
    setDraft({
      name: item.name,
      provider: item.provider,
      webhookUrl: item.webhookUrl,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    const name = draft.name.trim();
    const url = draft.webhookUrl.trim();
    if (!name) {
      setFormError('Name is required');
      return;
    }
    if (!url) {
      setFormError('Webhook URL is required');
      return;
    }
    try {
      new URL(url);
    } catch {
      setFormError('Invalid webhook URL');
      return;
    }

    try {
      if (editing) {
        const input: IntegrationUpdateRequest = {
          name,
          provider: draft.provider,
          webhookUrl: url,
        };
        const updated = await api.integrations.update(editing.id, input);
        setIntegrations((prev) => prev.map((item) => (item.id === editing.id ? updated : item)));
      } else {
        const input: IntegrationCreateRequest = {
          name,
          provider: draft.provider,
          webhookUrl: url,
        };
        const created = await api.integrations.create(input);
        setIntegrations((prev) => [created, ...prev]);
      }
      setIsModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save integration');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.integrations.remove(id);
      setIntegrations((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete integration');
    }
  };

  const handleToggle = async (item: Integration, enabled: boolean) => {
    try {
      const updated = await api.integrations.update(item.id, { enabled });
      setIntegrations((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update integration');
    }
  };

  const handleTest = async (item: Integration) => {
    setTestingId(item.id);
    setTestResult((prev) => ({ ...prev, [item.id]: 'Sending test…' }));
    try {
      const result = await api.integrations.test(item.id);
      if (result.ok) {
        setTestResult((prev) => ({ ...prev, [item.id]: `Success${result.status ? ` (${result.status})` : ''}` }));
      } else {
        setTestResult((prev) => ({ ...prev, [item.id]: result.error ? `Error: ${result.error}` : `Failed${result.status ? ` (${result.status})` : ''}` }));
      }
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [item.id]: err instanceof Error ? `Error: ${err.message}` : 'Error sending test',
      }));
    } finally {
      setTestingId(null);
    }
  };

  if (isLoading) return <p className="integrations-panel__loading">Loading integrations…</p>;

  return (
    <div className="integrations-panel">
      <div className="integrations-panel__header">
        <h3 className="integrations-panel__title">Integrations</h3>
        {isManager && (
          <Button variant="secondary" onClick={openCreate}>
            <IconPlus size={16} />
            Add integration
          </Button>
        )}
      </div>

      {error && <p className="integrations-panel__error">{error}</p>}

      {integrations.length === 0 ? (
        <p className="integrations-panel__empty">No integrations yet.</p>
      ) : (
        <div className="integrations-panel__list">
          {integrations.map((item) => (
            <div key={item.id} className="integrations-panel__card">
              <div className="integrations-panel__card-header">
                <div className="integrations-panel__card-meta">
                  <span className="integrations-panel__name">{item.name}</span>
                  <span className="integrations-panel__provider">
                    {providerIcon(item.provider)} {item.provider}
                  </span>
                </div>
                <div className="integrations-panel__card-actions">
                  <Tooltip content={isManager ? 'Enabled' : 'Manager only'}>
                    <Checkbox
                      label=""
                      checked={item.enabled}
                      disabled={!isManager}
                      title={isManager ? 'Enabled' : 'Manager only'}
                      onChange={(e) => void handleToggle(item, e.target.checked)}
                    />
                  </Tooltip>
                  <Button variant="secondary" onClick={() => void handleTest(item)} isLoading={testingId === item.id} disabled={testingId === item.id}>
                    <IconSend size={14} />
                    Test
                  </Button>
                  {isManager && (
                    <>
                      <Button variant="secondary" onClick={() => openEdit(item)}>
                        <IconEdit size={14} />
                      </Button>
                      <Button variant="danger" onClick={() => setDeleteTarget(item.id)}>
                        <IconTrash size={14} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {testResult[item.id] && (
                <p className="integrations-panel__test-result">{testResult[item.id]}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={() => void handleSave()}
        title={editing ? 'Edit integration' : 'Add integration'}
        confirmText={editing ? 'Save' : 'Add'}
        cancelText="Close"
        confirmDisabled={!draft.name.trim() || !draft.webhookUrl.trim()}
      >
        <div className="integrations-panel__form">
          <Input
            label="Name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            fullWidth
          />
          <Select
            label="Provider"
            value={draft.provider}
            onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value as IntegrationProvider }))}
            options={PROVIDER_OPTIONS}
            fullWidth
          />
          <Input
            label="Webhook URL"
            value={draft.webhookUrl}
            onChange={(e) => setDraft((d) => ({ ...d, webhookUrl: e.target.value }))}
            fullWidth
          />
          {formError && <p className="integrations-panel__error">{formError}</p>}
        </div>
      </Modal>
      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        title="Delete integration?"
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous
      >
        <p>This integration will stop sending notifications and cannot be recovered.</p>
      </Modal>
    </div>
  );
}
