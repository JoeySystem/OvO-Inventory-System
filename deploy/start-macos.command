#!/bin/bash

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${PORT:-3000}"
APP_URL="http://localhost:${PORT}"
HEALTH_URL="${APP_URL}/api/health"

cd "$PROJECT_DIR" || exit 1

clear
echo "======================================================"
echo "  OvO System 物料管理系统"
echo "======================================================"
echo "  项目目录: $PROJECT_DIR"
echo "  访问地址: $APP_URL"
echo "  健康检查: $HEALTH_URL"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[X] 未检测到 Node.js。请先安装 Node.js 20/22/24。"
  echo
  read -r -p "按回车退出..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[X] 未检测到 npm。请确认 Node.js 已正确安装。"
  echo
  read -r -p "按回车退出..."
  exit 1
fi

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "[!] 未发现 node_modules，正在安装依赖..."
  npm install
  if [ $? -ne 0 ]; then
    echo
    echo "[X] 依赖安装失败。"
    read -r -p "按回车退出..."
    exit 1
  fi
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[OK] 系统已经在运行，直接打开浏览器。"
  open "$APP_URL"
  echo
  echo "如果浏览器打不开，请检查健康检查地址：$HEALTH_URL"
  echo "可以关闭这个窗口。"
  read -r -p "按回车退出..."
  exit 0
fi

echo "[1/2] 正在启动服务..."
echo
npm start &
APP_PID=$!

echo
echo "[2/2] 等待系统就绪..."
for _ in {1..30}; do
  if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[OK] 系统已启动。"
    open "$APP_URL"
    echo
    echo "浏览器已打开：$APP_URL"
    echo "请不要关闭此终端窗口；关闭后服务会停止。"
    wait "$APP_PID"
    exit $?
  fi
  sleep 1
done

echo "[X] 服务启动后健康检查未通过。"
echo "请查看上方错误日志，或访问：$HEALTH_URL"
echo
read -r -p "按回车退出..."
exit 1
