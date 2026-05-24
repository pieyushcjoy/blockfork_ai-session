#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-relay-doctor-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node
require_cmd mktemp
require_cmd chmod

mkdir -p "$TMP_DIR/workspace" "$TMP_DIR/bin" "$TMP_DIR/state/service-env"
cp "$REPO_ROOT/server.js" "$TMP_DIR/server.js"
cp "$REPO_ROOT/package.json" "$TMP_DIR/package.json"
ln -s "$REPO_ROOT/node_modules" "$TMP_DIR/node_modules"
mkdir -p "$TMP_DIR/public"
NODE_BIN_DIR="$(dirname "$(command -v node)")"

cat > "$TMP_DIR/bin/openclaw" <<'NODE'
#!/usr/bin/env node
const fs = require('fs');

const args = process.argv.slice(2);
const mode = process.env.FAKE_OPENCLAW_MODE || 'dry_run_success';
const capturePath = process.env.FAKE_OPENCLAW_CAPTURE_PATH || '';

function readFlag(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || '' : '';
}

if (capturePath) {
  fs.appendFileSync(capturePath, `${JSON.stringify({ argv: args, mode })}\n`);
}

if (mode === 'failure') {
  console.error('simulated openclaw relay failure');
  process.exit(17);
}

const target = readFlag('--target');
const threadId = readFlag('--thread-id');
const message = readFlag('--message');

process.stdout.write(`${JSON.stringify({
  action: 'send',
  channel: 'telegram',
  dryRun: true,
  handledBy: 'core',
  payload: {
    channel: 'telegram',
    to: `telegram:${target}`,
    via: 'direct',
    mediaUrl: null,
    dryRun: true,
    message,
    ...(threadId ? { threadId } : {}),
  },
})}\n`);
NODE

chmod +x "$TMP_DIR/bin/openclaw"

cat > "$TMP_DIR/state/service-env/ai.openclaw.cleanbench.env" <<EOF
OPENCLAW_CONFIG_PATH=$TMP_DIR/state/openclaw.json
OPENCLAW_STATE_DIR=$TMP_DIR/state
PATH=$NODE_BIN_DIR:/usr/bin:/bin
EOF
touch "$TMP_DIR/state/openclaw.json"

node - "$REPO_ROOT" "$TMP_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const fetchImpl = global.fetch || require('node-fetch');
const repoRoot = process.argv[2];
const tmpDir = process.argv[3];
const capturePath = path.join(tmpDir, 'invocations.jsonl');

process.chdir(tmpDir);
process.env.BLOCKFORK_ADMIN_SECRET = 'test-secret';
process.env.BLOCKFORK_NOTIFICATION_TRANSPORT = 'openclaw_cli';
process.env.BLOCKFORK_OPENCLAW_CLI_BIN = path.join(tmpDir, 'bin', 'openclaw');
process.env.BLOCKFORK_OPENCLAW_CLI_DRY_RUN = '1';
process.env.BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS = '5000';
process.env.FAKE_OPENCLAW_CAPTURE_PATH = capturePath;

const runtime = require(path.join(tmpDir, 'server.js'));
const { app, ensureBillingDb } = runtime;

async function withServer(run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function jsonRequest(baseUrl, pathName, options = {}) {
  const response = await fetchImpl(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'content-type': 'application/json',
      'x-admin-secret': 'test-secret',
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${pathName}: ${JSON.stringify(body || {})}`);
  }
  return body;
}

(async () => {
  const db = await ensureBillingDb();
  const columns = [];
  const schemaStmt = db.prepare('PRAGMA table_info(openclaw_relay_configs)');
  while (schemaStmt.step()) {
    columns.push(String(schemaStmt.getAsObject().name || ''));
  }
  schemaStmt.free();

  for (const column of ['relay_label', 'transport', 'cli_bin', 'env_file', 'config_path', 'state_dir', 'chat_id', 'thread_id', 'probe_message', 'notes', 'created_at', 'updated_at']) {
    assert(columns.includes(column), `Expected relay config column missing: ${column}`);
  }
  for (const secretColumn of ['telegram_bot_token', 'gateway_token', 'paired_device_secret', 'bot_token', 'token']) {
    assert(!columns.includes(secretColumn), `Secret column should not exist: ${secretColumn}`);
  }

  await withServer(async (baseUrl) => {
    const cleanbenchEnv = path.join(tmpDir, 'state/service-env/ai.openclaw.cleanbench.env');
    const cleanbenchConfigPath = path.join(tmpDir, 'state/openclaw.json');
    const cleanbenchStateDir = path.join(tmpDir, 'state');
    const cliBin = path.join(tmpDir, 'bin/openclaw');

    const savePayload = {
      relay_label: 'cleanbench',
      transport: 'openclaw_cli',
      service_name: 'ai.openclaw.cleanbench',
      profile_name: 'cleanbench',
      cli_bin: cliBin,
      env_file: cleanbenchEnv,
      config_path: cleanbenchConfigPath,
      state_dir: cleanbenchStateDir,
      chat_id: '8407120350',
      thread_id: '',
      probe_message: 'BlockFork relay doctor dry-run',
      notes: 'safe relay config only',
      telegram_bot_token: 'secret-token',
      gateway_token: 'gateway-secret',
      paired_device_secret: 'device-secret',
    };

    const saved = await jsonRequest(baseUrl, '/admin/api/openclaw-relays/cleanbench', {
      method: 'PUT',
      body: JSON.stringify(savePayload),
    });

    assert(saved.data.relay_label === 'cleanbench', 'Saved relay label mismatch');
    assert(saved.data.transport === 'openclaw_cli', 'Saved transport mismatch');
    assert(saved.data.cli_bin === cliBin, 'Saved CLI path mismatch');
    assert(saved.data.env_file === cleanbenchEnv, 'Saved env file mismatch');
    assert(saved.data.config_path === cleanbenchConfigPath, 'Saved config path mismatch');
    assert(saved.data.state_dir === cleanbenchStateDir, 'Saved state dir mismatch');
    assert(saved.data.chat_id === '8407120350', 'Saved chat id mismatch');
    assert(saved.data.telegram_bot_token === undefined, 'Secret field leaked into saved response');
    assert(saved.data.gateway_token === undefined, 'Gateway token leaked into saved response');
    assert(saved.data.paired_device_secret === undefined, 'Device secret leaked into saved response');

    const list = await jsonRequest(baseUrl, '/admin/api/openclaw-relays');
    assert(Number(list.count || 0) === 1, 'Relay list should contain exactly one config');
    assert(Array.isArray(list.data) && list.data.length === 1, 'Relay list payload malformed');
    assert(list.data[0].relay_label === 'cleanbench', 'Relay list missing cleanbench');

    const cleanbenchDoctor = await jsonRequest(baseUrl, '/admin/api/openclaw-relays/cleanbench/doctor', {
      method: 'POST',
      body: JSON.stringify({ probe: true }),
    });

    assert(cleanbenchDoctor.data.readiness === 'ready', `Expected ready relay, got ${cleanbenchDoctor.data.readiness}`);
    assert(Array.isArray(cleanbenchDoctor.data.blockers) && cleanbenchDoctor.data.blockers.length === 0, 'Cleanbench relay should have no blockers');
    assert(Array.isArray(cleanbenchDoctor.data.commands) && cleanbenchDoctor.data.commands.length >= 2, 'Expected setup commands');
    assert(cleanbenchDoctor.data.commands[0].startsWith('source '), 'First command should source the env file');
    assert(cleanbenchDoctor.data.commands[1].includes('--dry-run --json'), 'Probe command must be a dry-run JSON send');
    assert(cleanbenchDoctor.data.commands[1].includes(`OPENCLAW_CONFIG_PATH='${cleanbenchConfigPath}'`), 'Probe command should include config path');
    assert(cleanbenchDoctor.data.commands[1].includes(`OPENCLAW_STATE_DIR='${cleanbenchStateDir}'`), 'Probe command should include state dir');
    assert(cleanbenchDoctor.data.commands[1].includes(`'${cliBin}'`), 'Probe command should use the configured CLI path');
    assert(cleanbenchDoctor.data.probe && cleanbenchDoctor.data.probe.ok === true, 'Probe should succeed');
    assert(cleanbenchDoctor.data.probe.stdout_json && cleanbenchDoctor.data.probe.stdout_json.action === 'send', 'Probe stdout should confirm send action');
    assert(cleanbenchDoctor.data.probe.stdout_json.dryRun === true, 'Probe should be dry-run');
    assert(cleanbenchDoctor.data.probe.stdout_json.payload && cleanbenchDoctor.data.probe.stdout_json.payload.to === 'telegram:8407120350', 'Probe target mismatch');
    assert(
      cleanbenchDoctor.data.probe.stdout_json.payload &&
        (cleanbenchDoctor.data.probe.stdout_json.payload.chatId === '8407120350' ||
          cleanbenchDoctor.data.probe.stdout_json.payload.threadId === undefined),
      'Probe payload should preserve the expected target metadata'
    );

    const probeInvocationLines = fs.existsSync(capturePath)
      ? fs.readFileSync(capturePath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];
    assert(probeInvocationLines.length === 1, `Expected exactly one probe invocation, saw ${probeInvocationLines.length}`);
    assert(probeInvocationLines[0].argv.includes('--dry-run'), 'Probe invocation must include --dry-run');
    assert(probeInvocationLines[0].argv.includes('--json'), 'Probe invocation must include --json');
    assert(probeInvocationLines[0].argv.includes('--target'), 'Probe invocation must include --target');

    const blockedDoctor = await jsonRequest(baseUrl, '/admin/api/openclaw-relays/broken/doctor', {
      method: 'POST',
      body: JSON.stringify({
        cli_bin: path.join(tmpDir, 'missing-openclaw'),
        env_file: path.join(tmpDir, 'missing.env'),
        config_path: path.join(tmpDir, 'missing-openclaw.json'),
        state_dir: path.join(tmpDir, 'missing-state'),
        chat_id: '8407120350',
        probe: false,
      }),
    });

    assert(blockedDoctor.data.readiness === 'blocked', 'Expected blocked readiness for incomplete relay config');
    const blockerKeys = new Set((blockedDoctor.data.blockers || []).map((item) => item.key));
    for (const key of ['cli_exists', 'env_exists', 'config_exists', 'state_dir_exists']) {
      assert(blockerKeys.has(key), `Expected blocker missing: ${key}`);
    }
  });

  console.log('PASS');
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
