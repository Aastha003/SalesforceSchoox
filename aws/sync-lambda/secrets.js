const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const client = new SecretsManagerClient({});
const cache = new Map();

async function getSecretJSON(secretId) {
  if (cache.has(secretId)) return cache.get(secretId);
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = JSON.parse(res.SecretString);
  cache.set(secretId, value);
  return value;
}

module.exports = { getSecretJSON };
