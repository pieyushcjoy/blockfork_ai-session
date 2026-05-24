#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUITE_PATH="$ROOT_DIR/benchmarks/tool-usefulness/benchmark-suite.json"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node

if [[ ! -f "$SUITE_PATH" ]]; then
  echo "Missing benchmark suite: $SUITE_PATH" >&2
  exit 1
fi

node - "$SUITE_PATH" <<'NODE'
const fs = require('fs');

const suitePath = process.argv[2];
const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));

const requiredTopLevelKeys = [
  'suite_id',
  'phase',
  'objective',
  'rubric_dimensions',
  'progress_event_categories',
  'tasks',
];

for (const key of requiredTopLevelKeys) {
  if (!(key in suite)) {
    throw new Error(`Missing top-level key: ${key}`);
  }
}

if (suite.suite_id !== 'phase5-tool-usefulness') {
  throw new Error(`Unexpected suite_id: ${suite.suite_id}`);
}

if (String(suite.phase) !== '5.1') {
  throw new Error(`Unexpected phase: ${suite.phase}`);
}

if (!Array.isArray(suite.rubric_dimensions) || suite.rubric_dimensions.length < 10) {
  throw new Error('Rubric dimensions are incomplete');
}

if (!Array.isArray(suite.progress_event_categories) || suite.progress_event_categories.length < 10) {
  throw new Error('Progress event categories are incomplete');
}

const requiredProgressCategories = [
  'task_accepted',
  'plan_locked',
  'tool_work_started',
  'artifact_created',
  'artifact_verification_started',
  'artifact_verified',
  'meaningful_progress_checkpoint',
  'blocked_human_input_required',
  'recovery_required',
  'partial_completion_detected',
  'task_completed',
  'task_failed',
];

for (const category of requiredProgressCategories) {
  if (!suite.progress_event_categories.includes(category)) {
    throw new Error(`Missing progress category: ${category}`);
  }
}

if (!Array.isArray(suite.tasks) || suite.tasks.length !== 8) {
  throw new Error(`Expected exactly 8 benchmarks, found ${Array.isArray(suite.tasks) ? suite.tasks.length : 'invalid'}`);
}

const requiredTaskKeys = [
  'id',
  'name',
  'prompt_pattern',
  'expected_tool_behavior',
  'expected_artifact_or_result',
  'success_criteria',
  'partial_success_criteria',
  'failure_criteria',
  'progress_checkpoints',
  'progress_reporting_requirements',
];

const longHorizonTaskIds = new Set([
  'research-structure-artifact',
  'partial-failure-recovery',
]);

const ids = new Set();
for (const task of suite.tasks) {
  for (const key of requiredTaskKeys) {
    if (!(key in task)) {
      throw new Error(`Task ${task.id || '<missing id>'} missing key: ${key}`);
    }
  }

  if (ids.has(task.id)) {
    throw new Error(`Duplicate task id: ${task.id}`);
  }
  ids.add(task.id);

  if (!Array.isArray(task.expected_tool_behavior) || task.expected_tool_behavior.length < 2) {
    throw new Error(`Task ${task.id} has incomplete expected_tool_behavior`);
  }
  if (!Array.isArray(task.success_criteria) || task.success_criteria.length < 1) {
    throw new Error(`Task ${task.id} has incomplete success_criteria`);
  }
  if (!Array.isArray(task.partial_success_criteria) || task.partial_success_criteria.length < 1) {
    throw new Error(`Task ${task.id} has incomplete partial_success_criteria`);
  }
  if (!Array.isArray(task.failure_criteria) || task.failure_criteria.length < 1) {
    throw new Error(`Task ${task.id} has incomplete failure_criteria`);
  }
  if (!Array.isArray(task.progress_checkpoints) || task.progress_checkpoints.length < 4) {
    throw new Error(`Task ${task.id} has incomplete progress_checkpoints`);
  }

  const progressReq = task.progress_reporting_requirements || {};
  for (const field of ['proactive_updates', 'no_spam', 'human_input_only_when_needed', 'final_completion_truthful']) {
    if (progressReq[field] !== true) {
      throw new Error(`Task ${task.id} progress requirement not satisfied: ${field}`);
    }
  }

  if (longHorizonTaskIds.has(task.id)) {
    if (!task.long_horizon || typeof task.long_horizon !== 'object') {
      throw new Error(`Task ${task.id} missing long_horizon metadata`);
    }
    const longHorizon = task.long_horizon;
    for (const field of ['enabled', 'failure_position_tracking', 'plan_to_execution_handoff_required', 'context_pressure_failure_segmentation_required', 'progress_continuity_required']) {
      if (longHorizon[field] !== true) {
        throw new Error(`Task ${task.id} long_horizon field not satisfied: ${field}`);
      }
    }
    if (!Array.isArray(longHorizon.workflow_stages) || longHorizon.workflow_stages.length < 4) {
      throw new Error(`Task ${task.id} long_horizon workflow stages incomplete`);
    }
    if (!Number.isFinite(longHorizon.minimum_progress_messages) || longHorizon.minimum_progress_messages < 2) {
      throw new Error(`Task ${task.id} long_horizon minimum_progress_messages invalid`);
    }
  }
}

const summary = {
  status: 'pass',
  suite_id: suite.suite_id,
  phase: suite.phase,
  benchmark_count: suite.tasks.length,
  rubric_dimension_count: suite.rubric_dimensions.length,
  progress_event_category_count: suite.progress_event_categories.length,
  progress_reporting_enabled_benchmarks: suite.tasks.length,
};

console.log(JSON.stringify(summary, null, 2));
NODE

echo "Tool usefulness benchmark harness verification PASS"
