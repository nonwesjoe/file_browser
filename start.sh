#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-3000}"
STORAGE_ROOT="${STORAGE_ROOT:-$SCRIPT_DIR/storage}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}┌─────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│  📁 Web 文件管理器 启动脚本              │${NC}"
echo -e "${GREEN}└─────────────────────────────────────────┘${NC}"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ 未找到 Node.js，请先安装 Node.js >= 18${NC}"
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
echo -e "  Node.js: $(node -v)"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}→ 首次运行，安装依赖...${NC}"
  npm install
  echo ""
fi

# Build TypeScript
echo -e "${YELLOW}→ 编译 TypeScript...${NC}"
npx tsc --skipLibCheck
echo -e "${GREEN}  ✓ 编译完成${NC}"

# Ensure storage directory exists
mkdir -p "$STORAGE_ROOT"
mkdir -p ".cache_thumbs"

echo ""
echo -e "  端口:     ${GREEN}$PORT${NC}"
echo -e "  存储目录: ${GREEN}$STORAGE_ROOT${NC}"
echo -e "  访问地址: ${GREEN}http://localhost:$PORT${NC}"
echo ""
echo -e "${YELLOW}按 Ctrl+C 停止服务器${NC}"
echo ""

exec node dist/server.js
