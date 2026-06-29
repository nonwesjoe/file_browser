# 📁 Web 文件管理器

一个轻量、安全、可定制的 Web 文件管理器。无需数据库，通过浏览器管理服务器文件。

![Node.js](https://img.shields.io/badge/Node.js-≥18-green) ![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue) ![Express](https://img.shields.io/badge/Express-5.x-lightgrey) ![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ 功能

| 分类 | 功能 |
|------|------|
| **浏览** | 网格/列表视图 · 面包屑导航 · 隐藏文件过滤 · 排序（名称/日期/大小/类型） · 文件搜索 |
| **操作** | 拖拽上传（带进度条） · 下载 · 新建文件夹 · 行内重命名 · 删除（二次确认） · 拖动移动文件 · 多选（Ctrl/Shift） |
| **预览** | 图片缩略图（WebP） · 图片全屏 · 文本预览（带行号，50+ 格式） |
| **交互** | 右键菜单 · 快捷键 · Toast 通知 · 壁纸主题 · 响应式设计 · 动效 |
| **安全** | 登录认证 · 路径遍历防护 · 登录限流 · Session 自动清理 |
| **部署** | config.json 统一配置 · systemd 服务一键安装 · curl 远程安装 |

## 🚀 快速开始

```bash
# curl 一行安装
curl -sSL https://raw.githubusercontent.com/nonwesjoe/file_browser/main/bootstrap.sh | bash

# 启动
cd ~/web-file-manager && npm run dev
```

浏览器打开 **http://localhost:3000**，默认账号密码 `admin`。

## ⚙️ 配置

所有配置集中在 `config.json`，修改后重启生效：

```json
{
  "username": "admin",
  "password": "admin",
  "port": 3000,
  "host": "0.0.0.0",
  "storageRoot": "./storage",
  "theme": {
    "primary": "#4f46e5",
    "danger": "#ef4444",
    "success": "#10b981",
    "bg": "#f0f2f5",
    "logoText": "Web 文件管理器"
  }
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `username` | `admin` | 登录账号 |
| `password` | `admin` | 登录密码 |
| `port` | `3000` | 监听端口 |
| `host` | `0.0.0.0` | 绑定地址（`0.0.0.0` 所有网卡，`127.0.0.1` 仅本机） |
| `storageRoot` | `./storage` | 文件存储根目录 |
| `theme.*` | — | 主题配色（主色、危险色、成功色、背景色、标题文字） |

> 环境变量 `PORT` 和 `STORAGE_ROOT` 可覆盖 config.json 中的对应值。

## ▶️ 启动方式

```bash
# 开发模式（自动编译）
npm run dev

# 生产模式
npm run build && npm start

# 安装为 systemd 服务（开机自启）
sudo bash install.sh --service --port 80 --storage /data/files

# 卸载服务
sudo bash install.sh --remove
```

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `/` | 聚焦搜索框 |
| `Delete` | 删除选中文件 |
| `F2` | 重命名选中文件 |
| `Backspace` | 返回上级目录 |
| `Ctrl+A` | 全选 |
| `Ctrl+Click` | 多选 |
| `Shift+Click` | 范围选择 |
| `Esc` | 关闭弹窗 / 退出搜索 |
| 双击 | 打开文件夹 / 预览文件 |

## 📡 API

所有文件路径相对于 `storageRoot`，以 `/` 开头。需登录后携带 Cookie 访问。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/login` | 登录 `{ username, password }` |
| `POST` | `/api/logout` | 退出 |
| `GET` | `/api/auth` | 检查登录状态 |
| `GET` | `/api/theme` | 获取主题（无需登录） |
| `GET` | `/api/config` | 获取完整配置 |
| `GET` | `/api/files?path=/` | 列出目录 |
| `GET` | `/api/thumbnail?path=` | 图片缩略图 |
| `GET` | `/api/preview?path=` | 文本预览 |
| `GET` | `/api/download?path=` | 下载文件 |
| `POST` | `/api/upload` | 上传（FormData） |
| `POST` | `/api/mkdir` | 新建文件夹 |
| `POST` | `/api/rename` | 重命名 |
| `POST` | `/api/move` | 移动文件 |
| `DELETE` | `/api/delete` | 删除 |

## 🏗️ 项目结构

```
web-file-manager/
├── src/server.ts           # 后端（路由 + 认证 + 安全 + 文件操作）
├── public/
│   ├── index.html          # 主页
│   ├── login.html          # 登录页
│   ├── css/style.css       # 样式 + 动效
│   └── js/app.js           # 前端逻辑
├── config.json             # 配置文件
├── storage/                # 文件存储目录
├── install.sh              # 安装（可选 --service）
├── bootstrap.sh            # curl 远程安装引导
├── uninstall.sh            # 完整卸载
├── start.sh                # 快速启动
├── package.json
├── tsconfig.json
├── CLAUDE.md               # 开发指引
└── LICENSE
```

## 🔒 安全

- **登录认证**：Cookie Session，7 天有效期
- **登录限流**：5 次失败锁定 5 分钟
- **路径隔离**：`safePath()` 校验所有用户路径
- **路径遍历防护**：`../../etc/passwd` 等攻击返回 403
- **Session 清理**：每 10 分钟自动清除过期 session
- **systemd 加固**：`NoNewPrivileges`、`ProtectSystem=strict`

## 🛠️ 开发

```bash
npx tsc --noEmit    # 类型检查
npm run build       # 编译
npm start           # 运行
```

Express 5 + TypeScript，异步路由用 `asyncHandler()` 包装，新增文件路由必须调用 `safePath()`。

## 📄 许可证

[MIT](LICENSE)
