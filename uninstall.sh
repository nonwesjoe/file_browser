#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

SERVICE_NAME="web-file-manager"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo ""
echo -e "${BOLD}Web 文件管理器 — 卸载程序${NC}"
echo ""

# ── Stop and remove service ──────────────────────────────────────────────────
if [ -f "$SERVICE_FILE" ]; then
  echo -e "${YELLOW}[1/3]${NC} 停止并移除 systemd 服务 ..."
  sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  sudo rm -f "$SERVICE_FILE"
  sudo systemctl daemon-reload
  echo -e "${GREEN}  ✓ 服务已移除${NC}"
else
  echo -e "${YELLOW}[1/3]${NC} 未发现 systemd 服务，跳过"
fi

# ── Clean build artifacts ───────────────────────────────────────────────────
echo -e "${YELLOW}[2/3]${NC} 清理构建产物 ..."
rm -rf "$SCRIPT_DIR/dist" "$SCRIPT_DIR/.cache_thumbs" "$SCRIPT_DIR/.tmp_uploads"
echo -e "${GREEN}  ✓ 已清理 dist/、.cache_thumbs/、.tmp_uploads/${NC}"

# ── Remove node_modules ─────────────────────────────────────────────────────
echo -e "${YELLOW}[3/3]${NC} 删除 node_modules ..."
rm -rf "$SCRIPT_DIR/node_modules"
echo -e "${GREEN}  ✓ 已删除 node_modules/${NC}"

echo ""
echo -e "${GREEN}✅ 卸载完成${NC}"
echo ""
echo "  storage/ 目录中的用户文件未被删除。"
echo "  如需彻底删除项目，运行："
echo -e "    ${YELLOW}rm -rf $SCRIPT_DIR${NC}"
echo ""
