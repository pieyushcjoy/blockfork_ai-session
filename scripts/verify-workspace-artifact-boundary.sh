#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3100}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-workspace-artifact-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

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
require_cmd mktemp

mkdir -p "$TMP_DIR/allowed/inside" "$TMP_DIR/outside"
printf 'verified artifact\n' > "$TMP_DIR/allowed/inside/report.txt"
printf 'outside artifact\n' > "$TMP_DIR/outside/outside.txt"
ln -sf "$TMP_DIR/outside/outside.txt" "$TMP_DIR/allowed/inside/symlink-outside.txt"

echo "[1/3] Waiting for runtime listener"
wait_for_listener

echo "[2/3] Creating isolated session"
SESSION_JSON="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"
SESSION_ID="$(printf '%s' "$SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.session_id||j.session?.session_id||"")})')"

if [[ -z "$SESSION_ID" ]]; then
  echo "Failed to create isolated session for workspace/artifact verification" >&2
  exit 1
fi

echo "[3/3] Verifying workspace binding, artifact persistence, retry stability, and ambiguity handling"
node - "$REPO_ROOT" "$SESSION_ID" "$TMP_DIR" <<'NODE'
const path = require('path');
const fs = require('fs');

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

const repoRoot = process.argv[2];
const sessionId = process.argv[3];
const tmpDir = process.argv[4];
const allowedRoot = path.join(tmpDir, 'allowed');
const validFile = path.join(allowedRoot, 'inside', 'report.txt');
const futureFile = path.join(allowedRoot, 'inside', 'future-report.txt');
const symlinkFile = path.join(allowedRoot, 'inside', 'symlink-outside.txt');
const outsideFile = path.join(tmpDir, 'outside', 'outside.txt');

process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = allowedRoot;
const runtime = require(path.join(repoRoot, 'server.js'));

function contractFor(filePath, extra = {}) {
  return {
    requested: true,
    evidence: {
      path: filePath,
      ...extra,
    },
  };
}

(async () => {
  const roots = runtime.getAllowedWorkspaceRoots();
  assert(roots.length === 1, `Expected one allowed root, saw ${roots.length}`);
  assert(roots[0].canonical_root === allowedRoot, 'Allowed root canonicalization mismatch');

  const valid = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-artifact-valid-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_artifact_valid_created',
  });
  const validReqBody = { metadata: { blockfork_artifact_contract: contractFor(validFile) } };
  const preparedValid = await runtime.prepareArtifactBindingForExecution(valid.execution.execution_id, validReqBody, {
    requestId: valid.execution.last_request_id,
    actorSource: 'verification',
  });
  assert(preparedValid.ok, `Valid artifact binding failed: ${preparedValid.reason || 'unknown'}`);
  const validExecution = await runtime.getExecutionById(valid.execution.execution_id);
  assert(validExecution.workspace_id, 'Valid execution missing workspace binding');
  const pendingArtifact = await runtime.getExecutionArtifactByExecutionId(valid.execution.execution_id);
  assert(pendingArtifact && pendingArtifact.verification_state === 'pending', 'Artifact did not start in pending state');
  const validArtifactError = await runtime.validateArtifactHonestyOrError(validReqBody, 'created report file', {
    executionId: valid.execution.execution_id,
    requestId: valid.execution.last_request_id,
    actorSource: 'verification',
    meaningfulOutputStarted: false,
  });
  assert(validArtifactError === null, `Valid artifact unexpectedly rejected: ${validArtifactError?.message || 'unknown'}`);
  const verifiedArtifact = await runtime.getExecutionArtifactByExecutionId(valid.execution.execution_id);
  assert(verifiedArtifact.verification_state === 'verified', `Artifact was not verified: ${verifiedArtifact.verification_state}`);

  const outside = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-artifact-outside-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_artifact_outside_created',
  });
  const outsideResult = await runtime.prepareArtifactBindingForExecution(outside.execution.execution_id, {
    metadata: { blockfork_artifact_contract: contractFor(outsideFile) },
  }, {
    requestId: outside.execution.last_request_id,
    actorSource: 'verification',
  });
  assert(!outsideResult.ok && outsideResult.reason === 'artifact_path_outside_workspace', `Outside-root path did not reject correctly: ${outsideResult.reason}`);

  const symlink = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-artifact-symlink-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_artifact_symlink_created',
  });
  const symlinkResult = await runtime.prepareArtifactBindingForExecution(symlink.execution.execution_id, {
    metadata: { blockfork_artifact_contract: contractFor(symlinkFile) },
  }, {
    requestId: symlink.execution.last_request_id,
    actorSource: 'verification',
  });
  assert(!symlinkResult.ok && symlinkResult.reason === 'artifact_path_symlink_escape', `Symlink escape did not reject correctly: ${symlinkResult.reason}`);

  process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = '';
  const unconfigured = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-artifact-unconfigured-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_artifact_unconfigured_created',
  });
  const unconfiguredResult = await runtime.prepareArtifactBindingForExecution(unconfigured.execution.execution_id, {
    metadata: { blockfork_artifact_contract: contractFor(validFile) },
  }, {
    requestId: unconfigured.execution.last_request_id,
    actorSource: 'verification',
  });
  assert(!unconfiguredResult.ok && unconfiguredResult.reason === 'artifact_workspace_roots_unconfigured', `Missing-root config did not reject correctly: ${unconfiguredResult.reason}`);

  process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = allowedRoot;
  const retryExec = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-artifact-retry-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_artifact_retry_created',
  });
  await runtime.transitionExecution(retryExec.execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    actorSource: 'verification',
    reasonCode: 'verify_artifact_retry_queued',
  });
  const retryLease1 = await runtime.acquireExecutionLease(retryExec.execution.execution_id, {
    requestId: retryExec.execution.last_request_id,
    actorSource: 'verification',
    isStreaming: true,
  });
  await runtime.transitionExecutionWithLease(retryExec.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'verify_artifact_retry_running',
    leaseId: retryLease1.lease_id,
    leaseHolder: retryLease1.lease_holder,
    leaseEpoch: retryLease1.lease_epoch,
  });
  const retryReqBody = { metadata: { blockfork_artifact_contract: contractFor(validFile) } };
  const retryPrepared1 = await runtime.prepareArtifactBindingForExecution(retryExec.execution.execution_id, retryReqBody, {
    requestId: retryExec.execution.last_request_id,
    actorSource: 'verification',
  });
  await runtime.transitionExecutionWithLease(retryExec.execution.execution_id, runtime.EXECUTION_STATES.RETRYING, {
    actorSource: 'verification',
    reasonCode: 'execution_retrying',
    leaseId: retryLease1.lease_id,
    leaseHolder: retryLease1.lease_holder,
    leaseEpoch: retryLease1.lease_epoch,
  });
  const retryLease2 = await runtime.acquireExecutionLease(retryExec.execution.execution_id, {
    requestId: retryExec.execution.last_request_id,
    actorSource: 'verification',
    isStreaming: true,
  });
  await runtime.transitionExecutionWithLease(retryExec.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'execution_retry_resumed',
    leaseId: retryLease2.lease_id,
    leaseHolder: retryLease2.lease_holder,
    leaseEpoch: retryLease2.lease_epoch,
  });
  const retryPrepared2 = await runtime.prepareArtifactBindingForExecution(retryExec.execution.execution_id, retryReqBody, {
    requestId: retryExec.execution.last_request_id,
    actorSource: 'verification',
  });
  assert(retryPrepared1.workspace.workspace_id === retryPrepared2.workspace.workspace_id, 'Workspace binding changed across retry');
  assert(retryPrepared1.artifact.artifact_id === retryPrepared2.artifact.artifact_id, 'Artifact record changed across retry');
  await runtime.transitionExecutionWithLease(retryExec.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    actorSource: 'verification',
    reasonCode: 'verify_artifact_retry_completed',
    leaseId: retryLease2.lease_id,
    leaseHolder: retryLease2.lease_holder,
    leaseEpoch: retryLease2.lease_epoch,
    clearLease: true,
  });

  const missingEvidence = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-artifact-missing-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_artifact_missing_created',
  });
  const missingReqBody = { metadata: { blockfork_artifact_contract: contractFor(futureFile) } };
  const missingPrepared = await runtime.prepareArtifactBindingForExecution(missingEvidence.execution.execution_id, missingReqBody, {
    requestId: missingEvidence.execution.last_request_id,
    actorSource: 'verification',
  });
  assert(missingPrepared.ok, `Missing-evidence contract should still bind before output: ${missingPrepared.reason || 'unknown'}`);
  const missingError = await runtime.validateArtifactHonestyOrError(missingReqBody, 'created report file', {
    executionId: missingEvidence.execution.execution_id,
    requestId: missingEvidence.execution.last_request_id,
    actorSource: 'verification',
    meaningfulOutputStarted: false,
  });
  assert(missingError && missingError.code === 'artifact_verification_failed', 'Missing evidence did not reject as artifact_verification_failed');
  const rejectedArtifact = await runtime.getExecutionArtifactByExecutionId(missingEvidence.execution.execution_id);
  assert(rejectedArtifact.verification_state === 'rejected', 'Artifact record did not become rejected on missing evidence');

  const ambiguous = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-artifact-ambiguous-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_artifact_ambiguous_created',
  });
  await runtime.transitionExecution(ambiguous.execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    actorSource: 'verification',
    reasonCode: 'verify_artifact_ambiguous_queued',
  });
  const ambiguousLease = await runtime.acquireExecutionLease(ambiguous.execution.execution_id, {
    requestId: ambiguous.execution.last_request_id,
    actorSource: 'verification',
    isStreaming: true,
  });
  await runtime.transitionExecutionWithLease(ambiguous.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'verify_artifact_ambiguous_running',
    leaseId: ambiguousLease.lease_id,
    leaseHolder: ambiguousLease.lease_holder,
    leaseEpoch: ambiguousLease.lease_epoch,
  });
  const ambiguousReqBody = { metadata: { blockfork_artifact_contract: contractFor(validFile) } };
  const ambiguousPrepared = await runtime.prepareArtifactBindingForExecution(ambiguous.execution.execution_id, ambiguousReqBody, {
    requestId: ambiguous.execution.last_request_id,
    actorSource: 'verification',
  });
  assert(ambiguousPrepared.ok, 'Ambiguous test execution failed to bind workspace');
  fs.unlinkSync(validFile);
  const ambiguousError = await runtime.validateArtifactHonestyOrError(ambiguousReqBody, 'created report file', {
    executionId: ambiguous.execution.execution_id,
    requestId: ambiguous.execution.last_request_id,
    actorSource: 'verification',
    meaningfulOutputStarted: true,
  });
  assert(ambiguousError && ambiguousError.requiresRecovery === true, 'Meaningful-output artifact failure did not require recovery');
  await runtime.markExecutionRecoveryRequired(ambiguous.execution.execution_id, {
    requestId: ambiguous.execution.last_request_id,
    actorSource: 'verification',
    reasonCode: ambiguousError.code,
    recoveryReason: ambiguousError.reason,
    leaseId: ambiguousLease.lease_id,
    leaseHolder: ambiguousLease.lease_holder,
    leaseEpoch: ambiguousLease.lease_epoch,
  });
  const ambiguousExecution = await runtime.getExecutionById(ambiguous.execution.execution_id);
  assert(ambiguousExecution.current_state === runtime.EXECUTION_STATES.RECOVERY_REQUIRED, `Ambiguous artifact execution did not enter recovery_required: ${ambiguousExecution.current_state}`);

  console.log(JSON.stringify({
    verified_execution_id: valid.execution.execution_id,
    workspace_id: validExecution.workspace_id,
    artifact_id: verifiedArtifact.artifact_id,
    retry_workspace_id: retryPrepared2.workspace.workspace_id,
    ambiguous_execution_state: ambiguousExecution.current_state,
  }));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE

echo "Workspace/artifact boundary verification PASS"
