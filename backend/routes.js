// Express routes contributed by the wedos-dns plugin.
//
// Mounted via ctx.mountRouter() at /api/server-config/wedos-dns. Endpoints:
//
//   GET  /           — read current config (secrets masked)
//   POST /           — save config to Dokku app env
//   POST /validate   — test WEDOS WAPI credentials

const wedos = require('./wedos-client');

function createRouter(host) {
  const { express, dokku, gist, requireAuth, requireAdmin } = host;
  const router = express.Router();

  router.get('/', requireAuth, async (req, res) => {
    try {
      const config = await dokku.getConfig(dokku.appName);
      res.json({
        domain: config.DNS_DOMAIN || '',
        email: config.DNS_WEDOS_EMAIL || '',
        wapiPasswordConfigured: !!config.DNS_WEDOS_WAPI_PASSWORD,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/', requireAdmin, async (req, res) => {
    const { domain, email, wapiPassword } = req.body;
    try {
      const updates = {};
      if (domain !== undefined) updates.DNS_DOMAIN = domain;
      if (email !== undefined) updates.DNS_WEDOS_EMAIL = email;
      if (wapiPassword !== undefined) updates.DNS_WEDOS_WAPI_PASSWORD = wapiPassword;

      if (Object.keys(updates).length > 0) {
        await dokku.setConfig(dokku.appName, updates, true);
      }

      gist.triggerBackup();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /validate — test credentials by listing records
  router.post('/validate', requireAdmin, async (req, res) => {
    const { domain, email, wapiPassword } = req.body;
    try {
      let effectivePassword = wapiPassword;
      let effectiveEmail = email;
      let effectiveDomain = domain;
      if (!effectivePassword || !effectiveEmail || !effectiveDomain) {
        const config = await dokku.getConfig(dokku.appName);
        if (!effectiveEmail) effectiveEmail = config.DNS_WEDOS_EMAIL || '';
        if (!effectivePassword) effectivePassword = config.DNS_WEDOS_WAPI_PASSWORD || '';
        if (!effectiveDomain) effectiveDomain = config.DNS_DOMAIN || '';
      }

      if (!effectiveDomain || !effectiveEmail || !effectivePassword) {
        return res.status(400).json({ error: 'domain, email, and wapiPassword are required' });
      }

      const records = await wedos.listRecords(effectiveEmail, effectivePassword, effectiveDomain);
      res.json({ valid: true, recordCount: records.length });
    } catch (err) {
      res.status(400).json({ valid: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createRouter };
