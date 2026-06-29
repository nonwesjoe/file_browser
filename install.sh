#!/usr/bin/env bash
set -e

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Web 文件管理器 — 一键安装脚本
# 用法: bash install.sh [--port 端口] [--storage 存储目录] [--service]
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
INSTALL_SERVICE=false
SERVICE_NAME="web-file-manager"

# ── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)       PORT="$2"; shift 2 ;;
    --storage)    STORAGE_ROOT="$(realpath "$2")"; shift 2 ;;
    --service)    INSTALL_SERVICE=true; shift ;;
    --name)       SERVICE_NAME="$2"; shift 2 ;;
    -h|--help)
      echo "用法: bash install.sh [选项]"
      echo ""
      echo "选项:"
      echo "  --port 端口        设置监听端口 (默认: 3000)"
      echo "  --storage 目录     设置存储目录 (默认: ./storage)"
      echo "  --service          安装为 systemd 服务"
      echo "  --name 名称        服务名称 (默认: web-file-manager)"
      echo "  -h, --help         显示帮助"
      exit 0 ;;
    *) echo "未知选项: $1"; exit 1 ;;
  esac
done

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  📁 ${BOLD}Web 文件管理器 — 安装程序${NC}               ${CYAN}║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Check Node.js ────────────────────────────────────────────────────
echo -e "${BOLD}[1/4]${NC} 检查 Node.js ..."

if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ 未找到 Node.js${NC}"
  echo ""
  echo "  请先安装 Node.js ≥ 18："
  echo ""
  echo "  # Ubuntu / Debian"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  echo ""
  echo "  # macOS"
  echo "  brew install node"
  echo ""
  echo "  # 或使用 nvm"
  echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
  echo "  nvm install 20"
  echo ""
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo -e "${RED}✗ Node.js 版本过低: $(node -v)，需要 ≥ 18${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ Node.js $(node -v)${NC}"

# ── Step 2: Install dependencies ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/4]${NC} 安装依赖 ..."

npm install --production=false 2>&1 | tail -3
echo -e "${GREEN}  ✓ 依赖安装完成${NC}"

# ── Step 3: Build ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/4]${NC} 编译项目 ..."

npx tsc --skipLibCheck 2>&1
echo -e "${GREEN}  ✓ 编译完成${NC}"

# ── Step 4: Create directories ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/4]${NC} 初始化目录 ..."

mkdir -p "$STORAGE_ROOT"
mkdir -p "$SCRIPT_DIR/.cache_thumbs"
echo -e "${GREEN}  ✓ 存储目录: $STORAGE_ROOT${NC}"

# ── Optional: Install systemd service ────────────────────────────────────────
if [ "$INSTALL_SERVICE" = true ]; then
  echo ""
  echo -e "${BOLD}[+]${NC} 安装 systemd 服务 ..."

  NODE_PATH=$(which node)
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Web 文件管理器
After=network.target

[Service]
Type=simple
WorkingDirectory=$SCRIPT_DIR
ExecStart=$NODE_PATH $SCRIPT_DIR/dist/server.js
Restart=on-failure
RestartSec=5
Environment=PORT=$PORT
Environment=STORAGE_ROOT=$STORAGE_ROOT

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl start "$SERVICE_NAME"

  echo -e "${GREEN}  ✓ 服务已安装并启动${NC}"
  echo -e "  管理命令:"
  echo -e "    ${CYAN}sudo systemctl start $SERVICE_NAME${NC}"
  echo -e "    ${CYAN}sudo systemctl stop $SERVICE_NAME${NC}"
  echo -e "    ${CYAN}sudo systemctl restart $SERVICE_NAME${NC}"
  echo -e "    ${CYAN}sudo systemctl status $SERVICE_NAME${NC}"
  echo -e "    ${CYAN}sudo journalctl -u $SERVICE_NAME -f${NC}"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ✅ ${BOLD}安装完成！${NC}                                ${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  访问地址:  ${CYAN}http://localhost:$PORT${NC}"
echo -e "  存储目录:  ${CYAN}$STORAGE_ROOT${NC}"
echo ""

if [ "$INSTALL_SERVICE" = false ]; then
  echo -e "  启动方式:"
  echo -e "    ${CYAN}npm run dev${NC}        # 开发模式（自动编译）"
  echo -e "    ${CYAN}npm start${NC}          # 生产模式"
  echo -e "    ${CYAN}./start.sh${NC}         # 等效于 npm run dev"
  echo ""
  echo -e "  如需安装为系统服务（开机自启）："
  echo -e "    ${CYAN}bash install.sh --service${NC}"
fi

echo ""
