import os from "node:os";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readJsonWebhookBodyOrReject } from "openclaw/plugin-sdk/webhook-ingress";
import {
  decodeCdnDownloadData,
  downloadCdnMaterial,
  rememberInboundBotContext,
  sendTextMessage,
} from "./client.js";

const CHANNEL_ID = "htsy_open";
const MAX_LOG_LEN = 8_000;

function safeJsonForLog(value) {
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= MAX_LOG_LEN) {
      return raw;
    }
    return `${raw.slice(0, MAX_LOG_LEN)}...(truncated ${raw.length - MAX_LOG_LEN} chars)`;
  } catch (error) {
    return `"<json_serialize_error:${String(error)}>"`;
  }
}

function parseConversationId(conversationId, botWxid = "") {
  const raw = String(conversationId ?? "").trim();
  if (raw.startsWith("R:")) {
    return { kind: "group", id: raw.slice(2) };
  }
  if (raw.startsWith("S:")) {
    const payload = raw.slice(2);
    const bot = String(botWxid ?? "").trim();
    if (bot && payload.startsWith(`${bot}_`)) {
      return { kind: "direct", id: payload.slice(bot.length + 1) };
    }
    const idx = payload.indexOf("_");
    return { kind: "direct", id: idx >= 0 ? payload.slice(idx + 1) : payload };
  }
  return { kind: "direct", id: raw };
}

function resolveInboundText(payload) {
  const type = Number(payload?.type ?? 0);
  const data = payload?.data ?? {};

  if (type === 200 || type === 2001) {
    return String(data?.content ?? "").trim();
  }

  const textByType = {
    201: "[图片]",
    202: "[视频]",
    203: "[音频]",
    204: "[文件]",
    205: "[链接]",
    206: "[表情]",
    207: "[小程序]",
    208: "[视频号]",
    209: "[名片]",
    210: "[红包]",
    211: "[聊天合集]",
  };
  return textByType[type] ?? "";
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
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function resolveMediaKind(payload) {
  const type = Number(payload?.type ?? 0);
  const contentType = Number(payload?.data?.content_type ?? 0);
  const mapByType = {
    2002: "image",
    2003: "video",
    2004: "audio",
    2005: "file",
    201: "image",
    202: "video",
    203: "audio",
    204: "file",
  };
  if (mapByType[type]) {
    return mapByType[type];
  }
  const mapByContentType = {
    101: "image",
    102: "video",
    103: "audio",
    104: "file",
  };
  return mapByContentType[contentType] ?? "";
}

function resolveMsgTypeByMediaKind(kind) {
  const map = {
    image: "image",
    video: "video",
    audio: "audio",
    file: "file",
  };
  return map[kind] ?? "";
}

function extensionByMediaKind(kind) {
  const map = {
    image: ".jpg",
    video: ".mp4",
    audio: ".amr",
    file: ".bin",
  };
  return map[kind] ?? ".bin";
}

function sanitizeFileName(name) {
  const clean = String(name ?? "").trim().replace(/[^\w.-]+/g, "_");
  return clean.replace(/^_+|_+$/g, "").slice(0, 120);
}

function resolveDownloadDir(account) {
  const configured = String(account?.downloadDir ?? "").trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  return path.join(os.homedir(), ".openclaw", "workspace", "htsy-open-downloads");
}

function buildDownloadFileName({ mediaKind, cdn, data }) {
  const sourceName = pickString(cdn, ["file_name", "fileName"]);
  const extFromSource = path.extname(sourceName);
  const ext = extFromSource || extensionByMediaKind(mediaKind);
  const fallback = [
    mediaKind || "media",
    pickString(data, ["server_id", "local_id"]) || String(Date.now()),
  ].join("_");
  const sourceBase = sourceName
    ? sourceName.slice(0, Math.max(0, sourceName.length - extFromSource.length))
    : "";
  const sanitizedBase = sanitizeFileName(sourceBase);
  const base = sanitizedBase || fallback;
  return `${base}${ext}`;
}

async function downloadMediaToLocal({ account, payload }) {
  const data = payload?.data ?? {};
  const cdn = data?.cdn ?? {};
  const mediaKind = resolveMediaKind(payload);
  if (!mediaKind || !cdn || typeof cdn !== "object") {
    return null;
  }

  const msgType = resolveMsgTypeByMediaKind(mediaKind);
  const wxid = pickString(data, ["receiver", "conversation_id"]);
  const botType = Number(payload?.botType ?? 0);
  if (!msgType || !wxid || !Number.isFinite(botType) || botType <= 0) {
    throw new Error(`invalid media download params: msgType=${msgType || "n/a"} wxid=${wxid || "n/a"} botType=${botType}`);
  }

  const raw = await downloadCdnMaterial({
    account,
    cdnType: pickNumber(data, ["cdn_type", "cdnType"]),
    cdn,
    msgType,
    wxid,
    botType,
  });
  let bytes;
  if (raw && typeof raw === "object") {
    const directUrl = pickString(raw, ["url", "downloadUrl"]);
    if (directUrl) {
      const res = await fetch(directUrl);
      if (!res.ok) {
        throw new Error(`download url HTTP ${res.status}`);
      }
      bytes = Buffer.from(await res.arrayBuffer());
    }
  }
  if (!bytes) {
    bytes = decodeCdnDownloadData(raw);
  }
  if (!bytes.length) {
    throw new Error("downloaded media is empty");
  }

  const baseDir = resolveDownloadDir(account);
  const dateDir = new Date().toISOString().slice(0, 10);
  const outDir = path.join(baseDir, dateDir);
  await mkdir(outDir, { recursive: true });
  const fileName = buildDownloadFileName({ mediaKind, cdn, data });
  const outputPath = path.join(outDir, fileName);
  await writeFile(outputPath, bytes);

  return {
    mediaKind,
    outputPath,
    size: bytes.length,
  };
}

function normalizeTarget(raw) {
  let to = String(raw ?? "").trim();
  to = to.replace(/^htsy[_-]?open:/i, "").trim();
  to = to.replace(/^(user|group|channel|conversation|room|dm):/i, "").trim();
  return to;
}

function normalizeAllowFromEntry(raw) {
  const value = normalizeTarget(raw);
  if (!value) {
    return "";
  }
  if (value === "*") {
    return "*";
  }
  return value.replace(/^[SR]:/i, "").trim();
}

function isInboundAllowed({ account, parsedConversation, sender }) {
  const allowFrom = Array.isArray(account?.allowFrom)
    ? account.allowFrom.map(normalizeAllowFromEntry).filter(Boolean)
    : [];
  if (allowFrom.length === 0 || allowFrom.includes("*")) {
    return true;
  }

  const candidates = new Set();
  const conversationId = String(parsedConversation?.id ?? "").trim();
  const senderId = String(sender ?? "").trim();
  if (conversationId) {
    candidates.add(normalizeAllowFromEntry(conversationId));
    if (parsedConversation?.kind === "group") {
      candidates.add(normalizeAllowFromEntry(`R:${conversationId}`));
    } else {
      candidates.add(normalizeAllowFromEntry(`S:${conversationId}`));
    }
  }
  if (parsedConversation?.kind !== "group" && senderId) {
    candidates.add(normalizeAllowFromEntry(senderId));
  }

  for (const candidate of candidates) {
    if (candidate && allowFrom.includes(candidate)) {
      return true;
    }
  }
  return false;
}

export async function handleHtsyOpenWebhook({ req, res, account, channelRuntime, config }) {
  const bodyResult = await readJsonWebhookBodyOrReject({
    req,
    res,
    profile: "post-auth",
    maxBytes: 1024 * 1024,
    timeoutMs: 20_000,
    invalidJsonMessage: "invalid htsy_open callback payload",
  });
  if (!bodyResult.ok) {
    return true;
  }

  const payload = bodyResult.value ?? {};
  const handshake = String(payload?.handshake ?? "").trim();
  const type = Number(payload?.type ?? 0);

  console.info(`[htsy_open] inbound_raw payload=${safeJsonForLog(payload)}`);

  if (handshake || type === 100) {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ handshake }));
    return true;
  }

  const data = payload?.data ?? {};
  const conversationId = String(data?.conversation_id ?? "").trim();
  const sender = String(data?.sender ?? "").trim();
  const senderName = String(data?.sender_name ?? "").trim();
  const receiver = String(data?.receiver ?? "").trim();
  const botWxid = String(payload?.botWxid ?? "").trim();
  let text = resolveInboundText(payload);

  if (botWxid && sender && sender === botWxid) {
    console.info(
      `[htsy_open] inbound_ignored type=${type} reason=self_message sender=${sender} botWxid=${botWxid}`,
    );
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, ignored: true, reason: "self_message" }));
    return true;
  }

  try {
    const downloadResult = await downloadMediaToLocal({ account, payload });
    if (downloadResult) {
      console.info(
        `[htsy_open] media_download_ok kind=${downloadResult.mediaKind} size=${downloadResult.size} path=${downloadResult.outputPath}`,
      );
      const head = text || `[${downloadResult.mediaKind}]`;
      text = `${head}\n素材已下载: ${downloadResult.outputPath}`;
    }
  } catch (error) {
    console.error(`[htsy_open] media_download_error err=${String(error)}`);
    const mediaKind = resolveMediaKind(payload);
    if (mediaKind) {
      const head = text || `[${mediaKind}]`;
      text = `${head}\n素材下载失败: ${String(error)}`;
    }
  }

  if (!conversationId || !sender || !text) {
    console.info(
      `[htsy_open] inbound_ignored type=${type} conversation=${conversationId || "n/a"} sender=${sender || "n/a"} has_text=${text ? "yes" : "no"}`,
    );
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, ignored: true }));
    return true;
  }

  console.info(
    `[htsy_open] inbound type=${type} conversation=${conversationId} sender=${sender} receiver=${receiver} text_len=${text.length}`,
  );

  const parsedConversation = parseConversationId(conversationId, botWxid);
  const targetWxid =
    parsedConversation.kind === "group" && parsedConversation.id ? parsedConversation.id : sender;
  console.info(
    `[htsy_open] inbound_parsed kind=${parsedConversation.kind} parsed_id=${parsedConversation.id || "n/a"} target=${targetWxid} sender_name=${senderName || "n/a"}`,
  );

  if (!isInboundAllowed({ account, parsedConversation, sender })) {
    console.info(
      `[htsy_open] inbound_ignored type=${type} reason=allow_from conversation=${conversationId} parsed_id=${parsedConversation.id || "n/a"} sender=${sender || "n/a"} allowFrom=${safeJsonForLog(account?.allowFrom ?? [])}`,
    );
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, ignored: true, reason: "allow_from" }));
    return true;
  }

  rememberInboundBotContext({
    targetWxid,
    conversationId,
    senderWxid: sender,
    botWxid: payload?.botWxid,
    botType: payload?.botType,
  });

  const route = channelRuntime.routing.resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: parsedConversation.kind,
      id: parsedConversation.id || targetWxid,
    },
  });

  const inboundCtx = channelRuntime.reply.finalizeInboundContext({
    Body: text,
    RawBody: text,
    CommandBody: text,
    From: `${CHANNEL_ID}:${sender}`,
    To: `${CHANNEL_ID}:${targetWxid}`,
    SessionKey: route.sessionKey,
    AccountId: account.accountId,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `${CHANNEL_ID}:${targetWxid}`,
    ChatType: parsedConversation.kind,
    SenderName: senderName || sender,
    SenderId: sender,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    ConversationLabel: senderName || sender,
    Timestamp: Date.now(),
    CommandAuthorized: true,
    Receiver: receiver,
    ConversationId: conversationId,
    BotWxid: botWxid,
    BotType: Number(payload?.botType ?? 0),
  });

  await channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: inboundCtx,
    cfg: config,
    dispatcherOptions: {
      deliver: async (replyPayload) => {
        const content = String(replyPayload?.text ?? replyPayload?.body ?? "").trim();
        if (!content) {
          return;
        }
        const to = normalizeTarget(targetWxid);
        const effectiveBotWxid = String(payload?.botWxid ?? account.defaultBotWxid ?? "").trim();
        const botType = Number(payload?.botType ?? account.defaultBotType ?? 0);
        if (!to || !effectiveBotWxid || !Number.isFinite(botType) || botType <= 0) {
          throw new Error("htsy_open: missing target or bot context for reply");
        }
        console.info(
          `[htsy_open] outbound_send_start to=${to} botWxid=${effectiveBotWxid} botType=${botType} text_len=${content.length}`,
        );
        try {
          const traceId = await sendTextMessage({
            account,
            targetWxid: to,
            botWxid: effectiveBotWxid,
            botType,
            content,
          });
          console.info(
            `[htsy_open] outbound_send_ok to=${to} traceId=${traceId || "n/a"}`,
          );
        } catch (error) {
          console.error(
            `[htsy_open] outbound_send_error to=${to} err=${String(error)}`,
          );
          throw error;
        }
      },
    },
  });

  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true }));
  return true;
}

export function normalizeOutboundTarget(raw) {
  return normalizeTarget(raw);
}
