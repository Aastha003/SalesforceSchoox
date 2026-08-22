/**
 * Salesforce client using the OAuth 2.0 Client Credentials Flow.
 * Requires an External Client App configured for Client Credentials Flow,
 * with "Issue JSON Web Token (JWT)-based access tokens" DISABLED (the
 * Metadata/SOAP-based tooling needs the classic session-id token format —
 * REST calls here work with either, but keep it disabled for consistency),
 * and a Run-As user that has FLS access to the LMS_* fields on Contact
 * (granted via the Learner_Course_Access permission set).
 */

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken({ loginUrl, clientId, clientSecret }) {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    throw new Error(`Salesforce auth failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = { accessToken: data.access_token, instanceUrl: data.instance_url };
  cachedTokenExpiry = Date.now() + 15 * 60 * 1000; // refresh every 15 min
  return cachedToken;
}

/** Look up the Contact Id for a learner by an identifying field (e.g. email). */
async function findContactIdByEmail(sfCreds, email) {
  const { accessToken, instanceUrl } = await getAccessToken(sfCreds);
  const soql = `SELECT Id FROM Contact WHERE Email = '${email.replace(/'/g, "\\'")}' LIMIT 1`;
  const url = `${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Salesforce query failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.records[0]?.Id || null;
}

/** Patch the LMS_* summary fields on one Contact record. */
async function updateContactLmsSummary(sfCreds, contactId, summaryFields) {
  const { accessToken, instanceUrl } = await getAccessToken(sfCreds);
  const url = `${instanceUrl}/services/data/v60.0/sobjects/Contact/${contactId}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(summaryFields),
  });

  if (!res.ok && res.status !== 204) {
    throw new Error(`Salesforce update failed for Contact ${contactId}: ${res.status} ${await res.text()}`);
  }
}

module.exports = { getAccessToken, findContactIdByEmail, updateContactLmsSummary };
