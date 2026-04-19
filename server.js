const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch');
const initSqlJs = require('sql.js');

const app = express();

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3100);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
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
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const NON_STREAM_TIMEOUT_MS = 8 * 1000;
const STREAM_ESTABLISH_TIMEOUT_MS = 8 * 1000;
const STREAM_IDLE_TIMEOUT_MS = 15 * 1000;
const CONTRACT_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_PROVIDER = process.env.BLOCKFORK_DEFAULT_PROVIDER || 'openrouter';
const DEFAULT_MODEL_IDENTIFIER = process.env.BLOCKFORK_DEFAULT_MODEL || 'managed';
const DEFAULT_UPSTREAM_MODEL = 'google/gemma-4-31b-it:free';
const FALLBACK_MODEL_IDENTIFIER = process.env.BLOCKFORK_FALLBACK_MODEL || 'openai/gpt-4o-mini';
const ALLOW_MODEL_OVERRIDE = /^(1|true|yes)$/i.test(process.env.BLOCKFORK_ALLOW_MODEL_OVERRIDE || '');
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const FORCE_PRIMARY_429 = !IS_PRODUCTION && /^(1|true|yes)$/i.test(process.env.BLOCKFORK_FORCE_PRIMARY_429 || '');
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
  managed: {
    upstreamId: DEFAULT_UPSTREAM_MODEL,
    contextWindow: 262144,
    maxTokens: 8192,
    capabilities: ['chat'],
  },
  'bf/free-120b': {
    upstreamId: DEFAULT_UPSTREAM_MODEL,
    contextWindow: 262144,
    maxTokens: 8192,
    capabilities: ['chat'],
  },
  'bf/gemma-31b-free': {
    upstreamId: DEFAULT_UPSTREAM_MODEL,
    contextWindow: 262144,
    maxTokens: 8192,
    capabilities: ['chat'],
  },
  'openai/gpt-4o-mini': {
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
const publicDir = __dirname;
const UPSTREAM_ERROR_BODY_LIMIT_BYTES = 2 * 1024;
const ADMIN_SECRET_HEADER = 'x-admin-secret';
const PUBLIC_MODEL_ALIAS = DEFAULT_MODEL_IDENTIFIER;
const RUNTIME_DISCOVERY_LIVE_KEY_USER_ID = 'blockfork-runtime-discovery';

let sqlPromise = null;
let billingDb = null;
let billingWriteChain = Promise.resolve();

app.use(express.json({ limit: '1mb' }));
app.use('/assets', express.static(path.join(publicDir, 'assets')));
app.use('/styles.css', express.static(path.join(publicDir, 'styles.css')));

function createRequestId() {
  return crypto.randomUUID();
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

function getDescriptorRatePer1K(descriptor) {
  return Number(descriptor?.ratePer1k ?? BILLING_RATE_PER_1K) || 0;
}

function estimateCostForDescriptor(descriptor, inputTokens, outputTokens) {
  const ratePer1k = getDescriptorRatePer1K(descriptor);
  return ((Number(inputTokens) + Number(outputTokens)) / 1000) * ratePer1k;
}

function getFallbackModelDescriptor() {
  return getModelDescriptor(FALLBACK_MODEL_IDENTIFIER);
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

  if (provider !== 'openrouter') {
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
    ['primary_model', "TEXT NOT NULL DEFAULT ''"],
    ['fallback_triggered', 'INTEGER NOT NULL DEFAULT 0'],
    ['failure_reason', "TEXT NOT NULL DEFAULT ''"],
  ];

  for (const [columnName, columnType] of requestLogAlterations) {
    if (!requestLogColumns.has(columnName)) {
      billingDb.run(`ALTER TABLE request_logs ADD COLUMN ${columnName} ${columnType}`);
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
          request_id, timestamp, route, session_id, primary_model, model_used, input_tokens, output_tokens,
          estimated_cost_usd, status, fallback_triggered, failure_reason, endpoint, error_code, status_code, response_body, reserved_cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run([
        entry.request_id,
        entry.timestamp,
        entry.route,
        entry.session_id,
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
        request_id, timestamp, route, session_id, primary_model, model_used, input_tokens, output_tokens,
        estimated_cost_usd, status, fallback_triggered, failure_reason, endpoint, error_code, status_code, response_body, reserved_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run([
      entry.request_id,
      entry.timestamp,
      entry.route,
      entry.session_id,
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
           estimated_cost_usd, status, fallback_triggered, failure_reason, endpoint, error_code, status_code, response_body
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
  const providerConfig = getProviderConfig(session);
  if (!providerConfig || !providerConfig.apiKey) {
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
    const response = await fetch(OPENROUTER_MODELS_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey}`,
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

function getProviderConfig(session) {
  if (session.provider !== 'openrouter') {
    return null;
  }

  return {
    chatUrl: OPENROUTER_CHAT_URL,
    apiKey: session.upstream_api_key,
  };
}

async function fetchUpstreamChat(session, descriptor, upstreamBody, isStreaming, requestId, extra = {}) {
  const providerConfig = getProviderConfig(session);
  if (!providerConfig || !providerConfig.apiKey) {
    return { error: { statusCode: 500, message: 'Provider configuration is incomplete', type: 'runtime_error', code: 'provider_not_configured' } };
  }

  const upstreamContext = buildUpstreamLogContext(session, descriptor, upstreamBody, providerConfig.chatUrl, requestId, extra);
  logUpstreamRequest(upstreamContext);

  const controller = new AbortController();
  const timeoutMs = isStreaming ? STREAM_ESTABLISH_TIMEOUT_MS : NON_STREAM_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (FORCE_PRIMARY_429 && extra.attempt === 'primary') {
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

      return { upstream, upstreamContext };
    }

    const upstream = await fetch(providerConfig.chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerConfig.apiKey}`,
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

  const providerConfig = getProviderConfig(session);
  if (!providerConfig || !providerConfig.apiKey) {
    return { error: { statusCode: 500, message: 'Provider configuration is incomplete', type: 'runtime_error', code: 'provider_not_configured' } };
  }

  const { descriptor: primaryDescriptor, error } = normalizeModelForSession(session, body.model);
  if (error) {
    return { error: { statusCode: 400, message: error, type: 'invalid_request_error', code: 'unsupported_model' } };
  }

  const fallbackDescriptor = getFallbackModelDescriptor();
  if (!fallbackDescriptor) {
    return { error: { statusCode: 500, message: 'Fallback model is unavailable', type: 'runtime_error', code: 'fallback_model_unavailable' } };
  }

  const primaryUpstreamBody = buildUpstreamBody(body, primaryDescriptor);
  const fallbackUpstreamBody = buildUpstreamBody(body, fallbackDescriptor);
  const requestId = createRequestId();
  const timestamp = getTimestamp();
  const estimated = estimateRequestTokens(body);
  const primaryEstimatedCost = estimateCostForDescriptor(primaryDescriptor, estimated.inputTokens, estimated.outputTokens);
  const fallbackEstimatedCost = estimateCostForDescriptor(fallbackDescriptor, estimated.inputTokens, estimated.outputTokens);
  const reservedCostUsd = Math.max(primaryEstimatedCost, fallbackEstimatedCost);
  const route = options.route || 'chat/completions';
  const reservation = await reserveBillingBudget({
    request_id: requestId,
    timestamp,
    route,
    session_id: session.session_id,
    primary_model: primaryDescriptor.upstreamId,
    model_used: primaryDescriptor.upstreamId,
    input_tokens: estimated.inputTokens,
    reserved_cost_usd: reservedCostUsd,
    endpoint: providerConfig.chatUrl,
  });

  if (!reservation.accepted) {
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
        timestamp,
        route,
        reserved: false,
        reserved_cost_usd: reservedCostUsd,
        primary_model: primaryDescriptor.upstreamId,
        model_used: primaryDescriptor.upstreamId,
        fallback_triggered: false,
        failure_reason: reservation.reason || 'credit_limit_exceeded',
        cost_descriptor: primaryDescriptor,
      },
    };
  }

  const responseAlias = PUBLIC_MODEL_ALIAS;
  const isStreaming = Boolean(body.stream);
  const primaryAttempt = await fetchUpstreamChat(session, primaryDescriptor, primaryUpstreamBody, isStreaming, requestId, {
    attempt: 'primary',
    primary_model: primaryDescriptor.upstreamId,
    fallback_model_used: false,
  });

  const primaryFailureReason = primaryAttempt.error
    ? failureReasonFromFetchError(primaryAttempt.error)
    : (primaryAttempt.upstream && !primaryAttempt.upstream.ok
      ? failureReasonFromUpstreamStatus(primaryAttempt.upstream.status)
      : '');

  if (primaryAttempt.error || (primaryAttempt.upstream && !primaryAttempt.upstream.ok)) {
    const canFallback = Boolean(fallbackDescriptor) && (primaryAttempt.error || isRetryableUpstreamStatus(primaryAttempt.upstream.status));
    if (canFallback) {
      const fallbackAttempt = await fetchUpstreamChat(session, fallbackDescriptor, fallbackUpstreamBody, isStreaming, requestId, {
        attempt: 'fallback',
        primary_model: primaryDescriptor.upstreamId,
        fallback_model_used: true,
      });

      const fallbackFailureReason = fallbackAttempt.error
        ? failureReasonFromFetchError(fallbackAttempt.error)
        : (fallbackAttempt.upstream && !fallbackAttempt.upstream.ok
          ? failureReasonFromUpstreamStatus(fallbackAttempt.upstream.status)
          : '');

      if (!fallbackAttempt.error && fallbackAttempt.upstream && fallbackAttempt.upstream.ok) {
        return {
          descriptor: fallbackDescriptor,
          responseAlias,
          upstream: fallbackAttempt.upstream,
          upstreamContext: fallbackAttempt.upstreamContext,
          billing: {
            request_id: requestId,
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
          },
        };
      }

      const finalFailureReason = [primaryFailureReason, fallbackFailureReason].filter(Boolean).join(';') || 'upstream_error';
      await finalizeBillingRequest({
        request_id: requestId,
        timestamp: getTimestamp(),
        route,
        session_id: session.session_id,
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

      return {
        error: fallbackAttempt?.error || { statusCode: 502, message: 'Upstream provider returned an error', type: 'provider_error', code: 'upstream_error' },
        billing: {
          request_id: requestId,
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
        },
      };
    }

    await finalizeBillingRequest({
      request_id: requestId,
      timestamp: getTimestamp(),
      route,
      session_id: session.session_id,
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

    return {
      error: primaryAttempt?.error || { statusCode: 502, message: 'Upstream provider returned an error', type: 'provider_error', code: 'upstream_error' },
        billing: {
          request_id: requestId,
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
        },
      };
  }

  return {
    descriptor: primaryDescriptor,
    responseAlias,
    upstream: primaryAttempt.upstream,
    upstreamContext: primaryAttempt.upstreamContext,
    billing: {
      request_id: requestId,
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
    },
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
    }
    return sendError(res, 502, 'Upstream provider returned an invalid response', 'provider_error', 'upstream_invalid_response');
  }

  const usage = extractUsageTokens(payload?.usage);
  if (billing?.reserved) {
    await finalizeBillingRequest({
      request_id: billing.request_id,
      timestamp: getTimestamp(),
      route: billing.route,
      session_id: session.session_id,
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
  incrementUsage(session, usage.totalTokens);
  return res.status(200).json(normalizeChatCompletionResponse(payload, responseAlias));
}

function proxyStreamingChat(req, res, session, descriptor, upstream, upstreamContext, billing = null, responseAlias = PUBLIC_MODEL_ALIAS) {
  if (!upstream.ok) {
    if (billing?.reserved) {
      void finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: session.session_id,
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
    }
    return sendError(res, 502, 'Upstream provider did not return a stream body', 'provider_error', 'upstream_invalid_response');
  }

  const state = {
    buffer: '',
    pendingTotalTokens: 0,
    pendingInputTokens: 0,
    created: Math.floor(Date.now() / 1000),
    idleTimer: null,
    wroteHeaders: false,
    firstTokenAt: null,
    completed: false,
    billingFinalized: false,
  };

  const finalizeRequest = async (status, details = {}) => {
    if (state.billingFinalized || !billing) {
      return;
    }

    state.billingFinalized = true;
    const inputTokens = Number.isFinite(details.inputTokens) ? details.inputTokens : (billing.input_tokens || 0);
    const outputTokens = Number.isFinite(details.outputTokens)
      ? details.outputTokens
      : Math.max(0, state.pendingTotalTokens - inputTokens);

    await finalizeBillingRequest({
      request_id: billing.request_id,
      timestamp: getTimestamp(),
      route: billing.route,
      session_id: session.session_id,
      primary_model: billing.primary_model || '',
      model_used: billing.model_used,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimateCostForDescriptor(billing.cost_descriptor || descriptor, inputTokens, outputTokens),
      status,
      fallback_triggered: Number(Boolean(billing.fallback_triggered)),
      failure_reason: billing.failure_reason || '',
      endpoint: billing.endpoint || '',
      error_code: details.errorCode || '',
      status_code: details.statusCode || 200,
      response_body: details.responseBody || '',
      reserved_cost_usd: billing.reserved_cost_usd,
    });
  };

  const resetIdleTimer = () => {
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      if (!state.wroteHeaders) {
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
        },
      });
      res.end();
    }, STREAM_IDLE_TIMEOUT_MS);
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
        output += `data: ${JSON.stringify(normalized)}\n`;
      } catch (error) {
        output += `${rawLine}\n`;
      }
    }

    writeHeadersIfNeeded();
    res.write(output);
  });

  upstream.body.on('end', () => {
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

function proxyStreamingResponses(req, res, session, descriptor, upstream, upstreamContext, billing = null, responseAlias = PUBLIC_MODEL_ALIAS) {
  if (!upstream.ok) {
    if (billing?.reserved) {
      void finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: session.session_id,
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
    completed: false,
    billingFinalized: false,
  };

  const finalizeRequest = async (status, details = {}) => {
    if (state.billingFinalized || !billing) {
      return;
    }

    state.billingFinalized = true;
    const inputTokens = Number.isFinite(details.inputTokens) ? details.inputTokens : (billing.input_tokens || 0);
    const outputTokens = Number.isFinite(details.outputTokens)
      ? details.outputTokens
      : Math.max(0, state.pendingTotalTokens - inputTokens);

    await finalizeBillingRequest({
      request_id: billing.request_id,
      timestamp: getTimestamp(),
      route: billing.route,
      session_id: session.session_id,
      primary_model: billing.primary_model || '',
      model_used: billing.model_used,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimateCostForDescriptor(billing.cost_descriptor || descriptor, inputTokens, outputTokens),
      status,
      fallback_triggered: Number(Boolean(billing.fallback_triggered)),
      failure_reason: billing.failure_reason || '',
      endpoint: billing.endpoint || '',
      error_code: details.errorCode || '',
      status_code: details.statusCode || 200,
      response_body: details.responseBody || '',
      reserved_cost_usd: billing.reserved_cost_usd,
    });
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
    }, STREAM_IDLE_TIMEOUT_MS);
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

  const { descriptor, responseAlias, upstream, upstreamContext, billing, error } = await executeChatFlow(req.session, req.body, {
    route: 'chat/completions',
  });
  if (error) {
    if (billing?.reserved && !billing.finalized) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
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
    return proxyStreamingChat(req, res, req.session, descriptor, upstream, upstreamContext, billing, responseAlias);
  }

  return proxyNonStreamingChat(res, req.session, descriptor, upstream, billing, responseAlias);
}

async function handleResponsesCompatibility(req, res) {
  const translated = translateResponsesRequestToChatBody(req.body || {});
  if (translated.error) {
    return sendError(res, translated.error.statusCode, translated.error.message, translated.error.type, translated.error.code);
  }

  const { descriptor, upstream, upstreamContext, billing, error } = await executeChatFlow(req.session, translated.body, {
    route: 'responses',
  });
  if (error) {
    if (billing?.reserved && !billing.finalized) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
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
    return proxyStreamingResponses(req, res, req.session, descriptor, upstream, upstreamContext, billing, PUBLIC_MODEL_ALIAS);
  }

  if (!upstream.ok) {
    if (billing?.reserved) {
      await finalizeBillingRequest({
        request_id: billing.request_id,
        timestamp: getTimestamp(),
        route: billing.route,
        session_id: req.session.session_id,
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
    }
    return sendError(res, 502, 'Upstream provider returned an invalid response', 'provider_error', 'upstream_invalid_response');
  }

  const usage = extractUsageTokens(payload?.usage);
  if (billing?.reserved) {
    await finalizeBillingRequest({
      request_id: billing.request_id,
      timestamp: getTimestamp(),
      route: billing.route,
      session_id: req.session.session_id,
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
  incrementUsage(req.session, payload?.usage?.total_tokens);
  return res.status(200).json(normalizeResponsesResponseFromChat(normalizeChatCompletionResponse(payload, PUBLIC_MODEL_ALIAS), PUBLIC_MODEL_ALIAS));
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

async function startServer(port = PORT) {
  await ensureBillingDb();
  await preloadLiveKeys();
  await preloadActiveSessions();
  return app.listen(port, HOST, () => {
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
  MODEL_MAP,
  startServer,
};
