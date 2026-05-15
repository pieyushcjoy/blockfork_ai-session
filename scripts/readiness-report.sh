#!/usr/bin/env bash
set -euo pipefail

LOG_OUT="${LOG_OUT:-logs/launchd.out.log}"
LOG_ERR="${LOG_ERR:-logs/launchd.err.log}"
WINDOW_LINES="${WINDOW_LINES:-400}"
MIN_PRIMARY_OUTCOMES_FOR_STRICT="${MIN_PRIMARY_OUTCOMES_FOR_STRICT:-10}"
MAX_FALLBACK_ATTEMPT_RATE="${MAX_FALLBACK_ATTEMPT_RATE:-0.20}"
MAX_FALLBACK_FAILURE_RATE="${MAX_FALLBACK_FAILURE_RATE:-0.50}"
MAX_PREFLIGHT_NOT_READY_RATE="${MAX_PREFLIGHT_NOT_READY_RATE:-0.05}"
MAX_UPSTREAM_UNKNOWN_ERROR_RATE="${MAX_UPSTREAM_UNKNOWN_ERROR_RATE:-0.20}"
READINESS_MODE="${READINESS_MODE:-live}"

if [[ ! -f "$LOG_OUT" && ! -f "$LOG_ERR" ]]; then
  echo "Readiness report failed: missing log inputs" >&2
  exit 1
fi

build_input_stream() {
  if [[ -n "${READINESS_FRESH_WINDOW:-}" ]]; then
    if [[ -f "$LOG_OUT" ]]; then
      cat "$LOG_OUT"
    fi
    if [[ -f "$LOG_ERR" ]]; then
      cat "$LOG_ERR"
    fi
    return 0
  fi

  tail -n "$WINDOW_LINES" "$LOG_OUT" "$LOG_ERR" 2>/dev/null
}

report_json="$(build_input_stream | node -e '
let s="";
process.stdin.on("data",d=>s+=d);
process.stdin.on("end",()=>{
  const lines=s.split(/\r?\n/).filter(Boolean);
  let primaryOutcomes=0;
  let fallbackAttempts=0;
  let fallbackSuccesses=0;
  let fallbackFailures=0;
  let preflightChecks=0;
  let preflightNotReady=0;
  let upstreamFailures=0;
  let knownUpstreamFailures=0;

  for (const line of lines) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const event = j.event || "";

    if (event === "primary_outcome") primaryOutcomes += 1;
    if (event === "fallback_attempt_started") fallbackAttempts += 1;
    if (event === "fallback_success") fallbackSuccesses += 1;
    if (event === "fallback_failed") fallbackFailures += 1;

    if (event === "upstream_failure") {
      upstreamFailures += 1;
      const reason = String(j.status_text || j.type || "").toLowerCase();
      if (reason.includes("timeout") || reason.includes("fetch") || reason.includes("too many requests") || reason.includes("unauthorized") || reason.includes("upstream_error")) {
        knownUpstreamFailures += 1;
      }
    }

    if (event === "preflight_evaluation") {
      preflightChecks += 1;
      if (j.status && String(j.status).toLowerCase() !== "ready") preflightNotReady += 1;
    }
  }

  const fallbackOutcomes = fallbackSuccesses + fallbackFailures;
  const fallbackAttemptRate = primaryOutcomes > 0 ? fallbackAttempts / primaryOutcomes : 0;
  const fallbackFailureRate = fallbackOutcomes > 0 ? fallbackFailures / fallbackOutcomes : 0;
  const preflightNotReadyRate = preflightChecks > 0 ? preflightNotReady / preflightChecks : 0;
  const upstreamUnknownErrorRate = upstreamFailures > 0 ? (upstreamFailures - knownUpstreamFailures) / upstreamFailures : 0;

  const out = {
    totals: { primaryOutcomes, fallbackAttempts, fallbackSuccesses, fallbackFailures, fallbackOutcomes, preflightChecks, preflightNotReady, upstreamFailures, knownUpstreamFailures },
    rates: { fallbackAttemptRate, fallbackFailureRate, preflightNotReadyRate, upstreamUnknownErrorRate }
  };
  process.stdout.write(JSON.stringify(out));
});
')"

status="pass"
reasons=()

primary_outcomes="$(printf '%s' "$report_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.totals.primaryOutcomes));});')"
fallback_attempt_rate="$(printf '%s' "$report_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.rates.fallbackAttemptRate));});')"
fallback_failure_rate="$(printf '%s' "$report_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.rates.fallbackFailureRate));});')"
preflight_not_ready_rate="$(printf '%s' "$report_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.rates.preflightNotReadyRate));});')"
upstream_unknown_error_rate="$(printf '%s' "$report_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.rates.upstreamUnknownErrorRate));});')"

compare() {
  node -e 'const [a,b]=process.argv.slice(1).map(Number);process.exit(a>b?0:1)' "$1" "$2"
}

if (( primary_outcomes < MIN_PRIMARY_OUTCOMES_FOR_STRICT )); then
  reasons+=("low_sample_window")
else
  if [[ "$READINESS_MODE" != "validation" ]] && compare "$fallback_attempt_rate" "$MAX_FALLBACK_ATTEMPT_RATE"; then
    status="fail"; reasons+=("fallback_attempt_rate_exceeded")
  fi
  if compare "$fallback_failure_rate" "$MAX_FALLBACK_FAILURE_RATE"; then
    status="fail"; reasons+=("fallback_failure_rate_exceeded")
  fi
  if compare "$preflight_not_ready_rate" "$MAX_PREFLIGHT_NOT_READY_RATE"; then
    status="fail"; reasons+=("preflight_not_ready_rate_exceeded")
  fi
  if compare "$upstream_unknown_error_rate" "$MAX_UPSTREAM_UNKNOWN_ERROR_RATE"; then
    status="fail"; reasons+=("upstream_unknown_error_rate_exceeded")
  fi
fi

node -e '
const j=JSON.parse(process.argv[1]);
const status=process.argv[2];
const reasons=process.argv[3] ? process.argv[3].split(",").filter(Boolean) : [];
const mode=process.argv[4];
console.log(JSON.stringify({status, mode, reasons, ...j}, null, 2));
' "$report_json" "$status" "$(IFS=,; echo "${reasons[*]:-}")" "$READINESS_MODE"

if [[ "$status" != "pass" ]]; then
  exit 1
fi
