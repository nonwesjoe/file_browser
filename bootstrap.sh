#!/usr/bin/env bash
set -e

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Web 文件管理器 — 远程一键安装
# 用法: curl -sSL https://raw.githubusercontent.com/nonwesjoe/file_browser/main/bootstrap.sh | bash
#
# 可选参数（通过环境变量传递）:
#   PORT=8080  STORAGE_ROOT=/data  INSTALL_DIR=~/myapp  bash bootstrap.sh
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REPO_URL="https://github.com/nonwesjoe/file_browser.git"
INSTALL_DIR="${INSTALL_DIR:-$HOME/web-file-manager}"
PORT="${PORT:-3000}"
STORAGE_ROOT="${STORAGE_ROOT:-$INSTALL_DIR/storage}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  📁 ${BOLD}Web 文件管理器 — 远程安装${NC}               ${CYAN}║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# ── Check git ────────────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  echo -e "${RED}✗ 未找到 git，正在安装 ...${NC}"
  if command -v apt-get &>/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq git
  elif command -v yum &>/dev/null; then
    sudo yum install -y git
  elif command -v brew &>/dev/null; then
    brew install git
  else
    echo -e "${RED}✗ 无法自动安装 git，请手动安装后重试${NC}"
    exit 1
  fi
fi

# ── Clone or update ──────────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${YELLOW}→ 目录已存在，拉取最新代码 ...${NC}"
  cd "$INSTALL_DIR"
  git pull --ff-only 2>&1 | tail -1
else
  echo -e "${YELLOW}→ 克隆仓库到 $INSTALL_DIR ...${NC}"
  git clone "$REPO_URL" "$INSTALL_DIR" 2>&1 | tail -3
  cd "$INSTALL_DIR"
fi

# ── Run installer ────────────────────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/install.sh" ]; then
  echo -e "${RED}✗ 仓库中未找到 install.sh，请检查仓库是否完整${NC}"
  exit 1
fi

echo ""
cd "$INSTALL_DIR"
bash install.sh --port "$PORT" --storage "$STORAGE_ROOT"

# ── Print final instructions ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}项目已安装到:${NC} ${CYAN}$INSTALL_DIR${NC}"
echo ""
echo -e "  启动:"
echo -e "    ${CYAN}cd $INSTALL_DIR && npm run dev${NC}"
echo ""
echo -e "  安装为系统服务:"
echo -e "    ${CYAN}cd $INSTALL_DIR && bash install.sh --service${NC}"
echo ""
