// Setup-wizard step for WEDOS DNS. Rendered in the 'dns' slot.
//
// For a fresh install: saves credentials to Dokku app config via the plugin's
// own POST /api/server-config/wedos-dns endpoint, then calls onNext.
// For a backup-restore flow: credentials already exist in the backup, so the
// step just confirms and proceeds (single NAS instance, no selection needed).

import { useState } from 'react';

async function saveCredentials(domain, email, wapiPassword, cnameTarget) {
  const res = await fetch('/api/server-config/wedos-dns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ domain, email, wapiPassword, cnameTarget }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save WEDOS DNS settings');
}

function WedosDnsSetupStep({ onNext, onBack, addLog }) {
  const [form, setForm] = useState({ domain: '', email: '', wapiPassword: '', cnameTarget: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    addLog('Saving WEDOS DNS settings…');

    try {
      await saveCredentials(form.domain, form.email, form.wapiPassword, form.cnameTarget);
      addLog('WEDOS DNS settings saved', 'success');
      onNext({ dnsProviderInstanceId: 'default' });
    } catch (err) {
      addLog(`Failed: ${err.message}`, 'error');
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    addLog('Skipping WEDOS DNS configuration');
    onNext({ dnsProviderInstanceId: null });
  };

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-xl font-semibold mb-2">WEDOS DNS Settings</h2>
      <p className="text-gray-600 text-sm mb-5">
        Configure WEDOS WAPI so dokku-manager can automatically create DNS records
        when you publish an app. Skip if you'll configure this later in Settings.
      </p>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Domain
          </label>
          <input
            type="text"
            value={form.domain}
            onChange={set('domain')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
            placeholder="micbox.cz"
            autoComplete="off"
          />
          <p className="text-xs text-gray-500 mt-1">
            Apps will be accessible at <code className="bg-gray-100 px-1 rounded">appname.{form.domain || 'yourdomain.cz'}</code>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            WEDOS Account Email
          </label>
          <input
            type="email"
            value={form.email}
            onChange={set('email')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            placeholder="you@example.com"
            autoComplete="off"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            CNAME Target
          </label>
          <input
            type="text"
            value={form.cnameTarget}
            onChange={set('cnameTarget')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
            placeholder="hradilrt.myds.me"
            autoComplete="off"
          />
          <p className="text-xs text-gray-500 mt-1">
            DDNS hostname all app CNAMEs will point to (tracks your home IP)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            WEDOS WAPI Password
          </label>
          <input
            type="password"
            value={form.wapiPassword}
            onChange={set('wapiPassword')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
            placeholder="Set in WEDOS → My Account → WAPI Interface"
            autoComplete="new-password"
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={saving || !form.domain || !form.email || !form.wapiPassword || !form.cnameTarget}
            className="flex-1 py-2.5 px-4 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save & Continue'}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={saving}
            className="py-2.5 px-4 border border-gray-300 text-gray-700 font-medium rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Skip
          </button>
        </div>
      </form>

      <button onClick={onBack} className="w-full mt-3 py-2 px-4 text-gray-500 hover:text-gray-700 text-sm">
        Back
      </button>
    </div>
  );
}

export default WedosDnsSetupStep;
