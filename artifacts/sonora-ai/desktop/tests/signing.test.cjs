const test = require('node:test');
const assert = require('node:assert/strict');
const { SECRET_NAMES, azureTrustedSigning, signingLabel } = require('../signing.cjs');

const complete = {
  AZURE_TENANT_ID: 'tenant',
  AZURE_CLIENT_ID: 'client',
  AZURE_CLIENT_SECRET: 'super-secret',
  AZURE_TRUSTED_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net/',
  AZURE_TRUSTED_SIGNING_ACCOUNT: 'sonora-signing',
  AZURE_TRUSTED_SIGNING_PROFILE: 'sonora-public',
  AZURE_TRUSTED_SIGNING_PUBLISHER: 'CN=Sonora',
};

test('Azure Trusted Signing is used only when every secret is present, and the secret stays out of the builder options', () => {
  assert.equal(azureTrustedSigning({}), null);
  assert.equal(signingLabel({}), 'Not signed');
  for (const name of SECRET_NAMES) {
    const partial = { ...complete, [name]: '  ' };
    assert.equal(azureTrustedSigning(partial), null, name);
  }
  const options = azureTrustedSigning(complete);
  assert.equal(options.publisherName, 'CN=Sonora');
  assert.equal(options.codeSigningAccountName, 'sonora-signing');
  assert.equal(options.certificateProfileName, 'sonora-public');
  assert.equal(signingLabel(complete), 'Azure Trusted Signing');
  assert.equal(JSON.stringify(options).includes('super-secret'), false);
});
