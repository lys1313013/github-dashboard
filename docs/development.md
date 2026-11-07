# 开发文档

## 环境与命令

使用 Node.js 22.12+ 的 22.x 版本。Docker 构建使用 Node.js 22 和 npm，以下命令也使用 npm：

```bash
npm ci
npm run dev -- --host 127.0.0.1
```

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器，默认端口 5173 |
| `npm test` | 使用 Node.js 内置测试运行器执行 API 测试 |
| `npx --no-install tsc --noEmit` | 按 tsconfig.json 执行类型检查 |
| `npm run build` | 构建静态资源到 dist/，不包含独立的类型检查 |
| `npm run preview -- --host 127.0.0.1` | 预览已构建资源，默认端口 4173 |

`package.json` 同时通过 `packageManager` 声明了 pnpm 11.4.0，仓库也保留 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml`。使用匹配版本的 pnpm 时，可执行 `pnpm install --frozen-lockfile`，再使用 `pnpm dev`、`pnpm test` 和 `pnpm build`。pnpm 配置禁止执行 esbuild 的安装构建脚本；如安装后提示 esbuild 二进制不可用，请先检查对应平台的可选依赖是否安装完整。

两个锁文件分别供 npm 和 pnpm 使用。修改依赖时应同步检查两个锁文件，避免本地和 Docker 安装出不同的依赖。不要在文档示例、提交或测试中写入真实 Token。

## 代码结构

```text
src/
  api.ts                    GitHub 请求、Token、状态映射和内存缓存
  App.tsx                   Token 配置、仓库列表与详情的视图切换
  main.tsx                  React 入口
  components/
    TokenSetup.tsx          Token 输入页
    StatusBadge.tsx         状态标签
    icons.tsx               SVG 图标
  views/
    RepoList.tsx            仓库列表、搜索、筛选与排序
    RepoDetail.tsx          最近 15 次 Actions 运行记录
  styles.css                页面样式
tests/
  dashboard.test.mjs        模拟 fetch/localStorage 的 API 自动化测试
  dashboard.html            浏览器模拟数据验证页
.github/workflows/
  docker-build.yml          多架构镜像构建、发布与 manifest 校验
```

## 数据流与刷新

应用使用固定的 `https://api.github.com` 地址，没有 API 地址或 Token 环境变量配置，也没有服务端 API 代理。视图切换保存在 React 状态中，没有 URL 路由；重新加载页面会回到仓库列表。

1. 从 `localStorage` 读取 Token；必要时将旧键 `hubdeck.token` 迁移为 `github-dashboard.token`。
2. 请求 `/user/repos?per_page=100&page=…&sort=updated`，每到一页便发布当前仓库列表。最多读取 30 页。
3. 仓库分页结束后，最多并发 8 个请求获取各仓库 `/repos/{owner}/{repo}/actions/runs?per_page=1`，逐张更新卡片。
4. 完整成功的列表结果在内存中缓存 60 秒。部分结果也会保留，以便返回列表时先展示，但含失败或未完成请求的缓存不会被视为新鲜结果。
5. 手动刷新和浏览器触发 `online` 事件会强制刷新列表。列表每 60 秒、详情每 30 秒尝试定时刷新，页面隐藏或已有请求进行时跳过。
6. 离开视图会取消该视图的活动请求和等待中的重试。切换 Token 会清空内存缓存。

列表排序中的「最近更新」优先比较 `pushed_at`，相同时比较 `updated_at`。搜索匹配仓库短名称和描述，不匹配所有者名称。

## 超时与错误处理

每次逻辑请求的总超时为 15 秒，涵盖重试和退避等待。网络连接错误（fetch 抛出 `TypeError`）和 HTTP 429、502、503、504 最多尝试 3 次。一般退避为 500 毫秒、1 秒；429 优先使用 `Retry-After` 的数字秒数，否则等待 5 秒。超时或主动取消会立即结束重试。

仓库元数据请求失败会在列表显示错误并保留已加载的数据；单仓库 Actions 请求失败会标记 `workflowState: error`，不终止其他仓库加载。Actions 404 会被当作没有运行记录。详情定时刷新为静默刷新，失败后保留旧数据；首次加载和手动刷新会显示错误。

这些策略只能控制本地并发，无法保证不触发 GitHub 限流。一次完整列表刷新约需「仓库分页请求数 + 仓库数」个请求，重试会增加请求量。

## 验证修改

提交前运行：

```bash
npm test
npx --no-install tsc --noEmit
npm run build
git diff --check
```

自动化测试直接转译并执行真实的 `src/api.ts`，模拟网络、存储与计时器，不需要 GitHub Token 或外网。覆盖 Token 迁移与清除、分页展示、并发上限、缓存、局部失败、取消、超时和网络重试；不包含 React 组件交互测试。

需要检查加载交互时，启动开发服务器并打开 <http://127.0.0.1:5173/tests/dashboard.html>：

1. 页面使用内存中的模拟 Token，返回 17 个模拟仓库，不读取真实 Token，也不调用 GitHub API。
2. 首个仓库会先完成，其余请求等待；检查卡片先出现、状态逐步更新，以及统计中的 `peak` 不超过 8。
3. 点击「完成剩余请求」，检查所有卡片状态完成加载。
4. 重新加载测试页后，在请求未完成时进入详情或切换 Token，检查请求取消统计。

该 HTML 依赖 Vite 开发接口，仅用于开发服务器，不作为生产入口。真实账户的集成验证应在普通首页单独进行。

返回 [README](../README.md)。
