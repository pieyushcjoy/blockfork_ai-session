#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
ALLOW_INTEGRITY_SKIPS="${ALLOW_INTEGRITY_SKIPS:-upstream_free_rate_limited,upstream_free_timeout,upstream_free_unauthorized,fallback_429_activation,fallback_timeout_activation}"
SUMMARY_PATH="${SUMMARY_PATH:-$ROOT_DIR/logs/readiness-gate-summary.json}"
LOG_OUT_PATH="${LOG_OUT_PATH:-$ROOT_DIR/logs/launchd.out.log}"
LOG_ERR_PATH="${LOG_ERR_PATH:-$ROOT_DIR/logs/launchd.err.log}"
RUNTIME_PROFILE_PATH="${RUNTIME_PROFILE_PATH:-$ROOT_DIR/logs/runtime-profile.json}"

get_line_count() {
  local path="$1"
  if [[ -f "$path" ]]; then
    wc -l < "$path" | tr -d ' '
  else
    echo 0
  fi
}

resolve_env_file() {
  local input_path="$1"
  if [[ "$input_path" == /* ]]; then
    printf '%s' "$input_path"
    return 0
  fi
  printf '%s' "$ROOT_DIR/$input_path"
}

slice_appended_lines() {
  local source="$1"
  local start_count="$2"
  local target="$3"
  if [[ ! -f "$source" ]]; then
    : > "$target"
    return 0
  fi

  local first_new_line=$((start_count + 1))
  tail -n +"$first_new_line" "$source" > "$target"
}

mkdir -p "$(dirname "$SUMMARY_PATH")"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/blockfork-readiness-gate.XXXXXX")"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

log_out_start="$(get_line_count "$LOG_OUT_PATH")"
log_err_start="$(get_line_count "$LOG_ERR_PATH")"
expected_env_file="$(resolve_env_file "$ENV_FILE")"

echo "[0/6] Runtime profile alignment"
if [[ ! -f "$RUNTIME_PROFILE_PATH" ]]; then
  echo "Runtime profile marker missing: $RUNTIME_PROFILE_PATH" >&2
  echo "Restart the runtime with the intended profile before running readiness:gate." >&2
  exit 1
fi

actual_env_file="$(node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));process.stdout.write(String(j.env_file||""));' "$RUNTIME_PROFILE_PATH")"
if [[ "$actual_env_file" != "$expected_env_file" ]]; then
  echo "Runtime profile mismatch: running runtime loaded $actual_env_file but gate requested $expected_env_file" >&2
  echo "Restart the runtime with ENV_FILE set to the requested profile and retry." >&2
  exit 1
fi

readiness_mode="live"
if [[ "$expected_env_file" != "$ROOT_DIR/.env" ]]; then
  readiness_mode="validation"
fi

echo "[1/6] Production-safe runtime verification"
set +e
verify_output="$(cd "$ROOT_DIR" && npm run -s runtime:verify 2>&1)"
verify_cmd_rc=$?
set -e
echo "$verify_output"
verify_rc=$verify_cmd_rc
if ! printf '%s' "$verify_output" | rg -q "Verification PASS"; then
  verify_rc=1
fi

echo "[2/6] Integrity verification with machine-readable summary"
set +e
integrity_output="$(cd "$ROOT_DIR" && ENV_FILE="$ENV_FILE" npm run -s runtime:verify:integrity 2>&1)"
integrity_cmd_rc=$?
set -e
echo "$integrity_output"

state_json="$(printf '%s\n' "$integrity_output" | node -e '
let s="";
process.stdin.on("data",d=>s+=d);
process.stdin.on("end",()=>{
  const lines=s.split(/\r?\n/);
  const states=[];
  for (const l of lines) {
    const m=l.match(/^STATE\s+([a-zA-Z0-9_]+)=([a-zA-Z0-9_]+)(?:\s+\((.*)\))?$/);
    if (m) states.push({key:m[1], value:m[2], detail:m[3]||""});
  }
  process.stdout.write(JSON.stringify(states));
});
')"

allowed_skips_json="$(node -e 'const raw=process.argv[1]||"";const arr=raw.split(",").map(s=>s.trim()).filter(Boolean);process.stdout.write(JSON.stringify(arr));' "$ALLOW_INTEGRITY_SKIPS")"

integrity_eval="$(node -e '
const states=JSON.parse(process.argv[1]);
const allowed=new Set(JSON.parse(process.argv[2]));
const skipped=[];
const unexpectedSkipped=[];
const failed=[];
for (const s of states) {
  if (s.value === "skipped") {
    skipped.push(s.key);
    if (!allowed.has(s.key)) unexpectedSkipped.push(s.key);
  }
  if (s.value === "fail") failed.push(s.key);
}
const status = (failed.length===0 && unexpectedSkipped.length===0) ? "pass" : "fail";
process.stdout.write(JSON.stringify({status, skipped, unexpectedSkipped, failed}, null, 2));
' "$state_json" "$allowed_skips_json")"

integrity_line_rc=0
if ! printf '%s' "$integrity_output" | rg -q "Integrity PASS"; then
  integrity_line_rc=1
fi
if [[ "$integrity_cmd_rc" -ne 0 ]]; then
  integrity_line_rc=1
fi

echo "[3/6] State boundary conformance"
set +e
state_boundary_output="$(cd "$ROOT_DIR" && bash scripts/verify-state-boundary.sh 2>&1)"
state_boundary_rc=$?
set -e
echo "$state_boundary_output"

echo "[4/6] Readiness observability report"
gate_log_out="$tmp_dir/gate-window.out.log"
gate_log_err="$tmp_dir/gate-window.err.log"
slice_appended_lines "$LOG_OUT_PATH" "$log_out_start" "$gate_log_out"
slice_appended_lines "$LOG_ERR_PATH" "$log_err_start" "$gate_log_err"
set +e
report_output="$(cd "$ROOT_DIR" && LOG_OUT="$gate_log_out" LOG_ERR="$gate_log_err" READINESS_FRESH_WINDOW=1 READINESS_MODE="$readiness_mode" bash scripts/readiness-report.sh 2>&1)"
report_rc=$?
set -e
echo "$report_output"

if ! report_json_from_output="$(printf '%s' "$report_output" | node -e '
let s="";
process.stdin.on("data",d=>s+=d);
process.stdin.on("end",()=>{
  const start=s.indexOf("{");
  const end=s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) process.exit(1);
  const candidate=s.slice(start,end+1);
  JSON.parse(candidate);
  process.stdout.write(candidate);
});
')"; then
  report_json_from_output='{"status":"fail","reasons":["report_parse_error"]}'
  report_rc=1
fi

echo "[5/6] Build gate summary"
node -e '
const fs=require("fs");
const summaryPath=process.argv[1];
const verifyOut=process.argv[2];
const verifyRc=Number(process.argv[3]);
const integrityOut=process.argv[4];
const integrityLineRc=Number(process.argv[5]);
const integrityEval=JSON.parse(process.argv[6]);
const stateBoundaryRc=Number(process.argv[7]);
const reportRc=Number(process.argv[8]);
const report=JSON.parse(process.argv[9]);
const finalStatus = (
  verifyRc === 0 &&
  integrityLineRc === 0 &&
  integrityEval.status === "pass" &&
  stateBoundaryRc === 0 &&
  reportRc === 0 &&
  report.status === "pass"
) ? "pass" : "fail";
const summary={
  status: finalStatus,
  generated_at: new Date().toISOString(),
  checks: {
    runtime_verify_pass: /Verification PASS/.test(verifyOut),
    integrity_pass_line: /Integrity PASS/.test(integrityOut),
    integrity_eval: integrityEval,
    state_boundary_pass: stateBoundaryRc === 0,
    readiness_report: report
  }
};
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (finalStatus !== "pass") process.exit(1);
' "$SUMMARY_PATH" "$verify_output" "$verify_rc" "$integrity_output" "$integrity_line_rc" "$integrity_eval" "$state_boundary_rc" "$report_rc" "$report_json_from_output"

echo "[6/6] Readiness gate PASS"
