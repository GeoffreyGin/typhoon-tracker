# 巴威 BAVI · 台风实时监控

**仅供信息参考，请以当地主管部门正式预警为准。**

面向公众的中文单页防灾监控站，采用深色气象雷达风格。数据读取日本气象厅（JMA）公开多语言端点，每 5 分钟自动刷新。

## 快速开始

需要 Node.js 18+：

```bash
npm start
```

打开 `http://localhost:3000`。

## 运行测试

```bash
npm test
```

使用 Node.js 原生测试运行器（`node:test` + `node:assert/strict`），覆盖：

- **坐标解析**：`normalizeLatitude`、`normalizeLongitude`（N/S/E/W 方向字符串、数值、边界值、空值）
- **数值清洗**：`parseNumber`（字符串、千分位逗号、单位后缀、Infinity/NaN）
- **字段发现**：`findValue`（大小写不敏感键名匹配）
- **风圈提取**：`extractRadii`（中/英/日字段名、嵌套对象、有效范围 1-2500km）
- **JMA 适配器**：`adaptJmaPayload` 完整数据转换、缺坐标过滤、去重、排序、预报点上限、热带低压降级、全部坐标无效抛错
- **缓存行为**：新鲜/过期缓存、网络失败回退、无缓存时抛错
- **HTTP 服务器**：`/api/typhoon` JSON 响应、静态文件、405/404

## API

### `GET /api/typhoon`

返回统一结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| `storm` | object | `id`, `name`, `basin`, `status` |
| `current` | object | 当前分析点（`validAt`, `latitude`, `longitude`, `pressureHpa`, `windKts`, `gustKts`, `movementKph`, `probabilityRadiusKm`, `intensity`） |
| `forecast` | array | 预报点列表（最多 10 个），结构与 current 一致 |
| `windRadii` | object | `stormKm`（暴风圈）, `galeKm`（强风圈），源数据未提供时为 null |
| `source` | object | `provider`, `endpoint`, `publishedAt`, `fetchedAt` |
| `meta` | object | `cache`（fresh/network/stale）, `stale`, `error`（仅过期时） |

### 容错

- **新鲜缓存**：5 分钟，直接返回不请求外部
- **过期缓存**：外部请求失败时，返回最近一次成功数据（最长 30 分钟），标注 `meta.stale: true`
- **无缓存**：首次加载失败返回 HTTP 503，前端不展示虚构数据

## 数据来源

日本气象厅公开多语言端点：`https://www.data.jma.go.jp/multi/data/VPTW60/61_cn_zs.json`

> 该端点为公开但未正式承诺稳定的数据接口。`server.js` 中的 `adaptJmaPayload` 适配层将 JMA 的任意字段名映射为前端稳定契约，降低 JMA 结构变更时的维护成本。

## 中国境内信息

本页仅引用应急管理部、中国气象局等官方通报入口，**不自行推断中国境内灾情或台风登陆结论**。官方通报与实时轨迹各自标注发布时间，请以通报页面标注的正式发布时间为准。

## 部署

### Vercel

```bash
npx vercel --prod
```

项目使用 `@vercel/node` 构建器，`server.js` 直接作为无服务器函数运行。

### 其他平台

任何支持 Node.js 18+ 的运行环境均可部署：Render、Railway、Cloud Run 等。只需运行 `node server.js`，确保 `/api/typhoon` 与静态文件同源。

## 技术架构

- **零依赖**：仅使用 Node.js 内置模块（`node:http`、`node:fs/promises`、`node:path`）
- **无框架**：纯 `http.createServer`，无 Express
- **适配器模式**：`adaptJmaPayload()` 隔离外部接口变化
- **单文件前端**：HTML/CSS/JS 一体，Leaflet 深色地图瓦片（CARTO，无需 API 密钥）
- **测试**：Node.js 原生 `node:test`，60 个断言覆盖所有核心逻辑

## 许可与署名

- 台风数据：© 日本气象厅（Japan Meteorological Agency）
- 地图瓦片：© [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者 · © [CARTO](https://carto.com/attributions)
