#!/usr/bin/env node
const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const notificationId = String(process.env.NOTIFICATION_ID || '').trim();
const transport = String(process.env.BLOCKFORK_NOTIFICATION_TRANSPORT || 'openclaw_cli').trim() || 'openclaw_cli';
const dryRunRaw = String(process.env.BLOCKFORK_OPENCLAW_CLI_DRY_RUN || '0').trim();
const dryRun = !/^(0|false|no)$/i.test(dryRunRaw);
const maxRealSends = Number(process.env.BLOCKFORK_MAX_REAL_SENDS || '0');
const commandPath = String(process.env.BLOCKFORK_OPENCLAW_CLI_BIN || '').trim();

if (!notificationId) {
  fail('NOTIFICATION_ID is required');
}
if (transport !== 'openclaw_cli') {
  fail('BLOCKFORK_NOTIFICATION_TRANSPORT must be openclaw_cli');
}
if (dryRun) {
  fail('BLOCKFORK_OPENCLAW_CLI_DRY_RUN must be 0 for real-send acceptance');
}
if (maxRealSends !== 1) {
  fail('BLOCKFORK_MAX_REAL_SENDS must be 1');
}
if (!commandPath) {
  fail('BLOCKFORK_OPENCLAW_CLI_BIN is required');
}

const repoRoot = path.resolve(__dirname, '..');
process.chdir(repoRoot);

const runtime = require(path.join(repoRoot, 'server.js'));

(async () => {
  const result = await runtime.dispatchTaskNotificationById(notificationId, {
    transport,
    dryRun: false,
    commandPath,
    timeoutMs: Math.max(1000, Number(process.env.BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS || '30000')),
    maxRealSends: 1,
  });
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
