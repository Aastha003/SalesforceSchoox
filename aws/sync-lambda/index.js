const { getSecretJSON } = require("./secrets");
const schoox = require("./schooxClient");
const sf = require("./salesforceClient");
const { buildContactLmsSummary } = require("./transform");

const SCHOOX_SECRET_ID = process.env.SCHOOX_SECRET_ID;
const SALESFORCE_SECRET_ID = process.env.SALESFORCE_SECRET_ID;

exports.handler = async () => {
  const [schooxSecret, sfSecret] = await Promise.all([
    getSecretJSON(SCHOOX_SECRET_ID),
    getSecretJSON(SALESFORCE_SECRET_ID),
  ]);

  const users = await schoox.listUsers(schooxSecret.apiKey);

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

      const transcript = await schoox.getUserTranscript(schooxSecret.apiKey, user.id);
      const summary = buildContactLmsSummary(transcript);
      await sf.updateContactLmsSummary(sfSecret, contactId, summary);
      synced++;
    } catch (err) {
      failed++;
      console.error(`Failed syncing Schoox user ${user.id}:`, err);
    }
  }

  const result = { synced, skipped, failed, usersProcessed: users.length };
  console.log("Sync complete", result);
  return result;
};
