#!/bin/sh
set -eu

DATA_DIRECTORY="${ARENA_DATA_DIR:-${RAILWAY_VOLUME_MOUNT_PATH:-/app/data}}"
DATABASE_FILE="${DATABASE_PATH:-$DATA_DIRECTORY/live-arena.sqlite}"
DATABASE_DIRECTORY="$(dirname "$DATABASE_FILE")"
SEED_DIRECTORY="${ARENA_SEED_DIR:-/app/seed-data}"

mkdir -p "$DATABASE_DIRECTORY" "$DATABASE_DIRECTORY/audio" "$DATABASE_DIRECTORY/characters" "$DATABASE_DIRECTORY/gifts"

if [ ! -f "$DATABASE_FILE" ]; then
  echo "Inicializando volume persistente com o snapshot da arena."
  cp "$SEED_DIRECTORY/live-arena.sqlite" "$DATABASE_FILE"
  for folder in audio characters gifts; do
    if [ -d "$SEED_DIRECTORY/$folder" ]; then
      cp -R "$SEED_DIRECTORY/$folder/." "$DATABASE_DIRECTORY/$folder/"
    fi
  done
fi

export DATABASE_PATH="$DATABASE_FILE"
exec npm start
