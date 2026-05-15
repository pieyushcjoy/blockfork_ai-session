#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3100}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$REPO_ROOT/billing.sqlite"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

wait_for_listener() {
  local start_time now
  start_time="$(date +%s)"
  while true; do
    if lsof -nP -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    now="$(date +%s)"
    if (( now - start_time >= STARTUP_TIMEOUT_SECONDS )); then
      echo "Runtime not listening on 127.0.0.1:3100 after ${STARTUP_TIMEOUT_SECONDS}s" >&2
      exit 1
    fi
    sleep 1
  done
}

require_cmd curl
require_cmd node
require_cmd lsof

echo "[1/6] Waiting for runtime listener"
wait_for_listener

echo "[2/6] Creating isolated session"
SESSION_JSON="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"
LIVE_KEY="$(printf '%s' "$SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.public_api_key||j.session?.public_api_key||"")})')"
SESSION_ID="$(printf '%s' "$SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.session_id||j.session?.session_id||"")})')"

if [[ -z "$LIVE_KEY" || -z "$SESSION_ID" ]]; then
  echo "Failed to create isolated session for recovery verification" >&2
  exit 1
fi

echo "[3/6] Verifying retrying path, stale finalize rejection, and duplicate lease prevention"
node - "$REPO_ROOT" "$SESSION_ID" <<'NODE'
const path = require('path');
const runtime = require(path.join(process.argv[2], 'server.js'));
const sessionId = process.argv[3];

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

(async () => {
  const retryBase = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-retry-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_retry_created',
  });
  await runtime.transitionExecution(retryBase.execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    actorSource: 'verification',
    reasonCode: 'verify_retry_queued',
  });
  const retryLease1 = await runtime.acquireExecutionLease(retryBase.execution.execution_id, {
    requestId: retryBase.execution.last_request_id,
    actorSource: 'verification',
    isStreaming: true,
  });
  await runtime.transitionExecutionWithLease(retryBase.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'verify_retry_running',
    leaseId: retryLease1.lease_id,
    leaseHolder: retryLease1.lease_holder,
    leaseEpoch: retryLease1.lease_epoch,
  });
  await runtime.transitionExecutionWithLease(retryBase.execution.execution_id, runtime.EXECUTION_STATES.RETRYING, {
    actorSource: 'verification',
    reasonCode: 'execution_retrying',
    leaseId: retryLease1.lease_id,
    leaseHolder: retryLease1.lease_holder,
    leaseEpoch: retryLease1.lease_epoch,
  });
  const retryLease2 = await runtime.acquireExecutionLease(retryBase.execution.execution_id, {
    requestId: retryBase.execution.last_request_id,
    actorSource: 'verification',
    isStreaming: true,
  });
  await runtime.transitionExecutionWithLease(retryBase.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'execution_retry_resumed',
    leaseId: retryLease2.lease_id,
    leaseHolder: retryLease2.lease_holder,
    leaseEpoch: retryLease2.lease_epoch,
  });
  await runtime.transitionExecutionWithLease(retryBase.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    actorSource: 'verification',
    reasonCode: 'verify_retry_completed',
    leaseId: retryLease2.lease_id,
    leaseHolder: retryLease2.lease_holder,
    leaseEpoch: retryLease2.lease_epoch,
    clearLease: true,
  });

  const staleBase = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-stale-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_stale_created',
  });
  await runtime.transitionExecution(staleBase.execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    actorSource: 'verification',
    reasonCode: 'verify_stale_queued',
  });
  const staleLease1 = await runtime.acquireExecutionLease(staleBase.execution.execution_id, {
    requestId: staleBase.execution.last_request_id,
    actorSource: 'verification',
    isStreaming: true,
  });
  await runtime.transitionExecutionWithLease(staleBase.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'verify_stale_running',
    leaseId: staleLease1.lease_id,
    leaseHolder: staleLease1.lease_holder,
    leaseEpoch: staleLease1.lease_epoch,
  });
  await runtime.transitionExecutionWithLease(staleBase.execution.execution_id, runtime.EXECUTION_STATES.RETRYING, {
    actorSource: 'verification',
    reasonCode: 'execution_retrying',
    leaseId: staleLease1.lease_id,
    leaseHolder: staleLease1.lease_holder,
    leaseEpoch: staleLease1.lease_epoch,
  });
  const staleLease2 = await runtime.acquireExecutionLease(staleBase.execution.execution_id, {
    requestId: staleBase.execution.last_request_id,
    actorSource: 'verification',
    isStreaming: true,
  });
  await runtime.transitionExecutionWithLease(staleBase.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'execution_retry_resumed',
    leaseId: staleLease2.lease_id,
    leaseHolder: staleLease2.lease_holder,
    leaseEpoch: staleLease2.lease_epoch,
  });
  const rejected = await runtime.transitionExecutionWithLease(staleBase.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    actorSource: 'verification',
    reasonCode: 'verify_stale_finalize_old_lease',
    leaseId: staleLease1.lease_id,
    leaseHolder: staleLease1.lease_holder,
    leaseEpoch: staleLease1.lease_epoch,
    clearLease: true,
  });
  assert(rejected.rejected === true, 'Old lease finalize was not rejected');

  const staleCurrent = await runtime.getExecutionById(staleBase.execution.execution_id);
  assert(staleCurrent.current_state === runtime.EXECUTION_STATES.RUNNING, `Execution changed unexpectedly after stale finalize: ${staleCurrent.current_state}`);
  await runtime.transitionExecutionWithLease(staleBase.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    actorSource: 'verification',
    reasonCode: 'verify_stale_finalize_current_lease',
    leaseId: staleLease2.lease_id,
    leaseHolder: staleLease2.lease_holder,
    leaseEpoch: staleLease2.lease_epoch,
    clearLease: true,
  });

  const noSecondLeaseBase = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-dup-lease-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_dup_lease_created',
  });
  await runtime.transitionExecution(noSecondLeaseBase.execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    actorSource: 'verification',
    reasonCode: 'verify_dup_lease_queued',
  });
  const firstLease = await runtime.acquireExecutionLease(noSecondLeaseBase.execution.execution_id, {
    requestId: noSecondLeaseBase.execution.last_request_id,
    actorSource: 'verification',
    isStreaming: true,
  });
  await runtime.transitionExecutionWithLease(noSecondLeaseBase.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'verify_dup_lease_running',
    leaseId: firstLease.lease_id,
    leaseHolder: firstLease.lease_holder,
    leaseEpoch: firstLease.lease_epoch,
  });
  let secondLeaseRejected = false;
  try {
    await runtime.acquireExecutionLease(noSecondLeaseBase.execution.execution_id, {
      requestId: noSecondLeaseBase.execution.last_request_id,
      actorSource: 'verification',
      isStreaming: true,
    });
  } catch (error) {
    secondLeaseRejected = true;
  }
  assert(secondLeaseRejected, 'Second lease acquisition unexpectedly succeeded while execution was running');
  await runtime.transitionExecutionWithLease(noSecondLeaseBase.execution.execution_id, runtime.EXECUTION_STATES.FAILED, {
    actorSource: 'verification',
    reasonCode: 'verify_dup_lease_failed',
    leaseId: firstLease.lease_id,
    leaseHolder: firstLease.lease_holder,
    leaseEpoch: firstLease.lease_epoch,
    clearLease: true,
  });
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE

echo "[4/6] Verifying deterministic recovery classification"
RECOVERY_EXECUTION_ID="$(node - "$REPO_ROOT" "$SESSION_ID" <<'NODE'
const path = require('path');
const runtime = require(path.join(process.argv[2], 'server.js'));
const sessionId = process.argv[3];

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

(async () => {
  const classification = runtime.classifyExecutionInterruption({
    status: 'interrupted',
    errorCode: 'client_disconnect',
    meaningfulOutputStarted: true,
  });
  assert(classification.targetState === runtime.EXECUTION_STATES.RECOVERY_REQUIRED, 'Meaningful interruption did not classify to recovery_required');

  const preOutputClassification = runtime.classifyExecutionInterruption({
    status: 'interrupted',
    errorCode: 'client_disconnect',
    meaningfulOutputStarted: false,
  });
  assert(preOutputClassification.targetState === runtime.EXECUTION_STATES.FAILED, 'Pre-output interruption did not classify to failed');

  const created = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-recovery-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_recovery_created',
  });
  await runtime.transitionExecution(created.execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    actorSource: 'verification',
    reasonCode: 'verify_recovery_queued',
  });
  const lease = await runtime.acquireExecutionLease(created.execution.execution_id, {
    requestId: created.execution.last_request_id,
    actorSource: 'verification',
    isStreaming: true,
  });
  await runtime.transitionExecutionWithLease(created.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'verify_recovery_running',
    leaseId: lease.lease_id,
    leaseHolder: lease.lease_holder,
    leaseEpoch: lease.lease_epoch,
  });
  await runtime.markExecutionRecoveryRequired(created.execution.execution_id, {
    actorSource: 'verification',
    requestId: created.execution.last_request_id,
    reasonCode: 'client_disconnect',
    recoveryReason: classification.recoveryReason,
    leaseId: lease.lease_id,
    leaseHolder: lease.lease_holder,
    leaseEpoch: lease.lease_epoch,
  });
  process.stdout.write(created.execution.execution_id);
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE
)"
if [[ -z "$RECOVERY_EXECUTION_ID" ]]; then
  echo "Failed to create deterministic recovery_required execution" >&2
  exit 1
fi

echo "[5/6] Verifying recovery_required classification and lease release"
RECOVERY_REPORT="$(node - "$REPO_ROOT" "$DB_PATH" "$RECOVERY_EXECUTION_ID" <<'NODE'
const path = require('path');
const fs = require('fs');
const initSqlJs = require(path.join(process.argv[2], 'node_modules', 'sql.js'));

(async () => {
  const dbPath = process.argv[3];
  const executionId = process.argv[4];
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const execStmt = db.prepare(`
    SELECT execution_id, current_state, lease_id, lease_holder, recovery_reason
    FROM executions
    WHERE execution_id = ?
    LIMIT 1
  `);
  execStmt.bind([executionId]);
  if (!execStmt.step()) {
    throw new Error('No execution found for recovery scenario');
  }
  const execRow = execStmt.getAsObject();
  execStmt.free();

  if (String(execRow.current_state || '') !== 'recovery_required') {
    throw new Error(`Expected recovery_required after interrupted stream, got ${String(execRow.current_state || '')}`);
  }
  if (execRow.lease_id || execRow.lease_holder) {
    throw new Error('Lease was not released after recovery_required classification');
  }

  const eventStmt = db.prepare(`
    SELECT previous_state, new_state, reason_code
    FROM execution_events
    WHERE execution_id = ?
    ORDER BY rowid ASC
  `);
  eventStmt.bind([String(execRow.execution_id || '')]);
  const events = [];
  while (eventStmt.step()) {
    const row = eventStmt.getAsObject();
    events.push({
      previous_state: String(row.previous_state || ''),
      new_state: String(row.new_state || ''),
      reason_code: String(row.reason_code || ''),
    });
  }
  eventStmt.free();

  const recoveryTransition = events.find((event) =>
    event.previous_state === 'running' && event.new_state === 'recovery_required'
  );
  if (!recoveryTransition) {
    throw new Error(`Missing running -> recovery_required transition: ${JSON.stringify(events)}`);
  }

  const staleEventStmt = db.prepare(`
    SELECT reason_code
    FROM execution_events
    WHERE reason_code = 'execution_finalize_rejected_stale_lease'
    ORDER BY rowid DESC
    LIMIT 1
  `);
  let staleFound = false;
  if (staleEventStmt.step()) {
    staleFound = true;
  }
  staleEventStmt.free();
  if (!staleFound) {
    throw new Error('Missing execution_finalize_rejected_stale_lease event');
  }

  console.log(JSON.stringify({
    execution_id: String(execRow.execution_id || ''),
    current_state: String(execRow.current_state || ''),
    recovery_reason: String(execRow.recovery_reason || ''),
    event_count: events.length,
  }));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE
)"
printf '%s\n' "$RECOVERY_REPORT"

echo "[6/6] Recovery verification PASS"
