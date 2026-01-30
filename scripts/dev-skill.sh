#!/bin/bash

# Zeus Dev Skill Automation Script
# Handles auto-migration for SQL and auto-reload for Backend

POSTGRES_HOST="localhost"
POSTGRES_PORT="5432"
POSTGRES_USER="zeus"
POSTGRES_DB="zeus"
# Assuming PGPASSWORD can be set via env or .pgpass. For dev simplicity:
export PGPASSWORD="zeus"

WATCH_SQL_DIR="ddl/sql"
WATCH_BACKEND_DIRS="server/cmd server/internal"

function log() {
    echo "[Zeus-Skill] $(date '+%H:%M:%S') $1"
}

function run_sql_migration() {
    local file=$1
    log "⚡️ SQL Change detected: $file"
    
    if [[ ! -f "$file" ]]; then
        log "File $file removed, skipping."
        return
    fi

    log "Executing $file against Postgres..."
    psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$file"
    
    if [ $? -eq 0 ]; then
        log "✅ Migration successful."
    else
        log "❌ Migration failed."
    fi
}

function restart_backend() {
    log "⚡️ Backend Code Change detected. Recompiling..."
    
    # Kill existing zeus process if running
    pkill -f "server/cmd/zeus" || true
    
    # Re-run make command in background
    # We use make run-backend but need to ensure it doesn't block if we want to keep watching
    # For this simple script, we might just restart the process.
    
    echo "Restarting backend..."
    make run-backend &
    PID=$!
    log "✅ Backend restarted (PID: $PID)"
}

function watch_sql() {
    log "👀 Watching SQL files in $WATCH_SQL_DIR..."
    
    # Use fswatch or plain loop if fswatch not available. 
    # Fallback to simple timestamp check for portability if tools missing.
    
    if command -v fswatch >/dev/null; then
        fswatch -o "$WATCH_SQL_DIR" | while read num; do
            # Find the changed file - this is tricky with batch events.
            # Simplified: just find latest modified sql file
            LATEST_SQL=$(find "$WATCH_SQL_DIR" -name "*.sql" -type f -print0 | xargs -0 ls -t | head -n 1)
            run_sql_migration "$LATEST_SQL"
        done
    else
        # Portable poor man's watcher
        log "fswatch not found. Using polling (2s)..."
        LAST_CHECK=$(date +%s)
        while true; do
            sleep 2
            # Find files modified after last check
            CHANGED_FILES=$(find "$WATCH_SQL_DIR" -name "*.sql" -type f -newermt "@$LAST_CHECK")
            if [ ! -z "$CHANGED_FILES" ]; then
                for file in $CHANGED_FILES; do
                    run_sql_migration "$file"
                done
                LAST_CHECK=$(date +%s)
            fi
        done
    fi
}

function watch_code() {
    log "👀 Watching Code in $WATCH_BACKEND_DIRS..."
    
    # Similar logic for code
     if command -v fswatch >/dev/null; then
        fswatch -o $WATCH_BACKEND_DIRS | while read num; do
            restart_backend
        done
    else
        log "fswatch not found. Using polling (3s)..."
        LAST_CHECK=$(date +%s)
        while true; do
            sleep 3
            CHANGED_FILES=$(find $WATCH_BACKEND_DIRS -name "*.go" -type f -newermt "@$LAST_CHECK")
            if [ ! -z "$CHANGED_FILES" ]; then
                restart_backend
                LAST_CHECK=$(date +%s)
            fi
        done
    fi
}

function start_all() {
    log "🚀 Starting Zeus Dev Skills..."
    watch_sql &
    SQL_PID=$!
    watch_code &
    CODE_PID=$!
    
    log "Workers started (SQL: $SQL_PID, Code: $CODE_PID). Press Ctrl+C to stop."
    wait
}

case "$1" in
    "watch-sql")
        watch_sql
        ;;
    "watch-code")
        watch_code
        ;;
    "start")
        start_all
        ;;
    *)
        echo "Usage: $0 {watch-sql|watch-code|start}"
        exit 1
        ;;
esac
