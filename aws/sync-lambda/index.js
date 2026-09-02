const { getSecretJSON } = require("./secrets");
const schoox = require("./schooxClient");
const sf = require("./salesforceClient");
const { buildContactLmsSummary } = require("./transform");

const SCHOOX_SECRET_ID = process.env.SCHOOX_SECRET_ID;
const SALESFORCE_SECRET_ID = process.env.SALESFORCE_SECRET_ID;

exports.handler = async (event) => {
  // Invoked either by EventBridge/direct SDK invoke (event has no requestContext,
  // return the plain result object) or via the Lambda Function URL — a manual
  // "sync now" trigger clicked from a Salesforce Custom Button (event.requestContext
  // is present, must return an HTTP-shaped response).
  const isHttpInvocation = Boolean(event && event.requestContext);

  const [schooxSecret, sfSecret] = await Promise.all([
    getSecretJSON(SCHOOX_SECRET_ID),
    getSecretJSON(SALESFORCE_SECRET_ID),
  ]);

  const users = await schoox.listUsers(schooxSecret.apiKey);
  const transcripts = await schoox.buildLearnerTranscripts(schooxSecret.apiKey);

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    try {
      const contactId = await sf.findContactIdByEmail(sfSecret, user.email);
      if (!contactId) {
        console.warn(`No matching Salesforce Contact for Schoox user ${user.id} (${user.email}); skipping`);
        skipped++;
        continue;
      }

      const courseEntries = transcripts.get(user.id) || [];
      const summary = buildContactLmsSummary(courseEntries, user.active);
      await sf.updateContactLmsSummary(sfSecret, contactId, summary);
      synced++;
    } catch (err) {
      failed++;
      console.error(`Failed syncing Schoox user ${user.id}:`, err);
    }
  }

  const result = { synced, skipped, failed, usersProcessed: users.length };
  console.log("Sync complete", result);

  if (isHttpInvocation) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: `<html><body style="font-family:sans-serif;padding:2rem;">
        <h2>Schoox → Salesforce sync complete</h2>
        <p>Synced: <b>${synced}</b> &nbsp; Skipped: <b>${skipped}</b> &nbsp; Failed: <b>${failed}</b> &nbsp; Total learners: <b>${users.length}</b></p>
        <p>You can close this tab.</p>
      </body></html>`,
    };
  }

  return result;
};
