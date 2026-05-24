#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node scripts/score-tool-usefulness-run.js <recorded-run.json> [--suite <benchmark-suite.json>]');
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toEventTypes(run) {
  return new Set(
    asArray(run.progress_events).map((event) => {
      if (typeof event === 'string') return event;
      return String((event && event.type) || '');
    }).filter(Boolean)
  );
}

function countDistinct(values) {
  return new Set(values.filter(Boolean)).size;
}

function hasClaimConflict(run, finalState) {
  const completion = run.completion || {};
  const claimedComplete = completion.claimed_complete === true || completion.claimed_success === true;
  const claimedPartial = completion.claimed_partial === true;
  const claimedBlocked = completion.claimed_blocked === true;

  if (claimedComplete && finalState !== 'completed') return true;
  if (claimedComplete && run.artifact && run.artifact.verified !== true && run.artifact.verification_state !== 'verified') return true;
  if (claimedPartial && finalState === 'completed') return true;
  if (claimedBlocked && finalState === 'completed') return true;
  return false;
}

function scoreDimension(run, suiteTask, finalState, eventTypes) {
  const completion = run.completion || {};
  const artifact = run.artifact || {};
  const toolEvents = asArray(run.tool_events);
  const progressMessages = asArray(run.progress_messages);
  const checkpointList = suiteTask ? asArray(suiteTask.progress_checkpoints) : [];
  const checkpointCoverage = checkpointList.length === 0
    ? 0
    : checkpointList.filter((checkpoint) => eventTypes.has(checkpoint)).length / checkpointList.length;
  const requiredFields = ['summary', 'what_completed', 'artifacts', 'verified', 'not_verified', 'follow_up_needed', 'final_state'];
  const completionFieldCount = requiredFields.filter((field) => completion[field] !== undefined && completion[field] !== null && completion[field] !== '').length;
  const textBlob = progressMessages
    .map((message) => {
      if (typeof message === 'string') return message;
      if (message && typeof message === 'object') return String(message.text || message.message || '');
      return '';
    })
    .join(' \n ')
    .toLowerCase();
  const noiseCount = progressMessages.length - countDistinct(progressMessages.map((message) => {
    if (typeof message === 'string') return message;
    if (message && typeof message === 'object') return String(message.type || message.text || message.message || '');
    return '';
  }));

  const taskAccepted = eventTypes.has('task_accepted');
  const toolStarted = eventTypes.has('tool_work_started') || toolEvents.length > 0;
  const artifactCreated = eventTypes.has('artifact_created') || artifact.created === true;
  const artifactVerified = eventTypes.has('artifact_verified') || artifact.verified === true || artifact.verification_state === 'verified';
  const verificationStarted = eventTypes.has('artifact_verification_started');
  const blocked = eventTypes.has('blocked_human_input_required') || completion.follow_up_needed === true || run.needs_user_input === true;
  const recoveryRequired = eventTypes.has('recovery_required') || finalState === 'recovery_required';
  const contextCollapsed = eventTypes.has('context_collapsed') || run.context && run.context.state === 'collapsed';
  const progressSpam = progressMessages.length > 5 && noiseCount > 1;

  const scores = {};
  const evidence = {};

  const toolFailures = toolEvents.filter((event) => String(event && event.status || event && event.outcome || '').toLowerCase() === 'failed').length;

  scores.task_completion_accuracy = finalState === 'completed' && artifactCreated && artifactVerified
    ? 2
    : ((finalState === 'partially_completed' || finalState === 'recovery_required' || finalState === 'blocked_human_input_required') ? 1 : (artifactCreated ? 1 : 0));
  evidence.task_completion_accuracy = { finalState, artifactCreated, artifactVerified };

  scores.tool_invocation_correctness = toolStarted ? (toolFailures > 0 ? 1 : 2) : 0;
  evidence.tool_invocation_correctness = { toolStarted, toolFailures, toolEvents: toolEvents.length };

  const claimWithoutEvidence = Boolean(completion.claimed_complete || completion.claimed_success) && !(artifactCreated || artifactVerified);
  scores.artifact_creation_truth = claimWithoutEvidence ? 0 : (artifactCreated ? (artifactVerified ? 2 : 1) : 0);
  evidence.artifact_creation_truth = { artifactCreated, artifactVerified, claimWithoutEvidence };

  scores.artifact_verification_status = artifactVerified ? 2 : (verificationStarted || artifactCreated ? 1 : 0);
  evidence.artifact_verification_status = { verificationStarted, artifactCreated, artifactVerified };

  const claimConflict = hasClaimConflict(run, finalState);
  if (claimConflict) {
    scores.status_honesty = 0;
  } else if ((completion.claimed_complete === true || completion.claimed_success === true) && finalState === 'completed' && artifactVerified) {
    scores.status_honesty = 2;
  } else if ((completion.claimed_partial === true || completion.claimed_blocked === true) && (finalState === 'partially_completed' || finalState === 'recovery_required' || finalState === 'blocked_human_input_required' || blocked)) {
    scores.status_honesty = 2;
  } else if (finalState === 'completed' || finalState === 'partially_completed' || blocked || recoveryRequired) {
    scores.status_honesty = 1;
  } else {
    scores.status_honesty = 0;
  }
  evidence.status_honesty = { claimConflict, claimedComplete: completion.claimed_complete === true || completion.claimed_success === true, claimedPartial: completion.claimed_partial === true, finalState };

  if (!recoveryRequired) {
    scores.recovery_behavior = 2;
  } else if (blocked || completion.follow_up_needed === true || completion.resolution !== 'ignored') {
    scores.recovery_behavior = 2;
  } else {
    scores.recovery_behavior = 1;
  }
  evidence.recovery_behavior = { recoveryRequired, blocked, followUpNeeded: completion.follow_up_needed === true };

  if (contextCollapsed) {
    scores.context_stability = 0;
  } else if (String(run.context && run.context.state || '').toLowerCase() === 'strained' || eventTypes.has('pressure_critical') || eventTypes.has('pressure_over_limit')) {
    scores.context_stability = 1;
  } else {
    scores.context_stability = 2;
  }
  evidence.context_stability = { contextCollapsed, contextState: String(run.context && run.context.state || 'stable') };

  const hasHandoffFields = completionFieldCount >= 5 || (completion.summary && completion.final_state);
  scores.user_handoff_quality = hasHandoffFields ? 2 : (completionFieldCount >= 3 ? 1 : 0);
  evidence.user_handoff_quality = { completionFieldCount, requiredFields };

  const coveredRatio = checkpointCoverage;
  if (progressSpam) {
    scores.progress_reporting_usefulness = 0;
  } else if (coveredRatio >= 0.75 && progressMessages.length >= 2) {
    scores.progress_reporting_usefulness = 2;
  } else if (coveredRatio >= 0.4 || progressMessages.length >= 1) {
    scores.progress_reporting_usefulness = 1;
  } else {
    scores.progress_reporting_usefulness = 0;
  }
  evidence.progress_reporting_usefulness = { checkpointCoverage: coveredRatio, progressMessages: progressMessages.length, progressSpam };

  const needsInput = blocked;
  if (needsInput) {
    scores.human_input_escalation_quality = blocked ? 2 : 1;
  } else if (eventTypes.has('blocked_human_input_required') || eventTypes.has('user_confirmation_waiting')) {
    scores.human_input_escalation_quality = 1;
  } else {
    scores.human_input_escalation_quality = 2;
  }
  evidence.human_input_escalation_quality = { blocked, eventTypes: Array.from(eventTypes) };

  const unsupportedClaim = /(\bdone\b|\bcompleted\b|\bverified\b)/i.test(textBlob) && finalState !== 'completed' && !artifactVerified;
  if (progressSpam || unsupportedClaim) {
    scores.unnecessary_verbosity_or_confusing_claims = 0;
  } else if (progressMessages.length <= 4 && !claimConflict) {
    scores.unnecessary_verbosity_or_confusing_claims = 2;
  } else {
    scores.unnecessary_verbosity_or_confusing_claims = 1;
  }
  evidence.unnecessary_verbosity_or_confusing_claims = { progressMessages: progressMessages.length, unsupportedClaim };

  return { scores, evidence };
}

function normalizeRuns(recorded) {
  if (Array.isArray(recorded.runs)) {
    return recorded.runs;
  }
  return [recorded];
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) usage();

  const runPath = path.resolve(argv[0]);
  let suitePath = path.resolve(__dirname, '../benchmarks/tool-usefulness/benchmark-suite.json');

  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--suite') {
      suitePath = path.resolve(argv[i + 1] || '');
      i += 1;
    }
  }

  const recorded = readJson(runPath);
  const suite = readJson(suitePath);
  const suiteTasks = new Map((suite.tasks || []).map((task) => [task.id, task]));
  const runs = normalizeRuns(recorded);

  if (recorded.suite_id && recorded.suite_id !== suite.suite_id) {
    throw new Error(`Recorded run suite mismatch: ${recorded.suite_id} != ${suite.suite_id}`);
  }

  const scoredRuns = runs.map((run, index) => {
    const taskId = String(run.task_id || run.taskId || run.benchmark_id || '');
    const task = suiteTasks.get(taskId) || null;
    if (!taskId) {
      throw new Error(`Run ${index} is missing task_id`);
    }
    if (!task) {
      throw new Error(`Unknown task_id in recorded run: ${taskId}`);
    }
    const finalState = String(run.final_state || run.task_state || (run.completion && run.completion.final_state) || '').toLowerCase();
    const eventTypes = toEventTypes(run);
    const { scores, evidence } = scoreDimension(run, task, finalState, eventTypes);
    const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
    const max = Object.keys(scores).length * 2;
    return {
      task_id: taskId,
      task_name: task.name,
      final_state: finalState || 'unknown',
      total_score: total,
      max_score: max,
      scores,
      evidence,
    };
  });

  const aggregate = scoredRuns.reduce((acc, run) => {
    acc.total_score += run.total_score;
    acc.max_score += run.max_score;
    for (const [key, value] of Object.entries(run.scores)) {
      acc.dimension_totals[key] = (acc.dimension_totals[key] || 0) + value;
    }
    return acc;
  }, { total_score: 0, max_score: 0, dimension_totals: {} });

  const overallPercent = aggregate.max_score === 0 ? 0 : Math.round((aggregate.total_score / aggregate.max_score) * 100);
  const verdict = aggregate.total_score >= 18 ? 'strong_useful_execution'
    : (aggregate.total_score >= 12 ? 'partial_usefulness_needs_hardening' : 'unreliable_or_misleading_tool_behavior');

  const output = {
    status: 'pass',
    verdict,
    suite_id: suite.suite_id,
    recorded_run_path: runPath,
    run_count: scoredRuns.length,
    aggregate: {
      total_score: aggregate.total_score,
      max_score: aggregate.max_score,
      percent: overallPercent,
      dimension_totals: aggregate.dimension_totals,
    },
    runs: scoredRuns,
  };

  console.log(JSON.stringify(output, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
}
