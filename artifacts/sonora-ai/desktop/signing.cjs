// Azure Trusted Signing is configured only when every value is present.
// The client secret stays in the environment for the Azure SDK; it is not copied into the builder config.
const SECRET_NAMES = Object.freeze([
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_TRUSTED_SIGNING_ENDPOINT',
  'AZURE_TRUSTED_SIGNING_ACCOUNT',
  'AZURE_TRUSTED_SIGNING_PROFILE',
  'AZURE_TRUSTED_SIGNING_PUBLISHER',
]);

function value(env, name) {
  const text = env?.[name];
  return typeof text === 'string' ? text.trim() : '';
}

function azureTrustedSigning(env = process.env) {
  if (SECRET_NAMES.some(name => !value(env, name))) return null;
  return {
    endpoint: value(env, 'AZURE_TRUSTED_SIGNING_ENDPOINT'),
    codeSigningAccountName: value(env, 'AZURE_TRUSTED_SIGNING_ACCOUNT'),
    certificateProfileName: value(env, 'AZURE_TRUSTED_SIGNING_PROFILE'),
    publisherName: value(env, 'AZURE_TRUSTED_SIGNING_PUBLISHER'),
  };
}

function signingLabel(env = process.env) {
  return azureTrustedSigning(env) ? 'Azure Trusted Signing' : 'Not signed';
}

module.exports = { SECRET_NAMES, azureTrustedSigning, signingLabel };
