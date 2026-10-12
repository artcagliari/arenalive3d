#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
PID_DIR="$PROJECT_DIR/data"
PID_FILE="$PID_DIR/server.pid"
CAFFEINATE_PID_FILE="$PID_DIR/caffeinate.pid"

cd "$PROJECT_DIR"
mkdir -p "$PID_DIR" "$PROJECT_DIR/logs"

if [[ -f "$PID_FILE" ]] && kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
  echo "LIVE ARENA 3D já está ativo (PID $(<"$PID_FILE"))."
  exit 0
fi

if [[ ! -x "$PROJECT_DIR/node_modules/.bin/tsx" ]]; then
  echo "Dependências ausentes. Execute: npm install"
  exit 1
fi

if [[ ! -d "$PROJECT_DIR/dist" ]]; then
  echo "Build ausente. Executando npm run build…"
  npm run build
fi

nohup "$PROJECT_DIR/node_modules/.bin/tsx" "$PROJECT_DIR/server/index.ts" >> "$PROJECT_DIR/logs/server.log" 2>&1 &
ARENA_PID=$!
echo "$ARENA_PID" > "$PID_FILE"

nohup caffeinate -dimsu -w "$ARENA_PID" >> "$PROJECT_DIR/logs/caffeinate.log" 2>&1 &
echo $! > "$CAFFEINATE_PID_FILE"

sleep 1
if ! kill -0 "$ARENA_PID" 2>/dev/null; then
  echo "Falha ao iniciar. Consulte logs/server.log."
  exit 1
fi

echo "LIVE ARENA 3D iniciado."
echo "Admin:   http://127.0.0.1:${PORT:-8787}/admin"
echo "Overlay: http://127.0.0.1:${PORT:-8787}/overlay"
echo "O caffeinate manterá o Mac acordado enquanto o servidor estiver ativo."
