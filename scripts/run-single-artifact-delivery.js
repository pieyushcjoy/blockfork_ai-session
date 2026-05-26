#!/usr/bin/env node
const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    real: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--real') {
      args.real = true;
      continue;
    }
    if (token === '--dry-run') {
      args.real = false;
      continue;
    }
    if (token === '--artifact-id' || token === '--notification-id' || token === '--relay-label' || token === '--command-path') {
      args[token.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--max-real-sends') {
      args.maxRealSends = Number(argv[i + 1] || '0');
      i += 1;
      continue;
    }
  }
  return args;
}

const argv = parseArgs(process.argv.slice(2));
const notificationId = String(argv.notificationId || process.env.NOTIFICATION_ID || '').trim();
const artifactId = String(argv.artifactId || process.env.ARTIFACT_ID || '').trim();
const relayLabel = String(argv.relayLabel || process.env.BLOCKFORK_ARTIFACT_DELIVERY_RELAY_LABEL || '').trim();
const transport = String(process.env.BLOCKFORK_NOTIFICATION_TRANSPORT || 'openclaw_cli').trim() || 'openclaw_cli';
const dryRun = !argv.real;
const maxRealSends = Number.isFinite(argv.maxRealSends) ? argv.maxRealSends : Number(process.env.BLOCKFORK_MAX_REAL_SENDS || '0');
const commandPath = String(argv.commandPath || process.env.BLOCKFORK_OPENCLAW_CLI_BIN || '').trim();

if (!notificationId && !artifactId) {
  fail('Either --notification-id or --artifact-id is required');
}
if (!relayLabel) {
  fail('--relay-label is required');
}
if (transport !== 'openclaw_cli') {
  fail('BLOCKFORK_NOTIFICATION_TRANSPORT must be openclaw_cli');
}
if (!dryRun && maxRealSends !== 1) {
  fail('BLOCKFORK_MAX_REAL_SENDS must be 1 for real delivery');
}
if (!commandPath) {
  fail('BLOCKFORK_OPENCLAW_CLI_BIN is required');
}

const repoRoot = path.resolve(__dirname, '..');
process.chdir(repoRoot);

const runtime = require(path.join(repoRoot, 'server.js'));

(async () => {
  const result = await runtime.dispatchArtifactDeliveryById(notificationId || artifactId, {
    artifactId: notificationId ? '' : artifactId,
    relayLabel,
    transport,
    dryRun,
    commandPath,
    timeoutMs: Math.max(1000, Number(process.env.BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS || '30000')),
    maxRealSends: dryRun ? 0 : 1,
    overrideEligibility: true,
    allowDelivered: false,
  });
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
