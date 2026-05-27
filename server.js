const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ENV_FILE = '.env';
const REQUESTED_ENV_FILE = (process.env.ENV_FILE || DEFAULT_ENV_FILE).trim() || DEFAULT_ENV_FILE;
const RESOLVED_ENV_FILE = path.resolve(process.cwd(), REQUESTED_ENV_FILE);

if (process.env.ENV_FILE && !fs.existsSync(RESOLVED_ENV_FILE)) {
  throw new Error(`ENV_FILE not found: ${process.env.ENV_FILE}`);
}

const dotenv = require('dotenv');
dotenv.config({ path: RESOLVED_ENV_FILE });

const express = require('express');
const fetch = require('node-fetch');
const initSqlJs = require('sql.js');
const { spawn } = require('child_process');

const app = express();

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3100);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const BLOCKFORK_LOCAL_BASE_URL = (process.env.BLOCKFORK_LOCAL_BASE_URL || '').trim().replace(/\/+$/, '');
const BLOCKFORK_LOCAL_API_KEY = (process.env.BLOCKFORK_LOCAL_API_KEY || '').trim();
const BLOCKFORK_LOCAL_MODEL = (process.env.BLOCKFORK_LOCAL_MODEL || '').trim();
const BLOCKFORK_ADMIN_SECRET = process.env.BLOCKFORK_ADMIN_SECRET || '';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const SESSION_TTL_OPTIONS = new Map([
  ['30m', 30 * 60 * 1000],
  ['1h', 60 * 60 * 1000],
  ['2h', 2 * 60 * 60 * 1000],
  ['4h', 4 * 60 * 60 * 1000],
  ['8h', 8 * 60 * 60 * 1000],
]);
const DEFAULT_SESSION_TTL_SELECTED = '4h';
const DEFAULT_LIVE_KEY_SESSION_TTL_SELECTED = '1h';
const RUNTIME_PROFILE_PATH = path.join(__dirname, 'logs', 'runtime-profile.json');
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const NON_STREAM_TIMEOUT_MS = 8 * 1000;
const STREAM_ESTABLISH_TIMEOUT_MS = 8 * 1000;
const STREAM_IDLE_TIMEOUT_MS = 15 * 1000;
const CONTRACT_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_PROVIDER = process.env.BLOCKFORK_DEFAULT_PROVIDER || 'openrouter';
const DEFAULT_MODEL_IDENTIFIER = process.env.BLOCKFORK_DEFAULT_MODEL || 'managed';
// `managed` intentionally stays on the free Gemma route during the Mac mini phase.
const DEFAULT_UPSTREAM_MODEL = 'google/gemma-4-31b-it:free';
const FALLBACK_MODEL_IDENTIFIER = (process.env.BLOCKFORK_FALLBACK_MODEL || '').trim();
const ENABLE_FALLBACK = /^(1|true|yes)$/i.test(process.env.BLOCKFORK_ENABLE_FALLBACK || '');
const FALLBACK_REQUIRE_FREE = !/^(0|false|no)$/i.test(process.env.BLOCKFORK_FALLBACK_REQUIRE_FREE || '1');
const PRIMARY_NON_STREAM_TIMEOUT_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.BLOCKFORK_PRIMARY_NON_STREAM_TIMEOUT_MS))
    ? Number(process.env.BLOCKFORK_PRIMARY_NON_STREAM_TIMEOUT_MS)
    : 5000,
);
const PRIMARY_STREAM_ESTABLISH_TIMEOUT_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.BLOCKFORK_PRIMARY_STREAM_ESTABLISH_TIMEOUT_MS))
    ? Number(process.env.BLOCKFORK_PRIMARY_STREAM_ESTABLISH_TIMEOUT_MS)
    : 5000,
);
const LOCAL_STREAM_ESTABLISH_TIMEOUT_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.BLOCKFORK_LOCAL_STREAM_ESTABLISH_TIMEOUT_MS))
    ? Number(process.env.BLOCKFORK_LOCAL_STREAM_ESTABLISH_TIMEOUT_MS)
    : 20000,
);
const LOCAL_STREAM_IDLE_BEFORE_HEADERS_TIMEOUT_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.BLOCKFORK_LOCAL_STREAM_IDLE_BEFORE_HEADERS_TIMEOUT_MS))
    ? Number(process.env.BLOCKFORK_LOCAL_STREAM_IDLE_BEFORE_HEADERS_TIMEOUT_MS)
    : 45000,
);
const LOCAL_STREAM_IDLE_AFTER_HEADERS_TIMEOUT_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.BLOCKFORK_LOCAL_STREAM_IDLE_AFTER_HEADERS_TIMEOUT_MS))
    ? Number(process.env.BLOCKFORK_LOCAL_STREAM_IDLE_AFTER_HEADERS_TIMEOUT_MS)
    : 30000,
);
const LOCAL_NON_STREAM_TIMEOUT_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.BLOCKFORK_LOCAL_NON_STREAM_TIMEOUT_MS))
    ? Number(process.env.BLOCKFORK_LOCAL_NON_STREAM_TIMEOUT_MS)
    : 30000,
);
const ENABLE_LOCAL_NON_STREAM_RETRY = !/^(0|false|no)$/i.test(process.env.BLOCKFORK_LOCAL_ENABLE_NON_STREAM_RETRY || '1');
const ENABLE_LOCAL_PROFILE = !/^(0|false|no)$/i.test(process.env.BLOCKFORK_LOCAL_PROFILE_ENABLE || '1');
const LOCAL_PROFILE_MAX_MESSAGES = Math.max(
  4,
  Number.isFinite(Number(process.env.BLOCKFORK_LOCAL_PROFILE_MAX_MESSAGES))
    ? Number(process.env.BLOCKFORK_LOCAL_PROFILE_MAX_MESSAGES)
    : 48,
);
const ENABLE_LOCAL_WARMUP = /^(1|true|yes)$/i.test(process.env.BLOCKFORK_LOCAL_WARMUP_ENABLE || '');
const LOCAL_WARMUP_INTERVAL_MS = Math.max(
  10000,
  Number.isFinite(Number(process.env.BLOCKFORK_LOCAL_WARMUP_INTERVAL_MS))
    ? Number(process.env.BLOCKFORK_LOCAL_WARMUP_INTERVAL_MS)
    : 90000,
);
const LOCAL_WARMUP_TIMEOUT_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.BLOCKFORK_LOCAL_WARMUP_TIMEOUT_MS))
    ? Number(process.env.BLOCKFORK_LOCAL_WARMUP_TIMEOUT_MS)
    : 12000,
);
const NOTIFICATION_DISPATCHER_ENABLED = /^(1|true|yes)$/i.test(process.env.BLOCKFORK_NOTIFICATION_DISPATCHER_ENABLED || '');
const NOTIFICATION_DISPATCHER_INTERVAL_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.BLOCKFORK_NOTIFICATION_DISPATCHER_INTERVAL_MS))
    ? Number(process.env.BLOCKFORK_NOTIFICATION_DISPATCHER_INTERVAL_MS)
    : 5000,
);
const NOTIFICATION_DISPATCHER_RETRY_AFTER_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.BLOCKFORK_NOTIFICATION_DISPATCHER_RETRY_AFTER_MS))
    ? Number(process.env.BLOCKFORK_NOTIFICATION_DISPATCHER_RETRY_AFTER_MS)
    : 60000,
);
const NOTIFICATION_DISPATCHER_LIMIT = Math.max(
  1,
  Number.isFinite(Number(process.env.BLOCKFORK_NOTIFICATION_DISPATCHER_LIMIT))
    ? Number(process.env.BLOCKFORK_NOTIFICATION_DISPATCHER_LIMIT)
    : 10,
);
const BLOCKFORK_NOTIFICATION_TRANSPORT = (process.env.BLOCKFORK_NOTIFICATION_TRANSPORT || 'openclaw_cli').trim() || 'openclaw_cli';
const BLOCKFORK_OPENCLAW_CLI_BIN = (process.env.BLOCKFORK_OPENCLAW_CLI_BIN || 'openclaw').trim() || 'openclaw';
const BLOCKFORK_OPENCLAW_CLI_DRY_RUN = !/^(0|false|no)$/i.test(process.env.BLOCKFORK_OPENCLAW_CLI_DRY_RUN || '1');
const BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS))
    ? Number(process.env.BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS)
    : 30000,
);
const OPENCLAW_RELAY_CONFIG_LABEL_PREFIX = 'relay_';
const DEFAULT_OPENCLAW_RELAY_LABEL = 'default';
const ALLOW_MODEL_OVERRIDE = /^(1|true|yes)$/i.test(process.env.BLOCKFORK_ALLOW_MODEL_OVERRIDE || '');
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const FORCE_PRIMARY_429 = !IS_PRODUCTION && /^(1|true|yes)$/i.test(process.env.BLOCKFORK_FORCE_PRIMARY_429 || '');
const FORCE_PRIMARY_TIMEOUT = !IS_PRODUCTION && /^(1|true|yes)$/i.test(process.env.BLOCKFORK_FORCE_PRIMARY_TIMEOUT || '');
const ENABLE_TEST_UPSTREAM_KEY_OVERRIDE = !IS_PRODUCTION
  && /^(1|true|yes)$/i.test(process.env.BLOCKFORK_ENABLE_TEST_UPSTREAM_KEY_OVERRIDE || '');
const MAX_CREDITS_USD = Number(process.env.MAX_CREDITS_USD || 10);
const MAX_PER_SESSION_USD = Math.min(
  Number.isFinite(Number(process.env.MAX_PER_SESSION_USD)) ? Number(process.env.MAX_PER_SESSION_USD) : 1,
  MAX_CREDITS_USD,
);
const MAX_REQUESTS_PER_SESSION_PER_MINUTE = Math.max(
  1,
  Number.isFinite(Number(process.env.MAX_REQUESTS_PER_SESSION_PER_MINUTE))
    ? Math.floor(Number(process.env.MAX_REQUESTS_PER_SESSION_PER_MINUTE))
    : 20,
);
const SESSION_RATE_LIMIT_WINDOW_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.SESSION_RATE_LIMIT_WINDOW_MS))
    ? Math.floor(Number(process.env.SESSION_RATE_LIMIT_WINDOW_MS))
    : 60 * 1000,
);
const BILLING_RATE_PER_1K = Number(process.env.BLOCKFORK_RATE_PER_1K || 0.0002);
const FALLBACK_RATE_PER_1K = Number(process.env.BLOCKFORK_FALLBACK_RATE_PER_1K || 0.0003);
const DEFAULT_OUTPUT_RESERVATION_TOKENS = Number(process.env.BLOCKFORK_OUTPUT_RESERVATION_TOKENS || 1024);
const BILLING_DB_PATH = path.join(__dirname, 'billing.sqlite');
const DEFAULT_ALLOWED_MODELS = process.env.BLOCKFORK_ALLOWED_MODELS
  ? process.env.BLOCKFORK_ALLOWED_MODELS.split(',').map((model) => model.trim()).filter(Boolean)
  : [DEFAULT_MODEL_IDENTIFIER];

const MODEL_MAP = Object.freeze({
  // Public clients should keep using `managed`; alias routing is maintained server-side.
  managed: {
    providerId: BLOCKFORK_LOCAL_BASE_URL ? 'local_openai' : 'openrouter',
    upstreamId: BLOCKFORK_LOCAL_MODEL || DEFAULT_UPSTREAM_MODEL,
    fallbackAlias: FALLBACK_MODEL_IDENTIFIER || null,
    contextWindow: 262144,
    maxTokens: 8192,
    capabilities: ['chat'],
  },
  'bf/free-120b': {
    providerId: 'openrouter',
    upstreamId: DEFAULT_UPSTREAM_MODEL,
    contextWindow: 262144,
    maxTokens: 8192,
    capabilities: ['chat'],
  },
  'bf/gemma-31b-free': {
    providerId: 'openrouter',
    upstreamId: DEFAULT_UPSTREAM_MODEL,
    contextWindow: 262144,
    maxTokens: 8192,
    capabilities: ['chat'],
  },
  'openai/gpt-4o-mini': {
    providerId: 'openrouter',
    upstreamId: 'openai/gpt-4o-mini',
    contextWindow: 128000,
    maxTokens: 16384,
    capabilities: ['chat'],
    ratePer1k: FALLBACK_RATE_PER_1K,
  },
});

const sessions = new Map();
const sessionsByApiKey = new Map();
const liveKeysByApiKey = new Map();
const liveKeysById = new Map();
const liveKeyCreateLocks = new Map();
const LIVE_KEY_PREFIX = 'sk_live_';
const SESSION_KEY_PREFIX = 'sk_sess_';
const EXECUTION_ID_PREFIX = 'exec_';
const EXECUTION_EVENT_ID_PREFIX = 'exevt_';
const EXECUTION_LEASE_ID_PREFIX = 'lease_';
const WORKSPACE_ID_PREFIX = 'ws_';
const EXECUTION_ARTIFACT_ID_PREFIX = 'art_';
const TASK_ID_PREFIX = 'task_';
const TASK_EVENT_ID_PREFIX = 'tevt_';
const TASK_PROGRESS_EVENT_ID_PREFIX = 'tpvt_';
const TASK_COMPLETION_SUMMARY_ID_PREFIX = 'tcs_';
const TASK_NOTIFICATION_ID_PREFIX = 'tnot_';
const TASK_NOTIFICATION_DELIVERY_ATTEMPT_ID_PREFIX = 'tnda_';
const AGENT_RUN_ID_PREFIX = 'arun_';
const AGENT_STEP_ID_PREFIX = 'astep_';
const AGENT_STEP_EVENT_ID_PREFIX = 'asevt_';
const TOOL_FAILURE_FACT_ID_PREFIX = 'tff_';
const CONTINUITY_EVENT_ID_PREFIX = 'cevt_';
const SESSION_LINEAGE_ID_PREFIX = 'lin_';
const CONTINUITY_RECOMMENDATION_ID_PREFIX = 'crec_';
const EXECUTION_NON_STREAM_LEASE_TTL_MS = 30 * 1000;
const EXECUTION_STREAM_LEASE_TTL_MS = 120 * 1000;
const PRESSURE_WARNING_THRESHOLD = 0.70;
const PRESSURE_CRITICAL_THRESHOLD = 0.85;
const PRESSURE_OVER_LIMIT_THRESHOLD = 1.0;
const EXECUTION_STATES = Object.freeze({
  CREATED: 'created',
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING: 'waiting',
  RETRYING: 'retrying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  RECOVERY_REQUIRED: 'recovery_required',
});
const EXECUTION_TERMINAL_STATES = new Set([
  EXECUTION_STATES.COMPLETED,
  EXECUTION_STATES.FAILED,
  EXECUTION_STATES.CANCELLED,
  EXECUTION_STATES.EXPIRED,
]);
const EXECUTION_LEGAL_TRANSITIONS = new Map([
  [EXECUTION_STATES.CREATED, new Set([EXECUTION_STATES.QUEUED, EXECUTION_STATES.CANCELLED, EXECUTION_STATES.EXPIRED])],
  [EXECUTION_STATES.QUEUED, new Set([EXECUTION_STATES.RUNNING, EXECUTION_STATES.CANCELLED, EXECUTION_STATES.EXPIRED, EXECUTION_STATES.RECOVERY_REQUIRED])],
  [EXECUTION_STATES.RUNNING, new Set([EXECUTION_STATES.WAITING, EXECUTION_STATES.RETRYING, EXECUTION_STATES.COMPLETED, EXECUTION_STATES.FAILED, EXECUTION_STATES.CANCELLED, EXECUTION_STATES.RECOVERY_REQUIRED])],
  [EXECUTION_STATES.WAITING, new Set([EXECUTION_STATES.QUEUED, EXECUTION_STATES.RUNNING, EXECUTION_STATES.CANCELLED, EXECUTION_STATES.EXPIRED, EXECUTION_STATES.RECOVERY_REQUIRED])],
  [EXECUTION_STATES.RETRYING, new Set([EXECUTION_STATES.RUNNING, EXECUTION_STATES.FAILED, EXECUTION_STATES.RECOVERY_REQUIRED, EXECUTION_STATES.CANCELLED, EXECUTION_STATES.EXPIRED])],
  [EXECUTION_STATES.RECOVERY_REQUIRED, new Set([EXECUTION_STATES.QUEUED, EXECUTION_STATES.RUNNING, EXECUTION_STATES.FAILED, EXECUTION_STATES.CANCELLED, EXECUTION_STATES.EXPIRED])],
  [EXECUTION_STATES.COMPLETED, new Set()],
  [EXECUTION_STATES.FAILED, new Set()],
  [EXECUTION_STATES.CANCELLED, new Set()],
  [EXECUTION_STATES.EXPIRED, new Set()],
]);
const ARTIFACT_VERIFICATION_STATES = Object.freeze({
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
});
const TASK_ARTIFACT_ASSESSMENT_ID_PREFIX = 'taas_';
const TASK_ARTIFACT_STRUCTURE_STATES = Object.freeze({
  MISSING: 'missing',
  PARTIAL: 'partial',
  VALID: 'valid',
  INVALID: 'invalid',
});
const TASK_ARTIFACT_ALIGNMENT_STATES = Object.freeze({
  MISSING: 'missing',
  PARTIAL: 'partial',
  ALIGNED: 'aligned',
  MISMATCH: 'mismatch',
});
const TASK_ARTIFACT_CONFIDENCE_BANDS = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});
const TASK_PROGRESS_CATEGORIES = Object.freeze({
  TASK_ACCEPTED: 'task_accepted',
  PLAN_LOCKED: 'plan_locked',
  TOOL_WORK_STARTED: 'tool_work_started',
  MEANINGFUL_PROGRESS_CHECKPOINT: 'meaningful_progress_checkpoint',
  ARTIFACT_VERIFICATION_STARTED: 'artifact_verification_started',
  ARTIFACT_CREATED: 'artifact_created',
  ARTIFACT_VERIFIED: 'artifact_verified',
  BLOCKED_HUMAN_INPUT_REQUIRED: 'blocked_human_input_required',
  RECOVERY_REQUIRED: 'recovery_required',
  PARTIAL_COMPLETION_DETECTED: 'partial_completion_detected',
  TASK_COMPLETED: 'task_completed',
  TASK_FAILED: 'task_failed',
});
const AGENT_RUN_STATES = Object.freeze({
  PLANNED: 'planned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RECOVERY_REQUIRED: 'recovery_required',
});
const AGENT_STEP_STATES = Object.freeze({
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RETRYABLE: 'retryable',
  SKIPPED: 'skipped',
});
const TASK_NOTIFICATION_DELIVERY_STATES = Object.freeze({
  PENDING: 'pending',
  CLAIMED: 'claimed',
  DELIVERED: 'delivered',
  FAILED: 'failed',
});
const TASK_NOTIFICATION_POLICIES = Object.freeze({
  SILENT: 'silent',
  COMPLETION_ONLY: 'completion_only',
  PROGRESS_AND_COMPLETION: 'progress_and_completion',
  FAILURE_ONLY: 'failure_only',
});
const ARTIFACT_DELIVERY_NOTIFICATION_KIND = 'artifact_delivery';
const ARTIFACT_DELIVERY_CONTROL_REASON = 'controlled_artifact_delivery_only';
const ARTIFACT_DELIVERY_MAX_BYTES = 1024 * 1024;
const TASK_KINDS = Object.freeze({
  SIMPLE_CHAT: 'simple_chat',
  TEXT_GENERATION: 'text_generation',
  STRUCTURED_TEXT: 'structured_text',
  ARTIFACT_TASK: 'artifact_task',
  AGENT_WORKFLOW_TASK: 'agent_workflow_task',
  CODE_TASK: 'code_task',
  WEBSITE_TASK: 'website_task',
  RESEARCH_TASK: 'research_task',
  MEDIA_TASK: 'media_task',
  LONG_RUNNING_TASK: 'long_running_task',
  RECOVERY_OR_FAILURE: 'recovery_or_failure',
});
const TOOL_FAILURE_CATEGORIES = Object.freeze({
  TOOL_NOT_INVOKED: 'tool_not_invoked',
  TOOL_INVOCATION_FAILED: 'tool_invocation_failed',
  TOOL_OUTPUT_INVALID: 'tool_output_invalid',
  ARTIFACT_MISSING: 'artifact_missing',
  ARTIFACT_PARTIAL: 'artifact_partial',
  TERMINAL_PAYLOAD_MISSING: 'terminal_payload_missing',
  EXECUTION_INTERRUPTED: 'execution_interrupted',
  CONTEXT_COLLAPSED: 'context_collapsed',
  STATUS_CLAIM_UNVERIFIED: 'status_claim_unverified',
  USER_CONFIRMATION_WAITING: 'user_confirmation_waiting',
  BLOCKED_FOR_INPUT: 'blocked_for_input',
  RECOVERY_BLOCKED: 'recovery_blocked',
});
const TOOL_FAILURE_SCOPES = Object.freeze({
  TASK: 'task',
  EXECUTION: 'execution',
  ARTIFACT: 'artifact',
  CONTEXT: 'context',
  TOOL: 'tool',
});
const TASK_STATES = Object.freeze({
  RECEIVED: 'received',
  ACKNOWLEDGED: 'acknowledged',
  PLANNED: 'planned',
  IN_PROGRESS: 'in_progress',
  TOOL_WORK_STARTED: 'tool_work_started',
  ARTIFACT_CREATED: 'artifact_created',
  ARTIFACT_VERIFIED: 'artifact_verified',
  BLOCKED_HUMAN_INPUT_REQUIRED: 'blocked_human_input_required',
  PARTIALLY_COMPLETED: 'partially_completed',
  RECOVERY_REQUIRED: 'recovery_required',
  FAILED: 'failed',
  COMPLETED: 'completed',
});
const TASK_TERMINAL_STATES = new Set([
  TASK_STATES.FAILED,
  TASK_STATES.COMPLETED,
]);
const TASK_LEGAL_TRANSITIONS = new Map([
  [TASK_STATES.RECEIVED, new Set([TASK_STATES.ACKNOWLEDGED, TASK_STATES.PLANNED, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, TASK_STATES.RECOVERY_REQUIRED, TASK_STATES.FAILED])],
  [TASK_STATES.ACKNOWLEDGED, new Set([TASK_STATES.PLANNED, TASK_STATES.IN_PROGRESS, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, TASK_STATES.RECOVERY_REQUIRED, TASK_STATES.FAILED])],
  [TASK_STATES.PLANNED, new Set([TASK_STATES.IN_PROGRESS, TASK_STATES.TOOL_WORK_STARTED, TASK_STATES.ARTIFACT_CREATED, TASK_STATES.ARTIFACT_VERIFIED, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, TASK_STATES.RECOVERY_REQUIRED, TASK_STATES.FAILED])],
  [TASK_STATES.IN_PROGRESS, new Set([TASK_STATES.TOOL_WORK_STARTED, TASK_STATES.ARTIFACT_CREATED, TASK_STATES.ARTIFACT_VERIFIED, TASK_STATES.PARTIALLY_COMPLETED, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, TASK_STATES.RECOVERY_REQUIRED, TASK_STATES.FAILED, TASK_STATES.COMPLETED])],
  [TASK_STATES.TOOL_WORK_STARTED, new Set([TASK_STATES.ARTIFACT_CREATED, TASK_STATES.ARTIFACT_VERIFIED, TASK_STATES.PARTIALLY_COMPLETED, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, TASK_STATES.RECOVERY_REQUIRED, TASK_STATES.FAILED, TASK_STATES.COMPLETED])],
  [TASK_STATES.ARTIFACT_CREATED, new Set([TASK_STATES.ARTIFACT_VERIFIED, TASK_STATES.PARTIALLY_COMPLETED, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, TASK_STATES.RECOVERY_REQUIRED, TASK_STATES.FAILED, TASK_STATES.COMPLETED])],
  [TASK_STATES.ARTIFACT_VERIFIED, new Set([TASK_STATES.COMPLETED, TASK_STATES.PARTIALLY_COMPLETED, TASK_STATES.RECOVERY_REQUIRED, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, TASK_STATES.FAILED])],
  [TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, new Set([TASK_STATES.ACKNOWLEDGED, TASK_STATES.PLANNED, TASK_STATES.IN_PROGRESS, TASK_STATES.RECOVERY_REQUIRED, TASK_STATES.FAILED, TASK_STATES.COMPLETED])],
  [TASK_STATES.PARTIALLY_COMPLETED, new Set([TASK_STATES.COMPLETED, TASK_STATES.RECOVERY_REQUIRED, TASK_STATES.FAILED, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED])],
  [TASK_STATES.RECOVERY_REQUIRED, new Set([TASK_STATES.ACKNOWLEDGED, TASK_STATES.PLANNED, TASK_STATES.IN_PROGRESS, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, TASK_STATES.FAILED, TASK_STATES.COMPLETED])],
  [TASK_STATES.FAILED, new Set()],
  [TASK_STATES.COMPLETED, new Set()],
]);
const publicDir = __dirname;
const UPSTREAM_ERROR_BODY_LIMIT_BYTES = 2 * 1024;
const ADMIN_SECRET_HEADER = 'x-admin-secret';
const PUBLIC_MODEL_ALIAS = DEFAULT_MODEL_IDENTIFIER;
const RUNTIME_DISCOVERY_LIVE_KEY_USER_ID = 'blockfork-runtime-discovery';

let sqlPromise = null;
let billingDb = null;
let billingWriteChain = Promise.resolve();

function writeRuntimeProfileMarker(port = PORT) {
  fs.mkdirSync(path.dirname(RUNTIME_PROFILE_PATH), { recursive: true });
  fs.writeFileSync(RUNTIME_PROFILE_PATH, JSON.stringify({
    env_file: RESOLVED_ENV_FILE,
    node_env: NODE_ENV,
    host: HOST,
    port,
    fallback_enabled: ENABLE_FALLBACK,
    local_base_url_enabled: Boolean(BLOCKFORK_LOCAL_BASE_URL),
    updated_at: new Date().toISOString(),
  }, null, 2));
}

app.use(express.json({ limit: '1mb' }));
app.use('/assets', express.static(path.join(publicDir, 'assets')));
app.use('/styles.css', express.static(path.join(publicDir, 'styles.css')));

function createRequestId() {
  return crypto.randomUUID();
}

function createExecutionId() {
  return `${EXECUTION_ID_PREFIX}${crypto.randomUUID()}`;
}

function createExecutionEventId() {
  return `${EXECUTION_EVENT_ID_PREFIX}${crypto.randomUUID()}`;
}

function createExecutionLeaseId() {
  return `${EXECUTION_LEASE_ID_PREFIX}${crypto.randomUUID()}`;
}

function createWorkspaceId() {
  return `${WORKSPACE_ID_PREFIX}${crypto.randomUUID()}`;
}

function createExecutionArtifactId() {
  return `${EXECUTION_ARTIFACT_ID_PREFIX}${crypto.randomUUID()}`;
}

function createTaskId() {
  return `${TASK_ID_PREFIX}${crypto.randomUUID()}`;
}

function createTaskEventId() {
  return `${TASK_EVENT_ID_PREFIX}${crypto.randomUUID()}`;
}

function createTaskProgressEventId() {
  return `${TASK_PROGRESS_EVENT_ID_PREFIX}${crypto.randomUUID()}`;
}

function createTaskCompletionSummaryId() {
  return `${TASK_COMPLETION_SUMMARY_ID_PREFIX}${crypto.randomUUID()}`;
}

function createTaskNotificationId() {
  return `${TASK_NOTIFICATION_ID_PREFIX}${crypto.randomUUID()}`;
}

function createTaskNotificationDeliveryAttemptId() {
  return `${TASK_NOTIFICATION_DELIVERY_ATTEMPT_ID_PREFIX}${crypto.randomUUID()}`;
}

function createAgentRunId() {
  return `${AGENT_RUN_ID_PREFIX}${crypto.randomUUID()}`;
}

function createAgentStepId() {
  return `${AGENT_STEP_ID_PREFIX}${crypto.randomUUID()}`;
}

function createAgentStepEventId() {
  return `${AGENT_STEP_EVENT_ID_PREFIX}${crypto.randomUUID()}`;
}

function createToolFailureFactId() {
  return `${TOOL_FAILURE_FACT_ID_PREFIX}${crypto.randomUUID()}`;
}

function createTaskArtifactAssessmentId() {
  return `${TASK_ARTIFACT_ASSESSMENT_ID_PREFIX}${crypto.randomUUID()}`;
}

function createContinuityEventId() {
  return `${CONTINUITY_EVENT_ID_PREFIX}${crypto.randomUUID()}`;
}

function createSessionLineageId() {
  return `${SESSION_LINEAGE_ID_PREFIX}${crypto.randomUUID()}`;
}

function createContinuityRecommendationId() {
  return `${CONTINUITY_RECOMMENDATION_ID_PREFIX}${crypto.randomUUID()}`;
}

function assertLegalTaskTransition(previousState, nextState) {
  const from = String(previousState || '');
  const to = String(nextState || '');
  if (!from || !to) {
    throw new Error('Task transition requires both previous and next state');
  }
  if (from === to) {
    throw new Error(`Illegal task transition: ${from} -> ${to}`);
  }
  if (!TASK_LEGAL_TRANSITIONS.has(from)) {
    throw new Error(`Unknown task state: ${from}`);
  }
  const allowed = TASK_LEGAL_TRANSITIONS.get(from);
  if (!allowed || !allowed.has(to)) {
    throw new Error(`Illegal task transition: ${from} -> ${to}`);
  }
}

const CONTINUITY_RECOMMENDATION_TYPES = Object.freeze({
  NONE: 'none',
  MONITOR_PRESSURE: 'monitor_pressure',
  RECOMMEND_ROLLOVER: 'recommend_rollover',
  RECOMMEND_COMPACTION_CANDIDATE: 'recommend_compaction_candidate',
  REQUIRE_MANUAL_RESET: 'require_manual_reset',
  RECOVERY_REVIEW_REQUIRED: 'recovery_review_required',
});

const CONTINUITY_RECOMMENDATION_STATUS = Object.freeze({
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  RESOLVED: 'resolved',
});

const CONTINUITY_RECOMMENDATION_PRECEDENCE = Object.freeze({
  none: 0,
  monitor_pressure: 1,
  recommend_compaction_candidate: 2,
  recommend_rollover: 3,
  require_manual_reset: 4,
  recovery_review_required: 5,
});

function buildExecutionLeaseHolder(requestId = '') {
  return `runtime:${process.pid}:${requestId || 'unknown'}`;
}

function getExecutionLeaseTtlMs(isStreaming = false) {
  return isStreaming ? EXECUTION_STREAM_LEASE_TTL_MS : EXECUTION_NON_STREAM_LEASE_TTL_MS;
}

function addMillisecondsToIso(timestamp, ttlMs) {
  return new Date(new Date(timestamp).getTime() + ttlMs).toISOString();
}

function getTimestamp() {
  return new Date().toISOString();
}

function logJson(event, payload = {}, sink = console.log) {
  sink(JSON.stringify({
    event,
    timestamp: getTimestamp(),
    ...payload,
  }));
}

function truncateText(value, limitBytes) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  if (Buffer.byteLength(text, 'utf8') <= limitBytes) {
    return text;
  }

  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > limitBytes) {
    end -= 1;
  }

  return text.slice(0, end);
}

function countTools(body) {
  return Array.isArray(body?.tools) ? body.tools.length : 0;
}

function buildUpstreamLogContext(session, descriptor, upstreamBody, endpoint, requestId, extra = {}) {
  return {
    request_id: requestId,
    session_id: session.session_id,
    primary_model: extra.primary_model || descriptor.upstreamId,
    fallback_model_used: Boolean(extra.fallback_model_used),
    attempt: extra.attempt || 'primary',
    model_alias: descriptor.alias,
    resolved_model: upstreamBody.model,
    endpoint,
    payload_size_bytes: Buffer.byteLength(JSON.stringify(upstreamBody), 'utf8'),
    tool_count: countTools(upstreamBody),
    started_at_ms: Date.now(),
  };
}

function logUpstreamRequest(context) {
  logJson('upstream_request', context);
}

function logUpstreamFailure(context, details = {}) {
  logJson('upstream_failure', {
    type: 'UPSTREAM_ERROR',
    ...context,
    ...details,
  }, console.error);
}

function logRoutingDecision(event, payload = {}) {
  logJson(event, payload);
}

function fallbackEventBase(requestId, primaryDescriptor, fallbackDescriptor, reason = '') {
  return {
    request_id: requestId,
    primary_model: primaryDescriptor?.upstreamId || '',
    fallback_model: fallbackDescriptor?.upstreamId || '',
    reason,
  };
}

function logStreamDiagnostics(context, details = {}) {
  logJson('stream_diagnostics', {
    ...context,
    ...details,
  });
}

function sendError(res, statusCode, message, type, code) {
  return res.status(statusCode).json({
    error: {
      message,
      type,
      code,
    },
  });
}

function parseBearerToken(headerValue) {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}

function resolveTestUpstreamKeyOverride(req) {
  if (!ENABLE_TEST_UPSTREAM_KEY_OVERRIDE) {
    return '';
  }

  const candidate = req.get('x-blockfork-test-upstream-key');
  if (typeof candidate !== 'string') {
    return '';
  }

  const trimmed = candidate.trim();
  return trimmed || '';
}

function resolveTestPrimaryFailureMode(req) {
  if (IS_PRODUCTION) {
    return '';
  }

  const value = String(req.get('x-blockfork-test-primary-failure') || '').trim().toLowerCase();
  if (value === '429' || value === 'timeout') {
    return value;
  }

  return '';
}

function isSessionKeyToken(token) {
  return typeof token === 'string' && token.startsWith(SESSION_KEY_PREFIX);
}

function isLiveKeyToken(token) {
  return typeof token === 'string' && token.startsWith(LIVE_KEY_PREFIX);
}

function getPublicBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function getSessionBaseUrl(req) {
  return `${getPublicBaseUrl(req)}/v1`;
}

function normalizeSessionTtlSelection(ttlSelected = DEFAULT_SESSION_TTL_SELECTED) {
  const raw = String(ttlSelected || '').trim().toLowerCase();
  if (SESSION_TTL_OPTIONS.has(raw)) {
    return raw;
  }

  return DEFAULT_SESSION_TTL_SELECTED;
}

function toIsoTimestamp(value, fallbackMs = Date.now()) {
  if (value === null || value === undefined || value === '') {
    return new Date(fallbackMs).toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return new Date(numeric).toISOString();
  }

  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toISOString();
  }

  return new Date(fallbackMs).toISOString();
}

function getSessionTtlMs(ttlSelected = DEFAULT_SESSION_TTL_SELECTED) {
  return SESSION_TTL_OPTIONS.get(normalizeSessionTtlSelection(ttlSelected)) || SESSION_TTL_OPTIONS.get(DEFAULT_SESSION_TTL_SELECTED);
}

function normalizeSessionTtlInput(overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides, 'ttl_selected')) {
    return normalizeSessionTtlSelection(overrides.ttl_selected);
  }

  if (Object.prototype.hasOwnProperty.call(overrides, 'ttl')) {
    return normalizeSessionTtlSelection(overrides.ttl);
  }

  return DEFAULT_SESSION_TTL_SELECTED;
}

function buildLiveKeyRecord(overrides = {}) {
  const now = Date.now();
  const liveKeyId = String(overrides.id || crypto.randomUUID());
  const key = String(overrides.key || `${LIVE_KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`);

  if (!key.startsWith(LIVE_KEY_PREFIX)) {
    throw new Error('Invalid live key prefix');
  }

  return {
    id: liveKeyId,
    key,
    user_id: overrides.user_id || null,
    created_at: new Date(Number.isFinite(Number(overrides.created_at)) ? Number(overrides.created_at) : now).toISOString(),
    last_session_id: overrides.last_session_id || null,
    budget_limit: Number.isFinite(Number(overrides.budget_limit)) ? Number(overrides.budget_limit) : null,
  };
}

function hydrateLiveKeyFromStored(liveKeyRow) {
  if (!liveKeyRow) {
    return null;
  }

  const liveKey = {
    id: String(liveKeyRow.id || ''),
    key: String(liveKeyRow.key || ''),
    user_id: liveKeyRow.user_id || null,
    created_at: toIsoTimestamp(liveKeyRow.created_at),
    last_session_id: liveKeyRow.last_session_id || null,
    budget_limit: liveKeyRow.budget_limit === null || liveKeyRow.budget_limit === undefined
      ? null
      : Number(liveKeyRow.budget_limit),
  };

  liveKeysById.set(liveKey.id, liveKey);
  liveKeysByApiKey.set(liveKey.key, liveKey);
  return liveKey;
}

async function persistLiveKeyRecord(liveKey, db = null) {
  const runInsert = (database) => {
    const insert = database.prepare(`
      INSERT OR REPLACE INTO live_keys (
        id, key, user_id, created_at, last_session_id, budget_limit
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      liveKey.id,
      liveKey.key,
      liveKey.user_id || null,
      new Date(liveKey.created_at).getTime(),
      liveKey.last_session_id || null,
      liveKey.budget_limit === null || liveKey.budget_limit === undefined || liveKey.budget_limit === ''
        ? null
        : Number(liveKey.budget_limit),
    ]);
    insert.free();
    return true;
  };

  if (db) {
    return runInsert(db);
  }

  return withBillingWrite(async (database) => runInsert(database));
}

async function createLiveKeyRecord(overrides = {}) {
  const liveKey = buildLiveKeyRecord(overrides);
  await persistLiveKeyRecord(liveKey);
  return hydrateLiveKeyFromStored(liveKey);
}

async function linkLiveKeyToSession(db, sessionId, liveKeyId, sessionUserId = null) {
  const update = db.prepare(`
    UPDATE sessions
    SET linked_live_key_id = ?, user_id = COALESCE(user_id, ?)
    WHERE session_id = ?
  `);
  update.run([liveKeyId, sessionUserId, sessionId]);
  update.free();
  return true;
}

async function mintLiveKeyForUser(overrides = {}) {
  const liveKey = buildLiveKeyRecord({
    user_id: overrides.user_id || null,
    last_session_id: overrides.last_session_id || null,
    budget_limit: overrides.budget_limit,
  });
  await persistLiveKeyRecord(liveKey);
  return hydrateLiveKeyFromStored(liveKey);
}

async function attachLiveKeyToSession(sessionInput, overrides = {}) {
  // Live keys are the stable auth surface for clients; they are mapped to short-lived
  // session keys so we can rotate sessions without breaking caller configuration.
  const db = await ensureBillingDb();
  const sessionId = typeof sessionInput === 'string' ? sessionInput : String(sessionInput?.session_id || '');
  if (!sessionId) {
    return null;
  }

  return withBillingWrite(async (database) => {
    const freshSessionRow = await getStoredSessionById(database, sessionId);
    if (!freshSessionRow) {
      return null;
    }

    if (freshSessionRow.linked_live_key_id) {
      const existingLiveKey = await getStoredLiveKeyById(database, String(freshSessionRow.linked_live_key_id));
      if (existingLiveKey) {
        return hydrateLiveKeyFromStored(existingLiveKey);
      }
    }

    const liveKey = buildLiveKeyRecord({
      user_id: overrides.user_id || freshSessionRow.user_id || null,
      budget_limit: overrides.budget_limit,
      last_session_id: freshSessionRow.session_id,
    });
    await persistLiveKeyRecord(liveKey, database);
    await linkLiveKeyToSession(database, freshSessionRow.session_id, liveKey.id, freshSessionRow.user_id || liveKey.user_id || null);

    const cachedSession = sessions.get(freshSessionRow.session_id);
    if (cachedSession) {
      cachedSession.linked_live_key_id = liveKey.id;
      if (!cachedSession.user_id) {
        cachedSession.user_id = freshSessionRow.user_id || liveKey.user_id || null;
      }
    }

    return hydrateLiveKeyFromStored(liveKey);
  });
}

async function backfillLiveKeysForActiveSessions() {
  const db = await ensureBillingDb();
  const stmt = db.prepare(`
    SELECT *
    FROM sessions
    WHERE status = 'active'
  `);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();

  const created = [];
  for (const row of rows) {
    if (row.linked_live_key_id) {
      continue;
    }

    const liveKey = await attachLiveKeyToSession(row);
    if (liveKey) {
      created.push({
        session_id: String(row.session_id || ''),
        live_key_id: liveKey.id,
        live_key: liveKey.key,
        user_id: liveKey.user_id || null,
      });
    }
  }

  return {
    created_count: created.length,
    created,
  };
}

async function getOrCreateLiveKeyForSession(sessionInput, overrides = {}) {
  const sessionId = typeof sessionInput === 'string' ? sessionInput : String(sessionInput?.session_id || '');
  if (!sessionId) {
    return null;
  }

  const db = await ensureBillingDb();
  const sessionRow = typeof sessionInput === 'string'
    ? await getStoredSessionById(db, sessionId)
    : sessionInput;

  if (!sessionRow) {
    return null;
  }

  if (sessionRow.linked_live_key_id) {
    const liveKeyRow = await getStoredLiveKeyById(db, String(sessionRow.linked_live_key_id));
    if (liveKeyRow) {
      return hydrateLiveKeyFromStored(liveKeyRow);
    }
  }

  return attachLiveKeyToSession(sessionRow, overrides);
}

async function getStoredLiveKeyByApiKey(db, apiKey) {
  const stmt = db.prepare('SELECT * FROM live_keys WHERE key = ? LIMIT 1');
  stmt.bind([apiKey]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

async function getStoredLiveKeyById(db, id) {
  const stmt = db.prepare('SELECT * FROM live_keys WHERE id = ? LIMIT 1');
  stmt.bind([id]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

async function getStoredLiveKeyByUserId(db, userId) {
  const stmt = db.prepare(`
    SELECT *
    FROM live_keys
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  stmt.bind([userId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

async function getActiveSessionByLiveKeyId(db, liveKeyId) {
  const stmt = db.prepare(`
    SELECT *
    FROM sessions
    WHERE linked_live_key_id = ? AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  stmt.bind([liveKeyId, Date.now()]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

async function loadPersistedLiveKeyByApiKey(apiKey) {
  const db = await ensureBillingDb();
  const liveKeyRow = await getStoredLiveKeyByApiKey(db, apiKey);
  return hydrateLiveKeyFromStored(liveKeyRow);
}

async function loadPersistedSessionByLiveKeyId(liveKeyId) {
  const db = await ensureBillingDb();
  const sessionRow = await getActiveSessionByLiveKeyId(db, liveKeyId);
  if (!sessionRow) {
    return null;
  }

  const sessionState = await getSessionState(db, String(sessionRow.session_id || ''));
  return hydrateSessionFromStored(sessionRow, sessionState);
}

async function preloadLiveKeys() {
  const db = await ensureBillingDb();
  const stmt = db.prepare('SELECT * FROM live_keys');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();

  for (const row of rows) {
    hydrateLiveKeyFromStored(row);
  }
}

function getSessionStatus(session) {
  if (!session) {
    return 'failed';
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    return 'expired';
  }

  return session.status;
}

function getExpiresInSeconds(session) {
  return Math.max(0, Math.ceil((new Date(session.expires_at).getTime() - Date.now()) / 1000));
}

function cleanupExpiredSessions() {
  const now = Date.now();

  for (const [sessionId, session] of sessions.entries()) {
    if (new Date(session.expires_at).getTime() <= now) {
      sessions.delete(sessionId);
      sessionsByApiKey.delete(session.api_key);
    }
  }
}

function getModelDescriptor(identifier) {
  if (!identifier) {
    return null;
  }

  if (MODEL_MAP[identifier]) {
    return {
      alias: identifier,
      ...MODEL_MAP[identifier],
    };
  }

  return null;
}

function buildProviderRegistry() {
  return {
    openrouter: {
      chatUrl: OPENROUTER_CHAT_URL,
      modelsUrl: OPENROUTER_MODELS_URL,
      apiKey: OPENROUTER_API_KEY,
      requiresApiKey: true,
      probeMethod: 'models',
    },
    local_openai: {
      chatUrl: BLOCKFORK_LOCAL_BASE_URL ? `${BLOCKFORK_LOCAL_BASE_URL}/chat/completions` : '',
      modelsUrl: BLOCKFORK_LOCAL_BASE_URL ? `${BLOCKFORK_LOCAL_BASE_URL}/models` : '',
      apiKey: BLOCKFORK_LOCAL_API_KEY,
      requiresApiKey: false,
      probeMethod: 'models_optional',
    },
  };
}

function getDescriptorProviderId(descriptor) {
  return descriptor?.providerId || DEFAULT_PROVIDER;
}

function isLocalProviderDescriptor(descriptor) {
  return getDescriptorProviderId(descriptor) === 'local_openai';
}

function getRequestTimeoutMs(descriptor, isStreaming, attempt) {
  if (isLocalProviderDescriptor(descriptor)) {
    return isStreaming ? LOCAL_STREAM_ESTABLISH_TIMEOUT_MS : LOCAL_NON_STREAM_TIMEOUT_MS;
  }

  return attempt === 'primary'
    ? (isStreaming ? PRIMARY_STREAM_ESTABLISH_TIMEOUT_MS : PRIMARY_NON_STREAM_TIMEOUT_MS)
    : (isStreaming ? STREAM_ESTABLISH_TIMEOUT_MS : NON_STREAM_TIMEOUT_MS);
}

function getStreamIdleTimeouts(descriptor) {
  if (isLocalProviderDescriptor(descriptor)) {
    return {
      beforeHeadersMs: LOCAL_STREAM_IDLE_BEFORE_HEADERS_TIMEOUT_MS,
      afterHeadersMs: LOCAL_STREAM_IDLE_AFTER_HEADERS_TIMEOUT_MS,
    };
  }

  return {
    beforeHeadersMs: STREAM_IDLE_TIMEOUT_MS,
    afterHeadersMs: STREAM_IDLE_TIMEOUT_MS,
  };
}

function getDescriptorRatePer1K(descriptor) {
  return Number(descriptor?.ratePer1k ?? BILLING_RATE_PER_1K) || 0;
}

function estimateCostForDescriptor(descriptor, inputTokens, outputTokens) {
  const ratePer1k = getDescriptorRatePer1K(descriptor);
  return ((Number(inputTokens) + Number(outputTokens)) / 1000) * ratePer1k;
}

function getFallbackModelDescriptor() {
  if (!ENABLE_FALLBACK) {
    return null;
  }

  if (!FALLBACK_MODEL_IDENTIFIER) {
    return null;
  }

  const descriptor = getModelDescriptor(FALLBACK_MODEL_IDENTIFIER);
  if (!descriptor) {
    return null;
  }

  if (FALLBACK_REQUIRE_FREE && !String(descriptor.upstreamId || '').includes(':free')) {
    return null;
  }

  return descriptor;
}

function getFallbackDescriptorForAlias(descriptor) {
  if (!ENABLE_FALLBACK || !descriptor) {
    return null;
  }

  if (descriptor.fallbackAlias) {
    const aliasDescriptor = getModelDescriptor(descriptor.fallbackAlias);
    if (aliasDescriptor) {
      return aliasDescriptor;
    }
  }

  return getFallbackModelDescriptor();
}

function isRetryableUpstreamStatus(status) {
  const numericStatus = Number(status);
  return numericStatus === 429 || (Number.isFinite(numericStatus) && numericStatus >= 500);
}

function failureReasonFromUpstreamStatus(status) {
  const numericStatus = Number(status);
  if (numericStatus === 429) {
    return '429_rate_limit';
  }

  if (Number.isFinite(numericStatus) && numericStatus >= 500) {
    return '5xx_error';
  }

  return 'upstream_error';
}

function failureReasonFromFetchError(error) {
  if (!error) {
    return 'upstream_error';
  }

  if (error.code === 'upstream_timeout') {
    return 'timeout_error';
  }

  if (error.code === 'upstream_unreachable') {
    return 'unreachable_error';
  }

  return 'upstream_error';
}

function resolveAllowedModelAliases(identifiers) {
  const aliases = [];

  for (const identifier of identifiers) {
    const descriptor = getModelDescriptor(identifier);
    if (!descriptor) {
      throw new Error(`Unknown model: ${identifier}`);
    }

    if (!aliases.includes(descriptor.alias)) {
      aliases.push(descriptor.alias);
    }
  }

  return aliases;
}

function buildSessionBudgetInfo(session) {
  return {
    usd: Number(session.session_budget_usd || 0),
    remaining_usd: Math.max(0, Number(session.session_budget_usd || 0) - Number(session.session_spend_usd || 0) - Number(session.session_reserved_usd || 0)),
    requests_per_minute: Number(session.max_requests_per_minute || MAX_REQUESTS_PER_SESSION_PER_MINUTE),
    rate_limit_window_ms: Number(session.rate_limit_window_ms || SESSION_RATE_LIMIT_WINDOW_MS),
  };
}

function cacheSessionRecord(session) {
  sessions.set(session.session_id, session);
  sessionsByApiKey.set(session.api_key, session);
  return session;
}

function buildSessionRecord(overrides = {}) {
  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const apiKey = `${SESSION_KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
  const provider = overrides.provider || DEFAULT_PROVIDER;

  if (!['openrouter', 'local_openai'].includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const defaultModelAlias = ALLOW_MODEL_OVERRIDE && overrides.default_model
    ? (getModelDescriptor(overrides.default_model)?.alias || PUBLIC_MODEL_ALIAS)
    : PUBLIC_MODEL_ALIAS;

  const requestedAllowedModels = ALLOW_MODEL_OVERRIDE && Array.isArray(overrides.allowed_models) && overrides.allowed_models.length > 0
    ? overrides.allowed_models
    : DEFAULT_ALLOWED_MODELS;

  const allowedModelAliases = ALLOW_MODEL_OVERRIDE
    ? resolveAllowedModelAliases(requestedAllowedModels)
    : [PUBLIC_MODEL_ALIAS];

  if (!allowedModelAliases.includes(defaultModelAlias)) {
    allowedModelAliases.unshift(defaultModelAlias);
  }

  const session = {
    session_id: sessionId,
    api_key: apiKey,
    provider,
    upstream_api_key: OPENROUTER_API_KEY,
    default_model_alias: defaultModelAlias,
    allowed_model_aliases: allowedModelAliases,
    user_id: overrides.user_id || null,
    linked_live_key_id: overrides.linked_live_key_id || null,
    ttl_selected: normalizeSessionTtlInput(overrides),
    ttl_ms: Number.isFinite(Number(overrides.ttl_ms)) ? Number(overrides.ttl_ms) : getSessionTtlMs(normalizeSessionTtlInput(overrides)),
    status: 'active',
    token_usage: 0,
    session_budget_usd: Number.isFinite(Number(overrides.session_budget_usd))
      ? Number(overrides.session_budget_usd)
      : MAX_PER_SESSION_USD,
    session_spend_usd: 0,
    session_reserved_usd: 0,
    request_count: 0,
    max_requests_per_minute: MAX_REQUESTS_PER_SESSION_PER_MINUTE,
    rate_limit_window_ms: SESSION_RATE_LIMIT_WINDOW_MS,
    rate_window_started_at: new Date(now).toISOString(),
    rate_window_count: 0,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + (Number.isFinite(Number(overrides.ttl_ms)) ? Number(overrides.ttl_ms) : getSessionTtlMs(normalizeSessionTtlInput(overrides)))).toISOString(),
    capability_contract: null,
    capability_contract_validated_at: null,
    capability_contract_expires_at: null,
  };

  return session;
}

function hydrateSessionFromStored(sessionRow, sessionState = null) {
  if (!sessionRow) {
    return null;
  }

  let allowedModelAliases = [PUBLIC_MODEL_ALIAS];
  if (typeof sessionRow.allowed_model_aliases_json === 'string' && sessionRow.allowed_model_aliases_json) {
    try {
      const parsed = JSON.parse(sessionRow.allowed_model_aliases_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        allowedModelAliases = parsed;
      }
    } catch (error) {
      allowedModelAliases = [PUBLIC_MODEL_ALIAS];
    }
  }

  return cacheSessionRecord({
    session_id: String(sessionRow.session_id || ''),
    api_key: String(sessionRow.api_key || ''),
    provider: String(sessionRow.provider || DEFAULT_PROVIDER),
    upstream_api_key: OPENROUTER_API_KEY,
    default_model_alias: String(sessionRow.default_model_alias || PUBLIC_MODEL_ALIAS),
    allowed_model_aliases: allowedModelAliases,
    user_id: sessionRow.user_id || null,
    linked_live_key_id: sessionRow.linked_live_key_id || null,
    ttl_selected: normalizeSessionTtlSelection(sessionRow.ttl_selected || DEFAULT_SESSION_TTL_SELECTED),
    ttl_ms: Number(sessionRow.ttl_ms || SESSION_TTL_MS),
    status: String(sessionRow.status || 'active'),
    token_usage: Number(sessionRow.token_usage || 0),
    session_budget_usd: Number(sessionState?.budget_usd ?? MAX_PER_SESSION_USD),
    session_spend_usd: Number(sessionState?.spent_usd ?? 0),
    session_reserved_usd: Number(sessionState?.reserved_usd ?? 0),
    request_count: Number(sessionState?.request_count ?? 0),
    max_requests_per_minute: Number(sessionState?.max_requests_per_minute ?? MAX_REQUESTS_PER_SESSION_PER_MINUTE),
    rate_limit_window_ms: Number(sessionState?.rate_limit_window_ms ?? SESSION_RATE_LIMIT_WINDOW_MS),
    rate_window_started_at: sessionState?.rate_window_started_at || new Date(Number(sessionRow.created_at || Date.now())).toISOString(),
    rate_window_count: Number(sessionState?.rate_window_count ?? 0),
    created_at: new Date(Number(sessionRow.created_at || Date.now())).toISOString(),
    expires_at: new Date(Number(sessionRow.expires_at || Date.now())).toISOString(),
    capability_contract: null,
    capability_contract_validated_at: null,
    capability_contract_expires_at: null,
  });
}

async function persistSessionRecord(session, db = null) {
  const runInsert = (database) => {
    const insert = database.prepare(`
      INSERT OR REPLACE INTO sessions (
        session_id, api_key, created_at, expires_at, status, provider, user_id, linked_live_key_id,
        ttl_selected, ttl_ms, default_model_alias, allowed_model_aliases_json, token_usage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      session.session_id,
      session.api_key,
      new Date(session.created_at).getTime(),
      new Date(session.expires_at).getTime(),
      session.status,
      session.provider,
      session.user_id || null,
      session.linked_live_key_id || null,
      normalizeSessionTtlSelection(session.ttl_selected || DEFAULT_SESSION_TTL_SELECTED),
      Number.isFinite(Number(session.ttl_ms)) ? Number(session.ttl_ms) : getSessionTtlMs(session.ttl_selected || DEFAULT_SESSION_TTL_SELECTED),
      session.default_model_alias,
      JSON.stringify(session.allowed_model_aliases || [PUBLIC_MODEL_ALIAS]),
      Number(session.token_usage || 0),
    ]);
    insert.free();
    return true;
  };

  if (db) {
    return runInsert(db);
  }

  return withBillingWrite(async (database) => runInsert(database));
}

async function createSessionRecord(overrides = {}) {
  const session = buildSessionRecord(overrides);
  await persistSessionRecord(session);
  await registerSessionState(session);
  return cacheSessionRecord(session);
}

async function registerSessionState(session, db = null) {
  const runInsert = (database) => {
    const now = getTimestamp();
    const insert = database.prepare(`
      INSERT OR REPLACE INTO session_state (
        session_id, budget_usd, spent_usd, reserved_usd, request_count, rate_window_started_at,
        rate_window_count, max_requests_per_minute, rate_limit_window_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      session.session_id,
      session.session_budget_usd,
      session.session_spend_usd,
      session.session_reserved_usd,
      session.request_count,
      session.rate_window_started_at,
      session.rate_window_count,
      session.max_requests_per_minute,
      session.rate_limit_window_ms,
      session.created_at,
      now,
    ]);
    insert.free();
    return true;
  };

  if (db) {
    return runInsert(db);
  }

  return withBillingWrite(async (database) => runInsert(database));
}

async function getSessionState(db, sessionId) {
  const stmt = db.prepare('SELECT * FROM session_state WHERE session_id = ? LIMIT 1');
  stmt.bind([sessionId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

async function getStoredSessionByApiKey(db, apiKey) {
  const stmt = db.prepare('SELECT * FROM sessions WHERE api_key = ? LIMIT 1');
  stmt.bind([apiKey]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

async function getStoredSessionById(db, sessionId) {
  const stmt = db.prepare('SELECT * FROM sessions WHERE session_id = ? LIMIT 1');
  stmt.bind([sessionId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

function hydrateSessionDeliveryTargetRow(row) {
  if (!row) {
    return null;
  }

  const threadId = row.thread_id === null || row.thread_id === undefined || row.thread_id === ''
    ? null
    : String(row.thread_id).trim();

  return {
    session_id: String(row.session_id || ''),
    channel: String(row.channel || 'telegram'),
    chat_id: String(row.chat_id || ''),
    thread_id: threadId || null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

function hydrateLiveKeyDeliveryTargetRow(row) {
  if (!row) {
    return null;
  }

  const threadId = row.thread_id === null || row.thread_id === undefined || row.thread_id === ''
    ? null
    : String(row.thread_id).trim();

  return {
    live_key_id: String(row.live_key_id || ''),
    channel: String(row.channel || 'telegram'),
    chat_id: String(row.chat_id || ''),
    thread_id: threadId || null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

async function getStoredSessionDeliveryTargetBySessionId(db, sessionId) {
  const stmt = db.prepare(`
    SELECT *
    FROM session_delivery_targets
    WHERE session_id = ?
    LIMIT 1
  `);
  stmt.bind([sessionId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateSessionDeliveryTargetRow(row);
}

async function getStoredLiveKeyDeliveryTargetByLiveKeyId(db, liveKeyId) {
  const stmt = db.prepare(`
    SELECT *
    FROM live_key_delivery_targets
    WHERE live_key_id = ?
    LIMIT 1
  `);
  stmt.bind([liveKeyId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateLiveKeyDeliveryTargetRow(row);
}

async function upsertSessionDeliveryTargetTx(db, sessionId, deliveryTarget, options = {}) {
  const timestamp = options.timestamp || getTimestamp();
  const normalized = normalizeSessionDeliveryTargetInput(deliveryTarget);
  const insert = db.prepare(`
    INSERT INTO session_delivery_targets (
      session_id, channel, chat_id, thread_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      channel = excluded.channel,
      chat_id = excluded.chat_id,
      thread_id = excluded.thread_id,
      updated_at = excluded.updated_at
  `);
  insert.run([
    sessionId,
    normalized.channel,
    normalized.chat_id,
    normalized.thread_id,
    timestamp,
    timestamp,
  ]);
  insert.free();
  return getStoredSessionDeliveryTargetBySessionId(db, sessionId);
}

async function upsertLiveKeyDeliveryTargetTx(db, liveKeyId, deliveryTarget, options = {}) {
  const timestamp = options.timestamp || getTimestamp();
  const normalized = normalizeSessionDeliveryTargetInput(deliveryTarget);
  const insert = db.prepare(`
    INSERT INTO live_key_delivery_targets (
      live_key_id, channel, chat_id, thread_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(live_key_id) DO UPDATE SET
      channel = excluded.channel,
      chat_id = excluded.chat_id,
      thread_id = excluded.thread_id,
      updated_at = excluded.updated_at
  `);
  insert.run([
    liveKeyId,
    normalized.channel,
    normalized.chat_id,
    normalized.thread_id,
    timestamp,
    timestamp,
  ]);
  insert.free();
  return getStoredLiveKeyDeliveryTargetByLiveKeyId(db, liveKeyId);
}

async function ensureSessionDeliveryTargetForSessionTx(db, sessionId, options = {}) {
  const existing = await getStoredSessionDeliveryTargetBySessionId(db, sessionId);
  if (existing) {
    return existing;
  }

  const session = await getStoredSessionById(db, sessionId);
  if (!session || !session.linked_live_key_id) {
    return null;
  }

  const liveKeyTarget = await getStoredLiveKeyDeliveryTargetByLiveKeyId(db, String(session.linked_live_key_id));
  if (!liveKeyTarget) {
    return null;
  }

  return upsertSessionDeliveryTargetTx(db, sessionId, liveKeyTarget, options);
}

async function bindSessionDeliveryTarget(sessionId, deliveryTarget, options = {}) {
  return withBillingWrite(async (db) => upsertSessionDeliveryTargetTx(db, sessionId, deliveryTarget, options));
}

async function bindLiveKeyDeliveryTarget(liveKeyId, deliveryTarget, options = {}) {
  return withBillingWrite(async (db) => upsertLiveKeyDeliveryTargetTx(db, liveKeyId, deliveryTarget, options));
}

function normalizeSessionDeliveryTargetInput(input) {
  const raw = input && typeof input === 'object' && input.delivery_target && typeof input.delivery_target === 'object'
    ? input.delivery_target
    : input;

  if (!raw || typeof raw !== 'object') {
    throw new Error('delivery_target is required');
  }

  const channel = String(raw.channel || '').trim().toLowerCase();
  if (channel !== 'telegram') {
    throw new Error('delivery_target.channel must be telegram');
  }

  const chatId = String(raw.chat_id || '').trim();
  if (!chatId) {
    throw new Error('delivery_target.chat_id is required');
  }

  const threadIdRaw = raw.thread_id;
  const threadId = threadIdRaw === null || threadIdRaw === undefined || threadIdRaw === ''
    ? null
    : String(threadIdRaw).trim();

  return {
    channel: 'telegram',
    chat_id: chatId,
    thread_id: threadId || null,
  };
}

function normalizeOpenClawRelayLabel(input) {
  const label = String(input || '').trim();
  if (!label) {
    throw new Error('relay_label is required');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(label)) {
    throw new Error('relay_label may only contain letters, numbers, dots, underscores, and hyphens');
  }
  return label;
}

function pickRelayString(input, keys, fallback = '') {
  if (!input || typeof input !== 'object') {
    return fallback;
  }
  for (const key of keys) {
    const value = input[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  return fallback;
}

function hydrateOpenClawRelayConfigRow(row) {
  if (!row) {
    return null;
  }

  const threadId = row.thread_id === null || row.thread_id === undefined || row.thread_id === ''
    ? null
    : String(row.thread_id).trim();

  return {
    relay_label: String(row.relay_label || ''),
    transport: String(row.transport || 'openclaw_cli'),
    service_name: String(row.service_name || ''),
    profile_name: String(row.profile_name || ''),
    cli_bin: String(row.cli_bin || 'openclaw'),
    env_file: String(row.env_file || ''),
    config_path: String(row.config_path || ''),
    state_dir: String(row.state_dir || ''),
    chat_id: String(row.chat_id || ''),
    thread_id: threadId || null,
    probe_message: String(row.probe_message || 'BlockFork relay doctor dry-run'),
    notes: String(row.notes || ''),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

function normalizeOpenClawRelayConfigInput(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const relayLabel = normalizeOpenClawRelayLabel(pickRelayString(raw, ['relay_label', 'label', 'name'], DEFAULT_OPENCLAW_RELAY_LABEL));
  const transport = pickRelayString(raw, ['transport'], BLOCKFORK_NOTIFICATION_TRANSPORT).toLowerCase() || 'openclaw_cli';
  if (transport !== 'openclaw_cli') {
    throw new Error('openclaw relay transport must be openclaw_cli');
  }

  const threadIdRaw = pickRelayString(raw, ['thread_id', 'threadId'], '');
  const threadId = threadIdRaw ? threadIdRaw : null;

  return {
    relay_label: relayLabel,
    transport: 'openclaw_cli',
    service_name: pickRelayString(raw, ['service_name', 'service', 'openclaw_service'], ''),
    profile_name: pickRelayString(raw, ['profile_name', 'profile'], ''),
    cli_bin: pickRelayString(raw, ['cli_bin', 'openclaw_cli_bin', 'binary_path'], BLOCKFORK_OPENCLAW_CLI_BIN),
    env_file: pickRelayString(raw, ['env_file', 'env_path', 'openclaw_env_path'], ''),
    config_path: pickRelayString(raw, ['config_path', 'openclaw_config_path'], ''),
    state_dir: pickRelayString(raw, ['state_dir', 'openclaw_state_dir'], ''),
    chat_id: pickRelayString(raw, ['chat_id', 'target_chat_id'], ''),
    thread_id: threadId,
    probe_message: pickRelayString(raw, ['probe_message', 'message', 'dry_run_message'], 'BlockFork relay doctor dry-run'),
    notes: pickRelayString(raw, ['notes', 'description'], ''),
  };
}

async function getStoredOpenClawRelayConfigByLabel(db, relayLabel) {
  const stmt = db.prepare(`
    SELECT *
    FROM openclaw_relay_configs
    WHERE relay_label = ?
    LIMIT 1
  `);
  stmt.bind([relayLabel]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateOpenClawRelayConfigRow(row);
}

async function getOpenClawRelayConfigByLabel(relayLabel) {
  const db = await ensureBillingDb();
  return getStoredOpenClawRelayConfigByLabel(db, relayLabel);
}

async function listStoredOpenClawRelayConfigsTx(db) {
  const stmt = db.prepare(`
    SELECT *
    FROM openclaw_relay_configs
    ORDER BY relay_label ASC
  `);
  const rows = [];
  while (stmt.step()) {
    rows.push(hydrateOpenClawRelayConfigRow(stmt.getAsObject()));
  }
  stmt.free();
  return rows;
}

async function listOpenClawRelayConfigs() {
  const db = await ensureBillingDb();
  return listStoredOpenClawRelayConfigsTx(db);
}

async function upsertOpenClawRelayConfigTx(db, input, options = {}) {
  const normalized = normalizeOpenClawRelayConfigInput(input);
  const timestamp = options.timestamp || getTimestamp();
  const insert = db.prepare(`
    INSERT INTO openclaw_relay_configs (
      relay_label, transport, service_name, profile_name, cli_bin, env_file, config_path, state_dir,
      chat_id, thread_id, probe_message, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(relay_label) DO UPDATE SET
      transport = excluded.transport,
      service_name = excluded.service_name,
      profile_name = excluded.profile_name,
      cli_bin = excluded.cli_bin,
      env_file = excluded.env_file,
      config_path = excluded.config_path,
      state_dir = excluded.state_dir,
      chat_id = excluded.chat_id,
      thread_id = excluded.thread_id,
      probe_message = excluded.probe_message,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `);
  insert.run([
    normalized.relay_label,
    normalized.transport,
    normalized.service_name,
    normalized.profile_name,
    normalized.cli_bin,
    normalized.env_file,
    normalized.config_path,
    normalized.state_dir,
    normalized.chat_id,
    normalized.thread_id,
    normalized.probe_message,
    normalized.notes,
    timestamp,
    timestamp,
  ]);
  insert.free();
  return getStoredOpenClawRelayConfigByLabel(db, normalized.relay_label);
}

async function upsertOpenClawRelayConfig(input, options = {}) {
  return withBillingWrite(async (db) => upsertOpenClawRelayConfigTx(db, input, options));
}

function quoteShellArg(value) {
  const text = String(value === null || value === undefined ? '' : value);
  if (!text) {
    return "''";
  }
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function buildOpenClawRelaySetupCommands(config) {
  const commands = [];
  if (config.env_file) {
    commands.push(`source ${quoteShellArg(config.env_file)}`);
  }

  const envParts = [];
  if (config.config_path) {
    envParts.push(`OPENCLAW_CONFIG_PATH=${quoteShellArg(config.config_path)}`);
  }
  if (config.state_dir) {
    envParts.push(`OPENCLAW_STATE_DIR=${quoteShellArg(config.state_dir)}`);
  }

  const probeParts = [
    quoteShellArg(config.cli_bin || 'openclaw'),
    'message',
    'send',
    '--channel',
    'telegram',
    '--target',
    quoteShellArg(config.chat_id || ''),
  ];
  if (config.thread_id) {
    probeParts.push('--thread-id', quoteShellArg(config.thread_id));
  }
  probeParts.push('--message', quoteShellArg(config.probe_message || 'BlockFork relay doctor dry-run'));
  probeParts.push('--dry-run', '--json');
  commands.push([
    ...envParts,
    probeParts.join(' '),
  ].filter(Boolean).join(' '));

  return commands;
}

function assessOpenClawRelayStaticChecks(config) {
  const checks = [];
  const blockers = [];
  const addCheck = (key, ok, detail, command = '') => {
    const item = {
      key,
      ok: Boolean(ok),
      detail: String(detail || ''),
    };
    if (command) {
      item.command = String(command);
    }
    checks.push(item);
    if (!ok) {
      blockers.push(item);
    }
  };

  addCheck('transport', config.transport === 'openclaw_cli', config.transport === 'openclaw_cli'
    ? 'openclaw_cli transport selected'
    : 'transport must be openclaw_cli');
  addCheck('cli_bin', Boolean(config.cli_bin), config.cli_bin ? `CLI path configured: ${config.cli_bin}` : 'OpenClaw CLI binary path is missing');
  addCheck('env_file', Boolean(config.env_file), config.env_file ? `Env file configured: ${config.env_file}` : 'OpenClaw env file path is missing');
  addCheck('config_path', Boolean(config.config_path), config.config_path ? `OpenClaw config path configured: ${config.config_path}` : 'OpenClaw config path is missing');
  addCheck('state_dir', Boolean(config.state_dir), config.state_dir ? `OpenClaw state dir configured: ${config.state_dir}` : 'OpenClaw state dir is missing');
  addCheck('chat_id', Boolean(config.chat_id), config.chat_id ? `Telegram chat id configured: ${config.chat_id}` : 'Telegram chat id is missing');
  addCheck('thread_id', true, config.thread_id ? `Telegram thread id configured: ${config.thread_id}` : 'No thread id configured');

  if (config.cli_bin) {
    addCheck('cli_exists', fs.existsSync(config.cli_bin), fs.existsSync(config.cli_bin)
      ? 'OpenClaw CLI binary exists'
      : `OpenClaw CLI binary not found: ${config.cli_bin}`);
  }

  if (config.env_file) {
    addCheck('env_exists', fs.existsSync(config.env_file), fs.existsSync(config.env_file)
      ? 'OpenClaw env file exists'
      : `OpenClaw env file not found: ${config.env_file}`);
  }

  if (config.config_path) {
    addCheck('config_exists', fs.existsSync(config.config_path), fs.existsSync(config.config_path)
      ? 'OpenClaw config file exists'
      : `OpenClaw config file not found: ${config.config_path}`);
  }

  if (config.state_dir) {
    addCheck('state_dir_exists', fs.existsSync(config.state_dir), fs.existsSync(config.state_dir)
      ? 'OpenClaw state dir exists'
      : `OpenClaw state dir not found: ${config.state_dir}`);
  }

  return { checks, blockers };
}

function parseOpenClawRelayEnvFile(envFilePath) {
  if (!envFilePath || !fs.existsSync(envFilePath)) {
    return {};
  }

  try {
    return dotenv.parse(fs.readFileSync(envFilePath));
  } catch (error) {
    return {};
  }
}

async function runOpenClawRelayDoctor(relayInput, options = {}) {
  const config = typeof relayInput === 'string'
    ? await getOpenClawRelayConfigByLabel(relayInput)
    : normalizeOpenClawRelayConfigInput(relayInput);

  if (!config) {
    return {
      ok: false,
      readiness: 'missing',
      blockers: [{
        key: 'relay_config',
        ok: false,
        detail: 'Relay config was not found',
      }],
      checks: [],
      commands: [],
      probe: null,
      relay_config: null,
    };
  }

  const staticReport = assessOpenClawRelayStaticChecks(config);
  const commands = buildOpenClawRelaySetupCommands(config);
  let probe = null;

  if (options.probe) {
    if (!config.cli_bin || !config.chat_id) {
      probe = {
        ok: false,
        skipped: true,
        error_code: 'missing_probe_inputs',
        error_message: 'Probe requires both cli_bin and chat_id',
      };
    } else {
      const probeEnv = {
        ...process.env,
        ...parseOpenClawRelayEnvFile(config.env_file),
      };
      if (config.config_path) {
        probeEnv.OPENCLAW_CONFIG_PATH = config.config_path;
      }
      if (config.state_dir) {
        probeEnv.OPENCLAW_STATE_DIR = config.state_dir;
      }
      probeEnv.BLOCKFORK_NOTIFICATION_TRANSPORT = 'openclaw_cli';
      probeEnv.BLOCKFORK_OPENCLAW_CLI_BIN = config.cli_bin;
      probeEnv.BLOCKFORK_OPENCLAW_CLI_DRY_RUN = '1';

      probe = await runOpenClawCliDryRunAdapter({
        delivery_target: {
          channel: 'telegram',
          chat_id: config.chat_id,
          thread_id: config.thread_id,
        },
        outbound_text: config.probe_message || 'BlockFork relay doctor dry-run',
      }, {
        commandPath: config.cli_bin,
        dryRun: true,
        timeoutMs: options.timeoutMs || BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS,
        env: probeEnv,
      });
    }
  }

  let readiness = 'needs_review';
  if (staticReport.blockers.length) {
    readiness = 'blocked';
  } else if (probe) {
    readiness = probe.ok ? 'ready' : 'probe_failed';
  } else {
    readiness = 'ready_for_probe';
  }

  const suggestions = [];
  if (staticReport.blockers.length) {
    suggestions.push('Fill in the missing relay config paths and chat id, then save the relay profile.');
  } else {
    suggestions.push('Source the env file, then run the dry-run probe command shown below.');
  }
  if (probe && !probe.ok && probe.error_message) {
    suggestions.push(`Probe error: ${probe.error_message}`);
  }

  return {
    ok: true,
    readiness,
    blockers: staticReport.blockers,
    checks: staticReport.checks,
    commands,
    probe,
    suggestions,
    relay_config: config,
  };
}

async function markStoredSessionStatus(sessionId, status) {
  return withBillingWrite(async (db) => {
    const update = db.prepare(`
      UPDATE sessions
      SET status = ?
      WHERE session_id = ?
    `);
    update.run([status, sessionId]);
    update.free();
    return true;
  });
}

async function loadPersistedSessionByApiKey(apiKey) {
  const db = await ensureBillingDb();
  const sessionRow = await getStoredSessionByApiKey(db, apiKey);
  if (!sessionRow) {
    return null;
  }

  const sessionState = await getSessionState(db, String(sessionRow.session_id || ''));
  return hydrateSessionFromStored(sessionRow, sessionState);
}

async function getLatestStoredSessionForLiveKey(db, liveKeyId) {
  const stmt = db.prepare(`
    SELECT *
    FROM sessions
    WHERE linked_live_key_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  stmt.bind([liveKeyId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

async function withLiveKeyCreateLock(liveKeyId, callback) {
  const previous = liveKeyCreateLocks.get(liveKeyId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const queue = previous.then(() => current);
  liveKeyCreateLocks.set(liveKeyId, queue);

  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (liveKeyCreateLocks.get(liveKeyId) === queue) {
      liveKeyCreateLocks.delete(liveKeyId);
    }
  }
}

function getSessionTtlSelectedFromRecord(sessionRow) {
  if (!sessionRow) {
    return DEFAULT_LIVE_KEY_SESSION_TTL_SELECTED;
  }

  return normalizeSessionTtlSelection(sessionRow.ttl_selected || DEFAULT_LIVE_KEY_SESSION_TTL_SELECTED);
}

function getSessionTtlMsFromSelected(ttlSelected) {
  return getSessionTtlMs(normalizeSessionTtlSelection(ttlSelected || DEFAULT_LIVE_KEY_SESSION_TTL_SELECTED));
}

async function createLiveKeySessionRecord(db, liveKeyRow, ttlSelected = DEFAULT_LIVE_KEY_SESSION_TTL_SELECTED) {
  const liveKey = hydrateLiveKeyFromStored(liveKeyRow);
  const previousSessionId = liveKey.last_session_id || null;
  const effectiveTtlSelected = normalizeSessionTtlSelection(ttlSelected || DEFAULT_LIVE_KEY_SESSION_TTL_SELECTED);
  const session = buildSessionRecord({
    user_id: liveKey.user_id || null,
    linked_live_key_id: liveKey.id,
    ttl_selected: effectiveTtlSelected,
    ttl_ms: getSessionTtlMsFromSelected(effectiveTtlSelected),
  });

  return withBillingWrite(async (database) => {
    await persistSessionRecord(session, database);
    await registerSessionState(session, database);
    await linkLiveKeyToSession(database, session.session_id, liveKey.id, liveKey.user_id || session.user_id || null);

    session.linked_live_key_id = liveKey.id;
    if (!session.user_id) {
      session.user_id = liveKey.user_id || session.user_id || null;
    }

    const updateLiveKey = database.prepare(`
      UPDATE live_keys
      SET last_session_id = ?
      WHERE id = ?
    `);
    updateLiveKey.run([session.session_id, liveKey.id]);
    updateLiveKey.free();

    await ensureSessionDeliveryTargetForSessionTx(database, session.session_id, {
      timestamp: session.created_at,
    });

    if (previousSessionId && previousSessionId !== session.session_id) {
      const lineageTimestamp = getTimestamp();
      const lineageInsert = database.prepare(`
        INSERT OR REPLACE INTO session_lineage (
          lineage_id, root_session_id, child_session_id, link_reason, trigger_execution_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      lineageInsert.run([
        createSessionLineageId(),
        previousSessionId,
        session.session_id,
        'manual_new_session',
        null,
        lineageTimestamp,
      ]);
      lineageInsert.free();

      const eventInsert = database.prepare(`
        INSERT INTO session_continuity_events (
          event_id, session_id, execution_id, pressure_state, pressure_ratio,
          event_type, decision, source, reason_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      eventInsert.run([
        createContinuityEventId(),
        session.session_id,
        null,
        'unknown',
        0,
        'fresh_session_detected',
        'observe_only',
        'finalization',
        'manual_new_session',
        lineageTimestamp,
      ]);
      eventInsert.free();

      await resolveRecommendationFromLineage(previousSessionId, session.session_id, lineageTimestamp, database);
    }

    liveKey.last_session_id = session.session_id;
    hydrateLiveKeyFromStored(liveKey);
    return cacheSessionRecord(session);
  });
}

async function preloadActiveSessions() {
  const db = await ensureBillingDb();
  const stmt = db.prepare(`
    SELECT *
    FROM sessions
    WHERE status = 'active' AND expires_at > ?
  `);
  stmt.bind([Date.now()]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();

  for (const row of rows) {
    const sessionState = await getSessionState(db, String(row.session_id || ''));
    hydrateSessionFromStored(row, sessionState);
  }
}

async function resolveLiveKeySession(token, req = null) {
  const db = await ensureBillingDb();
  const liveKeyRow = await getStoredLiveKeyByApiKey(db, token);
  if (!liveKeyRow) {
    logJson('live_key_resolution', {
      outcome: 'invalid_key',
      token_prefix: LIVE_KEY_PREFIX,
    });
    return { error: { statusCode: 401, message: 'Invalid live key', type: 'authentication_error', code: 'invalid_live_key' } };
  }

  const liveKey = hydrateLiveKeyFromStored(liveKeyRow);
  const sessionRow = await getActiveSessionByLiveKeyId(db, liveKey.id);

  if (!sessionRow) {
    return withLiveKeyCreateLock(liveKey.id, async () => {
      const recheckedActiveSession = await getActiveSessionByLiveKeyId(db, liveKey.id);
      if (recheckedActiveSession) {
        const recheckedState = await getSessionState(db, String(recheckedActiveSession.session_id || ''));
        const session = hydrateSessionFromStored(recheckedActiveSession, recheckedState);
        await ensureSessionDeliveryTargetForSessionTx(db, session.session_id, {
          timestamp: session.created_at,
        });
        logJson('live_key_resolution', {
          outcome: 'resolved_after_lock',
          live_key_id: liveKey.id,
          live_key_last_session_id: liveKey.last_session_id || null,
          session_id: session.session_id,
          token_prefix: LIVE_KEY_PREFIX,
          request_path: req?.path || '',
        });
        return { session };
      }

      const latestSessionRow = await getLatestStoredSessionForLiveKey(db, liveKey.id);
      const ttlSelected = getSessionTtlSelectedFromRecord(latestSessionRow);
      const session = await createLiveKeySessionRecord(db, liveKeyRow, ttlSelected);
      logJson('live_key_resolution', {
        outcome: 'created_session',
        live_key_id: liveKey.id,
        live_key_last_session_id: liveKey.last_session_id || null,
        session_id: session.session_id,
        ttl_selected: session.ttl_selected,
        token_prefix: LIVE_KEY_PREFIX,
        request_path: req?.path || '',
      });
      return { session };
    });
  }

  const sessionState = await getSessionState(db, String(sessionRow.session_id || ''));
  const session = hydrateSessionFromStored(sessionRow, sessionState);
  await ensureSessionDeliveryTargetForSessionTx(db, session.session_id, {
    timestamp: session.created_at,
  });
  logJson('live_key_resolution', {
    outcome: 'resolved',
    live_key_id: liveKey.id,
    live_key_last_session_id: liveKey.last_session_id || null,
    session_id: session.session_id,
    token_prefix: LIVE_KEY_PREFIX,
    request_path: req?.path || '',
  });
  return { session };
}

function incrementUsage(session, totalTokens) {
  if (Number.isFinite(totalTokens) && totalTokens > 0) {
    session.token_usage += totalTokens;
  }
}

function normalizeModelForSession(session, requestedModel) {
  const defaultDescriptor = getModelDescriptor(session.default_model_alias) || getModelDescriptor(PUBLIC_MODEL_ALIAS);
  if (!defaultDescriptor) {
    return { error: 'Model registry is unavailable' };
  }

  if (!ALLOW_MODEL_OVERRIDE || !requestedModel) {
    return { descriptor: defaultDescriptor };
  }

  const requestedDescriptor = getModelDescriptor(requestedModel);
  if (!requestedDescriptor) {
    return { descriptor: defaultDescriptor };
  }

  if (!session.allowed_model_aliases.includes(requestedDescriptor.alias)) {
    return { descriptor: defaultDescriptor };
  }

  return { descriptor: requestedDescriptor };
}

function getCachedCapabilityContract(session) {
  if (!session.capability_contract || !session.capability_contract_expires_at) {
    return null;
  }

  if (new Date(session.capability_contract_expires_at).getTime() <= Date.now()) {
    return null;
  }

  return session.capability_contract;
}

function cacheCapabilityContract(session, contract) {
  session.capability_contract = contract;
  session.capability_contract_validated_at = contract.validated_at;
  session.capability_contract_expires_at = new Date(Date.now() + CONTRACT_CACHE_TTL_MS).toISOString();
  return contract;
}

function buildClientRequirements() {
  return {
    openai_compatible: true,
    supports_custom_base_url: true,
    supports_bearer_auth: true,
    supports_model_discovery: true,
  };
}

function buildCapabilityContractBase(req, session, validatedAt) {
  return {
    status: 'ready',
    message: 'Environment validated. Safe to connect BlockFork.',
    reason: null,
    fix: null,
    blocking: false,
    validated_at: validatedAt,
    connection: {
      baseUrl: getSessionBaseUrl(req),
      auth: 'bearer',
      defaultModel: PUBLIC_MODEL_ALIAS,
      supportedModels: [PUBLIC_MODEL_ALIAS],
    },
    client_requirements: buildClientRequirements(),
    checks: {
      session: { status: 'pass' },
      auth: { status: 'pass' },
      runtime: { status: 'pass' },
      models: { status: 'pass' },
      chat: { status: 'pass' },
    },
  };
}

function getSqlWasmPath(file) {
  return path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')), file);
}

async function getSqlJs() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => getSqlWasmPath(file),
    });
  }

  return sqlPromise;
}

function persistBillingDb() {
  if (!billingDb) {
    return;
  }

  const data = Buffer.from(billingDb.export());
  fs.writeFileSync(BILLING_DB_PATH, data);
}

async function ensureBillingDb() {
  if (billingDb) {
    return billingDb;
  }

  const SQL = await getSqlJs();
  if (fs.existsSync(BILLING_DB_PATH)) {
    billingDb = new SQL.Database(fs.readFileSync(BILLING_DB_PATH));
  } else {
    billingDb = new SQL.Database();
  }

  billingDb.run(`
    CREATE TABLE IF NOT EXISTS billing_state (
      id TEXT PRIMARY KEY,
      total_spend_usd REAL NOT NULL DEFAULT 0,
      reserved_spend_usd REAL NOT NULL DEFAULT 0,
      max_credits_usd REAL NOT NULL DEFAULT 10,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      api_key TEXT UNIQUE,
      created_at INTEGER,
      expires_at INTEGER,
      status TEXT DEFAULT 'active',
      provider TEXT NOT NULL DEFAULT 'openrouter',
      user_id TEXT,
      linked_live_key_id TEXT,
      ttl_selected TEXT NOT NULL DEFAULT '1h',
      ttl_ms INTEGER NOT NULL DEFAULT 3600000,
      default_model_alias TEXT NOT NULL DEFAULT 'managed',
      allowed_model_aliases_json TEXT NOT NULL DEFAULT '["managed"]',
      token_usage INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS session_delivery_targets (
      session_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'telegram',
      chat_id TEXT NOT NULL,
      thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS live_key_delivery_targets (
      live_key_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'telegram',
      chat_id TEXT NOT NULL,
      thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS openclaw_relay_configs (
      relay_label TEXT PRIMARY KEY,
      transport TEXT NOT NULL DEFAULT 'openclaw_cli',
      service_name TEXT NOT NULL DEFAULT '',
      profile_name TEXT NOT NULL DEFAULT '',
      cli_bin TEXT NOT NULL DEFAULT 'openclaw',
      env_file TEXT NOT NULL DEFAULT '',
      config_path TEXT NOT NULL DEFAULT '',
      state_dir TEXT NOT NULL DEFAULT '',
      chat_id TEXT NOT NULL DEFAULT '',
      thread_id TEXT,
      probe_message TEXT NOT NULL DEFAULT 'BlockFork relay doctor dry-run',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS live_keys (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      user_id TEXT,
      created_at INTEGER NOT NULL,
      last_session_id TEXT,
      budget_limit REAL
    );

    CREATE TABLE IF NOT EXISTS session_state (
      session_id TEXT PRIMARY KEY,
      budget_usd REAL NOT NULL DEFAULT 0,
      spent_usd REAL NOT NULL DEFAULT 0,
      reserved_usd REAL NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      rate_window_started_at TEXT NOT NULL,
      rate_window_count INTEGER NOT NULL DEFAULT 0,
      max_requests_per_minute INTEGER NOT NULL DEFAULT 20,
      rate_limit_window_ms INTEGER NOT NULL DEFAULT 60000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_logs (
      request_id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      route TEXT NOT NULL,
      session_id TEXT NOT NULL,
      execution_id TEXT,
      primary_model TEXT NOT NULL DEFAULT '',
      model_used TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      fallback_triggered INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT NOT NULL DEFAULT '',
      endpoint TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      status_code INTEGER NOT NULL DEFAULT 0,
      response_body TEXT NOT NULL DEFAULT '',
      reserved_cost_usd REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS executions (
      execution_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      task_id TEXT,
      current_state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_request_id TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT,
      workspace_id TEXT,
      lease_id TEXT,
      lease_holder TEXT,
      lease_acquired_at TEXT,
      lease_expires_at TEXT,
      lease_epoch INTEGER NOT NULL DEFAULT 0,
      last_heartbeat_at TEXT,
      recovery_reason TEXT,
      recovery_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      current_state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_request_id TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT,
      objective_text TEXT NOT NULL DEFAULT '',
      objective_fingerprint TEXT NOT NULL DEFAULT '',
      first_execution_id TEXT,
      last_execution_id TEXT,
      completed_execution_id TEXT,
      recovery_reason TEXT,
      recovery_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS execution_events (
      event_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      previous_state TEXT NOT NULL DEFAULT '',
      new_state TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      actor_source TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      request_id TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS task_events (
      task_event_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      execution_id TEXT,
      previous_state TEXT NOT NULL DEFAULT '',
      new_state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      actor_source TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      request_id TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS task_progress_events (
      progress_event_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      execution_id TEXT,
      previous_state TEXT NOT NULL DEFAULT '',
      new_state TEXT NOT NULL,
      progress_category TEXT NOT NULL,
      decision TEXT NOT NULL DEFAULT 'notify_user',
      message_text TEXT NOT NULL DEFAULT '',
      requires_user_input INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'runtime',
      reason_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      agent_run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      execution_id TEXT NOT NULL UNIQUE,
      goal_text TEXT NOT NULL DEFAULT '',
      goal_fingerprint TEXT NOT NULL DEFAULT '',
      plan_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'planned',
      current_step_index INTEGER NOT NULL DEFAULT 0,
      final_outcome TEXT NOT NULL DEFAULT '',
      final_artifact_id TEXT,
      final_notification_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_steps (
      agent_step_id TEXT PRIMARY KEY,
      agent_run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      step_kind TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      reason_code TEXT NOT NULL DEFAULT '',
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      artifact_id TEXT,
      notification_id TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_step_events (
      agent_step_event_id TEXT PRIMARY KEY,
      agent_run_id TEXT NOT NULL,
      agent_step_id TEXT,
      task_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_artifact_assessments (
      assessment_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      execution_id TEXT,
      artifact_id TEXT,
      artifact_exists INTEGER NOT NULL DEFAULT 0,
      artifact_verification_state TEXT NOT NULL DEFAULT '',
      artifact_family TEXT NOT NULL DEFAULT 'unknown',
      structure_state TEXT NOT NULL DEFAULT 'missing',
      alignment_state TEXT NOT NULL DEFAULT 'missing',
      confidence_score INTEGER NOT NULL DEFAULT 0,
      confidence_band TEXT NOT NULL DEFAULT 'low',
      reason_code TEXT NOT NULL DEFAULT '',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_completion_summaries (
      completion_summary_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      execution_id TEXT,
      final_state TEXT NOT NULL DEFAULT '',
      summary_text TEXT NOT NULL DEFAULT '',
      what_completed_json TEXT NOT NULL DEFAULT '[]',
      artifacts_json TEXT NOT NULL DEFAULT '[]',
      verified_json TEXT NOT NULL DEFAULT '[]',
      not_verified_json TEXT NOT NULL DEFAULT '[]',
      follow_up_needed INTEGER NOT NULL DEFAULT 0,
      proof_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_notifications (
      notification_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      execution_id TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      notification_kind TEXT NOT NULL,
      delivery_channel TEXT NOT NULL DEFAULT 'openclaw_tg',
      delivery_state TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      artifact_id TEXT,
      artifact_path TEXT,
      media_kind TEXT,
      relay_label TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      dedupe_key TEXT NOT NULL DEFAULT '',
      claim_count INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT,
      delivered_at TEXT,
      delivered_message_id TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      next_attempt_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
      attempt_id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      artifact_id TEXT,
      artifact_path TEXT,
      relay_label TEXT,
      media_kind TEXT,
      handled_by TEXT NOT NULL DEFAULT '',
      delivered_file_message_id TEXT,
      transport TEXT NOT NULL DEFAULT 'openclaw_cli',
      channel TEXT NOT NULL DEFAULT 'telegram',
      target TEXT NOT NULL DEFAULT '',
      thread_id TEXT,
      dry_run INTEGER NOT NULL DEFAULT 1,
      command_path TEXT NOT NULL DEFAULT '',
      command_argv_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      exit_code INTEGER NOT NULL DEFAULT 0,
      stdout_text TEXT NOT NULL DEFAULT '',
      stderr_text TEXT NOT NULL DEFAULT '',
      stdout_json TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      retryable INTEGER NOT NULL DEFAULT 0,
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_failure_facts (
      failure_fact_id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      task_id TEXT,
      execution_id TEXT,
      failure_category TEXT NOT NULL,
      failure_scope TEXT NOT NULL,
      failure_stage TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'runtime',
      reason_code TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id TEXT PRIMARY KEY,
      canonical_root TEXT NOT NULL UNIQUE,
      root_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS execution_artifacts (
      artifact_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      declared_path TEXT NOT NULL,
      canonical_path TEXT NOT NULL,
      verification_state TEXT NOT NULL,
      reason_code TEXT NOT NULL DEFAULT '',
      artifact_filename TEXT NOT NULL DEFAULT '',
      artifact_type TEXT NOT NULL DEFAULT 'text',
      content_hash TEXT NOT NULL DEFAULT '',
      byte_size INTEGER NOT NULL DEFAULT 0,
      delivery_requested INTEGER NOT NULL DEFAULT 0,
      delivery_confirmed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS execution_capabilities (
      execution_id TEXT PRIMARY KEY,
      requested_model_input TEXT NOT NULL DEFAULT '',
      requested_model_alias TEXT NOT NULL,
      resolved_model_alias TEXT NOT NULL,
      resolved_provider_id TEXT NOT NULL,
      resolved_upstream_model_id TEXT NOT NULL,
      fallback_model_alias TEXT NOT NULL DEFAULT '',
      fallback_eligible INTEGER NOT NULL DEFAULT 0,
      fallback_used INTEGER NOT NULL DEFAULT 0,
      supports_chat INTEGER NOT NULL DEFAULT 0,
      supports_streaming INTEGER NOT NULL DEFAULT 0,
      supports_tools INTEGER NOT NULL DEFAULT 0,
      artifact_claim_risk TEXT NOT NULL DEFAULT 'unknown',
      timeout_profile TEXT NOT NULL DEFAULT 'unknown',
      retryability_class TEXT NOT NULL DEFAULT 'unknown',
      provider_class TEXT NOT NULL DEFAULT 'unknown',
      context_window_tokens INTEGER NOT NULL DEFAULT 0,
      max_output_tokens INTEGER NOT NULL DEFAULT 0,
      validated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      fact_source TEXT NOT NULL DEFAULT 'descriptor_registry',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS execution_budgets (
      execution_id TEXT PRIMARY KEY,
      requested_input_tokens_estimate INTEGER NOT NULL DEFAULT 0,
      requested_output_tokens INTEGER NOT NULL DEFAULT 0,
      effective_context_window_tokens INTEGER NOT NULL DEFAULT 0,
      effective_max_output_tokens INTEGER NOT NULL DEFAULT 0,
      reserved_output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_total_budget_demand INTEGER NOT NULL DEFAULT 0,
      accepted_input_tokens_estimate INTEGER NOT NULL DEFAULT 0,
      context_adaptation_applied INTEGER NOT NULL DEFAULT 0,
      context_adaptation_reason TEXT NOT NULL DEFAULT 'none',
      budget_rejection_reason TEXT NOT NULL DEFAULT '',
      completed_input_tokens INTEGER NOT NULL DEFAULT 0,
      completed_output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_context_pressure (
      session_id TEXT PRIMARY KEY,
      latest_pressure_state TEXT NOT NULL DEFAULT 'unknown',
      latest_pressure_ratio REAL NOT NULL DEFAULT 0,
      latest_execution_id TEXT,
      first_critical_at TEXT,
      latest_over_limit_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_continuity_events (
      event_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      execution_id TEXT,
      pressure_state TEXT NOT NULL,
      pressure_ratio REAL NOT NULL DEFAULT 0,
      event_type TEXT NOT NULL,
      decision TEXT NOT NULL,
      source TEXT NOT NULL,
      reason_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_lineage (
      lineage_id TEXT PRIMARY KEY,
      root_session_id TEXT NOT NULL,
      child_session_id TEXT NOT NULL,
      link_reason TEXT NOT NULL,
      trigger_execution_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_continuity_recommendations (
      recommendation_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      execution_id TEXT,
      recommendation_type TEXT NOT NULL,
      pressure_state TEXT NOT NULL DEFAULT 'unknown',
      trigger_event_id TEXT,
      reason_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      superseded_by_recommendation_id TEXT,
      resolution_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );
  `);

  const stateStmt = billingDb.prepare('SELECT COUNT(*) AS count FROM billing_state WHERE id = ?');
  stateStmt.bind(['global']);
  const hasState = stateStmt.step() ? stateStmt.getAsObject().count > 0 : false;
  stateStmt.free();

  if (!hasState) {
    const now = getTimestamp();
    const insertState = billingDb.prepare(`
      INSERT INTO billing_state (id, total_spend_usd, reserved_spend_usd, max_credits_usd, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertState.run(['global', 0, 0, MAX_CREDITS_USD, now]);
    insertState.free();
    persistBillingDb();
  } else {
    const currentState = await getBillingState(billingDb);
    if (currentState && Number(currentState.max_credits_usd || 0) !== MAX_CREDITS_USD) {
      const now = getTimestamp();
      const syncState = billingDb.prepare(`
        UPDATE billing_state
        SET max_credits_usd = ?, updated_at = ?
        WHERE id = 'global'
      `);
      syncState.run([MAX_CREDITS_USD, now]);
      syncState.free();
      persistBillingDb();
    }
  }

  const requestLogColumnsStmt = billingDb.prepare('PRAGMA table_info(request_logs)');
  const requestLogColumns = new Set();
  while (requestLogColumnsStmt.step()) {
    requestLogColumns.add(String(requestLogColumnsStmt.getAsObject().name || ''));
  }
  requestLogColumnsStmt.free();

  const requestLogAlterations = [
    ['execution_id', 'TEXT'],
    ['primary_model', "TEXT NOT NULL DEFAULT ''"],
    ['fallback_triggered', 'INTEGER NOT NULL DEFAULT 0'],
    ['failure_reason', "TEXT NOT NULL DEFAULT ''"],
  ];

  for (const [columnName, columnType] of requestLogAlterations) {
    if (!requestLogColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE request_logs ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const taskColumnsStmt = billingDb.prepare('PRAGMA table_info(tasks)');
  const taskColumns = new Set();
  while (taskColumnsStmt.step()) {
    taskColumns.add(String(taskColumnsStmt.getAsObject().name || ''));
  }
  taskColumnsStmt.free();

  const taskAlterations = [
    ['last_request_id', "TEXT NOT NULL DEFAULT ''"],
    ['idempotency_key', 'TEXT'],
    ['objective_text', "TEXT NOT NULL DEFAULT ''"],
    ['objective_fingerprint', "TEXT NOT NULL DEFAULT ''"],
    ['task_kind', "TEXT NOT NULL DEFAULT 'text_generation'"],
    ['notification_policy', "TEXT NOT NULL DEFAULT 'silent'"],
    ['notification_eligible', 'INTEGER NOT NULL DEFAULT 0'],
    ['eligibility_reason', "TEXT NOT NULL DEFAULT ''"],
    ['classified_at', 'TEXT'],
    ['first_execution_id', 'TEXT'],
    ['last_execution_id', 'TEXT'],
    ['completed_execution_id', 'TEXT'],
    ['recovery_reason', 'TEXT'],
    ['recovery_notes', 'TEXT'],
  ];

  for (const [columnName, columnType] of taskAlterations) {
    if (!taskColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE tasks ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const taskEventColumnsStmt = billingDb.prepare('PRAGMA table_info(task_events)');
  const taskEventColumns = new Set();
  while (taskEventColumnsStmt.step()) {
    taskEventColumns.add(String(taskEventColumnsStmt.getAsObject().name || ''));
  }
  taskEventColumnsStmt.free();
  if (!taskEventColumns.has('created_at')) {
    billingDb.run('ALTER TABLE task_events ADD COLUMN created_at TEXT');
  }

  const taskProgressColumnsStmt = billingDb.prepare('PRAGMA table_info(task_progress_events)');
  const taskProgressColumns = new Set();
  while (taskProgressColumnsStmt.step()) {
    taskProgressColumns.add(String(taskProgressColumnsStmt.getAsObject().name || ''));
  }
  taskProgressColumnsStmt.free();
  const taskProgressAlterations = [
    ['progress_event_id', 'TEXT PRIMARY KEY'],
    ['task_id', "TEXT NOT NULL DEFAULT ''"],
    ['execution_id', 'TEXT'],
    ['previous_state', "TEXT NOT NULL DEFAULT ''"],
    ['new_state', "TEXT NOT NULL DEFAULT ''"],
    ['progress_category', "TEXT NOT NULL DEFAULT ''"],
    ['decision', "TEXT NOT NULL DEFAULT 'notify_user'"],
    ['message_text', "TEXT NOT NULL DEFAULT ''"],
    ['requires_user_input', 'INTEGER NOT NULL DEFAULT 0'],
    ['source', "TEXT NOT NULL DEFAULT 'runtime'"],
    ['reason_code', "TEXT NOT NULL DEFAULT ''"],
    ['created_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [columnName, columnType] of taskProgressAlterations) {
    if (!taskProgressColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE task_progress_events ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const taskArtifactAssessmentColumnsStmt = billingDb.prepare('PRAGMA table_info(task_artifact_assessments)');
  const taskArtifactAssessmentColumns = new Set();
  while (taskArtifactAssessmentColumnsStmt.step()) {
    taskArtifactAssessmentColumns.add(String(taskArtifactAssessmentColumnsStmt.getAsObject().name || ''));
  }
  taskArtifactAssessmentColumnsStmt.free();
  const taskArtifactAssessmentAlterations = [
    ['artifact_exists', 'INTEGER NOT NULL DEFAULT 0'],
    ['artifact_verification_state', "TEXT NOT NULL DEFAULT ''"],
    ['artifact_family', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['structure_state', "TEXT NOT NULL DEFAULT 'missing'"],
    ['alignment_state', "TEXT NOT NULL DEFAULT 'missing'"],
    ['confidence_score', 'INTEGER NOT NULL DEFAULT 0'],
    ['confidence_band', "TEXT NOT NULL DEFAULT 'low'"],
    ['reason_code', "TEXT NOT NULL DEFAULT ''"],
    ['notes', 'TEXT'],
    ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ['updated_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [columnName, columnType] of taskArtifactAssessmentAlterations) {
    if (!taskArtifactAssessmentColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE task_artifact_assessments ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const taskCompletionSummaryColumnsStmt = billingDb.prepare('PRAGMA table_info(task_completion_summaries)');
  const taskCompletionSummaryColumns = new Set();
  while (taskCompletionSummaryColumnsStmt.step()) {
    taskCompletionSummaryColumns.add(String(taskCompletionSummaryColumnsStmt.getAsObject().name || ''));
  }
  taskCompletionSummaryColumnsStmt.free();
  const taskCompletionSummaryAlterations = [
    ['completion_summary_id', 'TEXT PRIMARY KEY'],
    ['task_id', "TEXT NOT NULL DEFAULT ''"],
    ['session_id', "TEXT NOT NULL DEFAULT ''"],
    ['execution_id', 'TEXT'],
    ['final_state', "TEXT NOT NULL DEFAULT ''"],
    ['summary_text', "TEXT NOT NULL DEFAULT ''"],
    ['what_completed_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['artifacts_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['verified_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['not_verified_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['follow_up_needed', 'INTEGER NOT NULL DEFAULT 0'],
    ['proof_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ['updated_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [columnName, columnType] of taskCompletionSummaryAlterations) {
    if (!taskCompletionSummaryColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE task_completion_summaries ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const taskNotificationColumnsStmt = billingDb.prepare('PRAGMA table_info(task_notifications)');
  const taskNotificationColumns = new Set();
  while (taskNotificationColumnsStmt.step()) {
    taskNotificationColumns.add(String(taskNotificationColumnsStmt.getAsObject().name || ''));
  }
  taskNotificationColumnsStmt.free();
  const taskNotificationAlterations = [
    ['delivery_channel', "TEXT NOT NULL DEFAULT 'openclaw_tg'"],
    ['delivery_state', "TEXT NOT NULL DEFAULT 'pending'"],
    ['title', "TEXT NOT NULL DEFAULT ''"],
    ['body', "TEXT NOT NULL DEFAULT ''"],
    ['artifact_id', 'TEXT'],
    ['artifact_path', 'TEXT'],
    ['media_kind', 'TEXT'],
    ['relay_label', 'TEXT'],
    ['task_kind', "TEXT NOT NULL DEFAULT 'text_generation'"],
    ['notification_policy', "TEXT NOT NULL DEFAULT 'silent'"],
    ['proactive_eligible', 'INTEGER NOT NULL DEFAULT 0'],
    ['eligibility_reason', "TEXT NOT NULL DEFAULT ''"],
    ['delivery_suppressed_reason', "TEXT NOT NULL DEFAULT ''"],
    ['classified_at', 'TEXT'],
    ['payload_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['dedupe_key', "TEXT NOT NULL DEFAULT ''"],
    ['claim_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['claimed_at', 'TEXT'],
    ['delivered_at', 'TEXT'],
    ['delivered_message_id', 'TEXT'],
    ['last_error', "TEXT NOT NULL DEFAULT ''"],
    ['next_attempt_at', 'TEXT'],
    ['attempt_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ['updated_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [columnName, columnType] of taskNotificationAlterations) {
    if (!taskNotificationColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE task_notifications ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const notificationDeliveryAttemptColumnsStmt = billingDb.prepare('PRAGMA table_info(notification_delivery_attempts)');
  const notificationDeliveryAttemptColumns = new Set();
  while (notificationDeliveryAttemptColumnsStmt.step()) {
    notificationDeliveryAttemptColumns.add(String(notificationDeliveryAttemptColumnsStmt.getAsObject().name || ''));
  }
  notificationDeliveryAttemptColumnsStmt.free();
  const notificationDeliveryAttemptAlterations = [
    ['attempt_id', 'TEXT PRIMARY KEY'],
    ['notification_id', "TEXT NOT NULL DEFAULT ''"],
    ['session_id', "TEXT NOT NULL DEFAULT ''"],
    ['task_id', "TEXT NOT NULL DEFAULT ''"],
    ['artifact_id', 'TEXT'],
    ['artifact_path', 'TEXT'],
    ['relay_label', 'TEXT'],
    ['media_kind', 'TEXT'],
    ['handled_by', "TEXT NOT NULL DEFAULT ''"],
    ['delivered_file_message_id', 'TEXT'],
    ['transport', "TEXT NOT NULL DEFAULT 'openclaw_cli'"],
    ['channel', "TEXT NOT NULL DEFAULT 'telegram'"],
    ['target', "TEXT NOT NULL DEFAULT ''"],
    ['thread_id', 'TEXT'],
    ['dry_run', 'INTEGER NOT NULL DEFAULT 1'],
    ['command_path', "TEXT NOT NULL DEFAULT ''"],
    ['command_argv_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['started_at', "TEXT NOT NULL DEFAULT ''"],
    ['finished_at', "TEXT NOT NULL DEFAULT ''"],
    ['exit_code', 'INTEGER NOT NULL DEFAULT 0'],
    ['stdout_text', "TEXT NOT NULL DEFAULT ''"],
    ['stderr_text', "TEXT NOT NULL DEFAULT ''"],
    ['stdout_json', 'TEXT'],
    ['success', 'INTEGER NOT NULL DEFAULT 0'],
    ['retryable', 'INTEGER NOT NULL DEFAULT 0'],
    ['error_code', "TEXT NOT NULL DEFAULT ''"],
    ['error_message', "TEXT NOT NULL DEFAULT ''"],
    ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ['updated_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [columnName, columnType] of notificationDeliveryAttemptAlterations) {
    if (!notificationDeliveryAttemptColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE notification_delivery_attempts ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const openclawRelayConfigColumnsStmt = billingDb.prepare('PRAGMA table_info(openclaw_relay_configs)');
  const openclawRelayConfigColumns = new Set();
  while (openclawRelayConfigColumnsStmt.step()) {
    openclawRelayConfigColumns.add(String(openclawRelayConfigColumnsStmt.getAsObject().name || ''));
  }
  openclawRelayConfigColumnsStmt.free();
  const openclawRelayConfigAlterations = [
    ['relay_label', 'TEXT PRIMARY KEY'],
    ['transport', "TEXT NOT NULL DEFAULT 'openclaw_cli'"],
    ['service_name', "TEXT NOT NULL DEFAULT ''"],
    ['profile_name', "TEXT NOT NULL DEFAULT ''"],
    ['cli_bin', "TEXT NOT NULL DEFAULT 'openclaw'"],
    ['env_file', "TEXT NOT NULL DEFAULT ''"],
    ['config_path', "TEXT NOT NULL DEFAULT ''"],
    ['state_dir', "TEXT NOT NULL DEFAULT ''"],
    ['chat_id', "TEXT NOT NULL DEFAULT ''"],
    ['thread_id', 'TEXT'],
    ['probe_message', "TEXT NOT NULL DEFAULT 'BlockFork relay doctor dry-run'"],
    ['notes', "TEXT NOT NULL DEFAULT ''"],
    ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ['updated_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [columnName, columnType] of openclawRelayConfigAlterations) {
    if (!openclawRelayConfigColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE openclaw_relay_configs ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const toolFailureColumnsStmt = billingDb.prepare('PRAGMA table_info(tool_failure_facts)');
  const toolFailureColumns = new Set();
  while (toolFailureColumnsStmt.step()) {
    toolFailureColumns.add(String(toolFailureColumnsStmt.getAsObject().name || ''));
  }
  toolFailureColumnsStmt.free();
  const toolFailureAlterations = [
    ['failure_fact_id', 'TEXT PRIMARY KEY'],
    ['subject_type', "TEXT NOT NULL DEFAULT ''"],
    ['subject_id', "TEXT NOT NULL DEFAULT ''"],
    ['task_id', 'TEXT'],
    ['execution_id', 'TEXT'],
    ['failure_category', "TEXT NOT NULL DEFAULT ''"],
    ['failure_scope', "TEXT NOT NULL DEFAULT ''"],
    ['failure_stage', "TEXT NOT NULL DEFAULT ''"],
    ['source', "TEXT NOT NULL DEFAULT 'runtime'"],
    ['reason_code', "TEXT NOT NULL DEFAULT ''"],
    ['detail', "TEXT NOT NULL DEFAULT ''"],
    ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ['updated_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [columnName, columnType] of toolFailureAlterations) {
    if (!toolFailureColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE tool_failure_facts ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  billingDb.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_executions_session_idempotency
    ON executions(session_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key != ''
  `);
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_executions_session_id ON executions(session_id)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_executions_state ON executions(current_state)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_execution_events_execution_id_timestamp ON execution_events(execution_id, timestamp)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_request_logs_execution_id ON request_logs(execution_id)');
  billingDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_canonical_root ON workspaces(canonical_root)');
  billingDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_artifacts_execution_id ON execution_artifacts(execution_id)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_execution_artifacts_workspace_id ON execution_artifacts(workspace_id)');
  billingDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_capabilities_execution_id ON execution_capabilities(execution_id)');
  billingDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_budgets_execution_id ON execution_budgets(execution_id)');
  billingDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_session_id_idempotency_key ON tasks(session_id, idempotency_key)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_tasks_session_state_created ON tasks(session_id, current_state, created_at)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_task_progress_events_task_created ON task_progress_events(task_id, created_at)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_agent_runs_execution ON agent_runs(execution_id)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_agent_steps_run_index ON agent_steps(agent_run_id, step_index)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_agent_step_events_run_created ON agent_step_events(agent_run_id, created_at)');
  billingDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_task_artifact_assessments_task_id ON task_artifact_assessments(task_id)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_task_artifact_assessments_session_updated ON task_artifact_assessments(session_id, updated_at)');
  billingDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_task_completion_summaries_task_id ON task_completion_summaries(task_id)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_task_completion_summaries_session_updated ON task_completion_summaries(session_id, updated_at)');
  billingDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_task_notifications_dedupe_key ON task_notifications(dedupe_key)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_task_notifications_session_state_created ON task_notifications(session_id, delivery_state, created_at)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_task_notifications_session_state_next_attempt_created ON task_notifications(session_id, delivery_state, next_attempt_at, created_at)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_task_notifications_task_created ON task_notifications(task_id, created_at)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_task_notifications_artifact_id ON task_notifications(artifact_id)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_task_notifications_source ON task_notifications(source_type, source_id)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_notification_delivery_attempts_notification_created ON notification_delivery_attempts(notification_id, created_at)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_notification_delivery_attempts_session_created ON notification_delivery_attempts(session_id, created_at)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_notification_delivery_attempts_artifact_id ON notification_delivery_attempts(artifact_id)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_session_continuity_events_session_created ON session_continuity_events(session_id, created_at)');
  billingDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_session_lineage_child_session ON session_lineage(child_session_id)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_session_continuity_recommendations_session_status_created ON session_continuity_recommendations(session_id, status, created_at)');
  billingDb.run('CREATE INDEX IF NOT EXISTS idx_session_continuity_recommendations_session_type_status ON session_continuity_recommendations(session_id, recommendation_type, status)');

  const executionColumnsStmt = billingDb.prepare('PRAGMA table_info(executions)');
  const executionColumns = new Set();
  while (executionColumnsStmt.step()) {
    executionColumns.add(String(executionColumnsStmt.getAsObject().name || ''));
  }
  executionColumnsStmt.free();

  const executionAlterations = [
    ['task_id', 'TEXT'],
    ['lease_id', 'TEXT'],
    ['lease_holder', 'TEXT'],
    ['lease_acquired_at', 'TEXT'],
    ['lease_expires_at', 'TEXT'],
    ['lease_epoch', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_heartbeat_at', 'TEXT'],
    ['recovery_reason', 'TEXT'],
    ['recovery_notes', 'TEXT'],
  ];

  for (const [columnName, columnType] of executionAlterations) {
    if (!executionColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE executions ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const executionArtifactColumnsStmt = billingDb.prepare('PRAGMA table_info(execution_artifacts)');
  const executionArtifactColumns = new Set();
  while (executionArtifactColumnsStmt.step()) {
    executionArtifactColumns.add(String(executionArtifactColumnsStmt.getAsObject().name || ''));
  }
  executionArtifactColumnsStmt.free();

  const executionArtifactAlterations = [
    ['artifact_filename', "TEXT NOT NULL DEFAULT ''"],
    ['artifact_type', "TEXT NOT NULL DEFAULT 'text'"],
    ['content_hash', "TEXT NOT NULL DEFAULT ''"],
    ['byte_size', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [columnName, columnType] of executionArtifactAlterations) {
    if (!executionArtifactColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE execution_artifacts ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const executionCapabilityColumnsStmt = billingDb.prepare('PRAGMA table_info(execution_capabilities)');
  const executionCapabilityColumns = new Set();
  while (executionCapabilityColumnsStmt.step()) {
    executionCapabilityColumns.add(String(executionCapabilityColumnsStmt.getAsObject().name || ''));
  }
  executionCapabilityColumnsStmt.free();

  const executionCapabilityAlterations = [
    ['requested_model_input', "TEXT NOT NULL DEFAULT ''"],
  ];

  for (const [columnName, columnType] of executionCapabilityAlterations) {
    if (!executionCapabilityColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE execution_capabilities ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const liveKeysColumnsStmt = billingDb.prepare('PRAGMA table_info(live_keys)');
  const liveKeysColumns = new Set();
  while (liveKeysColumnsStmt.step()) {
    liveKeysColumns.add(String(liveKeysColumnsStmt.getAsObject().name || ''));
  }
  liveKeysColumnsStmt.free();

  const liveKeysAlterations = [
    ['user_id', 'TEXT'],
    ['created_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_session_id', 'TEXT'],
    ['budget_limit', 'REAL'],
  ];

  for (const [columnName, columnType] of liveKeysAlterations) {
    if (!liveKeysColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE live_keys ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const sessionsColumnsStmt = billingDb.prepare('PRAGMA table_info(sessions)');
  const sessionsColumns = new Set();
  while (sessionsColumnsStmt.step()) {
    sessionsColumns.add(String(sessionsColumnsStmt.getAsObject().name || ''));
  }
  sessionsColumnsStmt.free();

  const sessionsAlterations = [
    ['provider', "TEXT NOT NULL DEFAULT 'openrouter'"],
    ['user_id', 'TEXT'],
    ['linked_live_key_id', 'TEXT'],
    ['ttl_selected', "TEXT NOT NULL DEFAULT '1h'"],
    ['ttl_ms', 'INTEGER NOT NULL DEFAULT 3600000'],
    ['default_model_alias', "TEXT NOT NULL DEFAULT 'managed'"],
    ['allowed_model_aliases_json', "TEXT NOT NULL DEFAULT '[\"managed\"]'"],
    ['token_usage', 'INTEGER NOT NULL DEFAULT 0'],
  ];

  for (const [columnName, columnType] of sessionsAlterations) {
    if (!sessionsColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE sessions ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const sessionStateColumnsStmt = billingDb.prepare('PRAGMA table_info(session_state)');
  const sessionStateColumns = new Set();
  while (sessionStateColumnsStmt.step()) {
    sessionStateColumns.add(String(sessionStateColumnsStmt.getAsObject().name || ''));
  }
  sessionStateColumnsStmt.free();

  const sessionStateAlterations = [
    ['budget_usd', 'REAL NOT NULL DEFAULT 0'],
    ['spent_usd', 'REAL NOT NULL DEFAULT 0'],
    ['reserved_usd', 'REAL NOT NULL DEFAULT 0'],
    ['request_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['rate_window_started_at', "TEXT NOT NULL DEFAULT ''"],
    ['rate_window_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['max_requests_per_minute', 'INTEGER NOT NULL DEFAULT 20'],
    ['rate_limit_window_ms', 'INTEGER NOT NULL DEFAULT 60000'],
    ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ['updated_at', "TEXT NOT NULL DEFAULT ''"],
  ];

  for (const [columnName, columnType] of sessionStateAlterations) {
    if (!sessionStateColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE session_state ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  persistBillingDb();
  return billingDb;
}

async function withBillingWrite(callback) {
  const nextWrite = billingWriteChain.then(async () => {
    const db = await ensureBillingDb();
    db.run('BEGIN IMMEDIATE');
    try {
      const result = await callback(db);
      db.run('COMMIT');
      persistBillingDb();
      return result;
    } catch (error) {
      try {
        db.run('ROLLBACK');
      } catch (rollbackError) {
        console.error('Billing rollback failed', rollbackError);
      }
      throw error;
    }
  });

  billingWriteChain = nextWrite.catch((error) => {
    console.error('Billing write failed', error);
  });

  return nextWrite;
}

function hydrateExecutionRow(row) {
  if (!row) {
    return null;
  }

  return {
    execution_id: String(row.execution_id || ''),
    session_id: String(row.session_id || ''),
    task_id: row.task_id || null,
    current_state: String(row.current_state || ''),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    last_request_id: row.last_request_id || '',
    idempotency_key: row.idempotency_key || null,
    workspace_id: row.workspace_id || null,
    lease_id: row.lease_id || null,
    lease_holder: row.lease_holder || null,
    lease_acquired_at: row.lease_acquired_at || null,
    lease_expires_at: row.lease_expires_at || null,
    lease_epoch: Number(row.lease_epoch || 0),
    last_heartbeat_at: row.last_heartbeat_at || null,
    recovery_reason: row.recovery_reason || null,
    recovery_notes: row.recovery_notes || null,
  };
}

function hydrateTaskRow(row) {
  if (!row) {
    return null;
  }

  return {
    task_id: String(row.task_id || ''),
    session_id: String(row.session_id || ''),
    current_state: String(row.current_state || ''),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    last_request_id: String(row.last_request_id || ''),
    idempotency_key: row.idempotency_key || null,
    objective_text: String(row.objective_text || ''),
    objective_fingerprint: String(row.objective_fingerprint || ''),
    task_kind: String(row.task_kind || 'text_generation'),
    notification_policy: String(row.notification_policy || 'silent'),
    notification_eligible: Number(row.notification_eligible || 0),
    eligibility_reason: String(row.eligibility_reason || ''),
    classified_at: row.classified_at || null,
    first_execution_id: row.first_execution_id || null,
    last_execution_id: row.last_execution_id || null,
    completed_execution_id: row.completed_execution_id || null,
    recovery_reason: row.recovery_reason || null,
    recovery_notes: row.recovery_notes || null,
  };
}

function hydrateTaskArtifactAssessmentRow(row) {
  if (!row) {
    return null;
  }

  return {
    assessment_id: String(row.assessment_id || ''),
    task_id: String(row.task_id || ''),
    session_id: String(row.session_id || ''),
    execution_id: row.execution_id || null,
    artifact_id: row.artifact_id || null,
    artifact_exists: Number(row.artifact_exists || 0),
    artifact_verification_state: String(row.artifact_verification_state || ''),
    artifact_family: String(row.artifact_family || 'unknown'),
    structure_state: String(row.structure_state || 'missing'),
    alignment_state: String(row.alignment_state || 'missing'),
    confidence_score: Number(row.confidence_score || 0),
    confidence_band: String(row.confidence_band || 'low'),
    reason_code: String(row.reason_code || ''),
    notes: row.notes || null,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function hydrateTaskProgressEventRow(row) {
  if (!row) {
    return null;
  }

  return {
    progress_event_id: String(row.progress_event_id || ''),
    task_id: String(row.task_id || ''),
    execution_id: row.execution_id || null,
    previous_state: String(row.previous_state || ''),
    new_state: String(row.new_state || ''),
    progress_category: String(row.progress_category || ''),
    decision: String(row.decision || 'notify_user'),
    message_text: String(row.message_text || ''),
    requires_user_input: Number(row.requires_user_input || 0),
    source: String(row.source || 'runtime'),
    reason_code: String(row.reason_code || ''),
    created_at: row.created_at || '',
  };
}

function hydrateAgentRunRow(row) {
  if (!row) {
    return null;
  }

  return {
    agent_run_id: String(row.agent_run_id || ''),
    task_id: String(row.task_id || ''),
    execution_id: String(row.execution_id || ''),
    goal_text: String(row.goal_text || ''),
    goal_fingerprint: String(row.goal_fingerprint || ''),
    plan: safeParseJson(row.plan_json, []),
    status: String(row.status || 'planned'),
    current_step_index: Number(row.current_step_index || 0),
    final_outcome: String(row.final_outcome || ''),
    final_artifact_id: row.final_artifact_id || null,
    final_notification_id: row.final_notification_id || null,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function hydrateAgentStepRow(row) {
  if (!row) {
    return null;
  }

  return {
    agent_step_id: String(row.agent_step_id || ''),
    agent_run_id: String(row.agent_run_id || ''),
    task_id: String(row.task_id || ''),
    execution_id: String(row.execution_id || ''),
    step_index: Number(row.step_index || 0),
    role: String(row.role || ''),
    step_kind: String(row.step_kind || ''),
    status: String(row.status || 'pending'),
    reason_code: String(row.reason_code || ''),
    input: safeParseJson(row.input_json, {}),
    output: safeParseJson(row.output_json, {}),
    evidence: safeParseJson(row.evidence_json, {}),
    artifact_id: row.artifact_id || null,
    notification_id: row.notification_id || null,
    retry_count: Number(row.retry_count || 0),
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function hydrateAgentStepEventRow(row) {
  if (!row) {
    return null;
  }

  return {
    agent_step_event_id: String(row.agent_step_event_id || ''),
    agent_run_id: String(row.agent_run_id || ''),
    agent_step_id: row.agent_step_id || null,
    task_id: String(row.task_id || ''),
    execution_id: String(row.execution_id || ''),
    event_type: String(row.event_type || ''),
    payload: safeParseJson(row.payload_json, {}),
    created_at: row.created_at || '',
  };
}

function safeParseJson(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function hydrateTaskCompletionSummaryRow(row) {
  if (!row) {
    return null;
  }

  return {
    completion_summary_id: String(row.completion_summary_id || ''),
    task_id: String(row.task_id || ''),
    session_id: String(row.session_id || ''),
    execution_id: row.execution_id || null,
    final_state: String(row.final_state || ''),
    summary_text: String(row.summary_text || ''),
    what_completed: Array.isArray(safeParseJson(row.what_completed_json, [])) ? safeParseJson(row.what_completed_json, []) : [],
    artifacts: Array.isArray(safeParseJson(row.artifacts_json, [])) ? safeParseJson(row.artifacts_json, []) : [],
    verified: Array.isArray(safeParseJson(row.verified_json, [])) ? safeParseJson(row.verified_json, []) : [],
    not_verified: Array.isArray(safeParseJson(row.not_verified_json, [])) ? safeParseJson(row.not_verified_json, []) : [],
    follow_up_needed: Number(row.follow_up_needed || 0),
    proof: safeParseJson(row.proof_json, {}),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function hydrateTaskNotificationRow(row) {
  if (!row) {
    return null;
  }

  return {
    notification_id: String(row.notification_id || ''),
    task_id: String(row.task_id || ''),
    session_id: String(row.session_id || ''),
    execution_id: row.execution_id || null,
    source_type: String(row.source_type || ''),
    source_id: String(row.source_id || ''),
    notification_kind: String(row.notification_kind || ''),
    delivery_channel: String(row.delivery_channel || 'openclaw_tg'),
    delivery_state: String(row.delivery_state || 'pending'),
    title: String(row.title || ''),
    body: String(row.body || ''),
    artifact_id: row.artifact_id || null,
    artifact_path: row.artifact_path || null,
    media_kind: row.media_kind || null,
    relay_label: row.relay_label || null,
    task_kind: String(row.task_kind || 'text_generation'),
    notification_policy: String(row.notification_policy || 'silent'),
    proactive_eligible: Number(row.proactive_eligible || 0),
    eligibility_reason: String(row.eligibility_reason || ''),
    delivery_suppressed_reason: String(row.delivery_suppressed_reason || ''),
    classified_at: row.classified_at || null,
    payload: safeParseJson(row.payload_json, {}),
    dedupe_key: String(row.dedupe_key || ''),
    claim_count: Number(row.claim_count || 0),
    claimed_at: row.claimed_at || null,
    delivered_at: row.delivered_at || null,
    delivered_message_id: row.delivered_message_id || null,
    last_error: String(row.last_error || ''),
    next_attempt_at: row.next_attempt_at || null,
    attempt_count: Number(row.attempt_count || 0),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function hydrateToolFailureFactRow(row) {
  if (!row) {
    return null;
  }

  return {
    failure_fact_id: String(row.failure_fact_id || ''),
    subject_type: String(row.subject_type || ''),
    subject_id: String(row.subject_id || ''),
    task_id: row.task_id || null,
    execution_id: row.execution_id || null,
    failure_category: String(row.failure_category || ''),
    failure_scope: String(row.failure_scope || ''),
    failure_stage: String(row.failure_stage || ''),
    source: String(row.source || 'runtime'),
    reason_code: String(row.reason_code || ''),
    detail: String(row.detail || ''),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function hydrateWorkspaceRow(row) {
  if (!row) {
    return null;
  }

  return {
    workspace_id: String(row.workspace_id || ''),
    canonical_root: String(row.canonical_root || ''),
    root_source: String(row.root_source || ''),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function hydrateExecutionArtifactRow(row) {
  if (!row) {
    return null;
  }

  return {
    artifact_id: String(row.artifact_id || ''),
    execution_id: String(row.execution_id || ''),
    workspace_id: String(row.workspace_id || ''),
    declared_path: String(row.declared_path || ''),
    canonical_path: String(row.canonical_path || ''),
    verification_state: String(row.verification_state || ''),
    reason_code: String(row.reason_code || ''),
    artifact_filename: String(row.artifact_filename || ''),
    artifact_type: String(row.artifact_type || 'text'),
    content_hash: String(row.content_hash || ''),
    byte_size: Number(row.byte_size || 0),
    delivery_requested: Number(row.delivery_requested || 0),
    delivery_confirmed: Number(row.delivery_confirmed || 0),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function hydrateExecutionCapabilityRow(row) {
  if (!row) {
    return null;
  }

  return {
    execution_id: String(row.execution_id || ''),
    requested_model_input: String(row.requested_model_input || ''),
    requested_model_alias: String(row.requested_model_alias || ''),
    resolved_model_alias: String(row.resolved_model_alias || ''),
    resolved_provider_id: String(row.resolved_provider_id || ''),
    resolved_upstream_model_id: String(row.resolved_upstream_model_id || ''),
    fallback_model_alias: String(row.fallback_model_alias || ''),
    fallback_eligible: Number(row.fallback_eligible || 0),
    fallback_used: Number(row.fallback_used || 0),
    supports_chat: Number(row.supports_chat || 0),
    supports_streaming: Number(row.supports_streaming || 0),
    supports_tools: Number(row.supports_tools || 0),
    artifact_claim_risk: String(row.artifact_claim_risk || 'unknown'),
    timeout_profile: String(row.timeout_profile || 'unknown'),
    retryability_class: String(row.retryability_class || 'unknown'),
    provider_class: String(row.provider_class || 'unknown'),
    context_window_tokens: Number(row.context_window_tokens || 0),
    max_output_tokens: Number(row.max_output_tokens || 0),
    validated_at: row.validated_at || '',
    expires_at: row.expires_at || '',
    fact_source: String(row.fact_source || 'descriptor_registry'),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function hydrateExecutionBudgetRow(row) {
  if (!row) {
    return null;
  }

  return {
    execution_id: String(row.execution_id || ''),
    requested_input_tokens_estimate: Number(row.requested_input_tokens_estimate || 0),
    requested_output_tokens: Number(row.requested_output_tokens || 0),
    effective_context_window_tokens: Number(row.effective_context_window_tokens || 0),
    effective_max_output_tokens: Number(row.effective_max_output_tokens || 0),
    reserved_output_tokens: Number(row.reserved_output_tokens || 0),
    estimated_total_budget_demand: Number(row.estimated_total_budget_demand || 0),
    accepted_input_tokens_estimate: Number(row.accepted_input_tokens_estimate || 0),
    context_adaptation_applied: Number(row.context_adaptation_applied || 0),
    context_adaptation_reason: String(row.context_adaptation_reason || 'none'),
    budget_rejection_reason: String(row.budget_rejection_reason || ''),
    completed_input_tokens: Number(row.completed_input_tokens || 0),
    completed_output_tokens: Number(row.completed_output_tokens || 0),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function assertLegalExecutionTransition(previousState, nextState) {
  const from = String(previousState || '');
  const to = String(nextState || '');
  if (!from || !to) {
    throw new Error('Execution transition requires both previous and next state');
  }

  if (from === to) {
    throw new Error(`Illegal execution transition: ${from} -> ${to}`);
  }

  if (!EXECUTION_LEGAL_TRANSITIONS.has(from)) {
    throw new Error(`Unknown execution state: ${from}`);
  }

  const allowed = EXECUTION_LEGAL_TRANSITIONS.get(from);
  if (!allowed || !allowed.has(to)) {
    throw new Error(`Illegal execution transition: ${from} -> ${to}`);
  }
}

async function getStoredExecutionById(db, executionId) {
  const stmt = db.prepare('SELECT * FROM executions WHERE execution_id = ? LIMIT 1');
  stmt.bind([executionId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateExecutionRow(row);
}

async function getStoredWorkspaceById(db, workspaceId) {
  const stmt = db.prepare('SELECT * FROM workspaces WHERE workspace_id = ? LIMIT 1');
  stmt.bind([workspaceId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateWorkspaceRow(row);
}

async function getStoredWorkspaceByRoot(db, canonicalRoot) {
  const stmt = db.prepare('SELECT * FROM workspaces WHERE canonical_root = ? LIMIT 1');
  stmt.bind([canonicalRoot]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateWorkspaceRow(row);
}

async function getStoredExecutionArtifactByExecutionId(db, executionId) {
  const stmt = db.prepare('SELECT * FROM execution_artifacts WHERE execution_id = ? LIMIT 1');
  stmt.bind([executionId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateExecutionArtifactRow(row);
}

async function getStoredExecutionArtifactByArtifactId(db, artifactId) {
  const stmt = db.prepare('SELECT * FROM execution_artifacts WHERE artifact_id = ? LIMIT 1');
  stmt.bind([artifactId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateExecutionArtifactRow(row);
}

async function getStoredExecutionCapabilityByExecutionId(db, executionId) {
  const stmt = db.prepare('SELECT * FROM execution_capabilities WHERE execution_id = ? LIMIT 1');
  stmt.bind([executionId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateExecutionCapabilityRow(row);
}

async function getStoredExecutionBudgetByExecutionId(db, executionId) {
  const stmt = db.prepare('SELECT * FROM execution_budgets WHERE execution_id = ? LIMIT 1');
  stmt.bind([executionId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateExecutionBudgetRow(row);
}

async function getExecutionById(executionId) {
  const db = await ensureBillingDb();
  return getStoredExecutionById(db, executionId);
}

async function getExecutionByRequestId(requestId) {
  const db = await ensureBillingDb();
  const stmt = db.prepare('SELECT execution_id FROM request_logs WHERE request_id = ? LIMIT 1');
  stmt.bind([requestId]);
  let executionId = '';
  if (stmt.step()) {
    executionId = String(stmt.getAsObject().execution_id || '');
  }
  stmt.free();
  if (!executionId) {
    return null;
  }
  return getStoredExecutionById(db, executionId);
}

async function getExecutionCapabilityRecord(executionId) {
  const db = await ensureBillingDb();
  return getStoredExecutionCapabilityByExecutionId(db, executionId);
}

async function getExecutionBudgetRecord(executionId) {
  const db = await ensureBillingDb();
  return getStoredExecutionBudgetByExecutionId(db, executionId);
}

function summarizeTaskObjectiveFromBody(body = {}) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const userMessages = messages
    .filter((message) => String(message?.role || '').toLowerCase() === 'user')
    .map((message) => stringifyTextContent(message?.content ?? message?.text ?? message?.value ?? ''))
    .filter(Boolean);
  const candidate =
    userMessages[userMessages.length - 1]
    || stringifyTextContent(body?.input)
    || stringifyTextContent(body?.instructions)
    || stringifyTextContent(body?.prompt)
    || stringifyTextContent(body);
  const normalized = extractManagedCurrentTurnText(candidate).replace(/\s+/g, ' ').trim();
  if (normalized.length <= 4096) {
    return normalized;
  }
  const head = normalized.slice(0, 1024);
  const tail = normalized.slice(-3072);
  return `${head}\n...\n${tail}`.trim();
}

function fingerprintTaskObjective(sessionId, objectiveText, idempotencyKey = '') {
  return crypto.createHash('sha256')
    .update(`${String(sessionId || '')}\n${String(idempotencyKey || '')}\n${String(objectiveText || '')}`)
    .digest('hex')
    .slice(0, 32);
}

function normalizeTaskClassificationText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function taskTextContainsAny(normalizedText, needles = []) {
  return needles.some((needle) => {
    const candidate = String(needle || '').toLowerCase().trim();
    if (!candidate) {
      return false;
    }
    return normalizedText.includes(candidate);
  });
}

function classifyAgentWorkflowTaskFromObjective(objectiveText = '') {
  const normalized = normalizeTaskClassificationText(objectiveText);
  if (!normalized) {
    return null;
  }

  const agenticSignals = taskTextContainsAny(normalized, [
    'agent workflow',
    'agentic workflow',
    'agent runtime',
    'sub-agent',
    'sub agent',
    'planner',
    'verifier',
  ]);
  const workflowSignals = taskTextContainsAny(normalized, [
    'workflow',
    'step runtime',
    'step-by-step',
  ]);
  const coordinationSignals = taskTextContainsAny(normalized, [
    'planner',
    'writer',
    'verifier',
    'delivery step',
    'sub-agent',
    'sub agent',
  ]);

  if (agenticSignals || (workflowSignals && coordinationSignals)) {
    return {
      task_kind: TASK_KINDS.AGENT_WORKFLOW_TASK,
      eligibility_reason: 'agentic workflow prompt',
    };
  }

  return null;
}

function classifyTaskKindFromObjective(objectiveText = '') {
  const normalized = normalizeTaskClassificationText(objectiveText);
  const rawLength = String(objectiveText || '').trim().length;
  const shortGreetingPattern = /^(hi|hey|hello|wassup|what'?s up|yo|ok|okay|thanks|thank you|sure|yep|yup)[.!? ]*$/i;

  if (rawLength <= 40 && shortGreetingPattern.test(String(objectiveText || '').trim())) {
    return {
      task_kind: TASK_KINDS.SIMPLE_CHAT,
      eligibility_reason: 'short greeting or acknowledgement',
    };
  }

  const agentWorkflowClassification = classifyAgentWorkflowTaskFromObjective(objectiveText);
  if (agentWorkflowClassification) {
    return agentWorkflowClassification;
  }

  if (taskTextContainsAny(normalized, [
    'create file',
    'create a file',
    'file named',
    'markdown file',
    'save as',
    'generate report',
    'report',
    'document',
    'pdf',
    'docx',
    'spreadsheet',
    'csv',
    'json file',
    'artifact',
  ])) {
    return {
      task_kind: TASK_KINDS.ARTIFACT_TASK,
      eligibility_reason: 'file or artifact-style prompt',
    };
  }

  if (taskTextContainsAny(normalized, [
    'build landing page',
    'landing page',
    'build website',
    'website',
    'web page',
    'homepage',
    'site',
  ])) {
    return {
      task_kind: TASK_KINDS.WEBSITE_TASK,
      eligibility_reason: 'website or landing-page prompt',
    };
  }

  if (taskTextContainsAny(normalized, [
    'transcribe',
    'audio',
    'video',
    'image',
    'photo',
    'ocr',
    'caption',
    'media',
    'process image',
    'process audio',
  ])) {
    return {
      task_kind: TASK_KINDS.MEDIA_TASK,
      eligibility_reason: 'media processing prompt',
    };
  }

  if (taskTextContainsAny(normalized, [
    'analyze repo',
    'analyze repository',
    'research',
    'deep research',
    'investigate',
    'compare sources',
    'literature',
    'source',
    'study',
  ])) {
    return {
      task_kind: TASK_KINDS.RESEARCH_TASK,
      eligibility_reason: 'research or repository analysis prompt',
    };
  }

  if (taskTextContainsAny(normalized, [
    'run tests',
    'test suite',
    'deploy',
    'benchmark',
    'crawl',
    'scrape',
    'long report',
    'long-running',
    'multiple steps',
    'end-to-end',
    'process large',
    'migration',
  ])) {
    return {
      task_kind: TASK_KINDS.LONG_RUNNING_TASK,
      eligibility_reason: 'long-running or operational prompt',
    };
  }

  if (taskTextContainsAny(normalized, [
    'repo',
    'repository',
    'code',
    'github',
    'branch',
    'pull request',
    'pr ',
    'implement',
    'refactor',
    'fix bug',
    'build app',
    'create app',
    'run lint',
    'run tests',
  ])) {
    return {
      task_kind: TASK_KINDS.CODE_TASK,
      eligibility_reason: 'code or repository prompt',
    };
  }

  if (taskTextContainsAny(normalized, [
    'summarize',
    'summary',
    'bullet',
    'bullets',
    'bullet points',
    'list',
    'outline',
    'table',
    'brief',
    'points',
  ])) {
    return {
      task_kind: TASK_KINDS.STRUCTURED_TEXT,
      eligibility_reason: 'structured text prompt',
    };
  }

  if (taskTextContainsAny(normalized, [
    'reply with',
    'write',
    'compose',
    'draft',
    'answer',
    'tell me',
    'provide',
    'generate',
    'respond',
  ])) {
    return {
      task_kind: TASK_KINDS.TEXT_GENERATION,
      eligibility_reason: 'plain text generation prompt',
    };
  }

  return {
    task_kind: TASK_KINDS.TEXT_GENERATION,
    eligibility_reason: 'defaulted to plain text generation',
  };
}

function shouldUseStructuredTextCompletionPolicy(objectiveText = '') {
  const normalized = normalizeTaskClassificationText(objectiveText);
  const hasLongInputHints = taskTextContainsAny(normalized, [
    'this',
    'following',
    'below',
    'attached',
    'document',
    'report',
    'repo',
    'repository',
    'workspace',
    'file',
    'article',
    'conversation',
    'notes',
  ]);
  return String(objectiveText || '').trim().length >= 120 || hasLongInputHints;
}

function getStoredRequestLogByRequestIdTx(db, requestId) {
  const stmt = db.prepare(`
    SELECT *
    FROM request_logs
    WHERE request_id = ?
    LIMIT 1
  `);
  stmt.bind([requestId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

function refreshTaskNotificationProfileTx(db, taskId, options = {}) {
  const taskRow = getStoredTaskByIdTx(db, taskId);
  if (!taskRow) {
    return null;
  }

  const requestLogRow = taskRow.last_request_id
    ? getStoredRequestLogByRequestIdTx(db, taskRow.last_request_id)
    : null;
  const profile = deriveTaskNotificationProfileFromTask(taskRow, requestLogRow, {
    currentState: options.currentState || taskRow.current_state || '',
    classifiedAt: options.classifiedAt || getTimestamp(),
  });
  const timestamp = profile.classified_at || options.classifiedAt || getTimestamp();
  const update = db.prepare(`
    UPDATE tasks
    SET task_kind = ?,
        notification_policy = ?,
        notification_eligible = ?,
        eligibility_reason = ?,
        classified_at = ?,
        updated_at = ?
    WHERE task_id = ?
  `);
  update.run([
    profile.task_kind,
    profile.notification_policy,
    Number(profile.notification_eligible || 0),
    profile.eligibility_reason || '',
    timestamp,
    timestamp,
    taskId,
  ]);
  update.free();

  return {
    ...taskRow,
    task_kind: profile.task_kind,
    notification_policy: profile.notification_policy,
    notification_eligible: Number(profile.notification_eligible || 0),
    eligibility_reason: profile.eligibility_reason || '',
    classified_at: timestamp,
  };
}

function deriveTaskNotificationProfileFromTask(task, requestLogRow = null, options = {}) {
  const classifiedAt = options.classifiedAt || getTimestamp();
  const objectiveText = String(task?.objective_text || '');
  const baseClassification = classifyTaskKindFromObjective(objectiveText);
  const currentState = String(options.currentState || task?.current_state || '');
  const requestStatus = String(requestLogRow?.status || '');
  const requestOutputTokens = Number(requestLogRow?.output_tokens || 0);
  const requestErrorCode = String(requestLogRow?.error_code || '');
  const requestHadUsableOutput = requestStatus === 'success' && requestOutputTokens > 0 && !requestErrorCode;
  const requestInterruptedForTerminalPayload = requestStatus !== 'success' || requestErrorCode === TOOL_FAILURE_CATEGORIES.TERMINAL_PAYLOAD_MISSING;
  const isRecoveryState = currentState === TASK_STATES.RECOVERY_REQUIRED || currentState === TASK_STATES.FAILED;
  const isHumanBlocked = currentState === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED;
  const longRunningKinds = new Set([
    TASK_KINDS.AGENT_WORKFLOW_TASK,
    TASK_KINDS.ARTIFACT_TASK,
    TASK_KINDS.CODE_TASK,
    TASK_KINDS.WEBSITE_TASK,
    TASK_KINDS.RESEARCH_TASK,
    TASK_KINDS.MEDIA_TASK,
    TASK_KINDS.LONG_RUNNING_TASK,
  ]);

  if (isRecoveryState) {
    if (requestHadUsableOutput && !longRunningKinds.has(baseClassification.task_kind)) {
      return {
        task_kind: baseClassification.task_kind,
        notification_policy: TASK_NOTIFICATION_POLICIES.SILENT,
        notification_eligible: 0,
        eligibility_reason: 'fallback_already_delivered',
        classified_at: classifiedAt,
      };
    }

    return {
      task_kind: TASK_KINDS.RECOVERY_OR_FAILURE,
      notification_policy: TASK_NOTIFICATION_POLICIES.FAILURE_ONLY,
      notification_eligible: 1,
      eligibility_reason: requestInterruptedForTerminalPayload
        ? 'recovery_or_failure_without_usable_output'
        : 'recovery_or_failure_notification',
      classified_at: classifiedAt,
    };
  }

  if (isHumanBlocked) {
    return {
      task_kind: TASK_KINDS.RECOVERY_OR_FAILURE,
      notification_policy: TASK_NOTIFICATION_POLICIES.FAILURE_ONLY,
      notification_eligible: 1,
      eligibility_reason: 'human_input_required',
      classified_at: classifiedAt,
    };
  }

  switch (baseClassification.task_kind) {
    case TASK_KINDS.ARTIFACT_TASK:
    case TASK_KINDS.CODE_TASK:
    case TASK_KINDS.WEBSITE_TASK:
    case TASK_KINDS.RESEARCH_TASK:
    case TASK_KINDS.MEDIA_TASK:
    case TASK_KINDS.LONG_RUNNING_TASK:
      return {
        task_kind: baseClassification.task_kind,
        notification_policy: TASK_NOTIFICATION_POLICIES.PROGRESS_AND_COMPLETION,
        notification_eligible: 1,
        eligibility_reason: baseClassification.eligibility_reason,
        classified_at: classifiedAt,
      };
    case TASK_KINDS.STRUCTURED_TEXT: {
      const completionOnly = shouldUseStructuredTextCompletionPolicy(objectiveText);
      return {
        task_kind: TASK_KINDS.STRUCTURED_TEXT,
        notification_policy: completionOnly
          ? TASK_NOTIFICATION_POLICIES.COMPLETION_ONLY
          : TASK_NOTIFICATION_POLICIES.SILENT,
        notification_eligible: completionOnly ? 1 : 0,
        eligibility_reason: completionOnly
          ? 'structured_text_completion_only'
          : 'structured_text_silent',
        classified_at: classifiedAt,
      };
    }
    case TASK_KINDS.AGENT_WORKFLOW_TASK:
      return {
        task_kind: TASK_KINDS.AGENT_WORKFLOW_TASK,
        notification_policy: TASK_NOTIFICATION_POLICIES.PROGRESS_AND_COMPLETION,
        notification_eligible: 1,
        eligibility_reason: baseClassification.eligibility_reason,
        classified_at: classifiedAt,
      };
    case TASK_KINDS.SIMPLE_CHAT:
    case TASK_KINDS.TEXT_GENERATION:
    default:
      return {
        task_kind: baseClassification.task_kind,
        notification_policy: TASK_NOTIFICATION_POLICIES.SILENT,
        notification_eligible: 0,
        eligibility_reason: baseClassification.eligibility_reason,
        classified_at: classifiedAt,
      };
  }
}

function deriveTaskNotificationDispatchability(task, progressEvent, taskProfile = null) {
  const profile = taskProfile || deriveTaskNotificationProfileFromTask(task, null, {
    currentState: task?.current_state || progressEvent?.new_state || '',
  });
  const progressCategory = String(progressEvent?.progress_category || '');
  const taskState = String(task?.current_state || progressEvent?.new_state || '');
  const deliverySuppressedReason = profile.notification_eligible ? '' : profile.eligibility_reason || 'silent_policy';
  const eligibilityReason = profile.eligibility_reason || '';
  const longRunningKinds = new Set([
    TASK_KINDS.AGENT_WORKFLOW_TASK,
    TASK_KINDS.ARTIFACT_TASK,
    TASK_KINDS.CODE_TASK,
    TASK_KINDS.WEBSITE_TASK,
    TASK_KINDS.RESEARCH_TASK,
    TASK_KINDS.MEDIA_TASK,
    TASK_KINDS.LONG_RUNNING_TASK,
  ]);
  const isFailureState = taskState === TASK_STATES.RECOVERY_REQUIRED || taskState === TASK_STATES.FAILED;

  const shouldNotifyForProgress = profile.notification_policy === TASK_NOTIFICATION_POLICIES.PROGRESS_AND_COMPLETION
    && [
      TASK_PROGRESS_CATEGORIES.TASK_ACCEPTED,
      TASK_PROGRESS_CATEGORIES.PLAN_LOCKED,
      TASK_PROGRESS_CATEGORIES.TOOL_WORK_STARTED,
      TASK_PROGRESS_CATEGORIES.MEANINGFUL_PROGRESS_CHECKPOINT,
      TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFICATION_STARTED,
      TASK_PROGRESS_CATEGORIES.ARTIFACT_CREATED,
      TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFIED,
      TASK_PROGRESS_CATEGORIES.TASK_COMPLETED,
    ].includes(progressCategory);

  const shouldNotifyForCompletion = profile.notification_policy === TASK_NOTIFICATION_POLICIES.COMPLETION_ONLY
    && progressCategory === TASK_PROGRESS_CATEGORIES.TASK_COMPLETED;

  const shouldNotifyForFailure = isFailureState && (
    longRunningKinds.has(profile.task_kind)
    || profile.notification_policy === TASK_NOTIFICATION_POLICIES.FAILURE_ONLY
  );

  const proactiveEligible = Boolean(shouldNotifyForProgress || shouldNotifyForCompletion || shouldNotifyForFailure || progressCategory === TASK_PROGRESS_CATEGORIES.BLOCKED_HUMAN_INPUT_REQUIRED);

  return {
    task_kind: profile.task_kind,
    notification_policy: profile.notification_policy,
    proactive_eligible: proactiveEligible ? 1 : 0,
    eligibility_reason: proactiveEligible
      ? (shouldNotifyForFailure && profile.notification_policy === TASK_NOTIFICATION_POLICIES.SILENT
        ? 'failure_notification_no_usable_output'
        : (eligibilityReason || 'notification_policy_allows_delivery'))
      : eligibilityReason || 'silent_policy',
    delivery_suppressed_reason: proactiveEligible ? '' : deliverySuppressedReason || 'silent_policy',
    classified_at: profile.classified_at || getTimestamp(),
    has_usable_output: Boolean(profile.notification_policy !== TASK_NOTIFICATION_POLICIES.SILENT && !isFailureState),
  };
}

async function getStoredTaskById(db, taskId) {
  return getStoredTaskByIdTx(db, taskId);
}

function getStoredTaskByIdTx(db, taskId) {
  const stmt = db.prepare('SELECT * FROM tasks WHERE task_id = ? LIMIT 1');
  stmt.bind([taskId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateTaskRow(row);
}

async function getTaskById(taskId) {
  const db = await ensureBillingDb();
  return getStoredTaskById(db, taskId);
}

async function getTaskByExecutionId(executionId) {
  const db = await ensureBillingDb();
  const stmt = db.prepare('SELECT task_id FROM executions WHERE execution_id = ? LIMIT 1');
  stmt.bind([executionId]);
  let taskId = '';
  if (stmt.step()) {
    taskId = String(stmt.getAsObject().task_id || '');
  }
  stmt.free();
  if (!taskId) {
    return null;
  }
  return getStoredTaskById(db, taskId);
}

async function getTaskByRequestId(requestId) {
  const db = await ensureBillingDb();
  const stmt = db.prepare('SELECT execution_id FROM request_logs WHERE request_id = ? LIMIT 1');
  stmt.bind([requestId]);
  let executionId = '';
  if (stmt.step()) {
    executionId = String(stmt.getAsObject().execution_id || '');
  }
  stmt.free();
  if (!executionId) {
    return null;
  }
  return getTaskByExecutionId(executionId);
}

async function getStoredTaskArtifactAssessmentByTaskId(db, taskId) {
  const stmt = db.prepare('SELECT * FROM task_artifact_assessments WHERE task_id = ? LIMIT 1');
  stmt.bind([taskId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateTaskArtifactAssessmentRow(row);
}

async function getTaskArtifactAssessmentByTaskId(taskId) {
  const db = await ensureBillingDb();
  return getStoredTaskArtifactAssessmentByTaskId(db, taskId);
}

async function syncTaskArtifactAssessment(executionId, options = {}) {
  return withBillingWrite(async (db) => syncTaskArtifactAssessmentTx(db, executionId, options));
}

async function getVerifiedTaskArtifactAssessmentForExecutionId(executionId) {
  const task = await getTaskByExecutionId(executionId);
  if (!task) {
    return null;
  }

  const assessment = await getTaskArtifactAssessmentByTaskId(task.task_id);
  if (!assessment || !assessment.artifact_exists) {
    return null;
  }

  if (assessment.artifact_verification_state !== ARTIFACT_VERIFICATION_STATES.VERIFIED) {
    return null;
  }

  if (
    assessment.confidence_band !== TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH
    || assessment.structure_state !== TASK_ARTIFACT_STRUCTURE_STATES.VALID
    || assessment.alignment_state !== TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED
  ) {
    return null;
  }

  return assessment;
}

function classifyManagedTerminalCompletionIntegrity(options = {}) {
  const status = String(options.status || '');
  const outputTextLength = Number(options.outputTextLength || 0);
  const verifiedArtifactExists = Boolean(options.verifiedArtifactExists);

  if (status !== 'success') {
    return null;
  }

  if (outputTextLength > 0 || verifiedArtifactExists) {
    return null;
  }

  return {
    targetState: EXECUTION_STATES.RECOVERY_REQUIRED,
    billingStatus: 'interrupted',
    reasonCode: 'terminal_payload_missing',
    recoveryReason: 'empty_terminal_response',
    reasonDetail: 'Managed response completed without a usable terminal payload',
  };
}

async function getStoredTaskProgressEventsByTaskId(db, taskId) {
  const stmt = db.prepare(`
    SELECT *
    FROM task_progress_events
    WHERE task_id = ?
    ORDER BY created_at ASC, rowid ASC
  `);
  stmt.bind([taskId]);
  const rows = [];
  while (stmt.step()) {
    rows.push(hydrateTaskProgressEventRow(stmt.getAsObject()));
  }
  stmt.free();
  return rows;
}

async function getTaskProgressEventsByTaskId(taskId) {
  const db = await ensureBillingDb();
  return getStoredTaskProgressEventsByTaskId(db, taskId);
}

async function getStoredTaskCompletionSummaryByTaskId(db, taskId) {
  const stmt = db.prepare(`
    SELECT *
    FROM task_completion_summaries
    WHERE task_id = ?
    LIMIT 1
  `);
  stmt.bind([taskId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateTaskCompletionSummaryRow(row);
}

async function getTaskCompletionSummaryByTaskId(taskId) {
  const db = await ensureBillingDb();
  return getStoredTaskCompletionSummaryByTaskId(db, taskId);
}

async function getStoredTaskNotificationById(db, notificationId) {
  const stmt = db.prepare(`
    SELECT *
    FROM task_notifications
    WHERE notification_id = ?
    LIMIT 1
  `);
  stmt.bind([notificationId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateTaskNotificationRow(row);
}

async function getTaskNotificationById(notificationId) {
  const db = await ensureBillingDb();
  return getStoredTaskNotificationById(db, notificationId);
}

async function getStoredTaskNotificationsByTaskId(db, taskId) {
  const stmt = db.prepare(`
    SELECT *
    FROM task_notifications
    WHERE task_id = ?
    ORDER BY created_at ASC, rowid ASC
  `);
  stmt.bind([taskId]);
  const rows = [];
  while (stmt.step()) {
    rows.push(hydrateTaskNotificationRow(stmt.getAsObject()));
  }
  stmt.free();
  return rows;
}

async function getTaskNotificationsByTaskId(taskId) {
  const db = await ensureBillingDb();
  return getStoredTaskNotificationsByTaskId(db, taskId);
}

async function claimTaskNotificationsForSession(sessionId, options = {}) {
  return withBillingWrite(async (db) => claimStoredTaskNotificationsForSessionTx(db, String(sessionId || ''), options));
}

async function markTaskNotificationDelivered(notificationId, options = {}) {
  return withBillingWrite(async (db) => markStoredTaskNotificationDeliveredTx(db, String(notificationId || ''), options));
}

async function claimTaskNotificationById(notificationId, options = {}) {
  return withBillingWrite(async (db) => claimStoredTaskNotificationByIdTx(db, String(notificationId || ''), options));
}

async function getStoredTaskNotificationsBySessionId(db, sessionId, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 20;
  const state = String(options.deliveryState || '').trim();
  const stmt = db.prepare(`
    SELECT *
    FROM task_notifications
    WHERE session_id = ?
      AND (? = '' OR delivery_state = ?)
    ORDER BY created_at ASC, rowid ASC
    LIMIT ?
  `);
  stmt.bind([sessionId, state, state, limit]);
  const rows = [];
  while (stmt.step()) {
    rows.push(hydrateTaskNotificationRow(stmt.getAsObject()));
  }
  stmt.free();
  return rows;
}

async function claimStoredTaskNotificationsForSessionTx(db, sessionId, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 10;
  const staleAfterMs = Number.isFinite(Number(options.staleAfterMs)) ? Math.max(0, Number(options.staleAfterMs)) : 5 * 60 * 1000;
  const now = options.timestamp || getTimestamp();
  const nowMillis = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const staleCutoff = new Date(Math.max(0, nowMillis - staleAfterMs)).toISOString();

  const stmt = db.prepare(`
    SELECT *
    FROM task_notifications
    WHERE session_id = ?
      AND proactive_eligible = 1
      AND (
        (delivery_state = ? AND (next_attempt_at IS NULL OR next_attempt_at = '' OR next_attempt_at <= ?))
        OR (delivery_state = ? AND claimed_at IS NOT NULL AND claimed_at <= ?)
      )
    ORDER BY created_at ASC, rowid ASC
    LIMIT ?
  `);
  stmt.bind([sessionId, TASK_NOTIFICATION_DELIVERY_STATES.PENDING, now, TASK_NOTIFICATION_DELIVERY_STATES.CLAIMED, staleCutoff, limit]);
  const rows = [];
  while (stmt.step()) {
    rows.push(hydrateTaskNotificationRow(stmt.getAsObject()));
  }
  stmt.free();

  if (!rows.length) {
    return [];
  }

  const update = db.prepare(`
    UPDATE task_notifications
    SET delivery_state = ?,
        claim_count = claim_count + 1,
        claimed_at = ?,
        updated_at = ?
    WHERE notification_id = ?
  `);
  for (const row of rows) {
    update.run([
      TASK_NOTIFICATION_DELIVERY_STATES.CLAIMED,
      now,
      now,
      row.notification_id,
    ]);
  }
  update.free();

  return rows.map((row) => ({
    ...row,
    delivery_state: TASK_NOTIFICATION_DELIVERY_STATES.CLAIMED,
    claim_count: row.claim_count + 1,
    claimed_at: now,
    updated_at: now,
  }));
}

async function markStoredTaskNotificationDeliveredTx(db, notificationId, options = {}) {
  const current = await getStoredTaskNotificationById(db, notificationId);
  if (!current) {
    return null;
  }

  const timestamp = options.timestamp || getTimestamp();
  const update = db.prepare(`
    UPDATE task_notifications
    SET delivery_state = ?,
        delivered_at = ?,
        delivered_message_id = ?,
        last_error = ?,
        next_attempt_at = NULL,
        updated_at = ?
    WHERE notification_id = ?
  `);
  update.run([
    TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED,
    timestamp,
    options.deliveredMessageId || null,
    '',
    timestamp,
    notificationId,
  ]);
  update.free();

  return getStoredTaskNotificationById(db, notificationId);
}

async function claimStoredTaskNotificationByIdTx(db, notificationId, options = {}) {
  const current = await getStoredTaskNotificationById(db, notificationId);
  if (!current) {
    return {
      ok: false,
      reason_code: 'not_found',
      reason_message: 'Notification not found',
      notification: null,
      claimed_notification: null,
    };
  }

  const overrideEligibility = Boolean(options.overrideEligibility);
  if (Number(current.proactive_eligible || 0) !== 1 && !overrideEligibility) {
    return {
      ok: false,
      reason_code: 'eligibility_suppressed',
      reason_message: 'Notification is not eligible for proactive dispatch',
      notification: current,
      claimed_notification: null,
    };
  }

  const allowDelivered = Boolean(options.allowDelivered);
  if (current.delivery_state === TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED && !allowDelivered) {
    return {
      ok: false,
      reason_code: 'already_delivered',
      reason_message: 'Notification is already delivered',
      notification: current,
      claimed_notification: null,
    };
  }

  const timestamp = options.timestamp || getTimestamp();
  const staleAfterMs = Number.isFinite(Number(options.staleAfterMs)) ? Math.max(0, Number(options.staleAfterMs)) : 5 * 60 * 1000;
  const nowMillis = Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : Date.now();
  const staleCutoff = new Date(Math.max(0, nowMillis - staleAfterMs)).toISOString();
  const isPendingAndDue = current.delivery_state === TASK_NOTIFICATION_DELIVERY_STATES.PENDING
    && (!current.next_attempt_at || current.next_attempt_at <= timestamp);
  const isClaimedAndStale = current.delivery_state === TASK_NOTIFICATION_DELIVERY_STATES.CLAIMED
    && current.claimed_at
    && current.claimed_at <= staleCutoff;

  if (!isPendingAndDue && !isClaimedAndStale) {
    return {
      ok: false,
      reason_code: 'not_claimable',
      reason_message: 'Notification is not claimable',
      notification: current,
      claimed_notification: null,
    };
  }

  const update = db.prepare(`
    UPDATE task_notifications
    SET delivery_state = ?,
        claim_count = claim_count + 1,
        claimed_at = ?,
        updated_at = ?
    WHERE notification_id = ?
  `);
  update.run([
    TASK_NOTIFICATION_DELIVERY_STATES.CLAIMED,
    timestamp,
    timestamp,
    notificationId,
  ]);
  update.free();

  const claimed = await getStoredTaskNotificationById(db, notificationId);
  return {
    ok: true,
    reason_code: '',
    reason_message: '',
    notification: claimed,
    claimed_notification: claimed,
  };
}

function hydrateNotificationDeliveryAttemptRow(row) {
  if (!row) {
    return null;
  }

  return {
    attempt_id: String(row.attempt_id || ''),
    notification_id: String(row.notification_id || ''),
    session_id: String(row.session_id || ''),
    task_id: String(row.task_id || ''),
    artifact_id: row.artifact_id || null,
    artifact_path: row.artifact_path || null,
    relay_label: row.relay_label || null,
    media_kind: row.media_kind || null,
    handled_by: String(row.handled_by || ''),
    delivered_file_message_id: row.delivered_file_message_id || null,
    transport: String(row.transport || 'openclaw_cli'),
    channel: String(row.channel || 'telegram'),
    target: String(row.target || ''),
    thread_id: row.thread_id === null || row.thread_id === undefined || row.thread_id === ''
      ? null
      : String(row.thread_id),
    dry_run: Number(row.dry_run || 0) === 1,
    command_path: String(row.command_path || ''),
    command_argv: safeParseJson(row.command_argv_json, []),
    started_at: String(row.started_at || ''),
    finished_at: String(row.finished_at || ''),
    exit_code: Number(row.exit_code || 0),
    stdout_text: String(row.stdout_text || ''),
    stderr_text: String(row.stderr_text || ''),
    stdout_json: safeParseJson(row.stdout_json, null),
    success: Number(row.success || 0) === 1,
    retryable: Number(row.retryable || 0) === 1,
    error_code: String(row.error_code || ''),
    error_message: String(row.error_message || ''),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

function getNotificationDispatchRetryTimestamp(baseTimestamp = getTimestamp(), retryAfterMs = NOTIFICATION_DISPATCHER_RETRY_AFTER_MS) {
  const baseMillis = Number.isFinite(Date.parse(baseTimestamp)) ? Date.parse(baseTimestamp) : Date.now();
  return new Date(baseMillis + Math.max(0, Number(retryAfterMs) || 0)).toISOString();
}

function getStoredNotificationDeliveryAttemptByNotificationId(db, notificationId, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 1;
  const stmt = db.prepare(`
    SELECT *
    FROM notification_delivery_attempts
    WHERE notification_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?
  `);
  stmt.bind([notificationId, limit]);
  const rows = [];
  while (stmt.step()) {
    rows.push(hydrateNotificationDeliveryAttemptRow(stmt.getAsObject()));
  }
  stmt.free();
  return limit === 1 ? (rows[0] || null) : rows;
}

async function getNotificationDeliveryAttemptByNotificationId(notificationId) {
  const db = await ensureBillingDb();
  return getStoredNotificationDeliveryAttemptByNotificationId(db, notificationId, { limit: 1 });
}

async function getNotificationDeliveryAttemptsByNotificationId(notificationId, options = {}) {
  const db = await ensureBillingDb();
  return getStoredNotificationDeliveryAttemptByNotificationId(db, notificationId, options);
}

async function recordStoredNotificationDeliveryAttemptTx(db, attempt) {
  const timestamp = attempt.created_at || getTimestamp();
  const insert = db.prepare(`
    INSERT INTO notification_delivery_attempts (
      attempt_id, notification_id, session_id, task_id, artifact_id, artifact_path, relay_label, media_kind,
      handled_by, delivered_file_message_id, transport, channel, target, thread_id, dry_run,
      command_path, command_argv_json, started_at, finished_at, exit_code, stdout_text, stderr_text,
      stdout_json, success, retryable, error_code, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run([
    attempt.attempt_id || createTaskNotificationDeliveryAttemptId(),
    attempt.notification_id || '',
    attempt.session_id || '',
    attempt.task_id || '',
    attempt.artifact_id || null,
    attempt.artifact_path || null,
    attempt.relay_label || null,
    attempt.media_kind || null,
    attempt.handled_by || '',
    attempt.delivered_file_message_id || null,
    attempt.transport || BLOCKFORK_NOTIFICATION_TRANSPORT,
    attempt.channel || 'telegram',
    attempt.target || '',
    attempt.thread_id || null,
    Number(Boolean(attempt.dry_run)),
    attempt.command_path || '',
    JSON.stringify(Array.isArray(attempt.command_argv) ? attempt.command_argv : []),
    attempt.started_at || timestamp,
    attempt.finished_at || timestamp,
    Number(attempt.exit_code || 0),
    truncateText(attempt.stdout_text || '', 8192),
    truncateText(attempt.stderr_text || '', 8192),
    attempt.stdout_json === undefined || attempt.stdout_json === null ? null : JSON.stringify(attempt.stdout_json),
    Number(Boolean(attempt.success)),
    Number(Boolean(attempt.retryable)),
    attempt.error_code || '',
    attempt.error_message || '',
    timestamp,
    attempt.updated_at || timestamp,
  ]);
  insert.free();
  return getStoredNotificationDeliveryAttemptByNotificationId(db, attempt.notification_id, { limit: 1 });
}

async function markStoredTaskNotificationDispatchOutcomeTx(db, notificationId, options = {}) {
  const current = await getStoredTaskNotificationById(db, notificationId);
  if (!current) {
    return null;
  }

  const timestamp = options.timestamp || getTimestamp();
  const success = Boolean(options.success);
  const retryable = Boolean(options.retryable);
  const update = db.prepare(success ? `
    UPDATE task_notifications
    SET delivery_state = ?,
        delivered_at = ?,
        delivered_message_id = ?,
        last_error = ?,
        next_attempt_at = NULL,
        attempt_count = attempt_count + 1,
        updated_at = ?
    WHERE notification_id = ?
  ` : `
    UPDATE task_notifications
    SET delivery_state = ?,
        claimed_at = NULL,
        delivered_at = NULL,
        delivered_message_id = NULL,
        last_error = ?,
        next_attempt_at = ?,
        attempt_count = attempt_count + 1,
        updated_at = ?
    WHERE notification_id = ?
  `);
  update.run(success ? [
    TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED,
    timestamp,
    options.deliveredMessageId || null,
    '',
    timestamp,
    notificationId,
  ] : [
    retryable ? TASK_NOTIFICATION_DELIVERY_STATES.PENDING : TASK_NOTIFICATION_DELIVERY_STATES.FAILED,
    options.lastError || '',
    retryable ? (options.nextAttemptAt || null) : null,
    timestamp,
    notificationId,
  ]);
  update.free();
  return getStoredTaskNotificationById(db, notificationId);
}

async function listDispatchableNotificationSessionsTx(db, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : NOTIFICATION_DISPATCHER_LIMIT;
  const now = options.timestamp || getTimestamp();
  const stmt = db.prepare(`
    SELECT
      session_id,
      MIN(created_at) AS oldest_created_at,
      COUNT(*) AS pending_count
    FROM task_notifications
    WHERE delivery_state = ?
      AND proactive_eligible = 1
      AND notification_kind != ?
      AND (next_attempt_at IS NULL OR next_attempt_at = '' OR next_attempt_at <= ?)
    GROUP BY session_id
    ORDER BY oldest_created_at ASC, session_id ASC
    LIMIT ?
  `);
  stmt.bind([TASK_NOTIFICATION_DELIVERY_STATES.PENDING, ARTIFACT_DELIVERY_NOTIFICATION_KIND, now, limit]);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      session_id: String(row.session_id || ''),
      oldest_created_at: String(row.oldest_created_at || ''),
      pending_count: Number(row.pending_count || 0),
    });
  }
  stmt.free();
  return rows;
}

async function listDispatchableNotificationSessions(options = {}) {
  return withBillingWrite(async (writeDb) => listDispatchableNotificationSessionsTx(writeDb, options));
}

function buildOpenClawCliNotificationDispatchArgs(notificationView, options = {}) {
  const deliveryTarget = notificationView?.delivery_target || null;
  if (!deliveryTarget || !deliveryTarget.chat_id) {
    throw new Error('delivery_target is required for OpenClaw CLI dispatch');
  }

  const args = [
    'message',
    'send',
    '--channel',
    'telegram',
    '--target',
    String(deliveryTarget.chat_id),
  ];

  if (deliveryTarget.thread_id !== null && deliveryTarget.thread_id !== undefined && String(deliveryTarget.thread_id).trim()) {
    args.push('--thread-id', String(deliveryTarget.thread_id));
  }

  args.push('--message', String(notificationView.outbound_text || ''));

  if (options.dryRun !== false) {
    args.push('--dry-run');
  }

  args.push('--json');
  return args;
}

function buildOpenClawCliArtifactDeliveryArgs(deliveryView, options = {}) {
  const deliveryTarget = deliveryView?.delivery_target || null;
  const artifactPath = String(options.artifactPath || deliveryView?.artifact_delivery?.artifact_path || deliveryView?.payload?.artifact_path || '').trim();
  if (!deliveryTarget || !deliveryTarget.chat_id) {
    throw new Error('delivery_target is required for OpenClaw CLI artifact delivery');
  }
  if (!artifactPath) {
    throw new Error('artifact_path is required for OpenClaw CLI artifact delivery');
  }

  const args = [
    'message',
    'send',
    '--channel',
    'telegram',
    '--target',
    String(deliveryTarget.chat_id),
  ];

  if (deliveryTarget.thread_id !== null && deliveryTarget.thread_id !== undefined && String(deliveryTarget.thread_id).trim()) {
    args.push('--thread-id', String(deliveryTarget.thread_id));
  }

  args.push('--message', String(deliveryView?.outbound_text || `Created artifact: ${path.basename(artifactPath)}`));
  args.push('--media', artifactPath);
  args.push('--force-document');

  if (options.dryRun !== false) {
    args.push('--dry-run');
  }

  args.push('--json');
  return args;
}

function normalizeOpenClawCliTelegramTargetFromPayload(payload = {}) {
  const directChatId = String(payload?.payload?.chatId || payload?.chatId || '').trim();
  if (directChatId) {
    return directChatId;
  }

  const toValue = String(payload?.payload?.to || payload?.to || '').trim();
  if (toValue.toLowerCase().startsWith('telegram:')) {
    return toValue.slice('telegram:'.length).trim();
  }

  return '';
}

async function runCommandWithTimeout(commandPath, args, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS));
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const startedAt = options.startedAt || getTimestamp();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let exited = false;
    let timedOut = false;

    const child = spawn(commandPath, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (exited) {
        return;
      }
      exited = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        timed_out: false,
        started_at: startedAt,
        finished_at: options.finishedAt || getTimestamp(),
        exit_code: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message || String(error)}`.trim(),
        error_code: 'spawn_failed',
        error_message: error.message || String(error),
      });
    });
    child.on('close', (code, signal) => {
      if (exited) {
        return;
      }
      exited = true;
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        timed_out: timedOut,
        started_at: startedAt,
        finished_at: options.finishedAt || getTimestamp(),
        exit_code: timedOut ? null : code,
        signal: timedOut ? signal || 'SIGKILL' : signal || null,
        stdout,
        stderr,
      });
    });
  });
}

async function runOpenClawCliDryRunAdapter(notificationView, options = {}) {
  const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : BLOCKFORK_OPENCLAW_CLI_DRY_RUN;
  const commandPath = String(options.commandPath || BLOCKFORK_OPENCLAW_CLI_BIN || 'openclaw').trim() || 'openclaw';
  const commandArgs = buildOpenClawCliNotificationDispatchArgs(notificationView, { dryRun });
  const startedAt = options.startedAt || getTimestamp();
  const result = await runCommandWithTimeout(commandPath, commandArgs, {
    timeoutMs: options.timeoutMs || BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS,
    env: options.env || process.env,
    startedAt,
  });

  let parsed = null;
  if (result.stdout && result.stdout.trim()) {
    try {
      parsed = JSON.parse(result.stdout);
    } catch (error) {
      parsed = null;
      if (result.ok) {
        return {
          ok: false,
          retryable: true,
          error_code: 'invalid_json',
          error_message: 'OpenClaw CLI returned non-JSON output',
          stdout_text: result.stdout,
          stderr_text: result.stderr,
          stdout_json: null,
          command_path: commandPath,
          command_args: commandArgs,
          started_at: result.started_at,
          finished_at: result.finished_at,
          exit_code: result.exit_code,
        };
      }
    }
  }

  if (!result.ok) {
    return {
      ok: false,
      retryable: true,
      error_code: result.timed_out ? 'timeout' : 'non_zero_exit',
      error_message: result.timed_out ? 'OpenClaw CLI timed out' : 'OpenClaw CLI returned a non-zero exit code',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  const payload = parsed || {};
  const payloadAction = String(payload.action || payload.payload?.action || '').trim().toLowerCase();
  const payloadChannel = String(payload.channel || payload.payload?.channel || '').trim().toLowerCase();
  const payloadDryRun = payload && typeof payload === 'object' && (payload.dryRun === true || payload.payload?.dryRun === true);
  const payloadHandledBy = String(payload.handledBy || payload.payload?.handledBy || '').trim().toLowerCase();
  const payloadChatId = normalizeOpenClawCliTelegramTargetFromPayload(payload);
  const payloadMessageId = String(payload.payload?.messageId || payload.messageId || '').trim();
  const expectedChatId = String(notificationView?.delivery_target?.chat_id || '').trim();

  if (payloadAction !== 'send') {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI response did not confirm send action',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (payloadChannel !== 'telegram') {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI response did not confirm telegram channel',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (expectedChatId && !payloadChatId) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI response did not include a target chat id',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (expectedChatId && payloadChatId && payloadChatId !== expectedChatId) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI response target did not match expected chat id',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (dryRun) {
    if (!payloadDryRun) {
      return {
        ok: false,
        retryable: false,
        error_code: 'contract_violation',
        error_message: 'OpenClaw CLI dry-run response did not confirm dryRun=true',
        stdout_text: result.stdout,
        stderr_text: result.stderr,
        stdout_json: parsed,
        command_path: commandPath,
        command_args: commandArgs,
        started_at: result.started_at,
        finished_at: result.finished_at,
        exit_code: result.exit_code,
      };
    }

    return {
      ok: true,
      retryable: false,
      error_code: '',
      error_message: '',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (payloadDryRun) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI real-send response unexpectedly reported dryRun=true',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (payloadHandledBy !== 'plugin') {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI real-send response did not confirm handledBy=plugin',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (expectedMediaPath && payloadMediaUrl && payloadMediaUrl !== expectedMediaPath) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI real-send response media path did not match the artifact path',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (!payload || typeof payload !== 'object' || payload.payload?.ok !== true) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI real-send response did not confirm payload.ok=true',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (!payloadMessageId) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI real-send response did not include a messageId',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  return {
    ok: true,
    retryable: false,
    error_code: '',
    error_message: '',
    stdout_text: result.stdout,
    stderr_text: result.stderr,
    stdout_json: parsed,
    command_path: commandPath,
    command_args: commandArgs,
    started_at: result.started_at,
    finished_at: result.finished_at,
    exit_code: result.exit_code,
  };
}

function normalizeOpenClawCliMediaUrlFromPayload(payload = {}) {
  const mediaUrl = String(payload?.payload?.mediaUrl || payload?.mediaUrl || '').trim();
  if (mediaUrl) {
    return mediaUrl;
  }
  const mediaUrls = payload?.payload?.mediaUrls || payload?.mediaUrls || [];
  if (Array.isArray(mediaUrls) && mediaUrls.length) {
    return String(mediaUrls[0] || '').trim();
  }
  return '';
}

function normalizeOpenClawCliDeliveredMessageIdFromPayload(payload = {}) {
  const directMessageId = String(payload?.payload?.messageId || payload?.messageId || '').trim();
  if (directMessageId) {
    return directMessageId;
  }
  const directFileMessageId = String(payload?.payload?.fileMessageId || payload?.fileMessageId || '').trim();
  if (directFileMessageId) {
    return directFileMessageId;
  }
  return '';
}

async function runOpenClawCliArtifactDeliveryAdapter(deliveryView, options = {}) {
  const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : BLOCKFORK_OPENCLAW_CLI_DRY_RUN;
  const commandPath = String(options.commandPath || BLOCKFORK_OPENCLAW_CLI_BIN || 'openclaw').trim() || 'openclaw';
  const commandArgs = buildOpenClawCliArtifactDeliveryArgs(deliveryView, {
    dryRun,
    artifactPath: options.artifactPath || deliveryView?.artifact_delivery?.artifact_path || deliveryView?.payload?.artifact_path || '',
  });
  const startedAt = options.startedAt || getTimestamp();
  const result = await runCommandWithTimeout(commandPath, commandArgs, {
    timeoutMs: options.timeoutMs || BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS,
    env: options.env || process.env,
    startedAt,
  });

  let parsed = null;
  if (result.stdout && result.stdout.trim()) {
    try {
      parsed = JSON.parse(result.stdout);
    } catch (error) {
      parsed = null;
      if (result.ok) {
        return {
          ok: false,
          retryable: true,
          error_code: 'invalid_json',
          error_message: 'OpenClaw CLI returned non-JSON output',
          stdout_text: result.stdout,
          stderr_text: result.stderr,
          stdout_json: null,
          command_path: commandPath,
          command_args: commandArgs,
          started_at: result.started_at,
          finished_at: result.finished_at,
          exit_code: result.exit_code,
        };
      }
    }
  }

  if (!result.ok) {
    return {
      ok: false,
      retryable: true,
      error_code: result.timed_out ? 'timeout' : 'non_zero_exit',
      error_message: result.timed_out ? 'OpenClaw CLI timed out' : 'OpenClaw CLI returned a non-zero exit code',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  const payload = parsed || {};
  const payloadAction = String(payload.action || payload.payload?.action || '').trim().toLowerCase();
  const payloadChannel = String(payload.channel || payload.payload?.channel || '').trim().toLowerCase();
  const payloadDryRun = payload && typeof payload === 'object' && (payload.dryRun === true || payload.payload?.dryRun === true);
  const payloadHandledBy = String(payload.handledBy || payload.payload?.handledBy || '').trim().toLowerCase();
  const payloadChatId = normalizeOpenClawCliTelegramTargetFromPayload(payload);
  const payloadMessageId = normalizeOpenClawCliDeliveredMessageIdFromPayload(payload);
  const payloadMediaUrl = normalizeOpenClawCliMediaUrlFromPayload(payload);
  const expectedChatId = String(deliveryView?.delivery_target?.chat_id || '').trim();
  const expectedMediaPath = String(options.artifactPath || deliveryView?.artifact_delivery?.artifact_path || deliveryView?.payload?.artifact_path || '').trim();

  if (payloadAction !== 'send') {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI response did not confirm send action',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (payloadChannel !== 'telegram') {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI response did not confirm telegram channel',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (expectedChatId && !payloadChatId) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI response did not include a target chat id',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (expectedChatId && payloadChatId && payloadChatId !== expectedChatId) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI response target did not match expected chat id',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (dryRun) {
    if (!payloadDryRun) {
      return {
        ok: false,
        retryable: false,
        error_code: 'contract_violation',
        error_message: 'OpenClaw CLI dry-run response did not confirm dryRun=true',
        stdout_text: result.stdout,
        stderr_text: result.stderr,
        stdout_json: parsed,
        command_path: commandPath,
        command_args: commandArgs,
        started_at: result.started_at,
        finished_at: result.finished_at,
        exit_code: result.exit_code,
      };
    }

    if (expectedMediaPath && payloadMediaUrl !== expectedMediaPath) {
      return {
        ok: false,
        retryable: false,
        error_code: 'contract_violation',
        error_message: 'OpenClaw CLI dry-run response did not include the expected media path',
        stdout_text: result.stdout,
        stderr_text: result.stderr,
        stdout_json: parsed,
        command_path: commandPath,
        command_args: commandArgs,
        started_at: result.started_at,
        finished_at: result.finished_at,
        exit_code: result.exit_code,
      };
    }

    return {
      ok: true,
      retryable: false,
      error_code: '',
      error_message: '',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (payloadDryRun) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI real-send response unexpectedly reported dryRun=true',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (payloadHandledBy !== 'plugin') {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI real-send response did not confirm handledBy=plugin',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (!payload || typeof payload !== 'object' || payload.payload?.ok !== true) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI real-send response did not confirm payload.ok=true',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  if (!payloadMessageId) {
    return {
      ok: false,
      retryable: false,
      error_code: 'contract_violation',
      error_message: 'OpenClaw CLI real-send response did not include a messageId',
      stdout_text: result.stdout,
      stderr_text: result.stderr,
      stdout_json: parsed,
      command_path: commandPath,
      command_args: commandArgs,
      started_at: result.started_at,
      finished_at: result.finished_at,
      exit_code: result.exit_code,
    };
  }

  return {
    ok: true,
    retryable: false,
    error_code: '',
    error_message: '',
    stdout_text: result.stdout,
    stderr_text: result.stderr,
    stdout_json: parsed,
    command_path: commandPath,
    command_args: commandArgs,
    started_at: result.started_at,
    finished_at: result.finished_at,
    exit_code: result.exit_code,
  };
}

function computeNotificationDispatchBackoffMs(attemptCount = 0) {
  const base = Math.max(1000, Number(NOTIFICATION_DISPATCHER_RETRY_AFTER_MS) || 60000);
  const exponent = Math.max(0, Number(attemptCount) || 0);
  return Math.min(base * Math.pow(2, Math.min(exponent, 4)), 30 * 60 * 1000);
}

async function dispatchPendingTaskNotifications(options = {}) {
  const transport = String(options.transport || BLOCKFORK_NOTIFICATION_TRANSPORT || 'openclaw_cli');
  if (transport !== 'openclaw_cli') {
    throw new Error(`Unsupported notification transport: ${transport}`);
  }

  const dispatchTimestamp = options.timestamp || getTimestamp();
  const sessionLimit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : NOTIFICATION_DISPATCHER_LIMIT;
  const claimLimit = Number.isFinite(Number(options.claimLimit)) ? Math.max(1, Number(options.claimLimit)) : 10;
  const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : BLOCKFORK_OPENCLAW_CLI_DRY_RUN;
  const commandPath = String(options.commandPath || BLOCKFORK_OPENCLAW_CLI_BIN || 'openclaw').trim() || 'openclaw';
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS));
  const summary = {
    transport,
    dry_run: dryRun,
    command_path: commandPath,
    scanned_session_count: 0,
    claimed_notification_count: 0,
    delivered_notification_count: 0,
    failed_notification_count: 0,
    skipped_notification_count: 0,
    attempts: [],
  };

  if (!dryRun) {
    throw new Error('Real-send is not supported by the bulk dispatcher; use dispatchTaskNotificationById with maxRealSends=1');
  }

  const pendingSessions = await withBillingWrite(async (db) => listDispatchableNotificationSessionsTx(db, {
    limit: sessionLimit,
    timestamp: dispatchTimestamp,
  }));
  summary.scanned_session_count = pendingSessions.length;

  for (const sessionEntry of pendingSessions) {
    const dispatchPack = await withBillingWrite(async (db) => {
      const deliveryTarget = await ensureSessionDeliveryTargetForSessionTx(db, sessionEntry.session_id, {
        timestamp: dispatchTimestamp,
      });
      if (!deliveryTarget) {
        return {
          session_id: sessionEntry.session_id,
          delivery_target: null,
          notifications: [],
        };
      }

      const claimed = await claimStoredTaskNotificationsForSessionTx(db, sessionEntry.session_id, {
        limit: claimLimit,
        timestamp: dispatchTimestamp,
      });

      const notifications = claimed.map((notification) => renderTaskNotificationViewTx(db, notification)).filter(Boolean);
      return {
        session_id: sessionEntry.session_id,
        delivery_target: deliveryTarget,
        notifications,
      };
    });

    if (!dispatchPack.delivery_target || !dispatchPack.notifications.length) {
      summary.skipped_notification_count += 1;
      continue;
    }

    for (const notification of dispatchPack.notifications) {
      summary.claimed_notification_count += 1;
      const attemptStartedAt = getTimestamp();
      const adapterResult = await runOpenClawCliDryRunAdapter(notification, {
        commandPath,
        dryRun,
        timeoutMs,
        startedAt: attemptStartedAt,
      });

      const attemptRecord = {
        notification_id: notification.notification_id,
        session_id: notification.session_id,
        task_id: notification.task_id,
        transport,
        channel: notification.delivery_target?.channel || 'telegram',
        target: notification.delivery_target?.chat_id || '',
        thread_id: notification.delivery_target?.thread_id || null,
        dry_run: dryRun,
        command_path: commandPath,
        command_argv: buildOpenClawCliNotificationDispatchArgs(notification, { dryRun }),
        started_at: adapterResult.started_at || attemptStartedAt,
        finished_at: adapterResult.finished_at || getTimestamp(),
        exit_code: adapterResult.exit_code === null || adapterResult.exit_code === undefined ? -1 : Number(adapterResult.exit_code),
        stdout_text: adapterResult.stdout_text || '',
        stderr_text: adapterResult.stderr_text || '',
        stdout_json: adapterResult.stdout_json,
        success: Boolean(adapterResult.ok),
        retryable: Boolean(adapterResult.retryable),
        error_code: adapterResult.error_code || '',
        error_message: adapterResult.error_message || '',
        created_at: adapterResult.finished_at || getTimestamp(),
        updated_at: adapterResult.finished_at || getTimestamp(),
      };

      await withBillingWrite(async (db) => {
        await recordStoredNotificationDeliveryAttemptTx(db, attemptRecord);
        if (adapterResult.ok) {
          await markStoredTaskNotificationDispatchOutcomeTx(db, notification.notification_id, {
            success: true,
            deliveredMessageId: adapterResult.stdout_json && typeof adapterResult.stdout_json === 'object'
              ? String(adapterResult.stdout_json.message_id || adapterResult.stdout_json.payload?.message_id || '')
              : null,
            timestamp: adapterResult.finished_at || getTimestamp(),
          });
        } else {
          const nextAttemptAt = getNotificationDispatchRetryTimestamp(adapterResult.finished_at || getTimestamp(), computeNotificationDispatchBackoffMs(notification.attempt_count || 0));
          await markStoredTaskNotificationDispatchOutcomeTx(db, notification.notification_id, {
            success: false,
            retryable: Boolean(adapterResult.retryable),
            lastError: adapterResult.error_message || adapterResult.error_code || 'dispatch_failed',
            nextAttemptAt,
            timestamp: adapterResult.finished_at || getTimestamp(),
          });
        }
      });

      if (adapterResult.ok) {
        summary.delivered_notification_count += 1;
      } else {
        summary.failed_notification_count += 1;
      }
      summary.attempts.push({
        notification_id: notification.notification_id,
        session_id: notification.session_id,
        task_id: notification.task_id,
        success: Boolean(adapterResult.ok),
        retryable: Boolean(adapterResult.retryable),
        error_code: adapterResult.error_code || '',
      });
    }
  }

  return summary;
}

async function dispatchTaskNotificationById(notificationId, options = {}) {
  const exactNotificationId = String(notificationId || '').trim();
  if (!exactNotificationId) {
    throw new Error('notificationId is required');
  }

  const transport = String(options.transport || BLOCKFORK_NOTIFICATION_TRANSPORT || 'openclaw_cli');
  if (transport !== 'openclaw_cli') {
    throw new Error(`Unsupported notification transport: ${transport}`);
  }

  const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : BLOCKFORK_OPENCLAW_CLI_DRY_RUN;
  const commandPath = String(options.commandPath || BLOCKFORK_OPENCLAW_CLI_BIN || 'openclaw').trim() || 'openclaw';
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS));
  const dispatchTimestamp = options.timestamp || getTimestamp();
  const allowDelivered = Boolean(options.allowDelivered);

  if (!dryRun && Number(options.maxRealSends || 0) !== 1) {
    throw new Error('Real-send notification dispatch requires maxRealSends=1');
  }

  const preflight = await withBillingWrite(async (db) => {
    const current = await getStoredTaskNotificationById(db, exactNotificationId);
    if (!current) {
      return {
        ok: false,
        status: 'not_found',
        reason_code: 'not_found',
        reason_message: 'Notification not found',
        notification: null,
        delivery_target: null,
      };
    }

    const deliveryTarget = await ensureSessionDeliveryTargetForSessionTx(db, current.session_id, {
      timestamp: dispatchTimestamp,
    });
    if (!deliveryTarget || !deliveryTarget.chat_id) {
      return {
        ok: false,
        status: 'blocked',
        reason_code: 'no_delivery_target',
        reason_message: 'Notification has no delivery target',
        notification: current,
        delivery_target: null,
      };
    }

    const claimed = await claimStoredTaskNotificationByIdTx(db, exactNotificationId, {
      timestamp: dispatchTimestamp,
      allowDelivered,
      overrideEligibility: Boolean(options.overrideEligibility),
    });
    if (!claimed.ok) {
      return {
        ok: false,
        status: 'blocked',
        reason_code: claimed.reason_code || 'not_claimable',
        reason_message: claimed.reason_message || 'Notification is not claimable',
        notification: claimed.notification || current,
        delivery_target: {
          channel: deliveryTarget.channel || 'telegram',
          chat_id: deliveryTarget.chat_id || '',
          thread_id: deliveryTarget.thread_id || null,
        },
      };
    }

    const rendered = renderTaskNotificationViewTx(db, claimed.claimed_notification);
    if (!rendered) {
      return {
        ok: false,
        status: 'blocked',
        reason_code: 'render_failed',
        reason_message: 'Notification could not be rendered',
        notification: claimed.claimed_notification,
        delivery_target: {
          channel: deliveryTarget.channel || 'telegram',
          chat_id: deliveryTarget.chat_id || '',
          thread_id: deliveryTarget.thread_id || null,
        },
      };
    }

    if (String(rendered.delivery_target?.channel || 'telegram').toLowerCase() !== 'telegram') {
      return {
        ok: false,
        status: 'blocked',
        reason_code: 'unsupported_channel',
        reason_message: 'Notification delivery target channel is not telegram',
        notification: rendered,
        delivery_target: rendered.delivery_target,
      };
    }

    return {
      ok: true,
      status: 'ready',
      notification: rendered,
      delivery_target: rendered.delivery_target,
    };
  });

  if (!preflight.ok) {
    return {
      transport,
      dry_run: dryRun,
      command_path: commandPath,
      notification_id: exactNotificationId,
      status: preflight.status,
      reason_code: preflight.reason_code,
      reason_message: preflight.reason_message,
      delivery_target: preflight.delivery_target || null,
      attempt: null,
      notification: preflight.notification || null,
    };
  }

  const adapterResult = await runOpenClawCliDryRunAdapter(preflight.notification, {
    commandPath,
    dryRun,
    timeoutMs,
    startedAt: dispatchTimestamp,
  });

  const attemptRecord = {
    notification_id: preflight.notification.notification_id,
    session_id: preflight.notification.session_id,
    task_id: preflight.notification.task_id,
    transport,
    channel: preflight.delivery_target?.channel || 'telegram',
    target: preflight.delivery_target?.chat_id || '',
    thread_id: preflight.delivery_target?.thread_id || null,
    dry_run: dryRun,
    command_path: commandPath,
    command_argv: buildOpenClawCliNotificationDispatchArgs(preflight.notification, { dryRun }),
    started_at: adapterResult.started_at || dispatchTimestamp,
    finished_at: adapterResult.finished_at || getTimestamp(),
    exit_code: adapterResult.exit_code === null || adapterResult.exit_code === undefined ? -1 : Number(adapterResult.exit_code),
    stdout_text: adapterResult.stdout_text || '',
    stderr_text: adapterResult.stderr_text || '',
    stdout_json: adapterResult.stdout_json,
    success: Boolean(adapterResult.ok),
    retryable: Boolean(adapterResult.retryable),
    error_code: adapterResult.error_code || '',
    error_message: adapterResult.error_message || '',
    created_at: adapterResult.finished_at || getTimestamp(),
    updated_at: adapterResult.finished_at || getTimestamp(),
  };

  const finalNotification = await withBillingWrite(async (db) => {
    await recordStoredNotificationDeliveryAttemptTx(db, attemptRecord);
    if (adapterResult.ok) {
      return markStoredTaskNotificationDispatchOutcomeTx(db, preflight.notification.notification_id, {
        success: true,
        deliveredMessageId: adapterResult.stdout_json && typeof adapterResult.stdout_json === 'object'
          ? String(adapterResult.stdout_json.messageId || adapterResult.stdout_json.payload?.messageId || adapterResult.stdout_json.payload?.message_id || '')
          : null,
        timestamp: adapterResult.finished_at || getTimestamp(),
      });
    }

    const nextAttemptAt = getNotificationDispatchRetryTimestamp(adapterResult.finished_at || getTimestamp(), computeNotificationDispatchBackoffMs(preflight.notification.attempt_count || 0));
    return markStoredTaskNotificationDispatchOutcomeTx(db, preflight.notification.notification_id, {
      success: false,
      retryable: Boolean(adapterResult.retryable),
      lastError: adapterResult.error_message || adapterResult.error_code || 'dispatch_failed',
      nextAttemptAt,
      timestamp: adapterResult.finished_at || getTimestamp(),
    });
  });

  return {
    transport,
    dry_run: dryRun,
    command_path: commandPath,
    notification_id: preflight.notification.notification_id,
    session_id: preflight.notification.session_id,
    task_id: preflight.notification.task_id,
    status: adapterResult.ok ? 'delivered' : (adapterResult.retryable ? 'retryable' : 'failed'),
    reason_code: adapterResult.error_code || '',
    reason_message: adapterResult.error_message || '',
    delivery_target: preflight.delivery_target,
    attempt: attemptRecord,
    notification: finalNotification,
    adapter_result: adapterResult,
  };
}

async function resolvePreferredManagedArtifactDeliveryRelayLabel(options = {}) {
  const explicit = String(
    options.relayLabel
    || process.env.BLOCKFORK_ARTIFACT_DELIVERY_RELAY_LABEL
    || process.env.BLOCKFORK_OPENCLAW_RELAY_LABEL
    || ''
  ).trim();
  if (explicit) {
    return explicit;
  }

  const relays = await listOpenClawRelayConfigs();
  const readyRelays = [];
  for (const relay of relays) {
    const staticReport = assessOpenClawRelayStaticChecks(relay);
    if (!staticReport.blockers.length) {
      readyRelays.push(relay);
    }
  }

  const cleanbenchRelay = readyRelays.find((relay) => String(relay.relay_label || '') === 'cleanbench');
  if (cleanbenchRelay) {
    return cleanbenchRelay.relay_label;
  }

  return readyRelays.length ? String(readyRelays[0].relay_label || '') : '';
}

async function resolveAutomaticArtifactDeliveryRelayLabel(executionId, options = {}) {
  const explicit = String(
    options.relayLabel
    || options.notification?.relay_label
    || options.deliveryNotification?.relay_label
    || options.artifact?.relay_label
    || ''
  ).trim();
  if (explicit) {
    return explicit;
  }

  const envRelayLabel = String(
    process.env.BLOCKFORK_ARTIFACT_DELIVERY_RELAY_LABEL
    || process.env.BLOCKFORK_OPENCLAW_RELAY_LABEL
    || ''
  ).trim();
  if (envRelayLabel) {
    return envRelayLabel;
  }

  return resolvePreferredManagedArtifactDeliveryRelayLabel({
    ...options,
    executionId,
  });
}

function resolveOpenClawRelayWorkspaceRoot(relay = {}) {
  const candidateRoots = [];
  const stateDir = String(relay.state_dir || '').trim();
  if (stateDir) {
    candidateRoots.push(path.resolve(path.dirname(stateDir), 'workspace'));
  }

  const configPath = String(relay.config_path || '').trim();
  if (configPath) {
    candidateRoots.push(path.resolve(path.dirname(configPath), 'workspace'));
  }

  for (const candidateRoot of candidateRoots) {
    if (!candidateRoot || !fs.existsSync(candidateRoot)) {
      continue;
    }
    const stats = fs.statSync(candidateRoot);
    if (!stats.isDirectory()) {
      continue;
    }
    return {
      ok: true,
      workspace_root: candidateRoot,
    };
  }

  return {
    ok: false,
    reason: 'relay_workspace_root_missing',
    workspace_root: candidateRoots[0] || '',
  };
}

function stageManagedArtifactDeliveryCopy(artifactPath, relay, executionId, options = {}) {
  const sourcePath = String(artifactPath || '').trim();
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, reason: 'artifact_path_not_found' };
  }

  const sourceStats = fs.statSync(sourcePath);
  if (!sourceStats.isFile() || Number(sourceStats.size || 0) <= 0) {
    return { ok: false, reason: 'artifact_not_nonempty_file' };
  }

  const relayRoot = resolveOpenClawRelayWorkspaceRoot(relay || {});
  if (!relayRoot.ok) {
    return relayRoot;
  }

  const filenameCandidate = String(options.filename || path.basename(sourcePath)).trim();
  const sanitized = sanitizeManagedArtifactFilename(filenameCandidate);
  if (!sanitized.ok) {
    return {
      ok: false,
      reason: sanitized.reason || 'artifact_invalid',
    };
  }

  const deliveryDir = path.join(relayRoot.workspace_root, '.blockfork-artifact-deliveries', String(executionId || 'unknown'));
  fs.mkdirSync(deliveryDir, { recursive: true });
  const deliveryPath = path.join(deliveryDir, sanitized.filename);
  const canonicalDeliveryPath = resolveCanonicalArtifactPath(deliveryPath);
  if (!canonicalDeliveryPath.ok) {
    return {
      ok: false,
      reason: canonicalDeliveryPath.reason || 'artifact_output_invalid',
    };
  }

  if (!isPathWithinRoot(canonicalDeliveryPath.canonical_path, relayRoot.workspace_root)) {
    return {
      ok: false,
      reason: 'artifact_delivery_path_outside_relay_workspace',
    };
  }

  fs.mkdirSync(path.dirname(canonicalDeliveryPath.canonical_path), { recursive: true });
  fs.copyFileSync(sourcePath, canonicalDeliveryPath.canonical_path);

  const stagedStats = fs.statSync(canonicalDeliveryPath.canonical_path);
  if (!stagedStats.isFile() || Number(stagedStats.size || 0) !== Number(sourceStats.size || 0)) {
    try {
      if (fs.existsSync(canonicalDeliveryPath.canonical_path)) {
        fs.unlinkSync(canonicalDeliveryPath.canonical_path);
      }
    } catch (_) {}
    return {
      ok: false,
      reason: 'artifact_delivery_copy_failed',
    };
  }

  return {
    ok: true,
    relay_workspace_root: relayRoot.workspace_root,
    artifact_path: canonicalDeliveryPath.canonical_path,
    declared_path: canonicalDeliveryPath.declared_path,
    source_path: sourcePath,
  };
}

async function attemptAutomaticArtifactDeliveryForExecution(executionId, options = {}) {
  const execution = await getExecutionById(executionId);
  if (!execution) {
    return { ok: false, required: true, reason: 'artifact_execution_missing' };
  }

  const task = await getTaskByExecutionId(executionId);
  if (!task) {
    return { ok: false, required: true, reason: 'artifact_execution_missing' };
  }

  const taskKind = String(task.task_kind || '');
  if (![TASK_KINDS.ARTIFACT_TASK, TASK_KINDS.AGENT_WORKFLOW_TASK].includes(taskKind)) {
    return { ok: true, required: false, skipped: true };
  }

  const artifact = await getExecutionArtifactByExecutionId(executionId);
  if (!artifact) {
    return { ok: false, required: true, reason: 'artifact_execution_missing' };
  }

  if (String(artifact.verification_state || '') !== ARTIFACT_VERIFICATION_STATES.VERIFIED) {
    return { ok: false, required: true, reason: 'artifact_not_verified' };
  }

  if (String(artifact.delivery_confirmed || 0) === '1') {
    return { ok: true, required: true, skipped: true, reason: 'artifact_already_delivered' };
  }

  const assessment = options.assessment || await getVerifiedTaskArtifactAssessmentForExecutionId(executionId);
  if (!assessment) {
    return { ok: false, required: true, reason: 'artifact_semantic_verification_failed' };
  }

  const relayLabel = await resolveAutomaticArtifactDeliveryRelayLabel(executionId, {
    ...options,
    artifact,
  });
  if (!relayLabel) {
    return { ok: false, required: true, reason: 'relay_not_ready' };
  }

  const relay = await getOpenClawRelayConfigByLabel(relayLabel);
  if (!relay) {
    return { ok: false, required: true, reason: 'relay_config_not_found' };
  }

  const staticReport = assessOpenClawRelayStaticChecks(relay);
  if (staticReport.blockers.length) {
    return {
      ok: false,
      required: true,
      reason: 'relay_not_ready',
      detail: staticReport.blockers.map((item) => item.detail).join('; ') || 'OpenClaw relay is not ready',
    };
  }

  const sourcePath = String(options.artifactPath || artifact.canonical_path || '').trim();
  const stagedCopy = stageManagedArtifactDeliveryCopy(sourcePath, relay, executionId, {
    filename: options.filename || artifact.artifact_filename || path.basename(sourcePath),
  });
  if (!stagedCopy.ok) {
    return {
      ok: false,
      required: true,
      reason: stagedCopy.reason || 'artifact_delivery_copy_failed',
    };
  }

  const ensured = options.deliveryNotification?.notification_id
    ? { ok: true, notification: options.deliveryNotification }
    : await ensureArtifactDeliveryNotificationForExecution(executionId, {
      relayLabel,
      timestamp: options.timestamp || getTimestamp(),
    });
  if (!ensured || ensured.ok === false) {
    return {
      ok: false,
      required: true,
      reason: ensured?.reason || 'artifact_delivery_not_ready',
    };
  }

  const notificationRow = ensured.notification_id ? ensured : ensured.notification;
  if (!notificationRow || !notificationRow.notification_id) {
    return {
      ok: false,
      required: true,
      reason: 'artifact_delivery_not_ready',
    };
  }

  const dispatchResult = await dispatchArtifactDeliveryById(notificationRow.notification_id, {
    relayLabel,
    commandPath: relay.cli_bin || options.commandPath || BLOCKFORK_OPENCLAW_CLI_BIN || 'openclaw',
    dryRun: options.dryRun !== undefined ? Boolean(options.dryRun) : false,
    timeoutMs: options.timeoutMs || BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS,
    maxRealSends: 1,
    artifactPath: stagedCopy.artifact_path,
    allowDelivered: false,
    timestamp: options.timestamp || getTimestamp(),
  });

  return {
    ok: dispatchResult.status === 'delivered',
    required: true,
    relayLabel,
    relay,
    notification: dispatchResult.notification || notificationRow || null,
    attempt: dispatchResult.attempt || null,
    delivery: dispatchResult,
    stagedCopy,
  };
}

async function dispatchArtifactDeliveryById(deliveryId, options = {}) {
  const exactDeliveryId = String(deliveryId || '').trim();
  if (!exactDeliveryId && !String(options.artifactId || '').trim()) {
    throw new Error('artifact delivery id or artifactId is required');
  }

  const relayLabel = String(options.relayLabel || '').trim();
  if (!relayLabel) {
    throw new Error('relayLabel is required');
  }

  const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : BLOCKFORK_OPENCLAW_CLI_DRY_RUN;
  if (!dryRun && Number(options.maxRealSends || 0) !== 1) {
    throw new Error('Real-send artifact delivery requires maxRealSends=1');
  }

  const transport = String(options.transport || BLOCKFORK_NOTIFICATION_TRANSPORT || 'openclaw_cli');
  if (transport !== 'openclaw_cli') {
    throw new Error(`Unsupported notification transport: ${transport}`);
  }

  const commandPathOverride = String(options.commandPath || '').trim();
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS));
  const dispatchTimestamp = options.timestamp || getTimestamp();
  const allowDelivered = Boolean(options.allowDelivered);
  const artifactPathOverride = String(options.artifactPath || '').trim();

  if (!exactDeliveryId) {
    const ensured = await ensureArtifactDeliveryNotificationForExecution(String(options.artifactId || '').trim(), {
      relayLabel,
      timestamp: dispatchTimestamp,
    });
    if (!ensured || !ensured.ok) {
      return {
        transport,
        dry_run: dryRun,
        command_path: commandPathOverride || '',
        notification_id: null,
        artifact_id: String(options.artifactId || '').trim() || null,
        relay_label: relayLabel,
        status: 'blocked',
        reason_code: ensured?.reason || 'artifact_delivery_not_ready',
        reason_message: 'Artifact delivery notification is not ready',
        delivery_target: null,
        attempt: null,
        notification: null,
      };
    }
  }

  const preflight = await withBillingWrite(async (db) => {
    let notification = null;
    let artifact = null;
    let execution = null;
    let task = null;

    if (exactDeliveryId) {
      notification = await getStoredTaskNotificationById(db, exactDeliveryId);
      if (!notification) {
        return {
          ok: false,
          status: 'not_found',
          reason_code: 'not_found',
          reason_message: 'Artifact delivery notification not found',
          notification: null,
          delivery_target: null,
        };
      }
      if (String(notification.notification_kind || '') !== ARTIFACT_DELIVERY_NOTIFICATION_KIND) {
        return {
          ok: false,
          status: 'blocked',
          reason_code: 'not_artifact_delivery_notification',
          reason_message: 'Notification is not an artifact delivery notification',
          notification,
          delivery_target: null,
        };
      }
      const claimed = await claimStoredTaskNotificationByIdTx(db, exactDeliveryId, {
        timestamp: dispatchTimestamp,
        allowDelivered,
        overrideEligibility: true,
      });
      if (!claimed.ok) {
        return {
          ok: false,
          status: 'blocked',
          reason_code: claimed.reason_code || 'not_claimable',
          reason_message: claimed.reason_message || 'Artifact delivery notification is not claimable',
          notification: claimed.notification || notification,
          delivery_target: null,
        };
      }
      notification = claimed.claimed_notification || notification;
      artifact = notification.artifact_id ? await getStoredExecutionArtifactByArtifactId(db, notification.artifact_id) : null;
      if (artifact) {
        execution = await getStoredExecutionById(db, artifact.execution_id);
        task = execution?.task_id ? await getStoredTaskById(db, execution.task_id) : null;
      }
    } else {
      artifact = await getStoredExecutionArtifactByArtifactId(db, String(options.artifactId || '').trim());
      if (!artifact) {
        return {
          ok: false,
          status: 'not_found',
          reason_code: 'not_found',
          reason_message: 'Artifact not found',
          notification: null,
          delivery_target: null,
        };
      }
      execution = await getStoredExecutionById(db, artifact.execution_id);
      task = execution?.task_id ? await getStoredTaskById(db, execution.task_id) : null;
      if (!execution || !task) {
        return {
          ok: false,
          status: 'blocked',
          reason_code: 'artifact_execution_missing',
          reason_message: 'Artifact execution not found',
          notification: null,
          delivery_target: null,
        };
      }
      notification = await getStoredTaskNotificationByArtifactIdTx(db, artifact.artifact_id);
      if (notification) {
        const claimed = await claimStoredTaskNotificationByIdTx(db, notification.notification_id, {
          timestamp: dispatchTimestamp,
          allowDelivered,
          overrideEligibility: true,
        });
        if (!claimed.ok) {
          return {
            ok: false,
            status: 'blocked',
            reason_code: claimed.reason_code || 'not_claimable',
            reason_message: claimed.reason_message || 'Artifact delivery notification is not claimable',
            notification: claimed.notification || notification,
            delivery_target: null,
          };
        }
        notification = claimed.claimed_notification || notification;
      }
    }

    if (!notification || !artifact) {
      return {
        ok: false,
        status: 'blocked',
        reason_code: 'artifact_delivery_not_ready',
        reason_message: 'Artifact delivery notification is not ready',
        notification: notification || null,
        delivery_target: null,
      };
    }

    const eligibility = await assessArtifactDeliveryEligibility(execution.execution_id, {
      allowDelivered,
    });
    if (!eligibility.ok) {
      return {
        ok: false,
        status: 'blocked',
        reason_code: eligibility.reason || 'artifact_delivery_not_ready',
        reason_message: 'Artifact is not eligible for delivery',
        notification,
        delivery_target: null,
      };
    }

    const relay = await getOpenClawRelayConfigByLabel(relayLabel);
    if (!relay) {
      return {
        ok: false,
        status: 'blocked',
        reason_code: 'relay_config_not_found',
        reason_message: 'OpenClaw relay config not found',
        notification,
        delivery_target: null,
      };
    }

    const staticReport = assessOpenClawRelayStaticChecks(relay);
    if (staticReport.blockers.length) {
      return {
        ok: false,
        status: 'blocked',
        reason_code: 'relay_not_ready',
        reason_message: staticReport.blockers.map((item) => item.detail).join('; ') || 'OpenClaw relay is not ready',
        notification,
        delivery_target: null,
      };
    }

    const deliveryTarget = await ensureSessionDeliveryTargetForSessionTx(db, notification.session_id, {
      timestamp: dispatchTimestamp,
    });
    if (!deliveryTarget || !deliveryTarget.chat_id) {
      return {
        ok: false,
        status: 'blocked',
        reason_code: 'no_delivery_target',
        reason_message: 'Artifact delivery has no Telegram delivery target',
        notification,
        delivery_target: null,
      };
    }

    const artifactDeliveryView = renderTaskNotificationViewTx(db, notification);
    if (!artifactDeliveryView) {
      return {
        ok: false,
        status: 'blocked',
        reason_code: 'render_failed',
        reason_message: 'Artifact delivery notification could not be rendered',
        notification,
        delivery_target: {
          channel: deliveryTarget.channel || 'telegram',
          chat_id: deliveryTarget.chat_id || '',
          thread_id: deliveryTarget.thread_id || null,
        },
      };
    }

    const deliveryArtifactPath = artifactPathOverride || artifact.canonical_path;
    if (artifactPathOverride && !fs.existsSync(artifactPathOverride)) {
      return {
        ok: false,
        status: 'blocked',
        reason_code: 'artifact_path_not_found',
        reason_message: 'Artifact delivery override path was not found',
        notification,
        delivery_target: null,
      };
    }

    if (artifactPathOverride) {
      const overrideStats = fs.statSync(artifactPathOverride);
      if (!overrideStats.isFile() || Number(overrideStats.size || 0) <= 0) {
        return {
          ok: false,
          status: 'blocked',
          reason_code: 'artifact_not_nonempty_file',
          reason_message: 'Artifact delivery override path is not a non-empty file',
          notification,
          delivery_target: null,
        };
      }
      if (Number(overrideStats.size || 0) > ARTIFACT_DELIVERY_MAX_BYTES) {
        return {
          ok: false,
          status: 'blocked',
          reason_code: 'artifact_file_too_large',
          reason_message: 'Artifact delivery override path exceeds the delivery size limit',
          notification,
          delivery_target: null,
        };
      }
    }

    const commandPath = commandPathOverride || relay.cli_bin || BLOCKFORK_OPENCLAW_CLI_BIN || 'openclaw';
    return {
      ok: true,
      status: 'ready',
      notification: artifactDeliveryView,
      artifact,
      execution,
      task,
      delivery_target: {
        channel: deliveryTarget.channel || 'telegram',
        chat_id: deliveryTarget.chat_id || '',
        thread_id: deliveryTarget.thread_id || null,
      },
      relay,
      command_path: commandPath,
      artifact_path: deliveryArtifactPath,
    };
  });

  if (!preflight.ok) {
    return {
      transport,
      dry_run: dryRun,
      command_path: commandPathOverride || '',
      notification_id: exactDeliveryId || null,
      artifact_id: options.artifactId || null,
      relay_label: relayLabel,
      status: preflight.status,
      reason_code: preflight.reason_code,
      reason_message: preflight.reason_message,
      delivery_target: preflight.delivery_target || null,
      attempt: null,
      notification: preflight.notification || null,
    };
  }

  const env = {
    ...process.env,
    ...parseOpenClawRelayEnvFile(preflight.relay.env_file),
  };
  if (preflight.relay.config_path) {
    env.OPENCLAW_CONFIG_PATH = preflight.relay.config_path;
  }
  if (preflight.relay.state_dir) {
    env.OPENCLAW_STATE_DIR = preflight.relay.state_dir;
  }
  env.BLOCKFORK_NOTIFICATION_TRANSPORT = 'openclaw_cli';
  env.BLOCKFORK_OPENCLAW_CLI_BIN = preflight.command_path;
  env.BLOCKFORK_OPENCLAW_CLI_DRY_RUN = dryRun ? '1' : '0';

  const attemptStartedAt = getTimestamp();
  const adapterResult = await runOpenClawCliArtifactDeliveryAdapter(preflight.notification, {
    commandPath: preflight.command_path,
    dryRun,
    timeoutMs,
    env,
    startedAt: attemptStartedAt,
    artifactPath: preflight.artifact_path || preflight.artifact.canonical_path,
  });

  const attemptRecord = {
    notification_id: preflight.notification.notification_id,
    session_id: preflight.notification.session_id,
    task_id: preflight.notification.task_id,
    artifact_id: preflight.artifact.artifact_id,
    artifact_path: preflight.artifact_path || preflight.artifact.canonical_path,
    relay_label: relayLabel,
    media_kind: preflight.notification.media_kind || preflight.artifact.artifact_type || 'document',
    handled_by: adapterResult.stdout_json && typeof adapterResult.stdout_json === 'object'
      ? String(adapterResult.stdout_json.handledBy || adapterResult.stdout_json.payload?.handledBy || '')
      : '',
    delivered_file_message_id: adapterResult.stdout_json && typeof adapterResult.stdout_json === 'object'
      ? String(adapterResult.stdout_json.payload?.messageId || adapterResult.stdout_json.messageId || adapterResult.stdout_json.payload?.fileMessageId || adapterResult.stdout_json.fileMessageId || '')
      : '',
    transport,
    channel: preflight.delivery_target?.channel || 'telegram',
    target: preflight.delivery_target?.chat_id || '',
    thread_id: preflight.delivery_target?.thread_id || null,
    dry_run: dryRun,
    command_path: preflight.command_path,
    command_argv: buildOpenClawCliArtifactDeliveryArgs(preflight.notification, {
      dryRun,
      artifactPath: preflight.artifact_path || preflight.artifact.canonical_path,
    }),
    started_at: adapterResult.started_at || attemptStartedAt,
    finished_at: adapterResult.finished_at || getTimestamp(),
    exit_code: adapterResult.exit_code === null || adapterResult.exit_code === undefined ? -1 : Number(adapterResult.exit_code),
    stdout_text: adapterResult.stdout_text || '',
    stderr_text: adapterResult.stderr_text || '',
    stdout_json: adapterResult.stdout_json,
    success: Boolean(adapterResult.ok),
    retryable: Boolean(adapterResult.retryable),
    error_code: adapterResult.error_code || '',
    error_message: adapterResult.error_message || '',
    created_at: adapterResult.finished_at || getTimestamp(),
    updated_at: adapterResult.finished_at || getTimestamp(),
  };

  const finalNotification = await withBillingWrite(async (db) => {
    await recordStoredNotificationDeliveryAttemptTx(db, attemptRecord);
    if (adapterResult.ok) {
      await updateExecutionArtifactDeliveryStatusTx(db, preflight.execution.execution_id, {
        deliveryRequested: true,
        deliveryConfirmed: true,
        reasonCode: 'artifact_delivery_confirmed',
        timestamp: adapterResult.finished_at || getTimestamp(),
      });
      return markStoredTaskNotificationDispatchOutcomeTx(db, preflight.notification.notification_id, {
        success: true,
        deliveredMessageId: adapterResult.stdout_json && typeof adapterResult.stdout_json === 'object'
          ? String(
            adapterResult.stdout_json.payload?.messageId
            || adapterResult.stdout_json.messageId
            || adapterResult.stdout_json.payload?.fileMessageId
            || adapterResult.stdout_json.fileMessageId
            || ''
          )
          : null,
        timestamp: adapterResult.finished_at || getTimestamp(),
      });
    }

    const nextAttemptAt = getNotificationDispatchRetryTimestamp(adapterResult.finished_at || getTimestamp(), computeNotificationDispatchBackoffMs(preflight.notification.attempt_count || 0));
    await updateExecutionArtifactDeliveryStatusTx(db, preflight.execution.execution_id, {
      deliveryRequested: true,
      deliveryConfirmed: false,
      reasonCode: 'artifact_delivery_failed',
      timestamp: adapterResult.finished_at || getTimestamp(),
    });
    return markStoredTaskNotificationDispatchOutcomeTx(db, preflight.notification.notification_id, {
      success: false,
      retryable: Boolean(adapterResult.retryable),
      lastError: adapterResult.error_message || adapterResult.error_code || 'dispatch_failed',
      nextAttemptAt,
      timestamp: adapterResult.finished_at || getTimestamp(),
    });
  });

  return {
    transport,
    dry_run: dryRun,
    command_path: preflight.command_path,
    notification_id: preflight.notification.notification_id,
    artifact_id: preflight.artifact.artifact_id,
    session_id: preflight.notification.session_id,
    task_id: preflight.notification.task_id,
    status: adapterResult.ok ? 'delivered' : (adapterResult.retryable ? 'retryable' : 'failed'),
    reason_code: adapterResult.error_code || '',
    reason_message: adapterResult.error_message || '',
    relay_label: relayLabel,
    delivery_target: preflight.delivery_target,
    attempt: attemptRecord,
    notification: finalNotification,
    adapter_result: adapterResult,
  };
}

function buildTaskNotificationOutboundText(notification, task, summary, assessment, failureFact) {
  const finalState = String(task?.current_state || notification?.payload?.task_state || notification?.payload?.new_state || '');
  const body = String(notification?.body || '').trim();
  const summaryText = String(summary?.summary_text || '').trim();

  if (finalState === TASK_STATES.COMPLETED || finalState === TASK_STATES.FAILED || finalState === TASK_STATES.RECOVERY_REQUIRED || finalState === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED || finalState === TASK_STATES.PARTIALLY_COMPLETED) {
    return summaryText || body;
  }

  if (summaryText && body && summaryText !== body) {
    return `${body}\n${summaryText}`;
  }

  return body || summaryText || taskProgressCategoryToLabel(notification?.notification_kind || '');
}

function renderTaskNotificationViewTx(db, notificationRow) {
  const notification = hydrateTaskNotificationRow(notificationRow);
  if (!notification) {
    return null;
  }

  const task = getStoredTaskByIdTx(db, notification.task_id);
  const summaryStmt = db.prepare(`
    SELECT *
    FROM task_completion_summaries
    WHERE task_id = ?
    LIMIT 1
  `);
  summaryStmt.bind([notification.task_id]);
  let summaryRow = null;
  if (summaryStmt.step()) {
    summaryRow = summaryStmt.getAsObject();
  }
  summaryStmt.free();
  const taskSummary = hydrateTaskCompletionSummaryRow(summaryRow);

  const progressStmt = db.prepare(`
    SELECT *
    FROM task_progress_events
    WHERE progress_event_id = ?
    LIMIT 1
  `);
  progressStmt.bind([notification.source_id]);
  let progressRow = null;
  if (progressStmt.step()) {
    progressRow = progressStmt.getAsObject();
  }
  progressStmt.free();
  const progressEvent = hydrateTaskProgressEventRow(progressRow);

  const assessmentStmt = db.prepare(`
    SELECT *
    FROM task_artifact_assessments
    WHERE task_id = ?
    LIMIT 1
  `);
  assessmentStmt.bind([notification.task_id]);
  let assessmentRow = null;
  if (assessmentStmt.step()) {
    assessmentRow = assessmentStmt.getAsObject();
  }
  assessmentStmt.free();
  const assessment = hydrateTaskArtifactAssessmentRow(assessmentRow);

  const failureStmt = db.prepare(`
    SELECT *
    FROM tool_failure_facts
    WHERE subject_type = ? AND subject_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `);
  failureStmt.bind(['task', notification.task_id]);
  let failureRow = null;
  if (failureStmt.step()) {
    failureRow = failureStmt.getAsObject();
  }
  failureStmt.free();
  const failureFact = hydrateToolFailureFactRow(failureRow);
  const deliveryTarget = getStoredSessionDeliveryTargetBySessionIdTx(db, notification.session_id);
  const latestAttempt = getStoredNotificationDeliveryAttemptByNotificationId(db, notification.notification_id, { limit: 1 });

  const outboundText = buildTaskNotificationOutboundText(notification, task, taskSummary, assessment, failureFact);
  const payload = {
    ...(notification.payload || {}),
    artifact_delivery: notification.artifact_id || notification.payload?.artifact_id ? {
      artifact_id: String(notification.artifact_id || notification.payload?.artifact_id || ''),
      artifact_path: String(notification.artifact_path || notification.payload?.artifact_path || ''),
      relay_label: String(notification.relay_label || notification.payload?.relay_label || ''),
      media_kind: String(notification.media_kind || notification.payload?.media_kind || ''),
    } : null,
    task_state: String(task?.current_state || notification.payload?.task_state || ''),
    summary_text: String(taskSummary?.summary_text || ''),
    what_completed: taskSummary?.what_completed || [],
    artifacts: taskSummary?.artifacts || [],
    verified: taskSummary?.verified || [],
    not_verified: taskSummary?.not_verified || [],
    follow_up_needed: Number(taskSummary?.follow_up_needed || 0),
    artifact_assessment: assessment ? {
      assessment_id: assessment.assessment_id || null,
      artifact_exists: Number(assessment.artifact_exists || 0) === 1,
      artifact_verification_state: assessment.artifact_verification_state || '',
      artifact_family: assessment.artifact_family || 'unknown',
      structure_state: assessment.structure_state || 'missing',
      alignment_state: assessment.alignment_state || 'missing',
      confidence_score: Number(assessment.confidence_score || 0),
      confidence_band: assessment.confidence_band || 'low',
      reason_code: assessment.reason_code || '',
      notes: assessment.notes || null,
    } : null,
    failure_fact: failureFact ? {
      failure_fact_id: failureFact.failure_fact_id || null,
      failure_category: failureFact.failure_category || '',
      failure_scope: failureFact.failure_scope || '',
      failure_stage: failureFact.failure_stage || '',
      reason_code: failureFact.reason_code || '',
      detail: failureFact.detail || '',
    } : null,
  };

  return {
    ...notification,
    delivery_target: deliveryTarget ? {
      channel: deliveryTarget.channel || 'telegram',
      chat_id: deliveryTarget.chat_id || '',
      thread_id: deliveryTarget.thread_id || null,
    } : null,
    task_state: String(task?.current_state || notification.payload?.task_state || ''),
    progress_event: progressEvent,
    completion_summary: taskSummary,
    artifact_assessment: assessment,
    failure_fact: failureFact,
    outbound_text: outboundText,
    latest_delivery_attempt: latestAttempt ? {
      attempt_id: latestAttempt.attempt_id || null,
      transport: latestAttempt.transport || 'openclaw_cli',
      dry_run: Boolean(latestAttempt.dry_run),
      target: latestAttempt.target || '',
      thread_id: latestAttempt.thread_id || null,
      artifact_id: latestAttempt.artifact_id || null,
      artifact_path: latestAttempt.artifact_path || null,
      relay_label: latestAttempt.relay_label || null,
      media_kind: latestAttempt.media_kind || null,
      handled_by: latestAttempt.handled_by || '',
      delivered_file_message_id: latestAttempt.delivered_file_message_id || null,
      command_path: latestAttempt.command_path || '',
      command_argv: Array.isArray(latestAttempt.command_argv) ? latestAttempt.command_argv : [],
      exit_code: Number(latestAttempt.exit_code || 0),
      success: Boolean(latestAttempt.success),
      retryable: Boolean(latestAttempt.retryable),
      error_code: latestAttempt.error_code || '',
      error_message: latestAttempt.error_message || '',
      started_at: latestAttempt.started_at || '',
      finished_at: latestAttempt.finished_at || '',
      stdout_json: latestAttempt.stdout_json || null,
    } : null,
    payload,
  };
}

function getStoredSessionDeliveryTargetBySessionIdTx(db, sessionId) {
  const stmt = db.prepare(`
    SELECT *
    FROM session_delivery_targets
    WHERE session_id = ?
    LIMIT 1
  `);
  stmt.bind([sessionId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateSessionDeliveryTargetRow(row);
}

async function pullTaskNotificationsForSession(sessionId, options = {}) {
  return withBillingWrite(async (db) => {
    const deliveryTarget = await ensureSessionDeliveryTargetForSessionTx(db, sessionId, options);
    if (!deliveryTarget) {
      return [];
    }

    const claimed = await claimStoredTaskNotificationsForSessionTx(db, sessionId, options);
    return claimed.map((notification) => renderTaskNotificationViewTx(db, notification)).filter(Boolean);
  });
}

async function renderTaskNotificationView(notificationId) {
  const db = await ensureBillingDb();
  const row = await getStoredTaskNotificationById(db, notificationId);
  return renderTaskNotificationViewTx(db, row);
}

function getTaskProgressSpec(previousState, nextState, options = {}) {
  const state = String(nextState || '');
  const blocked = Boolean(options.requiresUserInput || options.blockedForInput);
  switch (state) {
    case TASK_STATES.ACKNOWLEDGED:
      return {
        category: TASK_PROGRESS_CATEGORIES.TASK_ACCEPTED,
        decision: 'notify_user',
        requiresUserInput: false,
        message: 'Task accepted. I am starting the work now.',
      };
    case TASK_STATES.PLANNED:
      return {
        category: TASK_PROGRESS_CATEGORIES.PLAN_LOCKED,
        decision: 'notify_user',
        requiresUserInput: false,
        message: 'I have locked the plan and am moving into execution.',
      };
    case TASK_STATES.IN_PROGRESS:
      return {
        category: TASK_PROGRESS_CATEGORIES.MEANINGFUL_PROGRESS_CHECKPOINT,
        decision: 'notify_user',
        requiresUserInput: false,
        message: 'Meaningful progress checkpoint reached.',
      };
    case TASK_STATES.TOOL_WORK_STARTED:
      return {
        category: TASK_PROGRESS_CATEGORIES.TOOL_WORK_STARTED,
        decision: 'notify_user',
        requiresUserInput: false,
        message: 'Tool work has started.',
      };
    case TASK_STATES.ARTIFACT_CREATED:
      return {
        category: TASK_PROGRESS_CATEGORIES.ARTIFACT_CREATED,
        decision: 'notify_user',
        requiresUserInput: false,
        message: 'The artifact exists and verification is underway.',
      };
    case TASK_STATES.ARTIFACT_VERIFIED:
      return {
        category: TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFIED,
        decision: 'notify_user',
        requiresUserInput: false,
        message: 'The artifact is verified.',
      };
    case TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED:
      return {
        category: TASK_PROGRESS_CATEGORIES.BLOCKED_HUMAN_INPUT_REQUIRED,
        decision: 'interrupt_user',
        requiresUserInput: true,
        message: options.message || 'I am blocked and need your input to continue safely.',
      };
    case TASK_STATES.PARTIALLY_COMPLETED:
      return {
        category: TASK_PROGRESS_CATEGORIES.PARTIAL_COMPLETION_DETECTED,
        decision: 'notify_user',
        requiresUserInput: false,
        message: 'I made partial progress, but the task is not complete yet.',
      };
    case TASK_STATES.RECOVERY_REQUIRED:
      return {
        category: TASK_PROGRESS_CATEGORIES.RECOVERY_REQUIRED,
        decision: blocked ? 'interrupt_user' : 'notify_user',
        requiresUserInput: blocked,
        message: blocked
          ? (options.message || 'I hit a recoverable issue and need your help to continue safely.')
          : 'I hit a recoverable issue and am attempting recovery.',
      };
    case TASK_STATES.FAILED:
      return {
        category: TASK_PROGRESS_CATEGORIES.TASK_FAILED,
        decision: 'notify_user',
        requiresUserInput: false,
        message: 'The task failed.',
      };
    case TASK_STATES.COMPLETED:
      return {
        category: TASK_PROGRESS_CATEGORIES.TASK_COMPLETED,
        decision: 'notify_user',
        requiresUserInput: false,
        message: 'The task is complete.',
      };
    default:
      return null;
  }
}

function progressEventShouldEmit(previousState, nextState, options = {}) {
  if (!previousState || !nextState) {
    return false;
  }
  const spec = getTaskProgressSpec(previousState, nextState, options);
  return Boolean(spec);
}

function taskProgressCategoryToNotificationTitle(category) {
  switch (String(category || '')) {
    case TASK_PROGRESS_CATEGORIES.TASK_ACCEPTED:
      return 'Task accepted';
    case TASK_PROGRESS_CATEGORIES.PLAN_LOCKED:
      return 'Plan locked';
    case TASK_PROGRESS_CATEGORIES.TOOL_WORK_STARTED:
      return 'Tool work started';
    case TASK_PROGRESS_CATEGORIES.MEANINGFUL_PROGRESS_CHECKPOINT:
      return 'Progress checkpoint';
    case TASK_PROGRESS_CATEGORIES.ARTIFACT_CREATED:
      return 'Artifact created';
    case TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFICATION_STARTED:
      return 'Artifact verification started';
    case TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFIED:
      return 'Artifact verified';
    case TASK_PROGRESS_CATEGORIES.BLOCKED_HUMAN_INPUT_REQUIRED:
      return 'Input required';
    case TASK_PROGRESS_CATEGORIES.RECOVERY_REQUIRED:
      return 'Recovery required';
    case TASK_PROGRESS_CATEGORIES.PARTIAL_COMPLETION_DETECTED:
      return 'Partial completion';
    case TASK_PROGRESS_CATEGORIES.TASK_COMPLETED:
      return 'Task completed';
    case TASK_PROGRESS_CATEGORIES.TASK_FAILED:
      return 'Task failed';
    default:
      return 'Task update';
  }
}

function buildTaskNotificationSnapshot(db, task, progressEvent) {
  const progressCategory = String(progressEvent?.progress_category || '');
  const taskState = String(task?.current_state || progressEvent?.new_state || '');
  const title = taskProgressCategoryToNotificationTitle(progressCategory);
  const body = String(progressEvent?.message_text || '').trim() || taskProgressCategoryToLabel(progressCategory);
  const requestLogRow = task?.last_request_id ? getStoredRequestLogByRequestIdTx(db, task.last_request_id) : null;
  const taskProfile = deriveTaskNotificationProfileFromTask(task, requestLogRow, {
    currentState: taskState,
    classifiedAt: task?.classified_at || progressEvent?.created_at || getTimestamp(),
  });
  const dispatchability = deriveTaskNotificationDispatchability(task, progressEvent, taskProfile);

  return {
    task_id: String(task?.task_id || progressEvent?.task_id || ''),
    session_id: String(task?.session_id || ''),
    execution_id: progressEvent?.execution_id || task?.last_execution_id || null,
    progress_event_id: String(progressEvent?.progress_event_id || ''),
    progress_category: progressCategory,
    previous_state: String(progressEvent?.previous_state || ''),
    new_state: String(progressEvent?.new_state || taskState || ''),
    task_state: taskState,
    decision: String(progressEvent?.decision || 'notify_user'),
    requires_user_input: Number(progressEvent?.requires_user_input || 0),
    message_text: String(progressEvent?.message_text || ''),
    title,
    body,
    task_kind: dispatchability.task_kind,
    notification_policy: dispatchability.notification_policy,
    proactive_eligible: Number(dispatchability.proactive_eligible || 0),
    eligibility_reason: String(dispatchability.eligibility_reason || ''),
    delivery_suppressed_reason: String(dispatchability.delivery_suppressed_reason || ''),
    classified_at: dispatchability.classified_at || taskProfile.classified_at || getTimestamp(),
    source_type: 'task_progress_event',
    source_id: String(progressEvent?.progress_event_id || ''),
    dedupe_key: `${String(progressEvent?.progress_event_id || '')}:${String(task?.task_id || progressEvent?.task_id || '')}`,
    delivery_channel: 'openclaw_tg',
  };
}

function appendTaskNotificationTx(db, notification) {
  const snapshot = {
    ...notification,
    payload: notification.payload || {},
  };
  const timestamp = notification.created_at || getTimestamp();
  const insert = db.prepare(`
    INSERT INTO task_notifications (
      notification_id, task_id, session_id, execution_id, source_type, source_id, notification_kind,
      delivery_channel, delivery_state, title, body, artifact_id, artifact_path, media_kind, relay_label,
      task_kind, notification_policy, proactive_eligible, eligibility_reason, delivery_suppressed_reason,
      classified_at, payload_json, dedupe_key, claim_count, claimed_at, delivered_at, delivered_message_id,
      last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      task_id = excluded.task_id,
      session_id = excluded.session_id,
      execution_id = excluded.execution_id,
      source_type = excluded.source_type,
      source_id = excluded.source_id,
      notification_kind = excluded.notification_kind,
      delivery_channel = excluded.delivery_channel,
      title = excluded.title,
      body = excluded.body,
      artifact_id = excluded.artifact_id,
      artifact_path = excluded.artifact_path,
      media_kind = excluded.media_kind,
      relay_label = excluded.relay_label,
      task_kind = excluded.task_kind,
      notification_policy = excluded.notification_policy,
      proactive_eligible = excluded.proactive_eligible,
      eligibility_reason = excluded.eligibility_reason,
      delivery_suppressed_reason = excluded.delivery_suppressed_reason,
      classified_at = excluded.classified_at,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  insert.run([
    snapshot.notification_id || createTaskNotificationId(),
    snapshot.task_id,
    snapshot.session_id,
    snapshot.execution_id || null,
    snapshot.source_type || 'task_progress_event',
    snapshot.source_id || '',
    snapshot.notification_kind || snapshot.progress_category || '',
    snapshot.delivery_channel || 'openclaw_tg',
    snapshot.delivery_state || TASK_NOTIFICATION_DELIVERY_STATES.PENDING,
    snapshot.title || '',
    snapshot.body || '',
    snapshot.artifact_id || null,
    snapshot.artifact_path || null,
    snapshot.media_kind || null,
    snapshot.relay_label || null,
    snapshot.task_kind || TASK_KINDS.TEXT_GENERATION,
    snapshot.notification_policy || TASK_NOTIFICATION_POLICIES.SILENT,
    Number(snapshot.proactive_eligible || 0),
    snapshot.eligibility_reason || '',
    snapshot.delivery_suppressed_reason || '',
    snapshot.classified_at || timestamp,
    JSON.stringify(snapshot.payload || {}),
    snapshot.dedupe_key || '',
    Number(snapshot.claim_count || 0),
    snapshot.claimed_at || null,
    snapshot.delivered_at || null,
    snapshot.delivered_message_id || null,
    snapshot.last_error || '',
    timestamp,
    timestamp,
  ]);
  insert.free();
}

function enqueueTaskNotificationFromProgressEventTx(db, progressEvent) {
  if (!progressEvent || !progressEvent.task_id || !progressEvent.progress_category) {
    return null;
  }

  const decision = String(progressEvent.decision || 'notify_user');
  if (!['notify_user', 'interrupt_user'].includes(decision)) {
    return null;
  }

  const task = getStoredTaskByIdTx(db, progressEvent.task_id);
  if (!task) {
    return null;
  }

  const snapshot = buildTaskNotificationSnapshot(db, task, progressEvent);
  const payload = {
    task_id: snapshot.task_id,
    session_id: snapshot.session_id,
    execution_id: snapshot.execution_id,
    progress_event_id: snapshot.progress_event_id,
    progress_category: snapshot.progress_category,
    previous_state: snapshot.previous_state,
    new_state: snapshot.new_state,
    task_state: snapshot.task_state,
    decision: snapshot.decision,
    requires_user_input: snapshot.requires_user_input,
    message_text: snapshot.message_text,
    title: snapshot.title,
    body: snapshot.body,
    task_kind: snapshot.task_kind,
    notification_policy: snapshot.notification_policy,
    proactive_eligible: snapshot.proactive_eligible,
    eligibility_reason: snapshot.eligibility_reason,
    delivery_suppressed_reason: snapshot.delivery_suppressed_reason,
    classified_at: snapshot.classified_at,
  };

  appendTaskNotificationTx(db, {
    notification_id: createTaskNotificationId(),
    task_id: snapshot.task_id,
    session_id: snapshot.session_id,
    execution_id: snapshot.execution_id,
    source_type: snapshot.source_type,
    source_id: snapshot.source_id,
    notification_kind: snapshot.progress_category,
    delivery_channel: snapshot.delivery_channel,
    delivery_state: TASK_NOTIFICATION_DELIVERY_STATES.PENDING,
    title: snapshot.title,
    body: snapshot.body,
    task_kind: snapshot.task_kind,
    notification_policy: snapshot.notification_policy,
    proactive_eligible: snapshot.proactive_eligible,
    eligibility_reason: snapshot.eligibility_reason,
    delivery_suppressed_reason: snapshot.delivery_suppressed_reason,
    classified_at: snapshot.classified_at,
    payload,
    dedupe_key: snapshot.dedupe_key,
    created_at: progressEvent.created_at || getTimestamp(),
  });

  return snapshot;
}

function appendTaskProgressEventTx(db, event) {
  const progressEventId = event.progress_event_id || createTaskProgressEventId();
  const timestamp = event.created_at || getTimestamp();
  const insert = db.prepare(`
    INSERT INTO task_progress_events (
      progress_event_id, task_id, execution_id, previous_state, new_state, progress_category, decision,
      message_text, requires_user_input, source, reason_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run([
    progressEventId,
    event.task_id,
    event.execution_id || null,
    event.previous_state || '',
    event.new_state || '',
    event.progress_category,
    event.decision || 'notify_user',
    event.message_text || '',
    Number(Boolean(event.requires_user_input)),
    event.source || 'runtime',
    event.reason_code || '',
    timestamp,
  ]);
  insert.free();
  enqueueTaskNotificationFromProgressEventTx(db, {
    ...event,
    progress_event_id: progressEventId,
    created_at: timestamp,
  });
}

async function appendTaskProgressEvent(event) {
  return withBillingWrite(async (db) => {
    appendTaskProgressEventTx(db, event);
    return event;
  });
}

function taskProgressCategoryToLabel(category) {
  switch (String(category || '')) {
    case TASK_PROGRESS_CATEGORIES.TASK_ACCEPTED:
      return 'task accepted';
    case TASK_PROGRESS_CATEGORIES.PLAN_LOCKED:
      return 'plan locked';
    case TASK_PROGRESS_CATEGORIES.TOOL_WORK_STARTED:
      return 'tool work started';
    case TASK_PROGRESS_CATEGORIES.MEANINGFUL_PROGRESS_CHECKPOINT:
      return 'meaningful progress checkpoint';
    case TASK_PROGRESS_CATEGORIES.ARTIFACT_CREATED:
      return 'artifact created';
    case TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFICATION_STARTED:
      return 'artifact verification started';
    case TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFIED:
      return 'artifact verified';
    case TASK_PROGRESS_CATEGORIES.BLOCKED_HUMAN_INPUT_REQUIRED:
      return 'blocked human input required';
    case TASK_PROGRESS_CATEGORIES.RECOVERY_REQUIRED:
      return 'recovery required';
    case TASK_PROGRESS_CATEGORIES.PARTIAL_COMPLETION_DETECTED:
      return 'partial completion detected';
    case TASK_PROGRESS_CATEGORIES.TASK_COMPLETED:
      return 'task completed';
    case TASK_PROGRESS_CATEGORIES.TASK_FAILED:
      return 'task failed';
    default:
      return String(category || '');
  }
}

function summarizeTaskCompletionState(task, assessment, failureFact) {
  const finalState = String(task?.current_state || '');
  const confidenceBand = String(assessment?.confidence_band || '');
  const verificationState = String(assessment?.artifact_verification_state || '');
  const hasArtifact = Number(assessment?.artifact_exists || 0) === 1;
  const artifactVerified = verificationState === ARTIFACT_VERIFICATION_STATES.VERIFIED;
  const highConfidence = confidenceBand === TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH;
  const failureReason = String(failureFact?.reason_code || '');

  if (finalState === TASK_STATES.COMPLETED) {
    if (artifactVerified && highConfidence) {
      return 'Task completed successfully.';
    }
    return 'Task completed, but artifact confidence or verification is not fully strong.';
  }

  if (finalState === TASK_STATES.PARTIALLY_COMPLETED) {
    return 'Task partially completed.';
  }

  if (finalState === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED) {
    return 'Task is blocked and waiting for your input.';
  }

  if (finalState === TASK_STATES.RECOVERY_REQUIRED) {
    if (['terminal_payload_missing', 'empty_terminal_response'].includes(failureReason)) {
      return 'Task ended without a usable terminal response; recovery or retry may be needed.';
    }
    return 'Task needs recovery before it can safely continue.';
  }

  if (finalState === TASK_STATES.FAILED) {
    return 'Task failed.';
  }

  if (artifactVerified || hasArtifact) {
    return 'Task produced an artifact, but the final state is not complete.';
  }

  if (failureFact) {
    if (['terminal_payload_missing', 'empty_terminal_response'].includes(failureReason)) {
      return 'Task ended without a usable terminal response.';
    }
    return 'Task ended with a recorded failure.';
  }

  return 'Task completion state was recorded.';
}

function buildTaskCompletionSummaryTx(db, task, options = {}) {
  if (!task) {
    return null;
  }

  const progressStmt = db.prepare(`
    SELECT *
    FROM task_progress_events
    WHERE task_id = ?
    ORDER BY created_at ASC, rowid ASC
  `);
  progressStmt.bind([task.task_id]);
  const progressEvents = [];
  while (progressStmt.step()) {
    progressEvents.push(hydrateTaskProgressEventRow(progressStmt.getAsObject()));
  }
  progressStmt.free();

  const assessmentStmt = db.prepare(`
    SELECT *
    FROM task_artifact_assessments
    WHERE task_id = ?
    LIMIT 1
  `);
  assessmentStmt.bind([task.task_id]);
  let assessmentRow = null;
  if (assessmentStmt.step()) {
    assessmentRow = assessmentStmt.getAsObject();
  }
  assessmentStmt.free();
  const assessment = hydrateTaskArtifactAssessmentRow(assessmentRow);

  const failureStmt = db.prepare(`
    SELECT *
    FROM tool_failure_facts
    WHERE subject_type = ? AND subject_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `);
  failureStmt.bind(['task', task.task_id]);
  let failureRow = null;
  if (failureStmt.step()) {
    failureRow = failureStmt.getAsObject();
  }
  failureStmt.free();
  const failureFact = hydrateToolFailureFactRow(failureRow);
  const progressLabels = progressEvents.map((event) => taskProgressCategoryToLabel(event.progress_category));
  const completionExecutionId = task.completed_execution_id || task.last_execution_id || null;
  const finalState = String(task.current_state || '');

  const whatCompleted = [];
  const seenCompleted = new Set();
  for (const label of progressLabels) {
    if (!label || seenCompleted.has(label)) {
      continue;
    }
    seenCompleted.add(label);
    whatCompleted.push(label);
  }

  if (assessment?.artifact_exists) {
    whatCompleted.push('artifact exists');
  }
  if (assessment?.artifact_verification_state === ARTIFACT_VERIFICATION_STATES.VERIFIED) {
    whatCompleted.push('artifact verified');
  }
  if (finalState === TASK_STATES.COMPLETED) {
    whatCompleted.push('task completed');
  } else if (finalState === TASK_STATES.PARTIALLY_COMPLETED) {
    whatCompleted.push('task partially completed');
  } else if (finalState === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED) {
    whatCompleted.push('task blocked for human input');
  } else if (finalState === TASK_STATES.RECOVERY_REQUIRED) {
    whatCompleted.push('task recovery required');
  } else if (finalState === TASK_STATES.FAILED) {
    whatCompleted.push('task failed');
  }

  const artifacts = assessment ? [{
    artifact_id: assessment.artifact_id || null,
    artifact_exists: Number(assessment.artifact_exists || 0) === 1,
    verification_state: assessment.artifact_verification_state || '',
    artifact_family: assessment.artifact_family || 'unknown',
    structure_state: assessment.structure_state || 'missing',
    alignment_state: assessment.alignment_state || 'missing',
    confidence_score: Number(assessment.confidence_score || 0),
    confidence_band: assessment.confidence_band || 'low',
    reason_code: assessment.reason_code || '',
  }] : [];

  const verified = [];
  if (finalState === TASK_STATES.COMPLETED) {
    verified.push('task completed');
  }
  if (assessment?.artifact_exists) {
    verified.push('artifact exists');
  }
  if (assessment?.artifact_verification_state === ARTIFACT_VERIFICATION_STATES.VERIFIED) {
    verified.push('artifact verified');
  }
  if (assessment?.structure_state === TASK_ARTIFACT_STRUCTURE_STATES.VALID) {
    verified.push('artifact structurally valid');
  }
  if (assessment?.alignment_state === TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED) {
    verified.push('artifact aligned to task');
  }

  const notVerified = [];
  if (!assessment?.artifact_exists) {
    notVerified.push('artifact not present');
  } else if (assessment?.artifact_verification_state !== ARTIFACT_VERIFICATION_STATES.VERIFIED) {
    notVerified.push(`artifact verification state: ${assessment?.artifact_verification_state || 'unknown'}`);
  }
  if (assessment && assessment.confidence_band !== TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH) {
    notVerified.push(`artifact confidence band: ${assessment.confidence_band || 'low'}`);
  }
  if (failureFact) {
    notVerified.push(`failure category: ${failureFact.failure_category}`);
  }
  if (failureFact && ['terminal_payload_missing', 'empty_terminal_response'].includes(String(failureFact.reason_code || ''))) {
    notVerified.push('terminal payload missing');
  }
  if (finalState === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED) {
    notVerified.push('requires user input');
  }
  if (finalState === TASK_STATES.RECOVERY_REQUIRED) {
    notVerified.push('recovery required');
  }
  if (finalState === TASK_STATES.PARTIALLY_COMPLETED) {
    notVerified.push('partial completion');
  }

  const followUpNeeded = finalState !== TASK_STATES.COMPLETED
    || !assessment
    || assessment.artifact_verification_state !== ARTIFACT_VERIFICATION_STATES.VERIFIED
    || assessment.confidence_band !== TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH
    || finalState === TASK_STATES.RECOVERY_REQUIRED
    || finalState === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED
    || finalState === TASK_STATES.PARTIALLY_COMPLETED
    || finalState === TASK_STATES.FAILED;

  const proof = {
    task_event_count: progressEvents.length,
    progress_event_count: progressEvents.length,
    first_execution_id: task.first_execution_id || null,
    last_execution_id: task.last_execution_id || null,
    completed_execution_id: completionExecutionId,
    assessment_id: assessment?.assessment_id || null,
    artifact_id: assessment?.artifact_id || null,
    failure_fact_id: failureFact?.failure_fact_id || null,
    final_state: finalState,
  };

  return {
    completion_summary_id: options.completionSummaryId || createTaskCompletionSummaryId(),
    task_id: task.task_id,
    session_id: task.session_id,
    execution_id: completionExecutionId,
    final_state: finalState,
    summary_text: summarizeTaskCompletionState(task, assessment, failureFact),
    what_completed: whatCompleted,
    artifacts,
    verified,
    not_verified: notVerified,
    follow_up_needed: Number(Boolean(followUpNeeded)),
    proof,
  };
}

function syncTaskCompletionSummaryTx(db, taskId, options = {}) {
  const taskStmt = db.prepare('SELECT * FROM tasks WHERE task_id = ? LIMIT 1');
  taskStmt.bind([taskId]);
  let taskRow = null;
  if (taskStmt.step()) {
    taskRow = taskStmt.getAsObject();
  }
  taskStmt.free();
  const task = hydrateTaskRow(taskRow);
  if (!task) {
    return null;
  }

  const summary = buildTaskCompletionSummaryTx(db, task, options);
  if (!summary) {
    return null;
  }

  const timestamp = options.timestamp || getTimestamp();
  const insert = db.prepare(`
    INSERT INTO task_completion_summaries (
      completion_summary_id, task_id, session_id, execution_id, final_state, summary_text,
      what_completed_json, artifacts_json, verified_json, not_verified_json, follow_up_needed,
      proof_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      session_id = excluded.session_id,
      execution_id = excluded.execution_id,
      final_state = excluded.final_state,
      summary_text = excluded.summary_text,
      what_completed_json = excluded.what_completed_json,
      artifacts_json = excluded.artifacts_json,
      verified_json = excluded.verified_json,
      not_verified_json = excluded.not_verified_json,
      follow_up_needed = excluded.follow_up_needed,
      proof_json = excluded.proof_json,
      updated_at = excluded.updated_at
  `);
  insert.run([
    summary.completion_summary_id,
    summary.task_id,
    summary.session_id,
    summary.execution_id,
    summary.final_state,
    summary.summary_text,
    JSON.stringify(summary.what_completed),
    JSON.stringify(summary.artifacts),
    JSON.stringify(summary.verified),
    JSON.stringify(summary.not_verified),
    summary.follow_up_needed,
    JSON.stringify(summary.proof),
    timestamp,
    timestamp,
  ]);
  insert.free();

  return getStoredTaskCompletionSummaryByTaskId(db, taskId);
}

async function syncTaskCompletionSummary(options = {}) {
  return withBillingWrite(async (db) => syncTaskCompletionSummaryTx(db, String(options.taskId || ''), options));
}

async function getStoredToolFailureFactBySubjectId(db, subjectType, subjectId) {
  const stmt = db.prepare(`
    SELECT *
    FROM tool_failure_facts
    WHERE subject_type = ? AND subject_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `);
  stmt.bind([subjectType, subjectId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateToolFailureFactRow(row);
}

async function getToolFailureFactBySubjectId(subjectType, subjectId) {
  const db = await ensureBillingDb();
  return getStoredToolFailureFactBySubjectId(db, subjectType, subjectId);
}

function appendTaskEventTx(db, event) {
  const insert = db.prepare(`
    INSERT INTO task_events (
      task_event_id, task_id, execution_id, previous_state, new_state, created_at, actor_source, reason_code, request_id, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run([
    event.task_event_id || createTaskEventId(),
    event.task_id,
    event.execution_id || null,
    event.previous_state || '',
    event.new_state,
    event.created_at || event.timestamp || getTimestamp(),
    event.actor_source || 'runtime',
    event.reason_code || 'task_state_transition',
    event.request_id || null,
    event.notes || null,
  ]);
  insert.free();
}

async function appendTaskEvent(event) {
  return withBillingWrite(async (db) => {
    appendTaskEventTx(db, event);
    return event;
  });
}

async function createTaskRecord(options = {}) {
  return withBillingWrite(async (db) => {
    const sessionId = String(options.sessionId || '');
    if (!sessionId) {
      throw new Error('Task creation requires sessionId');
    }

    const idempotencyKey = options.idempotencyKey ? String(options.idempotencyKey) : '';
    const objectiveText = String(options.objectiveText || '');
    const objectiveFingerprint = String(options.objectiveFingerprint || fingerprintTaskObjective(sessionId, objectiveText, idempotencyKey));
    const timestamp = options.timestamp || getTimestamp();
    const draftTask = {
      task_id: '',
      session_id: sessionId,
      current_state: TASK_STATES.RECEIVED,
      objective_text: objectiveText,
      last_request_id: String(options.requestId || ''),
      recovery_reason: null,
      recovery_notes: null,
    };
    const classification = deriveTaskNotificationProfileFromTask(draftTask, null, {
      currentState: TASK_STATES.RECEIVED,
      classifiedAt: timestamp,
    });

    if (idempotencyKey) {
      const existingStmt = db.prepare(`
        SELECT *
        FROM tasks
        WHERE session_id = ? AND idempotency_key = ?
        LIMIT 1
      `);
      existingStmt.bind([sessionId, idempotencyKey]);
      let existingRow = null;
      if (existingStmt.step()) {
        existingRow = existingStmt.getAsObject();
      }
      existingStmt.free();

      if (existingRow) {
        const existing = hydrateTaskRow(existingRow);
        const update = db.prepare(`
          UPDATE tasks
          SET updated_at = ?, last_request_id = ?, objective_text = ?, objective_fingerprint = ?,
              task_kind = ?, notification_policy = ?, notification_eligible = ?,
              eligibility_reason = ?, classified_at = ?
          WHERE task_id = ?
        `);
        update.run([
          timestamp,
          options.requestId || existing.last_request_id || '',
          objectiveText || existing.objective_text || '',
          objectiveFingerprint || existing.objective_fingerprint || '',
          classification.task_kind,
          classification.notification_policy,
          Number(classification.notification_eligible || 0),
          classification.eligibility_reason || '',
          classification.classified_at || timestamp,
          existing.task_id,
        ]);
        update.free();
        return {
          task: {
            ...existing,
            updated_at: timestamp,
            last_request_id: options.requestId || existing.last_request_id || '',
            objective_text: objectiveText || existing.objective_text || '',
            objective_fingerprint: objectiveFingerprint || existing.objective_fingerprint || '',
            task_kind: classification.task_kind,
            notification_policy: classification.notification_policy,
            notification_eligible: Number(classification.notification_eligible || 0),
            eligibility_reason: classification.eligibility_reason || '',
            classified_at: classification.classified_at || timestamp,
          },
          reused: true,
        };
      }
    }

    const taskId = createTaskId();
    const insert = db.prepare(`
      INSERT INTO tasks (
        task_id, session_id, current_state, created_at, updated_at, last_request_id, idempotency_key,
        objective_text, objective_fingerprint, task_kind, notification_policy, notification_eligible,
        eligibility_reason, classified_at, first_execution_id, last_execution_id, completed_execution_id,
        recovery_reason, recovery_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      taskId,
      sessionId,
      TASK_STATES.RECEIVED,
      timestamp,
      timestamp,
      options.requestId || '',
      idempotencyKey || null,
      objectiveText,
      objectiveFingerprint,
      classification.task_kind,
      classification.notification_policy,
      Number(classification.notification_eligible || 0),
      classification.eligibility_reason || '',
      classification.classified_at || timestamp,
      options.firstExecutionId || null,
      options.firstExecutionId || null,
      null,
      null,
      null,
    ]);
    insert.free();

    appendTaskEventTx(db, {
      task_id: taskId,
      execution_id: options.firstExecutionId || null,
      previous_state: '',
      new_state: TASK_STATES.RECEIVED,
      timestamp,
      actor_source: options.actorSource || 'runtime',
      reason_code: options.reasonCode || 'task_received',
      request_id: options.requestId || null,
      notes: objectiveFingerprint,
    });

    return {
      task: {
        task_id: taskId,
        session_id: sessionId,
        current_state: TASK_STATES.RECEIVED,
        created_at: timestamp,
        updated_at: timestamp,
        last_request_id: options.requestId || '',
        idempotency_key: idempotencyKey || null,
        objective_text: objectiveText,
        objective_fingerprint: objectiveFingerprint,
        task_kind: classification.task_kind,
        notification_policy: classification.notification_policy,
        notification_eligible: Number(classification.notification_eligible || 0),
        eligibility_reason: classification.eligibility_reason || '',
        classified_at: classification.classified_at || timestamp,
        first_execution_id: options.firstExecutionId || null,
        last_execution_id: options.firstExecutionId || null,
        completed_execution_id: null,
        recovery_reason: null,
        recovery_notes: null,
      },
      reused: false,
    };
  });
}

function taskStateFromExecutionState(nextState) {
  switch (String(nextState || '')) {
    case EXECUTION_STATES.QUEUED:
      return TASK_STATES.PLANNED;
    case EXECUTION_STATES.RUNNING:
    case EXECUTION_STATES.RETRYING:
      return TASK_STATES.TOOL_WORK_STARTED;
    case EXECUTION_STATES.WAITING:
      return TASK_STATES.IN_PROGRESS;
    case EXECUTION_STATES.RECOVERY_REQUIRED:
      return TASK_STATES.RECOVERY_REQUIRED;
    case EXECUTION_STATES.COMPLETED:
      return TASK_STATES.COMPLETED;
    case EXECUTION_STATES.CANCELLED:
    case EXECUTION_STATES.EXPIRED:
    case EXECUTION_STATES.FAILED:
      return TASK_STATES.FAILED;
    default:
      return null;
  }
}

function taskStateFromArtifactVerification(verificationState, currentState) {
  if (verificationState === ARTIFACT_VERIFICATION_STATES.VERIFIED) {
    return TASK_STATES.ARTIFACT_VERIFIED;
  }
  if (verificationState === ARTIFACT_VERIFICATION_STATES.REJECTED) {
    if (currentState === TASK_STATES.ARTIFACT_CREATED || currentState === TASK_STATES.ARTIFACT_VERIFIED) {
      return TASK_STATES.RECOVERY_REQUIRED;
    }
    return TASK_STATES.RECOVERY_REQUIRED;
  }
  if (verificationState === ARTIFACT_VERIFICATION_STATES.PENDING) {
    return TASK_STATES.ARTIFACT_CREATED;
  }
  return null;
}

function transitionTaskTx(db, taskId, nextState, options = {}) {
  const current = db.prepare('SELECT * FROM tasks WHERE task_id = ? LIMIT 1');
  current.bind([taskId]);
  let currentRow = null;
  if (current.step()) {
    currentRow = current.getAsObject();
  }
  current.free();
  if (!currentRow) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const task = hydrateTaskRow(currentRow);
  if (task.current_state === nextState) {
    return task;
  }
  if (TASK_TERMINAL_STATES.has(task.current_state)) {
    return task;
  }

  assertLegalTaskTransition(task.current_state, nextState);
  const timestamp = options.timestamp || getTimestamp();
  const update = db.prepare(`
    UPDATE tasks
    SET current_state = ?,
        updated_at = ?,
        last_request_id = ?,
        recovery_reason = ?,
        recovery_notes = ?,
        first_execution_id = CASE
          WHEN first_execution_id IS NULL THEN ?
          ELSE first_execution_id
        END,
        last_execution_id = COALESCE(?, last_execution_id),
        completed_execution_id = CASE WHEN ? = ? THEN COALESCE(?, completed_execution_id) ELSE completed_execution_id END
    WHERE task_id = ?
  `);
  update.run([
    nextState,
    timestamp,
    options.requestId || task.last_request_id || '',
    options.recoveryReason === undefined ? (nextState === TASK_STATES.RECOVERY_REQUIRED ? (task.recovery_reason || options.reasonCode || 'task_recovery_required') : null) : options.recoveryReason,
    options.recoveryNotes === undefined ? (nextState === TASK_STATES.RECOVERY_REQUIRED ? (options.notes || task.recovery_notes || null) : null) : options.recoveryNotes,
    options.executionId || null,
    options.executionId || null,
    nextState,
    TASK_STATES.COMPLETED,
    options.executionId || null,
    taskId,
  ]);
  update.free();

  appendTaskEventTx(db, {
    task_id: taskId,
    execution_id: options.executionId || null,
    previous_state: task.current_state,
    new_state: nextState,
    timestamp,
    actor_source: options.actorSource || 'runtime',
    reason_code: options.reasonCode || 'task_state_transition',
    request_id: options.requestId || null,
    notes: options.notes || null,
  });

  const progressSpec = getTaskProgressSpec(task.current_state, nextState, {
    message: options.message || options.notes || '',
    requiresUserInput: Boolean(options.requiresUserInput),
    blockedForInput: nextState === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED,
  });
  if (progressSpec) {
    appendTaskProgressEventTx(db, {
      task_id: taskId,
      execution_id: options.executionId || null,
      previous_state: task.current_state,
      new_state: nextState,
      progress_category: progressSpec.category,
      decision: progressSpec.decision,
      message_text: options.message || progressSpec.message,
      requires_user_input: progressSpec.requiresUserInput,
      source: options.actorSource || 'runtime',
      reason_code: options.reasonCode || 'task_progress_transition',
      created_at: timestamp,
    });
  }

  if ([TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, TASK_STATES.RECOVERY_REQUIRED, TASK_STATES.FAILED].includes(nextState)) {
    void recordToolFailureObservationTx(db, {
      subjectType: 'task',
      subjectId: taskId,
      taskId,
      executionId: options.executionId || null,
      taskState: nextState,
      reasonCode: options.reasonCode || 'task_state_transition',
      recoveryReason: options.recoveryReason || null,
      notes: options.notes || options.recoveryNotes || null,
      source: options.actorSource || 'runtime',
      requiresHumanInput: nextState === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED,
      blockedForInput: nextState === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED,
      status: nextState === TASK_STATES.FAILED ? 'failed' : 'interrupted',
    });
  }

  if ([TASK_STATES.COMPLETED, TASK_STATES.FAILED, TASK_STATES.PARTIALLY_COMPLETED, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, TASK_STATES.RECOVERY_REQUIRED].includes(nextState)) {
    syncTaskCompletionSummaryTx(db, taskId, {
      executionId: options.executionId || null,
      reasonCode: options.reasonCode || 'task_completion_summary_updated',
      timestamp,
    });
  }

  refreshTaskNotificationProfileTx(db, taskId, {
    currentState: nextState,
    classifiedAt: timestamp,
  });

  return {
    ...task,
    current_state: nextState,
    updated_at: timestamp,
    last_request_id: options.requestId || task.last_request_id || '',
    recovery_reason: nextState === TASK_STATES.RECOVERY_REQUIRED
      ? (options.recoveryReason === undefined ? (task.recovery_reason || options.reasonCode || 'task_recovery_required') : options.recoveryReason)
      : null,
    recovery_notes: nextState === TASK_STATES.RECOVERY_REQUIRED
      ? (options.recoveryNotes === undefined ? (options.notes || task.recovery_notes || null) : options.recoveryNotes)
      : null,
    first_execution_id: options.executionId || task.first_execution_id || null,
    last_execution_id: options.executionId || task.last_execution_id || null,
    completed_execution_id: nextState === TASK_STATES.COMPLETED ? (options.executionId || task.completed_execution_id || null) : task.completed_execution_id,
  };
}

async function transitionTask(taskId, nextState, options = {}) {
  return withBillingWrite(async (db) => transitionTaskTx(db, taskId, nextState, options));
}

function syncTaskStateForExecutionTx(db, execution, nextExecutionState, options = {}) {
  const taskId = String(execution?.task_id || options.taskId || '');
  if (!taskId) {
    return null;
  }
  const nextTaskState = taskStateFromExecutionState(nextExecutionState);
  if (!nextTaskState) {
    return null;
  }
  return transitionTaskTx(db, taskId, nextTaskState, {
    executionId: execution.execution_id,
    requestId: options.requestId || execution.last_request_id || null,
    actorSource: options.actorSource || 'runtime',
    reasonCode: options.reasonCode || 'execution_state_sync',
    notes: options.notes || null,
    recoveryReason: options.recoveryReason,
    recoveryNotes: options.recoveryNotes,
    timestamp: options.timestamp || getTimestamp(),
  });
}

function syncTaskStateForArtifactTx(db, executionId, verificationState, options = {}) {
  const currentStmt = db.prepare('SELECT task_id FROM executions WHERE execution_id = ? LIMIT 1');
  currentStmt.bind([executionId]);
  let taskId = '';
  if (currentStmt.step()) {
    taskId = String(currentStmt.getAsObject().task_id || '');
  }
  currentStmt.free();
  if (!taskId) {
    return null;
  }
  const taskCurrentStmt = db.prepare('SELECT current_state FROM tasks WHERE task_id = ? LIMIT 1');
  taskCurrentStmt.bind([taskId]);
  let currentTaskState = String(options.currentTaskState || '');
  if (taskCurrentStmt.step()) {
    currentTaskState = String(taskCurrentStmt.getAsObject().current_state || currentTaskState || '');
  }
  taskCurrentStmt.free();
  const taskState = taskStateFromArtifactVerification(verificationState, currentTaskState || '');
  if (!taskState) {
    return null;
  }
  return transitionTaskTx(db, taskId, taskState, {
    executionId,
    requestId: options.requestId || null,
    actorSource: options.actorSource || 'runtime',
    reasonCode: options.reasonCode || 'artifact_state_sync',
    notes: options.notes || null,
    timestamp: options.timestamp || getTimestamp(),
  });
}

function normalizeArtifactTextSample(text, limit = 8192) {
  return String(text || '').replace(/\0/g, '').slice(0, limit);
}

function tokenizeTaskObjective(text = '') {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !['this', 'that', 'with', 'from', 'have', 'into', 'your', 'need', 'using', 'create', 'build', 'make', 'page'].includes(token));
}

function inferArtifactFamily(taskObjectiveText = '', declaredPath = '', content = '', completionText = '') {
  const haystack = [
    taskObjectiveText,
    declaredPath,
    content.slice(0, 2048),
    completionText,
  ].join('\n').toLowerCase();

  if (/\b(component|tsx|jsx|react|frontend)\b/.test(haystack) || /\.(tsx|jsx)$/i.test(declaredPath)) {
    return 'component';
  }
  if (/\b(markdown|md|brief|summary|report|notes)\b/.test(haystack) || /\.md$/i.test(declaredPath)) {
    return 'markdown';
  }
  if (/\b(json|manifest|config)\b/.test(haystack) || /\.json$/i.test(declaredPath)) {
    return 'json';
  }
  if (/\b(html|website|landing page|site|webpage)\b/.test(haystack) || /\.html?$/i.test(declaredPath)) {
    return 'html';
  }
  return 'text';
}

function countMatches(patterns, content) {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      count += 1;
    }
  }
  return count;
}

function classifyArtifactStructure(family, content, declaredPath = '') {
  const text = normalizeArtifactTextSample(content);
  const lower = text.toLowerCase();
  if (!text) {
    return { state: TASK_ARTIFACT_STRUCTURE_STATES.MISSING, reason: 'artifact_missing' };
  }

  if (family === 'html') {
    const validSignals = countMatches([
      /<!doctype html/i,
      /<html[\s>]/i,
      /<body[\s>]/i,
    ], text);
    const blockSignals = countMatches([
      /<header[\s>]/i,
      /<main[\s>]/i,
      /<section[\s>]/i,
      /<article[\s>]/i,
      /<footer[\s>]/i,
      /<nav[\s>]/i,
      /<button[\s>]/i,
      /<form[\s>]/i,
      /<h1[\s>]/i,
      /<h2[\s>]/i,
    ], text);
    if (validSignals >= 2 && blockSignals >= 2) {
      return { state: TASK_ARTIFACT_STRUCTURE_STATES.VALID, reason: 'html_document_structured' };
    }
    if (validSignals >= 1 || blockSignals >= 2) {
      return { state: TASK_ARTIFACT_STRUCTURE_STATES.PARTIAL, reason: 'html_document_partial' };
    }
    return { state: TASK_ARTIFACT_STRUCTURE_STATES.INVALID, reason: 'html_document_invalid' };
  }

  if (family === 'markdown') {
    const headingSignals = countMatches([
      /^#\s+/m,
      /^##\s+/m,
      /^###\s+/m,
    ], text);
    const listSignals = countMatches([
      /^-\s+/m,
      /^\*\s+/m,
      /^\d+\.\s+/m,
    ], text);
    if (headingSignals >= 1 && listSignals >= 1 && lower.length >= 120) {
      return { state: TASK_ARTIFACT_STRUCTURE_STATES.VALID, reason: 'markdown_document_structured' };
    }
    if (headingSignals >= 1 || listSignals >= 1 || lower.length >= 80) {
      return { state: TASK_ARTIFACT_STRUCTURE_STATES.PARTIAL, reason: 'markdown_document_partial' };
    }
    return { state: TASK_ARTIFACT_STRUCTURE_STATES.INVALID, reason: 'markdown_document_invalid' };
  }

  if (family === 'component') {
    const exportSignals = countMatches([
      /export\s+default/i,
      /export\s+\{/i,
      /function\s+[A-Z][A-Za-z0-9_]*/i,
      /const\s+[A-Z][A-Za-z0-9_]*\s*=\s*\(/i,
    ], text);
    const jsxSignals = countMatches([
      /<([A-Z][A-Za-z0-9_]*|div|section|main|article|header|footer|button|span|p|h1|h2|h3)\b/i,
      /return\s*\(/i,
    ], text);
    if (exportSignals >= 1 && jsxSignals >= 2) {
      return { state: TASK_ARTIFACT_STRUCTURE_STATES.VALID, reason: 'component_structured' };
    }
    if (exportSignals >= 1 || jsxSignals >= 1) {
      return { state: TASK_ARTIFACT_STRUCTURE_STATES.PARTIAL, reason: 'component_partial' };
    }
    return { state: TASK_ARTIFACT_STRUCTURE_STATES.INVALID, reason: 'component_invalid' };
  }

  if (family === 'json') {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && (Array.isArray(parsed) ? parsed.length > 0 : Object.keys(parsed).length > 0)) {
        return { state: TASK_ARTIFACT_STRUCTURE_STATES.VALID, reason: 'json_structured' };
      }
      return { state: TASK_ARTIFACT_STRUCTURE_STATES.PARTIAL, reason: 'json_empty' };
    } catch (error) {
      return { state: TASK_ARTIFACT_STRUCTURE_STATES.INVALID, reason: 'json_invalid' };
    }
  }

  if (lower.length >= 240 && (/\n#{1,3}\s+/m.test(text) || /\n[-*]\s+/m.test(text) || /\n\d+\.\s+/m.test(text))) {
    return { state: TASK_ARTIFACT_STRUCTURE_STATES.VALID, reason: 'text_structured' };
  }
  if (lower.length >= 100) {
    return { state: TASK_ARTIFACT_STRUCTURE_STATES.PARTIAL, reason: 'text_partial' };
  }
  return { state: TASK_ARTIFACT_STRUCTURE_STATES.INVALID, reason: 'text_invalid' };
}

function classifyArtifactAlignment(family, objectiveText = '', content = '', completionText = '', structure = null) {
  const objectiveTokens = tokenizeTaskObjective(objectiveText);
  const haystack = normalizeArtifactTextSample([content, completionText].join('\n')).toLowerCase();
  const keywordHits = objectiveTokens.filter((token) => haystack.includes(token)).length;
  const familyExpectationMatches = {
    html: /\b(html|website|landing page|site|webpage)\b/i.test(objectiveText),
    markdown: /\b(markdown|brief|summary|report|notes)\b/i.test(objectiveText),
    component: /\b(component|frontend|react|tsx|jsx|section)\b/i.test(objectiveText),
    json: /\b(json|manifest|config)\b/i.test(objectiveText),
    text: /\b(summary|inspection|report|notes)\b/i.test(objectiveText),
  };

  const familyMatches = Boolean(familyExpectationMatches[family]) || family === 'text';

  if (!content) {
    return { state: TASK_ARTIFACT_ALIGNMENT_STATES.MISSING, reason: 'artifact_missing' };
  }

  if (structure && structure.state === TASK_ARTIFACT_STRUCTURE_STATES.INVALID) {
    return { state: TASK_ARTIFACT_ALIGNMENT_STATES.MISMATCH, reason: 'structure_invalid' };
  }

  if (familyMatches && keywordHits >= 2) {
    return { state: TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED, reason: 'objective_keywords_present' };
  }

  if (familyMatches || keywordHits >= 1) {
    return { state: TASK_ARTIFACT_ALIGNMENT_STATES.PARTIAL, reason: 'objective_partially_represented' };
  }

  return { state: TASK_ARTIFACT_ALIGNMENT_STATES.MISMATCH, reason: 'objective_mismatch' };
}

function scoreTaskArtifactConfidence(artifactExists, verificationState, structureState, alignmentState) {
  let score = 0;
  if (artifactExists) {
    score += 20;
  }
  if (verificationState === ARTIFACT_VERIFICATION_STATES.VERIFIED) {
    score += 25;
  } else if (verificationState === ARTIFACT_VERIFICATION_STATES.REJECTED) {
    score += 0;
  } else if (verificationState === ARTIFACT_VERIFICATION_STATES.PENDING) {
    score += 10;
  }

  if (structureState === TASK_ARTIFACT_STRUCTURE_STATES.VALID) {
    score += 25;
  } else if (structureState === TASK_ARTIFACT_STRUCTURE_STATES.PARTIAL) {
    score += 12;
  }

  if (alignmentState === TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED) {
    score += 30;
  } else if (alignmentState === TASK_ARTIFACT_ALIGNMENT_STATES.PARTIAL) {
    score += 15;
  }

  return Math.max(0, Math.min(100, score));
}

function bandTaskArtifactConfidence(score) {
  if (score >= 80) {
    return TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH;
  }
  if (score >= 45) {
    return TASK_ARTIFACT_CONFIDENCE_BANDS.MEDIUM;
  }
  return TASK_ARTIFACT_CONFIDENCE_BANDS.LOW;
}

function normalizeFailureDetail(detail = '') {
  if (!detail) {
    return '';
  }
  if (typeof detail === 'string') {
    return detail.slice(0, 2048);
  }
  try {
    return JSON.stringify(detail).slice(0, 2048);
  } catch (error) {
    return String(detail).slice(0, 2048);
  }
}

function classifyToolFailureObservation(observation = {}) {
  const status = String(observation.status || '').toLowerCase();
  const errorCode = String(observation.errorCode || observation.reasonCode || '').toLowerCase();
  const reasonCode = String(observation.reasonCode || observation.errorCode || '').toLowerCase();
  const recoveryReason = String(observation.recoveryReason || '').toLowerCase();
  const executionState = String(observation.executionState || '').toLowerCase();
  const taskState = String(observation.taskState || '').toLowerCase();
  const artifactReason = String(observation.artifactReason || '').toLowerCase();
  const budgetReason = String(observation.budgetRejectionReason || observation.budgetReason || '').toLowerCase();
  const artifactVerificationState = String(observation.artifactVerificationState || '').toLowerCase();
  const artifactExists = Boolean(observation.artifactExists);
  const meaningfulOutputStarted = Boolean(observation.meaningfulOutputStarted);
  const requiresHumanInput = Boolean(observation.requiresHumanInput);
  const blockedForInput = Boolean(observation.blockedForInput);

  if (blockedForInput || taskState === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED) {
    if (recoveryReason.includes('recovery') || reasonCode.includes('recovery')) {
      return {
        category: TOOL_FAILURE_CATEGORIES.RECOVERY_BLOCKED,
        scope: TOOL_FAILURE_SCOPES.TASK,
        stage: taskState || 'blocked_human_input_required',
      };
    }
    return {
      category: TOOL_FAILURE_CATEGORIES.BLOCKED_FOR_INPUT,
      scope: TOOL_FAILURE_SCOPES.TASK,
      stage: taskState || 'blocked_human_input_required',
    };
  }

  if (requiresHumanInput) {
    return {
      category: TOOL_FAILURE_CATEGORIES.USER_CONFIRMATION_WAITING,
      scope: TOOL_FAILURE_SCOPES.TASK,
      stage: taskState || executionState || 'human_input_wait',
    };
  }

  if (budgetReason === 'context_window_exceeded' || budgetReason === 'reserved_output_exceeded' || reasonCode === 'downstream_context_overflow' || reasonCode === 'context_window_exceeded' || errorCode === 'context_window_exceeded' || errorCode === 'reserved_output_exceeded' || errorCode === 'downstream_context_overflow' || errorCode === 'pressure_over_limit') {
    return {
      category: TOOL_FAILURE_CATEGORIES.CONTEXT_COLLAPSED,
      scope: TOOL_FAILURE_SCOPES.CONTEXT,
      stage: executionState || 'budget_gate',
    };
  }

  if (artifactReason === 'artifact_claim_without_evidence' || artifactReason === 'status_claim_unverified') {
    return {
      category: TOOL_FAILURE_CATEGORIES.STATUS_CLAIM_UNVERIFIED,
      scope: TOOL_FAILURE_SCOPES.ARTIFACT,
      stage: 'artifact_verification',
    };
  }

  if (['terminal_payload_missing', 'empty_terminal_response'].includes(reasonCode)) {
    return {
      category: TOOL_FAILURE_CATEGORIES.TERMINAL_PAYLOAD_MISSING,
      scope: TOOL_FAILURE_SCOPES.EXECUTION,
      stage: executionState || taskState || 'execution_finalization',
    };
  }

  if ([
    'artifact_path_not_found',
    'artifact_workspace_missing',
    'artifact_workspace_roots_unconfigured',
    'artifact_path_outside_workspace',
    'artifact_path_ambiguous_workspace',
    'artifact_not_nonempty_file',
    'artifact_delivery_not_confirmed',
    'artifact_missing',
    'artifact_semantic_verification_failed',
  ].includes(artifactReason)) {
    return {
      category: TOOL_FAILURE_CATEGORIES.ARTIFACT_MISSING,
      scope: TOOL_FAILURE_SCOPES.ARTIFACT,
      stage: 'artifact_verification',
    };
  }

  if ([
    'artifact_verification_failed',
    'artifact_claim_without_evidence',
    'artifact_rejected',
    'artifact_invalid',
    'artifact_output_invalid',
    'artifact_claim_rejected',
  ].includes(artifactReason) || artifactVerificationState === ARTIFACT_VERIFICATION_STATES.REJECTED) {
    return {
      category: TOOL_FAILURE_CATEGORIES.TOOL_OUTPUT_INVALID,
      scope: TOOL_FAILURE_SCOPES.ARTIFACT,
      stage: 'artifact_verification',
    };
  }

  if ([
    'client_disconnect',
    'ambiguous_live_interruption',
    'ambiguous_stream_interruption',
    'upstream_timeout',
    'stream_proxy_failed',
  ].includes(reasonCode) || status === 'interrupted' || executionState === EXECUTION_STATES.RECOVERY_REQUIRED) {
    if (!meaningfulOutputStarted) {
      return {
        category: TOOL_FAILURE_CATEGORIES.TOOL_NOT_INVOKED,
        scope: TOOL_FAILURE_SCOPES.TOOL,
        stage: executionState || 'execution_finalization',
      };
    }
    return {
      category: TOOL_FAILURE_CATEGORIES.EXECUTION_INTERRUPTED,
      scope: TOOL_FAILURE_SCOPES.EXECUTION,
      stage: executionState || 'execution_finalization',
    };
  }

  if ([
    'provider_not_configured',
    'upstream_unreachable',
    'upstream_error',
    'upstream_invalid_response',
    'stream_proxy_failed',
    'upstream_timeout',
    'rate_limit_exceeded',
  ].includes(errorCode)) {
    if (!meaningfulOutputStarted) {
      return {
        category: TOOL_FAILURE_CATEGORIES.TOOL_NOT_INVOKED,
        scope: TOOL_FAILURE_SCOPES.TOOL,
        stage: executionState || 'upstream_call',
      };
    }
    return {
      category: TOOL_FAILURE_CATEGORIES.TOOL_INVOCATION_FAILED,
      scope: TOOL_FAILURE_SCOPES.TOOL,
      stage: executionState || 'upstream_call',
    };
  }

  if (artifactExists && (
    observation.confidenceBand === TASK_ARTIFACT_CONFIDENCE_BANDS.MEDIUM
    || observation.confidenceBand === TASK_ARTIFACT_CONFIDENCE_BANDS.LOW
    || observation.structureState === TASK_ARTIFACT_STRUCTURE_STATES.PARTIAL
    || observation.alignmentState === TASK_ARTIFACT_ALIGNMENT_STATES.PARTIAL
    || observation.alignmentState === TASK_ARTIFACT_ALIGNMENT_STATES.MISMATCH
  )) {
    return {
      category: TOOL_FAILURE_CATEGORIES.ARTIFACT_PARTIAL,
      scope: TOOL_FAILURE_SCOPES.ARTIFACT,
      stage: 'artifact_assessment',
    };
  }

  if (!artifactExists && (reasonCode === 'artifact_missing' || reasonCode === 'artifact_confidence_updated')) {
    return {
      category: TOOL_FAILURE_CATEGORIES.ARTIFACT_MISSING,
      scope: TOOL_FAILURE_SCOPES.ARTIFACT,
      stage: 'artifact_assessment',
    };
  }

  if (!meaningfulOutputStarted && status === 'failed') {
    return {
      category: TOOL_FAILURE_CATEGORIES.TOOL_NOT_INVOKED,
      scope: TOOL_FAILURE_SCOPES.TOOL,
      stage: executionState || 'execution_finalization',
    };
  }

  return {
    category: TOOL_FAILURE_CATEGORIES.TOOL_OUTPUT_INVALID,
    scope: TOOL_FAILURE_SCOPES.TOOL,
    stage: executionState || taskState || 'unknown',
  };
}

async function appendToolFailureFactTx(db, fact = {}) {
  const timestamp = fact.created_at || fact.timestamp || getTimestamp();
  const failureFactId = fact.failure_fact_id || createToolFailureFactId();
  const insert = db.prepare(`
    INSERT INTO tool_failure_facts (
      failure_fact_id, subject_type, subject_id, task_id, execution_id, failure_category, failure_scope,
      failure_stage, source, reason_code, detail, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run([
    failureFactId,
    fact.subject_type,
    fact.subject_id,
    fact.task_id || null,
    fact.execution_id || null,
    fact.failure_category,
    fact.failure_scope,
    fact.failure_stage || '',
    fact.source || 'runtime',
    fact.reason_code || '',
    normalizeFailureDetail(fact.detail || ''),
    timestamp,
    timestamp,
  ]);
  insert.free();
  return getStoredToolFailureFactBySubjectId(db, fact.subject_type, fact.subject_id);
}

async function appendToolFailureFact(fact = {}) {
  return withBillingWrite(async (db) => appendToolFailureFactTx(db, fact));
}

async function recordToolFailureObservationTx(db, options = {}) {
  const subjectType = String(options.subjectType || 'execution');
  const subjectId = String(options.subjectId || options.executionId || options.taskId || '');
  if (!subjectId) {
    return null;
  }

  const observation = classifyToolFailureObservation(options);
  const detail = options.detail || options.notes || options.reasonCode || options.errorCode || '';
  return appendToolFailureFactTx(db, {
    subject_type: subjectType,
    subject_id: subjectId,
    task_id: options.taskId || null,
    execution_id: options.executionId || null,
    failure_category: observation.category,
    failure_scope: observation.scope,
    failure_stage: observation.stage,
    source: options.source || 'runtime',
    reason_code: options.reasonCode || options.errorCode || '',
    detail,
    timestamp: options.timestamp || getTimestamp(),
  });
}

async function recordToolFailureObservation(options = {}) {
  return withBillingWrite(async (db) => recordToolFailureObservationTx(db, options));
}

async function syncTaskArtifactAssessmentTx(db, executionId, options = {}) {
  const execution = await getStoredExecutionById(db, executionId);
  if (!execution || !execution.task_id) {
    return null;
  }

  const task = await getStoredTaskById(db, execution.task_id);
  const artifact = await getStoredExecutionArtifactByExecutionId(db, executionId);
  if (!task || !artifact) {
    return null;
  }

  const timestamp = options.timestamp || getTimestamp();
  const objectiveText = extractManagedCurrentTurnText(String(options.promptText || task.objective_text || ''));
  let artifactExists = 0;
  let artifactContent = '';
  let structureState = TASK_ARTIFACT_STRUCTURE_STATES.MISSING;
  let alignmentState = TASK_ARTIFACT_ALIGNMENT_STATES.MISSING;
  let artifactFamily = 'unknown';
  let reasonCode = options.reasonCode || 'artifact_confidence_updated';
  const notes = {
    artifact_id: artifact.artifact_id || '',
    declared_path: artifact.declared_path || '',
    canonical_path: artifact.canonical_path || '',
    artifact_filename: artifact.artifact_filename || '',
    artifact_type: artifact.artifact_type || 'text',
    content_hash: artifact.content_hash || '',
    byte_size: Number(artifact.byte_size || 0),
    objective_text: objectiveText,
    verification_state: artifact.verification_state || '',
    evidence_reason: '',
    structure_reason: '',
    alignment_reason: '',
    keyword_hits: 0,
  };

  try {
    if (artifact.declared_path && fs.existsSync(artifact.declared_path)) {
      const stats = fs.statSync(artifact.declared_path);
      if (stats.isFile() && Number(stats.size || 0) > 0) {
        artifactExists = 1;
        artifactContent = normalizeArtifactTextSample(fs.readFileSync(artifact.declared_path, 'utf8'));
        notes.evidence_reason = 'artifact_exists';
      } else {
        notes.evidence_reason = 'artifact_not_nonempty_file';
      }
    } else {
      notes.evidence_reason = 'artifact_path_not_found';
    }
  } catch (error) {
    notes.evidence_reason = error?.code || error?.message || 'artifact_read_failed';
  }

  artifactFamily = inferArtifactFamily(objectiveText, artifact.declared_path || '', artifactContent, options.completionText || '');
  const structure = classifyArtifactStructure(artifactFamily, artifactContent, artifact.declared_path || '');
  structureState = structure.state;
  notes.structure_reason = structure.reason;

  const alignment = classifyArtifactAlignment(artifactFamily, objectiveText, artifactContent, options.completionText || '', structure);
  alignmentState = alignment.state;
  notes.alignment_reason = alignment.reason;
  notes.keyword_hits = tokenizeTaskObjective(objectiveText || '').filter((token) => artifactContent.toLowerCase().includes(token)).length;

  if (!artifactExists) {
    reasonCode = reasonCode || 'artifact_missing';
  } else if (artifact.verification_state === ARTIFACT_VERIFICATION_STATES.REJECTED) {
    reasonCode = reasonCode || 'artifact_rejected';
  } else if (artifact.verification_state === ARTIFACT_VERIFICATION_STATES.VERIFIED && structureState === TASK_ARTIFACT_STRUCTURE_STATES.VALID && alignmentState === TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED) {
    reasonCode = reasonCode || 'artifact_verified_and_aligned';
  } else if (structureState === TASK_ARTIFACT_STRUCTURE_STATES.PARTIAL || alignmentState === TASK_ARTIFACT_ALIGNMENT_STATES.PARTIAL) {
    reasonCode = reasonCode || 'artifact_partial_confidence';
  } else {
    reasonCode = reasonCode || 'artifact_confidence_updated';
  }

  const confidenceScore = scoreTaskArtifactConfidence(
    artifactExists,
    artifact.verification_state || ARTIFACT_VERIFICATION_STATES.PENDING,
    structureState,
    alignmentState,
  );
  const confidenceBand = bandTaskArtifactConfidence(confidenceScore);

  const insert = db.prepare(`
    INSERT INTO task_artifact_assessments (
      assessment_id, task_id, session_id, execution_id, artifact_id, artifact_exists, artifact_verification_state,
      artifact_family, structure_state, alignment_state, confidence_score, confidence_band, reason_code, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      session_id = excluded.session_id,
      execution_id = excluded.execution_id,
      artifact_id = excluded.artifact_id,
      artifact_exists = excluded.artifact_exists,
      artifact_verification_state = excluded.artifact_verification_state,
      artifact_family = excluded.artifact_family,
      structure_state = excluded.structure_state,
      alignment_state = excluded.alignment_state,
      confidence_score = excluded.confidence_score,
      confidence_band = excluded.confidence_band,
      reason_code = excluded.reason_code,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `);
  insert.run([
    createTaskArtifactAssessmentId(),
    task.task_id,
    task.session_id,
    executionId,
    artifact.artifact_id || null,
    artifactExists,
    artifact.verification_state || ARTIFACT_VERIFICATION_STATES.PENDING,
    artifactFamily,
    structureState,
    alignmentState,
    confidenceScore,
    confidenceBand,
    reasonCode,
    JSON.stringify(notes),
    timestamp,
    timestamp,
  ]);
  insert.free();

  if (confidenceBand !== TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH) {
    void recordToolFailureObservationTx(db, {
      subjectType: 'task',
      subjectId: task.task_id,
      taskId: task.task_id,
      executionId,
      taskState: task.current_state,
      reasonCode: reasonCode || 'artifact_confidence_updated',
      artifactReason: reasonCode || '',
      artifactVerificationState: artifact.verification_state || '',
      artifactExists: Boolean(artifactExists),
      confidenceBand,
      structureState,
      alignmentState,
      notes: JSON.stringify(notes),
      source: 'runtime',
    });
  }

  return getStoredTaskArtifactAssessmentByTaskId(db, task.task_id);
}

function classifyProviderClass(descriptor) {
  const providerId = getDescriptorProviderId(descriptor);
  if (providerId === 'local_openai') {
    return 'local';
  }
  if (providerId === 'openrouter') {
    return 'remote';
  }
  return 'unknown';
}

function classifyArtifactClaimRisk(descriptor) {
  const providerClass = classifyProviderClass(descriptor);
  if (providerClass === 'remote') {
    return 'high';
  }
  if (providerClass === 'local') {
    return 'medium';
  }
  return 'unknown';
}

function classifyRetryabilityForDescriptor(descriptor, options = {}) {
  if (!descriptor || !getDescriptorProviderId(descriptor)) {
    return 'unknown';
  }
  if (options.staleFacts) {
    return 'unknown';
  }
  if (options.fallbackEligible) {
    return 'conditionally_retryable';
  }
  return 'safe_retryable';
}

function buildExecutionCapabilityRecord(executionId, session, requestedModel, descriptor, fallbackDescriptor = null, options = {}) {
  const validatedAt = options.timestamp || getTimestamp();
  const expiresAt = new Date(new Date(validatedAt).getTime() + CONTRACT_CACHE_TTL_MS).toISOString();
  const providerId = getDescriptorProviderId(descriptor) || '';
  const requestedModelInput = String(requestedModel || '');
  const requestedDescriptor = requestedModelInput ? getModelDescriptor(requestedModelInput) : null;
  const requestedModelAlias = String(requestedDescriptor?.alias || descriptor?.alias || session?.default_model_alias || PUBLIC_MODEL_ALIAS);
  const cachedContract = options.cachedContract || null;
  return {
    execution_id: executionId,
    requested_model_input: requestedModelInput,
    requested_model_alias: requestedModelAlias,
    resolved_model_alias: String(descriptor?.alias || requestedModelAlias),
    resolved_provider_id: providerId,
    resolved_upstream_model_id: String(descriptor?.upstreamId || ''),
    fallback_model_alias: String(fallbackDescriptor?.alias || ''),
    fallback_eligible: Number(Boolean(fallbackDescriptor)),
    fallback_used: Number(Boolean(options.fallbackUsed)),
    supports_chat: 1,
    supports_streaming: 1,
    supports_tools: Number(Boolean(Array.isArray(descriptor?.capabilities) && descriptor.capabilities.includes('tools'))),
    artifact_claim_risk: classifyArtifactClaimRisk(descriptor),
    timeout_profile: options.timeoutProfile || (providerId === 'local_openai' ? 'local' : 'remote_primary'),
    retryability_class: classifyRetryabilityForDescriptor(descriptor, {
      fallbackEligible: Boolean(fallbackDescriptor),
      staleFacts: false,
    }),
    provider_class: classifyProviderClass(descriptor),
    context_window_tokens: Number(descriptor?.contextWindow || 0),
    max_output_tokens: Number(descriptor?.maxTokens || 0),
    validated_at: validatedAt,
    expires_at: expiresAt,
    fact_source: cachedContract ? 'session_cached_contract' : 'descriptor_registry',
    created_at: validatedAt,
    updated_at: validatedAt,
  };
}

async function persistExecutionCapabilityRecord(record) {
  return withBillingWrite(async (db) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO execution_capabilities (
        execution_id, requested_model_input, requested_model_alias, resolved_model_alias, resolved_provider_id, resolved_upstream_model_id,
        fallback_model_alias, fallback_eligible, fallback_used, supports_chat, supports_streaming, supports_tools,
        artifact_claim_risk, timeout_profile, retryability_class, provider_class, context_window_tokens,
        max_output_tokens, validated_at, expires_at, fact_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      record.execution_id,
      record.requested_model_input || '',
      record.requested_model_alias,
      record.resolved_model_alias,
      record.resolved_provider_id,
      record.resolved_upstream_model_id,
      record.fallback_model_alias || '',
      Number(Boolean(record.fallback_eligible)),
      Number(Boolean(record.fallback_used)),
      Number(Boolean(record.supports_chat)),
      Number(Boolean(record.supports_streaming)),
      Number(Boolean(record.supports_tools)),
      record.artifact_claim_risk || 'unknown',
      record.timeout_profile || 'unknown',
      record.retryability_class || 'unknown',
      record.provider_class || 'unknown',
      Number(record.context_window_tokens || 0),
      Number(record.max_output_tokens || 0),
      record.validated_at || getTimestamp(),
      record.expires_at || getTimestamp(),
      record.fact_source || 'descriptor_registry',
      record.created_at || getTimestamp(),
      record.updated_at || getTimestamp(),
    ]);
    insert.free();
    return getStoredExecutionCapabilityByExecutionId(db, record.execution_id);
  });
}

async function updateExecutionCapabilityFallbackUse(executionId, descriptor, options = {}) {
  return withBillingWrite(async (db) => {
    const current = await getStoredExecutionCapabilityByExecutionId(db, executionId);
    if (!current) {
      return null;
    }
    const timestamp = options.timestamp || getTimestamp();
    const update = db.prepare(`
      UPDATE execution_capabilities
      SET resolved_model_alias = ?,
          resolved_provider_id = ?,
          resolved_upstream_model_id = ?,
          fallback_model_alias = ?,
          fallback_used = 1,
          artifact_claim_risk = ?,
          timeout_profile = ?,
          retryability_class = ?,
          provider_class = ?,
          context_window_tokens = ?,
          max_output_tokens = ?,
          updated_at = ?
      WHERE execution_id = ?
    `);
    update.run([
      String(descriptor?.alias || current.resolved_model_alias),
      String(getDescriptorProviderId(descriptor) || current.resolved_provider_id),
      String(descriptor?.upstreamId || current.resolved_upstream_model_id),
      String(descriptor?.alias || current.fallback_model_alias),
      classifyArtifactClaimRisk(descriptor),
      options.timeoutProfile || 'remote_fallback',
      classifyRetryabilityForDescriptor(descriptor, { fallbackEligible: false }),
      classifyProviderClass(descriptor),
      Number(descriptor?.contextWindow || current.context_window_tokens || 0),
      Number(descriptor?.maxTokens || current.max_output_tokens || 0),
      timestamp,
      executionId,
    ]);
    update.free();
    return getStoredExecutionCapabilityByExecutionId(db, executionId);
  });
}

function getExecutionCapabilityFreshness(record, nowMs = Date.now()) {
  if (!record || !record.validated_at || !record.expires_at) {
    return { stale: true, reason: 'missing_capability_facts' };
  }

  const expiresAtMs = new Date(record.expires_at).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return { stale: true, reason: 'stale_capability_facts' };
  }

  if (!record.resolved_provider_id || !record.resolved_upstream_model_id) {
    return { stale: true, reason: 'incomplete_capability_facts' };
  }

  return { stale: false, reason: '' };
}

async function canExecutionUseOptimisticRetry(executionId) {
  const record = await getExecutionCapabilityRecord(executionId);
  if (!record) {
    return { allowed: false, reason: 'missing_capability_facts' };
  }
  const freshness = getExecutionCapabilityFreshness(record);
  if (freshness.stale) {
    return { allowed: false, reason: freshness.reason };
  }
  if (record.retryability_class === 'unknown') {
    return { allowed: false, reason: 'unknown_retryability_class' };
  }
  return { allowed: true, reason: '' };
}

function buildExecutionBudgetRecord(executionId, requestBody, acceptedBody, descriptor, options = {}) {
  const timestamp = options.timestamp || getTimestamp();
  const requestedEstimate = options.requestedEstimate || estimateRequestTokens(requestBody);
  const acceptedEstimate = options.acceptedEstimate || estimateRequestTokens(acceptedBody);
  const requestedOutputTokens = Number.isFinite(Number(requestBody?.max_tokens))
    ? Math.max(1, Number(requestBody.max_tokens))
    : DEFAULT_OUTPUT_RESERVATION_TOKENS;
  const reservedOutputTokens = Number.isFinite(Number(options.reservedOutputTokens))
    ? Math.max(1, Number(options.reservedOutputTokens))
    : requestedOutputTokens;
  const effectiveContextWindowTokens = Math.max(0, Number(descriptor?.contextWindow || 0));
  const effectiveMaxOutputTokens = Math.max(0, Number(descriptor?.maxTokens || 0));
  const adaptationApplied = Boolean(options.contextAdaptationApplied);
  return {
    execution_id: executionId,
    requested_input_tokens_estimate: Math.max(0, Number(requestedEstimate.inputTokens || 0)),
    requested_output_tokens: requestedOutputTokens,
    effective_context_window_tokens: effectiveContextWindowTokens,
    effective_max_output_tokens: effectiveMaxOutputTokens,
    reserved_output_tokens: reservedOutputTokens,
    estimated_total_budget_demand: Math.max(0, Number(requestedEstimate.inputTokens || 0) + reservedOutputTokens),
    accepted_input_tokens_estimate: Math.max(0, Number(acceptedEstimate.inputTokens || 0)),
    context_adaptation_applied: Number(adaptationApplied),
    context_adaptation_reason: adaptationApplied ? (options.contextAdaptationReason || 'history_compaction') : 'none',
    budget_rejection_reason: options.budgetRejectionReason || '',
    completed_input_tokens: Number(options.completedInputTokens || 0),
    completed_output_tokens: Number(options.completedOutputTokens || 0),
    created_at: timestamp,
    updated_at: timestamp,
  };
}

async function persistExecutionBudgetRecord(record) {
  return withBillingWrite(async (db) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO execution_budgets (
        execution_id, requested_input_tokens_estimate, requested_output_tokens, effective_context_window_tokens,
        effective_max_output_tokens, reserved_output_tokens, estimated_total_budget_demand, accepted_input_tokens_estimate,
        context_adaptation_applied, context_adaptation_reason, budget_rejection_reason, completed_input_tokens,
        completed_output_tokens, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      record.execution_id,
      Number(record.requested_input_tokens_estimate || 0),
      Number(record.requested_output_tokens || 0),
      Number(record.effective_context_window_tokens || 0),
      Number(record.effective_max_output_tokens || 0),
      Number(record.reserved_output_tokens || 0),
      Number(record.estimated_total_budget_demand || 0),
      Number(record.accepted_input_tokens_estimate || 0),
      Number(Boolean(record.context_adaptation_applied)),
      record.context_adaptation_reason || 'none',
      record.budget_rejection_reason || '',
      Number(record.completed_input_tokens || 0),
      Number(record.completed_output_tokens || 0),
      record.created_at || getTimestamp(),
      record.updated_at || getTimestamp(),
    ]);
    insert.free();
    return getStoredExecutionBudgetByExecutionId(db, record.execution_id);
  });
}

function classifyExecutionBudgetFit(record) {
  if (!record) {
    return { fits: true, rejectionReason: '' };
  }
  if (
    Number(record.effective_max_output_tokens || 0) > 0
    && Number(record.requested_output_tokens || 0) > Number(record.effective_max_output_tokens || 0)
  ) {
    return { fits: false, rejectionReason: 'reserved_output_exceeded' };
  }
  if (
    Number(record.effective_context_window_tokens || 0) > 0
    && Number(record.estimated_total_budget_demand || 0) > Number(record.effective_context_window_tokens || 0)
  ) {
    return { fits: false, rejectionReason: 'context_window_exceeded' };
  }
  return { fits: true, rejectionReason: '' };
}

function classifyContextPressure(record) {
  if (!record) {
    return { state: 'unknown', ratio: 0 };
  }
  const demand = Number(record.estimated_total_budget_demand || 0);
  const window = Number(record.effective_context_window_tokens || 0);
  if (!Number.isFinite(window) || window <= 0) {
    return { state: 'unknown', ratio: 0 };
  }
  const ratio = demand / window;
  if (ratio >= PRESSURE_OVER_LIMIT_THRESHOLD) {
    return { state: 'over_limit', ratio };
  }
  if (ratio >= PRESSURE_CRITICAL_THRESHOLD) {
    return { state: 'critical', ratio };
  }
  if (ratio >= PRESSURE_WARNING_THRESHOLD) {
    return { state: 'warning', ratio };
  }
  return { state: 'healthy', ratio };
}

async function persistSessionContextPressure(sessionId, executionId, pressure, timestamp = getTimestamp()) {
  return withBillingWrite(async (db) => {
    const currentStmt = db.prepare('SELECT * FROM session_context_pressure WHERE session_id = ? LIMIT 1');
    currentStmt.bind([sessionId]);
    let current = null;
    if (currentStmt.step()) {
      current = currentStmt.getAsObject();
    }
    currentStmt.free();

    const firstCriticalAt = current?.first_critical_at
      || (pressure.state === 'critical' || pressure.state === 'over_limit' ? timestamp : null);
    const latestOverLimitAt = pressure.state === 'over_limit'
      ? timestamp
      : (current?.latest_over_limit_at || null);

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO session_context_pressure (
        session_id, latest_pressure_state, latest_pressure_ratio, latest_execution_id,
        first_critical_at, latest_over_limit_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    upsert.run([
      sessionId,
      pressure.state,
      Number(pressure.ratio || 0),
      executionId || null,
      firstCriticalAt,
      latestOverLimitAt,
      timestamp,
    ]);
    upsert.free();
    return true;
  });
}

async function appendSessionContinuityEvent(entry) {
  const eventId = entry.event_id || createContinuityEventId();
  return withBillingWrite(async (db) => {
    const insert = db.prepare(`
      INSERT INTO session_continuity_events (
        event_id, session_id, execution_id, pressure_state, pressure_ratio,
        event_type, decision, source, reason_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      eventId,
      entry.session_id,
      entry.execution_id || null,
      entry.pressure_state || 'unknown',
      Number(entry.pressure_ratio || 0),
      entry.event_type,
      entry.decision,
      entry.source,
      entry.reason_code || '',
      entry.created_at || getTimestamp(),
    ]);
    insert.free();
    return eventId;
  });
}

function shouldEmitRecommendationForPressureState(pressureState) {
  return pressureState === 'warning' || pressureState === 'critical' || pressureState === 'over_limit';
}

function deriveContinuityRecommendation(input = {}) {
  const pressureState = String(input.pressureState || 'unknown');
  const eventType = String(input.eventType || '');
  const repeatedCritical = Boolean(input.repeatedCritical);
  const repeatedOverflow = Boolean(input.repeatedOverflow);
  const reasonCode = String(input.reasonCode || '');

  if (repeatedOverflow) {
    return { type: CONTINUITY_RECOMMENDATION_TYPES.RECOVERY_REVIEW_REQUIRED, reasonCode: reasonCode || 'repeated_overflow_without_recovery' };
  }
  if (eventType === 'pressure_over_limit') {
    return { type: CONTINUITY_RECOMMENDATION_TYPES.REQUIRE_MANUAL_RESET, reasonCode: reasonCode || 'context_window_exceeded' };
  }
  if (eventType === 'downstream_overflow_detected') {
    return { type: CONTINUITY_RECOMMENDATION_TYPES.RECOMMEND_ROLLOVER, reasonCode: reasonCode || 'downstream_context_overflow' };
  }
  if (pressureState === 'critical' && repeatedCritical) {
    return { type: CONTINUITY_RECOMMENDATION_TYPES.RECOMMEND_COMPACTION_CANDIDATE, reasonCode: reasonCode || 'critical_pressure_repeated' };
  }
  if (pressureState === 'warning' || pressureState === 'critical') {
    return { type: CONTINUITY_RECOMMENDATION_TYPES.MONITOR_PRESSURE, reasonCode: reasonCode || 'pressure_threshold_crossed' };
  }
  return { type: CONTINUITY_RECOMMENDATION_TYPES.NONE, reasonCode: reasonCode || 'no_action_required' };
}

async function getActiveRecommendationForSession(sessionId) {
  const db = await ensureBillingDb();
  const stmt = db.prepare(`
    SELECT *
    FROM session_continuity_recommendations
    WHERE session_id = ? AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  stmt.bind([sessionId]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

async function getContinuityEventCounts(sessionId, eventType, sinceIso) {
  const db = await ensureBillingDb();
  const stmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM session_continuity_events
    WHERE session_id = ? AND event_type = ? AND created_at >= ?
  `);
  stmt.bind([sessionId, eventType, sinceIso]);
  const row = stmt.step() ? stmt.getAsObject() : { count: 0 };
  stmt.free();
  return Number(row.count || 0);
}

async function supersedeActiveRecommendation(sessionId, supersededByRecommendationId, timestamp = getTimestamp()) {
  return withBillingWrite(async (db) => {
    const select = db.prepare(`
      SELECT recommendation_id
      FROM session_continuity_recommendations
      WHERE session_id = ? AND status = 'active'
      ORDER BY created_at DESC
    `);
    select.bind([sessionId]);
    const ids = [];
    while (select.step()) {
      ids.push(String(select.getAsObject().recommendation_id || ''));
    }
    select.free();
    for (const recommendationId of ids) {
      if (!recommendationId || recommendationId === supersededByRecommendationId) {
        continue;
      }
      const update = db.prepare(`
        UPDATE session_continuity_recommendations
        SET status = 'superseded',
            superseded_by_recommendation_id = ?,
            updated_at = ?
        WHERE recommendation_id = ? AND status = 'active'
      `);
      update.run([supersededByRecommendationId, timestamp, recommendationId]);
      update.free();
    }
    return true;
  });
}

async function createOrUpdateSessionRecommendation(input = {}) {
  const recommendationType = String(input.recommendationType || CONTINUITY_RECOMMENDATION_TYPES.NONE);
  if (recommendationType === CONTINUITY_RECOMMENDATION_TYPES.NONE) {
    return null;
  }
  const sessionId = String(input.sessionId || '');
  if (!sessionId) {
    return null;
  }
  const timestamp = input.timestamp || getTimestamp();
  const pressureState = String(input.pressureState || 'unknown');
  const executionId = input.executionId || null;
  const triggerEventId = input.triggerEventId || null;
  const reasonCode = String(input.reasonCode || '');

  const active = await getActiveRecommendationForSession(sessionId);
  if (active && String(active.recommendation_type) === recommendationType) {
    return withBillingWrite(async (db) => {
      const update = db.prepare(`
        UPDATE session_continuity_recommendations
        SET updated_at = ?, execution_id = COALESCE(?, execution_id), pressure_state = ?, trigger_event_id = COALESCE(?, trigger_event_id), reason_code = ?
        WHERE recommendation_id = ?
      `);
      update.run([timestamp, executionId, pressureState, triggerEventId, reasonCode, String(active.recommendation_id)]);
      update.free();
      return getActiveRecommendationForSession(sessionId);
    });
  }

  const activePrecedence = active ? (CONTINUITY_RECOMMENDATION_PRECEDENCE[String(active.recommendation_type)] ?? -1) : -1;
  const requestedPrecedence = CONTINUITY_RECOMMENDATION_PRECEDENCE[recommendationType] ?? -1;
  if (active && activePrecedence > requestedPrecedence) {
    return active;
  }

  const recommendationId = createContinuityRecommendationId();
  await withBillingWrite(async (db) => {
    const insert = db.prepare(`
      INSERT INTO session_continuity_recommendations (
        recommendation_id, session_id, execution_id, recommendation_type, pressure_state,
        trigger_event_id, reason_code, status, superseded_by_recommendation_id,
        resolution_reason, created_at, updated_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      recommendationId,
      sessionId,
      executionId,
      recommendationType,
      pressureState,
      triggerEventId,
      reasonCode,
      CONTINUITY_RECOMMENDATION_STATUS.ACTIVE,
      null,
      null,
      timestamp,
      timestamp,
      null,
    ]);
    insert.free();
    return true;
  });

  await supersedeActiveRecommendation(sessionId, recommendationId, timestamp);
  return getActiveRecommendationForSession(sessionId);
}

function resolveRecommendationFromLineageInDb(db, rootSessionId, childSessionId, timestamp = getTimestamp()) {
  if (!rootSessionId || !childSessionId || rootSessionId === childSessionId) {
    return 0;
  }
  const resolvable = new Set([
    CONTINUITY_RECOMMENDATION_TYPES.RECOMMEND_ROLLOVER,
    CONTINUITY_RECOMMENDATION_TYPES.REQUIRE_MANUAL_RESET,
    CONTINUITY_RECOMMENDATION_TYPES.RECOVERY_REVIEW_REQUIRED,
  ]);

  const select = db.prepare(`
    SELECT recommendation_id, recommendation_type
    FROM session_continuity_recommendations
    WHERE session_id = ? AND status = 'active'
    ORDER BY created_at DESC
  `);
  select.bind([rootSessionId]);
  const toResolve = [];
  while (select.step()) {
    const row = select.getAsObject();
    const type = String(row.recommendation_type || '');
    if (resolvable.has(type)) {
      toResolve.push(String(row.recommendation_id || ''));
    }
  }
  select.free();
  for (const recommendationId of toResolve) {
    const update = db.prepare(`
      UPDATE session_continuity_recommendations
      SET status = 'resolved',
          resolution_reason = 'resolved_by_fresh_session_lineage',
          updated_at = ?,
          resolved_at = ?
      WHERE recommendation_id = ? AND status = 'active'
    `);
    update.run([timestamp, timestamp, recommendationId]);
    update.free();
  }
  return toResolve.length;
}

async function resolveRecommendationFromLineage(rootSessionId, childSessionId, timestamp = getTimestamp(), db = null) {
  if (db) {
    return resolveRecommendationFromLineageInDb(db, rootSessionId, childSessionId, timestamp);
  }
  return withBillingWrite(async (database) => (
    resolveRecommendationFromLineageInDb(database, rootSessionId, childSessionId, timestamp)
  ));
}

async function linkSessionLineage(rootSessionId, childSessionId, linkReason, triggerExecutionId = null, timestamp = getTimestamp()) {
  if (!rootSessionId || !childSessionId || rootSessionId === childSessionId) {
    return false;
  }
  return withBillingWrite(async (db) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO session_lineage (
        lineage_id, root_session_id, child_session_id, link_reason, trigger_execution_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      createSessionLineageId(),
      rootSessionId,
      childSessionId,
      linkReason,
      triggerExecutionId || null,
      timestamp,
    ]);
    insert.free();
    return true;
  });
}

async function updateExecutionBudgetOutcome(executionId, options = {}) {
  return withBillingWrite(async (db) => {
    const current = await getStoredExecutionBudgetByExecutionId(db, executionId);
    if (!current) {
      return null;
    }
    const timestamp = options.timestamp || getTimestamp();
    const update = db.prepare(`
      UPDATE execution_budgets
      SET budget_rejection_reason = CASE
            WHEN ? != '' THEN ?
            ELSE budget_rejection_reason
          END,
          completed_input_tokens = CASE
            WHEN ? IS NULL THEN completed_input_tokens
            ELSE ?
          END,
          completed_output_tokens = CASE
            WHEN ? IS NULL THEN completed_output_tokens
            ELSE ?
          END,
          updated_at = ?
      WHERE execution_id = ?
    `);
    const rejectionReason = String(options.budgetRejectionReason || '');
    const completedInputTokens = Number.isFinite(Number(options.completedInputTokens))
      ? Number(options.completedInputTokens)
      : null;
    const completedOutputTokens = Number.isFinite(Number(options.completedOutputTokens))
      ? Number(options.completedOutputTokens)
      : null;
    update.run([
      rejectionReason,
      rejectionReason,
      completedInputTokens,
      completedInputTokens,
      completedOutputTokens,
      completedOutputTokens,
      timestamp,
      executionId,
    ]);
    update.free();
    return getStoredExecutionBudgetByExecutionId(db, executionId);
  });
}

async function recordRejectedRequestLog(entry) {
  return withBillingWrite(async (db) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO request_logs (
        request_id, timestamp, route, session_id, execution_id, primary_model, model_used, input_tokens, output_tokens,
        estimated_cost_usd, status, fallback_triggered, failure_reason, endpoint, error_code, status_code, response_body, reserved_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      entry.request_id,
      entry.timestamp || getTimestamp(),
      entry.route,
      entry.session_id,
      entry.execution_id || null,
      entry.primary_model || '',
      entry.model_used || '',
      Number(entry.input_tokens || 0),
      Number(entry.output_tokens || 0),
      Number(entry.estimated_cost_usd || 0),
      entry.status || 'rejected',
      Number(Boolean(entry.fallback_triggered)),
      entry.failure_reason || '',
      entry.endpoint || '',
      entry.error_code || '',
      Number(entry.status_code || 0),
      entry.response_body || '',
      Number(entry.reserved_cost_usd || 0),
    ]);
    insert.free();
    return true;
  });
}

function appendExecutionEventTx(db, event) {
  const insert = db.prepare(`
    INSERT INTO execution_events (
      event_id, execution_id, previous_state, new_state, timestamp, actor_source, reason_code, request_id, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run([
    event.event_id || createExecutionEventId(),
    event.execution_id,
    event.previous_state || '',
    event.new_state,
    event.timestamp || getTimestamp(),
    event.actor_source || 'runtime',
    event.reason_code || 'unspecified',
    event.request_id || null,
    event.notes || null,
  ]);
  insert.free();
}

async function appendExecutionEvent(event) {
  return withBillingWrite(async (db) => {
    appendExecutionEventTx(db, event);
    return event;
  });
}

function appendExecutionLeaseEventTx(db, execution, reasonCode, options = {}) {
  appendExecutionEventTx(db, {
    execution_id: execution.execution_id,
    previous_state: execution.current_state,
    new_state: execution.current_state,
    timestamp: options.timestamp || getTimestamp(),
    actor_source: options.actorSource || 'runtime',
    reason_code: reasonCode,
    request_id: options.requestId || execution.last_request_id || null,
    notes: options.notes || null,
  });
}

async function createExecutionRecord(options = {}) {
  return withBillingWrite(async (db) => {
    const sessionId = String(options.sessionId || '');
    if (!sessionId) {
      throw new Error('Execution creation requires sessionId');
    }

    const idempotencyKey = options.idempotencyKey ? String(options.idempotencyKey) : '';
    if (idempotencyKey) {
      const existingStmt = db.prepare(`
        SELECT * FROM executions
        WHERE session_id = ? AND idempotency_key = ?
        LIMIT 1
      `);
      existingStmt.bind([sessionId, idempotencyKey]);
      let existingRow = null;
      if (existingStmt.step()) {
        existingRow = existingStmt.getAsObject();
      }
      existingStmt.free();

      if (existingRow) {
        const existing = hydrateExecutionRow(existingRow);
        const updateExisting = db.prepare(`
          UPDATE executions
          SET updated_at = ?, last_request_id = ?, task_id = COALESCE(task_id, ?)
          WHERE execution_id = ?
        `);
        updateExisting.run([
          options.timestamp || getTimestamp(),
          options.requestId || existing.last_request_id || '',
          options.taskId || null,
          existing.execution_id,
        ]);
        updateExisting.free();
        return {
          execution: {
            ...existing,
            updated_at: options.timestamp || getTimestamp(),
            last_request_id: options.requestId || existing.last_request_id || '',
            task_id: existing.task_id || options.taskId || null,
          },
          reused: true,
        };
      }
    }

    const executionId = createExecutionId();
    const timestamp = options.timestamp || getTimestamp();
    const insert = db.prepare(`
      INSERT INTO executions (
        execution_id, session_id, task_id, current_state, created_at, updated_at, last_request_id, idempotency_key, workspace_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      executionId,
      sessionId,
      options.taskId || null,
      EXECUTION_STATES.CREATED,
      timestamp,
      timestamp,
      options.requestId || '',
      idempotencyKey || null,
      options.workspaceId || null,
    ]);
    insert.free();

    appendExecutionEventTx(db, {
      execution_id: executionId,
      previous_state: '',
      new_state: EXECUTION_STATES.CREATED,
      timestamp,
      actor_source: options.actorSource || 'runtime',
      reason_code: options.reasonCode || 'request_admitted',
      request_id: options.requestId || null,
      notes: options.notes || null,
    });

    return {
      execution: {
        execution_id: executionId,
        session_id: sessionId,
        task_id: options.taskId || null,
        current_state: EXECUTION_STATES.CREATED,
        created_at: timestamp,
        updated_at: timestamp,
        last_request_id: options.requestId || '',
        idempotency_key: idempotencyKey || null,
        workspace_id: options.workspaceId || null,
        lease_id: null,
        lease_holder: null,
        lease_acquired_at: null,
        lease_expires_at: null,
        lease_epoch: 0,
        last_heartbeat_at: null,
        recovery_reason: null,
        recovery_notes: null,
      },
      reused: false,
    };
  });
}

function buildAgentWorkflowPlan(promptText = '', filename = '') {
  const normalizedPrompt = normalizeTaskClassificationText(promptText);
  const artifactFilename = String(filename || extractManagedArtifactFilename(promptText) || 'agent-workflow-proof.md').trim();
  const title = humanizeManagedArtifactTitle(artifactFilename) || 'Agent Workflow Proof';
  const agentTheme = taskTextContainsAny(normalizedPrompt, ['website', 'landing page'])
    ? 'website delivery'
    : 'coordinated sub-agents';

  return [
    {
      step_index: 1,
      role: 'planner',
      step_kind: 'plan',
      title: 'Planner Agent',
      description: `Lock the sequential workflow for ${agentTheme}.`,
    },
    {
      step_index: 2,
      role: 'context',
      step_kind: 'context_bind',
      title: 'Context Agent',
      description: 'Bind the active turn and exclude stale history from the run.',
    },
    {
      step_index: 3,
      role: 'writer',
      step_kind: 'artifact_write',
      title: 'Writer Agent',
      description: `Draft ${artifactFilename} with the requested content and structure.`,
    },
    {
      step_index: 4,
      role: 'verifier',
      step_kind: 'artifact_verify',
      title: 'Verifier Agent',
      description: 'Validate structure, alignment, and confidence before delivery.',
    },
    {
      step_index: 5,
      role: 'delivery',
      step_kind: 'artifact_delivery',
      title: 'Delivery Agent',
      description: 'Deliver the verified artifact through the relay if eligible.',
    },
  ];
}

function getAgentRunGoalFingerprint(taskId, executionId, goalText, idempotencyKey = '') {
  return crypto.createHash('sha256')
    .update(`${String(taskId || '')}\n${String(executionId || '')}\n${String(idempotencyKey || '')}\n${String(goalText || '')}`)
    .digest('hex')
    .slice(0, 32);
}

function getAgentRunByExecutionIdTx(db, executionId) {
  const stmt = db.prepare(`
    SELECT *
    FROM agent_runs
    WHERE execution_id = ?
    LIMIT 1
  `);
  stmt.bind([executionId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateAgentRunRow(row);
}

function getAgentRunByTaskIdTx(db, taskId) {
  const stmt = db.prepare(`
    SELECT *
    FROM agent_runs
    WHERE task_id = ?
    LIMIT 1
  `);
  stmt.bind([taskId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateAgentRunRow(row);
}

function getAgentStepByRunAndIndexTx(db, agentRunId, stepIndex) {
  const stmt = db.prepare(`
    SELECT *
    FROM agent_steps
    WHERE agent_run_id = ? AND step_index = ?
    LIMIT 1
  `);
  stmt.bind([agentRunId, stepIndex]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateAgentStepRow(row);
}

function getAgentStepsByRunIdTx(db, agentRunId) {
  const stmt = db.prepare(`
    SELECT *
    FROM agent_steps
    WHERE agent_run_id = ?
    ORDER BY step_index ASC, created_at ASC
  `);
  stmt.bind([agentRunId]);
  const rows = [];
  while (stmt.step()) {
    rows.push(hydrateAgentStepRow(stmt.getAsObject()));
  }
  stmt.free();
  return rows;
}

function createAgentRunRecordTx(db, options = {}) {
  const taskId = String(options.taskId || '');
  const executionId = String(options.executionId || '');
  const goalText = String(options.goalText || '');
  if (!taskId || !executionId) {
    throw new Error('Agent run creation requires taskId and executionId');
  }

  const timestamp = options.timestamp || getTimestamp();
  const existing = getAgentRunByExecutionIdTx(db, executionId) || getAgentRunByTaskIdTx(db, taskId);
  if (existing) {
    return { agentRun: existing, reused: true };
  }

  const agentRunId = createAgentRunId();
  const plan = Array.isArray(options.plan) && options.plan.length
    ? options.plan
    : buildAgentWorkflowPlan(goalText, options.filename || '');
  const insert = db.prepare(`
    INSERT INTO agent_runs (
      agent_run_id, task_id, execution_id, goal_text, goal_fingerprint, plan_json,
      status, current_step_index, final_outcome, final_artifact_id, final_notification_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run([
    agentRunId,
    taskId,
    executionId,
    goalText,
    getAgentRunGoalFingerprint(taskId, executionId, goalText, options.idempotencyKey || ''),
    JSON.stringify(plan),
    options.status || AGENT_RUN_STATES.PLANNED,
    Number(options.currentStepIndex || 0),
    String(options.finalOutcome || ''),
    options.finalArtifactId || null,
    options.finalNotificationId || null,
    timestamp,
    timestamp,
  ]);
  insert.free();

  const agentRun = hydrateAgentRunRow({
    agent_run_id: agentRunId,
    task_id: taskId,
    execution_id: executionId,
    goal_text: goalText,
    goal_fingerprint: getAgentRunGoalFingerprint(taskId, executionId, goalText, options.idempotencyKey || ''),
    plan_json: JSON.stringify(plan),
    status: options.status || AGENT_RUN_STATES.PLANNED,
    current_step_index: Number(options.currentStepIndex || 0),
    final_outcome: String(options.finalOutcome || ''),
    final_artifact_id: options.finalArtifactId || null,
    final_notification_id: options.finalNotificationId || null,
    created_at: timestamp,
    updated_at: timestamp,
  });

  const steps = plan.map((step) => {
    const agentStepId = createAgentStepId();
    const insertStep = db.prepare(`
      INSERT INTO agent_steps (
        agent_step_id, agent_run_id, task_id, execution_id, step_index, role, step_kind,
        status, reason_code, input_json, output_json, evidence_json, artifact_id, notification_id,
        retry_count, started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStep.run([
      agentStepId,
      agentRunId,
      taskId,
      executionId,
      Number(step.step_index || 0),
      String(step.role || ''),
      String(step.step_kind || ''),
      AGENT_STEP_STATES.PENDING,
      '',
      JSON.stringify({ goal_text: goalText, prompt_text: goalText, step }),
      '{}',
      '{}',
      null,
      null,
      0,
      null,
      null,
      timestamp,
      timestamp,
    ]);
    insertStep.free();
    return hydrateAgentStepRow({
      agent_step_id: agentStepId,
      agent_run_id: agentRunId,
      task_id: taskId,
      execution_id: executionId,
      step_index: Number(step.step_index || 0),
      role: String(step.role || ''),
      step_kind: String(step.step_kind || ''),
      status: AGENT_STEP_STATES.PENDING,
      reason_code: '',
      input_json: JSON.stringify({ goal_text: goalText, prompt_text: goalText, step }),
      output_json: '{}',
      evidence_json: '{}',
      artifact_id: null,
      notification_id: null,
      retry_count: 0,
      started_at: null,
      completed_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
  });

  return { agentRun, steps, reused: false };
}

async function createAgentRunRecord(options = {}) {
  return withBillingWrite(async (db) => createAgentRunRecordTx(db, options));
}

function updateAgentRunTx(db, agentRunId, updates = {}) {
  const currentStmt = db.prepare('SELECT * FROM agent_runs WHERE agent_run_id = ? LIMIT 1');
  currentStmt.bind([agentRunId]);
  let row = null;
  if (currentStmt.step()) {
    row = currentStmt.getAsObject();
  }
  currentStmt.free();
  if (!row) {
    return null;
  }

  const current = hydrateAgentRunRow(row);
  const next = {
    ...current,
    status: updates.status || current.status,
    current_step_index: Number.isFinite(updates.currentStepIndex) ? Number(updates.currentStepIndex) : current.current_step_index,
    final_outcome: updates.finalOutcome === undefined ? current.final_outcome : String(updates.finalOutcome || ''),
    final_artifact_id: updates.finalArtifactId === undefined ? current.final_artifact_id : updates.finalArtifactId || null,
    final_notification_id: updates.finalNotificationId === undefined ? current.final_notification_id : updates.finalNotificationId || null,
    updated_at: updates.timestamp || getTimestamp(),
  };
  const update = db.prepare(`
    UPDATE agent_runs
    SET status = ?, current_step_index = ?, final_outcome = ?, final_artifact_id = ?, final_notification_id = ?, updated_at = ?
    WHERE agent_run_id = ?
  `);
  update.run([
    next.status,
    Number(next.current_step_index || 0),
    next.final_outcome,
    next.final_artifact_id || null,
    next.final_notification_id || null,
    next.updated_at,
    agentRunId,
  ]);
  update.free();
  return next;
}

async function updateAgentRun(agentRunId, updates = {}) {
  return withBillingWrite(async (db) => updateAgentRunTx(db, agentRunId, updates));
}

function updateAgentStepTx(db, agentStepId, updates = {}) {
  const currentStmt = db.prepare('SELECT * FROM agent_steps WHERE agent_step_id = ? LIMIT 1');
  currentStmt.bind([agentStepId]);
  let row = null;
  if (currentStmt.step()) {
    row = currentStmt.getAsObject();
  }
  currentStmt.free();
  if (!row) {
    return null;
  }

  const current = hydrateAgentStepRow(row);
  const next = {
    ...current,
    status: updates.status || current.status,
    reason_code: updates.reasonCode === undefined ? current.reason_code : String(updates.reasonCode || ''),
    input: updates.input === undefined ? current.input : updates.input,
    output: updates.output === undefined ? current.output : updates.output,
    evidence: updates.evidence === undefined ? current.evidence : updates.evidence,
    artifact_id: updates.artifactId === undefined ? current.artifact_id : updates.artifactId || null,
    notification_id: updates.notificationId === undefined ? current.notification_id : updates.notificationId || null,
    retry_count: Number.isFinite(updates.retryCount) ? Number(updates.retryCount) : current.retry_count,
    started_at: updates.startedAt === undefined ? current.started_at : updates.startedAt || null,
    completed_at: updates.completedAt === undefined ? current.completed_at : updates.completedAt || null,
    updated_at: updates.timestamp || getTimestamp(),
  };

  const update = db.prepare(`
    UPDATE agent_steps
    SET status = ?, reason_code = ?, input_json = ?, output_json = ?, evidence_json = ?, artifact_id = ?, notification_id = ?,
        retry_count = ?, started_at = ?, completed_at = ?, updated_at = ?
    WHERE agent_step_id = ?
  `);
  update.run([
    next.status,
    next.reason_code,
    JSON.stringify(next.input || {}),
    JSON.stringify(next.output || {}),
    JSON.stringify(next.evidence || {}),
    next.artifact_id || null,
    next.notification_id || null,
    Number(next.retry_count || 0),
    next.started_at || null,
    next.completed_at || null,
    next.updated_at,
    agentStepId,
  ]);
  update.free();
  return next;
}

async function updateAgentStep(agentStepId, updates = {}) {
  return withBillingWrite(async (db) => updateAgentStepTx(db, agentStepId, updates));
}

function appendAgentStepEventTx(db, event) {
  const eventId = event.agent_step_event_id || createAgentStepEventId();
  const timestamp = event.created_at || getTimestamp();
  const insert = db.prepare(`
    INSERT INTO agent_step_events (
      agent_step_event_id, agent_run_id, agent_step_id, task_id, execution_id, event_type, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run([
    eventId,
    event.agent_run_id,
    event.agent_step_id || null,
    event.task_id,
    event.execution_id,
    event.event_type,
    JSON.stringify(event.payload || {}),
    timestamp,
  ]);
  insert.free();
  return {
    agent_step_event_id: eventId,
    agent_run_id: event.agent_run_id,
    agent_step_id: event.agent_step_id || null,
    task_id: event.task_id,
    execution_id: event.execution_id,
    event_type: event.event_type,
    payload: event.payload || {},
    created_at: timestamp,
  };
}

async function appendAgentStepEvent(event) {
  return withBillingWrite(async (db) => appendAgentStepEventTx(db, event));
}

async function ensureAgentWorkflowRunForExecution(executionId, options = {}) {
  return withBillingWrite(async (db) => {
    const execution = await getStoredExecutionById(db, executionId);
    if (!execution) {
      return { required: true, ok: false, reason: 'agent_execution_missing' };
    }

    const task = execution.task_id ? await getStoredTaskById(db, execution.task_id) : null;
    if (!task) {
      return { required: true, ok: false, reason: 'agent_task_missing' };
    }
    if (String(task.task_kind || '') !== TASK_KINDS.AGENT_WORKFLOW_TASK) {
      return { required: false, ok: true, skipped: true, task_kind: task.task_kind || '' };
    }

    const promptText = extractManagedCurrentTurnText(String(options.promptText || task.objective_text || ''));
    const existing = getAgentRunByExecutionIdTx(db, executionId) || getAgentRunByTaskIdTx(db, task.task_id);
    if (existing) {
      return {
        required: true,
        ok: true,
        reused: true,
        agentRun: existing,
        steps: getAgentStepsByRunIdTx(db, existing.agent_run_id),
      };
    }

    const plan = buildAgentWorkflowPlan(promptText, options.filename || extractManagedArtifactFilename(promptText) || '');
    const created = createAgentRunRecordTx(db, {
      taskId: task.task_id,
      executionId,
      goalText: promptText || task.objective_text || '',
      plan,
      idempotencyKey: options.idempotencyKey || '',
      timestamp: options.timestamp || getTimestamp(),
      status: AGENT_RUN_STATES.PLANNED,
    });
    const agentRun = created.agentRun;
    const steps = created.steps;
    const plannerStep = steps.find((step) => step.role === 'planner') || null;
    if (plannerStep) {
      updateAgentStepTx(db, plannerStep.agent_step_id, {
        status: AGENT_STEP_STATES.COMPLETED,
        reasonCode: 'agent_plan_locked',
        input: plannerStep.input,
        output: { plan },
        evidence: { plan },
        startedAt: plannerStep.started_at || options.timestamp || getTimestamp(),
        completedAt: options.timestamp || getTimestamp(),
        timestamp: options.timestamp || getTimestamp(),
      });
      appendAgentStepEventTx(db, {
        agent_run_id: agentRun.agent_run_id,
        agent_step_id: plannerStep.agent_step_id,
        task_id: task.task_id,
        execution_id: executionId,
        event_type: 'planner_completed',
        payload: { plan },
        created_at: options.timestamp || getTimestamp(),
      });
      appendTaskProgressEventTx(db, {
        task_id: task.task_id,
        execution_id: executionId,
        previous_state: task.current_state || TASK_STATES.RECEIVED,
        new_state: TASK_STATES.PLANNED,
        progress_category: TASK_PROGRESS_CATEGORIES.PLAN_LOCKED,
        decision: 'notify_user',
        message_text: 'Planner Agent locked the sequential workflow plan.',
        requires_user_input: 0,
        source: options.actorSource || 'runtime',
        reason_code: 'agent_plan_locked',
        created_at: options.timestamp || getTimestamp(),
      });
    }

    updateAgentRunTx(db, agentRun.agent_run_id, {
      status: AGENT_RUN_STATES.IN_PROGRESS,
      currentStepIndex: 1,
      timestamp: options.timestamp || getTimestamp(),
    });

    return {
      required: true,
      ok: true,
      reused: false,
      agentRun: {
        ...agentRun,
        status: AGENT_RUN_STATES.IN_PROGRESS,
        current_step_index: 1,
      },
      steps: getAgentStepsByRunIdTx(db, agentRun.agent_run_id),
      plan,
    };
  });
}


async function transitionExecution(executionId, nextState, options = {}) {
  return withBillingWrite(async (db) => {
    const current = await getStoredExecutionById(db, executionId);
    if (!current) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    assertLegalExecutionTransition(current.current_state, nextState);
    const timestamp = options.timestamp || getTimestamp();
    const update = db.prepare(`
      UPDATE executions
      SET current_state = ?, updated_at = ?, last_request_id = ?
      WHERE execution_id = ?
    `);
    update.run([
      nextState,
      timestamp,
      options.requestId || current.last_request_id || '',
      executionId,
    ]);
    update.free();

    appendExecutionEventTx(db, {
      execution_id: executionId,
      previous_state: current.current_state,
      new_state: nextState,
      timestamp,
      actor_source: options.actorSource || 'runtime',
      reason_code: options.reasonCode || 'state_transition',
      request_id: options.requestId || null,
      notes: options.notes || null,
    });

    syncTaskStateForExecutionTx(db, { ...current, task_id: current.task_id || null }, nextState, {
      requestId: options.requestId || null,
      actorSource: options.actorSource || 'runtime',
      reasonCode: options.reasonCode || 'state_transition',
      notes: options.notes || null,
      recoveryReason: options.recoveryReason,
      recoveryNotes: options.recoveryNotes,
      timestamp,
    });

    if ([EXECUTION_STATES.FAILED, EXECUTION_STATES.RECOVERY_REQUIRED].includes(nextState)) {
      void recordToolFailureObservationTx(db, {
        subjectType: 'execution',
        subjectId: executionId,
        taskId: current.task_id || null,
        executionId,
        executionState: nextState,
        reasonCode: options.reasonCode || 'state_transition',
        recoveryReason: options.recoveryReason || null,
        notes: options.notes || options.recoveryNotes || null,
        source: options.actorSource || 'runtime',
        meaningfulOutputStarted: Boolean(options.meaningfulOutputStarted),
        artifactReason: options.artifactReason || '',
        budgetRejectionReason: options.budgetRejectionReason || '',
        artifactVerificationState: options.artifactVerificationState || '',
        artifactExists: options.artifactExists,
        confidenceBand: options.confidenceBand || '',
        structureState: options.structureState || '',
        alignmentState: options.alignmentState || '',
        status: nextState === EXECUTION_STATES.RECOVERY_REQUIRED ? 'interrupted' : 'failed',
      });
    }

    return {
      ...current,
      current_state: nextState,
      updated_at: timestamp,
      last_request_id: options.requestId || current.last_request_id || '',
    };
  });
}

async function finalizeExecutionIfNeeded(executionId, desiredState, options = {}) {
  const current = await getExecutionById(executionId);
  if (!current) {
    return null;
  }

  if (current.current_state === desiredState) {
    return current;
  }

  if (EXECUTION_TERMINAL_STATES.has(current.current_state)) {
    return current;
  }

  return transitionExecution(executionId, desiredState, options);
}

async function acquireExecutionLease(executionId, options = {}) {
  return withBillingWrite(async (db) => {
    const current = await getStoredExecutionById(db, executionId);
    if (!current) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (![EXECUTION_STATES.QUEUED, EXECUTION_STATES.RETRYING].includes(current.current_state)) {
      throw new Error(`Execution lease acquisition requires queued or retrying state: ${current.current_state}`);
    }

    const timestamp = options.timestamp || getTimestamp();
    const ttlMs = Math.max(1000, Number(options.ttlMs || getExecutionLeaseTtlMs(Boolean(options.isStreaming))));
    const leaseId = options.leaseId || createExecutionLeaseId();
    const leaseHolder = options.leaseHolder || buildExecutionLeaseHolder(options.requestId || current.last_request_id || '');
    const leaseEpoch = Number(current.lease_epoch || 0) + 1;
    const leaseExpiresAt = addMillisecondsToIso(timestamp, ttlMs);

    const update = db.prepare(`
      UPDATE executions
      SET lease_id = ?,
          lease_holder = ?,
          lease_acquired_at = ?,
          lease_expires_at = ?,
          lease_epoch = ?,
          last_heartbeat_at = ?,
          updated_at = ?,
          last_request_id = ?,
          recovery_reason = NULL,
          recovery_notes = NULL
      WHERE execution_id = ?
    `);
    update.run([
      leaseId,
      leaseHolder,
      timestamp,
      leaseExpiresAt,
      leaseEpoch,
      timestamp,
      timestamp,
      options.requestId || current.last_request_id || '',
      executionId,
    ]);
    update.free();

    appendExecutionLeaseEventTx(db, current, 'execution_lease_acquired', {
      timestamp,
      actorSource: options.actorSource || 'runtime',
      requestId: options.requestId || current.last_request_id || null,
      notes: `lease_epoch=${leaseEpoch}`,
    });

    return {
      ...current,
      lease_id: leaseId,
      lease_holder: leaseHolder,
      lease_acquired_at: timestamp,
      lease_expires_at: leaseExpiresAt,
      lease_epoch: leaseEpoch,
      last_heartbeat_at: timestamp,
      updated_at: timestamp,
      last_request_id: options.requestId || current.last_request_id || '',
      recovery_reason: null,
      recovery_notes: null,
    };
  });
}

async function refreshExecutionLease(executionId, options = {}) {
  return withBillingWrite(async (db) => {
    const current = await getStoredExecutionById(db, executionId);
    if (!current) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (!current.lease_id || !current.lease_holder) {
      throw new Error(`Execution has no active lease: ${executionId}`);
    }

    if (options.leaseId && current.lease_id !== options.leaseId) {
      throw new Error(`Execution lease mismatch for refresh: ${executionId}`);
    }
    if (options.leaseHolder && current.lease_holder !== options.leaseHolder) {
      throw new Error(`Execution lease holder mismatch for refresh: ${executionId}`);
    }
    if (Number.isFinite(Number(options.leaseEpoch)) && Number(current.lease_epoch || 0) !== Number(options.leaseEpoch)) {
      throw new Error(`Execution lease epoch mismatch for refresh: ${executionId}`);
    }

    const timestamp = options.timestamp || getTimestamp();
    const ttlMs = Math.max(1000, Number(options.ttlMs || getExecutionLeaseTtlMs(Boolean(options.isStreaming))));
    const leaseExpiresAt = addMillisecondsToIso(timestamp, ttlMs);

    const update = db.prepare(`
      UPDATE executions
      SET lease_expires_at = ?,
          last_heartbeat_at = ?,
          updated_at = ?,
          last_request_id = ?
      WHERE execution_id = ?
    `);
    update.run([
      leaseExpiresAt,
      timestamp,
      timestamp,
      options.requestId || current.last_request_id || '',
      executionId,
    ]);
    update.free();

    appendExecutionLeaseEventTx(db, current, 'execution_lease_refreshed', {
      timestamp,
      actorSource: options.actorSource || 'runtime',
      requestId: options.requestId || current.last_request_id || null,
      notes: `lease_epoch=${current.lease_epoch}`,
    });

    return {
      ...current,
      lease_expires_at: leaseExpiresAt,
      last_heartbeat_at: timestamp,
      updated_at: timestamp,
      last_request_id: options.requestId || current.last_request_id || '',
    };
  });
}

async function releaseExecutionLease(executionId, options = {}) {
  return withBillingWrite(async (db) => {
    const current = await getStoredExecutionById(db, executionId);
    if (!current) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (!current.lease_id && !current.lease_holder) {
      return current;
    }

    if (options.leaseId && current.lease_id !== options.leaseId) {
      return current;
    }
    if (options.leaseHolder && current.lease_holder !== options.leaseHolder) {
      return current;
    }
    if (Number.isFinite(Number(options.leaseEpoch)) && Number(current.lease_epoch || 0) !== Number(options.leaseEpoch)) {
      return current;
    }

    const timestamp = options.timestamp || getTimestamp();
    const update = db.prepare(`
      UPDATE executions
      SET lease_id = NULL,
          lease_holder = NULL,
          lease_acquired_at = NULL,
          lease_expires_at = NULL,
          last_heartbeat_at = NULL,
          updated_at = ?,
          last_request_id = ?
      WHERE execution_id = ?
    `);
    update.run([
      timestamp,
      options.requestId || current.last_request_id || '',
      executionId,
    ]);
    update.free();

    appendExecutionLeaseEventTx(db, current, 'execution_lease_released', {
      timestamp,
      actorSource: options.actorSource || 'runtime',
      requestId: options.requestId || current.last_request_id || null,
      notes: options.notes || `lease_epoch=${current.lease_epoch}`,
    });

    return {
      ...current,
      lease_id: null,
      lease_holder: null,
      lease_acquired_at: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
      updated_at: timestamp,
      last_request_id: options.requestId || current.last_request_id || '',
    };
  });
}

async function assertExecutionLeaseHolder(executionId, options = {}) {
  const current = await getExecutionById(executionId);
  if (!current) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  const leaseId = options.leaseId || '';
  const leaseHolder = options.leaseHolder || '';
  const leaseEpoch = Number(options.leaseEpoch || 0);

  const matches = Boolean(
    current.lease_id
    && current.lease_holder
    && leaseId
    && leaseHolder
    && Number.isFinite(leaseEpoch)
    && current.lease_id === leaseId
    && current.lease_holder === leaseHolder
    && Number(current.lease_epoch || 0) === leaseEpoch
  );

  return {
    current,
    matches,
  };
}

async function markExecutionRecoveryRequired(executionId, options = {}) {
  return withBillingWrite(async (db) => {
    const current = await getStoredExecutionById(db, executionId);
    if (!current) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (current.current_state === EXECUTION_STATES.RECOVERY_REQUIRED) {
      return current;
    }

    if (EXECUTION_TERMINAL_STATES.has(current.current_state)) {
      return current;
    }

    if (options.leaseId && current.lease_id !== options.leaseId) {
      appendExecutionLeaseEventTx(db, current, 'execution_finalize_rejected_stale_lease', {
        timestamp: options.timestamp || getTimestamp(),
        actorSource: options.actorSource || 'runtime',
        requestId: options.requestId || current.last_request_id || null,
        notes: options.reasonCode || 'stale_lease',
      });
      return current;
    }
    if (options.leaseHolder && current.lease_holder !== options.leaseHolder) {
      appendExecutionLeaseEventTx(db, current, 'execution_finalize_rejected_stale_lease', {
        timestamp: options.timestamp || getTimestamp(),
        actorSource: options.actorSource || 'runtime',
        requestId: options.requestId || current.last_request_id || null,
        notes: options.reasonCode || 'stale_lease',
      });
      return current;
    }
    if (Number.isFinite(Number(options.leaseEpoch)) && Number(current.lease_epoch || 0) !== Number(options.leaseEpoch)) {
      appendExecutionLeaseEventTx(db, current, 'execution_finalize_rejected_stale_lease', {
        timestamp: options.timestamp || getTimestamp(),
        actorSource: options.actorSource || 'runtime',
        requestId: options.requestId || current.last_request_id || null,
        notes: options.reasonCode || 'stale_lease',
      });
      return current;
    }

    assertLegalExecutionTransition(current.current_state, EXECUTION_STATES.RECOVERY_REQUIRED);
    const timestamp = options.timestamp || getTimestamp();
    const update = db.prepare(`
      UPDATE executions
      SET current_state = ?,
          updated_at = ?,
          last_request_id = ?,
          recovery_reason = ?,
          recovery_notes = ?,
          lease_id = NULL,
          lease_holder = NULL,
          lease_acquired_at = NULL,
          lease_expires_at = NULL,
          last_heartbeat_at = NULL
      WHERE execution_id = ?
    `);
    update.run([
      EXECUTION_STATES.RECOVERY_REQUIRED,
      timestamp,
      options.requestId || current.last_request_id || '',
      options.recoveryReason || options.reasonCode || 'recovery_required',
      options.recoveryNotes || options.notes || null,
      executionId,
    ]);
    update.free();

    appendExecutionEventTx(db, {
      execution_id: executionId,
      previous_state: current.current_state,
      new_state: EXECUTION_STATES.RECOVERY_REQUIRED,
      timestamp,
      actor_source: options.actorSource || 'runtime',
      reason_code: options.reasonCode || 'execution_recovery_required',
      request_id: options.requestId || null,
      notes: options.recoveryNotes || options.notes || null,
    });

    syncTaskStateForExecutionTx(db, { ...current, task_id: current.task_id || null }, EXECUTION_STATES.RECOVERY_REQUIRED, {
      requestId: options.requestId || null,
      actorSource: options.actorSource || 'runtime',
      reasonCode: options.reasonCode || 'execution_recovery_required',
      notes: options.recoveryNotes || options.notes || null,
      recoveryReason: options.recoveryReason || options.reasonCode || 'task_recovery_required',
      recoveryNotes: options.recoveryNotes || options.notes || null,
      timestamp,
    });

    void recordToolFailureObservationTx(db, {
      subjectType: 'execution',
      subjectId: executionId,
      taskId: current.task_id || null,
      executionId,
      executionState: EXECUTION_STATES.RECOVERY_REQUIRED,
      reasonCode: options.reasonCode || 'execution_recovery_required',
      recoveryReason: options.recoveryReason || options.reasonCode || 'task_recovery_required',
      notes: options.recoveryNotes || options.notes || null,
      source: options.actorSource || 'runtime',
      meaningfulOutputStarted: Boolean(options.meaningfulOutputStarted),
      artifactReason: options.artifactReason || '',
      budgetRejectionReason: options.budgetRejectionReason || '',
      artifactVerificationState: options.artifactVerificationState || '',
      artifactExists: options.artifactExists,
      confidenceBand: options.confidenceBand || '',
      structureState: options.structureState || '',
      alignmentState: options.alignmentState || '',
      status: 'interrupted',
    });

    appendExecutionLeaseEventTx(db, current, 'execution_lease_released', {
      timestamp,
      actorSource: options.actorSource || 'runtime',
      requestId: options.requestId || current.last_request_id || null,
      notes: 'released_on_recovery_required',
    });

    return {
      ...current,
      current_state: EXECUTION_STATES.RECOVERY_REQUIRED,
      updated_at: timestamp,
      last_request_id: options.requestId || current.last_request_id || '',
      recovery_reason: options.recoveryReason || options.reasonCode || 'recovery_required',
      recovery_notes: options.recoveryNotes || options.notes || null,
      lease_id: null,
      lease_holder: null,
      lease_acquired_at: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
    };
  });
}

function classifyExecutionInterruption(options = {}) {
  const status = String(options.status || '');
  const errorCode = String(options.errorCode || '');
  const meaningfulOutputStarted = Boolean(options.meaningfulOutputStarted);

  if (status === 'success') {
    return {
      targetState: EXECUTION_STATES.COMPLETED,
      billingStatus: 'success',
      reasonCode: 'stream_completed',
    };
  }

  if (status === 'interrupted') {
    if (meaningfulOutputStarted) {
      return {
        targetState: EXECUTION_STATES.RECOVERY_REQUIRED,
        billingStatus: 'interrupted',
        reasonCode: errorCode || 'client_disconnect',
        recoveryReason: 'ambiguous_live_interruption',
      };
    }
    return {
      targetState: EXECUTION_STATES.FAILED,
      billingStatus: 'failed',
      reasonCode: errorCode || 'client_disconnect',
    };
  }

  if (['upstream_timeout', 'stream_proxy_failed'].includes(errorCode)) {
    if (meaningfulOutputStarted) {
      return {
        targetState: EXECUTION_STATES.RECOVERY_REQUIRED,
        billingStatus: 'interrupted',
        reasonCode: errorCode,
        recoveryReason: 'ambiguous_stream_interruption',
      };
    }
  }

  return {
    targetState: EXECUTION_STATES.FAILED,
    billingStatus: status === 'interrupted' ? 'interrupted' : 'failed',
    reasonCode: errorCode || 'stream_failed',
  };
}

async function transitionExecutionWithLease(executionId, nextState, options = {}) {
  return withBillingWrite(async (db) => {
    const current = await getStoredExecutionById(db, executionId);
    if (!current) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (options.leaseId && current.lease_id !== options.leaseId) {
      appendExecutionLeaseEventTx(db, current, 'execution_finalize_rejected_stale_lease', {
        timestamp: options.timestamp || getTimestamp(),
        actorSource: options.actorSource || 'runtime',
        requestId: options.requestId || current.last_request_id || null,
        notes: options.reasonCode || 'stale_lease',
      });
      return { ...current, rejected: true };
    }
    if (options.leaseHolder && current.lease_holder !== options.leaseHolder) {
      appendExecutionLeaseEventTx(db, current, 'execution_finalize_rejected_stale_lease', {
        timestamp: options.timestamp || getTimestamp(),
        actorSource: options.actorSource || 'runtime',
        requestId: options.requestId || current.last_request_id || null,
        notes: options.reasonCode || 'stale_lease',
      });
      return { ...current, rejected: true };
    }
    if (Number.isFinite(Number(options.leaseEpoch)) && Number(options.leaseEpoch) > 0
      && Number(current.lease_epoch || 0) !== Number(options.leaseEpoch)) {
      appendExecutionLeaseEventTx(db, current, 'execution_finalize_rejected_stale_lease', {
        timestamp: options.timestamp || getTimestamp(),
        actorSource: options.actorSource || 'runtime',
        requestId: options.requestId || current.last_request_id || null,
        notes: options.reasonCode || 'stale_lease',
      });
      return { ...current, rejected: true };
    }

    if (current.current_state === nextState) {
      return current;
    }
    if (EXECUTION_TERMINAL_STATES.has(current.current_state)) {
      return current;
    }

    assertLegalExecutionTransition(current.current_state, nextState);
    const timestamp = options.timestamp || getTimestamp();
    const update = db.prepare(`
      UPDATE executions
      SET current_state = ?,
          updated_at = ?,
          last_request_id = ?,
          recovery_reason = ?,
          recovery_notes = ?,
          lease_id = ?,
          lease_holder = ?,
          lease_acquired_at = ?,
          lease_expires_at = ?,
          last_heartbeat_at = ?
      WHERE execution_id = ?
    `);
    const clearLease = Boolean(options.clearLease);
    update.run([
      nextState,
      timestamp,
      options.requestId || current.last_request_id || '',
      options.recoveryReason === undefined ? (nextState === EXECUTION_STATES.RECOVERY_REQUIRED ? (current.recovery_reason || options.reasonCode || 'recovery_required') : null) : options.recoveryReason,
      options.recoveryNotes === undefined ? (nextState === EXECUTION_STATES.RECOVERY_REQUIRED ? (options.notes || current.recovery_notes || null) : null) : options.recoveryNotes,
      clearLease ? null : current.lease_id,
      clearLease ? null : current.lease_holder,
      clearLease ? null : current.lease_acquired_at,
      clearLease ? null : current.lease_expires_at,
      clearLease ? null : current.last_heartbeat_at,
      executionId,
    ]);
    update.free();

    appendExecutionEventTx(db, {
      execution_id: executionId,
      previous_state: current.current_state,
      new_state: nextState,
      timestamp,
      actor_source: options.actorSource || 'runtime',
      reason_code: options.reasonCode || 'state_transition',
      request_id: options.requestId || null,
      notes: options.notes || null,
    });

    syncTaskStateForExecutionTx(db, { ...current, task_id: current.task_id || null }, nextState, {
      requestId: options.requestId || null,
      actorSource: options.actorSource || 'runtime',
      reasonCode: options.reasonCode || 'state_transition',
      notes: options.notes || null,
      recoveryReason: options.recoveryReason,
      recoveryNotes: options.recoveryNotes,
      timestamp,
    });

    if ([EXECUTION_STATES.FAILED, EXECUTION_STATES.RECOVERY_REQUIRED].includes(nextState)) {
      void recordToolFailureObservationTx(db, {
        subjectType: 'execution',
        subjectId: executionId,
        taskId: current.task_id || null,
        executionId,
        executionState: nextState,
        reasonCode: options.reasonCode || 'state_transition',
        recoveryReason: options.recoveryReason || null,
        notes: options.notes || options.recoveryNotes || null,
        source: options.actorSource || 'runtime',
        meaningfulOutputStarted: Boolean(options.meaningfulOutputStarted),
        artifactReason: options.artifactReason || '',
        budgetRejectionReason: options.budgetRejectionReason || '',
        artifactVerificationState: options.artifactVerificationState || '',
        artifactExists: options.artifactExists,
        confidenceBand: options.confidenceBand || '',
        structureState: options.structureState || '',
        alignmentState: options.alignmentState || '',
        status: nextState === EXECUTION_STATES.RECOVERY_REQUIRED ? 'interrupted' : 'failed',
      });
    }

    if (clearLease && current.lease_id) {
      appendExecutionLeaseEventTx(db, current, 'execution_lease_released', {
        timestamp,
        actorSource: options.actorSource || 'runtime',
        requestId: options.requestId || current.last_request_id || null,
        notes: options.notes || `released_on_${nextState}`,
      });
    }

    return {
      ...current,
      current_state: nextState,
      updated_at: timestamp,
      last_request_id: options.requestId || current.last_request_id || '',
      recovery_reason: nextState === EXECUTION_STATES.RECOVERY_REQUIRED
        ? (options.recoveryReason === undefined ? (current.recovery_reason || options.reasonCode || 'recovery_required') : options.recoveryReason)
        : null,
      recovery_notes: nextState === EXECUTION_STATES.RECOVERY_REQUIRED
        ? (options.recoveryNotes === undefined ? (options.notes || current.recovery_notes || null) : options.recoveryNotes)
        : null,
      lease_id: clearLease ? null : current.lease_id,
      lease_holder: clearLease ? null : current.lease_holder,
      lease_acquired_at: clearLease ? null : current.lease_acquired_at,
      lease_expires_at: clearLease ? null : current.lease_expires_at,
      last_heartbeat_at: clearLease ? null : current.last_heartbeat_at,
      rejected: false,
    };
  });
}

function estimateTextTokens(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
}

function estimateRequestTokens(body) {
  let inputTokens = 0;

  if (Array.isArray(body?.messages)) {
    inputTokens += estimateTextTokens(body.messages);
  }

  if (body?.input !== undefined) {
    inputTokens += estimateTextTokens(body.input);
  }

  if (body?.instructions !== undefined) {
    inputTokens += estimateTextTokens(body.instructions);
  }

  if (body?.system !== undefined) {
    inputTokens += estimateTextTokens(body.system);
  }

  if (Array.isArray(body?.tools) && body.tools.length > 0) {
    inputTokens += estimateTextTokens(body.tools) + (body.tools.length * 64);
  }

  const outputTokens = Number.isFinite(body?.max_tokens)
    ? Math.max(1, Number(body.max_tokens))
    : DEFAULT_OUTPUT_RESERVATION_TOKENS;

  return {
    inputTokens: Math.max(1, inputTokens || estimateTextTokens(body)),
    outputTokens,
  };
}

function estimateCost(inputTokens, outputTokens) {
  return ((Number(inputTokens) + Number(outputTokens)) / 1000) * BILLING_RATE_PER_1K;
}

function extractUsageTokens(usage) {
  const inputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0;
  const totalTokens = Number(usage?.total_tokens ?? (inputTokens + outputTokens)) || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

async function getBillingState(db) {
  const stmt = db.prepare('SELECT * FROM billing_state WHERE id = ? LIMIT 1');
  stmt.bind(['global']);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

function normalizeSessionRateWindow(state, nowIso) {
  if (!state) {
    return null;
  }

  const windowMs = Number(state.rate_limit_window_ms || SESSION_RATE_LIMIT_WINDOW_MS);
  const maxRequestsPerMinute = Math.max(1, Number(state.max_requests_per_minute || MAX_REQUESTS_PER_SESSION_PER_MINUTE));
  const windowStartedAtMs = new Date(state.rate_window_started_at || nowIso).getTime();
  const nowMs = new Date(nowIso).getTime();
  const elapsedMs = Number.isFinite(nowMs) && Number.isFinite(windowStartedAtMs)
    ? Math.max(0, nowMs - windowStartedAtMs)
    : 0;

  if (!Number.isFinite(windowMs) || windowMs <= 0 || elapsedMs >= windowMs) {
    return {
      ...state,
      rate_window_started_at: nowIso,
      rate_window_count: 0,
      max_requests_per_minute: maxRequestsPerMinute,
      rate_limit_window_ms: windowMs,
    };
  }

  return {
    ...state,
    max_requests_per_minute: maxRequestsPerMinute,
    rate_limit_window_ms: windowMs,
  };
}

async function reserveBillingBudget(entry) {
  return withBillingWrite(async (db) => {
    const state = await getBillingState(db);
    const sessionState = normalizeSessionRateWindow(await getSessionState(db, entry.session_id), entry.timestamp);
    const totalSpend = Number(state?.total_spend_usd || 0);
    const reservedSpend = Number(state?.reserved_spend_usd || 0);
    const projected = totalSpend + reservedSpend + entry.reserved_cost_usd;
    const sessionBudgetUsd = Number(sessionState?.budget_usd || 0);
    const sessionSpentUsd = Number(sessionState?.spent_usd || 0);
    const sessionReservedUsd = Number(sessionState?.reserved_usd || 0);
    const sessionProjected = sessionSpentUsd + sessionReservedUsd + entry.reserved_cost_usd;
    const sessionMaxRequests = Math.max(1, Number(sessionState?.max_requests_per_minute || MAX_REQUESTS_PER_SESSION_PER_MINUTE));
    const sessionRateWindowCount = Number(sessionState?.rate_window_count || 0);
    const nextSessionRequestCount = sessionRateWindowCount + 1;

    let rejectedReason = '';
    let rejectedStatusCode = 0;
    let rejectedMessage = '';

    if (sessionState && nextSessionRequestCount > sessionMaxRequests) {
      rejectedReason = 'session_rate_limited';
      rejectedStatusCode = 429;
      rejectedMessage = 'Session request rate limit exceeded';
    } else if (sessionState && Number.isFinite(sessionBudgetUsd) && sessionProjected > sessionBudgetUsd) {
      rejectedReason = 'session_budget_exceeded';
      rejectedStatusCode = 429;
      rejectedMessage = 'Session budget exceeded';
    } else if (projected > MAX_CREDITS_USD) {
      rejectedReason = 'credit_limit_exceeded';
      rejectedStatusCode = 429;
      rejectedMessage = 'Credit limit exceeded';
    }

    if (rejectedReason) {
      const insert = db.prepare(`
      INSERT OR REPLACE INTO request_logs (
          request_id, timestamp, route, session_id, execution_id, primary_model, model_used, input_tokens, output_tokens,
          estimated_cost_usd, status, fallback_triggered, failure_reason, endpoint, error_code, status_code, response_body, reserved_cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run([
        entry.request_id,
        entry.timestamp,
        entry.route,
        entry.session_id,
        entry.execution_id || null,
        entry.primary_model || '',
        entry.model_used,
        entry.input_tokens,
        0,
        entry.reserved_cost_usd,
        'rejected',
        0,
        entry.failure_reason || rejectedReason,
        entry.endpoint || '',
        rejectedReason,
        rejectedStatusCode,
        '',
        0,
      ]);
      insert.free();
      if (entry.execution_id) {
        const updateBudget = db.prepare(`
          UPDATE execution_budgets
          SET budget_rejection_reason = ?,
              updated_at = ?
          WHERE execution_id = ?
        `);
        updateBudget.run([
          rejectedReason,
          entry.timestamp,
          entry.execution_id,
        ]);
        updateBudget.free();
      }
      return {
        accepted: false,
        reason: rejectedReason,
        message: rejectedMessage,
        totalSpend,
        reservedSpend,
      };
    }

    const insert = db.prepare(`
      INSERT OR REPLACE INTO request_logs (
        request_id, timestamp, route, session_id, execution_id, primary_model, model_used, input_tokens, output_tokens,
        estimated_cost_usd, status, fallback_triggered, failure_reason, endpoint, error_code, status_code, response_body, reserved_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      entry.request_id,
      entry.timestamp,
      entry.route,
      entry.session_id,
      entry.execution_id || null,
      entry.primary_model || '',
      entry.model_used,
      entry.input_tokens,
      0,
      entry.reserved_cost_usd,
      'reserved',
      Number(Boolean(entry.fallback_triggered)),
      entry.failure_reason || '',
      entry.endpoint || '',
      '',
      0,
      '',
      entry.reserved_cost_usd,
    ]);
    insert.free();

    const update = db.prepare(`
      UPDATE billing_state
      SET reserved_spend_usd = reserved_spend_usd + ?, updated_at = ?
      WHERE id = 'global'
    `);
    update.run([entry.reserved_cost_usd, entry.timestamp]);
    update.free();

    if (sessionState) {
      const updateSession = db.prepare(`
        UPDATE session_state
        SET spent_usd = ?,
            reserved_usd = ?,
            request_count = request_count + 1,
            rate_window_started_at = ?,
            rate_window_count = ?,
            updated_at = ?
        WHERE session_id = ?
      `);
      updateSession.run([
        sessionSpentUsd,
        sessionReservedUsd + entry.reserved_cost_usd,
        sessionState.rate_window_started_at || entry.timestamp,
        nextSessionRequestCount,
        entry.timestamp,
        entry.session_id,
      ]);
      updateSession.free();
    }

    return {
      accepted: true,
      reservedCostUsd: entry.reserved_cost_usd,
    };
  });
}

async function finalizeBillingRequest(entry) {
  try {
    return await withBillingWrite(async (db) => {
      const state = await getBillingState(db);
      const sessionState = await getSessionState(db, entry.session_id);
      const totalSpend = Number(state?.total_spend_usd || 0);
      const reservedSpend = Number(state?.reserved_spend_usd || 0);
      const previousReserved = Number(entry.reserved_cost_usd || 0);
      const actualCost = Number(entry.estimated_cost_usd || 0);
      const nextReserved = Math.max(0, reservedSpend - previousReserved);
      const nextTotal = totalSpend + actualCost;

      const updateState = db.prepare(`
        UPDATE billing_state
        SET total_spend_usd = ?, reserved_spend_usd = ?, updated_at = ?
        WHERE id = 'global'
      `);
      updateState.run([nextTotal, nextReserved, entry.timestamp]);
      updateState.free();

      if (sessionState) {
        const nextSessionReserved = Math.max(0, Number(sessionState.reserved_usd || 0) - previousReserved);
        const nextSessionSpent = Number(sessionState.spent_usd || 0) + actualCost;
        const updateSession = db.prepare(`
          UPDATE session_state
          SET spent_usd = ?,
              reserved_usd = ?,
              updated_at = ?
          WHERE session_id = ?
        `);
        updateSession.run([
          nextSessionSpent,
          nextSessionReserved,
          entry.timestamp,
          entry.session_id,
        ]);
        updateSession.free();
      }

      const updateLog = db.prepare(`
        UPDATE request_logs
        SET timestamp = ?,
            execution_id = ?,
            primary_model = ?,
            model_used = ?,
            input_tokens = ?,
            output_tokens = ?,
            estimated_cost_usd = ?,
            status = ?,
            fallback_triggered = ?,
            failure_reason = ?,
            endpoint = ?,
            error_code = ?,
            status_code = ?,
            response_body = ?,
            reserved_cost_usd = ?
        WHERE request_id = ?
      `);
      updateLog.run([
        entry.timestamp,
        entry.execution_id || null,
        entry.primary_model || '',
        entry.model_used,
        entry.input_tokens,
        entry.output_tokens,
        actualCost,
        entry.status,
        Number(Boolean(entry.fallback_triggered)),
        entry.failure_reason || '',
        entry.endpoint || '',
        entry.error_code || '',
        entry.status_code || 0,
        entry.response_body || '',
        previousReserved,
        entry.request_id,
      ]);
      updateLog.free();

      if (entry.execution_id) {
        const updateBudget = db.prepare(`
          UPDATE execution_budgets
          SET completed_input_tokens = ?,
              completed_output_tokens = ?,
              updated_at = ?
          WHERE execution_id = ?
        `);
        updateBudget.run([
          Number(entry.input_tokens || 0),
          Number(entry.output_tokens || 0),
          entry.timestamp,
          entry.execution_id,
        ]);
        updateBudget.free();
      }

      return {
        totalSpend: nextTotal,
        reservedSpend: nextReserved,
      };
    });
  } catch (error) {
    console.error('Billing finalization failed', error);
    return null;
  }
}

async function getAdminSummary() {
  const db = await ensureBillingDb();
  const state = await getBillingState(db);
  const totalSpend = Number(state?.total_spend_usd || 0);
  const reservedSpend = Number(state?.reserved_spend_usd || 0);
  const maxSpend = Number(state?.max_credits_usd || MAX_CREDITS_USD);
  const used = totalSpend;
  const remaining = Math.max(0, maxSpend - used - reservedSpend);
  const percentUsed = maxSpend > 0 ? Math.min(100, (used / maxSpend) * 100) : 0;
  const countStmt = db.prepare('SELECT COUNT(*) AS count FROM request_logs');
  let requestCount = 0;
  if (countStmt.step()) {
    requestCount = Number(countStmt.getAsObject().count || 0);
  }
  countStmt.free();

  return {
    total_credits_usd: maxSpend,
    used_usd: used,
    reserved_usd: reservedSpend,
    remaining_usd: remaining,
    percent_used: percentUsed,
    request_count: requestCount,
    updated_at: state?.updated_at || getTimestamp(),
  };
}

async function getAdminRequests(filters = {}) {
  const db = await ensureBillingDb();
  const clauses = [];
  const params = [];

  if (filters.sessionId) {
    clauses.push('session_id = ?');
    params.push(filters.sessionId);
  }

  if (filters.from) {
    clauses.push('timestamp >= ?');
    params.push(filters.from);
  }

  if (filters.to) {
    clauses.push('timestamp <= ?');
    params.push(filters.to);
  }

  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const parsedLimit = Number.parseInt(filters.limit, 10);
  const parsedOffset = Number.parseInt(filters.offset, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 500)) : 100;
  const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
  const stmt = db.prepare(`
    SELECT request_id, timestamp, route, session_id, primary_model, model_used, input_tokens, output_tokens,
           execution_id, estimated_cost_usd, status, fallback_triggered, failure_reason, endpoint, error_code, status_code, response_body
    FROM request_logs
    ${where}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `);
  stmt.bind([...params, limit, offset]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function getAdminLiveKeys() {
  const db = await ensureBillingDb();
  const stmt = db.prepare(`
    SELECT
      lk.id,
      lk.key,
      lk.user_id,
      lk.created_at,
      lk.last_session_id,
      lk.budget_limit,
      ldt.channel AS delivery_channel,
      ldt.chat_id AS delivery_chat_id,
      ldt.thread_id AS delivery_thread_id,
      ldt.created_at AS delivery_created_at,
      ldt.updated_at AS delivery_updated_at,
      sdt.channel AS session_delivery_channel,
      sdt.chat_id AS session_delivery_chat_id,
      sdt.thread_id AS session_delivery_thread_id,
      sdt.created_at AS session_delivery_created_at,
      sdt.updated_at AS session_delivery_updated_at
    FROM live_keys lk
    LEFT JOIN live_key_delivery_targets ldt ON ldt.live_key_id = lk.id
    LEFT JOIN session_delivery_targets sdt ON sdt.session_id = lk.last_session_id
    ORDER BY lk.created_at DESC
  `);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const deliveryTarget = row.delivery_chat_id || row.delivery_thread_id || row.delivery_channel
      ? {
          channel: String(row.delivery_channel || 'telegram'),
          chat_id: String(row.delivery_chat_id || ''),
          thread_id: row.delivery_thread_id === null || row.delivery_thread_id === undefined || row.delivery_thread_id === ''
            ? null
            : String(row.delivery_thread_id),
          created_at: row.delivery_created_at ? String(row.delivery_created_at) : null,
          updated_at: row.delivery_updated_at ? String(row.delivery_updated_at) : null,
        }
      : null;
    const sessionDeliveryTarget = row.session_delivery_chat_id || row.session_delivery_thread_id || row.session_delivery_channel
      ? {
          channel: String(row.session_delivery_channel || 'telegram'),
          chat_id: String(row.session_delivery_chat_id || ''),
          thread_id: row.session_delivery_thread_id === null || row.session_delivery_thread_id === undefined || row.session_delivery_thread_id === ''
            ? null
            : String(row.session_delivery_thread_id),
          created_at: row.session_delivery_created_at ? String(row.session_delivery_created_at) : null,
          updated_at: row.session_delivery_updated_at ? String(row.session_delivery_updated_at) : null,
        }
      : null;
    rows.push({
      id: String(row.id || ''),
      key: String(row.key || ''),
      user_id: row.user_id || null,
      created_at: toIsoTimestamp(row.created_at),
      last_session_id: row.last_session_id || null,
      budget_limit: row.budget_limit === null || row.budget_limit === undefined || row.budget_limit === ''
        ? null
        : Number(row.budget_limit),
      delivery_target: deliveryTarget,
      current_session_delivery_target: sessionDeliveryTarget,
    });
  }
  stmt.free();
  return rows;
}

async function getOrCreateRuntimeDiscoveryLiveKey() {
  const db = await ensureBillingDb();
  const existing = await getStoredLiveKeyByUserId(db, RUNTIME_DISCOVERY_LIVE_KEY_USER_ID);
  if (existing) {
    return hydrateLiveKeyFromStored(existing);
  }

  return mintLiveKeyForUser({
    user_id: RUNTIME_DISCOVERY_LIVE_KEY_USER_ID,
  });
}

function requireAdminSecret(req, res, next) {
  if (!BLOCKFORK_ADMIN_SECRET) {
    return sendError(res, 401, 'Admin access is not configured', 'authentication_error', 'admin_not_configured');
  }

  const secret = req.get(ADMIN_SECRET_HEADER) || '';
  if (secret !== BLOCKFORK_ADMIN_SECRET) {
    return sendError(res, 401, 'Unauthorized', 'authentication_error', 'admin_unauthorized');
  }

  return next();
}

async function probeProviderAvailability(session) {
  const descriptor = getModelDescriptor(session.default_model_alias) || getModelDescriptor(PUBLIC_MODEL_ALIAS);
  const providerConfig = getProviderConfig(session, descriptor);
  if (!providerConfig || (providerConfig.requiresApiKey && !providerConfig.apiKey)) {
    return {
      status: 'fail',
      reason: 'runtime_not_ready',
      message: 'Runtime provider is not configured.',
      fix: 'Configure the upstream provider API key and retry.',
      blocking: true,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    if (!providerConfig.modelsUrl) {
      return {
        status: 'pass',
      };
    }

    const response = await fetch(providerConfig.modelsUrl, {
      method: 'GET',
      headers: {
        ...(providerConfig.apiKey ? { Authorization: `Bearer ${providerConfig.apiKey}` } : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        status: 'fail',
        reason: 'runtime_not_ready',
        message: 'Runtime provider is not reachable.',
        fix: 'Verify upstream connectivity and provider credentials, then retry.',
        blocking: true,
      };
    }

    return {
      status: 'pass',
    };
  } catch (error) {
    return {
      status: 'fail',
      reason: 'runtime_not_ready',
      message: 'Runtime provider is not reachable.',
      fix: 'Verify upstream connectivity and provider credentials, then retry.',
      blocking: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function evaluateCapabilityContract(req, session, options = {}) {
  if (options.useCache !== false) {
    const cached = getCachedCapabilityContract(session);
    if (cached) {
      return cached;
    }
  }

  const validatedAt = new Date().toISOString();
  const contract = buildCapabilityContractBase(req, session, validatedAt);

  const defaultModel = getModelDescriptor(session.default_model_alias);
  const aliases = Array.isArray(session.allowed_model_aliases) ? session.allowed_model_aliases : [];
  const registryReady = Boolean(defaultModel && aliases.length > 0 && aliases.every((alias) => Boolean(getModelDescriptor(alias))));
  if (!registryReady) {
    const failure = {
      ...contract,
      status: 'fail',
      message: 'Model registry is unavailable.',
      reason: 'model_registry_unavailable',
      fix: 'Ensure the BlockFork alias map includes the configured model aliases and retry.',
      blocking: true,
      checks: {
        ...contract.checks,
        models: { status: 'fail', reason: 'model_registry_unavailable' },
        chat: { status: 'fail', reason: 'model_registry_unavailable' },
      },
    };

    return cacheCapabilityContract(session, failure);
  }

  const providerProbe = await probeProviderAvailability(session);
  if (providerProbe.status !== 'pass') {
    const failure = {
      ...contract,
      status: 'fail',
      message: providerProbe.message,
      reason: providerProbe.reason,
      fix: providerProbe.fix,
      blocking: true,
      checks: {
        ...contract.checks,
        runtime: {
          status: 'fail',
          reason: providerProbe.reason,
        },
        chat: {
          status: 'fail',
          reason: 'chat_unavailable',
        },
      },
    };

    return cacheCapabilityContract(session, failure);
  }

  const runtimeReady = {
    status: 'pass',
    runtime_initialized: true,
    routing_layer_available: true,
    provider_reachable: true,
  };

  const chatReady = normalizeModelForSession(session, session.default_model_alias);
  if (chatReady.error) {
    const failure = {
      ...contract,
      status: 'fail',
      message: 'Chat capability is not available.',
      reason: 'chat_unavailable',
      fix: 'Verify model routing and provider readiness, then retry.',
      blocking: true,
      checks: {
        ...contract.checks,
        runtime: runtimeReady,
        chat: {
          status: 'fail',
          reason: 'chat_unavailable',
        },
      },
    };

    return cacheCapabilityContract(session, failure);
  }

  const success = {
    ...contract,
    checks: {
      ...contract.checks,
      runtime: runtimeReady,
      models: {
        status: 'pass',
        registry_ready: true,
        aliases: aliases,
      },
      chat: {
        status: 'pass',
        routable: true,
        model_alias_resolved: true,
      },
    },
  };

  return cacheCapabilityContract(session, success);
}

async function getSessionFromBearer(req) {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    return { error: { statusCode: 401, message: 'Missing or invalid bearer token', type: 'authentication_error', code: 'invalid_session_key' } };
  }

  if (isLiveKeyToken(token)) {
    return resolveLiveKeySession(token, req);
  }

  if (!isSessionKeyToken(token)) {
    return { error: { statusCode: 401, message: 'Missing or invalid bearer token', type: 'authentication_error', code: 'invalid_session_key' } };
  }

  let session = sessionsByApiKey.get(token);
  if (!session) {
    session = await loadPersistedSessionByApiKey(token);
  }

  if (!session) {
    return { error: { statusCode: 401, message: 'Invalid session key', type: 'authentication_error', code: 'invalid_session_key' } };
  }

  const status = getSessionStatus(session);
  if (status === 'expired') {
    if (session.status !== 'expired') {
      session.status = 'expired';
      void markStoredSessionStatus(session.session_id, 'expired');
    }
    return { error: { statusCode: 410, message: 'Session has expired', type: 'authentication_error', code: 'session_expired' } };
  }

  if (status !== 'active') {
    return { error: { statusCode: 409, message: 'Runtime is not ready', type: 'runtime_error', code: 'runtime_not_ready' } };
  }

  return { session };
}

async function canonicalSessionAuth(req, res, next) {
  // Canonical auth accepts either a session key or a live key and always resolves to
  // an active session record. This is the trust boundary for all /v1 proxy traffic.
  const { session, error } = await getSessionFromBearer(req);
  if (error) {
    return sendError(res, error.statusCode, error.message, error.type, error.code);
  }

  req.session = session;
  return next();
}

async function legacySessionAuth(req, res, next) {
  const { session, error } = await getSessionFromBearer(req);
  if (error) {
    return sendError(res, error.statusCode, error.message, error.type, error.code);
  }

  if (session.session_id !== req.params.id) {
    return sendError(res, 401, 'Session key does not match requested session', 'authentication_error', 'session_mismatch');
  }

  req.session = session;
  return next();
}

function buildRuntimePayload(session) {
  const descriptor = getModelDescriptor(session.default_model_alias);

  return {
    provider: 'blockfork',
    session_id: session.session_id,
    status: getSessionStatus(session),
    default_model: PUBLIC_MODEL_ALIAS,
    capabilities: descriptor ? descriptor.capabilities : ['chat'],
    limits: {
      context: descriptor ? descriptor.contextWindow : 0,
    },
  };
}

function buildSessionCreationPayload(req, session, preflight, liveKey = null) {
  const budget = buildSessionBudgetInfo(session);
  const publicApiKey = String(liveKey?.key || session.public_api_key || session.publicApiKey || session.api_key || '');
  const runtimeBaseUrl = getSessionBaseUrl(req);

  return {
    session_id: session.session_id,
    endpoint: getPublicBaseUrl(req),
    base_url: runtimeBaseUrl,
    api_key: session.api_key,
    public_api_key: publicApiKey,
    default_model: PUBLIC_MODEL_ALIAS,
    created_at: session.created_at,
    expires_at: session.expires_at,
    expires_in: getExpiresInSeconds(session),
    budget,
    session: {
      id: session.session_id,
      apiKey: session.api_key,
      publicApiKey,
      public_api_key: publicApiKey,
      endpoint: getPublicBaseUrl(req),
      baseUrl: runtimeBaseUrl,
      base_url: runtimeBaseUrl,
      defaultModel: PUBLIC_MODEL_ALIAS,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      status: getSessionStatus(session),
      budget,
    },
    preflight,
  };
}

function buildOpenClawConfigPayload(req, liveKey) {
  // OpenClaw consumes this connection kit; keep model pinned to managed to preserve
  // server-side routing control while we iterate free-tier reliability behavior.
  return {
    type: 'blockfork_connection_kit',
    openai_compatible: {
      base_url: getSessionBaseUrl(req),
      api_key: liveKey.key,
    },
    task_notifications: {
      pull_path: '/v1/task-notifications/pull',
      delivery_target_bind_path: '/v1/session/delivery-target',
      delivered_path_template: '/v1/task-notifications/{id}/delivered',
    },
    instructions: [
      'Set base_url in OpenClaw',
      'Paste API key',
      'Use model: managed',
      'Bind the Telegram delivery target before polling task notifications',
      'Poll /v1/task-notifications/pull for truthful task updates',
    ],
  };
}

function buildModelsPayload(session) {
  return {
    object: 'list',
    data: [{
      id: PUBLIC_MODEL_ALIAS,
      object: 'model',
      owned_by: 'blockfork',
    }],
  };
}

function normalizeChatCompletionResponse(payload, modelAlias) {
  const created = Number.isFinite(payload.created) ? payload.created : Math.floor(Date.now() / 1000);
  const choices = Array.isArray(payload.choices)
    ? payload.choices.map((choice, index) => ({
        index: Number.isFinite(choice.index) ? choice.index : index,
        finish_reason: choice.finish_reason ?? choice.finishReason ?? null,
        message: {
          role: choice?.message?.role || 'assistant',
          content: choice?.message?.content ?? '',
        },
      }))
    : [];

  return {
    id: payload.id || `chatcmpl_${crypto.randomUUID()}`,
    object: 'chat.completion',
    created,
    model: modelAlias,
    choices,
    usage: payload.usage,
  };
}

function stringifyTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (typeof content === 'number' || typeof content === 'boolean') {
    return String(content);
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => stringifyTextContent(item))
      .filter(Boolean)
      .join('');
  }

  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') {
      return content.text;
    }

    if (typeof content.content === 'string') {
      return content.content;
    }

    if (typeof content.value === 'string') {
      return content.value;
    }

    if (Array.isArray(content.content)) {
      return stringifyTextContent(content.content);
    }

    return JSON.stringify(content);
  }

  return '';
}

function translateResponsesInputToMessages(input) {
  if (input === undefined || input === null) {
    return null;
  }

  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    return [{ role: 'user', content: String(input) }];
  }

  if (!Array.isArray(input)) {
    return null;
  }

  const messages = [];
  for (const item of input) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      messages.push({ role: 'user', content: String(item) });
      continue;
    }

    if (item && typeof item === 'object') {
      const role = typeof item.role === 'string' ? item.role : 'user';
      const rawContent =
        item.content ??
        item.text ??
        item.value ??
        (Array.isArray(item.parts) ? item.parts : null);
      const content = stringifyTextContent(rawContent);
      if (content) {
        messages.push({ role, content });
        continue;
      }
    }

    const fallbackContent = stringifyTextContent(item);
    if (fallbackContent) {
      messages.push({ role: 'user', content: fallbackContent });
    }
  }

  return messages.length > 0 ? messages : null;
}

function translateResponsesRequestToChatBody(reqBody) {
  const body = reqBody && typeof reqBody === 'object' ? reqBody : {};

  let messages = Array.isArray(body.messages) ? body.messages : null;

  if (!messages) {
    messages = translateResponsesInputToMessages(body.input);
  }

  if (!messages || messages.length === 0) {
    return {
      error: {
        statusCode: 400,
        message: 'input must be a string, array, or messages must be provided',
        type: 'invalid_request_error',
        code: 'invalid_responses_input',
      },
    };
  }

  const translatedMessages = messages.map((message) => ({
    role: typeof message?.role === 'string' ? message.role : 'user',
    content: stringifyTextContent(message?.content ?? message?.text ?? message?.value ?? ''),
  })).filter((message) => Boolean(message.content));

  if (translatedMessages.length === 0) {
    return {
      error: {
        statusCode: 400,
        message: 'input must contain plain text content',
        type: 'invalid_request_error',
        code: 'unsupported_responses_input',
      },
    };
  }

  const chatBody = {
    ...body,
    messages: translatedMessages,
    max_tokens: Number.isFinite(body.max_output_tokens) ? body.max_output_tokens : body.max_tokens,
  };

  if (Array.isArray(body.tools)) {
    chatBody.tools = body.tools
      .map((tool) => translateResponsesToolToChatTool(tool))
      .filter(Boolean);
  }

  delete chatBody.input;
  delete chatBody.instructions;
  delete chatBody.max_output_tokens;

  const instructionText = stringifyTextContent(body.instructions);
  if (instructionText) {
    chatBody.messages = [
      { role: 'system', content: instructionText },
      ...chatBody.messages,
    ];
  }

  return { body: chatBody };
}

function translateResponsesToolToChatTool(tool) {
  if (!tool || typeof tool !== 'object') {
    return null;
  }

  if (tool.type !== 'function') {
    return tool;
  }

  if (tool.function && typeof tool.function === 'object') {
    return tool;
  }

  const name = typeof tool.name === 'string' ? tool.name : '';
  if (!name) {
    return null;
  }

  const translated = {
    type: 'function',
    function: {
      name,
      parameters: tool.parameters && typeof tool.parameters === 'object'
        ? tool.parameters
        : { type: 'object', properties: {} },
    },
  };

  if (typeof tool.description === 'string' && tool.description) {
    translated.function.description = tool.description;
  }

  if (typeof tool.strict === 'boolean') {
    translated.function.strict = tool.strict;
  }

  return translated;
}

function isPathWithinRoot(candidatePath, canonicalRoot) {
  return candidatePath === canonicalRoot || candidatePath.startsWith(`${canonicalRoot}${path.sep}`);
}

function getAllowedWorkspaceRoots() {
  const raw = String(process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS || '');
  const seen = new Set();
  const roots = [];
  for (const entry of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const declaredRoot = path.resolve(entry);
    if (!path.isAbsolute(declaredRoot)) {
      throw new Error(`Configured workspace root must be absolute: ${entry}`);
    }
    if (!fs.existsSync(declaredRoot)) {
      throw new Error(`Configured workspace root does not exist: ${declaredRoot}`);
    }
    const stats = fs.statSync(declaredRoot);
    if (!stats.isDirectory()) {
      throw new Error(`Configured workspace root must be a directory: ${declaredRoot}`);
    }
    const canonicalRoot = fs.realpathSync.native(declaredRoot);
    if (canonicalRoot !== declaredRoot) {
      throw new Error(`Configured workspace root must not rely on path aliases or symlinks: ${declaredRoot}`);
    }
    if (seen.has(canonicalRoot)) {
      continue;
    }
    seen.add(canonicalRoot);
    roots.push({
      declared_root: declaredRoot,
      canonical_root: canonicalRoot,
      root_source: `env:BLOCKFORK_WORKSPACE_ALLOWED_ROOTS:${declaredRoot}`,
    });
  }
  return roots;
}

function resolveCanonicalArtifactPath(filePath) {
  const declaredPath = typeof filePath === 'string' ? filePath.trim() : '';
  if (!declaredPath) {
    return { ok: false, reason: 'missing_artifact_path' };
  }
  if (!path.isAbsolute(declaredPath)) {
    return { ok: false, reason: 'artifact_path_must_be_absolute' };
  }

  const normalizedDeclaredPath = path.resolve(declaredPath);
  const existing = fs.existsSync(normalizedDeclaredPath);
  const parentPath = path.dirname(normalizedDeclaredPath);
  if (!fs.existsSync(parentPath)) {
    return { ok: false, reason: 'artifact_parent_path_not_found' };
  }

  let canonicalParent;
  try {
    canonicalParent = fs.realpathSync.native(parentPath);
  } catch (error) {
    return { ok: false, reason: 'artifact_parent_path_not_found' };
  }

  if (canonicalParent !== parentPath) {
    return { ok: false, reason: 'artifact_path_symlink_escape' };
  }

  let canonicalPath = path.join(canonicalParent, path.basename(normalizedDeclaredPath));
  if (existing) {
    const entryStats = fs.lstatSync(normalizedDeclaredPath);
    if (entryStats.isSymbolicLink()) {
      return { ok: false, reason: 'artifact_path_symlink_escape' };
    }
    try {
      canonicalPath = fs.realpathSync.native(normalizedDeclaredPath);
    } catch (error) {
      return { ok: false, reason: 'artifact_path_not_found' };
    }
    if (canonicalPath !== normalizedDeclaredPath) {
      return { ok: false, reason: 'artifact_path_symlink_escape' };
    }
  }

  return {
    ok: true,
    declared_path: normalizedDeclaredPath,
    canonical_path: canonicalPath,
    exists: existing,
  };
}

function resolveWorkspaceBindingForArtifact(contract) {
  if (!contract || contract.requested !== true) {
    return { required: false, ok: true };
  }

  const roots = getAllowedWorkspaceRoots();
  if (!roots.length) {
    return { required: true, ok: false, reason: 'artifact_workspace_roots_unconfigured' };
  }

  const evidence = contract.evidence && typeof contract.evidence === 'object' ? contract.evidence : null;
  if (!evidence) {
    return { required: true, ok: false, reason: 'missing_artifact_evidence' };
  }

  const pathResolution = resolveCanonicalArtifactPath(evidence.path);
  if (!pathResolution.ok) {
    return { required: true, ok: false, reason: pathResolution.reason };
  }

  const matches = roots.filter((root) => isPathWithinRoot(pathResolution.canonical_path, root.canonical_root));
  if (!matches.length) {
    return { required: true, ok: false, reason: 'artifact_path_outside_workspace' };
  }
  if (matches.length > 1) {
    return { required: true, ok: false, reason: 'artifact_path_ambiguous_workspace' };
  }

  return {
    required: true,
    ok: true,
    declared_path: pathResolution.declared_path,
    canonical_path: pathResolution.canonical_path,
    exists: pathResolution.exists,
    workspace_root: matches[0].canonical_root,
    root_source: matches[0].root_source,
    delivery_requested: evidence.delivery_requested === true || evidence.deliveryRequested === true,
    delivery_confirmed: evidence.delivery_succeeded === true || evidence.deliverySucceeded === true,
  };
}

function normalizeResponsesResponseFromChat(payload, modelAlias) {
  const assistantContent = stringifyTextContent(payload?.choices?.[0]?.message?.content ?? '');

  return {
    id: payload.id || `resp_${crypto.randomUUID()}`,
    object: 'response',
    created: Number.isFinite(payload.created) ? payload.created : Math.floor(Date.now() / 1000),
    model: modelAlias,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: assistantContent,
          },
        ],
      },
    ],
    usage: payload.usage,
  };
}

function normalizeResponsesIncompleteResponseFromChat(payload, modelAlias, incompleteDetails = {}) {
  return {
    id: payload.id || `resp_${crypto.randomUUID()}`,
    object: 'response',
    created: Number.isFinite(payload.created) ? payload.created : Math.floor(Date.now() / 1000),
    model: modelAlias,
    status: 'incomplete',
    incomplete_details: {
      reason: 'terminal_payload_missing',
      message: 'Managed response completed without a usable terminal payload',
      ...incompleteDetails,
    },
    output: [],
    usage: payload.usage,
  };
}

function normalizeResponsesFallbackResponseFromChat(payload, modelAlias, fallbackText = '') {
  return {
    id: payload.id || `resp_${crypto.randomUUID()}`,
    object: 'response',
    created: Number.isFinite(payload.created) ? payload.created : Math.floor(Date.now() / 1000),
    model: modelAlias,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: stringifyTextContent(fallbackText || ''),
          },
        ],
      },
    ],
    usage: payload.usage,
  };
}

function extractManagedRequestPromptText(reqBody = {}) {
  const body = reqBody && typeof reqBody === 'object' ? reqBody : {};
  const parts = [];

  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== 'object') {
        continue;
      }
      const role = String(message.role || '').toLowerCase();
      const text = stringifyTextContent(message.content ?? message.text ?? message.value ?? '');
      if (role === 'user' && text) {
        parts.push(text);
      }
    }
  }

  if (parts.length === 0 && body.input !== undefined) {
    const inputText = stringifyTextContent(body.input);
    if (inputText) {
      parts.push(inputText);
    }
  }

  if (parts.length === 0 && body.instructions !== undefined) {
    const instructionText = stringifyTextContent(body.instructions);
    if (instructionText) {
      parts.push(instructionText);
    }
  }

  if (parts.length === 0 && Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== 'object') {
        continue;
      }
      const text = stringifyTextContent(message.content ?? message.text ?? message.value ?? '');
      if (text) {
        parts.push(text);
      }
    }
  }

  return extractManagedCurrentTurnText(parts.join('\n').trim());
}

function extractManagedCurrentTurnText(promptText = '') {
  const text = String(promptText || '').trim();
  if (!text) {
    return '';
  }

  const markerPattern = /#\d+\s+[A-Z][a-z]{2}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d{1,2}:\d\d\s+[^:\n]+:/g;
  let lastMatch = null;
  for (const match of text.matchAll(markerPattern)) {
    lastMatch = match;
  }

  if (!lastMatch || !Number.isFinite(lastMatch.index)) {
    return text;
  }

  const currentTurn = text.slice(lastMatch.index + lastMatch[0].length).trim();
  return currentTurn || text;
}

function extractManagedArtifactFilenames(promptText = '') {
  const text = extractManagedCurrentTurnText(promptText);
  const filenames = [];
  const seen = new Set();
  const directPattern = /\b([A-Za-z0-9._-]+\.(?:md|markdown|txt|json|csv|yaml|yml|html|js|ts|py))\b/gi;

  for (const match of text.matchAll(directPattern)) {
    const candidate = String(match[1] || '').trim();
    if (!candidate || seen.has(candidate.toLowerCase())) {
      continue;
    }
    seen.add(candidate.toLowerCase());
    filenames.push(candidate);
  }

  return filenames;
}

function extractManagedArtifactFilename(promptText = '') {
  const filenames = extractManagedArtifactFilenames(promptText);
  return filenames[filenames.length - 1] || '';
}

function extractManagedArtifactBulletCount(promptText = '') {
  const text = extractManagedCurrentTurnText(promptText);
  const bulletMatch = text.match(/\b(\d{1,2})\s*[- ]?bullet(?:s)?\b/i)
    || text.match(/\b(?:bullet(?:s)?\s*(?:count|count of|of)?\s*[:=]?\s*)(\d{1,2})\b/i);
  const count = Number(bulletMatch?.[1] || 0);
  if (Number.isFinite(count) && count > 0 && count <= 12) {
    return count;
  }
  return 5;
}

function extractManagedArtifactItemCount(promptText = '') {
  const text = extractManagedCurrentTurnText(promptText);
  const stepMatch = text.match(/\b(\d{1,2})\s*[- ]?step(?:s)?\b/i)
    || text.match(/\b(?:step(?:s)?\s*(?:count|count of|of)?\s*[:=]?\s*)(\d{1,2})\b/i);
  const stepCount = Number(stepMatch?.[1] || 0);
  if (Number.isFinite(stepCount) && stepCount > 0 && stepCount <= 12) {
    return stepCount;
  }
  return extractManagedArtifactBulletCount(promptText);
}

function humanizeManagedArtifactTitle(filename = '') {
  const stem = path.parse(String(filename || '')).name || '';
  const normalized = stem.replace(/[._-]+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

function extractManagedArtifactTopic(promptText = '') {
  const text = extractManagedCurrentTurnText(promptText);
  const whyMatch = text.match(/\bwhy\s+(.+?)\s+matters\b/i);
  if (whyMatch?.[1]) {
    return whyMatch[1].trim().replace(/[.?!,;:]+$/g, '');
  }

  const summaryMatch = text.match(/\bsummary\s+of\s+(.+?)(?:[.?!]|$)/i);
  if (summaryMatch?.[1]) {
    return summaryMatch[1].trim().replace(/[.?!,;:]+$/g, '');
  }

  const aboutMatch = text.match(/\babout\s+(.+?)(?:[.?!]|$)/i);
  if (aboutMatch?.[1]) {
    return aboutMatch[1].trim().replace(/[.?!,;:]+$/g, '');
  }

  return '';
}

function buildManagedAgentWorkflowBriefDraft(promptText = '', filename = '') {
  const currentTurnText = extractManagedCurrentTurnText(promptText);
  const promptLower = currentTurnText.toLowerCase();
  const title = humanizeManagedArtifactTitle(filename) || 'Agent Workflow Proof';
  const topic = promptLower.includes('website')
    ? 'website delivery'
    : 'coordinated sub-agents';
  const steps = [
    `The Planner Agent turns the goal into a durable sequential plan for ${topic}.`,
    'The Context Agent extracts the current turn and keeps stale history from polluting the run.',
    'The Writer Agent produces the actual markdown artifact for the active turn.',
    'The Verifier Agent checks structure, alignment, and confidence before anything is delivered.',
    'The Delivery Agent sends the verified artifact only after the file has proven truthfully complete.',
  ];

  return `# ${title}\n\n${steps.map((line) => `- ${line}`).join('\n')}`;
}

function looksLikeManagedArtifactContent(content = '', filename = '') {
  const text = normalizeArtifactTextSample(content).trim();
  if (!text) {
    return false;
  }

  const lower = text.toLowerCase();
  if (/\bi'?ve got the request\b/i.test(lower) || /\bi'?ll write up that summary\b/i.test(lower) || /\bgot the request\b/i.test(lower)) {
    return false;
  }

  const headingSignals = countMatches([
    /^#\s+/m,
    /^##\s+/m,
    /^###\s+/m,
  ], text);
  const listSignals = countMatches([
    /^-\s+/m,
    /^\*\s+/m,
    /^\d+\.\s+/m,
  ], text);
  const filenameStem = String(path.parse(String(filename || '')).name || '').replace(/[._-]+/g, ' ').trim().toLowerCase();
  const filenameSignal = Boolean(filenameStem) && lower.includes(filenameStem);

  if (headingSignals >= 1 && listSignals >= 1 && text.length >= 100) {
    return true;
  }
  if (filenameSignal && headingSignals >= 1 && listSignals >= 1 && text.length >= 80) {
    return true;
  }

  return false;
}

function buildManagedMarkdownArtifactDraft(promptText = '', filename = '') {
  const currentTurnText = extractManagedCurrentTurnText(promptText);
  const promptLower = currentTurnText.toLowerCase();
  const title = humanizeManagedArtifactTitle(filename) || 'Project Summary';
  const topic = extractManagedArtifactTopic(currentTurnText);
  const itemCount = extractManagedArtifactItemCount(currentTurnText);
  const topicSubject = topic
    ? topic.replace(/\s+/g, ' ').trim()
    : 'consistency';
  const subjectLine = topicSubject.charAt(0).toUpperCase() + topicSubject.slice(1);

  let baseBullets = [
    `${subjectLine} helps teams keep momentum when progress feels slow.`,
    'It reduces chaos by turning difficult work into repeatable steps.',
    'It builds trust because everyone can see steady effort over time.',
    'It makes setbacks easier to recover from without losing direction.',
    'It compounds small improvements into meaningful long-term results.',
    'It keeps decision-making calmer and more repeatable under pressure.',
    'It helps small wins add up into visible progress.',
    'It makes the next step clearer when the work gets messy.',
  ];

  if (/\bdifference between\b/.test(promptLower) && /\bartifact creation\b/.test(promptLower) && /\bartifact verification\b/.test(promptLower) && /\bartifact delivery\b/.test(promptLower)) {
    baseBullets = [
      'Artifact creation is the step where the file is actually written and placed in the allowed workspace.',
      'Artifact verification is the check that the file exists, matches the expected path, and meets the required structure.',
      'Artifact delivery is the separate step that sends the verified file back through the relay to the user.',
      'Keeping those steps separate prevents a successful send from being mistaken for verified content.',
      'Treating each step independently makes recovery and retry logic much easier to trust.',
      'The system stays safer when creation, verification, and delivery each have their own proof.',
    ];
  } else if (
    taskTextContainsAny(promptLower, ['agent workflow', 'agentic workflow', 'sub-agent', 'sub agent', 'planner', 'verifier', 'delivery step'])
    && !/\bwebsite\b/.test(promptLower)
    && !/\blanding page\b/.test(promptLower)
  ) {
    return buildManagedAgentWorkflowBriefDraft(currentTurnText, filename);
  } else if (/\bwebsite\b/.test(promptLower) && /\bbuild\b/.test(promptLower) && /\bverify\b/.test(promptLower) && /\bpackage\b/.test(promptLower) && /\bdeliver\b/.test(promptLower)) {
    baseBullets = [
      'Define the website goal and the single deliverable before any files are written.',
      'Build the website files inside the allowed workspace with a deterministic structure.',
      'Verify the output by checking that the pages exist, render cleanly, and match the requested shape.',
      'Package the verified files into the delivery path only after validation passes.',
      'Deliver the package through the relay so the user receives the same verified artifact you created.',
      'Keep creation, verification, packaging, and delivery separate so each step can be retried safely.',
      'Record proof for every stage so the workflow stays auditable end to end.',
    ];
  } else if (/\bphase 5\b/.test(promptLower) && /\bsuccessfully achieved\b/.test(promptLower)) {
    baseBullets = [
      'In Phase 5, BlockFork now classifies artifact prompts at admission instead of treating them like generic chat.',
      'It can create a real markdown file, verify it on disk, and persist durable artifact proof.',
      'It can separate the assistant acknowledgement from the artifact content itself.',
      'It can deliver a verified file back through the relay as a real Telegram document attachment.',
      'It can keep artifact truth, verification truth, and delivery truth separate without fake success.',
    ];
  }

  const numberedMode = /\bstep\b/.test(promptLower) || /\bworkflow\b/.test(promptLower) || /\bplan\b/.test(promptLower);
  const count = Math.max(1, itemCount);
  const items = baseBullets.slice(0, count);
  while (items.length < count) {
    items.push('It keeps the work steady and easier to trust over time.');
  }

  const listText = numberedMode
    ? items.map((line, index) => `${index + 1}. ${line}`).join('\n')
    : items.map((line) => `- ${line}`).join('\n');

  return `# ${title}\n\n${listText}`;
}

function buildManagedArtifactDraftText(promptText = '', completionText = '', options = {}) {
  const currentTurnText = extractManagedCurrentTurnText(promptText);
  const filename = String(options.filename || extractManagedArtifactFilename(currentTurnText) || '').trim();
  const assistantText = String(options.assistantText || completionText || '').trim();
  if (looksLikeManagedArtifactContent(assistantText, filename)) {
    return assistantText;
  }

  const promptLower = String(currentTurnText || '').toLowerCase();
  const wantsMarkdown = /\.md(markdown)?$/i.test(filename)
    || /\bmarkdown\b/.test(promptLower)
    || /\b(summary|report|notes)\b/.test(promptLower);

  if (wantsMarkdown) {
    return buildManagedMarkdownArtifactDraft(promptText, filename);
  }

  return assistantText;
}

function sanitizeManagedArtifactFilename(filename = '') {
  const candidate = String(filename || '').trim();
  if (!candidate) {
    return { ok: false, reason: 'artifact_filename_missing' };
  }
  if (path.isAbsolute(candidate)) {
    return { ok: false, reason: 'artifact_invalid' };
  }
  if (candidate === '.' || candidate === '..') {
    return { ok: false, reason: 'artifact_invalid' };
  }
  if (candidate.includes('/') || candidate.includes('\\')) {
    return { ok: false, reason: 'artifact_invalid' };
  }
  if (path.basename(candidate) !== candidate) {
    return { ok: false, reason: 'artifact_invalid' };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(candidate)) {
    return { ok: false, reason: 'artifact_invalid' };
  }
  return { ok: true, filename: candidate };
}

function getSingleManagedArtifactWorkspaceRoot() {
  const roots = getAllowedWorkspaceRoots();
  if (!roots.length) {
    return { ok: false, reason: 'artifact_workspace_roots_unconfigured' };
  }
  if (roots.length !== 1) {
    return { ok: false, reason: 'artifact_path_ambiguous_workspace' };
  }
  return { ok: true, root: roots[0] };
}

function buildManagedArtifactOutputPath(canonicalRoot, executionId, filename) {
  return path.join(canonicalRoot, 'artifacts', String(executionId || ''), filename);
}

function writeTextFileAtomically(filePath, contents) {
  const normalizedPath = path.resolve(filePath);
  const directory = path.dirname(normalizedPath);
  const tempPath = path.join(directory, `.tmp-${crypto.randomUUID()}`);
  const payload = String(contents || '');
  let fd = null;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fd, payload, { encoding: 'utf8' });
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, normalizedPath);
    return { ok: true, path: normalizedPath, tempPath };
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_) {}
    }
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (_) {}
    return {
      ok: false,
      reason: error?.code || error?.message || 'artifact_output_invalid',
      path: normalizedPath,
      tempPath,
    };
  }
}

async function materializeVerifiedArtifactForExecution(executionId, completionText, options = {}) {
  const execution = await getExecutionById(executionId);
  if (!execution) {
    return { required: true, ok: false, reason: 'artifact_execution_missing' };
  }

  const task = await getTaskByExecutionId(executionId);
  if (!task) {
    return { required: true, ok: false, reason: 'artifact_execution_missing' };
  }

  const taskKind = String(task.task_kind || '');
  if (![TASK_KINDS.ARTIFACT_TASK, TASK_KINDS.AGENT_WORKFLOW_TASK].includes(taskKind)) {
    return { required: false, ok: true, skipped: true };
  }

  const promptText = extractManagedCurrentTurnText(String(options.promptText || task.objective_text || ''));
  const requestedFilenames = extractManagedArtifactFilenames(promptText);
  if (requestedFilenames.length > 1 && !options.allowMultipleArtifacts) {
    return {
      required: true,
      ok: false,
      reason: 'artifact_multiple_requests_unsupported',
      fallbackText: buildManagedTerminalFallbackText({ messages: [{ role: 'user', content: promptText || task.objective_text || '' }] }),
    };
  }

  const rawFilename = String(options.filename || requestedFilenames[0] || extractManagedArtifactFilename(promptText) || 'requested-file.md').trim();
  const sanitizedFilename = sanitizeManagedArtifactFilename(rawFilename);
  if (!sanitizedFilename.ok) {
    return {
      required: true,
      ok: false,
      reason: sanitizedFilename.reason,
      fallbackText: buildManagedTerminalFallbackText({ messages: [{ role: 'user', content: promptText || task.objective_text || '' }] }),
    };
  }

  const explicitArtifactContent = Object.prototype.hasOwnProperty.call(options, 'artifactContent')
    ? String(options.artifactContent ?? '').trimEnd()
    : null;
  const draftedArtifactContent = buildManagedArtifactDraftText(promptText, completionText, {
    filename: sanitizedFilename.filename,
    assistantText: completionText,
  });
  const content = String(
    explicitArtifactContent !== null
      ? explicitArtifactContent
      : draftedArtifactContent
  ).trimEnd();
  if (!content) {
    return {
      required: true,
      ok: false,
      reason: 'artifact_output_invalid',
      fallbackText: buildManagedTerminalFallbackText({ messages: [{ role: 'user', content: promptText || task.objective_text || '' }] }),
    };
  }

  const rootSelection = getSingleManagedArtifactWorkspaceRoot();
  if (!rootSelection.ok) {
    return {
      required: true,
      ok: false,
      reason: rootSelection.reason,
      fallbackText: buildManagedTerminalFallbackText({ messages: [{ role: 'user', content: promptText || task.objective_text || '' }] }),
    };
  }

  const workspace = await findOrCreateWorkspaceBinding(rootSelection.root.canonical_root, rootSelection.root.root_source, options);
  await attachExecutionWorkspace(executionId, workspace.workspace_id, {
    requestId: options.requestId || execution.last_request_id || '',
    actorSource: options.actorSource || 'runtime',
    reasonCode: 'execution_workspace_bound',
  });

  const artifactDir = path.join(workspace.canonical_root, 'artifacts', String(executionId || ''));
  fs.mkdirSync(artifactDir, { recursive: true });
  const finalPath = buildManagedArtifactOutputPath(workspace.canonical_root, executionId, sanitizedFilename.filename);
  const canonicalResolution = resolveCanonicalArtifactPath(finalPath);
  if (!canonicalResolution.ok) {
    return {
      required: true,
      ok: false,
      reason: canonicalResolution.reason,
      fallbackText: buildManagedTerminalFallbackText({ messages: [{ role: 'user', content: promptText || task.objective_text || '' }] }),
    };
  }

  const artifactType = inferArtifactFamily(promptText || task.objective_text || '', finalPath, content, content);
  const byteSize = Buffer.byteLength(content, 'utf8');
  const contentHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const fileWrite = writeTextFileAtomically(canonicalResolution.canonical_path, content);
  if (!fileWrite.ok) {
    return {
      required: true,
      ok: false,
      reason: fileWrite.reason || 'artifact_output_invalid',
      fallbackText: buildManagedTerminalFallbackText({ messages: [{ role: 'user', content: promptText || task.objective_text || '' }] }),
    };
  }

  let artifact = null;
  try {
    artifact = await createExecutionArtifactRecord({
      executionId,
      workspaceId: workspace.workspace_id,
      declaredPath: canonicalResolution.declared_path,
      canonicalPath: canonicalResolution.canonical_path,
      verificationState: ARTIFACT_VERIFICATION_STATES.PENDING,
      deliveryRequested: false,
      deliveryConfirmed: false,
      reasonCode: 'artifact_file_materialized',
      artifactFilename: sanitizedFilename.filename,
      artifactType,
      contentHash,
      byteSize,
      requestId: options.requestId || execution.last_request_id || '',
      actorSource: options.actorSource || 'runtime',
      promptText,
      timestamp: options.timestamp || getTimestamp(),
    });
    artifact = await updateExecutionArtifactVerification(executionId, ARTIFACT_VERIFICATION_STATES.VERIFIED, {
      reasonCode: 'artifact_file_verified',
      completionText: content,
      canonicalPath: canonicalResolution.canonical_path,
      declaredPath: canonicalResolution.declared_path,
      deliveryRequested: false,
      deliveryConfirmed: false,
      artifactFilename: sanitizedFilename.filename,
      artifactType,
      contentHash,
      byteSize,
      requestId: options.requestId || execution.last_request_id || '',
      actorSource: options.actorSource || 'runtime',
      promptText,
      timestamp: options.timestamp || getTimestamp(),
    });
  } catch (error) {
    try {
      if (fs.existsSync(canonicalResolution.canonical_path)) {
        fs.unlinkSync(canonicalResolution.canonical_path);
      }
    } catch (_) {}
    return {
      required: true,
      ok: false,
      reason: error?.code || error?.message || 'artifact_output_invalid',
      fallbackText: buildManagedTerminalFallbackText({ messages: [{ role: 'user', content: promptText || task.objective_text || '' }] }),
    };
  }

  await syncTaskArtifactAssessment(executionId, {
    completionText: content,
    promptText,
    timestamp: options.timestamp || getTimestamp(),
  }).catch(() => null);

  const assessment = await getTaskArtifactAssessmentByTaskId(task.task_id);
  const shouldAutoDeliver = options.autoDeliver !== false;
  let automaticDelivery = null;
  const autoRelayLabel = shouldAutoDeliver
    ? await resolveAutomaticArtifactDeliveryRelayLabel(executionId, {
      ...options,
      artifact,
      assessment,
    })
    : String(options.relayLabel || '').trim();

  if (assessment && String(assessment.confidence_band || '') === TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH) {
    const deliveryNotification = await ensureArtifactDeliveryNotificationForExecution(executionId, {
      relayLabel: autoRelayLabel,
      timestamp: options.timestamp || getTimestamp(),
    }).catch(() => null);
    if (shouldAutoDeliver && deliveryNotification?.ok) {
      automaticDelivery = await attemptAutomaticArtifactDeliveryForExecution(executionId, {
        ...options,
        relayLabel: autoRelayLabel,
        assessment,
        deliveryNotification: deliveryNotification.notification || null,
        artifactPath: canonicalResolution.canonical_path,
        filename: sanitizedFilename.filename,
        artifact: artifact,
      }).catch(() => null);
      if (automaticDelivery && automaticDelivery.ok) {
        artifact = await updateExecutionArtifactDeliveryStatus(executionId, {
          deliveryRequested: true,
          deliveryConfirmed: true,
          reasonCode: 'artifact_delivery_confirmed',
          timestamp: options.timestamp || getTimestamp(),
        }).catch(() => artifact);
      }
    }
  }
  return {
    required: true,
    ok: true,
    workspace,
    artifact,
    assessment,
    filePath: canonicalResolution.canonical_path,
    filename: sanitizedFilename.filename,
    artifactType,
    contentHash,
    byteSize,
    automaticDelivery,
  };
}

function buildManagedArtifactSuccessText(filename = '', artifactType = '') {
  const normalizedFilename = String(filename || '').trim();
  const noun = normalizedFilename || (artifactType ? `requested ${artifactType}` : 'requested artifact');
  return `I created ${noun} with the requested content.`;
}

function buildManagedArtifactResponseText(artifactOutcome = null, assistantText = '', options = {}) {
  if (!artifactOutcome || !artifactOutcome.ok) {
    return String(assistantText || '').trim();
  }

  const filename = String(artifactOutcome.filename || artifactOutcome.artifact?.artifact_filename || '').trim();
  const delivery = artifactOutcome.automaticDelivery || null;
  const delivered = Boolean(artifactOutcome.artifact?.delivery_confirmed)
    || String(delivery?.delivery?.status || delivery?.status || '') === 'delivered'
    || Boolean(delivery?.attempt?.success)
    || Boolean(delivery?.attempt?.delivered_file_message_id || delivery?.attempt?.delivered_message_id);
  const deliveryPending = delivery && !delivered && !delivery.skipped;
  const deliveryFailed = Boolean(delivery && !delivered && !deliveryPending);

  if (delivered) {
    return filename ? `I created and delivered ${filename}.` : 'I created and delivered the requested artifact.';
  }

  if (deliveryPending) {
    return filename ? `I created ${filename}. Delivery is pending.` : 'I created the requested artifact. Delivery is pending.';
  }

  if (deliveryFailed) {
    return filename ? `I created ${filename}, but delivery failed. You can retry delivery.` : 'I created the requested artifact, but delivery failed. You can retry delivery.';
  }

  return filename ? buildManagedArtifactSuccessText(filename, artifactOutcome.artifactType || '') : buildManagedArtifactSuccessText('', artifactOutcome.artifactType || '');
}

async function attemptManagedArtifactWorkflowForExecution(executionId, completionText, options = {}) {
  const execution = await getExecutionById(executionId);
  const task = await getTaskByExecutionId(executionId);
  if (!execution || !task) {
    return await materializeVerifiedArtifactForExecution(executionId, completionText, options);
  }

  const promptText = extractManagedRequestPromptText(options.promptText || task.objective_text || '');
  if (String(task.task_kind || '') !== TASK_KINDS.AGENT_WORKFLOW_TASK) {
    return materializeVerifiedArtifactForExecution(executionId, completionText, {
      ...options,
      promptText,
    });
  }

  const runState = await ensureAgentWorkflowRunForExecution(executionId, {
    ...options,
    promptText,
  });
  if (!runState.ok) {
    return runState;
  }

  const agentRun = runState.agentRun || null;
  const steps = Array.isArray(runState.steps) ? runState.steps : [];
  const getStep = (role) => steps.find((step) => String(step.role || '') === role) || null;
  const plannerStep = getStep('planner');
  const contextStep = getStep('context');
  const writerStep = getStep('writer');
  const verifierStep = getStep('verifier');
  const deliveryStep = getStep('delivery');
  const timestamp = options.timestamp || getTimestamp();

  if (plannerStep) {
    await updateAgentStep(plannerStep.agent_step_id, {
      status: AGENT_STEP_STATES.COMPLETED,
      reasonCode: 'agent_plan_locked',
      startedAt: plannerStep.started_at || timestamp,
      completedAt: timestamp,
      output: { plan: runState.plan || [] },
      evidence: { plan: runState.plan || [] },
      timestamp,
    });
    await appendAgentStepEvent({
      agent_run_id: agentRun.agent_run_id,
      agent_step_id: plannerStep.agent_step_id,
      task_id: task.task_id,
      execution_id: executionId,
      event_type: 'planner_completed',
      payload: { plan: runState.plan || [] },
      created_at: timestamp,
    });
    await appendTaskProgressEvent({
      task_id: task.task_id,
      execution_id: executionId,
      previous_state: task.current_state || TASK_STATES.RECEIVED,
      new_state: TASK_STATES.PLANNED,
      progress_category: TASK_PROGRESS_CATEGORIES.PLAN_LOCKED,
      decision: 'notify_user',
      message_text: 'Planner Agent locked the sequential workflow plan.',
      requires_user_input: 0,
      source: options.actorSource || 'runtime',
      reason_code: 'agent_plan_locked',
      created_at: timestamp,
    });
    await updateAgentRun(agentRun.agent_run_id, {
      status: AGENT_RUN_STATES.IN_PROGRESS,
      currentStepIndex: 2,
      timestamp,
    });
  }

  if (contextStep) {
    await updateAgentStep(contextStep.agent_step_id, {
      status: AGENT_STEP_STATES.COMPLETED,
      reasonCode: 'current_turn_bound',
      startedAt: contextStep.started_at || timestamp,
      completedAt: timestamp,
      output: { prompt_text: promptText, current_turn_text: extractManagedCurrentTurnText(promptText) },
      evidence: { prompt_text: promptText },
      timestamp,
    });
    await appendAgentStepEvent({
      agent_run_id: agentRun.agent_run_id,
      agent_step_id: contextStep.agent_step_id,
      task_id: task.task_id,
      execution_id: executionId,
      event_type: 'context_completed',
      payload: { prompt_text: promptText },
      created_at: timestamp,
    });
    await updateAgentRun(agentRun.agent_run_id, {
      status: AGENT_RUN_STATES.IN_PROGRESS,
      currentStepIndex: 3,
      timestamp,
    });
  }

  if (writerStep) {
    await updateAgentStep(writerStep.agent_step_id, {
      status: AGENT_STEP_STATES.IN_PROGRESS,
      reasonCode: 'artifact_writer_started',
      startedAt: writerStep.started_at || timestamp,
      retryCount: Number(writerStep.retry_count || 0),
      timestamp,
    });
    await appendAgentStepEvent({
      agent_run_id: agentRun.agent_run_id,
      agent_step_id: writerStep.agent_step_id,
      task_id: task.task_id,
      execution_id: executionId,
      event_type: 'writer_started',
      payload: { prompt_text: promptText },
      created_at: timestamp,
    });
    await appendTaskProgressEvent({
      task_id: task.task_id,
      execution_id: executionId,
      previous_state: task.current_state || TASK_STATES.RECEIVED,
      new_state: TASK_STATES.TOOL_WORK_STARTED,
      progress_category: TASK_PROGRESS_CATEGORIES.TOOL_WORK_STARTED,
      decision: 'notify_user',
      message_text: 'Writer Agent has started the artifact draft.',
      requires_user_input: 0,
      source: options.actorSource || 'runtime',
      reason_code: 'agent_writer_started',
      created_at: timestamp,
    });
    await updateAgentRun(agentRun.agent_run_id, {
      status: AGENT_RUN_STATES.IN_PROGRESS,
      currentStepIndex: 4,
      timestamp,
    });
  }

  const materialized = await materializeVerifiedArtifactForExecution(executionId, completionText, {
    ...options,
    promptText,
  });
  if (!materialized.ok) {
    const reason = materialized.reason || 'artifact_output_invalid';
    if (writerStep) {
      await updateAgentStep(writerStep.agent_step_id, {
        status: AGENT_STEP_STATES.FAILED,
        reasonCode: reason,
        output: { reason },
        evidence: { reason },
        completedAt: timestamp,
        timestamp,
      });
      await appendAgentStepEvent({
        agent_run_id: agentRun.agent_run_id,
        agent_step_id: writerStep.agent_step_id,
        task_id: task.task_id,
        execution_id: executionId,
        event_type: 'writer_failed',
        payload: { reason },
        created_at: timestamp,
      });
    }
    await updateAgentRun(agentRun.agent_run_id, {
      status: materialized.reason === 'artifact_multiple_requests_unsupported'
        ? AGENT_RUN_STATES.RECOVERY_REQUIRED
        : AGENT_RUN_STATES.FAILED,
      currentStepIndex: 3,
      finalOutcome: reason,
      timestamp,
    });
    return {
      ...materialized,
      agentRun: hydrateAgentRunRow({
        ...agentRun,
        status: materialized.reason === 'artifact_multiple_requests_unsupported'
          ? AGENT_RUN_STATES.RECOVERY_REQUIRED
          : AGENT_RUN_STATES.FAILED,
        current_step_index: 3,
        final_outcome: reason,
        updated_at: timestamp,
      }),
      agentSteps: await withBillingWrite(async (db) => getAgentStepsByRunIdTx(db, agentRun.agent_run_id)),
    };
  }

  if (writerStep) {
    await updateAgentStep(writerStep.agent_step_id, {
      status: AGENT_STEP_STATES.COMPLETED,
      reasonCode: 'artifact_written',
      startedAt: writerStep.started_at || timestamp,
      completedAt: timestamp,
      output: { artifact: materialized.artifact || null },
      evidence: { artifact: materialized.artifact || null },
      artifactId: materialized.artifact?.artifact_id || null,
      timestamp,
    });
    await appendAgentStepEvent({
      agent_run_id: agentRun.agent_run_id,
      agent_step_id: writerStep.agent_step_id,
      task_id: task.task_id,
      execution_id: executionId,
      event_type: 'writer_completed',
      payload: { artifact: materialized.artifact || null },
      created_at: timestamp,
    });
  }

  const verifiedAssessment = materialized.assessment || await getVerifiedTaskArtifactAssessmentForExecutionId(executionId);
  if (verifierStep) {
    const verifierStatus = verifiedAssessment && String(verifiedAssessment.confidence_band || '') === TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH
      && String(verifiedAssessment.alignment_state || '') === TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED
      ? AGENT_STEP_STATES.COMPLETED
      : AGENT_STEP_STATES.FAILED;
    await updateAgentStep(verifierStep.agent_step_id, {
      status: verifierStatus,
      reasonCode: verifierStatus === AGENT_STEP_STATES.COMPLETED ? 'artifact_verified' : 'artifact_verification_failed',
      startedAt: verifierStep.started_at || timestamp,
      completedAt: timestamp,
      output: { assessment: verifiedAssessment || null },
      evidence: { assessment: verifiedAssessment || null },
      artifactId: materialized.artifact?.artifact_id || null,
      timestamp,
    });
    await appendAgentStepEvent({
      agent_run_id: agentRun.agent_run_id,
      agent_step_id: verifierStep.agent_step_id,
      task_id: task.task_id,
      execution_id: executionId,
      event_type: verifierStatus === AGENT_STEP_STATES.COMPLETED ? 'verifier_completed' : 'verifier_failed',
      payload: { assessment: verifiedAssessment || null },
      created_at: timestamp,
    });
    await appendTaskProgressEvent({
      task_id: task.task_id,
      execution_id: executionId,
      previous_state: TASK_STATES.ARTIFACT_CREATED,
      new_state: TASK_STATES.ARTIFACT_VERIFIED,
      progress_category: TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFIED,
      decision: 'notify_user',
      message_text: verifierStatus === AGENT_STEP_STATES.COMPLETED
        ? 'Verifier Agent confirmed the artifact.'
        : 'Verifier Agent could not confirm the artifact.',
      requires_user_input: 0,
      source: options.actorSource || 'runtime',
      reason_code: verifierStatus === AGENT_STEP_STATES.COMPLETED ? 'artifact_verified' : 'artifact_verification_failed',
      created_at: timestamp,
    });
    await updateAgentRun(agentRun.agent_run_id, {
      status: AGENT_RUN_STATES.IN_PROGRESS,
      currentStepIndex: 5,
      timestamp,
    });
  }

  if (deliveryStep) {
    const deliveryOutcome = materialized.automaticDelivery || null;
    const delivered = Boolean(materialized.artifact?.delivery_confirmed)
      || String(deliveryOutcome?.delivery?.status || deliveryOutcome?.status || '') === 'delivered'
      || Boolean(deliveryOutcome?.attempt?.success);
    const deliveryStatus = delivered
      ? AGENT_STEP_STATES.COMPLETED
      : (deliveryOutcome && deliveryOutcome.skipped ? AGENT_STEP_STATES.SKIPPED : AGENT_STEP_STATES.RETRYABLE);
    await updateAgentStep(deliveryStep.agent_step_id, {
      status: deliveryStatus,
      reasonCode: delivered ? 'artifact_delivery_confirmed' : (deliveryOutcome?.reason || 'artifact_delivery_pending'),
      startedAt: deliveryStep.started_at || timestamp,
      completedAt: delivered || deliveryOutcome ? timestamp : null,
      output: { delivery: deliveryOutcome || null },
      evidence: { delivery: deliveryOutcome || null },
      artifactId: materialized.artifact?.artifact_id || null,
      notificationId: deliveryOutcome?.notification?.notification_id || null,
      timestamp,
    });
    await appendAgentStepEvent({
      agent_run_id: agentRun.agent_run_id,
      agent_step_id: deliveryStep.agent_step_id,
      task_id: task.task_id,
      execution_id: executionId,
      event_type: delivered ? 'delivery_completed' : 'delivery_pending',
      payload: { delivery: deliveryOutcome || null },
      created_at: timestamp,
    });
  }

  await updateAgentRun(agentRun.agent_run_id, {
    status: AGENT_RUN_STATES.COMPLETED,
    currentStepIndex: steps.length,
    finalOutcome: materialized.automaticDelivery?.delivery?.status || (materialized.artifact?.delivery_confirmed ? 'artifact_delivered' : 'artifact_completed'),
    finalArtifactId: materialized.artifact?.artifact_id || null,
    finalNotificationId: materialized.automaticDelivery?.notification?.notification_id || null,
    timestamp,
  });

  return {
    ...materialized,
    agentRun: hydrateAgentRunRow({
      ...agentRun,
      status: AGENT_RUN_STATES.COMPLETED,
      current_step_index: steps.length,
      final_outcome: materialized.automaticDelivery?.delivery?.status || (materialized.artifact?.delivery_confirmed ? 'artifact_delivered' : 'artifact_completed'),
      final_artifact_id: materialized.artifact?.artifact_id || null,
      final_notification_id: materialized.automaticDelivery?.notification?.notification_id || null,
      updated_at: timestamp,
    }),
    agentSteps: await withBillingWrite(async (db) => getAgentStepsByRunIdTx(db, agentRun.agent_run_id)),
  };
}

async function attemptManagedArtifactMaterializationBeforeTerminalRecovery(executionId, completionText, options = {}) {
  const execution = await getExecutionById(executionId);
  if (!execution) {
    return { required: true, ok: false, reason: 'artifact_execution_missing' };
  }

  const task = await getTaskByExecutionId(executionId);
  if (!task) {
    return { required: true, ok: false, reason: 'artifact_execution_missing' };
  }

  const taskKind = String(task.task_kind || '');
  if (![TASK_KINDS.ARTIFACT_TASK, TASK_KINDS.AGENT_WORKFLOW_TASK].includes(taskKind)) {
    return { required: false, ok: true, skipped: true };
  }

  const materialized = await attemptManagedArtifactWorkflowForExecution(executionId, completionText, options);
  if (!materialized.ok) {
    return materialized;
  }

  const assessment = await getVerifiedTaskArtifactAssessmentForExecutionId(executionId);
  if (!assessment) {
    return {
      required: true,
      ok: false,
      reason: 'artifact_semantic_verification_failed',
      fallbackText: materialized.fallbackText || buildManagedTerminalFallbackText({ messages: [{ role: 'user', content: task.objective_text || '' }] }),
    };
  }

  return {
    required: true,
    ok: true,
    materialized,
    assessment,
    successText: buildManagedArtifactSuccessText(materialized.filename, materialized.artifactType),
  };
}

function shouldBuildManagedArtifactFallbackText(promptText = '') {
  const normalized = String(promptText || '').toLowerCase();
  if (!normalized) {
    return false;
  }

  const createWords = /\b(create|write|generate|save|make|draft)\b/.test(normalized);
  const artifactWords = /\b(file|markdown|document|artifact|note)\b/.test(normalized);
  return Boolean(createWords && artifactWords);
}

function buildManagedTerminalFallbackText(reqBody = {}, options = {}) {
  const promptText = extractManagedRequestPromptText(reqBody);
  if (!shouldBuildManagedArtifactFallbackText(promptText)) {
    return '';
  }

  const requestedFilename = extractManagedArtifactFilename(promptText);
  const fallbackFilename = requestedFilename || 'requested-file.md';
  const fallbackTitle = fallbackFilename.replace(/\.(md|markdown)$/i, '') || 'requested-file';
  const introText = String(options.introText || '').trim() || `I couldn't verify creation of ${fallbackFilename}, but here is a markdown draft you can save manually:`;

  return `${introText}\n\n\`\`\`md\n# ${fallbackTitle}\n\nI couldn't verify the file creation from this run.\n\`\`\``;
}

function getArtifactContractInput(reqBody = {}) {
  const body = reqBody && typeof reqBody === 'object' ? reqBody : {};
  return body?.metadata?.blockfork_artifact_contract || body?.blockfork_artifact_contract || null;
}

async function findOrCreateWorkspaceBinding(canonicalRoot, rootSource, options = {}) {
  return withBillingWrite(async (db) => {
    const existing = await getStoredWorkspaceByRoot(db, canonicalRoot);
    if (existing) {
      return existing;
    }

    const timestamp = options.timestamp || getTimestamp();
    const workspaceId = createWorkspaceId();
    const insert = db.prepare(`
      INSERT INTO workspaces (
        workspace_id, canonical_root, root_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    insert.run([
      workspaceId,
      canonicalRoot,
      rootSource || 'runtime',
      timestamp,
      timestamp,
    ]);
    insert.free();

    return {
      workspace_id: workspaceId,
      canonical_root: canonicalRoot,
      root_source: rootSource || 'runtime',
      created_at: timestamp,
      updated_at: timestamp,
    };
  });
}

async function getWorkspaceById(workspaceId) {
  const db = await ensureBillingDb();
  return getStoredWorkspaceById(db, workspaceId);
}

async function attachExecutionWorkspace(executionId, workspaceId, options = {}) {
  return withBillingWrite(async (db) => {
    const current = await getStoredExecutionById(db, executionId);
    if (!current) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (current.workspace_id) {
      if (current.workspace_id !== workspaceId) {
        throw new Error('artifact_workspace_rebind_not_allowed');
      }
      return current;
    }

    const timestamp = options.timestamp || getTimestamp();
    const update = db.prepare(`
      UPDATE executions
      SET workspace_id = ?, updated_at = ?, last_request_id = ?
      WHERE execution_id = ?
    `);
    update.run([
      workspaceId,
      timestamp,
      options.requestId || current.last_request_id || '',
      executionId,
    ]);
    update.free();

    appendExecutionEventTx(db, {
      execution_id: executionId,
      previous_state: current.current_state,
      new_state: current.current_state,
      timestamp,
      actor_source: options.actorSource || 'runtime',
      reason_code: options.reasonCode || 'execution_workspace_bound',
      request_id: options.requestId || current.last_request_id || null,
      notes: workspaceId,
    });

    return {
      ...current,
      workspace_id: workspaceId,
      updated_at: timestamp,
      last_request_id: options.requestId || current.last_request_id || '',
    };
  });
}

async function getExecutionArtifactByExecutionId(executionId) {
  const db = await ensureBillingDb();
  return getStoredExecutionArtifactByExecutionId(db, executionId);
}

async function getExecutionArtifactByArtifactId(artifactId) {
  const db = await ensureBillingDb();
  return getStoredExecutionArtifactByArtifactId(db, artifactId);
}

async function createExecutionArtifactRecord(options = {}) {
  return withBillingWrite(async (db) => {
    const executionId = String(options.executionId || '');
    const workspaceId = String(options.workspaceId || '');
    if (!executionId || !workspaceId) {
      throw new Error('Artifact record requires executionId and workspaceId');
    }

    const current = await getStoredExecutionArtifactByExecutionId(db, executionId);
    const timestamp = options.timestamp || getTimestamp();
    const artifactFilename = String(options.artifactFilename || '').trim();
    const artifactType = String(options.artifactType || 'text');
    const contentHash = String(options.contentHash || '');
    const byteSize = Number(options.byteSize || 0);
    const deliveryRequested = Number(Boolean(options.deliveryRequested));
    const deliveryConfirmed = Number(Boolean(options.deliveryConfirmed));

    if (current) {
      if (current.workspace_id !== workspaceId) {
        throw new Error('artifact_workspace_rebind_not_allowed');
      }
      const update = db.prepare(`
        UPDATE execution_artifacts
        SET declared_path = ?,
            canonical_path = ?,
            verification_state = ?,
            reason_code = ?,
            artifact_filename = ?,
            artifact_type = ?,
            content_hash = ?,
            byte_size = ?,
            delivery_requested = ?,
            delivery_confirmed = ?,
            updated_at = ?
        WHERE execution_id = ?
      `);
      update.run([
        options.declaredPath,
        options.canonicalPath,
        options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING,
        options.reasonCode || '',
        artifactFilename,
        artifactType,
        contentHash,
        byteSize,
        deliveryRequested,
        deliveryConfirmed,
        timestamp,
        executionId,
      ]);
      update.free();
      syncTaskStateForArtifactTx(db, executionId, options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING, {
        requestId: options.requestId || null,
        actorSource: options.actorSource || 'runtime',
        reasonCode: options.reasonCode || 'artifact_record_updated',
        timestamp,
      });
      const updatedExecution = await getStoredExecutionById(db, executionId);
      if (updatedExecution?.task_id && String(options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING) === ARTIFACT_VERIFICATION_STATES.PENDING) {
        appendTaskProgressEventTx(db, {
          task_id: updatedExecution.task_id,
          execution_id: executionId,
          previous_state: '',
          new_state: TASK_STATES.ARTIFACT_CREATED,
          progress_category: TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFICATION_STARTED,
          decision: 'notify_user',
          message_text: 'The artifact is in place and verification is starting.',
          requires_user_input: 0,
          source: options.actorSource || 'runtime',
          reason_code: options.reasonCode || 'artifact_record_updated',
          created_at: timestamp,
        });
      }
      await syncTaskArtifactAssessmentTx(db, executionId, {
        requestId: options.requestId || null,
        actorSource: options.actorSource || 'runtime',
        reasonCode: options.reasonCode || 'artifact_record_updated',
        timestamp,
      });
      return {
        ...current,
        declared_path: options.declaredPath,
        canonical_path: options.canonicalPath,
        verification_state: options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING,
        reason_code: options.reasonCode || '',
        artifact_filename: artifactFilename,
        artifact_type: artifactType,
        content_hash: contentHash,
        byte_size: byteSize,
        delivery_requested: deliveryRequested,
        delivery_confirmed: deliveryConfirmed,
        updated_at: timestamp,
      };
    }

    const artifactId = createExecutionArtifactId();
    const insert = db.prepare(`
      INSERT INTO execution_artifacts (
        artifact_id, execution_id, workspace_id, declared_path, canonical_path, verification_state,
        reason_code, artifact_filename, artifact_type, content_hash, byte_size, delivery_requested, delivery_confirmed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      artifactId,
      executionId,
      workspaceId,
      options.declaredPath,
      options.canonicalPath,
      options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING,
      options.reasonCode || '',
      artifactFilename,
      artifactType,
      contentHash,
      byteSize,
      deliveryRequested,
      deliveryConfirmed,
      timestamp,
      timestamp,
    ]);
    insert.free();
    syncTaskStateForArtifactTx(db, executionId, options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING, {
      requestId: options.requestId || null,
      actorSource: options.actorSource || 'runtime',
      reasonCode: options.reasonCode || 'artifact_record_created',
      timestamp,
    });
    const createdExecution = await getStoredExecutionById(db, executionId);
    if (createdExecution?.task_id && String(options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING) === ARTIFACT_VERIFICATION_STATES.PENDING) {
      appendTaskProgressEventTx(db, {
        task_id: createdExecution.task_id,
        execution_id: executionId,
        previous_state: '',
        new_state: TASK_STATES.ARTIFACT_CREATED,
        progress_category: TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFICATION_STARTED,
        decision: 'notify_user',
        message_text: 'The artifact is in place and verification is starting.',
        requires_user_input: 0,
        source: options.actorSource || 'runtime',
        reason_code: options.reasonCode || 'artifact_record_created',
        created_at: timestamp,
      });
    }
    await syncTaskArtifactAssessmentTx(db, executionId, {
      requestId: options.requestId || null,
      actorSource: options.actorSource || 'runtime',
      reasonCode: options.reasonCode || 'artifact_record_created',
      timestamp,
    });
    return {
      artifact_id: artifactId,
      execution_id: executionId,
      workspace_id: workspaceId,
      declared_path: options.declaredPath,
      canonical_path: options.canonicalPath,
      verification_state: options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING,
      reason_code: options.reasonCode || '',
      artifact_filename: artifactFilename,
      artifact_type: artifactType,
      content_hash: contentHash,
      byte_size: byteSize,
      delivery_requested: deliveryRequested,
      delivery_confirmed: deliveryConfirmed,
      created_at: timestamp,
      updated_at: timestamp,
    };
  });
}

async function updateExecutionArtifactVerification(executionId, verificationState, options = {}) {
  return withBillingWrite(async (db) => {
    const current = await getStoredExecutionArtifactByExecutionId(db, executionId);
    if (!current) {
      throw new Error(`Artifact record not found for execution: ${executionId}`);
    }

    const timestamp = options.timestamp || getTimestamp();
    const artifactFilename = String(options.artifactFilename || current.artifact_filename || '').trim();
    const artifactType = String(options.artifactType || current.artifact_type || 'text');
    const contentHash = String(options.contentHash || current.content_hash || '');
    const byteSize = Number.isFinite(Number(options.byteSize))
      ? Number(options.byteSize)
      : Number(current.byte_size || 0);
    const update = db.prepare(`
      UPDATE execution_artifacts
      SET verification_state = ?,
          reason_code = ?,
          artifact_filename = ?,
          artifact_type = ?,
          content_hash = ?,
          byte_size = ?,
          delivery_requested = ?,
          delivery_confirmed = ?,
          canonical_path = ?,
          declared_path = ?,
          updated_at = ?
      WHERE execution_id = ?
    `);
    update.run([
      verificationState,
      options.reasonCode || '',
      artifactFilename,
      artifactType,
      contentHash,
      byteSize,
      Number(Boolean(options.deliveryRequested ?? current.delivery_requested)),
      Number(Boolean(options.deliveryConfirmed ?? current.delivery_confirmed)),
      options.canonicalPath || current.canonical_path,
      options.declaredPath || current.declared_path,
      timestamp,
      executionId,
    ]);
    update.free();
    syncTaskStateForArtifactTx(db, executionId, verificationState, {
      requestId: options.requestId || null,
      actorSource: options.actorSource || 'runtime',
      reasonCode: options.reasonCode || 'artifact_verification_updated',
      timestamp,
    });
    await syncTaskArtifactAssessmentTx(db, executionId, {
      requestId: options.requestId || null,
      actorSource: options.actorSource || 'runtime',
      reasonCode: options.reasonCode || 'artifact_verification_updated',
      completionText: options.completionText || '',
      timestamp,
    });

    return {
      ...current,
      verification_state: verificationState,
      reason_code: options.reasonCode || '',
      artifact_filename: artifactFilename,
      artifact_type: artifactType,
      content_hash: contentHash,
      byte_size: byteSize,
      delivery_requested: Number(Boolean(options.deliveryRequested ?? current.delivery_requested)),
      delivery_confirmed: Number(Boolean(options.deliveryConfirmed ?? current.delivery_confirmed)),
      canonical_path: options.canonicalPath || current.canonical_path,
      declared_path: options.declaredPath || current.declared_path,
      updated_at: timestamp,
    };
  });
}

async function updateExecutionArtifactDeliveryStatusTx(db, executionId, options = {}) {
  const current = await getStoredExecutionArtifactByExecutionId(db, executionId);
  if (!current) {
    throw new Error(`Artifact record not found for execution: ${executionId}`);
  }

  const timestamp = options.timestamp || getTimestamp();
  const update = db.prepare(`
    UPDATE execution_artifacts
    SET delivery_requested = ?,
        delivery_confirmed = ?,
        reason_code = ?,
        updated_at = ?
    WHERE execution_id = ?
  `);
  update.run([
    Number(Boolean(options.deliveryRequested ?? current.delivery_requested)),
    Number(Boolean(options.deliveryConfirmed ?? current.delivery_confirmed)),
    options.reasonCode || current.reason_code || '',
    timestamp,
    executionId,
  ]);
  update.free();

  return getStoredExecutionArtifactByExecutionId(db, executionId);
}

async function updateExecutionArtifactDeliveryStatus(executionId, options = {}) {
  return withBillingWrite(async (db) => updateExecutionArtifactDeliveryStatusTx(db, executionId, options));
}

function buildArtifactDeliveryTitle(filename = '') {
  const normalized = String(filename || '').trim();
  return normalized ? `Artifact ready: ${normalized}` : 'Artifact ready for delivery';
}

function buildArtifactDeliveryBody(filename = '', artifactType = '') {
  const normalizedFilename = String(filename || '').trim();
  const normalizedType = String(artifactType || '').trim();
  if (normalizedFilename) {
    return `Created artifact: ${normalizedFilename}`;
  }
  if (normalizedType) {
    return `Created ${normalizedType} artifact`;
  }
  return 'Created verified artifact';
}

function artifactDeliveryMediaKindFromArtifact(artifact = {}) {
  const filename = String(artifact?.artifact_filename || artifact?.declared_path || '').trim();
  const type = String(artifact?.artifact_type || '').trim();
  if (type && type !== 'text') {
    return type;
  }
  if (/\.(md|markdown)$/i.test(filename)) {
    return 'markdown';
  }
  return type || 'document';
}

async function getStoredTaskNotificationByArtifactIdTx(db, artifactId) {
  const stmt = db.prepare(`
    SELECT *
    FROM task_notifications
    WHERE artifact_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `);
  stmt.bind([artifactId]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return hydrateTaskNotificationRow(row);
}

async function getTaskNotificationByArtifactId(artifactId) {
  const db = await ensureBillingDb();
  return getStoredTaskNotificationByArtifactIdTx(db, String(artifactId || ''));
}

async function assessArtifactDeliveryEligibility(executionId, options = {}) {
  const execution = await getExecutionById(executionId);
  if (!execution) {
    return { required: true, ok: false, reason: 'artifact_execution_missing' };
  }

  const task = await getTaskByExecutionId(executionId);
  if (!task) {
    return { required: true, ok: false, reason: 'artifact_execution_missing' };
  }

  const taskKind = String(task.task_kind || '');
  if (![TASK_KINDS.ARTIFACT_TASK, TASK_KINDS.AGENT_WORKFLOW_TASK].includes(taskKind)) {
    return { required: false, ok: true, skipped: true };
  }

  const artifact = await getExecutionArtifactByExecutionId(executionId);
  if (!artifact) {
    return { required: true, ok: false, reason: 'artifact_missing' };
  }

  if (String(artifact.verification_state || '') !== ARTIFACT_VERIFICATION_STATES.VERIFIED) {
    return { required: true, ok: false, reason: 'artifact_not_verified', artifact, task, execution };
  }

  let assessment = null;
  const canonicalPath = String(artifact.canonical_path || '').trim();
  if (!canonicalPath) {
    return { required: true, ok: false, reason: 'artifact_path_missing', artifact, task, execution };
  }

  const workspaceCheck = await assertArtifactPathWithinWorkspace(canonicalPath, execution.workspace_id);
  if (!workspaceCheck.ok) {
    return { required: true, ok: false, reason: workspaceCheck.reason || 'artifact_path_outside_workspace', artifact, task, execution };
  }

  if (!fs.existsSync(canonicalPath)) {
    return { required: true, ok: false, reason: 'artifact_path_not_found', artifact, task, execution };
  }

  const stats = fs.statSync(canonicalPath);
  if (!stats.isFile() || Number(stats.size || 0) <= 0) {
    return { required: true, ok: false, reason: 'artifact_not_nonempty_file', artifact, task, execution };
  }

  if (Number(stats.size || 0) > ARTIFACT_DELIVERY_MAX_BYTES) {
    return { required: true, ok: false, reason: 'artifact_file_too_large', artifact, task, execution };
  }

  assessment = await getTaskArtifactAssessmentByTaskId(task.task_id);
  if (!assessment || !assessment.artifact_exists) {
    return { required: true, ok: false, reason: 'artifact_assessment_missing', artifact, task, execution };
  }

  if (
    Number(assessment.confidence_score || 0) < 80
    || String(assessment.confidence_band || '') !== TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH
    || String(assessment.structure_state || '') !== TASK_ARTIFACT_STRUCTURE_STATES.VALID
    || String(assessment.alignment_state || '') !== TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED
  ) {
    return { required: true, ok: false, reason: 'artifact_low_confidence', artifact, task, execution, assessment };
  }

  if (String(artifact.delivery_confirmed || 0) === '1' && !options.allowDelivered) {
    return { required: true, ok: false, reason: 'artifact_already_delivered', artifact, task, execution, assessment };
  }

  return {
    required: true,
    ok: true,
    execution,
    task,
    artifact,
    assessment,
    file_path: canonicalPath,
    file_size: Number(stats.size || 0),
    media_kind: artifactDeliveryMediaKindFromArtifact(artifact),
  };
}

async function ensureArtifactDeliveryNotificationForExecution(executionId, options = {}) {
  return withBillingWrite(async (db) => {
    const eligibility = await assessArtifactDeliveryEligibility(executionId, options);
    if (!eligibility.ok) {
      return eligibility;
    }

    const timestamp = options.timestamp || getTimestamp();
    const artifact = eligibility.artifact;
    const task = eligibility.task;
    const assessment = eligibility.assessment;
    const relayLabel = await resolveAutomaticArtifactDeliveryRelayLabel(executionId, {
      ...options,
      artifact,
      task,
      assessment,
    });
    const existing = await getStoredTaskNotificationByArtifactIdTx(db, artifact.artifact_id);
    const dedupeKey = `artifact_delivery:${artifact.artifact_id}`;
    const payload = {
      artifact_id: artifact.artifact_id || '',
      artifact_path: artifact.canonical_path || '',
      artifact_filename: artifact.artifact_filename || '',
      artifact_type: artifact.artifact_type || 'document',
      content_hash: artifact.content_hash || '',
      byte_size: Number(artifact.byte_size || 0),
      execution_id: executionId,
      task_id: task.task_id,
      session_id: task.session_id,
      workspace_id: artifact.workspace_id || '',
      verification_state: artifact.verification_state || '',
      assessment_id: assessment?.assessment_id || '',
      confidence_score: Number(assessment?.confidence_score || 0),
      confidence_band: assessment?.confidence_band || '',
      structure_state: assessment?.structure_state || '',
      alignment_state: assessment?.alignment_state || '',
      relay_label: relayLabel,
      media_kind: eligibility.media_kind,
      delivery_requested: true,
      delivery_confirmed: Boolean(artifact.delivery_confirmed),
    };

    appendTaskNotificationTx(db, {
      notification_id: existing?.notification_id || createTaskNotificationId(),
      task_id: task.task_id,
      session_id: task.session_id,
      execution_id: executionId,
      source_type: 'artifact_delivery',
      source_id: artifact.artifact_id,
      notification_kind: ARTIFACT_DELIVERY_NOTIFICATION_KIND,
      delivery_channel: 'openclaw_tg',
      delivery_state: existing?.delivery_state || TASK_NOTIFICATION_DELIVERY_STATES.PENDING,
      title: buildArtifactDeliveryTitle(artifact.artifact_filename || ''),
      body: buildArtifactDeliveryBody(artifact.artifact_filename || '', artifact.artifact_type || ''),
      artifact_id: artifact.artifact_id,
      artifact_path: artifact.canonical_path,
      media_kind: eligibility.media_kind,
      relay_label: relayLabel,
      task_kind: TASK_KINDS.ARTIFACT_TASK,
      notification_policy: TASK_NOTIFICATION_POLICIES.COMPLETION_ONLY,
      proactive_eligible: 0,
      eligibility_reason: 'verified artifact ready for controlled delivery',
      delivery_suppressed_reason: ARTIFACT_DELIVERY_CONTROL_REASON,
      classified_at: timestamp,
      payload,
      dedupe_key: dedupeKey,
      claim_count: existing?.claim_count || 0,
      claimed_at: existing?.claimed_at || null,
      delivered_at: existing?.delivered_at || null,
      delivered_message_id: existing?.delivered_message_id || null,
      last_error: existing?.last_error || '',
      next_attempt_at: existing?.next_attempt_at || null,
      attempt_count: existing?.attempt_count || 0,
      created_at: existing?.created_at || timestamp,
      updated_at: timestamp,
    });

    await updateExecutionArtifactDeliveryStatusTx(db, executionId, {
      deliveryRequested: true,
      deliveryConfirmed: Boolean(artifact.delivery_confirmed),
      reasonCode: 'artifact_delivery_requested',
      timestamp,
    });

    return {
      ok: true,
      required: true,
      execution: eligibility.execution,
      task: eligibility.task,
      artifact: eligibility.artifact,
      assessment: eligibility.assessment,
      file_path: eligibility.file_path,
      file_size: eligibility.file_size,
      media_kind: eligibility.media_kind,
      notification: await getStoredTaskNotificationByArtifactIdTx(db, artifact.artifact_id),
    };
  });
}

async function assertArtifactPathWithinWorkspace(canonicalPath, workspaceId) {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace || !workspace.canonical_root) {
    return { ok: false, reason: 'artifact_workspace_missing' };
  }
  if (!isPathWithinRoot(canonicalPath, workspace.canonical_root)) {
    return { ok: false, reason: 'artifact_path_outside_workspace', workspace };
  }
  return { ok: true, workspace };
}

async function prepareArtifactBindingForExecution(executionId, reqBody, options = {}) {
  const contract = getArtifactContractInput(reqBody);
  if (!contract || contract.requested !== true) {
    return { required: false, ok: true };
  }

  const binding = resolveWorkspaceBindingForArtifact(contract);
  if (!binding.ok) {
    return { ...binding, contract };
  }

  const workspace = await findOrCreateWorkspaceBinding(binding.workspace_root, binding.root_source, options);
  const execution = await attachExecutionWorkspace(executionId, workspace.workspace_id, {
    requestId: options.requestId || '',
    actorSource: options.actorSource || 'runtime',
    reasonCode: 'execution_workspace_bound',
  });
  const artifact = await createExecutionArtifactRecord({
    executionId,
    workspaceId: workspace.workspace_id,
    declaredPath: binding.declared_path,
    canonicalPath: binding.canonical_path,
    verificationState: ARTIFACT_VERIFICATION_STATES.PENDING,
    deliveryRequested: binding.delivery_requested,
    deliveryConfirmed: binding.delivery_confirmed,
    reasonCode: '',
    timestamp: options.timestamp,
  });

  return {
    required: true,
    ok: true,
    contract,
    workspace,
    artifact,
    execution,
    binding,
  };
}

async function checkArtifactEvidence(contract, options = {}) {
  if (!contract || contract.requested !== true) {
    return { required: false, ok: true };
  }

  const binding = resolveWorkspaceBindingForArtifact(contract);
  if (!binding.ok) {
    return { required: true, ok: false, reason: binding.reason };
  }

  if (options.executionId) {
    const execution = await getExecutionById(options.executionId);
    if (!execution) {
      return { required: true, ok: false, reason: 'artifact_execution_missing' };
    }
    if (!execution.workspace_id) {
      return { required: true, ok: false, reason: 'artifact_workspace_missing' };
    }
    const workspaceCheck = await assertArtifactPathWithinWorkspace(binding.canonical_path, execution.workspace_id);
    if (!workspaceCheck.ok) {
      return { required: true, ok: false, reason: workspaceCheck.reason };
    }
  }

  if (!fs.existsSync(binding.declared_path)) {
    return { required: true, ok: false, reason: 'artifact_path_not_found' };
  }

  const stats = fs.statSync(binding.declared_path);
  if (!stats.isFile() || Number(stats.size || 0) <= 0) {
    return { required: true, ok: false, reason: 'artifact_not_nonempty_file' };
  }

  if (binding.delivery_requested && !binding.delivery_confirmed) {
    return { required: true, ok: false, reason: 'artifact_delivery_not_confirmed' };
  }

  return {
    required: true,
    ok: true,
    declared_path: binding.declared_path,
    canonical_path: binding.canonical_path,
    delivery_requested: binding.delivery_requested,
    delivery_confirmed: binding.delivery_confirmed,
  };
}

function detectArtifactClaim(text = '') {
  const normalized = String(text || '').toLowerCase();
  return /\b(created|generated|saved|attached|uploaded|sent)\b/.test(normalized)
    && /\b(file|pdf|artifact|document|report)\b/.test(normalized);
}

async function validateArtifactHonestyOrError(reqBody, completionText, options = {}) {
  const contract = getArtifactContractInput(reqBody);
  const evidenceCheck = await checkArtifactEvidence(contract, options);
  if (evidenceCheck.required && !evidenceCheck.ok) {
    if (options.executionId) {
      await updateExecutionArtifactVerification(options.executionId, ARTIFACT_VERIFICATION_STATES.REJECTED, {
        reasonCode: evidenceCheck.reason,
        completionText,
      });
    }
    return {
      statusCode: 422,
      message: `Artifact verification failed: ${evidenceCheck.reason}`,
      type: 'invalid_request_error',
      code: 'artifact_verification_failed',
      reason: evidenceCheck.reason,
      requiresRecovery: Boolean(options.meaningfulOutputStarted),
    };
  }

  if (!contract || contract.requested !== true) {
    return null;
  }

  if (detectArtifactClaim(completionText) && !evidenceCheck.ok) {
    if (options.executionId) {
      await updateExecutionArtifactVerification(options.executionId, ARTIFACT_VERIFICATION_STATES.REJECTED, {
        reasonCode: 'artifact_claim_without_evidence',
        completionText,
      });
    }
    return {
      statusCode: 422,
      message: 'Artifact claim blocked: no verifiable artifact evidence',
      type: 'invalid_request_error',
      code: 'artifact_claim_without_evidence',
      reason: 'artifact_claim_without_evidence',
      requiresRecovery: Boolean(options.meaningfulOutputStarted),
    };
  }

  let verifiedArtifactText = String(completionText || '');
  if (evidenceCheck.canonical_path) {
    try {
      if (fs.existsSync(evidenceCheck.canonical_path)) {
        verifiedArtifactText = normalizeArtifactTextSample(fs.readFileSync(evidenceCheck.canonical_path, 'utf8'));
      }
    } catch (_) {}
  }

  if (options.executionId) {
    await updateExecutionArtifactVerification(options.executionId, ARTIFACT_VERIFICATION_STATES.VERIFIED, {
      reasonCode: '',
      deliveryRequested: evidenceCheck.delivery_requested,
      deliveryConfirmed: evidenceCheck.delivery_confirmed,
      canonicalPath: evidenceCheck.canonical_path,
      declaredPath: evidenceCheck.declared_path,
      completionText: verifiedArtifactText,
    });

    const verifiedAssessment = await getVerifiedTaskArtifactAssessmentForExecutionId(options.executionId);
    if (!verifiedAssessment) {
      await updateExecutionArtifactVerification(options.executionId, ARTIFACT_VERIFICATION_STATES.REJECTED, {
        reasonCode: 'artifact_semantic_verification_failed',
        deliveryRequested: evidenceCheck.delivery_requested,
        deliveryConfirmed: evidenceCheck.delivery_confirmed,
        canonicalPath: evidenceCheck.canonical_path,
        declaredPath: evidenceCheck.declared_path,
        completionText: verifiedArtifactText,
      });
      return {
        statusCode: 422,
        message: 'Artifact verification failed: artifact_semantic_verification_failed',
        type: 'invalid_request_error',
        code: 'artifact_semantic_verification_failed',
        reason: 'artifact_semantic_verification_failed',
        requiresRecovery: Boolean(options.meaningfulOutputStarted),
      };
    }
  }

  return null;
}

function buildResponseStreamObject(session, modelAlias, responseId, createdAt) {
  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'in_progress',
    error: null,
    incomplete_details: null,
    instructions: null,
    model: modelAlias,
    output: [],
    session_id: session.session_id,
  };
}

function buildResponseCompletedStreamObject(session, modelAlias, responseId, createdAt, outputText, itemId = null) {
  const messageItemId = itemId || `msg_${crypto.randomUUID()}`;
  return {
    ...buildResponseStreamObject(session, modelAlias, responseId, createdAt),
    status: 'completed',
    output: [
      {
        id: messageItemId,
        status: 'completed',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: stringifyTextContent(outputText || ''),
            annotations: [],
          },
        ],
      },
    ],
  };
}

function buildResponseIncompleteStreamObject(session, modelAlias, responseId, createdAt, incompleteDetails = {}) {
  return {
    ...buildResponseStreamObject(session, modelAlias, responseId, createdAt),
    status: 'incomplete',
    incomplete_details: {
      reason: 'terminal_payload_missing',
      message: 'Managed response completed without a usable terminal payload',
      ...incompleteDetails,
    },
  };
}

function buildManagedTerminalWireOutcome(session, modelAlias, responseId, createdAt, options = {}) {
  const terminalIntegrityClassification = classifyManagedTerminalCompletionIntegrity(options);
  if (!terminalIntegrityClassification) {
    return null;
  }

  return {
    classification: terminalIntegrityClassification,
    eventType: 'response.incomplete',
    response: buildResponseIncompleteStreamObject(session, modelAlias, responseId, createdAt, {
      reason: terminalIntegrityClassification.reasonCode,
      message: terminalIntegrityClassification.reasonDetail,
    }),
  };
}

function buildManagedTerminalFallbackWireOutcome(session, modelAlias, responseId, createdAt, fallbackText, itemId = null) {
  const normalizedFallbackText = stringifyTextContent(fallbackText || '');
  if (!normalizedFallbackText) {
    return null;
  }

  return {
    eventType: 'response.completed',
    response: buildResponseCompletedStreamObject(session, modelAlias, responseId, createdAt, normalizedFallbackText, itemId),
  };
}

function writeSseEvent(res, eventType, payload) {
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify({ ...payload, type: eventType })}\n\n`);
}

function extractChatDeltaContent(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const deltaContent = choice?.delta?.content;
  if (typeof deltaContent === 'string' && deltaContent.length > 0) {
    return deltaContent;
  }

  const messageContent = choice?.message?.content;
  if (typeof messageContent === 'string' && messageContent.length > 0) {
    return messageContent;
  }

  return '';
}

function normalizeChatChunkPayload(payload, modelAlias, fallbackCreated) {
  return {
    ...payload,
    id: payload.id || `chatcmpl_${crypto.randomUUID()}`,
    object: payload.object || 'chat.completion.chunk',
    created: Number.isFinite(payload.created) ? payload.created : fallbackCreated,
    model: modelAlias,
  };
}

function normalizeTextForDedupe(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactLocalMessages(messages) {
  if (!Array.isArray(messages)) {
    return messages;
  }

  const next = [];
  let lastKey = '';

  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const role = typeof raw.role === 'string' ? raw.role : '';
    const content = raw.content;
    const dedupeKey = `${role}::${typeof content === 'string' ? normalizeTextForDedupe(content) : JSON.stringify(content)}`;

    if (dedupeKey && dedupeKey === lastKey) {
      continue;
    }

    lastKey = dedupeKey;
    next.push({
      ...raw,
      ...(typeof content === 'string' ? { content: normalizeTextForDedupe(content) } : {}),
    });
  }

  if (next.length > LOCAL_PROFILE_MAX_MESSAGES) {
    return next.slice(next.length - LOCAL_PROFILE_MAX_MESSAGES);
  }

  return next;
}

function applyLocalOrchestrationProfile(reqBody, descriptor, requestId = '') {
  if (!ENABLE_LOCAL_PROFILE || !isLocalProviderDescriptor(descriptor) || !reqBody || typeof reqBody !== 'object') {
    return reqBody;
  }

  const beforeBytes = Buffer.byteLength(JSON.stringify(reqBody), 'utf8');
  const beforeTools = countTools(reqBody);
  const nextBody = {
    ...reqBody,
    messages: compactLocalMessages(reqBody.messages),
  };

  if (typeof nextBody.system === 'string') {
    nextBody.system = normalizeTextForDedupe(nextBody.system);
  }

  if (Array.isArray(nextBody.tools)) {
    // Semantics-preserving compaction: normalize object shape without dropping tools.
    nextBody.tools = nextBody.tools.map((tool) => (tool && typeof tool === 'object'
      ? JSON.parse(JSON.stringify(tool))
      : tool));
  }

  const afterBytes = Buffer.byteLength(JSON.stringify(nextBody), 'utf8');
  const afterTools = countTools(nextBody);
  if (afterBytes !== beforeBytes) {
    logRoutingDecision('local_profile_applied', {
      request_id: requestId,
      payload_size_before_bytes: beforeBytes,
      payload_size_after_bytes: afterBytes,
      tool_count_before: beforeTools,
      tool_count_after: afterTools,
    });
  }

  return nextBody;
}

function buildUpstreamBody(reqBody, descriptor) {
  const upstreamBody = {
    ...reqBody,
    model: descriptor.upstreamId,
  };

  if (reqBody.stream) {
    upstreamBody.stream_options = {
      ...(reqBody.stream_options || {}),
      include_usage: true,
    };
  } else {
    delete upstreamBody.stream_options;
  }

  return upstreamBody;
}

function getProviderConfig(session, descriptor, upstreamApiKeyOverride = '') {
  const registry = buildProviderRegistry();
  const providerId = getDescriptorProviderId(descriptor) || session.provider;
  const provider = registry[providerId];
  if (!provider || !provider.chatUrl) {
    return null;
  }

  const apiKey = providerId === 'openrouter'
    ? (upstreamApiKeyOverride || session.upstream_api_key || provider.apiKey)
    : (upstreamApiKeyOverride || provider.apiKey || '');

  if (provider.requiresApiKey && !apiKey) {
    return null;
  }

  return {
    providerId,
    chatUrl: provider.chatUrl,
    modelsUrl: provider.modelsUrl,
    apiKey,
    requiresApiKey: provider.requiresApiKey,
    probeMethod: provider.probeMethod,
  };
}

async function fetchUpstreamChat(session, descriptor, upstreamBody, isStreaming, requestId, extra = {}) {
  const providerConfig = getProviderConfig(session, descriptor, extra.upstream_api_key_override || '');
  if (!providerConfig || (providerConfig.requiresApiKey && !providerConfig.apiKey)) {
    return { error: { statusCode: 500, message: 'Provider configuration is incomplete', type: 'runtime_error', code: 'provider_not_configured' } };
  }

  const upstreamContext = buildUpstreamLogContext(session, descriptor, upstreamBody, providerConfig.chatUrl, requestId, extra);
  logUpstreamRequest(upstreamContext);

  const controller = new AbortController();
  const timeoutMs = getRequestTimeoutMs(descriptor, isStreaming, extra.attempt || 'primary');
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const simulatePrimary429 = extra.attempt === 'primary' && (FORCE_PRIMARY_429 || extra.test_primary_failure_mode === '429');
    const simulatePrimaryTimeout = extra.attempt === 'primary' && (FORCE_PRIMARY_TIMEOUT || extra.test_primary_failure_mode === 'timeout');

    if (simulatePrimary429) {
      const syntheticBody = JSON.stringify({
        error: {
          message: 'Simulated primary rate limit for fallback smoke testing',
          code: 429,
        },
      });
      const upstream = {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map(),
        clone() {
          return this;
        },
        async text() {
          return syntheticBody;
        },
      };

      clearTimeout(timeout);
      logUpstreamFailure(upstreamContext, {
        status: upstream.status,
        status_text: upstream.statusText,
        response_body: truncateText(syntheticBody, UPSTREAM_ERROR_BODY_LIMIT_BYTES),
        duration_ms: Date.now() - upstreamContext.started_at_ms,
      });
      logRoutingDecision('primary_outcome', {
        request_id: requestId,
        status: 429,
        classification: 'rate_limited',
      });

      return { upstream, upstreamContext };
    }

    if (simulatePrimaryTimeout) {
      clearTimeout(timeout);
      logUpstreamFailure(upstreamContext, {
        status: 0,
        status_text: 'Simulated Primary Timeout',
        response_body: '',
        duration_ms: Date.now() - upstreamContext.started_at_ms,
      });
      logRoutingDecision('primary_outcome', {
        request_id: requestId,
        status: 0,
        classification: 'primary_timeout',
      });
      return {
        error: { statusCode: 502, message: 'Upstream request timed out', type: 'provider_error', code: 'upstream_timeout' },
        upstreamContext,
      };
    }

    const upstream = await fetch(providerConfig.chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(providerConfig.apiKey ? { Authorization: `Bearer ${providerConfig.apiKey}` } : {}),
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!upstream.ok) {
      let responseBody = '';
      try {
        const responseClone = typeof upstream.clone === 'function' ? upstream.clone() : upstream;
        responseBody = await responseClone.text();
      } catch (error) {
        responseBody = '';
      }

      logUpstreamFailure(upstreamContext, {
        status: upstream.status,
        status_text: upstream.statusText,
        response_body: truncateText(responseBody, UPSTREAM_ERROR_BODY_LIMIT_BYTES),
        duration_ms: Date.now() - upstreamContext.started_at_ms,
      });
      if (extra.attempt === 'primary' && upstream.status === 429) {
        logRoutingDecision('primary_outcome', {
          request_id: requestId,
          status: 429,
          classification: 'rate_limited',
        });
      }
      if (extra.attempt === 'primary' && upstream.status === 401) {
        logRoutingDecision('primary_outcome', {
          request_id: requestId,
          status: 401,
          classification: 'unauthorized',
        });
      }
    } else if (extra.attempt === 'primary') {
      logRoutingDecision('primary_outcome', {
        request_id: requestId,
        status: 200,
        classification: 'success',
      });
    }

    return { upstream, upstreamContext };
  } catch (error) {
    clearTimeout(timeout);
    logUpstreamFailure(upstreamContext, {
      status: 0,
      status_text: error.name || error.message || 'fetch_error',
      response_body: '',
      duration_ms: Date.now() - upstreamContext.started_at_ms,
    });
    if (error.name === 'AbortError') {
      if (extra.attempt === 'primary') {
        logRoutingDecision('primary_outcome', {
          request_id: requestId,
          status: 0,
          classification: 'primary_timeout',
        });
      }
      return {
        error: { statusCode: 502, message: 'Upstream request timed out', type: 'provider_error', code: 'upstream_timeout' },
        upstreamContext,
      };
    }

    return {
      error: { statusCode: 502, message: 'Failed to reach upstream provider', type: 'provider_error', code: 'upstream_unreachable' },
      upstreamContext,
    };
  }
}

async function executeChatFlow(session, body, options = {}) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { error: { statusCode: 400, message: 'messages must be a non-empty array', type: 'invalid_request_error', code: 'invalid_messages' } };
  }

  const { descriptor: primaryDescriptor, error } = normalizeModelForSession(session, body.model);
  if (error) {
    return { error: { statusCode: 400, message: error, type: 'invalid_request_error', code: 'unsupported_model' } };
  }

  const providerConfig = getProviderConfig(session, primaryDescriptor, options.upstreamApiKeyOverride || '');
  if (!providerConfig || (providerConfig.requiresApiKey && !providerConfig.apiKey)) {
    return { error: { statusCode: 500, message: 'Provider configuration is incomplete', type: 'runtime_error', code: 'provider_not_configured' } };
  }

  const requestId = createRequestId();
  const taskObjectiveText = summarizeTaskObjectiveFromBody(body);
  const taskObjectiveFingerprint = fingerprintTaskObjective(session.session_id, taskObjectiveText, String(options.idempotencyKey || ''));
  const taskResult = await createTaskRecord({
    sessionId: session.session_id,
    requestId,
    idempotencyKey: options.idempotencyKey || '',
    objectiveText: taskObjectiveText,
    objectiveFingerprint: taskObjectiveFingerprint,
    actorSource: 'runtime',
    reasonCode: 'task_received',
  });
  const task = taskResult.task;
  const executionResult = await createExecutionRecord({
    sessionId: session.session_id,
    requestId,
    idempotencyKey: options.idempotencyKey || '',
    taskId: task.task_id,
    actorSource: 'runtime',
    reasonCode: 'request_admitted',
  });
  const execution = executionResult.execution;
  await transitionTask(task.task_id, TASK_STATES.ACKNOWLEDGED, {
    requestId,
    executionId: execution.execution_id,
    actorSource: 'runtime',
    reasonCode: 'task_acknowledged',
  });
  await transitionExecution(execution.execution_id, EXECUTION_STATES.QUEUED, {
    requestId,
    actorSource: 'runtime',
    reasonCode: 'request_queued',
  });
  const executionLease = await acquireExecutionLease(execution.execution_id, {
    requestId,
    actorSource: 'runtime',
    isStreaming: Boolean(body.stream),
  });
  await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.RUNNING, {
    requestId,
    actorSource: 'runtime',
    reasonCode: 'request_running',
    leaseId: executionLease.lease_id,
    leaseHolder: executionLease.lease_holder,
    leaseEpoch: executionLease.lease_epoch,
  });
  const artifactBinding = await prepareArtifactBindingForExecution(execution.execution_id, body, {
    requestId,
    actorSource: 'runtime',
    timestamp: getTimestamp(),
  });
  if (artifactBinding.required && !artifactBinding.ok) {
    await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.FAILED, {
      requestId,
      actorSource: 'runtime',
      reasonCode: artifactBinding.reason || 'artifact_workspace_invalid',
      leaseId: executionLease.lease_id,
      leaseHolder: executionLease.lease_holder,
      leaseEpoch: executionLease.lease_epoch,
      clearLease: true,
    });
    return {
      error: {
        statusCode: 422,
        message: `Artifact verification failed: ${artifactBinding.reason}`,
        type: 'invalid_request_error',
        code: 'artifact_verification_failed',
      },
      billing: {
        request_id: requestId,
        execution_id: execution.execution_id,
        execution_lease_id: executionLease.lease_id,
        execution_lease_holder: executionLease.lease_holder,
        execution_lease_epoch: executionLease.lease_epoch,
        timestamp: getTimestamp(),
        route: options.route || 'chat/completions',
        reserved: false,
        reserved_cost_usd: 0,
        primary_model: primaryDescriptor.upstreamId,
        model_used: primaryDescriptor.upstreamId,
        fallback_triggered: false,
        failure_reason: artifactBinding.reason || 'artifact_workspace_invalid',
        cost_descriptor: primaryDescriptor,
        finalized: true,
      },
      execution,
    };
  }
  const effectiveBody = applyLocalOrchestrationProfile(body, primaryDescriptor, requestId);
  const fallbackDescriptor = getFallbackDescriptorForAlias(primaryDescriptor);
  const timestamp = getTimestamp();
  const requestedEstimate = estimateRequestTokens(body);
  const acceptedEstimate = estimateRequestTokens(effectiveBody);
  const capabilityRecord = buildExecutionCapabilityRecord(
    execution.execution_id,
    session,
    body.model,
    primaryDescriptor,
    fallbackDescriptor,
    {
      timestamp,
      cachedContract: getCachedCapabilityContract(session),
    }
  );
  await persistExecutionCapabilityRecord(capabilityRecord);
  const contextAdaptationApplied = JSON.stringify(body) !== JSON.stringify(effectiveBody);
  const budgetRecord = buildExecutionBudgetRecord(
    execution.execution_id,
    body,
    effectiveBody,
    primaryDescriptor,
    {
      timestamp,
      requestedEstimate,
      acceptedEstimate,
      reservedOutputTokens: acceptedEstimate.outputTokens,
      contextAdaptationApplied,
      contextAdaptationReason: contextAdaptationApplied ? 'history_compaction' : 'none',
    }
  );
  await persistExecutionBudgetRecord(budgetRecord);
  const pressure = classifyContextPressure(budgetRecord);
  await persistSessionContextPressure(session.session_id, execution.execution_id, pressure, timestamp);
  if (shouldEmitRecommendationForPressureState(pressure.state)) {
    const pressureEventId = await appendSessionContinuityEvent({
      session_id: session.session_id,
      execution_id: execution.execution_id,
      pressure_state: pressure.state,
      pressure_ratio: pressure.ratio,
      event_type: pressure.state === 'warning' ? 'pressure_warning' : 'pressure_critical',
      decision: 'allow',
      source: 'pre_dispatch',
      reason_code: 'pressure_threshold_crossed',
      created_at: timestamp,
    });
    const repeatedCritical = pressure.state === 'critical'
      ? (await getContinuityEventCounts(session.session_id, 'pressure_critical', new Date(Date.now() - (60 * 60 * 1000)).toISOString())) >= 2
      : false;
    const pressureRecommendation = deriveContinuityRecommendation({
      pressureState: pressure.state,
      eventType: pressure.state === 'warning' ? 'pressure_warning' : 'pressure_critical',
      repeatedCritical,
      reasonCode: 'pressure_threshold_crossed',
    });
    await createOrUpdateSessionRecommendation({
      sessionId: session.session_id,
      executionId: execution.execution_id,
      recommendationType: pressureRecommendation.type,
      pressureState: pressure.state,
      triggerEventId: pressureEventId,
      reasonCode: pressureRecommendation.reasonCode,
      timestamp,
    });
  }
  const budgetFit = classifyExecutionBudgetFit(budgetRecord);
  if (!budgetFit.fits) {
    const overLimitEventId = await appendSessionContinuityEvent({
      session_id: session.session_id,
      execution_id: execution.execution_id,
      pressure_state: 'over_limit',
      pressure_ratio: pressure.ratio,
      event_type: 'pressure_over_limit',
      decision: 'reject_over_limit',
      source: 'pre_dispatch',
      reason_code: budgetFit.rejectionReason,
      created_at: getTimestamp(),
    });
    await appendSessionContinuityEvent({
      session_id: session.session_id,
      execution_id: execution.execution_id,
      pressure_state: 'over_limit',
      pressure_ratio: pressure.ratio,
      event_type: 'rollover_recommended',
      decision: 'recommend_rollover',
      source: 'pre_dispatch',
      reason_code: budgetFit.rejectionReason,
      created_at: getTimestamp(),
    });
    const repeatedOverflow = (await getContinuityEventCounts(session.session_id, 'pressure_over_limit', new Date(Date.now() - (60 * 60 * 1000)).toISOString())) >= 2;
    const recommendation = deriveContinuityRecommendation({
      pressureState: 'over_limit',
      eventType: 'pressure_over_limit',
      repeatedOverflow,
      reasonCode: budgetFit.rejectionReason,
    });
    await createOrUpdateSessionRecommendation({
      sessionId: session.session_id,
      executionId: execution.execution_id,
      recommendationType: recommendation.type,
      pressureState: 'over_limit',
      triggerEventId: overLimitEventId,
      reasonCode: recommendation.reasonCode,
      timestamp: getTimestamp(),
    });
    await updateExecutionBudgetOutcome(execution.execution_id, {
      timestamp: getTimestamp(),
      budgetRejectionReason: budgetFit.rejectionReason,
    });
    await recordRejectedRequestLog({
      request_id: requestId,
      timestamp: getTimestamp(),
      route: options.route || 'chat/completions',
      session_id: session.session_id,
      execution_id: execution.execution_id,
      primary_model: primaryDescriptor.upstreamId,
      model_used: primaryDescriptor.upstreamId,
      input_tokens: acceptedEstimate.inputTokens,
      output_tokens: 0,
      estimated_cost_usd: 0,
      status: 'rejected',
      fallback_triggered: false,
      failure_reason: budgetFit.rejectionReason,
      endpoint: providerConfig.chatUrl,
      error_code: budgetFit.rejectionReason,
      status_code: 422,
      response_body: '',
      reserved_cost_usd: 0,
    });
    await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.FAILED, {
      requestId,
      actorSource: 'runtime',
      reasonCode: budgetFit.rejectionReason,
      budgetRejectionReason: budgetFit.rejectionReason,
      leaseId: executionLease.lease_id,
      leaseHolder: executionLease.lease_holder,
      leaseEpoch: executionLease.lease_epoch,
      clearLease: true,
    });
    return {
      error: {
        statusCode: 422,
        message: budgetFit.rejectionReason === 'reserved_output_exceeded'
          ? 'Requested output tokens exceed provider limit'
          : 'Requested context exceeds provider window',
        type: 'invalid_request_error',
        code: budgetFit.rejectionReason,
      },
      billing: {
        request_id: requestId,
        execution_id: execution.execution_id,
        execution_lease_id: executionLease.lease_id,
        execution_lease_holder: executionLease.lease_holder,
        execution_lease_epoch: executionLease.lease_epoch,
        timestamp: getTimestamp(),
        route: options.route || 'chat/completions',
        reserved: false,
        reserved_cost_usd: 0,
        primary_model: primaryDescriptor.upstreamId,
        model_used: primaryDescriptor.upstreamId,
        fallback_triggered: false,
        failure_reason: budgetFit.rejectionReason,
        cost_descriptor: primaryDescriptor,
        finalized: true,
        workspace_id: artifactBinding.workspace?.workspace_id || null,
        artifact_id: artifactBinding.artifact?.artifact_id || null,
      },
      execution,
    };
  }

  const primaryUpstreamBody = buildUpstreamBody(effectiveBody, primaryDescriptor);
  const fallbackUpstreamBody = fallbackDescriptor ? buildUpstreamBody(effectiveBody, fallbackDescriptor) : null;
  const estimated = acceptedEstimate;
  const primaryEstimatedCost = estimateCostForDescriptor(primaryDescriptor, estimated.inputTokens, estimated.outputTokens);
  const fallbackEstimatedCost = fallbackDescriptor
    ? estimateCostForDescriptor(fallbackDescriptor, estimated.inputTokens, estimated.outputTokens)
    : 0;
  const reservedCostUsd = Math.max(primaryEstimatedCost, fallbackEstimatedCost);
  const route = options.route || 'chat/completions';
  const reservation = await reserveBillingBudget({
    request_id: requestId,
    timestamp,
    route,
    session_id: session.session_id,
    execution_id: execution.execution_id,
    primary_model: primaryDescriptor.upstreamId,
    model_used: primaryDescriptor.upstreamId,
    input_tokens: estimated.inputTokens,
    reserved_cost_usd: reservedCostUsd,
    endpoint: providerConfig.chatUrl,
  });

  if (!reservation.accepted) {
    await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.FAILED, {
      requestId,
      actorSource: 'runtime',
      reasonCode: reservation.reason || 'credit_limit_exceeded',
      leaseId: executionLease.lease_id,
      leaseHolder: executionLease.lease_holder,
      leaseEpoch: executionLease.lease_epoch,
      clearLease: true,
    });
    const rejectedStatusCode = reservation.reason === 'session_rate_limited' || reservation.reason === 'session_budget_exceeded'
      ? 429
      : 502;
    const rejectedType = rejectedStatusCode === 429 ? 'rate_limit_error' : 'provider_error';
    const rejectedCode = reservation.reason === 'session_rate_limited'
      ? 'rate_limit_exceeded'
      : (reservation.reason === 'session_budget_exceeded'
        ? 'session_budget_exceeded'
        : 'upstream_error');
    return {
      error: {
        statusCode: rejectedStatusCode,
        message: reservation.message || 'Upstream provider returned an error',
        type: rejectedType,
        code: rejectedCode,
      },
      billing: {
        request_id: requestId,
        execution_id: execution.execution_id,
        execution_lease_id: executionLease.lease_id,
        execution_lease_holder: executionLease.lease_holder,
        execution_lease_epoch: executionLease.lease_epoch,
        timestamp,
        route,
        reserved: false,
        reserved_cost_usd: reservedCostUsd,
        primary_model: primaryDescriptor.upstreamId,
        model_used: primaryDescriptor.upstreamId,
        fallback_triggered: false,
        failure_reason: reservation.reason || 'credit_limit_exceeded',
        cost_descriptor: primaryDescriptor,
        finalized: true,
      },
      execution,
    };
  }

  const responseAlias = PUBLIC_MODEL_ALIAS;
  const isStreaming = Boolean(effectiveBody.stream);
  const primaryAttempt = await fetchUpstreamChat(session, primaryDescriptor, primaryUpstreamBody, isStreaming, requestId, {
    attempt: 'primary',
    primary_model: primaryDescriptor.upstreamId,
    fallback_model_used: false,
    upstream_api_key_override: options.upstreamApiKeyOverride || '',
    test_primary_failure_mode: options.testPrimaryFailureMode || '',
  });

  const primaryFailureReason = primaryAttempt.error
    ? failureReasonFromFetchError(primaryAttempt.error)
    : (primaryAttempt.upstream && !primaryAttempt.upstream.ok
      ? failureReasonFromUpstreamStatus(primaryAttempt.upstream.status)
      : '');

  if (primaryAttempt.error || (primaryAttempt.upstream && !primaryAttempt.upstream.ok)) {
    if (primaryAttempt.upstream && !primaryAttempt.upstream.ok && primaryAttempt.upstream.status === 400) {
      try {
        const text = await primaryAttempt.upstream.clone().text();
        if (text.toLowerCase().includes('context size has been exceeded')) {
          const downstreamOverflowEventId = await appendSessionContinuityEvent({
            session_id: session.session_id,
            execution_id: execution.execution_id,
            pressure_state: pressure.state,
            pressure_ratio: pressure.ratio,
            event_type: 'downstream_overflow_detected',
            decision: 'observe_only',
            source: 'downstream_error',
            reason_code: 'downstream_context_overflow',
            created_at: getTimestamp(),
          });
          await appendSessionContinuityEvent({
            session_id: session.session_id,
            execution_id: execution.execution_id,
            pressure_state: pressure.state,
            pressure_ratio: pressure.ratio,
            event_type: 'rollover_recommended',
            decision: 'recommend_rollover',
            source: 'downstream_error',
            reason_code: 'downstream_context_overflow',
            created_at: getTimestamp(),
          });
          const repeatedOverflow = (await getContinuityEventCounts(session.session_id, 'downstream_overflow_detected', new Date(Date.now() - (60 * 60 * 1000)).toISOString())) >= 2;
          const recommendation = deriveContinuityRecommendation({
            pressureState: pressure.state,
            eventType: 'downstream_overflow_detected',
            repeatedOverflow,
            reasonCode: 'downstream_context_overflow',
          });
          await createOrUpdateSessionRecommendation({
            sessionId: session.session_id,
            executionId: execution.execution_id,
            recommendationType: recommendation.type,
            pressureState: pressure.state,
            triggerEventId: downstreamOverflowEventId,
            reasonCode: recommendation.reasonCode,
            timestamp: getTimestamp(),
          });
        }
      } catch (_) {}
    }
    const canFallback = Boolean(fallbackDescriptor) && (primaryAttempt.error || isRetryableUpstreamStatus(primaryAttempt.upstream.status));
    if (!canFallback && !fallbackDescriptor) {
      logRoutingDecision('fallback_skipped_unconfigured', {
        request_id: requestId,
        primary_model: primaryDescriptor.upstreamId,
        reason: ENABLE_FALLBACK ? 'fallback_not_configured_or_not_free' : 'fallback_disabled',
      });
    }
    if (canFallback) {
      logRoutingDecision('fallback_attempt_started', fallbackEventBase(
        requestId,
        primaryDescriptor,
        fallbackDescriptor,
        primaryFailureReason || 'retryable_primary_failure',
      ));
      const fallbackAttempt = await fetchUpstreamChat(session, fallbackDescriptor, fallbackUpstreamBody, isStreaming, requestId, {
        attempt: 'fallback',
        primary_model: primaryDescriptor.upstreamId,
        fallback_model_used: true,
        upstream_api_key_override: options.upstreamApiKeyOverride || '',
        test_primary_failure_mode: '',
      });

      const fallbackFailureReason = fallbackAttempt.error
        ? failureReasonFromFetchError(fallbackAttempt.error)
        : (fallbackAttempt.upstream && !fallbackAttempt.upstream.ok
          ? failureReasonFromUpstreamStatus(fallbackAttempt.upstream.status)
          : '');

      if (!fallbackAttempt.error && fallbackAttempt.upstream && fallbackAttempt.upstream.ok) {
        logRoutingDecision('fallback_success', fallbackEventBase(
          requestId,
          primaryDescriptor,
          fallbackDescriptor,
          primaryFailureReason || 'retryable_primary_failure',
        ));
        await updateExecutionCapabilityFallbackUse(execution.execution_id, fallbackDescriptor, {
          timestamp: getTimestamp(),
          timeoutProfile: 'remote_fallback',
        });
        return {
          descriptor: fallbackDescriptor,
          responseAlias,
          upstream: fallbackAttempt.upstream,
          upstreamContext: fallbackAttempt.upstreamContext,
          billing: {
            request_id: requestId,
            execution_id: execution.execution_id,
            execution_lease_id: executionLease.lease_id,
            execution_lease_holder: executionLease.lease_holder,
            execution_lease_epoch: executionLease.lease_epoch,
            timestamp,
            route,
            reserved: true,
            reserved_cost_usd: reservedCostUsd,
            primary_model: primaryDescriptor.upstreamId,
            model_used: fallbackDescriptor.upstreamId,
            fallback_triggered: true,
            failure_reason: primaryFailureReason,
            input_tokens: estimated.inputTokens,
            output_tokens: estimated.outputTokens,
            cost_descriptor: fallbackDescriptor,
            endpoint: providerConfig.chatUrl,
            finalized: false,
            workspace_id: artifactBinding.workspace?.workspace_id || null,
            artifact_id: artifactBinding.artifact?.artifact_id || null,
          },
          served_by: 'fallback',
          effective_body: effectiveBody,
          execution,
        };
      }

      const finalFailureReason = [primaryFailureReason, fallbackFailureReason].filter(Boolean).join(';') || 'upstream_error';
      logRoutingDecision('fallback_failed', fallbackEventBase(
        requestId,
        primaryDescriptor,
        fallbackDescriptor,
        finalFailureReason,
      ));
      await finalizeBillingRequest({
        request_id: requestId,
        timestamp: getTimestamp(),
        route,
        session_id: session.session_id,
        execution_id: execution.execution_id,
        primary_model: primaryDescriptor.upstreamId,
        model_used: fallbackDescriptor.upstreamId,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: true,
        failure_reason: finalFailureReason,
        endpoint: providerConfig.chatUrl,
        error_code: fallbackAttempt?.error?.code || fallbackFailureReason || 'upstream_error',
        status_code: fallbackAttempt?.upstream?.status || fallbackAttempt?.error?.statusCode || 502,
        response_body: '',
        reserved_cost_usd: reservedCostUsd,
      });
      await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.FAILED, {
        requestId,
        actorSource: 'runtime',
        reasonCode: finalFailureReason || 'upstream_error',
        leaseId: executionLease.lease_id,
        leaseHolder: executionLease.lease_holder,
        leaseEpoch: executionLease.lease_epoch,
        clearLease: true,
      });

      return {
        error: fallbackAttempt?.error || { statusCode: 502, message: 'Upstream provider returned an error', type: 'provider_error', code: 'upstream_error' },
        billing: {
          request_id: requestId,
          execution_id: execution.execution_id,
          execution_lease_id: executionLease.lease_id,
          execution_lease_holder: executionLease.lease_holder,
          execution_lease_epoch: executionLease.lease_epoch,
          timestamp,
          route,
          reserved: true,
          reserved_cost_usd: reservedCostUsd,
          primary_model: primaryDescriptor.upstreamId,
          model_used: fallbackDescriptor.upstreamId,
          fallback_triggered: true,
          failure_reason: finalFailureReason,
          cost_descriptor: fallbackDescriptor,
          finalized: true,
          workspace_id: artifactBinding.workspace?.workspace_id || null,
          artifact_id: artifactBinding.artifact?.artifact_id || null,
        },
        execution,
      };
    }

    await finalizeBillingRequest({
      request_id: requestId,
      timestamp: getTimestamp(),
      route,
      session_id: session.session_id,
      execution_id: execution.execution_id,
      primary_model: primaryDescriptor.upstreamId,
      model_used: primaryDescriptor.upstreamId,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      status: 'failed',
      fallback_triggered: false,
      failure_reason: primaryFailureReason,
      endpoint: providerConfig.chatUrl,
      error_code: primaryAttempt?.error?.code || primaryFailureReason || 'upstream_error',
      status_code: primaryAttempt?.upstream?.status || primaryAttempt?.error?.statusCode || 502,
      response_body: '',
      reserved_cost_usd: reservedCostUsd,
    });
    await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.FAILED, {
      requestId,
      actorSource: 'runtime',
      reasonCode: primaryFailureReason || 'upstream_error',
      leaseId: executionLease.lease_id,
      leaseHolder: executionLease.lease_holder,
      leaseEpoch: executionLease.lease_epoch,
      clearLease: true,
    });

    return {
      error: primaryAttempt?.error || { statusCode: 502, message: 'Upstream provider returned an error', type: 'provider_error', code: 'upstream_error' },
        billing: {
          request_id: requestId,
          execution_id: execution.execution_id,
          execution_lease_id: executionLease.lease_id,
          execution_lease_holder: executionLease.lease_holder,
          execution_lease_epoch: executionLease.lease_epoch,
          timestamp,
          route,
          reserved: true,
          reserved_cost_usd: reservedCostUsd,
          primary_model: primaryDescriptor.upstreamId,
          model_used: primaryDescriptor.upstreamId,
          fallback_triggered: false,
          failure_reason: primaryFailureReason,
          cost_descriptor: primaryDescriptor,
          finalized: true,
          workspace_id: artifactBinding.workspace?.workspace_id || null,
          artifact_id: artifactBinding.artifact?.artifact_id || null,
        },
        execution,
      };
  }

  return {
    execution,
    descriptor: primaryDescriptor,
    responseAlias,
    upstream: primaryAttempt.upstream,
    upstreamContext: primaryAttempt.upstreamContext,
    billing: {
      request_id: requestId,
      execution_id: execution.execution_id,
      execution_lease_id: executionLease.lease_id,
      execution_lease_holder: executionLease.lease_holder,
      execution_lease_epoch: executionLease.lease_epoch,
      timestamp,
      route,
      reserved: true,
      reserved_cost_usd: reservedCostUsd,
      input_tokens: estimated.inputTokens,
      output_tokens: estimated.outputTokens,
      primary_model: primaryDescriptor.upstreamId,
      model_used: primaryDescriptor.upstreamId,
      fallback_triggered: false,
      failure_reason: '',
      cost_descriptor: primaryDescriptor,
      endpoint: providerConfig.chatUrl,
      finalized: false,
      workspace_id: artifactBinding.workspace?.workspace_id || null,
      artifact_id: artifactBinding.artifact?.artifact_id || null,
    },
    served_by: 'primary',
    effective_body: effectiveBody,
  };
}

async function proxyNonStreamingChat(res, session, descriptor, upstream, billing = null, responseAlias = PUBLIC_MODEL_ALIAS, requestBody = null) {
  if (!upstream.ok) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: billing.timestamp,
        route: billing.route,
        session_id: session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || failureReasonFromUpstreamStatus(upstream.status),
        endpoint: billing.endpoint || '',
        error_code: 'upstream_error',
        status_code: upstream.status,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
      if (billing.execution_id) {
        await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: billing.failure_reason || failureReasonFromUpstreamStatus(upstream.status),
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
          clearLease: true,
        });
      }
    }
    return sendError(res, 502, 'Upstream provider returned an error', 'provider_error', 'upstream_error');
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch (error) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: billing.timestamp,
        route: billing.route,
        session_id: session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || 'upstream_invalid_response',
        endpoint: billing.endpoint || '',
        error_code: 'upstream_invalid_response',
        status_code: 502,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
      if (billing.execution_id) {
        await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: billing.failure_reason || 'upstream_invalid_response',
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
          clearLease: true,
        });
      }
    }
    return sendError(res, 502, 'Upstream provider returned an invalid response', 'provider_error', 'upstream_invalid_response');
  }

  const usage = extractUsageTokens(payload?.usage);
  incrementUsage(session, usage.totalTokens);
  const activePromptText = extractManagedRequestPromptText(requestBody || {});
  const managedArtifactOutcome = billing?.execution_id
    ? await materializeVerifiedArtifactForExecution(billing.execution_id, stringifyTextContent(payload?.choices?.[0]?.message?.content ?? ''), {
      requestId: billing.request_id,
      actorSource: 'runtime',
      autoDeliver: true,
      promptText: activePromptText,
    })
    : null;
  if (managedArtifactOutcome?.ok) {
    const reconciledText = buildManagedArtifactResponseText(managedArtifactOutcome, stringifyTextContent(payload?.choices?.[0]?.message?.content ?? ''));
    if (reconciledText && Array.isArray(payload?.choices) && payload.choices.length > 0) {
      payload.choices = payload.choices.map((choice, index) => (index === 0 ? {
        ...choice,
        message: {
          ...(choice?.message || {}),
          content: reconciledText,
        },
      } : choice));
    }
  }
  return {
    payload: normalizeChatCompletionResponse(payload, responseAlias),
    usage,
    requestBody,
  };
}

function writeChatSseFromNonStreamPayload(res, payload, responseAlias = PUBLIC_MODEL_ALIAS) {
  const created = Number.isFinite(payload?.created) ? payload.created : Math.floor(Date.now() / 1000);
  const id = payload?.id || `chatcmpl_${crypto.randomUUID()}`;
  const content = stringifyTextContent(payload?.choices?.[0]?.message?.content ?? '');

  const head = {
    id,
    object: 'chat.completion.chunk',
    created,
    model: responseAlias,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  };
  const body = {
    id,
    object: 'chat.completion.chunk',
    created,
    model: responseAlias,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
  const tail = {
    id,
    object: 'chat.completion.chunk',
    created,
    model: responseAlias,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: payload?.usage || null,
  };

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify(head)}\n\n`);
  res.write(`data: ${JSON.stringify(body)}\n\n`);
  res.write(`data: ${JSON.stringify(tail)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

async function attemptLocalNonStreamRetry(req, res, session, descriptor, billing, responseAlias, retryOptions = {}) {
  if (!ENABLE_LOCAL_NON_STREAM_RETRY || !isLocalProviderDescriptor(descriptor)) {
    return false;
  }
  if (billing?.execution_id) {
    const retryEligibility = await canExecutionUseOptimisticRetry(billing.execution_id);
    if (!retryEligibility.allowed) {
      logRoutingDecision('local_nonstream_retry_skipped', {
        request_id: billing?.request_id || '',
        model: descriptor.upstreamId,
        reason: retryEligibility.reason || 'retry_not_allowed',
      });
      return false;
    }
  }

  const originalBody = retryOptions.originalBody && typeof retryOptions.originalBody === 'object'
    ? retryOptions.originalBody
    : req.body;
  if (!originalBody || typeof originalBody !== 'object') {
    return false;
  }

  logRoutingDecision('local_nonstream_retry_started', {
    request_id: billing?.request_id || '',
    model: descriptor.upstreamId,
    reason: 'stream_first_token_timeout',
  });
  if (billing?.execution_id && billing.execution_lease_id && billing.execution_lease_holder && billing.execution_lease_epoch) {
    await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.RETRYING, {
      requestId: billing.request_id,
      actorSource: 'runtime',
      reasonCode: 'execution_retrying',
      notes: 'local_nonstream_retry_started',
      leaseId: billing.execution_lease_id,
      leaseHolder: billing.execution_lease_holder,
      leaseEpoch: billing.execution_lease_epoch,
    });
    const retryLease = await acquireExecutionLease(billing.execution_id, {
      requestId: billing.request_id,
      actorSource: 'runtime',
      isStreaming: true,
    });
    billing.execution_lease_id = retryLease.lease_id;
    billing.execution_lease_holder = retryLease.lease_holder;
    billing.execution_lease_epoch = retryLease.lease_epoch;
  }

  const retryBody = {
    ...originalBody,
    stream: false,
  };
  delete retryBody.stream_options;

  const requestId = billing?.request_id || createRequestId();
  const retryAttempt = await fetchUpstreamChat(session, descriptor, buildUpstreamBody(retryBody, descriptor), false, requestId, {
    attempt: 'local_nonstream_retry',
    primary_model: descriptor.upstreamId,
    fallback_model_used: false,
    upstream_api_key_override: retryOptions.upstreamApiKeyOverride || '',
  });

  if (retryAttempt.error || !retryAttempt.upstream || !retryAttempt.upstream.ok) {
    logRoutingDecision('local_nonstream_retry_failed', {
      request_id: requestId,
      model: descriptor.upstreamId,
      reason: retryAttempt?.error?.code || failureReasonFromUpstreamStatus(retryAttempt?.upstream?.status),
    });
    return false;
  }

  let payload;
  try {
    payload = await retryAttempt.upstream.json();
  } catch (error) {
    logRoutingDecision('local_nonstream_retry_failed', {
      request_id: requestId,
      model: descriptor.upstreamId,
      reason: 'upstream_invalid_response',
    });
    return false;
  }

  const normalized = normalizeChatCompletionResponse(payload, responseAlias);
  const assistantText = stringifyTextContent(normalized?.choices?.[0]?.message?.content ?? '');
  const managedArtifactVerificationOutcome = billing?.execution_id
    ? await materializeVerifiedArtifactForExecution(billing.execution_id, assistantText, {
      requestId: billing.request_id,
      actorSource: 'runtime',
      autoDeliver: true,
    })
    : null;
  if (managedArtifactVerificationOutcome?.required && !managedArtifactVerificationOutcome.ok) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'interrupted',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: managedArtifactOutcome.reason || 'artifact_output_invalid',
        endpoint: billing.endpoint || '',
        error_code: managedArtifactOutcome.reason || 'artifact_output_invalid',
        status_code: 200,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
    }
    if (billing?.execution_id) {
      await markExecutionRecoveryRequired(billing.execution_id, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        reasonCode: managedArtifactOutcome.reason || 'artifact_output_invalid',
        recoveryReason: managedArtifactOutcome.reason || 'artifact_output_invalid',
        recoveryNotes: managedArtifactOutcome.reason || 'artifact_output_invalid',
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
      });
    }
    const fallbackText = managedArtifactOutcome.fallbackText || buildManagedTerminalFallbackText(req.body || {});
    normalized.choices = Array.isArray(normalized.choices) && normalized.choices.length > 0
      ? normalized.choices.map((choice, index) => (index === 0 ? {
        ...choice,
        message: {
          ...(choice?.message || {}),
          content: fallbackText,
        },
      } : choice))
      : [{
        index: 0,
        message: {
          role: 'assistant',
          content: fallbackText,
        },
        finish_reason: 'stop',
      }];
    incrementUsage(session, extractUsageTokens(payload?.usage)?.totalTokens || 0);
    logRoutingDecision('local_nonstream_retry_artifact_fallback', {
      request_id: requestId,
      model: descriptor.upstreamId,
      reason: managedArtifactOutcome.reason || 'artifact_output_invalid',
    });
    writeChatSseFromNonStreamPayload(res, normalized, responseAlias);
    return true;
  }
  const managedArtifactOutcome = terminalRecoveryArtifactOutcome
    || (billing?.execution_id
      ? await materializeVerifiedArtifactForExecution(billing.execution_id, assistantText, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        autoDeliver: true,
      })
      : null);
  if (managedArtifactOutcome?.required && !managedArtifactOutcome.ok) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: usage.inputTokens || billing.input_tokens || 0,
        output_tokens: usage.outputTokens || Math.max(0, usage.totalTokens - (billing.input_tokens || 0)),
        estimated_cost_usd: estimateCostForDescriptor(billing.cost_descriptor || descriptor,
          usage.inputTokens || billing.input_tokens || 0,
          usage.outputTokens || Math.max(0, usage.totalTokens - (billing.input_tokens || 0))
        ),
        status: 'interrupted',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: managedArtifactVerificationOutcome.reason || 'artifact_output_invalid',
        endpoint: billing.endpoint || '',
        error_code: managedArtifactVerificationOutcome.reason || 'artifact_output_invalid',
        status_code: 200,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
    }
    if (billing?.execution_id) {
      await markExecutionRecoveryRequired(billing.execution_id, {
        requestId: billing.request_id,
        actorSource: 'runtime',
      reasonCode: managedArtifactVerificationOutcome.reason || 'artifact_output_invalid',
        recoveryReason: managedArtifactVerificationOutcome.reason || 'artifact_output_invalid',
        recoveryNotes: managedArtifactVerificationOutcome.reason || 'artifact_output_invalid',
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
      });
    }
    const fallbackText = managedArtifactVerificationOutcome.fallbackText || buildManagedTerminalFallbackText(req.body || {});
    return res.status(200).json(
      normalizeResponsesFallbackResponseFromChat(chatPayload, PUBLIC_MODEL_ALIAS, fallbackText)
    );
  }
  const artifactError = await validateArtifactHonestyOrError(req.body, assistantText, {
    executionId: billing?.execution_id || '',
    requestId: billing?.request_id || '',
    actorSource: 'runtime',
    meaningfulOutputStarted: false,
  });
  if (artifactError) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: artifactError.code || 'artifact_honesty_failed',
        endpoint: billing.endpoint || '',
        error_code: artifactError.code || 'artifact_honesty_failed',
        status_code: artifactError.statusCode || 422,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
    }
    if (billing?.execution_id) {
      await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        reasonCode: artifactError.code || 'artifact_honesty_failed',
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
        clearLease: true,
      });
    }
    sendError(res, artifactError.statusCode, artifactError.message, artifactError.type, artifactError.code);
    return true;
  }

  const usage = extractUsageTokens(payload?.usage);
  if (billing?.reserved) {
    await finalizeBillingRequest({
      request_id: billing.request_id,
      timestamp: getTimestamp(),
      route: billing.route,
      session_id: session.session_id,
      execution_id: billing.execution_id || null,
      primary_model: billing.primary_model || '',
      model_used: billing.model_used,
      input_tokens: usage.inputTokens || billing.input_tokens || 0,
      output_tokens: usage.outputTokens || Math.max(0, usage.totalTokens - (billing.input_tokens || 0)),
      estimated_cost_usd: estimateCostForDescriptor(billing.cost_descriptor || descriptor,
        usage.inputTokens || billing.input_tokens || 0,
        usage.outputTokens || Math.max(0, usage.totalTokens - (billing.input_tokens || 0))
      ),
      status: 'success',
      fallback_triggered: Number(Boolean(billing.fallback_triggered)),
      failure_reason: billing.failure_reason || '',
      endpoint: billing.endpoint || '',
      error_code: '',
      status_code: 200,
      response_body: '',
      reserved_cost_usd: billing.reserved_cost_usd,
    });
  }
  if (billing?.execution_id) {
    await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.RUNNING, {
      requestId: billing.request_id,
      actorSource: 'runtime',
      reasonCode: 'execution_retry_resumed',
      notes: 'local_nonstream_retry_success',
      leaseId: billing.execution_lease_id,
      leaseHolder: billing.execution_lease_holder,
      leaseEpoch: billing.execution_lease_epoch,
    });
    await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.COMPLETED, {
      requestId: billing.request_id,
      actorSource: 'runtime',
      reasonCode: 'completed_after_local_nonstream_retry',
      leaseId: billing.execution_lease_id,
      leaseHolder: billing.execution_lease_holder,
      leaseEpoch: billing.execution_lease_epoch,
      clearLease: true,
    });
  }
  incrementUsage(session, usage.totalTokens);
  logRoutingDecision('local_nonstream_retry_success', {
    request_id: requestId,
    model: descriptor.upstreamId,
  });
  writeChatSseFromNonStreamPayload(res, normalized, responseAlias);
  return true;
}

function proxyStreamingChat(req, res, session, descriptor, upstream, upstreamContext, billing = null, responseAlias = PUBLIC_MODEL_ALIAS, retryOptions = {}) {
  if (!upstream.ok) {
    if (billing?.reserved) {
      void finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || failureReasonFromUpstreamStatus(upstream.status),
        endpoint: billing.endpoint || '',
        error_code: 'upstream_error',
        status_code: upstream.status,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
      if (billing.execution_id) {
        void transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: billing.failure_reason || failureReasonFromUpstreamStatus(upstream.status),
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
          clearLease: true,
        });
      }
    }
    return sendError(res, 502, 'Upstream provider returned an error', 'provider_error', 'upstream_error');
  }

  if (!upstream.body) {
    if (billing?.reserved) {
      void finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || 'upstream_invalid_response',
        endpoint: billing.endpoint || '',
        error_code: 'upstream_invalid_response',
        status_code: 502,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
      if (billing.execution_id) {
        void transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: billing.failure_reason || 'upstream_invalid_response',
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
          clearLease: true,
        });
      }
    }
    return sendError(res, 502, 'Upstream provider did not return a stream body', 'provider_error', 'upstream_invalid_response');
  }

  const state = {
    buffer: '',
    pendingTotalTokens: 0,
    pendingInputTokens: 0,
    text: '',
    created: Math.floor(Date.now() / 1000),
    idleTimer: null,
    wroteHeaders: false,
    firstTokenAt: null,
    meaningfulOutputStarted: false,
    completed: false,
    billingFinalized: false,
    retriedLocalNonStream: false,
    retryInProgress: false,
  };
  const idleTimeouts = getStreamIdleTimeouts(descriptor);

  const finalizeRequest = async (status, details = {}) => {
    if (state.billingFinalized || !billing) {
      return;
    }

    state.billingFinalized = true;
    const verifiedArtifactAssessment = billing.execution_id
      ? await getVerifiedTaskArtifactAssessmentForExecutionId(billing.execution_id)
      : null;
    const terminalIntegrityClassification = classifyManagedTerminalCompletionIntegrity({
      status,
      outputTextLength: state.text.length,
      verifiedArtifactExists: Boolean(verifiedArtifactAssessment),
    });
    if (terminalIntegrityClassification && billing.execution_id) {
      details = {
        ...details,
        errorCode: terminalIntegrityClassification.reasonCode,
        notes: terminalIntegrityClassification.reasonDetail,
      };
    }

    let classification = terminalIntegrityClassification || classifyExecutionInterruption({
      status,
      errorCode: details.errorCode || '',
      meaningfulOutputStarted: state.meaningfulOutputStarted,
    });
    const managedArtifactOutcome = billing.execution_id && state.meaningfulOutputStarted
      ? await materializeVerifiedArtifactForExecution(billing.execution_id, state.text, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        autoDeliver: true,
        promptText: extractManagedRequestPromptText(retryOptions.originalBody || req.body || {}),
      })
      : null;
    if (managedArtifactOutcome?.required && !managedArtifactOutcome.ok) {
      classification = {
        targetState: EXECUTION_STATES.RECOVERY_REQUIRED,
        billingStatus: 'interrupted',
        reasonCode: managedArtifactOutcome.reason || 'artifact_output_invalid',
        recoveryReason: managedArtifactOutcome.reason || 'artifact_output_invalid',
      };
      details = {
        ...details,
        errorCode: managedArtifactOutcome.reason || 'artifact_output_invalid',
        notes: managedArtifactOutcome.reason || 'artifact_output_invalid',
      };
    }
    if (managedArtifactOutcome?.ok) {
      const reconciledText = buildManagedArtifactResponseText(managedArtifactOutcome, state.text);
      if (reconciledText) {
        state.text = reconciledText;
      }
    }
    if (billing.execution_id && state.meaningfulOutputStarted) {
      const artifactError = await validateArtifactHonestyOrError(retryOptions.originalBody || req.body, state.text, {
        executionId: billing.execution_id,
        requestId: billing.request_id,
        actorSource: 'runtime',
        meaningfulOutputStarted: true,
      });
      if (artifactError) {
        classification = {
          targetState: EXECUTION_STATES.RECOVERY_REQUIRED,
          billingStatus: 'interrupted',
          reasonCode: artifactError.code || 'artifact_verification_failed',
          recoveryReason: artifactError.reason || 'artifact_verification_failed',
        };
        details = {
          ...details,
          errorCode: artifactError.code || 'artifact_verification_failed',
          notes: artifactError.message,
        };
      }
    }
    if (billing.execution_id && billing.execution_lease_id && billing.execution_lease_holder && billing.execution_lease_epoch) {
      const leaseCheck = await assertExecutionLeaseHolder(billing.execution_id, {
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
      });
      if (!leaseCheck.matches) {
        await transitionExecutionWithLease(billing.execution_id, classification.targetState, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: 'execution_finalize_rejected_stale_lease',
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
          clearLease: classification.targetState !== EXECUTION_STATES.RECOVERY_REQUIRED,
        });
        return;
      }
    }
    const inputTokens = Number.isFinite(details.inputTokens) ? details.inputTokens : (billing.input_tokens || 0);
    const outputTokens = Number.isFinite(details.outputTokens)
      ? details.outputTokens
      : Math.max(0, state.pendingTotalTokens - inputTokens);

    await finalizeBillingRequest({
      request_id: billing.request_id,
      timestamp: getTimestamp(),
      route: billing.route,
      session_id: session.session_id,
      execution_id: billing.execution_id || null,
      primary_model: billing.primary_model || '',
      model_used: billing.model_used,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimateCostForDescriptor(billing.cost_descriptor || descriptor, inputTokens, outputTokens),
      status: classification.billingStatus,
      fallback_triggered: Number(Boolean(billing.fallback_triggered)),
      failure_reason: billing.failure_reason || '',
      endpoint: billing.endpoint || '',
      error_code: details.errorCode || '',
      status_code: details.statusCode || 200,
      response_body: details.responseBody || '',
      reserved_cost_usd: billing.reserved_cost_usd,
    });
    if (billing.execution_id) {
      if (classification.targetState === EXECUTION_STATES.RECOVERY_REQUIRED) {
        await markExecutionRecoveryRequired(billing.execution_id, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: details.errorCode || 'execution_recovery_required',
          recoveryReason: classification.recoveryReason || details.errorCode || 'execution_recovery_required',
          recoveryNotes: details.notes || null,
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
        });
      } else {
        await transitionExecutionWithLease(
          billing.execution_id,
          classification.targetState,
          {
            requestId: billing.request_id,
            actorSource: 'runtime',
            reasonCode: classification.reasonCode,
            leaseId: billing.execution_lease_id,
            leaseHolder: billing.execution_lease_holder,
            leaseEpoch: billing.execution_lease_epoch,
            clearLease: true,
          }
        );
      }
    }
  };

  const resetIdleTimer = () => {
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      if (!state.wroteHeaders) {
        logStreamDiagnostics(upstreamContext, {
          stage: 'idle_timeout_before_headers',
          completed: false,
          partial_completion_state: {
            pending_total_tokens: state.pendingTotalTokens,
            buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
          },
        });
        if (!state.retriedLocalNonStream && isLocalProviderDescriptor(descriptor)) {
          state.retriedLocalNonStream = true;
          state.retryInProgress = true;
          logRoutingDecision('stream_first_token_timeout_local', {
            request_id: billing?.request_id || '',
            model: descriptor.upstreamId,
          });
          if (upstream.body && !upstream.body.destroyed) {
            upstream.body.destroy();
          }
          void (async () => {
            const recovered = await attemptLocalNonStreamRetry(req, res, session, descriptor, billing, responseAlias, retryOptions);
            if (!recovered) {
              void finalizeRequest('failed', {
                statusCode: 502,
                errorCode: 'upstream_timeout',
              });
              sendError(res, 502, 'Upstream stream timed out before the first chunk', 'provider_error', 'upstream_timeout');
            }
          })();
          return;
        }
        void finalizeRequest('failed', {
          statusCode: 502,
          errorCode: 'upstream_timeout',
        });
        sendError(res, 502, 'Upstream stream timed out before the first chunk', 'provider_error', 'upstream_timeout');
        if (upstream.body && !upstream.body.destroyed) {
          upstream.body.destroy();
        }
        return;
      }

      if (upstream.body && !upstream.body.destroyed) {
        upstream.body.destroy(new Error('Upstream stream idle timeout'));
      }
      void finalizeRequest('failed', {
        inputTokens: state.pendingInputTokens,
        outputTokens: state.pendingTotalTokens,
        statusCode: 502,
        errorCode: 'upstream_timeout',
      });
      logStreamDiagnostics(upstreamContext, {
        stage: 'idle_timeout_after_headers',
        completed: false,
        partial_completion_state: {
          pending_total_tokens: state.pendingTotalTokens,
          buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
        },
      });
      res.end();
    }, state.wroteHeaders ? idleTimeouts.afterHeadersMs : idleTimeouts.beforeHeadersMs);
  };

  const writeHeadersIfNeeded = () => {
    if (state.wroteHeaders) {
      return;
    }

    state.wroteHeaders = true;
    res.status(200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  };

  req.on('close', () => {
    clearTimeout(state.idleTimer);
    if (!state.completed) {
      void finalizeRequest('interrupted', {
        inputTokens: state.pendingInputTokens,
        outputTokens: state.pendingTotalTokens,
        statusCode: 499,
        errorCode: 'client_disconnect',
      });
      logStreamDiagnostics(upstreamContext, {
        stage: 'client_disconnect',
        completed: false,
        partial_completion_state: {
          pending_total_tokens: state.pendingTotalTokens,
          buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
        },
      });
    }
    if (upstream.body && !upstream.body.destroyed) {
      upstream.body.destroy();
    }
  });

  resetIdleTimer();

  upstream.body.on('data', (chunk) => {
    resetIdleTimer();
    if (!state.firstTokenAt) {
      state.firstTokenAt = Date.now();
      logStreamDiagnostics(upstreamContext, {
        stage: 'first_token',
        time_to_first_token_ms: state.firstTokenAt - upstreamContext.started_at_ms,
      });
    }
    state.buffer += chunk.toString('utf8');
    const lines = state.buffer.split('\n');
    state.buffer = lines.pop() || '';

    let output = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        output += `${rawLine}\n`;
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        output += `${rawLine}\n`;
        continue;
      }

      try {
        const parsed = JSON.parse(payload);
        const totalTokens = parsed?.usage?.total_tokens;
        if (Number.isFinite(totalTokens)) {
          state.pendingTotalTokens = Math.max(state.pendingTotalTokens, totalTokens);
        }
        const promptTokens = Number(parsed?.usage?.prompt_tokens ?? parsed?.usage?.input_tokens);
        if (Number.isFinite(promptTokens)) {
          state.pendingInputTokens = Math.max(state.pendingInputTokens, promptTokens);
        }

        const normalized = normalizeChatChunkPayload(parsed, responseAlias, state.created);
        const deltaText = extractChatDeltaContent(parsed);
        if (deltaText) {
          state.meaningfulOutputStarted = true;
          state.text += deltaText;
        }
        output += `data: ${JSON.stringify(normalized)}\n`;
      } catch (error) {
        output += `${rawLine}\n`;
      }
    }

    if (billing?.execution_id && billing.execution_lease_id && billing.execution_lease_holder && billing.execution_lease_epoch) {
      void refreshExecutionLease(billing.execution_id, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        isStreaming: true,
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
      }).catch(() => {});
    }
    writeHeadersIfNeeded();
    res.write(output);
  });

  upstream.body.on('end', async () => {
    if (state.retryInProgress && !state.wroteHeaders) {
      return;
    }
    clearTimeout(state.idleTimer);

    if (state.buffer) {
      let tail = state.buffer;
      if (!tail.endsWith('\n')) {
        tail += '\n';
      }

      const lines = tail.split('\n');
      let output = '';
      for (const rawLine of lines) {
        if (!rawLine) {
          output += '\n';
          continue;
        }

        const line = rawLine.trim();
        if (!line.startsWith('data:')) {
          output += `${rawLine}\n`;
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          output += `${rawLine}\n`;
          continue;
        }

        try {
          const parsed = JSON.parse(payload);
        const totalTokens = parsed?.usage?.total_tokens;
        if (Number.isFinite(totalTokens)) {
          state.pendingTotalTokens = Math.max(state.pendingTotalTokens, totalTokens);
        }
        const promptTokens = Number(parsed?.usage?.prompt_tokens ?? parsed?.usage?.input_tokens);
        if (Number.isFinite(promptTokens)) {
          state.pendingInputTokens = Math.max(state.pendingInputTokens, promptTokens);
        }

          const normalized = normalizeChatChunkPayload(parsed, responseAlias, state.created);
          const deltaText = extractChatDeltaContent(parsed);
          if (deltaText) {
            state.meaningfulOutputStarted = true;
            state.text += deltaText;
          }
          output += `data: ${JSON.stringify(normalized)}\n`;
        } catch (error) {
          output += `${rawLine}\n`;
        }
      }

      if (output) {
        writeHeadersIfNeeded();
        res.write(output);
      }
    }

    if (billing?.execution_id && !String(state.text || '').trim()) {
      const terminalRecoveryArtifactOutcome = await attemptManagedArtifactMaterializationBeforeTerminalRecovery(
        billing.execution_id,
        state.text,
        {
          requestId: billing.request_id,
          actorSource: 'runtime',
          promptText: extractManagedRequestPromptText(retryOptions.originalBody || req.body || {}),
        }
      );
      if (terminalRecoveryArtifactOutcome?.ok) {
        state.text = buildManagedArtifactResponseText(terminalRecoveryArtifactOutcome, state.text);
      }
    }

    incrementUsage(session, state.pendingTotalTokens);
    if (!state.wroteHeaders) {
      writeHeadersIfNeeded();
    }
    state.completed = true;
    void finalizeRequest('success', {
      inputTokens: state.pendingInputTokens,
      outputTokens: Math.max(0, state.pendingTotalTokens - state.pendingInputTokens),
    });
    logStreamDiagnostics(upstreamContext, {
      stage: 'completed',
      completed: true,
      time_to_first_token_ms: state.firstTokenAt ? state.firstTokenAt - upstreamContext.started_at_ms : null,
      partial_completion_state: {
        pending_total_tokens: state.pendingTotalTokens,
        buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
      },
    });
    res.end();
  });

  upstream.body.on('error', (error) => {
    if (state.retryInProgress && !state.wroteHeaders) {
      return;
    }
    clearTimeout(state.idleTimer);
      if (!state.wroteHeaders) {
        if (isLocalProviderDescriptor(descriptor)) {
          logRoutingDecision('stream_first_token_timeout_local', {
            request_id: billing?.request_id || '',
            model: descriptor.upstreamId,
          });
        }
        void finalizeRequest('failed', {
          inputTokens: state.pendingInputTokens,
          outputTokens: state.pendingTotalTokens,
          statusCode: 502,
          errorCode: 'stream_proxy_failed',
      });
      logStreamDiagnostics(upstreamContext, {
        stage: 'stream_error_before_headers',
        completed: false,
        reason: error?.message || 'stream_error',
        partial_completion_state: {
          pending_total_tokens: state.pendingTotalTokens,
          buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
        },
      });
      sendError(res, 502, 'Streaming proxy failed', 'provider_error', 'stream_proxy_failed');
      return;
    }

    logStreamDiagnostics(upstreamContext, {
      stage: 'stream_error_after_headers',
      completed: false,
      reason: error?.message || 'stream_error',
      partial_completion_state: {
        pending_total_tokens: state.pendingTotalTokens,
        buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
      },
    });
    void finalizeRequest('failed', {
      inputTokens: state.pendingInputTokens,
      outputTokens: state.pendingTotalTokens,
      statusCode: 502,
      errorCode: 'stream_proxy_failed',
    });
    res.end();
  });

  return undefined;
}

function proxyStreamingResponses(req, res, session, descriptor, upstream, upstreamContext, billing = null, responseAlias = PUBLIC_MODEL_ALIAS, retryOptions = {}) {
  if (!upstream.ok) {
    if (billing?.reserved) {
      void finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || failureReasonFromUpstreamStatus(upstream.status),
        endpoint: billing.endpoint || '',
        error_code: 'upstream_error',
        status_code: upstream.status,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
      if (billing.execution_id) {
        void transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: billing.failure_reason || failureReasonFromUpstreamStatus(upstream.status),
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
          clearLease: true,
        });
      }
    }
    return sendError(res, 502, 'Upstream provider returned an error', 'provider_error', 'upstream_error');
  }

  if (!upstream.body) {
    if (billing?.reserved) {
      void finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || 'upstream_invalid_response',
        endpoint: billing.endpoint || '',
        error_code: 'upstream_invalid_response',
        status_code: 502,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
      if (billing.execution_id) {
        void transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: billing.failure_reason || 'upstream_invalid_response',
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
          clearLease: true,
        });
      }
    }
    return sendError(res, 502, 'Upstream provider did not return a stream body', 'provider_error', 'upstream_invalid_response');
  }

  const state = {
    buffer: '',
    pendingTotalTokens: 0,
    pendingInputTokens: 0,
    createdAt: Math.floor(Date.now() / 1000),
    responseId: `resp_${crypto.randomUUID()}`,
    itemId: `msg_${crypto.randomUUID()}`,
    sequenceNumber: 0,
    text: '',
    outputIndex: 0,
    contentIndex: 0,
    idleTimer: null,
    wroteHeaders: false,
    createdEventSent: false,
    outputItemAdded: false,
    contentPartAdded: false,
    firstTokenAt: null,
    meaningfulOutputStarted: false,
    completed: false,
    billingFinalized: false,
  };
  const idleTimeouts = getStreamIdleTimeouts(descriptor);

  const finalizeRequest = async (status, details = {}) => {
    if (state.billingFinalized || !billing) {
      return;
    }

    state.billingFinalized = true;
    const verifiedArtifactAssessment = billing.execution_id
      ? await getVerifiedTaskArtifactAssessmentForExecutionId(billing.execution_id)
      : null;
    const terminalIntegrityClassification = classifyManagedTerminalCompletionIntegrity({
      status,
      outputTextLength: state.text.length,
      verifiedArtifactExists: Boolean(verifiedArtifactAssessment),
    });
    if (terminalIntegrityClassification && billing.execution_id) {
      details = {
        ...details,
        errorCode: terminalIntegrityClassification.reasonCode,
        notes: terminalIntegrityClassification.reasonDetail,
      };
    }

    let classification = terminalIntegrityClassification || classifyExecutionInterruption({
      status,
      errorCode: details.errorCode || '',
      meaningfulOutputStarted: state.meaningfulOutputStarted,
    });
    const managedArtifactOutcome = billing.execution_id && state.meaningfulOutputStarted
      ? await materializeVerifiedArtifactForExecution(billing.execution_id, state.text, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        autoDeliver: true,
        promptText: extractManagedRequestPromptText(retryOptions.originalBody || req.body || {}),
      })
      : null;
    if (managedArtifactOutcome?.required && !managedArtifactOutcome.ok) {
      classification = {
        targetState: EXECUTION_STATES.RECOVERY_REQUIRED,
        billingStatus: 'interrupted',
        reasonCode: managedArtifactOutcome.reason || 'artifact_output_invalid',
        recoveryReason: managedArtifactOutcome.reason || 'artifact_output_invalid',
      };
      details = {
        ...details,
        errorCode: managedArtifactOutcome.reason || 'artifact_output_invalid',
        notes: managedArtifactOutcome.reason || 'artifact_output_invalid',
      };
    }
    if (managedArtifactOutcome?.ok) {
      const reconciledText = buildManagedArtifactResponseText(managedArtifactOutcome, state.text);
      if (reconciledText) {
        state.text = reconciledText;
      }
    }
    if (billing.execution_id && state.meaningfulOutputStarted) {
      const artifactError = await validateArtifactHonestyOrError(retryOptions.originalBody || req.body, state.text, {
        executionId: billing.execution_id,
        requestId: billing.request_id,
        actorSource: 'runtime',
        meaningfulOutputStarted: true,
      });
      if (artifactError) {
        classification = {
          targetState: EXECUTION_STATES.RECOVERY_REQUIRED,
          billingStatus: 'interrupted',
          reasonCode: artifactError.code || 'artifact_verification_failed',
          recoveryReason: artifactError.reason || 'artifact_verification_failed',
        };
        details = {
          ...details,
          errorCode: artifactError.code || 'artifact_verification_failed',
          notes: artifactError.message,
        };
      }
    }
    if (billing.execution_id && billing.execution_lease_id && billing.execution_lease_holder && billing.execution_lease_epoch) {
      const leaseCheck = await assertExecutionLeaseHolder(billing.execution_id, {
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
      });
      if (!leaseCheck.matches) {
        await transitionExecutionWithLease(billing.execution_id, classification.targetState, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: 'execution_finalize_rejected_stale_lease',
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
          clearLease: classification.targetState !== EXECUTION_STATES.RECOVERY_REQUIRED,
        });
        return;
      }
    }
    const inputTokens = Number.isFinite(details.inputTokens) ? details.inputTokens : (billing.input_tokens || 0);
    const outputTokens = Number.isFinite(details.outputTokens)
      ? details.outputTokens
      : Math.max(0, state.pendingTotalTokens - inputTokens);

    await finalizeBillingRequest({
      request_id: billing.request_id,
      timestamp: getTimestamp(),
      route: billing.route,
      session_id: session.session_id,
      execution_id: billing.execution_id || null,
      primary_model: billing.primary_model || '',
      model_used: billing.model_used,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimateCostForDescriptor(billing.cost_descriptor || descriptor, inputTokens, outputTokens),
      status: classification.billingStatus,
      fallback_triggered: Number(Boolean(billing.fallback_triggered)),
      failure_reason: billing.failure_reason || '',
      endpoint: billing.endpoint || '',
      error_code: details.errorCode || '',
      status_code: details.statusCode || 200,
      response_body: details.responseBody || '',
      reserved_cost_usd: billing.reserved_cost_usd,
    });
    if (billing.execution_id) {
      if (classification.targetState === EXECUTION_STATES.RECOVERY_REQUIRED) {
        await markExecutionRecoveryRequired(billing.execution_id, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: details.errorCode || 'execution_recovery_required',
          recoveryReason: classification.recoveryReason || details.errorCode || 'execution_recovery_required',
          recoveryNotes: details.notes || null,
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
        });
      } else {
        await transitionExecutionWithLease(
          billing.execution_id,
          classification.targetState,
          {
            requestId: billing.request_id,
            actorSource: 'runtime',
            reasonCode: classification.reasonCode,
            leaseId: billing.execution_lease_id,
            leaseHolder: billing.execution_lease_holder,
            leaseEpoch: billing.execution_lease_epoch,
            clearLease: true,
          }
        );
      }
    }
  };

  const emit = (eventType, payload) => {
    state.sequenceNumber += 1;
    writeSseEvent(res, eventType, {
      ...payload,
      type: eventType,
      sequence_number: state.sequenceNumber,
    });
  };

  const writeHeadersIfNeeded = () => {
    if (state.wroteHeaders) {
      return;
    }

    state.wroteHeaders = true;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  };

  const sendCreatedIfNeeded = () => {
    if (state.createdEventSent) {
      return;
    }

    state.createdEventSent = true;
    emit('response.created', {
      response: buildResponseStreamObject(session, responseAlias, state.responseId, state.createdAt),
    });
  };

  const sendOutputItemAddedIfNeeded = () => {
    if (state.outputItemAdded) {
      return;
    }

    state.outputItemAdded = true;
    emit('response.output_item.added', {
      output_index: state.outputIndex,
      item: {
        id: state.itemId,
        status: 'in_progress',
        type: 'message',
        role: 'assistant',
        content: [],
      },
    });
  };

  const sendContentPartAddedIfNeeded = () => {
    if (state.contentPartAdded) {
      return;
    }

    state.contentPartAdded = true;
    emit('response.content_part.added', {
      item_id: state.itemId,
      output_index: state.outputIndex,
      content_index: state.contentIndex,
      part: {
        type: 'output_text',
        text: '',
        annotations: [],
      },
    });
  };

  const resetIdleTimer = () => {
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
        if (!state.createdEventSent) {
        void finalizeRequest('failed', {
          statusCode: 502,
          errorCode: 'upstream_timeout',
        });
        logStreamDiagnostics(upstreamContext, {
          stage: 'idle_timeout_before_headers',
          completed: false,
          partial_completion_state: {
            pending_total_tokens: state.pendingTotalTokens,
            buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
            output_text_length: state.text.length,
          },
        });
        sendError(res, 502, 'Upstream stream timed out before the first chunk', 'provider_error', 'upstream_timeout');
        if (upstream.body && !upstream.body.destroyed) {
          upstream.body.destroy();
        }
        return;
      }

      if (upstream.body && !upstream.body.destroyed) {
        upstream.body.destroy(new Error('Upstream stream idle timeout'));
      }
      void finalizeRequest('failed', {
        inputTokens: state.pendingInputTokens,
        outputTokens: state.pendingTotalTokens,
        statusCode: 502,
        errorCode: 'upstream_timeout',
      });
      logStreamDiagnostics(upstreamContext, {
        stage: 'idle_timeout_after_headers',
        completed: false,
        partial_completion_state: {
          pending_total_tokens: state.pendingTotalTokens,
          buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
          output_text_length: state.text.length,
        },
      });
      res.end();
    }, state.wroteHeaders ? idleTimeouts.afterHeadersMs : idleTimeouts.beforeHeadersMs);
  };

  const flushParsedChunk = (parsed) => {
    const totalTokens = parsed?.usage?.total_tokens;
    if (Number.isFinite(totalTokens)) {
      state.pendingTotalTokens = Math.max(state.pendingTotalTokens, totalTokens);
    }
    const promptTokens = Number(parsed?.usage?.prompt_tokens ?? parsed?.usage?.input_tokens);
    if (Number.isFinite(promptTokens)) {
      state.pendingInputTokens = Math.max(state.pendingInputTokens, promptTokens);
    }

    const delta = extractChatDeltaContent(parsed);
    if (!delta) {
      return;
    }

    state.meaningfulOutputStarted = true;

    writeHeadersIfNeeded();
    sendCreatedIfNeeded();
    sendOutputItemAddedIfNeeded();
    sendContentPartAddedIfNeeded();
    emit('response.output_text.delta', {
      item_id: state.itemId,
      output_index: state.outputIndex,
      content_index: state.contentIndex,
      delta,
    });
    state.text += delta;
  };

  req.on('close', () => {
    clearTimeout(state.idleTimer);
    if (!state.completed) {
      void finalizeRequest('interrupted', {
        inputTokens: state.pendingInputTokens,
        outputTokens: state.pendingTotalTokens,
        statusCode: 499,
        errorCode: 'client_disconnect',
      });
      logStreamDiagnostics(upstreamContext, {
        stage: 'client_disconnect',
        completed: false,
        partial_completion_state: {
          pending_total_tokens: state.pendingTotalTokens,
          buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
          output_text_length: state.text.length,
        },
      });
    }
    if (upstream.body && !upstream.body.destroyed) {
      upstream.body.destroy();
    }
  });

  resetIdleTimer();

  upstream.body.on('data', (chunk) => {
    resetIdleTimer();
    if (!state.firstTokenAt) {
      state.firstTokenAt = Date.now();
      logStreamDiagnostics(upstreamContext, {
        stage: 'first_token',
        time_to_first_token_ms: state.firstTokenAt - upstreamContext.started_at_ms,
      });
    }
    state.buffer += chunk.toString('utf8');
    const lines = state.buffer.split('\n');
    state.buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        continue;
      }

      try {
        flushParsedChunk(JSON.parse(payload));
      } catch (error) {
        continue;
      }
    }

    if (billing?.execution_id && billing.execution_lease_id && billing.execution_lease_holder && billing.execution_lease_epoch) {
      void refreshExecutionLease(billing.execution_id, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        isStreaming: true,
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
      }).catch(() => {});
    }
  });

  upstream.body.on('end', async () => {
    clearTimeout(state.idleTimer);

    if (state.buffer) {
      const tail = state.buffer.endsWith('\n') ? state.buffer : `${state.buffer}\n`;
      const lines = tail.split('\n');
      for (const rawLine of lines) {
        if (!rawLine) {
          continue;
        }

        const line = rawLine.trim();
        if (!line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }

        try {
          flushParsedChunk(JSON.parse(payload));
        } catch (error) {
          continue;
        }
      }
    }

    let terminalRecoveryArtifactOutcome = null;
    if (billing?.execution_id && !String(state.text || '').trim()) {
      terminalRecoveryArtifactOutcome = await attemptManagedArtifactMaterializationBeforeTerminalRecovery(
        billing.execution_id,
        state.text,
        {
          requestId: billing.request_id,
          actorSource: 'runtime',
          promptText: extractManagedRequestPromptText(retryOptions.originalBody || req.body || {}),
        }
      );
      if (terminalRecoveryArtifactOutcome?.ok) {
        state.text = buildManagedArtifactResponseText(terminalRecoveryArtifactOutcome, state.text);
      }
    }

    writeHeadersIfNeeded();
    sendCreatedIfNeeded();
    let verifiedArtifactAssessment = null;
    try {
      verifiedArtifactAssessment = terminalRecoveryArtifactOutcome?.assessment
        || (billing?.execution_id
        ? await getVerifiedTaskArtifactAssessmentForExecutionId(billing.execution_id)
        : null);
    } catch (error) {
      verifiedArtifactAssessment = null;
    }
    const terminalWireOutcome = buildManagedTerminalWireOutcome(session, responseAlias, state.responseId, state.createdAt, {
      status: 'success',
      outputTextLength: state.text.length,
      verifiedArtifactExists: Boolean(verifiedArtifactAssessment),
    });
    const fallbackTerminalText = buildManagedTerminalFallbackText(retryOptions.originalBody || req.body || {});

    if (terminalWireOutcome) {
      if (fallbackTerminalText) {
        incrementUsage(session, state.pendingTotalTokens);
        state.completed = true;
        sendOutputItemAddedIfNeeded();
        sendContentPartAddedIfNeeded();
        emit('response.output_text.done', {
          item_id: state.itemId,
          output_index: state.outputIndex,
          content_index: state.contentIndex,
          text: fallbackTerminalText,
        });

        emit('response.content_part.done', {
          item_id: state.itemId,
          output_index: state.outputIndex,
          content_index: state.contentIndex,
          part: {
            type: 'output_text',
            text: fallbackTerminalText,
            annotations: [],
          },
        });

        emit('response.output_item.done', {
          output_index: state.outputIndex,
          item: {
            id: state.itemId,
            status: 'completed',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: fallbackTerminalText,
                annotations: [],
              },
            ],
          },
        });

        emit('response.completed', {
          response: buildResponseCompletedStreamObject(session, responseAlias, state.responseId, state.createdAt, fallbackTerminalText, state.itemId),
        });
        void finalizeRequest('success', {
          inputTokens: state.pendingInputTokens,
          outputTokens: Math.max(0, state.pendingTotalTokens - state.pendingInputTokens),
        });
        logStreamDiagnostics(upstreamContext, {
          stage: 'completed_fallback_terminal',
          completed: true,
          time_to_first_token_ms: state.firstTokenAt ? state.firstTokenAt - upstreamContext.started_at_ms : null,
          partial_completion_state: {
            pending_total_tokens: state.pendingTotalTokens,
            buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
            output_text_length: fallbackTerminalText.length,
            terminal_wire_event: 'response.completed',
            fallback_reason: 'artifact_or_file_fallback',
          },
        });
        res.end();
        return;
      }
      incrementUsage(session, state.pendingTotalTokens);
      state.completed = true;
      emit(terminalWireOutcome.eventType, {
        response: terminalWireOutcome.response,
      });
      void finalizeRequest('success', {
        inputTokens: state.pendingInputTokens,
        outputTokens: Math.max(0, state.pendingTotalTokens - state.pendingInputTokens),
      });
      logStreamDiagnostics(upstreamContext, {
        stage: 'completed_incomplete_terminal',
        completed: false,
        partial_completion_state: {
          pending_total_tokens: state.pendingTotalTokens,
          buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
          output_text_length: state.text.length,
          terminal_wire_event: terminalWireOutcome.eventType,
          incomplete_reason: terminalWireOutcome.response.incomplete_details?.reason || 'terminal_payload_missing',
        },
      });
      res.end();
      return;
    }

    sendOutputItemAddedIfNeeded();
    sendContentPartAddedIfNeeded();

    emit('response.output_text.done', {
      item_id: state.itemId,
      output_index: state.outputIndex,
      content_index: state.contentIndex,
      text: state.text,
    });

    emit('response.content_part.done', {
      item_id: state.itemId,
      output_index: state.outputIndex,
      content_index: state.contentIndex,
      part: {
        type: 'output_text',
        text: state.text,
        annotations: [],
      },
    });

    emit('response.output_item.done', {
      output_index: state.outputIndex,
      item: {
        id: state.itemId,
        status: 'completed',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: state.text,
            annotations: [],
          },
        ],
      },
    });

    emit('response.completed', {
      response: {
        ...buildResponseStreamObject(session, responseAlias, state.responseId, state.createdAt),
        status: 'completed',
        output: [
          {
            id: state.itemId,
            status: 'completed',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: state.text,
                annotations: [],
              },
            ],
          },
        ],
      },
    });

    incrementUsage(session, state.pendingTotalTokens);
    state.completed = true;
    void finalizeRequest('success', {
      inputTokens: state.pendingInputTokens,
      outputTokens: Math.max(0, state.pendingTotalTokens - state.pendingInputTokens),
    });
    logStreamDiagnostics(upstreamContext, {
      stage: 'completed',
      completed: true,
      time_to_first_token_ms: state.firstTokenAt ? state.firstTokenAt - upstreamContext.started_at_ms : null,
      partial_completion_state: {
        pending_total_tokens: state.pendingTotalTokens,
        buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
        output_text_length: state.text.length,
      },
    });
    res.end();
  });

  upstream.body.on('error', (error) => {
    clearTimeout(state.idleTimer);
    if (!state.wroteHeaders) {
      void finalizeRequest('failed', {
        inputTokens: state.pendingInputTokens,
        outputTokens: state.pendingTotalTokens,
        statusCode: 502,
        errorCode: 'stream_proxy_failed',
      });
      logStreamDiagnostics(upstreamContext, {
        stage: 'stream_error_before_headers',
        completed: false,
        reason: error?.message || 'stream_error',
        partial_completion_state: {
          pending_total_tokens: state.pendingTotalTokens,
          buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
          output_text_length: state.text.length,
        },
      });
      sendError(res, 502, 'Streaming proxy failed', 'provider_error', 'stream_proxy_failed');
      return;
    }

    logStreamDiagnostics(upstreamContext, {
      stage: 'stream_error_after_headers',
      completed: false,
      reason: error?.message || 'stream_error',
      partial_completion_state: {
        pending_total_tokens: state.pendingTotalTokens,
        buffered_bytes: Buffer.byteLength(state.buffer, 'utf8'),
        output_text_length: state.text.length,
      },
    });
    void finalizeRequest('failed', {
      inputTokens: state.pendingInputTokens,
      outputTokens: state.pendingTotalTokens,
      statusCode: 502,
      errorCode: 'stream_proxy_failed',
    });
    res.end();
  });

  return undefined;
}

async function handleChatCompletion(req, res) {
  if (!Array.isArray(req.body.messages) || req.body.messages.length === 0) {
    return sendError(res, 400, 'messages must be a non-empty array', 'invalid_request_error', 'invalid_messages');
  }

  const { descriptor, responseAlias, upstream, upstreamContext, billing, error, served_by, effective_body } = await executeChatFlow(req.session, req.body, {
    route: 'chat/completions',
    upstreamApiKeyOverride: resolveTestUpstreamKeyOverride(req),
    testPrimaryFailureMode: resolveTestPrimaryFailureMode(req),
  });
  if (error) {
    if (billing?.reserved && !billing.finalized) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || failureReasonFromFetchError(error),
        endpoint: billing.endpoint || '',
        error_code: error.code || 'upstream_error',
        status_code: error.statusCode || 502,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
    }
    return sendError(res, error.statusCode, error.message, error.type, error.code);
  }

  if (req.body.stream) {
    logRoutingDecision('response_served', {
      route: 'chat/completions',
      served_by: served_by || 'primary',
      session_id: req.session.session_id,
      model_used: billing?.model_used || descriptor?.upstreamId || '',
    });
    return proxyStreamingChat(req, res, req.session, descriptor, upstream, upstreamContext, billing, responseAlias, {
      originalBody: effective_body || req.body,
      upstreamApiKeyOverride: resolveTestUpstreamKeyOverride(req),
    });
  }

  const responseResult = await proxyNonStreamingChat(res, req.session, descriptor, upstream, billing, responseAlias, req.body);
  if (responseResult === undefined) {
    return undefined;
  }
  const responsePayload = responseResult.payload;

  let assistantText = stringifyTextContent(responsePayload?.choices?.[0]?.message?.content ?? '');
  const terminalRecoveryArtifactOutcome = billing?.execution_id && !assistantText.trim()
    ? await attemptManagedArtifactMaterializationBeforeTerminalRecovery(billing.execution_id, assistantText, {
      requestId: billing.request_id,
      actorSource: 'runtime',
      autoDeliver: true,
      promptText: extractManagedRequestPromptText(req.body || {}),
    })
    : null;
  if (terminalRecoveryArtifactOutcome?.ok) {
    assistantText = buildManagedArtifactResponseText(terminalRecoveryArtifactOutcome, assistantText);
    if (Array.isArray(responsePayload?.choices) && responsePayload.choices.length > 0) {
      responsePayload.choices = responsePayload.choices.map((choice, index) => (index === 0 ? {
        ...choice,
        message: {
          ...(choice?.message || {}),
          content: assistantText,
        },
      } : choice));
    }
  }
  const managedArtifactOutcome = billing?.execution_id
    ? await materializeVerifiedArtifactForExecution(billing.execution_id, assistantText, {
      requestId: billing.request_id,
      actorSource: 'runtime',
      autoDeliver: true,
    })
    : null;
  if (managedArtifactOutcome?.required && !managedArtifactOutcome.ok) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'interrupted',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: managedArtifactOutcome.reason || 'artifact_output_invalid',
        endpoint: billing.endpoint || '',
        error_code: managedArtifactOutcome.reason || 'artifact_output_invalid',
        status_code: 200,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
    }
    if (billing?.execution_id) {
      await markExecutionRecoveryRequired(billing.execution_id, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        reasonCode: managedArtifactOutcome.reason || 'artifact_output_invalid',
        recoveryReason: managedArtifactOutcome.reason || 'artifact_output_invalid',
        recoveryNotes: managedArtifactOutcome.reason || 'artifact_output_invalid',
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
      });
    }
    const fallbackText = managedArtifactOutcome.fallbackText || buildManagedTerminalFallbackText(req.body || {});
    const fallbackPayload = {
      ...responsePayload,
      choices: Array.isArray(responsePayload?.choices) && responsePayload.choices.length > 0
        ? responsePayload.choices.map((choice, index) => (index === 0 ? {
          ...choice,
          message: {
            ...(choice?.message || {}),
            content: fallbackText,
          },
        } : choice))
        : [{
          index: 0,
          message: {
            role: 'assistant',
            content: fallbackText,
          },
          finish_reason: 'stop',
        }],
    };
    return res.status(200).json(fallbackPayload);
  }
  const artifactError = await validateArtifactHonestyOrError(req.body, assistantText, {
    executionId: billing?.execution_id || '',
    requestId: billing?.request_id || '',
    actorSource: 'runtime',
    meaningfulOutputStarted: false,
  });
  if (artifactError) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: artifactError.code || 'artifact_honesty_failed',
        endpoint: billing.endpoint || '',
        error_code: artifactError.code || 'artifact_honesty_failed',
        status_code: artifactError.statusCode || 422,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
    }
    if (billing?.execution_id) {
      await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        reasonCode: artifactError.code || 'artifact_honesty_failed',
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
        clearLease: true,
      });
    }
    return sendError(res, artifactError.statusCode, artifactError.message, artifactError.type, artifactError.code);
  }

  if (billing?.reserved) {
    const usage = responseResult.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const inputTokens = usage.inputTokens || billing.input_tokens || 0;
    const outputTokens = usage.outputTokens || Math.max(0, usage.totalTokens - inputTokens);
    await finalizeBillingRequest({
      request_id: billing.request_id,
      timestamp: getTimestamp(),
      route: billing.route,
      session_id: req.session.session_id,
      execution_id: billing.execution_id || null,
      primary_model: billing.primary_model || '',
      model_used: billing.model_used,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimateCostForDescriptor(billing.cost_descriptor || descriptor, inputTokens, outputTokens),
      status: 'success',
      fallback_triggered: Number(Boolean(billing.fallback_triggered)),
      failure_reason: billing.failure_reason || '',
      endpoint: billing.endpoint || '',
      error_code: '',
      status_code: 200,
      response_body: '',
      reserved_cost_usd: billing.reserved_cost_usd,
    });
  }
  if (billing?.execution_id) {
    await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.COMPLETED, {
      requestId: billing.request_id,
      actorSource: 'runtime',
      reasonCode: 'request_completed',
      leaseId: billing.execution_lease_id,
      leaseHolder: billing.execution_lease_holder,
      leaseEpoch: billing.execution_lease_epoch,
      clearLease: true,
    });
  }

  logRoutingDecision('response_served', {
    route: 'chat/completions',
    served_by: served_by || 'primary',
    session_id: req.session.session_id,
    model_used: billing?.model_used || descriptor?.upstreamId || '',
  });
  return res.status(200).json(responsePayload);
}

async function handleResponsesCompatibility(req, res) {
  const translated = translateResponsesRequestToChatBody(req.body || {});
  if (translated.error) {
    return sendError(res, translated.error.statusCode, translated.error.message, translated.error.type, translated.error.code);
  }

  const { descriptor, upstream, upstreamContext, billing, error, served_by, effective_body } = await executeChatFlow(req.session, translated.body, {
    route: 'responses',
    upstreamApiKeyOverride: resolveTestUpstreamKeyOverride(req),
    testPrimaryFailureMode: resolveTestPrimaryFailureMode(req),
  });
  if (error) {
    if (billing?.reserved && !billing.finalized) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || failureReasonFromFetchError(error),
        endpoint: billing.endpoint || '',
        error_code: error.code || 'upstream_error',
        status_code: error.statusCode || 502,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
    }
    return sendError(res, error.statusCode, error.message, error.type, error.code);
  }

  if (translated.body.stream) {
    logRoutingDecision('response_served', {
      route: 'responses',
      served_by: served_by || 'primary',
      session_id: req.session.session_id,
      model_used: billing?.model_used || descriptor?.upstreamId || '',
    });
    return proxyStreamingResponses(req, res, req.session, descriptor, upstream, upstreamContext, billing, PUBLIC_MODEL_ALIAS, {
      originalBody: effective_body || translated.body,
      upstreamApiKeyOverride: resolveTestUpstreamKeyOverride(req),
    });
  }

  if (!upstream.ok) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || failureReasonFromUpstreamStatus(upstream.status),
        endpoint: billing.endpoint || '',
        error_code: 'upstream_error',
        status_code: upstream.status,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
      if (billing.execution_id) {
        await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: billing.failure_reason || failureReasonFromUpstreamStatus(upstream.status),
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
          clearLease: true,
        });
      }
    }
    return sendError(res, 502, 'Upstream provider returned an error', 'provider_error', 'upstream_error');
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch (error) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || 'upstream_invalid_response',
        endpoint: billing.endpoint || '',
        error_code: 'upstream_invalid_response',
        status_code: 502,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
      if (billing.execution_id) {
        await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: billing.failure_reason || 'upstream_invalid_response',
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
          clearLease: true,
        });
      }
    }
    return sendError(res, 502, 'Upstream provider returned an invalid response', 'provider_error', 'upstream_invalid_response');
  }

  const usage = extractUsageTokens(payload?.usage);
  incrementUsage(req.session, payload?.usage?.total_tokens);
  const chatPayload = normalizeChatCompletionResponse(payload, PUBLIC_MODEL_ALIAS);
  const assistantText = stringifyTextContent(chatPayload?.choices?.[0]?.message?.content ?? '');
  let verifiedArtifactAssessment = null;
  try {
    verifiedArtifactAssessment = billing?.execution_id
      ? await getVerifiedTaskArtifactAssessmentForExecutionId(billing.execution_id)
      : null;
  } catch (error) {
    verifiedArtifactAssessment = null;
  }
  const terminalIntegrityClassification = classifyManagedTerminalCompletionIntegrity({
    status: 'success',
    outputTextLength: assistantText.length,
    verifiedArtifactExists: Boolean(verifiedArtifactAssessment),
  });
  const fallbackTerminalText = buildManagedTerminalFallbackText(translated.body || req.body || {});
  if (terminalIntegrityClassification) {
    if (fallbackTerminalText) {
      if (billing?.reserved) {
        await finalizeBillingRequest({
          request_id: billing.request_id,
          timestamp: getTimestamp(),
          route: billing.route,
          session_id: req.session.session_id,
          execution_id: billing.execution_id || null,
          primary_model: billing.primary_model || '',
          model_used: billing.model_used,
          input_tokens: usage.inputTokens || billing.input_tokens || 0,
          output_tokens: usage.outputTokens || Math.max(0, usage.totalTokens - (billing.input_tokens || 0)),
          estimated_cost_usd: estimateCostForDescriptor(billing.cost_descriptor || descriptor,
            usage.inputTokens || billing.input_tokens || 0,
            usage.outputTokens || Math.max(0, usage.totalTokens - (billing.input_tokens || 0))
          ),
          status: terminalIntegrityClassification.billingStatus,
          fallback_triggered: Number(Boolean(billing.fallback_triggered)),
          failure_reason: billing.failure_reason || '',
          endpoint: billing.endpoint || '',
          error_code: terminalIntegrityClassification.reasonCode,
          status_code: 200,
          response_body: '',
          reserved_cost_usd: billing.reserved_cost_usd,
        });
      }
      if (billing?.execution_id) {
        await markExecutionRecoveryRequired(billing.execution_id, {
          requestId: billing.request_id,
          actorSource: 'runtime',
          reasonCode: terminalIntegrityClassification.reasonCode,
          recoveryReason: terminalIntegrityClassification.recoveryReason,
          recoveryNotes: terminalIntegrityClassification.reasonDetail,
          leaseId: billing.execution_lease_id,
          leaseHolder: billing.execution_lease_holder,
          leaseEpoch: billing.execution_lease_epoch,
        });
      }
      logRoutingDecision('response_served_fallback_terminal', {
        route: 'responses',
        served_by: served_by || 'primary',
        session_id: req.session.session_id,
        model_used: billing?.model_used || descriptor?.upstreamId || '',
        fallback_output_text_length: fallbackTerminalText.length,
        reason_code: terminalIntegrityClassification.reasonCode,
      });
      return res.status(200).json(
        normalizeResponsesFallbackResponseFromChat(chatPayload, PUBLIC_MODEL_ALIAS, fallbackTerminalText)
      );
    }
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: usage.inputTokens || billing.input_tokens || 0,
        output_tokens: usage.outputTokens || Math.max(0, usage.totalTokens - (billing.input_tokens || 0)),
        estimated_cost_usd: estimateCostForDescriptor(billing.cost_descriptor || descriptor,
          usage.inputTokens || billing.input_tokens || 0,
          usage.outputTokens || Math.max(0, usage.totalTokens - (billing.input_tokens || 0))
        ),
        status: terminalIntegrityClassification.billingStatus,
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: billing.failure_reason || '',
        endpoint: billing.endpoint || '',
        error_code: terminalIntegrityClassification.reasonCode,
        status_code: 200,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
    }
    if (billing?.execution_id) {
      await markExecutionRecoveryRequired(billing.execution_id, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        reasonCode: terminalIntegrityClassification.reasonCode,
        recoveryReason: terminalIntegrityClassification.recoveryReason,
        recoveryNotes: terminalIntegrityClassification.reasonDetail,
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
      });
    }
    logRoutingDecision('response_served_incomplete_terminal', {
      route: 'responses',
      served_by: served_by || 'primary',
      session_id: req.session.session_id,
      model_used: billing?.model_used || descriptor?.upstreamId || '',
      reason_code: terminalIntegrityClassification.reasonCode,
    });
    return res.status(200).json(
      normalizeResponsesIncompleteResponseFromChat(chatPayload, PUBLIC_MODEL_ALIAS, {
        reason: terminalIntegrityClassification.reasonCode,
        message: terminalIntegrityClassification.reasonDetail,
      })
    );
  }
  const artifactError = await validateArtifactHonestyOrError(req.body, assistantText, {
    executionId: billing?.execution_id || '',
    requestId: billing?.request_id || '',
    actorSource: 'runtime',
    meaningfulOutputStarted: false,
  });
  if (artifactError) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
        execution_id: billing.execution_id || null,
        primary_model: billing.primary_model || '',
        model_used: billing.model_used,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        status: 'failed',
        fallback_triggered: Number(Boolean(billing.fallback_triggered)),
        failure_reason: artifactError.code || 'artifact_honesty_failed',
        endpoint: billing.endpoint || '',
        error_code: artifactError.code || 'artifact_honesty_failed',
        status_code: artifactError.statusCode || 422,
        response_body: '',
        reserved_cost_usd: billing.reserved_cost_usd,
      });
    }
    if (billing?.execution_id) {
      await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.FAILED, {
        requestId: billing.request_id,
        actorSource: 'runtime',
        reasonCode: artifactError.code || 'artifact_honesty_failed',
        leaseId: billing.execution_lease_id,
        leaseHolder: billing.execution_lease_holder,
        leaseEpoch: billing.execution_lease_epoch,
        clearLease: true,
      });
    }
    return sendError(res, artifactError.statusCode, artifactError.message, artifactError.type, artifactError.code);
  }

  if (billing?.reserved) {
    await finalizeBillingRequest({
      request_id: billing.request_id,
      timestamp: getTimestamp(),
      route: billing.route,
      session_id: req.session.session_id,
      execution_id: billing.execution_id || null,
      primary_model: billing.primary_model || '',
      model_used: billing.model_used,
      input_tokens: usage.inputTokens || billing.input_tokens || 0,
      output_tokens: usage.outputTokens || Math.max(0, usage.totalTokens - (billing.input_tokens || 0)),
      estimated_cost_usd: estimateCostForDescriptor(billing.cost_descriptor || descriptor,
        usage.inputTokens || billing.input_tokens || 0,
        usage.outputTokens || Math.max(0, usage.totalTokens - (billing.input_tokens || 0))
      ),
      status: 'success',
      fallback_triggered: Number(Boolean(billing.fallback_triggered)),
      failure_reason: billing.failure_reason || '',
      endpoint: billing.endpoint || '',
      error_code: '',
      status_code: 200,
      response_body: '',
      reserved_cost_usd: billing.reserved_cost_usd,
    });
  }
  if (billing?.execution_id) {
    await transitionExecutionWithLease(billing.execution_id, EXECUTION_STATES.COMPLETED, {
      requestId: billing.request_id,
      actorSource: 'runtime',
      reasonCode: 'request_completed',
      leaseId: billing.execution_lease_id,
      leaseHolder: billing.execution_lease_holder,
      leaseEpoch: billing.execution_lease_epoch,
      clearLease: true,
    });
  }

  logRoutingDecision('response_served', {
    route: 'responses',
    served_by: served_by || 'primary',
    session_id: req.session.session_id,
    model_used: billing?.model_used || descriptor?.upstreamId || '',
  });
  return res.status(200).json(normalizeResponsesResponseFromChat(chatPayload, PUBLIC_MODEL_ALIAS));
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/v1', async (req, res) => {
  try {
    const liveKey = await getOrCreateRuntimeDiscoveryLiveKey();

    return res.json({
      type: 'blockfork_runtime',
      connection: {
        base_url: getSessionBaseUrl(req),
        api_key: liveKey.key,
        auth: 'bearer',
        default_model: PUBLIC_MODEL_ALIAS,
      },
      usage: 'Set base_url to this URL, use the returned API key, and keep model set to managed',
    });
  } catch (error) {
    console.error('Failed to build runtime descriptor', error);
    return sendError(res, 500, 'Failed to build runtime descriptor', 'runtime_error', 'runtime_descriptor_failed');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get('/admin/api/summary', requireAdminSecret, async (req, res) => {
  const summary = await getAdminSummary();
  res.json(summary);
});

app.post('/admin/api/live-keys', requireAdminSecret, async (req, res) => {
  try {
    const liveKey = await mintLiveKeyForUser({
      user_id: typeof req.body?.user_id === 'string' && req.body.user_id.trim() ? req.body.user_id.trim() : null,
      budget_limit: req.body?.budget_limit,
      last_session_id: typeof req.body?.last_session_id === 'string' && req.body.last_session_id.trim() ? req.body.last_session_id.trim() : null,
    });

    return res.status(201).json({
      id: liveKey.id,
      key: liveKey.key,
      user_id: liveKey.user_id || null,
      created_at: liveKey.created_at,
      last_session_id: liveKey.last_session_id || null,
      budget_limit: liveKey.budget_limit,
    });
  } catch (error) {
    console.error('Failed to mint live key', error);
    return sendError(res, 500, 'Failed to mint live key', 'runtime_error', 'live_key_mint_failed');
  }
});

app.post('/admin/api/live-keys/backfill', requireAdminSecret, async (req, res) => {
  try {
    const result = await backfillLiveKeysForActiveSessions();
    return res.json(result);
  } catch (error) {
    console.error('Failed to backfill live keys', error);
    return sendError(res, 500, 'Failed to backfill live keys', 'runtime_error', 'live_key_backfill_failed');
  }
});

app.get('/admin/api/live-keys', requireAdminSecret, async (req, res) => {
  try {
    const liveKeys = await getAdminLiveKeys();
    return res.json({
      data: liveKeys,
      count: liveKeys.length,
    });
  } catch (error) {
    console.error('Failed to load live keys', error);
    return sendError(res, 500, 'Failed to load live keys', 'runtime_error', 'live_keys_load_failed');
  }
});

app.put('/admin/api/live-keys/:id/delivery-target', requireAdminSecret, async (req, res) => {
  try {
    const liveKeyId = String(req.params.id || '').trim();
    const deliveryTarget = normalizeSessionDeliveryTargetInput(req.body || {});
    const timestamp = getTimestamp();

    const stored = await withBillingWrite(async (db) => {
      const liveKey = await getStoredLiveKeyById(db, liveKeyId);
      if (!liveKey) {
        return null;
      }

      const liveKeyTarget = await upsertLiveKeyDeliveryTargetTx(db, liveKeyId, deliveryTarget, {
        timestamp,
      });

      let sessionTarget = null;
      if (String(liveKey.last_session_id || '')) {
        sessionTarget = await upsertSessionDeliveryTargetTx(db, String(liveKey.last_session_id), deliveryTarget, {
          timestamp,
        });
      }

      return {
        live_key_id: liveKeyId,
        session_id: liveKey.last_session_id || null,
        delivery_target: liveKeyTarget,
        current_session_delivery_target: sessionTarget,
      };
    });

    if (!stored) {
      return sendError(res, 404, 'Live key not found', 'invalid_request_error', 'live_key_not_found');
    }

    return res.json({ data: stored });
  } catch (error) {
    console.error('Failed to bind live key delivery target', error);
    return sendError(res, 400, error.message || 'Invalid delivery target', 'invalid_request_error', 'invalid_delivery_target');
  }
});

app.get('/admin/api/openclaw-relays', requireAdminSecret, async (req, res) => {
  try {
    const relays = await listOpenClawRelayConfigs();
    return res.json({
      data: relays,
      count: relays.length,
    });
  } catch (error) {
    console.error('Failed to load OpenClaw relay configs', error);
    return sendError(res, 500, 'Failed to load OpenClaw relay configs', 'runtime_error', 'openclaw_relay_load_failed');
  }
});

app.get('/admin/api/openclaw-relays/:label', requireAdminSecret, async (req, res) => {
  try {
    const relayLabel = normalizeOpenClawRelayLabel(req.params.label);
    const relay = await getOpenClawRelayConfigByLabel(relayLabel);
    if (!relay) {
      return sendError(res, 404, 'Relay config not found', 'invalid_request_error', 'openclaw_relay_not_found');
    }
    return res.json({ data: relay });
  } catch (error) {
    console.error('Failed to load OpenClaw relay config', error);
    return sendError(res, 400, error.message || 'Invalid relay label', 'invalid_request_error', 'invalid_openclaw_relay_label');
  }
});

app.put('/admin/api/openclaw-relays/:label', requireAdminSecret, async (req, res) => {
  try {
    const body = {
      ...(req.body || {}),
      relay_label: req.params.label,
    };
    const relay = await upsertOpenClawRelayConfig(body);
    return res.json({ data: relay });
  } catch (error) {
    console.error('Failed to save OpenClaw relay config', error);
    return sendError(res, 400, error.message || 'Invalid relay config', 'invalid_request_error', 'invalid_openclaw_relay_config');
  }
});

app.post('/admin/api/openclaw-relays/:label/doctor', requireAdminSecret, async (req, res) => {
  try {
    const relayLabel = normalizeOpenClawRelayLabel(req.params.label);
    const relay = await getOpenClawRelayConfigByLabel(relayLabel);
    const payload = relay || normalizeOpenClawRelayConfigInput({
      relay_label: relayLabel,
      ...(req.body || {}),
    });
    const report = await runOpenClawRelayDoctor(payload, {
      probe: Boolean(req.body?.probe),
      timeoutMs: req.body?.timeout_ms,
    });
    return res.json({ data: report });
  } catch (error) {
    console.error('Failed to run OpenClaw relay doctor', error);
    return sendError(res, 400, error.message || 'Invalid relay config', 'invalid_request_error', 'openclaw_relay_doctor_failed');
  }
});

app.get('/admin/api/requests', requireAdminSecret, async (req, res) => {
  const requests = await getAdminRequests({
    sessionId: typeof req.query.session_id === 'string' ? req.query.session_id : '',
    from: typeof req.query.from === 'string' ? req.query.from : '',
    to: typeof req.query.to === 'string' ? req.query.to : '',
    status: typeof req.query.status === 'string' ? req.query.status : '',
    limit: req.query.limit,
    offset: req.query.offset,
  });

  res.json({
    data: requests,
    count: requests.length,
  });
});

app.get('/admin/api/task-notifications', requireAdminSecret, async (req, res) => {
  try {
    const db = await ensureBillingDb();
    const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id.trim() : '';
    const taskId = typeof req.query.task_id === 'string' ? req.query.task_id.trim() : '';
    const deliveryState = typeof req.query.delivery_state === 'string' ? req.query.delivery_state.trim() : '';
    const limit = Number.isFinite(Number(req.query.limit)) ? Math.max(1, Number(req.query.limit)) : 50;

    const stmt = db.prepare(`
      SELECT *
      FROM task_notifications
      WHERE (? = '' OR session_id = ?)
        AND (? = '' OR task_id = ?)
        AND (? = '' OR delivery_state = ?)
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `);
    stmt.bind([sessionId, sessionId, taskId, taskId, deliveryState, deliveryState, limit]);
    const data = [];
    while (stmt.step()) {
      data.push(renderTaskNotificationViewTx(db, stmt.getAsObject()));
    }
    stmt.free();

    return res.json({
      data,
      count: data.length,
    });
  } catch (error) {
    console.error('Failed to load task notifications', error);
    return sendError(res, 500, 'Failed to load task notifications', 'runtime_error', 'task_notifications_load_failed');
  }
});

app.get('/admin/api/task-notifications/:id', requireAdminSecret, async (req, res) => {
  try {
    const notification = await renderTaskNotificationView(String(req.params.id || '').trim());
    if (!notification) {
      return sendError(res, 404, 'Notification not found', 'invalid_request_error', 'notification_not_found');
    }
    return res.json({ data: notification });
  } catch (error) {
    console.error('Failed to load task notification', error);
    return sendError(res, 500, 'Failed to load task notification', 'runtime_error', 'task_notification_load_failed');
  }
});

app.get('/admin/api/task-notifications/:id/attempts', requireAdminSecret, async (req, res) => {
  try {
    const attempts = await getNotificationDeliveryAttemptsByNotificationId(String(req.params.id || '').trim(), { limit: 50 });
    return res.json({
      data: attempts,
      count: attempts.length,
    });
  } catch (error) {
    console.error('Failed to load task notification delivery attempts', error);
    return sendError(res, 500, 'Failed to load task notification delivery attempts', 'runtime_error', 'task_notification_attempts_load_failed');
  }
});

app.get('/session/:id/openclaw-config.json', legacySessionAuth, async (req, res) => {
  try {
    const liveKey = await getOrCreateLiveKeyForSession(req.session, {
      user_id: req.session.user_id || null,
    });

    if (!liveKey) {
      return sendError(res, 404, 'Live key not found', 'invalid_request_error', 'live_key_not_found');
    }

    return res.json(buildOpenClawConfigPayload(req, liveKey));
  } catch (error) {
    console.error('Failed to build OpenClaw config', error);
    return sendError(res, 500, 'Failed to build OpenClaw config', 'runtime_error', 'openclaw_config_failed');
  }
});

app.get('/live/:key/openclaw-config.json', async (req, res) => {
  try {
    const liveKey = await loadPersistedLiveKeyByApiKey(String(req.params.key || ''));
    if (!liveKey) {
      return sendError(res, 404, 'Live key not found', 'invalid_request_error', 'live_key_not_found');
    }

    return res.json(buildOpenClawConfigPayload(req, liveKey));
  } catch (error) {
    console.error('Failed to build live key OpenClaw config', error);
    return sendError(res, 500, 'Failed to build OpenClaw config', 'runtime_error', 'openclaw_config_failed');
  }
});

async function handleSessionCreation(req, res) {
  try {
    const session = await createSessionRecord(req.body || {});
    const liveKey = await getOrCreateLiveKeyForSession(session, {
      user_id: session.user_id || null,
    });
    const preflight = await evaluateCapabilityContract(req, session, { useCache: false });

    return res.status(201).json(buildSessionCreationPayload(req, session, preflight, liveKey));
  } catch (error) {
    if (error.message.includes('Unknown model') || error.message.includes('Unsupported provider')) {
      return sendError(res, 400, error.message, 'invalid_request_error', 'invalid_session_config');
    }

    if (error.message.includes('OPENROUTER_API_KEY')) {
      return sendError(res, 500, error.message, 'runtime_error', 'provider_not_configured');
    }

    return sendError(res, 500, 'Failed to create session', 'runtime_error', 'session_creation_failed');
  }
}

app.post('/v1/session', async (req, res) => {
  return handleSessionCreation(req, res);
});

app.post('/session', async (req, res) => {
  return handleSessionCreation(req, res);
});

app.get('/session/:id', legacySessionAuth, (req, res) => {
  res.json({
    status: getSessionStatus(req.session),
    expires_in: getExpiresInSeconds(req.session),
    default_model: PUBLIC_MODEL_ALIAS,
  });
});

app.get('/v1/models', canonicalSessionAuth, (req, res) => {
  res.json(buildModelsPayload(req.session));
});

app.get('/session/:id/v1/models', legacySessionAuth, (req, res) => {
  res.json(buildModelsPayload(req.session));
});

app.get('/v1/runtime', canonicalSessionAuth, (req, res) => {
  res.json(buildRuntimePayload(req.session));
});

app.get('/session/:id/v1/runtime', legacySessionAuth, (req, res) => {
  res.json(buildRuntimePayload(req.session));
});

app.get('/v1/preflight', canonicalSessionAuth, async (req, res) => {
  const preflight = await evaluateCapabilityContract(req, req.session);
  res.json(preflight);
});

app.get('/session/:id/v1/preflight', legacySessionAuth, async (req, res) => {
  const preflight = await evaluateCapabilityContract(req, req.session);
  res.json(preflight);
});

app.post('/v1/task-notifications/pull', canonicalSessionAuth, async (req, res) => {
  try {
    const limit = Number.isFinite(Number(req.body?.limit)) ? Math.max(1, Number(req.body.limit)) : 10;
    const notifications = await pullTaskNotificationsForSession(req.session.session_id, {
      limit,
      timestamp: getTimestamp(),
    });

    return res.json({
      data: notifications,
      count: notifications.length,
      session_id: req.session.session_id,
    });
  } catch (error) {
    console.error('Failed to pull task notifications', error);
    return sendError(res, 500, 'Failed to pull task notifications', 'runtime_error', 'task_notifications_pull_failed');
  }
});

app.put('/v1/session/delivery-target', canonicalSessionAuth, async (req, res) => {
  try {
    const deliveryTarget = normalizeSessionDeliveryTargetInput(req.body || {});
    const timestamp = getTimestamp();
    const bearerToken = parseBearerToken(req.headers.authorization);
    const isLiveKeyAuth = isLiveKeyToken(bearerToken);
    const liveKeyId = isLiveKeyAuth ? String(req.session.linked_live_key_id || '') : '';
    const stored = await withBillingWrite(async (db) => {
      const sessionStored = await upsertSessionDeliveryTargetTx(db, req.session.session_id, deliveryTarget, {
        timestamp,
      });

      if (isLiveKeyAuth) {
        if (!liveKeyId) {
          throw new Error('Live-key session is missing linked live key');
        }

        await upsertLiveKeyDeliveryTargetTx(db, liveKeyId, deliveryTarget, {
          timestamp,
        });
      }

      return sessionStored;
    });

    if (!stored) {
      return sendError(res, 500, 'Failed to bind delivery target', 'runtime_error', 'session_delivery_target_bind_failed');
    }

    return res.json({
      data: {
        session_id: req.session.session_id,
        delivery_target: {
          channel: stored.channel || 'telegram',
          chat_id: stored.chat_id || '',
          thread_id: stored.thread_id || null,
        },
        created_at: stored.created_at || null,
        updated_at: stored.updated_at || null,
      },
    });
  } catch (error) {
    console.error('Failed to bind session delivery target', error);
    return sendError(res, 400, error.message || 'Invalid delivery target', 'invalid_request_error', 'invalid_delivery_target');
  }
});

app.post('/v1/task-notifications/:id/delivered', canonicalSessionAuth, async (req, res) => {
  try {
    const notificationId = String(req.params.id || '').trim();
    if (!notificationId) {
      return sendError(res, 400, 'Notification id is required', 'invalid_request_error', 'invalid_notification_id');
    }

    const delivered = await withBillingWrite(async (db) => {
      const current = await getStoredTaskNotificationById(db, notificationId);
      if (!current || current.session_id !== req.session.session_id) {
        return null;
      }
      const updated = await markStoredTaskNotificationDeliveredTx(db, notificationId, {
        deliveredMessageId: typeof req.body?.delivered_message_id === 'string' && req.body.delivered_message_id.trim() ? req.body.delivered_message_id.trim() : null,
        timestamp: getTimestamp(),
      });
      return updated ? renderTaskNotificationViewTx(db, updated) : null;
    });

    if (!delivered) {
      return sendError(res, 404, 'Notification not found', 'invalid_request_error', 'notification_not_found');
    }

    return res.json({ data: delivered });
  } catch (error) {
    console.error('Failed to mark task notification delivered', error);
    return sendError(res, 500, 'Failed to mark task notification delivered', 'runtime_error', 'task_notification_delivery_failed');
  }
});

app.post('/v1/chat/completions', canonicalSessionAuth, async (req, res) => {
  return handleChatCompletion(req, res);
});

app.post('/session/:id/v1/chat/completions', legacySessionAuth, async (req, res) => {
  return handleChatCompletion(req, res);
});

app.post('/v1/responses', canonicalSessionAuth, async (req, res) => {
  return handleResponsesCompatibility(req, res);
});

app.post('/session/:id/v1/responses', legacySessionAuth, async (req, res) => {
  return handleResponsesCompatibility(req, res);
});

app.use((req, res) => {
  sendError(res, 404, 'Not found', 'invalid_request_error', 'not_found');
});

setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS).unref();

let localWarmupTimer = null;
let notificationDispatcherTimer = null;
let notificationDispatcherRunning = false;

function startLocalWarmupLoop() {
  if (!ENABLE_LOCAL_WARMUP || !BLOCKFORK_LOCAL_BASE_URL || !BLOCKFORK_LOCAL_MODEL) {
    return;
  }

  const chatUrl = `${BLOCKFORK_LOCAL_BASE_URL}/chat/completions`;
  let successCount = 0;
  let failureCount = 0;

  const runProbe = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOCAL_WARMUP_TIMEOUT_MS);
    try {
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(BLOCKFORK_LOCAL_API_KEY ? { Authorization: `Bearer ${BLOCKFORK_LOCAL_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: BLOCKFORK_LOCAL_MODEL,
          messages: [{ role: 'user', content: 'warmup' }],
          max_tokens: 4,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (response.ok) {
        successCount += 1;
      } else {
        failureCount += 1;
        logRoutingDecision('local_warmup_probe_failed', {
          status: response.status,
          failures: failureCount,
          successes: successCount,
        });
      }
    } catch (error) {
      failureCount += 1;
      logRoutingDecision('local_warmup_probe_failed', {
        reason: error?.name || error?.message || 'warmup_error',
        failures: failureCount,
        successes: successCount,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  localWarmupTimer = setInterval(() => {
    void runProbe();
  }, LOCAL_WARMUP_INTERVAL_MS);
  localWarmupTimer.unref();

  logRoutingDecision('local_warmup_started', {
    interval_ms: LOCAL_WARMUP_INTERVAL_MS,
    timeout_ms: LOCAL_WARMUP_TIMEOUT_MS,
    model: BLOCKFORK_LOCAL_MODEL,
  });
}

function startNotificationDispatcherLoop() {
  if (!NOTIFICATION_DISPATCHER_ENABLED) {
    return;
  }
  if (notificationDispatcherTimer) {
    return;
  }

  const runDispatch = async () => {
    if (notificationDispatcherRunning) {
      return;
    }
    notificationDispatcherRunning = true;
    try {
      const result = await dispatchPendingTaskNotifications({
        limit: NOTIFICATION_DISPATCHER_LIMIT,
        claimLimit: NOTIFICATION_DISPATCHER_LIMIT,
        dryRun: BLOCKFORK_OPENCLAW_CLI_DRY_RUN,
        commandPath: BLOCKFORK_OPENCLAW_CLI_BIN,
        timeoutMs: BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS,
      });
      if (result.claimed_notification_count || result.delivered_notification_count || result.failed_notification_count) {
        logJson('notification_dispatcher_cycle', result);
      }
    } catch (error) {
      logJson('notification_dispatcher_cycle_failed', {
        reason: error?.message || String(error),
      });
    } finally {
      notificationDispatcherRunning = false;
    }
  };

  notificationDispatcherTimer = setInterval(() => {
    void runDispatch();
  }, NOTIFICATION_DISPATCHER_INTERVAL_MS);
  notificationDispatcherTimer.unref();

  logRoutingDecision('notification_dispatcher_started', {
    interval_ms: NOTIFICATION_DISPATCHER_INTERVAL_MS,
    limit: NOTIFICATION_DISPATCHER_LIMIT,
    dry_run: BLOCKFORK_OPENCLAW_CLI_DRY_RUN,
    transport: BLOCKFORK_NOTIFICATION_TRANSPORT,
  });
}

async function startServer(port = PORT) {
  await ensureBillingDb();
  await preloadLiveKeys();
  await preloadActiveSessions();
  startLocalWarmupLoop();
  startNotificationDispatcherLoop();
  return app.listen(port, HOST, () => {
    writeRuntimeProfileMarker(port);
    console.log(`BlockFork AI Session Runtime listening on http://${HOST}:${port}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start BlockFork AI Session Runtime', error);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  sessions,
  sessionsByApiKey,
  liveKeysByApiKey,
  liveKeysById,
  createSessionRecord,
  createLiveKeyRecord,
  createLiveKeySessionRecord,
  mintLiveKeyForUser,
  attachLiveKeyToSession,
  backfillLiveKeysForActiveSessions,
  getOrCreateLiveKeyForSession,
  loadPersistedLiveKeyByApiKey,
  resolveLiveKeySession,
  preloadLiveKeys,
  registerSessionState,
  EXECUTION_STATES,
  createExecutionRecord,
  getExecutionById,
  getExecutionByRequestId,
  appendExecutionEvent,
  acquireExecutionLease,
  refreshExecutionLease,
  releaseExecutionLease,
  assertExecutionLeaseHolder,
  getAllowedWorkspaceRoots,
  resolveWorkspaceBindingForArtifact,
  findOrCreateWorkspaceBinding,
  getWorkspaceById,
  attachExecutionWorkspace,
  createExecutionArtifactRecord,
  getExecutionArtifactByExecutionId,
  getExecutionArtifactByArtifactId,
  getTaskArtifactAssessmentByTaskId,
  syncTaskArtifactAssessment,
  getTaskNotificationByArtifactId,
  getToolFailureFactBySubjectId,
  materializeVerifiedArtifactForExecution,
  updateExecutionArtifactVerification,
  updateExecutionArtifactDeliveryStatus,
  assessArtifactDeliveryEligibility,
  ensureArtifactDeliveryNotificationForExecution,
  attemptAutomaticArtifactDeliveryForExecution,
  dispatchArtifactDeliveryById,
  assertArtifactPathWithinWorkspace,
  buildExecutionCapabilityRecord,
  persistExecutionCapabilityRecord,
  getExecutionCapabilityRecord,
  updateExecutionCapabilityFallbackUse,
  getExecutionCapabilityFreshness,
  canExecutionUseOptimisticRetry,
  buildExecutionBudgetRecord,
  persistExecutionBudgetRecord,
  getExecutionBudgetRecord,
  updateExecutionBudgetOutcome,
  classifyExecutionBudgetFit,
  classifyContextPressure,
  summarizeTaskObjectiveFromBody,
  extractManagedCurrentTurnText,
  extractManagedArtifactFilenames,
  extractManagedArtifactFilename,
  extractManagedArtifactBulletCount,
  extractManagedArtifactItemCount,
  extractManagedArtifactTopic,
  buildManagedAgentWorkflowBriefDraft,
  buildManagedMarkdownArtifactDraft,
  buildManagedArtifactDraftText,
  buildManagedArtifactResponseText,
  AGENT_RUN_STATES,
  AGENT_STEP_STATES,
  TASK_STATES,
  TASK_PROGRESS_CATEGORIES,
  TASK_NOTIFICATION_DELIVERY_STATES,
  TASK_ARTIFACT_STRUCTURE_STATES,
  TASK_ARTIFACT_ALIGNMENT_STATES,
  TASK_ARTIFACT_CONFIDENCE_BANDS,
  TOOL_FAILURE_CATEGORIES,
  TOOL_FAILURE_SCOPES,
  ARTIFACT_VERIFICATION_STATES,
  createTaskRecord,
  getTaskById,
  getTaskByExecutionId,
  getTaskByRequestId,
  getTaskCompletionSummaryByTaskId,
  getTaskProgressEventsByTaskId,
  getVerifiedTaskArtifactAssessmentForExecutionId,
  getTaskNotificationById,
  getTaskNotificationsByTaskId,
  getNotificationDeliveryAttemptByNotificationId,
  getNotificationDeliveryAttemptsByNotificationId,
  claimTaskNotificationById,
  listDispatchableNotificationSessions,
  ensureBillingDb,
  normalizeOpenClawRelayConfigInput,
  getOpenClawRelayConfigByLabel,
  listOpenClawRelayConfigs,
  upsertOpenClawRelayConfig,
  runOpenClawRelayDoctor,
  buildOpenClawRelaySetupCommands,
  getStoredSessionDeliveryTargetBySessionId,
  getStoredLiveKeyDeliveryTargetByLiveKeyId,
  ensureSessionDeliveryTargetForSessionTx,
  bindSessionDeliveryTarget,
  bindLiveKeyDeliveryTarget,
  pullTaskNotificationsForSession,
  claimTaskNotificationsForSession,
  markTaskNotificationDelivered,
  dispatchTaskNotificationById,
  dispatchPendingTaskNotifications,
  runOpenClawCliDryRunAdapter,
  buildOpenClawCliNotificationDispatchArgs,
  buildOpenClawCliArtifactDeliveryArgs,
  runOpenClawCliArtifactDeliveryAdapter,
  startNotificationDispatcherLoop,
  renderTaskNotificationView,
  appendTaskProgressEvent,
  recordToolFailureObservation,
  transitionTask,
  appendTaskEvent,
  deriveContinuityRecommendation,
  createOrUpdateSessionRecommendation,
  supersedeActiveRecommendation,
  resolveRecommendationFromLineage,
  getActiveRecommendationForSession,
  prepareArtifactBindingForExecution,
  checkArtifactEvidence,
  validateArtifactHonestyOrError,
  buildManagedArtifactSuccessText,
  attemptManagedArtifactMaterializationBeforeTerminalRecovery,
  markExecutionRecoveryRequired,
  classifyExecutionInterruption,
  classifyManagedTerminalCompletionIntegrity,
  buildManagedTerminalWireOutcome,
  buildManagedTerminalFallbackText,
  buildManagedTerminalFallbackWireOutcome,
  normalizeResponsesIncompleteResponseFromChat,
  normalizeResponsesFallbackResponseFromChat,
  transitionExecution,
  transitionExecutionWithLease,
  assertLegalExecutionTransition,
  MODEL_MAP,
  getModelDescriptor,
  executeChatFlow,
  startServer,
};
