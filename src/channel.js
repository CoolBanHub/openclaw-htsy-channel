import { createScopedDmSecurityResolver } from "openclaw/plugin-sdk/channel-config-helpers";
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-lifecycle";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import {
  applySetupConfig,
  defaultAccountId,
  describeAccount,
  isConfigured,
  listAccountIds,
  resolveAccount,
} from "./accounts.js";
import { handleHtsyOpenWebhook, normalizeOutboundTarget } from "./inbound.js";
import { resolveOutboundBotContext, sendTextMessage } from "./client.js";

const CHANNEL_ID = "htsy_open";

const resolveDmPolicy = createScopedDmSecurityResolver({
  channelKey: CHANNEL_ID,
  resolvePolicy: (account) => account.dmPolicy,
  resolveAllowFrom: (account) => account.allowFrom,
  defaultPolicy: "allowlist",
  approveHint: "openclaw pairing approve htsy_open <code>",
});

export const htsyOpenPlugin = createChatChannelPlugin({
  base: {
    id: CHANNEL_ID,
    meta: {
      id: CHANNEL_ID,
      label: "HTSY Open",
      selectionLabel: "HTSY Open",
      detailLabel: "HTSY Open",
      docsPath: "/channels/htsy-open",
      blurb: "HTSY Open callback + send API",
      aliases: ["htsy-open"],
    },
    capabilities: {
      chatTypes: ["direct", "group"],
      media: false,
      threads: false,
      reactions: false,
      edit: false,
      unsend: false,
      reply: false,
      effects: false,
      blockStreaming: false,
    },
    setup: {
      applyAccountConfig: ({ cfg, input }) => applySetupConfig(cfg, input),
    },
    config: {
      listAccountIds,
      resolveAccount,
      defaultAccountId,
      isConfigured,
      isEnabled: (account) => account.enabled !== false,
      describeAccount,
    },
    gateway: {
      startAccount: async (ctx) => {
        const account = ctx.account;
        if (!account.enabled) {
          ctx.log?.info?.("htsy_open: account disabled, skip startup");
          return waitUntilAbort(ctx.abortSignal);
        }
        if (!isConfigured(account)) {
          ctx.log?.warn?.("htsy_open: account not configured (appId/appSecret/authorizerUserId)");
          return waitUntilAbort(ctx.abortSignal);
        }
        if (!ctx.channelRuntime) {
          ctx.log?.warn?.("htsy_open: channelRuntime unavailable");
          return waitUntilAbort(ctx.abortSignal);
        }

        const unregister = registerPluginHttpRoute({
          path: account.webhookPath,
          auth: "plugin",
          pluginId: CHANNEL_ID,
          accountId: account.accountId,
          replaceExisting: true,
          log: (message) => ctx.log?.info?.(message),
          handler: async (req, res) => {
            try {
              const latestCfg = ctx.cfg;
              const latestAccount = resolveAccount(latestCfg, ctx.accountId);
              return await handleHtsyOpenWebhook({
                req,
                res,
                account: latestAccount,
                channelRuntime: ctx.channelRuntime,
                config: latestCfg,
              });
            } catch (error) {
              ctx.log?.error?.(`htsy_open webhook error: ${String(error)}`);
              if (!res.headersSent) {
                res.statusCode = 500;
                res.end("internal error");
              }
              return true;
            }
          },
        });

        ctx.log?.info?.(`htsy_open route registered: ${account.webhookPath}`);
        return waitUntilAbort(ctx.abortSignal, () => {
          unregister();
          ctx.log?.info?.("htsy_open route unregistered");
        });
      },
    },
    reload: {
      configPrefixes: ["channels.htsy_open"],
    },
  },
  security: {
    resolveDmPolicy,
  },
  pairing: {
    text: {
      idLabel: "htsyOpenUserId",
      message: "OpenClaw: your access has been approved.",
      normalizeAllowEntry: (entry) => String(entry).trim().toLowerCase(),
    },
  },
  outbound: {
    deliveryMode: "gateway",
    textChunkLimit: 1500,
    sendText: async ({ cfg, accountId, to, text }) => {
      const account = resolveAccount(cfg ?? {}, accountId);
      if (!isConfigured(account)) {
        throw new Error("htsy_open: account not configured");
      }

      const targetWxid = normalizeOutboundTarget(to);
      if (!targetWxid) {
        throw new Error("htsy_open: missing outbound target");
      }

      const botContext = resolveOutboundBotContext({
        targetWxid,
        defaultBotType: account.defaultBotType,
      });
      if (!botContext?.botWxid || !botContext?.botType) {
        throw new Error(
          "htsy_open: missing bot context. send one inbound message first, or configure channels.htsy_open.defaultBotType",
        );
      }

      const messageId = await sendTextMessage({
        account,
        targetWxid,
        botWxid: botContext.botWxid,
        botType: botContext.botType,
        content: text,
      });

      return {
        channel: CHANNEL_ID,
        ok: true,
        messageId: messageId || `htsy-${Date.now()}`,
      };
    },
  },
});
