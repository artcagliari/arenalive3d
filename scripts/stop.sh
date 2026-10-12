#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
PID_FILE="$PROJECT_DIR/data/server.pid"
CAFFEINATE_PID_FILE="$PROJECT_DIR/data/caffeinate.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Nenhum processo registrado."
  exit 0
fi

ARENA_PID="$(<"$PID_FILE")"
if kill -0 "$ARENA_PID" 2>/dev/null; then
  kill -TERM "$ARENA_PID"
  for _ in {1..40}; do
    kill -0 "$ARENA_PID" 2>/dev/null || break
    sleep 0.2
  done
fi

if [[ -f "$CAFFEINATE_PID_FILE" ]]; then
  CAFFEINATE_PID="$(<"$CAFFEINATE_PID_FILE")"
  kill -TERM "$CAFFEINATE_PID" 2>/dev/null || true
fi

rm -f "$PID_FILE" "$CAFFEINATE_PID_FILE"
echo "LIVE ARENA 3D encerrado com segurança."
