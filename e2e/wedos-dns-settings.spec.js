// Tests for WedosDnsTab rendered inside the Extensions tab (DNS section).
// Requires the full app to be running (see playwright.config.js).
import { test, expect } from '@playwright/test';

const APP_NAME = 'dm-test';

function mockServerConfig(page) {
  return page.route('/api/server-config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ appName: APP_NAME, dokkuHost: 'test.example.com' }),
    })
  );
}

function mockAppConfig(page, config = {}) {
  return page.route(`/api/apps/${APP_NAME}/config`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) })
  );
}

function mockExtensionsWithWedos(page, { isConfigured = false } = {}) {
  return page.route('/api/extensions/active', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authProviders: [],
        dnsProviders: [{ id: 'wedos-dns', label: 'WEDOS DNS', isConfigured, configKeys: [] }],
        activeAuthProviderId: null,
        activeDnsProviderId: 'wedos-dns',
        plugins: [],
      }),
    })
  );
}

function mockWedosStatus(page, status = {}) {
  return page.route('/api/server-config/wedos-dns', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
  });
}

async function goToExtensions(page) {
  await page.route('/api/setup/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ setupComplete: true }) })
  );
  await page.goto('/settings/extensions');
  await page.waitForSelector('[class*="animate-spin"]', { state: 'detached', timeout: 10_000 }).catch(() => {});
  // Wait for the WEDOS status fetch to complete
  await page.waitForSelector('text=Loading WEDOS DNS settings', { state: 'detached', timeout: 5_000 }).catch(() => {});
}

test.describe('WedosDnsTab — view state', () => {
  test('shows Not Configured badge and Configure button when no status', async ({ page }) => {
    await mockServerConfig(page);
    await mockAppConfig(page);
    await mockExtensionsWithWedos(page, { isConfigured: false });
    await mockWedosStatus(page, { domain: '', email: '', wapiPasswordConfigured: false, cnameTarget: '' });
    await goToExtensions(page);

    await expect(page.getByText('Not Configured').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Configure' })).toBeVisible();
  });

  test('shows Configured badge and all values when fully set', async ({ page }) => {
    await mockServerConfig(page);
    await mockAppConfig(page);
    await mockExtensionsWithWedos(page, { isConfigured: true });
    await mockWedosStatus(page, {
      domain: 'micbox.cz',
      email: 'admin@example.com',
      wapiPasswordConfigured: true,
      cnameTarget: 'hradilrt.myds.me',
    });
    await goToExtensions(page);

    await expect(page.getByText('Configured').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByText('micbox.cz').first()).toBeVisible();
    await expect(page.getByText('admin@example.com')).toBeVisible();
    await expect(page.getByText('hradilrt.myds.me').first()).toBeVisible();
    await expect(page.getByText('••••••••••••')).toBeVisible();
  });

  test('shows amber notice and disabled Configure button without managerAppName', async ({ page }) => {
    await page.route('/api/server-config', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ appName: null }) })
    );
    await page.route('/api/apps/**/config', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) })
    );
    await mockExtensionsWithWedos(page, { isConfigured: false });
    await mockWedosStatus(page, { domain: '', email: '', wapiPasswordConfigured: false, cnameTarget: '' });
    await goToExtensions(page);

    await expect(page.getByText(/Config changes require the app to be deployed/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Configure' })).toBeDisabled();
  });
});

test.describe('WedosDnsTab — edit form', () => {
  test.beforeEach(async ({ page }) => {
    await mockServerConfig(page);
    await mockAppConfig(page);
    await mockExtensionsWithWedos(page, { isConfigured: false });
  });

  test('pre-fills domain, email, cnameTarget from status (password stays empty)', async ({ page }) => {
    await mockWedosStatus(page, {
      domain: 'micbox.cz',
      email: 'admin@example.com',
      wapiPasswordConfigured: true,
      cnameTarget: 'hradilrt.myds.me',
    });
    await mockExtensionsWithWedos(page, { isConfigured: true });
    await goToExtensions(page);

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByLabel('Domain')).toHaveValue('micbox.cz');
    await expect(page.getByLabel('WEDOS Account Email')).toHaveValue('admin@example.com');
    await expect(page.getByLabel('CNAME Target')).toHaveValue('hradilrt.myds.me');
    await expect(page.getByLabel('WEDOS WAPI Password')).toHaveValue('');
  });

  test('saves correct payload to /api/server-config/wedos-dns', async ({ page }) => {
    const saved = [];
    await page.route('/api/server-config/wedos-dns', (route) => {
      if (route.request().method() === 'POST') {
        saved.push(JSON.parse(route.request().postData() || '{}'));
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ domain: '', email: '', wapiPasswordConfigured: false, cnameTarget: '' }) });
      }
    });
    await goToExtensions(page);

    await page.getByRole('button', { name: 'Configure' }).click();
    await page.getByLabel('Domain').fill('micbox.cz');
    await page.getByLabel('WEDOS Account Email').fill('admin@example.com');
    await page.getByLabel('CNAME Target').fill('hradilrt.myds.me');
    await page.getByLabel('WEDOS WAPI Password').fill('secret123');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      domain: 'micbox.cz',
      email: 'admin@example.com',
      cnameTarget: 'hradilrt.myds.me',
      wapiPassword: 'secret123',
    });
  });

  test('Cancel closes form without saving', async ({ page }) => {
    await mockWedosStatus(page, { domain: '', email: '', wapiPasswordConfigured: false, cnameTarget: '' });
    let saved = false;
    await page.route('/api/server-config/wedos-dns', (route) => {
      if (route.request().method() === 'POST') saved = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ domain: '', email: '', wapiPasswordConfigured: false, cnameTarget: '' }) });
    });
    await goToExtensions(page);

    await page.getByRole('button', { name: 'Configure' }).click();
    await page.getByLabel('Domain').fill('micbox.cz');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('button', { name: 'Configure' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    expect(saved).toBe(false);
  });

  test('Test Connection calls validate endpoint and shows success', async ({ page }) => {
    await mockWedosStatus(page, { domain: '', email: '', wapiPasswordConfigured: false, cnameTarget: '' });
    const validateRequests = [];
    await page.route('/api/server-config/wedos-dns/validate', (route) => {
      validateRequests.push(JSON.parse(route.request().postData() || '{}'));
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recordCount: 12 }) });
    });
    await goToExtensions(page);

    await page.getByRole('button', { name: 'Configure' }).click();
    await page.getByLabel('Domain').fill('micbox.cz');
    await page.getByLabel('WEDOS Account Email').fill('admin@example.com');
    await page.getByLabel('WEDOS WAPI Password').fill('secret123');
    await page.getByRole('button', { name: 'Test Connection' }).click();

    await expect(page.getByText(/Connected — 12 records in zone/)).toBeVisible();
    expect(validateRequests).toHaveLength(1);
    expect(validateRequests[0]).toMatchObject({ domain: 'micbox.cz', email: 'admin@example.com', wapiPassword: 'secret123' });
  });

  test('Test Connection shows error on failure', async ({ page }) => {
    await mockWedosStatus(page, { domain: '', email: '', wapiPasswordConfigured: false, cnameTarget: '' });
    await page.route('/api/server-config/wedos-dns/validate', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Authentication failure' }) })
    );
    await goToExtensions(page);

    await page.getByRole('button', { name: 'Configure' }).click();
    await page.getByLabel('Domain').fill('micbox.cz');
    await page.getByLabel('WEDOS Account Email').fill('admin@example.com');
    await page.getByLabel('WEDOS WAPI Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Test Connection' }).click();

    await expect(page.getByText('Authentication failure')).toBeVisible();
  });

  test('Test Connection button disabled when required fields missing', async ({ page }) => {
    await mockWedosStatus(page, { domain: '', email: '', wapiPasswordConfigured: false, cnameTarget: '' });
    await goToExtensions(page);

    await page.getByRole('button', { name: 'Configure' }).click();
    // All fields empty and no existing password — button should be disabled
    await expect(page.getByRole('button', { name: 'Test Connection' })).toBeDisabled();

    // Fill domain only — still disabled (email missing)
    await page.getByLabel('Domain').fill('micbox.cz');
    await expect(page.getByRole('button', { name: 'Test Connection' })).toBeDisabled();

    // Fill both domain and email — enabled once password is entered
    await page.getByLabel('WEDOS Account Email').fill('admin@example.com');
    await expect(page.getByRole('button', { name: 'Test Connection' })).toBeDisabled();

    await page.getByLabel('WEDOS WAPI Password').fill('secret');
    await expect(page.getByRole('button', { name: 'Test Connection' })).toBeEnabled();
  });
});
