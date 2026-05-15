const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ENV_FILE = '.env';
const REQUESTED_ENV_FILE = (process.env.ENV_FILE || DEFAULT_ENV_FILE).trim() || DEFAULT_ENV_FILE;
const RESOLVED_ENV_FILE = path.resolve(process.cwd(), REQUESTED_ENV_FILE);

if (process.env.ENV_FILE && !fs.existsSync(RESOLVED_ENV_FILE)) {
  throw new Error(`ENV_FILE not found: ${process.env.ENV_FILE}`);
}

require('dotenv').config({ path: RESOLVED_ENV_FILE });

const express = require('express');
const fetch = require('node-fetch');
const initSqlJs = require('sql.js');

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

function createContinuityEventId() {
  return `${CONTINUITY_EVENT_ID_PREFIX}${crypto.randomUUID()}`;
}

function createSessionLineageId() {
  return `${SESSION_LINEAGE_ID_PREFIX}${crypto.randomUUID()}`;
}

function createContinuityRecommendationId() {
  return `${CONTINUITY_RECOMMENDATION_ID_PREFIX}${crypto.randomUUID()}`;
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

    const updateLiveKey = database.prepare(`
      UPDATE live_keys
      SET last_session_id = ?
      WHERE id = ?
    `);
    updateLiveKey.run([session.session_id, liveKey.id]);
    updateLiveKey.free();

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
          SET updated_at = ?, last_request_id = ?
          WHERE execution_id = ?
        `);
        updateExisting.run([
          options.timestamp || getTimestamp(),
          options.requestId || existing.last_request_id || '',
          existing.execution_id,
        ]);
        updateExisting.free();
        return {
          execution: {
            ...existing,
            updated_at: options.timestamp || getTimestamp(),
            last_request_id: options.requestId || existing.last_request_id || '',
          },
          reused: true,
        };
      }
    }

    const executionId = createExecutionId();
    const timestamp = options.timestamp || getTimestamp();
    const insert = db.prepare(`
      INSERT INTO executions (
        execution_id, session_id, current_state, created_at, updated_at, last_request_id, idempotency_key, workspace_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      executionId,
      sessionId,
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
    SELECT id, key, user_id, created_at, last_session_id, budget_limit
    FROM live_keys
    ORDER BY created_at DESC
  `);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      id: String(row.id || ''),
      key: String(row.key || ''),
      user_id: row.user_id || null,
      created_at: toIsoTimestamp(row.created_at),
      last_session_id: row.last_session_id || null,
      budget_limit: row.budget_limit === null || row.budget_limit === undefined || row.budget_limit === ''
        ? null
        : Number(row.budget_limit),
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
    instructions: [
      'Set base_url in OpenClaw',
      'Paste API key',
      'Use model: managed',
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

async function createExecutionArtifactRecord(options = {}) {
  return withBillingWrite(async (db) => {
    const executionId = String(options.executionId || '');
    const workspaceId = String(options.workspaceId || '');
    if (!executionId || !workspaceId) {
      throw new Error('Artifact record requires executionId and workspaceId');
    }

    const current = await getStoredExecutionArtifactByExecutionId(db, executionId);
    const timestamp = options.timestamp || getTimestamp();
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
        deliveryRequested,
        deliveryConfirmed,
        timestamp,
        executionId,
      ]);
      update.free();
      return {
        ...current,
        declared_path: options.declaredPath,
        canonical_path: options.canonicalPath,
        verification_state: options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING,
        reason_code: options.reasonCode || '',
        delivery_requested: deliveryRequested,
        delivery_confirmed: deliveryConfirmed,
        updated_at: timestamp,
      };
    }

    const artifactId = createExecutionArtifactId();
    const insert = db.prepare(`
      INSERT INTO execution_artifacts (
        artifact_id, execution_id, workspace_id, declared_path, canonical_path, verification_state,
        reason_code, delivery_requested, delivery_confirmed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      artifactId,
      executionId,
      workspaceId,
      options.declaredPath,
      options.canonicalPath,
      options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING,
      options.reasonCode || '',
      deliveryRequested,
      deliveryConfirmed,
      timestamp,
      timestamp,
    ]);
    insert.free();
    return {
      artifact_id: artifactId,
      execution_id: executionId,
      workspace_id: workspaceId,
      declared_path: options.declaredPath,
      canonical_path: options.canonicalPath,
      verification_state: options.verificationState || ARTIFACT_VERIFICATION_STATES.PENDING,
      reason_code: options.reasonCode || '',
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
    const update = db.prepare(`
      UPDATE execution_artifacts
      SET verification_state = ?,
          reason_code = ?,
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
      Number(Boolean(options.deliveryRequested ?? current.delivery_requested)),
      Number(Boolean(options.deliveryConfirmed ?? current.delivery_confirmed)),
      options.canonicalPath || current.canonical_path,
      options.declaredPath || current.declared_path,
      timestamp,
      executionId,
    ]);
    update.free();

    return {
      ...current,
      verification_state: verificationState,
      reason_code: options.reasonCode || '',
      delivery_requested: Number(Boolean(options.deliveryRequested ?? current.delivery_requested)),
      delivery_confirmed: Number(Boolean(options.deliveryConfirmed ?? current.delivery_confirmed)),
      canonical_path: options.canonicalPath || current.canonical_path,
      declared_path: options.declaredPath || current.declared_path,
      updated_at: timestamp,
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

  if (options.executionId) {
    await updateExecutionArtifactVerification(options.executionId, ARTIFACT_VERIFICATION_STATES.VERIFIED, {
      reasonCode: '',
      deliveryRequested: evidenceCheck.delivery_requested,
      deliveryConfirmed: evidenceCheck.delivery_confirmed,
      canonicalPath: evidenceCheck.canonical_path,
      declaredPath: evidenceCheck.declared_path,
    });
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
  const executionResult = await createExecutionRecord({
    sessionId: session.session_id,
    requestId,
    idempotencyKey: options.idempotencyKey || '',
    actorSource: 'runtime',
    reasonCode: 'request_admitted',
  });
  const execution = executionResult.execution;
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

async function proxyNonStreamingChat(res, session, descriptor, upstream, billing = null, responseAlias = PUBLIC_MODEL_ALIAS) {
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
  return {
    payload: normalizeChatCompletionResponse(payload, responseAlias),
    usage,
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
    let classification = classifyExecutionInterruption({
      status,
      errorCode: details.errorCode || '',
      meaningfulOutputStarted: state.meaningfulOutputStarted,
    });
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

  upstream.body.on('end', () => {
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
    let classification = classifyExecutionInterruption({
      status,
      errorCode: details.errorCode || '',
      meaningfulOutputStarted: state.meaningfulOutputStarted,
    });
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

  upstream.body.on('end', () => {
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

    writeHeadersIfNeeded();
    sendCreatedIfNeeded();
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

  const responseResult = await proxyNonStreamingChat(res, req.session, descriptor, upstream, billing, responseAlias);
  if (responseResult === undefined) {
    return undefined;
  }
  const responsePayload = responseResult.payload;

  const assistantText = stringifyTextContent(responsePayload?.choices?.[0]?.message?.content ?? '');
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

async function startServer(port = PORT) {
  await ensureBillingDb();
  await preloadLiveKeys();
  await preloadActiveSessions();
  startLocalWarmupLoop();
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
  updateExecutionArtifactVerification,
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
  deriveContinuityRecommendation,
  createOrUpdateSessionRecommendation,
  supersedeActiveRecommendation,
  resolveRecommendationFromLineage,
  getActiveRecommendationForSession,
  prepareArtifactBindingForExecution,
  checkArtifactEvidence,
  validateArtifactHonestyOrError,
  markExecutionRecoveryRequired,
  classifyExecutionInterruption,
  transitionExecution,
  transitionExecutionWithLease,
  assertLegalExecutionTransition,
  MODEL_MAP,
  getModelDescriptor,
  executeChatFlow,
  startServer,
};
