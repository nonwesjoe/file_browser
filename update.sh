#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Web 文件管理器 — 一键更新
#
# 用法:
#   bash update.sh                          # 拉代码 + 重建 (不重启服务)
#   bash update.sh --service web-file-manager   # 拉代码 + 重建 + 重启服务
#   bash update.sh --no-build               # 仅拉代码 (用于纯前端修改但本项目无此情况)
#
# 流程: git pull → npm ci → npm run build → (可选) 重启 systemd 服务
# 失败时立即退出,不会留下半完成状态。
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SERVICE_NAME=""
RESTART_SERVICE=false
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)   SERVICE_NAME="$2"; RESTART_SERVICE=true; shift 2 ;;
    --no-build)  SKIP_BUILD=true; shift ;;
    -h|--help)
      echo "用法: bash update.sh [选项]"
      echo ""
      echo "选项:"
      echo "  --service 名称   重建完成后重启指定的 systemd 服务"
      echo "  --no-build       跳过 npm ci 与编译 (仅拉取代码)"
      echo "  -h, --help       显示帮助"
      exit 0 ;;
    *) echo -e "${RED}未知选项: $1${NC}"; exit 1 ;;
  esac
done

# ── 前置检查 ────────────────────────────────────────────────────────────────
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo -e "${RED}✗ 当前目录不是 git 仓库,update.sh 仅适用于 git 安装${NC}"
  echo "  如果是通过 curl | bash 安装的,请重新运行 bootstrap.sh 进行更新。"
  exit 1
fi

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  🔄 ${BOLD}Web 文件管理器 — 更新${NC}                   ${CYAN}║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. 拉取代码 ─────────────────────────────────────────────────────────────
echo -e "${BOLD}[1/4]${NC} 拉取最新代码 ..."
LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "  当前 commit: $LOCAL"
# --ff-only 拒绝非快进合并,避免本地未提交改动被覆盖
if ! git pull --ff-only 2>&1; then
  echo -e "${RED}  ✗ git pull 失败${NC}"
  echo "  常见原因: 本地有未提交的修改 (例如编辑了 config.json)"
  echo "  解决办法:"
  echo "    1) 提交: git add -A && git commit -m 'local changes'"
  echo "    2) 暂存: git stash (更新后用 git stash pop 恢复)"
  echo "    3) 放弃: git checkout ."
  exit 1
fi
NEW=$(git rev-parse HEAD)
if [ "$LOCAL" = "$NEW" ]; then
  echo -e "${YELLOW}  - 已是最新版本${NC}"
else
  echo -e "${GREEN}  ✓ 已更新到 $NEW${NC}"
fi

if [ "$SKIP_BUILD" = true ]; then
  echo ""
  echo -e "${GREEN}✅ 仅拉取代码完成 (跳过构建)${NC}"
  exit 0
fi

# ── 2. 备份本地 config.json ───────────────────────────────────────────────
# config.json 提交到仓库,但用户可能修改过端口、密码等。备份以便回滚。
echo ""
echo -e "${BOLD}[2/4]${NC} 备份本地配置 ..."
if [ -f config.json ]; then
  cp config.json config.json.bak.$(date +%Y%m%d-%H%M%S)
  echo -e "${GREEN}  ✓ 已备份到 config.json.bak.*${NC}"
else
  echo -e "${YELLOW}  - 未发现 config.json,跳过${NC}"
fi

# ── 3. 重新安装依赖并编译 ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/4]${NC} 安装依赖并编译 ..."
# npm ci 比 npm install 更严格:严格按 package-lock.json 安装,产出可复现
if ! npm ci --omit=dev=false 2>&1 | tail -3; then
  echo -e "${RED}  ✗ npm ci 失败${NC}"
  exit 1
fi
if ! npx tsc --skipLibCheck 2>&1; then
  echo -e "${RED}  ✗ 编译失败,服务未重启 (dist/ 仍为旧版本)${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ 编译成功${NC}"

# ── 4. 重启服务(可选) ──────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/4]${NC} 重启服务 ..."
if [ "$RESTART_SERVICE" = true ]; then
  if ! command -v systemctl &>/dev/null; then
    echo -e "${RED}  ✗ 未检测到 systemctl,无法重启服务${NC}"
    echo "  请手动运行: npm start"
    exit 1
  fi
  # 检查服务是否存在,避免误重启
  if ! sudo systemctl list-unit-files "${SERVICE_NAME}.service" &>/dev/null || \
     ! sudo systemctl list-unit-files "${SERVICE_NAME}.service" | grep -q "${SERVICE_NAME}.service"; then
    echo -e "${RED}  ✗ 服务 ${SERVICE_NAME} 未注册${NC}"
    echo "  跳过重启。如需安装服务: sudo bash install.sh --service --name ${SERVICE_NAME}"
    exit 1
  fi
  sudo systemctl restart "$SERVICE_NAME"
  sleep 1
  if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    echo -e "${GREEN}  ✓ 服务 ${SERVICE_NAME} 已重启${NC}"
  else
    echo -e "${RED}  ✗ 服务重启失败,查看日志:${NC}"
    echo "    sudo journalctl -u $SERVICE_NAME -n 50"
    exit 1
  fi
else
  echo -e "${YELLOW}  - 跳过 (使用 --service NAME 启用自动重启)${NC}"
  echo "  手动重启 (如果已注册为服务):"
  echo "    sudo systemctl restart web-file-manager"
  echo "  手动启动 (如果未注册):"
  echo "    npm start"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ✅ ${BOLD}更新完成！${NC}                                ${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""
