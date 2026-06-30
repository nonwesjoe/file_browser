#!/usr/bin/env bash
set -e

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Web 文件管理器 — 一键安装
#
# 用法:
#   bash install.sh                                # 安装依赖 + 编译
#   bash install.sh --service                      # 安装并注册为 systemd 服务
#   bash install.sh --service --port 8080          # 自定义端口
#   bash install.sh --service --storage /data      # 自定义存储目录
#   bash install.sh --service --user www-data      # 指定运行用户
#   bash install.sh --remove                       # 卸载 systemd 服务
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PORT=3000
STORAGE_ROOT="$SCRIPT_DIR/storage"
SERVICE_NAME="web-file-manager"
RUN_USER="$(whoami)"
INSTALL_SERVICE=false
REMOVE_SERVICE=false

# ── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)       PORT="$2"; shift 2 ;;
    --storage)    STORAGE_ROOT="$(realpath "$2" 2>/dev/null || echo "$2")"; shift 2 ;;
    --service)    INSTALL_SERVICE=true; shift ;;
    --name)       SERVICE_NAME="$2"; shift 2 ;;
    --user)       RUN_USER="$2"; shift 2 ;;
    --remove)     REMOVE_SERVICE=true; shift ;;
    -h|--help)
      echo "用法: bash install.sh [选项]"
      echo ""
      echo "选项:"
      echo "  --port 端口        监听端口 (默认: 3000)"
      echo "  --storage 目录     存储目录 (默认: ./storage)"
      echo "  --service          安装为 systemd 服务（开机自启）"
      echo "  --user 用户        服务运行用户 (默认: 当前用户)"
      echo "  --name 名称        服务名称 (默认: web-file-manager)"
      echo "  --remove           卸载 systemd 服务"
      echo "  -h, --help         显示帮助"
      exit 0 ;;
    *) echo -e "${RED}未知选项: $1${NC}"; exit 1 ;;
  esac
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 卸载模式
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if [ "$REMOVE_SERVICE" = true ]; then
  echo ""
  echo -e "${BOLD}卸载服务: ${SERVICE_NAME}${NC}"
  echo ""

  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  if [ ! -f "$SERVICE_FILE" ]; then
    echo -e "${YELLOW}服务 ${SERVICE_NAME} 不存在${NC}"
    exit 0
  fi

  echo -e "${YELLOW}[1/3]${NC} 停止服务..."
  sudo systemctl stop "$SERVICE_NAME" 2>/dev/null && echo -e "${GREEN}  ✓ 已停止${NC}" || echo -e "${YELLOW}  - 未运行${NC}"

  echo -e "${YELLOW}[2/3]${NC} 禁用开机启动..."
  sudo systemctl disable "$SERVICE_NAME" 2>/dev/null && echo -e "${GREEN}  ✓ 已禁用${NC}" || echo -e "${YELLOW}  - 未启用${NC}"

  echo -e "${YELLOW}[3/3]${NC} 删除服务文件..."
  sudo rm -f "$SERVICE_FILE"
  sudo systemctl daemon-reload
  echo -e "${GREEN}  ✓ 已删除${NC}"

  echo ""
  echo -e "${GREEN}✅ 服务已卸载${NC}"
  echo "  项目文件未删除，如需彻底清理: rm -rf $SCRIPT_DIR"
  echo ""
  exit 0
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 安装模式
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  📁 ${BOLD}Web 文件管理器 — 安装程序${NC}               ${CYAN}║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Check Node.js ─────────────────────────────────────────────────────────
echo -e "${BOLD}[1/4]${NC} 检查 Node.js ..."
if ! command -v node &>/dev/null; then
  echo -e "${RED}  ✗ 未找到 Node.js${NC}"
  echo ""
  echo "  请先安装 Node.js ≥ 18："
  echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "    sudo apt install -y nodejs"
  exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo -e "${RED}  ✗ Node.js 版本过低: $(node -v)，需要 ≥ 18${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ Node.js $(node -v)${NC}"

# ── 2. Install dependencies ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/4]${NC} 安装依赖 ..."
npm install --production=false 2>&1 | tail -2
echo -e "${GREEN}  ✓ 依赖安装完成${NC}"

# ── 3. Build ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/4]${NC} 编译项目 ..."
npx tsc --skipLibCheck 2>&1
echo -e "${GREEN}  ✓ 编译完成${NC}"

# ── 4. Create directories ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/4]${NC} 初始化目录 ..."
mkdir -p "$STORAGE_ROOT"
mkdir -p "$SCRIPT_DIR/.cache_thumbs"
echo -e "${GREEN}  ✓ 存储目录: $STORAGE_ROOT${NC}"

# ── Optional: systemd service ────────────────────────────────────────────────
if [ "$INSTALL_SERVICE" = true ]; then
  echo ""
  echo -e "${BOLD}[+]${NC} 注册 systemd 服务 ..."

  NODE_PATH=$(which node)
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

  # Stop if already running
  sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true

  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Web 文件管理器
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${NODE_PATH} ${SCRIPT_DIR}/dist/server.js
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=3

Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=STORAGE_ROOT=${STORAGE_ROOT}

NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${STORAGE_ROOT} ${SCRIPT_DIR}/.cache_thumbs ${SCRIPT_DIR}/.tmp_uploads ${SCRIPT_DIR}/.trash

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl start "$SERVICE_NAME"

  sleep 1
  if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    echo -e "${GREEN}  ✓ 服务已安装并启动${NC}"
  else
    echo -e "${RED}  ✗ 服务启动失败，运行 sudo journalctl -u ${SERVICE_NAME} 查看日志${NC}"
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ✅ ${BOLD}安装完成！${NC}                                ${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  访问地址:  ${CYAN}http://localhost:${PORT}${NC}"
echo -e "  存储目录:  ${CYAN}${STORAGE_ROOT}${NC}"
echo ""

if [ "$INSTALL_SERVICE" = true ]; then
  echo -e "  ${BOLD}服务管理:${NC}"
  echo -e "    启动:   ${CYAN}sudo systemctl start ${SERVICE_NAME}${NC}"
  echo -e "    停止:   ${CYAN}sudo systemctl stop ${SERVICE_NAME}${NC}"
  echo -e "    重启:   ${CYAN}sudo systemctl restart ${SERVICE_NAME}${NC}"
  echo -e "    状态:   ${CYAN}sudo systemctl status ${SERVICE_NAME}${NC}"
  echo -e "    日志:   ${CYAN}sudo journalctl -u ${SERVICE_NAME} -f${NC}"
  echo -e "    卸载:   ${CYAN}bash install.sh --remove${NC}"
  echo ""
  echo -e "  ${BOLD}更新项目:${NC}"
  echo -e "    ${CYAN}bash update.sh --service ${SERVICE_NAME}${NC}"
  echo -e "    拉取最新代码 → 重新安装依赖 → 编译 → 重启服务 (一行完成)"
else
  echo -e "  ${BOLD}启动方式:${NC}"
  echo -e "    ${CYAN}npm run dev${NC}        # 开发模式（自动编译）"
  echo -e "    ${CYAN}npm start${NC}          # 生产模式"
  echo ""
  echo -e "  安装为系统服务（开机自启）:"
  echo -e "    ${CYAN}sudo bash install.sh --service${NC}"
  echo ""
  echo -e "  ${BOLD}更新项目:${NC}"
  echo -e "    ${CYAN}bash update.sh${NC}    # 仅拉取代码 + 重建"
fi
echo ""
