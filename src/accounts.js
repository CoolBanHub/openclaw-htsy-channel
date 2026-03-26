const CHANNEL_ID = "htsy_open";
const DEFAULT_ENDPOINT = "https://htsy.cpshelp.cn";
const DEFAULT_WEBHOOK_PATH = "/htsy-open/callback";
const DEFAULT_ACCOUNT_ID = "default";

function asString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveAccount(cfg, accountId) {
  const section = cfg?.channels?.[CHANNEL_ID] ?? {};
  return {
    accountId: accountId ?? DEFAULT_ACCOUNT_ID,
    enabled: section.enabled !== false,
    endpoint: asString(section.endpoint, DEFAULT_ENDPOINT),
    appId: asString(section.appId),
    appSecret: asString(section.appSecret),
    authorizerUserId: asString(section.authorizerUserId),
    webhookPath: asString(section.webhookPath, DEFAULT_WEBHOOK_PATH),
    httpTimeoutSec: Math.max(1, Math.min(1000, asNumber(section.httpTimeoutSec, 60))),
    downloadDir: asString(section.downloadDir),
    defaultBotType: Math.max(0, asNumber(section.defaultBotType, 0)),
    dmPolicy: asString(section.dmPolicy, "allowlist"),
    allowFrom: Array.isArray(section.allowFrom)
      ? section.allowFrom.map((v) => String(v).trim()).filter(Boolean)
      : [],
  };
}

export function listAccountIds() {
  return [DEFAULT_ACCOUNT_ID];
}

export function defaultAccountId() {
  return DEFAULT_ACCOUNT_ID;
}

export function isConfigured(account) {
  return Boolean(account.appId && account.appSecret && account.authorizerUserId);
}

export function describeAccount(account) {
  return {
    accountId: account.accountId,
    enabled: account.enabled,
    configured: isConfigured(account),
    webhookPath: account.webhookPath,
  };
}

export function applySetupConfig(cfg, input) {
  const current = cfg ?? {};
  const channels = { ...(current.channels ?? {}) };
  const section = { ...(channels[CHANNEL_ID] ?? {}) };

  if (typeof input?.webhookPath === "string" && input.webhookPath.trim()) {
    section.webhookPath = input.webhookPath.trim();
  }
  if (typeof input?.httpUrl === "string" && input.httpUrl.trim()) {
    section.endpoint = input.httpUrl.trim();
  }

  channels[CHANNEL_ID] = {
    enabled: true,
    ...section,
  };

  return {
    ...current,
    channels,
  };
}
