// WEDOS WAPI client.
//
// Talks to https://api.wedos.com/wapi/json using form-encoded POST.
// Auth token: sha1( sha1(password).hex + Prague_hour_2digits )
// WEDOS uses Prague local time (Europe/Prague), not UTC.
//
// Required config: email (WEDOS login), wapiPassword (WAPI password, not the
// account password), domain (e.g. "micbox.cz").

const crypto = require('crypto');
const https = require('https');

const WAPI_ENDPOINT = 'https://api.wedos.com/wapi/json';

function sha1hex(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

function authToken(wapiPassword) {
  const hour = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', hour12: false }).padStart(2, '0');
  return sha1hex(sha1hex(wapiPassword) + hour);
}

async function wapiRequest(email, wapiPassword, command, data = {}) {
  const body = JSON.stringify({
    request: {
      user: email,
      auth: authToken(wapiPassword),
      test: 0,
      command,
      data,
    },
  });

  const payload = 'request=' + encodeURIComponent(body);
  const url = new URL(WAPI_ENDPOINT);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const code = parsed?.response?.code;
          if (code !== 1000 && code !== 1001) {
            const msg = parsed?.response?.result || `WEDOS WAPI error code ${code}`;
            return reject(new Error(`WEDOS WAPI [${command}]: ${msg}`));
          }
          resolve(parsed?.response?.data || {});
        } catch {
          reject(new Error(`WEDOS WAPI [${command}]: invalid response: ${raw.substring(0, 200)}`));
        }
      });
    });
    req.on('error', e => reject(new Error(`WEDOS WAPI request failed: ${e.message}`)));
    req.setTimeout(30_000, () => {
      req.destroy(new Error('WEDOS WAPI request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

// List all DNS records for a domain.
async function listRecords(email, wapiPassword, domain) {
  const data = await wapiRequest(email, wapiPassword, 'dns-rows', { domain });
  const rows = data?.row || [];
  return Array.isArray(rows) ? rows : [rows];
}

// Commit pending zone changes. Required after any add/delete.
async function commitZone(email, wapiPassword, domain) {
  await wapiRequest(email, wapiPassword, 'dns-rows-commit', { name: domain });
}

// Add a single DNS record. Silently succeeds if an identical record already
// exists (WEDOS returns code 1001 for duplicate, treated as OK above).
async function addRecord(email, wapiPassword, domain, name, rdtype, rdata, ttl = 300) {
  await wapiRequest(email, wapiPassword, 'dns-rows-add', {
    domain,
    name,
    ttl,
    rdtype,
    rdata,
  });
}

// Delete a record by its WEDOS row ID.
async function deleteRecordById(email, wapiPassword, domain, rowId) {
  await wapiRequest(email, wapiPassword, 'dns-row-delete-id', {
    domain,
    row_id: String(rowId),
  });
}

// Create an explicit CNAME record for a publicly-facing app.
// WEDOS authoritative nameservers do not expand wildcard CNAMEs for individual
// subdomain queries, so an explicit per-app record is required.
async function createAppRecords(email, wapiPassword, domain, alias, cnameTarget) {
  // Normalise: CNAME rdata must end with a dot for absolute hostnames.
  const target = cnameTarget.endsWith('.') ? cnameTarget : `${cnameTarget}.`;
  await addRecord(email, wapiPassword, domain, alias, 'CNAME', target, 1800);
  await commitZone(email, wapiPassword, domain);
}

// Delete the CNAME record created by createAppRecords for <alias>.
async function deleteAppRecords(email, wapiPassword, domain, alias) {
  const records = await listRecords(email, wapiPassword, domain);
  const toDelete = records.filter(r => r.name === alias);
  if (toDelete.length === 0) return;
  for (const r of toDelete) {
    await deleteRecordById(email, wapiPassword, domain, r.ID);
  }
  await commitZone(email, wapiPassword, domain);
}

module.exports = {
  listRecords,
  createAppRecords,
  deleteAppRecords,
};
