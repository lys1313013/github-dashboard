# github-dashboard

自托管的 GitHub 仓库与 Actions 状态看板，使用 React、TypeScript 和 Vite 构建。浏览器直接访问 GitHub REST API，部署端只需提供静态文件。

## 功能

- 仓库卡片展示描述、主要语言、Star、Fork、最近推送时间及最新一次 Actions 运行状态。
- 按仓库名称或描述搜索，按语言筛选，按最近更新、Star 数或名称排序。
- 点击仓库查看最近 15 次 workflow run，点击运行记录跳转到 GitHub。
- 仓库列表每 60 秒自动刷新，详情每 30 秒自动刷新；页面隐藏时跳过定时刷新。
- 分页展示仓库，再以最多 8 个并发请求逐步填充 Actions 状态；单个仓库请求失败不影响其他卡片。
- 提供 Docker 部署方式，镜像构建覆盖 `linux/amd64` 和 `linux/arm64`。

## 本地启动

使用 Node.js 22.12 或更高的 22.x 版本，与 Docker 构建环境保持一致。

```bash
git clone https://github.com/lys1313013/github-dashboard.git
cd github-dashboard
npm ci
npm run dev -- --host 127.0.0.1
```

访问终端显示的地址，默认是 <http://127.0.0.1:5173>，然后配置 Token。项目同时保留 pnpm 配置，使用方式见[开发文档](docs/development.md)。

## 配置 GitHub Token

1. 打开 [GitHub Token 设置](https://github.com/settings/tokens)，创建 fine-grained personal access token。
2. 选择需要查看的资源所有者和仓库范围，为仓库配置 `Actions: Read-only` 和 `Metadata: Read-only` 权限。Actions 读取权限要求见 [GitHub 官方文档](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository)。
3. 在首次打开的页面粘贴并保存 Token。列表只会显示该 Token 可访问的仓库。
4. 如需切换账号或权限，点击列表右上角的「更换 Token」，再输入新 Token。

Token 保存在当前站点的浏览器 `localStorage` 中，键名为 `github-dashboard.token`；请求 GitHub API 时会通过 `Authorization` 请求头发送到 `https://api.github.com`。静态文件服务器不接收 Token，项目也没有后端账号系统或服务端 Token 配置。

这是面向个人本地自用的工具。请在可信设备和站点使用；同源脚本能够读取 `localStorage`。更换 Token 会清除本地保存值和内存缓存，但不会在 GitHub 撤销 Token；撤销操作需前往 GitHub 设置。域名、协议或端口改变后，浏览器会使用独立的存储空间，需要重新输入 Token。旧版 `hubdeck.token` 会在同源下自动迁移。

## Docker 部署

仓库提供的 Compose 配置从阿里云 ACR 拉取镜像，并将主机 `8765` 端口映射到容器 `80` 端口：

```bash
docker compose pull
docker compose up -d
```

访问 <http://localhost:8765>。当前 Compose 的 `8765:80` 映射会绑定主机所有网络接口；仅在本机使用时，将 [docker-compose.yml](docker-compose.yml) 的端口改为 `127.0.0.1:8765:80`。

也可以从源码构建并仅监听本机：

```bash
docker build -t github-dashboard:local .
docker run -d --name github-dashboard-local \
  --restart unless-stopped \
  -p 127.0.0.1:8765:80 github-dashboard:local
```

镜像源切换、更新、停止及 CI 发布配置见[部署文档](docs/deployment.md)。

## 状态说明

列表展示的是仓库所有分支、所有 workflow 中最新的一次运行，并非每个 workflow 或默认分支的汇总。

| 显示 | 含义 |
| --- | --- |
| 通过 | 运行完成，结论为 `success` |
| 失败 | 运行完成，结论为 `failure` 或 `timed_out` |
| 运行中 | 运行尚未完成，包括排队和等待等状态 |
| 需操作 | 运行完成，结论为 `action_required` |
| 跳过 | 其他已完成结论的统一展示，包括取消、跳过、中性结果等 |
| 查询中 | 正在加载且尚无可展示的运行记录 |
| 未获取 | Actions 请求失败，可手动刷新重试 |
| 无 | API 返回空运行列表，或 Actions 接口返回 404 |

## 常见问题

- **仓库缺失或私有仓库不可见**：检查 Token 的资源所有者、仓库选择、有效期和组织授权要求。客户端最多读取 30 页、每页 100 个仓库，超过 3,000 个仓库会截断。
- **401 / Bad credentials**：Token 可能无效或过期，点击「更换 Token」重新配置；程序不会自动重试 401。
- **403 或「未获取」**：检查 Actions 读取权限、组织策略和 API 限流情况。单个 Actions 请求失败会保留卡片，点击刷新可重试。
- **显示「无」，但 GitHub 上有运行记录**：当前实现也将 404 作为空列表处理，请先核对仓库访问权限。
- **无法连接或超时**：确认浏览器能访问 `api.github.com`，检查本机网络、代理及浏览器扩展。容器只提供静态页面，配置容器代理不会改变浏览器的 API 网络路径。
- **数据未立即更新**：列表完整加载后可复用 60 秒内的内存缓存；点击「刷新」会强制重新请求。详情的后台刷新失败会保留旧记录，可手动刷新查看错误。

## 开发与维护

- [开发文档](docs/development.md)：命令、代码结构、加载策略和模拟数据验证。
- [部署文档](docs/deployment.md)：镜像、Compose 运维、静态部署和 GitHub Actions 配置。

当前仓库未包含开源许可证文件；使用和分发前请与维护者确认授权范围。
