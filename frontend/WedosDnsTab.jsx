// WEDOS DNS settings panel. Renders in the "DNS" tab of Server Settings.
//
// Fetches config from GET /api/server-config/wedos-dns (provided by this
// plugin's router). Lets admins view/edit credentials and validate them.

import { useState, useEffect } from 'react';

function WedosDnsTab({ managerAppName }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ domain: '', email: '', wapiPassword: '', cnameTarget: '' });

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/server-config/wedos-dns', { credentials: 'include' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus(await res.json());
    } catch (err) {
      setStatus({ domain: '', email: '', wapiPasswordConfigured: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const startEdit = () => {
    setForm({ domain: status?.domain || '', email: status?.email || '', wapiPassword: '', cnameTarget: status?.cnameTarget || '' });
    setEditing(true);
    setValidateResult(null);
    setError(null);
  };

  const validate = async () => {
    setValidating(true);
    setValidateResult(null);
    try {
      const res = await fetch('/api/server-config/wedos-dns/validate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: form.domain || undefined,
          email: form.email || undefined,
          wapiPassword: form.wapiPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Validation failed');
      setValidateResult({ success: true, recordCount: data.recordCount });
    } catch (err) {
      setValidateResult({ success: false, error: err.message });
    } finally {
      setValidating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {};
      if (form.domain) payload.domain = form.domain;
      if (form.email) payload.email = form.email;
      if (form.wapiPassword) payload.wapiPassword = form.wapiPassword;
      if (form.cnameTarget) payload.cnameTarget = form.cnameTarget;

      const res = await fetch('/api/server-config/wedos-dns', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setEditing(false);
      setValidateResult(null);
      await fetchStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="card p-4 text-sm text-gray-500">Loading WEDOS DNS settings…</div>;
  }

  const configured = status?.domain && status?.email && status?.wapiPasswordConfigured && status?.cnameTarget;

  return (
    <div className="card">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">DNS Configuration (WEDOS)</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Auto-create per-app CNAME and ACME challenge records in WEDOS when you publish an app
          </p>
        </div>
        {!editing && (
          <button onClick={startEdit} disabled={!managerAppName} className="btn btn-secondary btn-sm">
            {configured ? 'Edit' : 'Configure'}
          </button>
        )}
      </div>

      <div className="p-4">
        {editing ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="wedos-domain" className="block text-sm font-medium text-gray-700 mb-1">Domain</label>
              <input
                id="wedos-domain"
                type="text"
                value={form.domain}
                onChange={(e) => setForm(p => ({ ...p, domain: e.target.value }))}
                className="input font-mono text-sm"
                placeholder="micbox.cz"
              />
              <p className="text-xs text-gray-500 mt-1">
                Apps will be reachable at <code className="bg-gray-100 px-1 rounded">appname.{form.domain || 'yourdomain.cz'}</code>
              </p>
            </div>
            <div>
              <label htmlFor="wedos-email" className="block text-sm font-medium text-gray-700 mb-1">WEDOS Account Email</label>
              <input
                id="wedos-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))}
                className="input text-sm"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="wedos-cname-target" className="block text-sm font-medium text-gray-700 mb-1">CNAME Target</label>
              <input
                id="wedos-cname-target"
                type="text"
                value={form.cnameTarget}
                onChange={(e) => setForm(p => ({ ...p, cnameTarget: e.target.value }))}
                className="input font-mono text-sm"
                placeholder="hradilrt.myds.me"
              />
              <p className="text-xs text-gray-500 mt-1">
                DDNS hostname all app CNAMEs will point to (tracks your home IP)
              </p>
            </div>
            <div>
              <label htmlFor="wedos-wapi-password" className="block text-sm font-medium text-gray-700 mb-1">WEDOS WAPI Password</label>
              <input
                id="wedos-wapi-password"
                type="password"
                value={form.wapiPassword}
                onChange={(e) => setForm(p => ({ ...p, wapiPassword: e.target.value }))}
                className="input font-mono text-sm"
                placeholder={status?.wapiPasswordConfigured ? '(leave empty to keep existing)' : 'Set in WEDOS → My Account → WAPI Interface'}
                autoComplete="new-password"
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={validate}
                disabled={validating || !form.domain || !form.email || (!form.wapiPassword && !status?.wapiPasswordConfigured)}
                className="btn btn-secondary btn-sm"
              >
                {validating ? 'Validating…' : 'Test Connection'}
              </button>
              {validateResult?.success && (
                <span className="text-xs text-green-600">
                  Connected — {validateResult.recordCount} record{validateResult.recordCount !== 1 ? 's' : ''} in zone
                </span>
              )}
              {validateResult?.error && (
                <span className="text-xs text-red-600">{validateResult.error}</span>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={saving || !managerAppName} className="btn btn-primary btn-sm">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setValidateResult(null); setError(null); }}
                disabled={saving}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <dl className="space-y-3 text-sm">
            <div className="flex gap-2">
              <dt className="font-medium text-gray-700 w-36">Status:</dt>
              <dd>
                {configured
                  ? <span className="badge badge-green">Configured</span>
                  : <span className="badge badge-gray">Not Configured</span>
                }
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-gray-700 w-36">Domain:</dt>
              <dd className="font-mono text-gray-600">{status?.domain || <span className="text-gray-400">not set</span>}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-gray-700 w-36">WEDOS Email:</dt>
              <dd className="text-gray-600">{status?.email || <span className="text-gray-400">not set</span>}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-gray-700 w-36">CNAME Target:</dt>
              <dd className="font-mono text-gray-600">{status?.cnameTarget || <span className="text-gray-400">not set</span>}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-gray-700 w-36">WAPI Password:</dt>
              <dd className="text-gray-600">
                {status?.wapiPasswordConfigured ? '••••••••••••' : <span className="text-gray-400">not set</span>}
              </dd>
            </div>
            {configured && (
              <p className="text-xs text-gray-500 pt-2">
                When you add a domain like{' '}
                <code className="bg-gray-100 px-1 rounded">myapp.{status.domain}</code> to an app,
                an explicit CNAME record pointing to{' '}
                <code className="bg-gray-100 px-1 rounded">{status.cnameTarget}</code> plus ACME
                challenge records are created automatically in WEDOS, and Let's Encrypt is enabled.
              </p>
            )}
            {!managerAppName && (
              <p className="text-xs text-amber-600">
                Config changes require the app to be deployed on Dokku.
              </p>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}

export default WedosDnsTab;
