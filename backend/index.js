// WEDOS DNS plugin backend.
//
// Fills the DNS provider slot in dokku-manager. When a domain like
// myapp.micbox.cz is added to an app, createCNameRecord:
//   1. Creates an explicit per-app CNAME record in WEDOS (wildcard CNAMEs are
//      not expanded by WEDOS authoritative nameservers for subdomain queries).
//   2. Configures letsencrypt for the app (dns-provider + credentials + resolver).
//   3. Fires letsencrypt:enable in the background — cert issued without blocking.
//
// Required Dokku app env vars:
//   DNS_DOMAIN              — public domain, e.g. "micbox.cz"
//   DNS_WEDOS_EMAIL         — WEDOS account email
//   DNS_WEDOS_WAPI_PASSWORD — WEDOS WAPI password (from Keeper)
//   DNS_CNAME_TARGET        — DDNS hostname all app CNAMEs point to

const wedos = require('./wedos-client');
const { createRouter } = require('./routes');

const CONFIG_KEYS = ['DNS_DOMAIN', 'DNS_WEDOS_EMAIL', 'DNS_WEDOS_WAPI_PASSWORD', 'DNS_CNAME_TARGET'];
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
        cnameTarget: config.DNS_CNAME_TARGET || '',
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
      return !!(cfg.domain && cfg.email && cfg.wapiPassword && cfg.cnameTarget);
    },

    credentialsFromBackup(settings) {
      const domain = settings.DNS_DOMAIN || '';
      return {
        domain,
        email: settings.DNS_WEDOS_EMAIL || '',
        wapiPassword: settings.DNS_WEDOS_WAPI_PASSWORD || '',
        cnameTarget: settings.DNS_CNAME_TARGET || '',
        dnsSuffix: domain ? `.${domain}` : '',
        instanceId: 'default',
      };
    },

    hasCredentials(cfg) {
      return !!(cfg.domain && cfg.email && cfg.wapiPassword && cfg.cnameTarget);
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
    // Step 1 (sync): create the explicit per-app CNAME record in WEDOS.
    // Steps 2-3 (async, fire-and-forget): configure letsencrypt for the app
    // and issue the cert. Runs in the background so the domain-addition API
    // response returns immediately; errors are logged but don't fail the call.
    async createCNameRecord(cfg, alias) {
      const dokku = ctx.host.dokku;

      await wedos.createAppRecords(cfg.email, cfg.wapiPassword, cfg.domain, alias, cfg.cnameTarget);

      (async () => {
        let removedDomains = [];
        try {
          await dokku.exec(`letsencrypt:set ${alias} dns-provider wedos`);
          await dokku.exec(`letsencrypt:set ${alias} dns-provider-WEDOS_USERNAME ${cfg.email}`);
          // Single-quote the password so spaces/specials survive bash parsing in the
          // Dokku SSH forced command. Use ''"'"' for any literal ' inside the value.
          const quotedPassword = "'" + cfg.wapiPassword.replace(/'/g, "'\"'\"'") + "'";
          await dokku.exec(`letsencrypt:set ${alias} dns-provider-WEDOS_WAPI_PASSWORD ${quotedPassword}`);
          await dokku.exec(`letsencrypt:set ${alias} lego-args --dns.resolvers=ns.wedos.net:53`);

          // letsencrypt:enable includes ALL app domains in the SAN. Domains with
          // non-public TLDs (e.g. .nas) cause Let's Encrypt to reject the order.
          // Temporarily remove them, issue the cert, then restore.
          const allDomains = await dokku.getDomains(alias);
          removedDomains = allDomains.filter(d => !d.endsWith(`.${cfg.domain}`));
          for (const d of removedDomains) {
            await dokku.removeDomain(alias, d);
          }

          await dokku.exec(`letsencrypt:enable ${alias}`);
          dokku.log('RECV', `[wedos-dns] letsencrypt:enable ${alias}: cert issued`);
        } catch (err) {
          dokku.log('ERR', `[wedos-dns] letsencrypt:enable ${alias} failed: ${err.message}`);
        } finally {
          for (const d of removedDomains) {
            await dokku.addDomain(alias, d).catch(() => {});
          }
        }
      })();

      return {
        success: true,
        alias,
        fullHostName: cfg.cnameTarget,
        instanceId: 'default',
      };
    },

    async deleteCNameRecord(cfg, alias) {
      const dokku = ctx.host.dokku;

      await wedos.deleteAppRecords(cfg.email, cfg.wapiPassword, cfg.domain, alias);

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
    // Returns the explicit per-app CNAME records (non-underscore, non-wildcard).
    async getDnsCNameRecords(cfg) {
      const records = await wedos.listRecords(cfg.email, cfg.wapiPassword, cfg.domain);
      return records
        .filter(r => r.rdtype === 'CNAME' && !r.name.startsWith('_') && r.name !== '*')
        .map(r => ({
          alias: r.name,
          fullHostName: r.rdata.replace(/\.$/, ''),
          instanceId: 'default',
        }));
    },

    async getInstances(cfg) {
      return [{ instanceId: 'default', name: 'NAS Dokku' }];
    },
  });
}

module.exports = { register };
