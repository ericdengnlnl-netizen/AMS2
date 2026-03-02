# 投资组合估值系统 + 宏观研报中文聚合站

本项目包含两套功能：

1. 投资组合估值系统（Excel + Tushare + Supabase）
2. 多机构宏观研报中文聚合站（公开网页抓取 + 中文摘要/关键段翻译）

## 目录

- `/Users/ericdeng/Desktop/project/server.js`: 主后端（估值 API + 研报 API）
- `/Users/ericdeng/Desktop/project/research.js`: 研报抓取/抽取/翻译/入库/定时任务
- `/Users/ericdeng/Desktop/project/public/index.html`: 估值系统前端页面
- `/Users/ericdeng/Desktop/project/public/app.js`: 估值系统前端逻辑
- `/Users/ericdeng/Desktop/project/supabase/schema.sql`: 估值系统数据库结构
- `/Users/ericdeng/Desktop/project/supabase/research_schema.sql`: 研报聚合数据库结构

## 1) Supabase 初始化

在 Supabase SQL Editor 执行：

- `/Users/ericdeng/Desktop/project/supabase/schema.sql`
- `/Users/ericdeng/Desktop/project/supabase/research_schema.sql`

`schema.sql` 已包含兼容性 `alter table`，可在旧版库上直接升级。

## 2) 环境变量

复制并填写：

```bash
cp .env.example .env
```

核心变量：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TUSHARE_TOKEN`
- `RISK_FREE_RATE`（默认 `0.02`）
- `DEFAULT_PORTFOLIO_ID`（默认 `default`）
- `EXCEL_PATH`（仅兼容旧接口 `/api/init`）

研报相关变量：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `ADMIN_UPDATE_KEY`
- `RESEARCH_CRON_EXPR`
- `RESEARCH_CRON_TZ`
- `RESEARCH_LIMIT_PER_SOURCE`

## 3) 启动

```bash
npm install
npm run dev
```

访问：

- 估值系统: [http://localhost:3000](http://localhost:3000)
- 研报聚合页: [http://localhost:3000/research](http://localhost:3000/research)

## 4) 估值系统使用流程

1. 上传并导入初始估值表（`/api/import-initial`）
2. 上传并导入交易记录表（`/api/import-transactions`，自动去重）
3. 在“现金调剂”录入现金增加/减少（可选）
4. 点击“同步行情”（Tushare `fund_daily`）
5. 点击“重算估值”（写入 `portfolio_daily_snapshots`）
6. 在“业绩分析”中选择结束日期与时间范围，生成区间统计、收益贡献拆解、持仓区间涨跌幅、宽基指数对比
5. 查看仪表盘：
- 每日单位净值曲线（交易日）
- 最新资产配置（含 `CASH.CNY`）
- 调仓交易记录
- 核心指标：累计收益率、年化收益率、波动率、夏普、最大回撤

估值口径：

- 初始日 `nav = 1`
- 现金建模为虚拟资产 `CASH.CNY`
- 当日交易先应用再按当日收盘估值
- 指标区间为“自初始估值日起”

## 5) 主要 API

估值系统：

- `POST /api/import-initial`：上传初始估值 Excel（`multipart/form-data`, `file`）
- `POST /api/import-transactions`：上传交易记录 Excel（`multipart/form-data`, `file`）
- `POST /api/sync-prices`：同步 Tushare 日收盘价
- `POST /api/rebuild-valuations`：重算估值并落库日度快照
- `GET /api/dashboard`：获取净值曲线、配置、交易、指标、诊断
- `GET /api/rebalances`：获取调仓交易列表
- `POST /api/rebalances`：手工新增调仓交易
- `POST /api/cash-adjustments`：新增现金调剂（`INCREASE`/`DECREASE`）
- `GET /api/performance-analysis`：区间业绩分析（`startDate`/`endDate`）
- `POST /api/init`：兼容旧流程（按服务器文件路径导入初始估值）

研报聚合：

- `GET /api/research/items`
- `GET /api/research/items/:id`
- `GET /api/research/facets`
- `GET /api/research/sources`
- `POST /api/research/update`
- `GET /api/research/runs/latest`
- `GET /api/research/runs/:runId`

## 6) 对外发布建议

可部署到 Render / Railway / Fly.io：

1. 推送仓库到 GitHub
2. 新建 Web Service（Node）
3. Build 命令：`npm install`
4. Start 命令：`npm start`
5. 配置所有环境变量
6. Supabase 作为托管数据库
