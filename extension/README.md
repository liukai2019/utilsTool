# Simple Agent

最小化 VS Code 扩展，用于通过公司内网 AI endpoint 发起请求并将结果输出到 Output 面板。

## Commands

- `Simple Agent: Ask`
- `Simple Agent: Set API Key`
- `Simple Agent: Clear API Key`
- `Simple Agent: Show Config`

## Settings

- `simpleAgent.endpoint`
- `simpleAgent.model`
- `simpleAgent.apiKey`
- `simpleAgent.apiKeyHeader`
- `simpleAgent.apiKeyPrefix`
- `simpleAgent.requestMode`
- `simpleAgent.responseMode`
- `simpleAgent.user`
- `simpleAgent.conversationId`
- `simpleAgent.inputs`
- `simpleAgent.files`
- `simpleAgent.timeoutMs`

## 公司 Agent API（Dify chat-messages）配置示例（Windows / VS Code）

在 Windows 中按 `Ctrl+Shift+P`，打开 `Preferences: Open User Settings (JSON)`，加入：

```json
{
  "simpleAgent.endpoint": "http://aifoundry.unisoc.com:8099/v1/chat-messages",
  "simpleAgent.apiKey": "你的API Key",
  "simpleAgent.apiKeyHeader": "Authorization",
  "simpleAgent.apiKeyPrefix": "Bearer ",
  "simpleAgent.requestMode": "dify_chat",
  "simpleAgent.responseMode": "blocking",
  "simpleAgent.user": "abc-123",
  "simpleAgent.conversationId": "",
  "simpleAgent.inputs": "{}",
  "simpleAgent.files": "[]",
  "simpleAgent.timeoutMs": 60000
}
```

说明：

- `dify_chat` 会按 `POST /v1/chat-messages` 构造请求：
  - `inputs`（默认 `{}`）
  - `query`（来自 `Simple Agent: Ask` 输入）
  - `response_mode`（当前仅支持 `blocking`）
  - `conversation_id`（默认空字符串）
  - `user`（必须可用）
  - `files`（默认 `[]`）
- 认证头保持兼容：`Authorization: Bearer <api_key>`
- `simpleAgent.inputs` / `simpleAgent.files` 需要填写合法 JSON 字符串，格式错误会直接提示具体错误信息
