// WEDOS DNS plugin backend.
//
// Fills the DNS provider slot in dokku-manager. When a domain like
// myapp.micbox.cz is added to an app, createCNameRecord:
//   1. Creates two WEDOS ACME challenge override records so lego's DNS-01
//      challenge stays inside the micbox.cz zone (not hijacked by the wildcard).
//   2. Configures letsencrypt for the app (dns-provider + credentials + resolver).
//   3. Fires letsencrypt:enable in the background — cert issued without blocking.
//
// Required Dokku app env vars:
//   DNS_DOMAIN              — public domain, e.g. "micbox.cz"
//   DNS_WEDOS_EMAIL         — WEDOS account email
//   DNS_WEDOS_WAPI_PASSWORD — WEDOS WAPI password (from Keeper)

const wedos = require('./wedos-client');
const { createRouter } = require('./routes');

const CONFIG_KEYS = ['DNS_DOMAIN', 'DNS_WEDOS_EMAIL', 'DNS_WEDOS_WAPI_PASSWORD'];
const CACHE_TTL = 30_000;

function register(ctx) {
  ctx.registerSensitiveKey('DNS_WEDOS_WAPI_PASSWORD');

  ctx.mountRouter('/api/server-config/wedos-dns', createRouter(ctx.host));

  let cfgCache = null;
  let cfgCacheTime = 0;

  async function readConfig() {
    if (cfgCache && Date.now() - cfgCacheTime < CACHE_TTL) return cfgCache;
    try {
      const dokku = ctx.host.dokku;
      const config = await dokku.getConfig(dokku.appName);
      const domain = config.DNS_DOMAIN || '';
      cfgCache = {
        domain,
        email: config.DNS_WEDOS_EMAIL || '',
        wapiPassword: config.DNS_WEDOS_WAPI_PASSWORD || '',
        // dnsSuffix with leading dot is what the core uses for shouldCreateDns /
        // extractAlias comparisons (matches vapor-dns convention).
        dnsSuffix: domain ? `.${domain}` : '',
        instanceId: 'default',
      };
      cfgCacheTime = Date.now();
      return cfgCache;
    } catch {
      return cfgCache || { domain: '', email: '', wapiPassword: '', dnsSuffix: '', instanceId: 'default' };
    }
  }

  ctx.registerDnsProvider({
    id: 'wedos-dns',
    label: 'WEDOS DNS',
    configKeys: CONFIG_KEYS,

    readConfig,

    clearCache() {
      cfgCache = null;
      cfgCacheTime = 0;
    },

    isConfigured(cfg) {
      return !!(cfg.domain && cfg.email && cfg.wapiPassword);
    },

    credentialsFromBackup(settings) {
      const domain = settings.DNS_DOMAIN || '';
      return {
        domain,
        email: settings.DNS_WEDOS_EMAIL || '',
        wapiPassword: settings.DNS_WEDOS_WAPI_PASSWORD || '',
        dnsSuffix: domain ? `.${domain}` : '',
        instanceId: 'default',
      };
    },

    hasCredentials(cfg) {
      return !!(cfg.domain && cfg.email && cfg.wapiPassword);
    },

    shouldCreateDns(domain, dnsSuffix) {
      if (!dnsSuffix) return false;
      return domain.endsWith(dnsSuffix);
    },

    extractAlias(domain, dnsSuffix) {
      if (!dnsSuffix || !domain.endsWith(dnsSuffix)) return null;
      return domain.slice(0, -dnsSuffix.length);
    },

    // createCNameRecord — called when a *.domain domain is added to an app.
    // Step 1 (sync): WEDOS ACME records — must exist before lego runs.
    // Steps 2-3 (async, fire-and-forget): configure letsencrypt for the app
    // and issue the cert. Runs in the background so the domain-addition API
    // response returns immediately; errors are logged but don't fail the call.
    async createCNameRecord(cfg, alias) {
      const dokku = ctx.host.dokku;

      await wedos.createAcmeRecords(cfg.email, cfg.wapiPassword, cfg.domain, alias);

      // Shell-safe single-quote escaping for the WAPI password.
      const escapedPassword = cfg.wapiPassword.replace(/'/g, "'\"'\"'");

      (async () => {
        try {
          await dokku.exec(`letsencrypt:set ${alias} dns-provider wedos`);
          await dokku.exec(`letsencrypt:set ${alias} dns-provider-WEDOS_USERNAME ${cfg.email}`);
          await dokku.exec(`letsencrypt:set ${alias} dns-provider-WEDOS_WAPI_PASSWORD '${escapedPassword}'`);
          await dokku.exec(`letsencrypt:set ${alias} lego-args "--dns.resolvers ns.wedos.net:53"`);
          await dokku.exec(`letsencrypt:enable ${alias}`);
          dokku.log('RECV', `[wedos-dns] letsencrypt:enable ${alias}: cert issued`);
        } catch (err) {
          dokku.log('ERR', `[wedos-dns] letsencrypt:enable ${alias} failed: ${err.message}`);
        }
      })();

      return {
        success: true,
        alias,
        fullHostName: `${alias}${cfg.dnsSuffix}`,
        instanceId: 'default',
      };
    },

    async deleteCNameRecord(cfg, alias) {
      const dokku = ctx.host.dokku;

      await wedos.deleteAcmeRecords(cfg.email, cfg.wapiPassword, cfg.domain, alias);

      (async () => {
        try {
          await dokku.exec(`letsencrypt:disable ${alias}`);
          dokku.log('RECV', `[wedos-dns] letsencrypt:disable ${alias}: cert removed`);
        } catch (err) {
          dokku.log('ERR', `[wedos-dns] letsencrypt:disable ${alias} failed: ${err.message}`);
        }
      })();

      return { success: true, alias };
    },

    // getDnsCNameRecords — used by the DNS status check in AppDetail.
    // We infer "published" apps from the presence of their _acme-challenge
    // CNAME records in WEDOS (these are created by createCNameRecord above).
    async getDnsCNameRecords(cfg) {
      const records = await wedos.listRecords(cfg.email, cfg.wapiPassword, cfg.domain);
      // Each _acme-challenge.<alias> CNAME we created means <alias> is published.
      return records
        .filter(r => r.rdtype === 'CNAME' && r.name.startsWith('_acme-challenge.'))
        .map(r => ({
          alias: r.name.slice('_acme-challenge.'.length),
          fullHostName: `${r.name.slice('_acme-challenge.'.length)}${cfg.dnsSuffix}`,
          instanceId: 'default',
        }));
    },

    async getInstances(cfg) {
      return [{ instanceId: 'default', name: 'NAS Dokku' }];
    },
  });
}

module.exports = { register };
