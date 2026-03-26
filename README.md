# OpenClaw HTSY Open Channel Plugin

OpenClaw 的海豚私域 (HTSY) Open Channel 插件，用于对接海豚私域开放平台 API（微信消息回调与发送）。

**海豚私域开放平台**: https://open.cpshelp.cn/
**API 端点**: https://open-api.cpshelp.cn

## 安装

```bash
# 克隆仓库
git clone https://github.com/CoolBanHub/openclaw-htsy-channel.git

# 复制到 OpenClaw 扩展目录
cp -r openclaw-htsy-channel/* ~/.openclaw/extensions/htsy-open/
```

## 配置

在 OpenClaw 配置文件中添加以下配置项：

```yaml
channels:
  htsy_open:
    enabled: true
    # 海豚私域 API 端点
    endpoint: "https://open-api.cpshelp.cn"
    # 应用 ID
    appId: "your-app-id"
    # 应用密钥
    appSecret: "your-app-secret"
    # 授权用户 ID
    authorizerUserId: "your-authorizer-user-id"
    # Webhook 回调路径（OpenClaw 会监听此路径接收消息）
    webhookPath: "/htsy-open/callback"
    # HTTP 请求超时（秒）
    httpTimeoutSec: 60
    # 媒体素材下载目录（可选，默认 ~/.openclaw/workspace/htsy-open-downloads）
    downloadDir: ""
    # 默认机器人类型（2=企微）
    defaultBotType: 2
    # 私信策略：allowlist（白名单）或 public（公开）
    dmPolicy: "allowlist"
    # 白名单列表（当 dmPolicy 为 allowlist 时生效）
    allowFrom: []
```

### 配置项说明

| 配置项 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `enabled` | boolean | 否 | true | 是否启用此 Channel |
| `endpoint` | string | 否 | https://open-api.cpshelp.cn | 海豚私域 API 端点 |
| `appId` | string | **是** | - | HTSY 应用 ID |
| `appSecret` | string | **是** | - | HTSY 应用密钥 |
| `authorizerUserId` | string | **是** | - | 授权用户 ID |
| `webhookPath` | string | 否 | /htsy-open/callback | Webhook 回调路径 |
| `httpTimeoutSec` | number | 否 | 60 | HTTP 请求超时秒数 |
| `downloadDir` | string | 否 | ~/.openclaw/workspace/htsy-open-downloads | 媒体素材下载目录 |
| `defaultBotType` | number | 否 | 2 | 默认机器人类型（2=企微） |
| `dmPolicy` | string | 否 | allowlist | 私信策略 |
| `allowFrom` | string[] | 否 | [] | 白名单用户/群列表 |

## 使用

### 1. 配置 HTSY Open 回调地址

在 HTSY Open 后台配置消息回调地址：

```
https://your-openclaw-host/htsy-open/callback
```

### 2. 启动 OpenClaw

确保 OpenClaw 已加载此插件，启动后会注册 Webhook 路由。

### 3. 消息处理

- **接收消息**：HTSY Open 通过 Webhook 推送消息到 OpenClaw
- **发送消息**：OpenClaw 通过 HTSY Open API 发送回复

### 4. 白名单配置

如果 `dmPolicy` 设置为 `allowlist`，需要在 `allowFrom` 中配置允许的用户或群：

```yaml
channels:
  htsy_open:
    dmPolicy: "allowlist"
    allowFrom:
      - "wxid_xxx"      # 允许的用户 wxid
      - "xxx@chatroom"  # 允许的群
```

## 功能特性

- 支持接收文本、图片、视频、音频、文件等消息类型
- 自动下载媒体素材到本地
- Token 自动缓存与刷新
- Bot 上下文记忆（支持多轮对话）
- 白名单访问控制

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/get_access_token` | POST | 获取访问令牌 |
| `/api/htsy/msg/send` | POST | 发送消息 |
| `/api/htsy/material/cdnDownload` | POST | 下载媒体素材 |

## 文件结构

```
.
├── index.js              # 插件入口
├── openclaw.plugin.json  # 插件元数据
├── package.json          # npm 包配置
├── src/
│   ├── channel.js        # Channel 插件定义
│   ├── client.js         # HTSY API 客户端
│   ├── runtime.js        # 运行时存储
│   ├── accounts.js       # 账户配置管理
│   └── inbound.js        # Webhook 消息处理
└── README.md             # 说明文档
```

## 许可证

MIT
