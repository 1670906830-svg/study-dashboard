#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=== 备考工作台 ==="
echo ""

# Check if database and data exist
if [ ! -f "study.db" ]; then
    echo "正在初始化数据库..."
    /Users/maowenying/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 database.py
fi

# Start server
echo "正在启动服务器..."
echo ""
/Users/maowenying/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 main.py
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=== 备考工作台 ==="
echo ""

# Config from env or defaults
export DATABASE_URL="${DATABASE_URL:-}"
export PORT="${PORT:-8000}"

# Init DB and seed data
echo "正在初始化数据库..."
/Users/maowenying/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m pip install -q aiosqlite 2>/dev/null
python3 init_data.py

echo ""
echo "正在启动服务器..."
echo ""
python3 main.py
