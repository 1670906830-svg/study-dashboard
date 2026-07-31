"""
First-deploy / manual data-initialisation script.

Reads seed data from the static `migrate.sql` file and inserts it into the
database configured via `DATABASE_URL` (or the local SQLite fallback).
Guards against double-run: skips if courses already exist.

Usage:
    python init_data.py          # auto-detect, seed if empty
    python init_data.py --force  # always seed (truncates tables first)
"""

import os
import sys
import asyncio
from pathlib import Path

HERE = Path(__file__).parent
MIGRATE_SQL = HERE / "migrate.sql"


async def seed_data(force: bool = False):
    """Read migrate.sql and execute INSERT statements against the active DB."""
    from sqlalchemy import text
    from database import engine, is_postgres, init_db

    await init_db()

    if not MIGRATE_SQL.exists():
        print(f"[init_data] {MIGRATE_SQL} not found, nothing to seed.")
        return

    async with engine.begin() as conn:
        # ---- Guard: check if data already exists ----
        if not force:
            count = await conn.execute(text("SELECT COUNT(*) FROM courses"))
            cnt = count.scalar()
            if cnt and cnt > 0:
                print(f"[init_data] Database already has {cnt} courses, skipping seed. Use --force to re-seed.")
                return

        # ---- Read SQL file and split into statements ----
        raw = MIGRATE_SQL.read_text(encoding="utf-8")
        statements = [s.strip() for s in raw.split(";") if s.strip()]

        pg = is_postgres()

        if force:
            tables = ["correct_rates", "habit_logs", "habits", "schedule", "courses"]
            for tbl in tables:
                if pg:
                    await conn.execute(text(f"TRUNCATE TABLE {tbl} RESTART IDENTITY CASCADE"))
                else:
                    await conn.execute(text(f"DELETE FROM {tbl}"))
                    await conn.execute(text(f"DELETE FROM sqlite_sequence WHERE name='{tbl}'"))

        total = 0
        for stmt in statements:
            try:
                await conn.execute(text(stmt))
                total += 1
            except Exception as exc:
                print(f"[init_data] SKIP (error logged): {stmt[:80]}...\n  {exc}")

        # ---- Reset sequences (PostgreSQL) ----
        if pg:
            seq_resets = [
                "SELECT setval('courses_id_seq', COALESCE((SELECT MAX(id) FROM courses), 1))",
                "SELECT setval('schedule_id_seq', COALESCE((SELECT MAX(id) FROM schedule), 1))",
                "SELECT setval('habits_id_seq', COALESCE((SELECT MAX(id) FROM habits), 1))",
                "SELECT setval('habit_logs_id_seq', COALESCE((SELECT MAX(id) FROM habit_logs), 1))",
                "SELECT setval('correct_rates_id_seq', COALESCE((SELECT MAX(id) FROM correct_rates), 1))",
            ]
            for sq in seq_resets:
                await conn.execute(text(sq))

        print(f"[init_data] Done. Executed {total} INSERT statements.")


if __name__ == "__main__":
    force = "--force" in sys.argv
    asyncio.run(seed_data(force=force))
    print("[init_data] Finished.")
