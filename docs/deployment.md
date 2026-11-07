# 部署与镜像发布

## 使用 Compose

仓库根目录的 [docker-compose.yml](../docker-compose.yml) 使用：

```text
crpi-yvha9coypdedaafa.cn-beijing.personal.cr.aliyuncs.com/lys1313013/github-dashboard:latest
```

需要 Docker Engine 和 Compose 插件。在仓库根目录执行：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

容器名为 `github-dashboard`，使用 `unless-stopped` 重启策略，主机端口为 `8765`。默认配置的 `8765:80` 绑定所有网络接口；本机自用时可改为：

```yaml
ports:
  - "127.0.0.1:8765:80"
```

访问 <http://localhost:8765> 并在浏览器配置 Token。应用没有服务端数据库，也无需数据卷或 Token 环境变量；Token 由各浏览器分别保存。

更新到同一标签的新镜像：

```bash
docker compose pull
docker compose up -d
```

查看日志与停止：

```bash
docker compose logs --tail=100 -f
docker compose down
```

日志来自 Nginx；GitHub API 请求由浏览器发起，请在浏览器开发者工具的 Network 面板排查 API 错误。停止容器不会清除浏览器中的 Token。

## 切换镜像或固定版本

工作流配置了两个镜像目标：

| 镜像目标 | 标签规则 |
| --- | --- |
| `ghcr.io/<仓库所有者>/github-dashboard` | 默认分支 `latest`、分支名、语义化版本及 `sha-` 前缀的短提交标签，由 metadata-action 生成 |
| `<ACR_REGISTRY>/<ACR_NAMESPACE>/github-dashboard` | `latest` 和完整的 Git 提交 SHA |

需要使用 GHCR 时，将 Compose 的 `image` 替换为 `ghcr.io/lys1313013/github-dashboard:latest`。镜像仓库若要求认证，应先登录相应 registry。镜像能否拉取取决于实际发布结果与仓库可见性。

需要可复现部署或回滚时，用已成功发布的提交标签或镜像 digest 替换 `latest`，再执行 `docker compose pull` 和 `docker compose up -d`。GHCR 与 ACR 的提交标签格式不同，不要混用。

## 从源码构建

[Dockerfile](../Dockerfile) 使用多阶段构建：Node.js 22 Alpine 执行 `npm ci` 和 `npm run build`，随后将 `dist/` 复制到 Nginx 镜像的 `/usr/share/nginx/html`。容器监听 80 端口。

```bash
docker build -t github-dashboard:local .
docker run -d --name github-dashboard-local \
  --restart unless-stopped \
  -p 127.0.0.1:8765:80 github-dashboard:local
```

如果 Compose 已占用 8765，请先停止对应服务或为本地容器选择其他主机端口。删除上述本地容器：

```bash
docker rm -f github-dashboard-local
```

## 静态文件部署

```bash
npm ci
npm run build
```

将生成的 `dist/` 作为静态站点根目录提供。当前 Vite 配置使用默认根路径；挂载到 `/dashboard/` 等子路径前，需调整 [vite.config.ts](../vite.config.ts) 中的 `base` 并重新构建。`npm run preview` 用于构建预览。

无论使用 Docker 还是静态部署，访问者浏览器都需要连接 `https://api.github.com`。反向代理如配置 CSP，应允许该 API 的连接。站点没有内置访问控制，部署方式应符合个人自用场景；更换访问源后需重新配置 Token。

## GitHub Actions 发布配置

[docker-build.yml](../.github/workflows/docker-build.yml) 在以下事件运行：

- 推送到 `main`。
- 推送 `v*` 标签。
- 面向 `main` 的 pull request。
- 手动 `workflow_dispatch`。

pull request 只构建，不登录或推送镜像。其他事件先构建并推送 GHCR，再构建并推送 ACR；两个步骤都要求 `linux/amd64` 和 `linux/arm64`。

GHCR 使用工作流的 `GITHUB_TOKEN`，job 声明 `contents: read` 与 `packages: write`。ACR 需要在仓库 Actions secrets 中配置：

| Secret | 用途 |
| --- | --- |
| `ALIYUN_ACR_REGISTRY` | registry 主机名，不含协议或命名空间 |
| `ALIYUN_ACR_NAMESPACE` | 镜像命名空间 |
| `ALIYUN_ACR_USERNAME` | registry 登录用户名 |
| `ALIYUN_ACR_PASSWORD` | registry 登录密码或访问凭据 |

当前工作流对所有非 PR 发布都执行 ACR 登录和推送，缺少这些 secrets 会失败。如果维护自己的 fork，应配置对应 ACR 目标，或调整工作流以仅发布所需 registry；Compose 镜像地址也需同步修改。

为兼容 ACR，ACR 构建单独导出 Docker media types，并关闭 provenance 和 SBOM；GHCR 保留构建工具默认设置。最后一步检查两个镜像包含 amd64、arm64 平台，并要求 ACR 使用 Docker manifest list 格式且平台列表恰好为这两个平台。

此工作流只负责镜像构建、发布和 manifest 检查，没有执行 `npm test` 或独立的 TypeScript 检查。提交前的验证步骤见[开发文档](development.md#验证修改)。如果后续 ACR 推送或校验失败，前面的 GHCR 镜像仍可能已经发布，应查看具体步骤状态。

返回 [README](../README.md)。
