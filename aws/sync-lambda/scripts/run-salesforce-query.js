/**
 * Run an arbitrary SOQL SELECT query through the Schoox Sync Lambda
 * External Client App (OAuth Client Credentials Flow) and print the result.
 *
 * Usage:
 *   SF_LOGIN_URL=https://data-speed-169.my.salesforce.com \
 *   SF_CLIENT_ID=<consumer key> \
 *   SF_CLIENT_SECRET=<consumer secret> \
 *   SOQL_QUERY="SELECT Id, Email FROM Contact LIMIT 5" \
 *   node scripts/run-salesforce-query.js
 *
 * Never pass credentials or the query as CLI arguments if they might
 * contain sensitive data — env vars keep them out of shell history / ps.
 */

const { getAccessToken } = require("../salesforceClient");

const loginUrl = process.env.SF_LOGIN_URL || "https://data-speed-169.my.salesforce.com";
const clientId = process.env.SF_CLIENT_ID;
const clientSecret = process.env.SF_CLIENT_SECRET;
const soql =
  process.env.SOQL_QUERY ||
  "SELECT Id, Name, Email, LMS_Active__c, LMS_Courses_Enrolled__c, LMS_Courses_Completed__c, " +
    "LMS_Overall_Percent_Complete__c, LMS_Estimated_Hours_Remaining__c, LMS_Next_Due_Date__c, " +
    "LMS_Last_Completed_Date__c, LMS_Learning_History__c, LMS_Last_Synced__c " +
    "FROM Contact WHERE LMS_Last_Synced__c != null ORDER BY LMS_Last_Synced__c DESC";

async function main() {
  if (!clientId || !clientSecret) {
    console.error("Set SF_CLIENT_ID and SF_CLIENT_SECRET (and optionally SF_LOGIN_URL, SOQL_QUERY) before running.");
    process.exit(1);
  }

  const { accessToken, instanceUrl } = await getAccessToken({ loginUrl, clientId, clientSecret });

  const url = `${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Query failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  console.log(`Query: ${soql}`);
  console.log(`Records returned: ${data.totalSize}\n`);
  console.log(JSON.stringify(data.records, null, 2));
}

main().catch((err) => {
  console.error("Query FAILED:", err.message);
  process.exit(1);
});
