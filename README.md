# 📁 Web 文件管理器

一个轻量、安全、开箱即用的 Web 文件管理器。无需数据库，直接管理服务器上的文件。

![Node.js](https://img.shields.io/badge/Node.js-≥18-green) ![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue) ![Express](https://img.shields.io/badge/Express-5.x-lightgrey) ![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ 功能特性

| 分类 | 功能 | 说明 |
|------|------|------|
| **文件浏览** | 网格 / 列表视图 | 一键切换 |
| | 面包屑导航 | 点击任意层级快速跳转 |
| | 文件信息 | 显示文件名、大小（自适应 B/KB/MB/GB）、修改时间、类型图标 |
| **文件操作** | 上传 | 拖拽上传 + 点击选择，支持批量上传 |
| | 下载 | 点击文件直接下载 |
| | 新建文件夹 | 弹窗输入名称 |
| | 重命名 | 行内编辑，Enter 确认，Esc 取消 |
| | 删除 | 二次确认弹窗，防止误删 |
| **预览** | 图片缩略图 | 自动生成 WebP 缩略图，支持 jpg/png/gif/webp/svg/avif |
| | 文本预览 | 点击文本文件弹出预览窗口，带行号，支持 50+ 种格式 |
| | 图片全屏 | 点击图片查看原始尺寸 |
| **安全** | 路径隔离 | 所有操作限制在指定存储目录内 |
| | 路径遍历防护 | `../../etc/passwd` 等攻击自动拦截 |
| **体验** | 响应式设计 | 适配桌面端和移动端 |
| | Toast 通知 | 操作成功/失败实时反馈 |
| | 键盘支持 | Escape 关闭弹窗，Enter 提交表单 |

## 🚀 安装

### 环境要求

- Node.js ≥ 18

### 方式一：curl 一行命令（推荐）

```bash
curl -sSL https://raw.githubusercontent.com/nonwesjoe/file_browser/main/bootstrap.sh | bash
```

### 方式二：手动克隆

```bash
git clone https://github.com/nonwesjoe/file_browser.git web-file-manager
cd web-file-manager
bash install.sh
```

安装脚本自动完成：检查 Node.js 版本 → 安装依赖 → 编译项目 → 创建存储目录。

## ▶️ 启动

安装完成后，进入项目目录启动服务：

```bash
cd ~/web-file-manager

# 启动（默认端口 3000，默认存储目录 ./storage）
npm run dev
```

浏览器打开 **http://localhost:3000** 即可使用。

### 设置监听端口

```bash
# 使用 8080 端口
PORT=8080 npm run dev
```

### 设置存储根目录

`STORAGE_ROOT` 决定了文件管理器能访问哪个文件夹。用户在浏览器中看到的所有文件都来自这个目录。

```bash
# 管理 /home/user/documents 目录下的文件
STORAGE_ROOT=/home/user/documents npm run dev

# 管理 NAS 挂载目录
STORAGE_ROOT=/mnt/nas/shared npm run dev

# 管理外接硬盘
STORAGE_ROOT=/media/usb-drive npm run dev
```

> **注意**：`STORAGE_ROOT` 支持绝对路径和相对路径。相对路径是相对于项目根目录。如果目录不存在会自动创建。

### 同时设置端口和存储目录

```bash
PORT=8080 STORAGE_ROOT=/data/files npm run dev
```

### 生产模式运行

```bash
# 先编译
npm run build

# 再启动（不自动编译，性能更好）
PORT=80 STORAGE_ROOT=/data/files npm start
```

### 安装为系统服务（开机自启）

```bash
# 安装时指定端口和存储目录
bash install.sh --port 80 --storage /data/files --service

# 管理服务
sudo systemctl start web-file-manager    # 启动
sudo systemctl stop web-file-manager     # 停止
sudo systemctl restart web-file-manager  # 重启
sudo systemctl status web-file-manager   # 查看状态
sudo journalctl -u web-file-manager -f   # 查看日志
```

## ⚙️ 配置汇总

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PORT` | `3000` | 服务器监听端口 |
| `STORAGE_ROOT` | `./storage` | 文件存储根目录，即用户在浏览器中看到的"根目录" |

### 常见场景示例

| 场景 | 命令 |
|------|------|
| 本地使用，默认配置 | `npm run dev` |
| 指定端口 | `PORT=8080 npm run dev` |
| 管理指定目录的文件 | `STORAGE_ROOT=/home/me/docs npm run dev` |
| 服务器部署 | `PORT=80 STORAGE_ROOT=/data npm start` |
| 系统服务 + 开机自启 | `bash install.sh --port 80 --storage /data --service` |

## 📡 API 接口

所有文件路径均为相对于 `STORAGE_ROOT` 的路径，以 `/` 开头。

| 方法 | 路径 | 说明 | 参数 |
|------|------|------|------|
| `GET` | `/api/config` | 获取服务器配置 | — |
| `GET` | `/api/files` | 列出目录内容 | `?path=/dir` |
| `GET` | `/api/thumbnail` | 获取图片缩略图 (WebP) | `?path=/image.jpg` |
| `GET` | `/api/preview` | 获取文本文件内容 | `?path=/file.txt` |
| `GET` | `/api/download` | 下载文件 | `?path=/file` |
| `POST` | `/api/upload` | 上传文件 | FormData: `targetPath`, `files` |
| `POST` | `/api/mkdir` | 创建文件夹 | JSON: `{ parentPath, name }` |
| `POST` | `/api/rename` | 重命名 | JSON: `{ oldPath, newName }` |
| `DELETE` | `/api/delete` | 删除文件/文件夹 | JSON: `{ path }` |

### 响应格式

成功：

```json
{ "success": true, "items": [...] }
```

失败：

```json
{ "error": "错误信息" }
```

## 🏗️ 项目结构

```
web-file-manager/
├── src/
│   └── server.ts              # 后端服务（路由 + 安全 + 文件操作）
├── public/
│   ├── index.html             # 页面结构
│   ├── css/style.css          # 样式
│   └── js/app.js              # 前端交互逻辑
├── storage/                   # 默认文件存储目录
├── install.sh                 # 一键安装脚本
├── bootstrap.sh               # 远程安装引导脚本
├── uninstall.sh               # 卸载脚本
├── start.sh                   # 启动脚本
├── package.json
├── tsconfig.json
└── CLAUDE.md                  # 开发指引
```

### 技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| 后端 | Express 5 + TypeScript | HTTP 服务、RESTful API |
| 文件上传 | Multer | multipart/form-data 解析 |
| 图片处理 | Sharp | 缩略图生成（WebP 格式，256px） |
| 前端 | 原生 HTML/CSS/JS | 零依赖单页应用 |

## 🔒 安全设计

- **路径隔离**：`safePath()` 函数是唯一的安全边界，所有用户输入的路径在访问文件系统前都经过此函数校验
- **路径遍历防护**：解析后的绝对路径必须以 `STORAGE_ROOT` 开头，否则返回 403
- **删除保护**：存储根目录本身不可删除
- **无敏感信息**：不记录、不暴露服务器文件系统结构

## 🛠️ 开发

```bash
# 类型检查（不输出文件）
npx tsc --noEmit

# 编译
npm run build

# 运行编译后的版本
npm start
```

项目使用 Express 5（非 4），异步路由需要通过 `asyncHandler()` 包装。新增文件操作路由时，必须调用 `safePath()` 校验路径。

## 📄 许可证

[MIT](LICENSE)
