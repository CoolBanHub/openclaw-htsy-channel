const tokenCache = new Map();
const inboundBotCache = new Map();

function joinUrl(endpoint, path) {
  return new URL(path, endpoint.endsWith("/") ? endpoint : `${endpoint}/`).toString();
}

async function postJson(url, body, timeoutSec, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutSec) * 1000);
  try {
    const headers = {
      "content-type": "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`invalid JSON response from ${url}: ${text.slice(0, 300)}`);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} calling ${url}: ${JSON.stringify(json)}`);
    }
    if (json?.code !== 0) {
      throw new Error(`API code=${json?.code ?? "?"}: ${json?.message ?? "unknown"}`);
    }
    return json?.data ?? {};
  } finally {
    clearTimeout(timer);
  }
}

function tokenCacheKey(account) {
  return `${account.endpoint}::${account.appId}::${account.appSecret}`;
}

export async function getAccessToken(account) {
  const key = tokenCacheKey(account);
  const now = Date.now();
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAtMs > now + 30_000) {
    return cached.token;
  }

  const data = await postJson(
    joinUrl(account.endpoint, "/api/get_access_token"),
    {
      appid: account.appId,
      appSecret: account.appSecret,
    },
    account.httpTimeoutSec,
  );

  const token = String(data?.accessToken ?? "").trim();
  if (!token) {
    throw new Error("empty accessToken from /api/get_access_token");
  }
  const expireTimeMs = Number(data?.expireTime ?? 0);
  const expiresAtMs = Number.isFinite(expireTimeMs) && expireTimeMs > 0
    ? expireTimeMs
    : now + 3600 * 1000;

  tokenCache.set(key, { token, expiresAtMs });
  return token;
}

export function rememberInboundBotContext(params) {
  const botWxid = String(params?.botWxid ?? "").trim();
  const botType = Number(params?.botType ?? 0);
  if (!botWxid || !Number.isFinite(botType) || botType <= 0) {
    return;
  }
  const now = Date.now();
  const keys = [params.targetWxid, params.conversationId, params.senderWxid]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  for (const key of keys) {
    inboundBotCache.set(key, { botWxid, botType, updatedAt: now });
  }
}

export function resolveOutboundBotContext(params) {
  const keys = [params.targetWxid, params.conversationId]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  for (const key of keys) {
    const cached = inboundBotCache.get(key);
    if (cached && Date.now() - cached.updatedAt < 24 * 3600 * 1000) {
      return cached;
    }
  }

  const fallbackBotType = Number(params?.defaultBotType ?? 0);
  if (Number.isFinite(fallbackBotType) && fallbackBotType > 0) {
    return { botType: fallbackBotType };
  }
  return null;
}

export async function sendTextMessage(params) {
  const token = await getAccessToken(params.account);
  const data = await postJson(
    joinUrl(params.account.endpoint, "/api/htsy/msg/send"),
    {
      authorizerUserId: params.account.authorizerUserId,
      wxid: params.targetWxid,
      botWxid: params.botWxid,
      botType: params.botType,
      msg: {
        msgType: "text",
        text: {
          content: params.content,
        },
      },
    },
    params.account.httpTimeoutSec,
    token,
  );

  return String(data?.traceId ?? "");
}

function pickString(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null) {
      const text = String(value).trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function pickNumber(obj, keys) {
  for (const key of keys) {
    const value = Number(obj?.[key]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

function normalizeQwCdn(cdn) {
  return {
    aesKey: pickString(cdn, ["aesKey", "aes_key"]),
    fileId: pickString(cdn, ["fileId", "file_id"]),
    size: pickNumber(cdn, ["size"]),
    url: pickString(cdn, ["url"]),
    authKey: pickString(cdn, ["authKey", "auth_key"]),
    fileName: pickString(cdn, ["fileName", "file_name"]),
    md5: pickString(cdn, ["md5"]),
  };
}

export async function downloadCdnMaterial(params) {
  const token = await getAccessToken(params.account);
  const data = await postJson(
    joinUrl(params.account.endpoint, "/api/htsy/material/cdnDownload"),
    {
      authorizerUserId: params.account.authorizerUserId,
      cdnType: Number(params.cdnType ?? 0),
      qwCdn: normalizeQwCdn(params.cdn ?? {}),
      msgType: String(params.msgType ?? "").trim(),
      wxid: String(params.wxid ?? "").trim(),
      botType: Number(params.botType ?? 0),
    },
    params.account.httpTimeoutSec,
    token,
  );

  return data;
}

function tryDecodeBase64(input) {
  const compact = String(input ?? "").replace(/\s+/g, "");
  if (!compact) {
    return null;
  }
  if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) {
    return null;
  }
  const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    return Buffer.from(padded, "base64");
  } catch {
    return null;
  }
}

export function decodeCdnDownloadData(raw) {
  let text = "";
  if (typeof raw === "string") {
    text = raw.trim();
  } else if (raw && typeof raw === "object") {
    text = pickString(raw, ["data", "content", "base64", "result"]);
  }
  if (!text) {
    throw new Error("empty cdn download data");
  }

  if (text.startsWith("data:")) {
    const splitAt = text.indexOf(",");
    if (splitAt > 0) {
      const header = text.slice(0, splitAt).toLowerCase();
      const payload = text.slice(splitAt + 1);
      if (header.includes(";base64")) {
        const decoded = tryDecodeBase64(payload);
        if (decoded && decoded.length > 0) {
          return decoded;
        }
      }
      return Buffer.from(payload);
    }
  }

  const decoded = tryDecodeBase64(text);
  if (decoded && decoded.length > 0) {
    return decoded;
  }

  return Buffer.from(text);
}
