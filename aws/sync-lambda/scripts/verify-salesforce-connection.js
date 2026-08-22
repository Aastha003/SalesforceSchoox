/**
 * Standalone connectivity check for the "Schoox Sync Lambda" External Client
 * App (OAuth 2.0 Client Credentials Flow) — independent of a Lambda deploy,
 * so the Salesforce side of the integration can be verified on its own.
 *
 * Usage:
 *   SF_LOGIN_URL=https://data-speed-169.my.salesforce.com \
 *   SF_CLIENT_ID=<consumer key> \
 *   SF_CLIENT_SECRET=<consumer secret> \
 *   node scripts/verify-salesforce-connection.js
 *
 * Never pass credentials as CLI arguments (they'd show up in shell history /
 * process listings) — always via these env vars.
 */

const { getAccessToken } = require("../salesforceClient");

const loginUrl = process.env.SF_LOGIN_URL || "https://data-speed-169.my.salesforce.com";
const clientId = process.env.SF_CLIENT_ID;
const clientSecret = process.env.SF_CLIENT_SECRET;

async function main() {
  if (!clientId || !clientSecret) {
    console.error("Set SF_CLIENT_ID and SF_CLIENT_SECRET (and optionally SF_LOGIN_URL) before running.");
    process.exit(1);
  }

  console.log(`Authenticating to ${loginUrl} via Client Credentials Flow...`);
  const { accessToken, instanceUrl } = await getAccessToken({ loginUrl, clientId, clientSecret });
  console.log(`Token issued. instance_url = ${instanceUrl}`);

  const idRes = await fetch(`${instanceUrl}/services/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!idRes.ok) throw new Error(`userinfo failed: ${idRes.status} ${await idRes.text()}`);
  const identity = await idRes.json();
  console.log(`Authenticated as: ${identity.preferred_username || identity.email} (user id ${identity.user_id})`);

  const soql = "SELECT COUNT(Id) total, COUNT(LMS_Last_Synced__c) synced FROM Contact";
  const queryRes = await fetch(`${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!queryRes.ok) {
    const body = await queryRes.text();
    console.error(`LMS_* field access check FAILED (${queryRes.status}): ${body}`);
    console.error("Likely cause: the Run-As user is missing the Learner_Course_Access permission set.");
    process.exit(1);
  }
  const { records } = await queryRes.json();
  const { total, synced } = records[0];
  console.log(`LMS_* field access confirmed. Contacts: ${total} total, ${synced} with a recorded sync.`);
  console.log("Connection to the Schoox Sync Lambda External Client App is fully verified.");
}

main().catch((err) => {
  console.error("Connection check FAILED:", err.message);
  process.exit(1);
});
