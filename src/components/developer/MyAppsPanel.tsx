import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { AppSummary } from '@common';
import { KNOWN_APP_SCOPES } from '@common';
import { Card, CardBody, CardHeader, Button, Input, ListInput, ToggleDropdown } from '../common';
import './MyAppsPanel.css';

type CreatedSecret = { clientId: string; clientSecret: string };

export const MyAppsPanel = () => {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<CreatedSecret | null>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    homepageUrl: '',
    tosUrl: '',
    privacyUrl: '',
  });
  const [redirectUris, setRedirectUris] = useState<string[]>([]);
  const [allowedScopes, setAllowedScopes] = useState<string[]>(['identify']);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await api.developer.listApps();
      setApps(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load apps');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const task = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setLogoDataUrl(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setLogoDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const uris = redirectUris.map((s) => s.trim()).filter(Boolean);
      const res = await api.developer.createApp({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        homepageUrl: form.homepageUrl.trim(),
        logoUrl: logoDataUrl || undefined,
        tosUrl: form.tosUrl.trim() || undefined,
        privacyUrl: form.privacyUrl.trim() || undefined,
        redirectUris: uris,
        allowedScopes,
      });
      setCreatedSecret({ clientId: res.clientId, clientSecret: res.clientSecret });
      setIsCreating(false);
      setForm({ name: '', description: '', homepageUrl: '', tosUrl: '', privacyUrl: '' });
      setRedirectUris([]);
      setAllowedScopes(['identify']);
      setLogoDataUrl(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create app');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this app? This cannot be undone.')) return;
    try {
      await api.developer.deleteApp(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete app');
    }
  };

  const handleRegenerate = async (id: string) => {
    if (!confirm('Regenerate client secret? The old secret will stop working.')) return;
    try {
      const res = await api.developer.regenerateSecret(id);
      setCreatedSecret(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate secret');
    }
  };

  return (
    <div className="my-apps">
      <div className="my-apps__header">
        <h3>My Apps</h3>
        <Button variant="primary" onClick={() => setIsCreating((v) => !v)}>
          {isCreating ? 'Cancel' : 'Create App'}
        </Button>
      </div>

      {error && <p className="my-apps__error">{error}</p>}

      {createdSecret && (
        <Card elevated>
          <CardHeader>
            <h4>Client credentials (shown once)</h4>
          </CardHeader>
          <CardBody>
            <p><strong>Client ID:</strong> <code>{createdSecret.clientId}</code></p>
            <p><strong>Client Secret:</strong> <code>{createdSecret.clientSecret}</code></p>
            <p className="my-apps__warning">Save these now. The secret will not be shown again.</p>
            <Button variant="secondary" onClick={() => setCreatedSecret(null)}>Dismiss</Button>
          </CardBody>
        </Card>
      )}

      {isCreating && (
        <Card elevated>
          <CardHeader><h4>Create App</h4></CardHeader>
          <CardBody>
            <form className="my-apps__form" onSubmit={handleCreate}>
              <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <Input label="Homepage URL" value={form.homepageUrl} onChange={(e) => setForm({ ...form, homepageUrl: e.target.value })} required />
              <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <div className="my-apps__field">
                <label className="my-apps__label">Logo</label>
                <label className="my-apps__file-button">
                  Browse
                  <input type="file" accept="image/*" onChange={handleLogoChange} hidden />
                </label>
                {logoDataUrl && <img src={logoDataUrl} alt="logo preview" className="my-apps__logo-preview" />}
              </div>
              <Input label="Terms of Service URL" value={form.tosUrl} onChange={(e) => setForm({ ...form, tosUrl: e.target.value })} />
              <Input label="Privacy Policy URL" value={form.privacyUrl} onChange={(e) => setForm({ ...form, privacyUrl: e.target.value })} />

              <ListInput
                label="Redirect URIs"
                value={redirectUris}
                onChange={setRedirectUris}
                placeholder="https://example.com/callback"
              />

              <ToggleDropdown
                label="Allowed scopes"
                options={[...KNOWN_APP_SCOPES]}
                value={allowedScopes}
                onChange={setAllowedScopes}
              />

              <Button type="submit" variant="primary">Create</Button>
            </form>
          </CardBody>
        </Card>
      )}

      {isLoading ? (
        <p>Loading apps...</p>
      ) : apps.length === 0 ? (
        <p>No apps yet. Create one to get started.</p>
      ) : (
        <div className="my-apps__list">
          {apps.map((app) => (
            <Card key={app.id} elevated>
              <CardHeader>
                <h4>{app.name}</h4>
                <p>{app.description}</p>
              </CardHeader>
              <CardBody>
                {app.logoUrl && <img src={app.logoUrl} alt={app.name} className="my-apps__app-logo" />}
                <p><strong>Client ID:</strong> <code>{app.clientId}</code></p>
                <p><strong>Homepage:</strong> {app.homepageUrl}</p>
                <p><strong>Scopes:</strong> {app.allowedScopes.join(', ')}</p>
                <p><strong>Redirect URIs:</strong> {app.redirectUris.join(', ') || 'No URIs configured'}</p>
                <div className="my-apps__actions">
                  <Button variant="secondary" onClick={() => handleRegenerate(app.id)}>Regenerate secret</Button>
                  <Button variant="danger" onClick={() => handleDelete(app.id)}>Delete</Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
