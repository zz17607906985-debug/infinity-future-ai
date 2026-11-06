# 真实 API 验收入口

本文件用于完成优化计划书中仍待外部凭证的 P0-1/P0-2 抽样。脚本默认不执行，必须同时提供 API 地址、Key 和明确的计费确认。

## 文本和文生视频

PowerShell 示例：

```powershell
$env:FUTUREAI_API_URL = "https://你的兼容接口地址"
$env:FUTUREAI_API_KEY = "你的Key"
$env:FUTUREAI_TEXT_MODEL = "你的文本模型"
$env:FUTUREAI_IMAGE_MODEL = "你的图片模型"
$env:FUTUREAI_VIDEO_MODEL = "你的视频模型"
npm run test:real-api
```

只验证图片接口时可将 FUTUREAI_SMOKE_MODE 设为 image，并提供 FUTUREAI_IMAGE_MODEL；默认请求尺寸为 1024x576，可用 FUTUREAI_IMAGE_SIZE 覆盖。

```powershell
$env:FUTUREAI_SMOKE_MODE = "image"
$env:FUTUREAI_IMAGE_SIZE = "1024x576"
npm run test:real-api
```

脚本会验证文本请求和文生视频请求。视频接口默认使用 `/videos`，异步任务默认轮询 `/videos/{id}`，完成后读取 `/videos/{id}/content`。接口不同的供应商可通过以下变量调整：

- `FUTUREAI_VIDEO_ENDPOINT`
- `FUTUREAI_IMAGE_ENDPOINT`
- `FUTUREAI_IMAGE_QUERY_ENDPOINT`
- `FUTUREAI_IMAGE_SIZE`
- `FUTUREAI_IMAGE_PROMPT`
- `FUTUREAI_VIDEO_QUERY_ENDPOINT`
- `FUTUREAI_VIDEO_CONTENT_ENDPOINT`
- `FUTUREAI_VIDEO_SIZE`
- `FUTUREAI_VIDEO_SECONDS`
- `FUTUREAI_VIDEO_PROMPT`

## 首尾帧和延长

首尾帧抽样需要设置：

```powershell
$env:FUTUREAI_FIRST_FRAME_URL = "供应商可读取的首帧地址"
$env:FUTUREAI_LAST_FRAME_URL = "供应商可读取的尾帧地址"
```

延长抽样需要设置：

```powershell
$env:FUTUREAI_EXTEND_VIDEO_URL = "供应商可读取的原视频地址"
$env:FUTUREAI_EXTEND_DIRECTION = "forward"
```

不同供应商如果要求 multipart 上传或专用字段，先在软件的模型能力档案中配置对应 endpoint 和协议，再用同一组操作在 GUI 中验收。脚本输出脱敏的 JSON 证据，默认写入 `dist/real-api-smoke-evidence.json`，不会保存 API Key。

## 安全边界

### 图片接口抽样

脚本的 `all` 模式现在覆盖文本、图片和视频三类请求。图片接口默认请求 `/images/generations`，可返回图片 URL 或 base64 内联数据；如果供应商使用异步任务，设置 `FUTUREAI_IMAGE_QUERY_ENDPOINT`（支持 `{id}` 占位符）后会自动轮询并记录脱敏证据。

- 未设置 `FUTUREAI_REAL_API_CONFIRM=1` 时脚本拒绝发送请求。
- 真实请求可能产生费用，必须使用低时长、低分辨率和测试项目。
- 脚本失败不会删除项目、素材或已有生成结果。
