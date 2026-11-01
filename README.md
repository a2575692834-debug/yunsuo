# 云梭 Yunsuo

一个独立重写的多用户网盘转存与再分享系统。前端使用 Vue 3 + Vite，后端使用 Express，数据存储使用 MySQL 8，通过 Docker Compose 一次启动。

访问地址：`http://localhost:18088`

## 云梭本地版安装程序

另提供完全独立、无需服务器、无需登录的 Windows 安装版：

```text
desktop-local/release/YunsuoLocal-Setup-1.0.0.exe
downloads/YunsuoLocal-Setup-1.0.0.exe
```

本地版内置全部网盘操作，不连接本项目后端或 MySQL。账号 Cookie 使用 Windows 安全存储加密保存在本机，支持百度、夸克、迅雷扫码与 Cookie 导入、智能转存、分享结果导出、文件管理、本地分享库和链接监控。安装向导可选择安装目录，并创建桌面与开始菜单快捷方式。

详细说明见 `desktop-local/README.md`。安装包未使用商业代码签名证书，Windows SmartScreen 可能提示未知发布者。

## 已实现

- 用户名注册、登录、JWT 鉴权；账号、任务、分享、文件按用户隔离。
- 管理员角色与普通用户角色分离；管理后台入口只对管理员显示，后台 API 也会独立鉴权。
- 管理后台包含用户与权限、网盘凭据、全站转存链接三个工作区；用户、账号、任务、资源、分享均持久化到 MySQL。
- 管理员可搜索用户、重置密码、授予或撤销管理员权限、删除用户；当前登录管理员不能删除或撤销自己。
- 管理员可查看所有用户的百度、夸克、迅雷 Cookie 状态，主动显隐或更换 Cookie，也可删除异常账号。Cookie 列表默认脱敏。
- 分享统一在「分享库」中管理，避免与公开资源页产生重复入口；公开查询后端接口保留，供后续盘搜引擎复用。
- 正则识别百度、夸克、迅雷分享链接，兼容「链接 + 提取码」整段文案。
- 百度、夸克、迅雷扫码登录轮询，同时保留手动 Cookie 接入。
- 百度、夸克、迅雷均支持在同一用户下添加多个扫码账号或手动 Cookie 账号；备注自动去重，账号按平台独立编号并可分别浏览。
- 自动匹配对应网盘账号，创建转存任务，再生成新的分享链接。
- 网页右上角保留「复制 Token」备用入口；完整桌面端默认使用登录地址、账号和密码登录。
- 网页右上角提供「桌面端」入口，包含 Windows 完整客户端下载与使用说明。
- 百度、迅雷等支持提取码的网盘可自定义 4 位字母/数字提取码，也可按平台规则留空。
- 夸克分享固定无提取码；混合文案批次也不受其他网盘提取码设置影响。
- 智能转存默认使用永久有效分享；支持设置指定天数、随机码或无提取码。
- 转存目录、资源记录、任务标题和分享标题优先保留源资源名称；同名目录自动追加序号。
- 任务中心：排队、实时进度、日志、取消、删除。
- 分享库、资源记录、我的空间文件浏览与手动分享。
- 我的空间支持搜索、排序、多选、新建文件夹、重命名、删除、复制、移动和批量分享；夸克会明确禁用其不支持的复制操作。
- 目标目录自动创建；每次转存使用以原资源名命名的独立目录，避免把同一目标目录中的旧文件一起分享。
- 网盘 Cookie 使用 AES-256-GCM 加密后写入 MySQL。
- 桌面端与移动端响应式界面，包含页面切换、数字滚动、任务进度和二维码扫描动画。
- 内置「演示空间」，无需真实网盘账号即可验收完整转存和分享流程。
- 网盘链接监控：粘贴别人持续更新的分享链接，首次检查立即同步，后续内容变化自动同步到自己的网盘。
- 监控可选择「云端监控」或「本地监控」：云端由服务器持续巡检，本地由已登录桌面端在线时定时驱动。
- 监控支持自定义检查间隔（5 分钟至 24 小时）、目标账号和转存目录；自动外部分享为可选功能，默认关闭。
- 同一监控固定同步到「转存目录/资源名」，重复同步复用该目录，不会每轮新建带序号的资源目录。
- 监控列表支持立即检查、立即同步、暂停 / 恢复、删除，并展示状态、上次同步、下次检查、同步次数与异常。
- 监控调度器随后端启动，每 15 秒扫描到期任务，失败自动指数退避，重启后自动恢复。
- 监控任务复用与「智能转存」同一套队列与分享逻辑，百度/夸克/迅雷行为保持一致。

## Git 仓库与 Docker 部署

项目已整理为独立 Git 仓库。获取仓库后，在项目根目录执行：

```bash
git clone /path/to/yunsuo-docker.bundle yunsuo
cd yunsuo
```

也可以直接把项目目录作为 Git 远程仓库使用。

```powershell
Copy-Item .env.example .env
# 修改 .env 中的数据库密码、JWT_SECRET、COOKIE_SECRET 和 ADMIN_PASSWORD
docker compose up -d --build
```

Linux/macOS 使用：

```bash
cp .env.example .env
docker compose up -d --build
```

默认打开 `http://localhost:18088`。服务器部署时访问 `http://服务器IP:18088`，并确保防火墙放行该端口。端口可在 `.env` 中通过 `APP_PORT` 修改。

Compose 会等待 MySQL 和后端健康检查通过后再启动前端。缺少生产密钥时容器不会启动，避免误用开发默认值。

查看状态与日志：

```powershell
docker compose ps
docker compose logs -f backend
```

完全清空数据库并重新部署：

```powershell
docker compose down -v
docker compose up -d --build
```

## 环境变量

复制 `.env.example` 为 `.env`，生产环境必须更换所有默认值。

| 变量 | 说明 |
| --- | --- |
| `MYSQL_ROOT_PASSWORD` | MySQL root 密码 |
| `MYSQL_PASSWORD` | 应用数据库用户密码 |
| `JWT_SECRET` | 登录 JWT 签名密钥，至少 32 位随机字符 |
| `COOKIE_SECRET` | 网盘 Cookie 加密密钥，更换后旧账号需重新登录 |
| `ADMIN_USERNAME` | 管理员用户名，默认 `admin` |
| `ADMIN_PASSWORD` | 管理员登录密码，首次启动时用于创建管理员 |
| `APP_PORT` | Web 访问端口，默认 `18088` |
| `COMPOSE_PROJECT_NAME` | Compose 项目名，默认 `yunsuo` |
| `DESKTOP_DOWNLOAD_URL` | 可选，桌面端 EXE 的外部下载地址；留空时使用本站 `/downloads/YunsuoDesktop-1.1.1.exe` |

后端还支持 `PORT`、`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_DATABASE`。这些在 Compose 网络内已配置好，通常不需要修改。

## 桌面端下载与使用

登录后点击网页右上角「桌面端」，即可下载 Windows x64 便携版并查看图文步骤。默认下载地址为：

```text
http://你的部署地址/downloads/YunsuoDesktop-1.1.1.exe
```

本地构建前把 EXE 放入前端静态目录，Docker 构建时会一起写入前端镜像：

```powershell
New-Item -ItemType Directory -Force frontend\public\downloads | Out-Null
Copy-Item desktop-lite\release\YunsuoDesktop-1.1.1.exe frontend\public\downloads\YunsuoDesktop-1.1.1.exe
docker compose up -d --build frontend
```

如果使用 GitHub Releases、对象存储或 CDN，在 `.env` 中设置 `DESKTOP_DOWNLOAD_URL` 后重新构建前端：

```text
DESKTOP_DOWNLOAD_URL=https://你的下载地址/YunsuoDesktop-1.1.1.exe
```

使用步骤：

1. 下载并运行 `YunsuoDesktop-1.1.1.exe`。未签名版本出现 SmartScreen 提示时，选择「更多信息」后确认运行。
2. 填写当前云梭的登录地址、账号和密码。默认直接登录；服务器开启时可勾选「登录前验证服务器」先做连通性预检。
3. 登录 Token 通过 Windows `safeStorage` 加密保存在本机，下次启动自动登录。
4. 完整站点包含概览、智能转存、网盘账号、任务、分享库、我的空间、链接监控与管理员后台。
5. 监控创建时可选择云端或本地；本地监控由桌面端在线时每 15 秒触发检查，关闭桌面端后自动暂停。

桌面端不会保存站点密码，也不会保存百度、夸克、迅雷 Cookie。Token 等同登录凭证，请勿发送给他人。

## 管理后台

- 后端启动时会检查 `ADMIN_USERNAME`：账号不存在则使用 `ADMIN_PASSWORD` 创建管理员。
- 如果同名账号已存在，只有密码与 `ADMIN_PASSWORD` 一致时才会补上管理员权限，避免把普通账号误提权。
- 管理员登录后，侧边栏会多出「管理后台」，可分页管理用户、加密 Cookie 与全站转存链接。
- 转存记录会关联任务 ID 和批次 ID，后台可直接关联到对应的再分享链接；旧记录也能按用户、平台和标题兼容匹配。
- 后台删除转存记录只删除数据库档案，不删除用户网盘文件，也不撤销已生成分享。
- Cookie 明文不会出现在列表 API 中，只有管理员点击查看时才会通过 `no-store` 接口单独读取，并再次加密保存。

## 公开资源接口（保留给后续盘搜）

以下无登录接口可供盘搜或后续搜索引擎读取：

```text
GET /api/public/resources?q=关键词&provider=quark&page=1&pageSize=20
GET /api/public/users/:username
GET /api/public/users/:username/resources?page=1&pageSize=20
```

公开接口使用 `Cache-Control: no-store`，避免失效或已删除分享被缓存继续展示。
- 普通用户不会看到该入口，即使手动请求后台 API 也会返回 `403`。
- 管理员密码可在 `.env` 中查看和修改。修改已创建管理员的密码后，不会自动重置数据库中的旧密码。

## 网盘能力边界

| 网盘 | 扫码登录 | 转存 | 再分享 |
| --- | --- | --- | --- |
| 夸克网盘 | 真实扫码 CAS 轮询 | 已接入网页端任务轮询 | 已接入分享任务与分享链接接口 |
| 百度网盘 | 社区逆向扫码 | 实验性 | 实验性 |
| 迅雷网盘 | 新版设备码扫码 | 实验性 | 实验性 |
| 演示空间 | 模拟扫码 | 完整模拟 | 完整模拟 |

说明：

- 夸克扫码与未扫码轮询已实测；真实账号的转存、分享仍建议先用小文件验收。
- 百度受登录风控、BDSTOKEN 和分享页策略影响较大，失败时可手动粘贴完整登录 Cookie。
- 迅雷使用新版 OAuth 设备码与 `session/v1/register` 换取会话，社区接口可能随官方更新而变化。
- 百度、夸克、迅雷均保留手动 Cookie 兜底。Cookie 属于敏感凭据，数据库已加密存储，但仍应限制数据库和 `.env` 的访问权限。
- 第三方网盘接口并非公开稳定 API，不能承诺长期不失效。请遵守各网盘服务条款及当地法律法规。

## 技术结构

```text
backend/src/
  index.js                 Express 入口与 API 挂载
  config.js                运行配置
  db.js                    MySQL 表结构、数据访问、Cookie 加密
  auth.js                  JWT 鉴权
  routes/admin.js          管理员统计与全站转存检索
  queue.js                 转存任务队列
  routes/                  认证、账号、转存、任务、分享、概览
  providers/               百度、夸克、迅雷、演示空间驱动
  utils/parse.js           分享链接正则解析

frontend/src/
  App.vue                  登录门禁、侧边栏、页面过渡
  views/                   概览、智能转存、账号、任务、分享、文件
  components/              二维码、桌面端说明、目录选择器、Toast
  styles.css               视觉系统与动画
```

前端由 Nginx 提供静态文件，并将 `/api/` 反向代理到后端；后端连接私有 Compose 网络中的 MySQL 8。

## 验收流程

1. 注册一个新用户并登录。
2. 在「网盘账号」连接「演示空间」。
3. 在「智能转存」粘贴夸克示例链接，识别后开始转存。
4. 在「任务中心」查看任务完成。
5. 在「分享库」看到新分享链接，在「我的空间」浏览转存目录。

这套流程已经通过端到端测试，并验证了第二个用户无法读取第一个用户的账号、任务、分享、资源和文件目录。
