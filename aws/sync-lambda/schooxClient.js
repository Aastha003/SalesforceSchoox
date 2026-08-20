/**
 * Schoox API client.
 *
 * NOTE: Endpoint paths and response fields below are a best-effort scaffold
 * based on Schoox's typical academy/user/transcript REST structure. Confirm
 * the exact paths, auth header name, and JSON shape against your academy's
 * live Schoox API docs (Schoox > Settings > API, or your Schoox account rep)
 * once API access is granted, and adjust this file accordingly.
 */

const SCHOOX_API_BASE = process.env.SCHOOX_API_BASE || "https://api.schoox.com/v1";
const SCHOOX_ACADEMY_ID = process.env.SCHOOX_ACADEMY_ID; // e.g. "AliSFTesting"

async function schooxRequest(apiKey, path) {
  const res = await fetch(`${SCHOOX_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Schoox API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** List active learners in the academy. */
async function listUsers(apiKey) {
  const data = await schooxRequest(apiKey, `/academies/${SCHOOX_ACADEMY_ID}/users`);
  return data.users || data;
}

/** Get one user's course enrollments + progress (transcript). */
async function getUserTranscript(apiKey, schooxUserId) {
  const data = await schooxRequest(apiKey, `/users/${schooxUserId}/transcripts`);
  return data.transcripts || data;
}

module.exports = { listUsers, getUserTranscript };
