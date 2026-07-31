import os
import asyncio
import socket
from datetime import date, datetime, timedelta
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import text

from database import init_db, async_session, row_to_dict


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="备考工作台", lifespan=lifespan)


class ToggleBody(BaseModel):
    completed: bool


class RateBody(BaseModel):
    rate: float
    note: str = ""


# ======== Courses ========
@app.get("/api/courses")
async def get_courses(category: Optional[str] = None):
    async with async_session() as session:
        if category:
            result = await session.execute(
                text("SELECT * FROM courses WHERE category = :cat ORDER BY sort_order"),
                {"cat": category},
            )
        else:
            result = await session.execute(text("SELECT * FROM courses ORDER BY sort_order"))
        return [row_to_dict(r) for r in result.all()]


@app.get("/api/courses/stats")
async def get_course_stats():
    async with async_session() as session:
        result = await session.execute(text("""
            SELECT category,
                   COUNT(*) as total_courses,
                   SUM(total_sessions) as total_sessions,
                   SUM(completed_sessions) as completed_sessions
            FROM courses
            GROUP BY category
            ORDER BY CASE category WHEN '行测' THEN 1 WHEN '申论' THEN 2 ELSE 3 END
        """))
        by_cat = [row_to_dict(r) for r in result.all()]

        result2 = await session.execute(
            text("SELECT SUM(completed_sessions) as done, SUM(total_sessions) as total FROM courses")
        )
        overall = row_to_dict(result2.one())
        return {"by_category": by_cat, "overall": overall}


@app.put("/api/courses/{course_id}/progress")
async def update_progress(course_id: int, body: ToggleBody):
    async with async_session() as session:
        result = await session.execute(
            text("SELECT total_sessions, completed_sessions FROM courses WHERE id = :cid"),
            {"cid": course_id},
        )
        row = result.one_or_none()
        if not row:
            raise HTTPException(404)
        total = row._mapping["total_sessions"]
        completed = row._mapping["completed_sessions"]
        new_val = completed + (1 if body.completed else -1)
        new_val = max(0, min(new_val, total))
        await session.execute(
            text("UPDATE courses SET completed_sessions = :val WHERE id = :cid"),
            {"val": new_val, "cid": course_id},
        )
        await session.commit()
        return {"completed_sessions": new_val, "total_sessions": total}


# ======== Schedule ========
@app.get("/api/schedule")
async def get_schedule(
    start: str = Query(default=None),
    end: str = Query(default=None),
    date: str = Query(default=None),
):
    async with async_session() as session:
        if date:
            result = await session.execute(text("""
                SELECT s.id, s.date, s.session_label, s.completed,
                       c.id as course_id, c.name as course_name, c.short_name,
                       c.category, c.total_sessions, c.completed_sessions
                FROM schedule s
                JOIN courses c ON c.id = s.course_id
                WHERE s.date = :dt
                ORDER BY c.sort_order
            """), {"dt": date})
        elif start and end:
            result = await session.execute(text("""
                SELECT s.id, s.date, s.session_label, s.completed,
                       c.id as course_id, c.name as course_name, c.short_name,
                       c.category, c.total_sessions, c.completed_sessions
                FROM schedule s
                JOIN courses c ON c.id = s.course_id
                WHERE s.date BETWEEN :start AND :end
                ORDER BY s.date, c.sort_order
            """), {"start": start, "end": end})
        else:
            return []
        return [row_to_dict(r) for r in result.all()]


@app.get("/api/schedule/table")
async def get_schedule_table(start: str = Query(default=None), end: str = Query(default=None)):
    async with async_session() as session:
        today = date.today().strftime("%Y-%m-%d")
        if not start:
            start = "2026-07-31"
        if not end:
            end = "2026-11-28"

        result = await session.execute(text("""
            SELECT s.id, s.date, s.session_label, s.completed,
                   c.id as course_id, c.short_name, c.category,
                   c.total_sessions, c.completed_sessions
            FROM schedule s
            JOIN courses c ON c.id = s.course_id
            WHERE s.date BETWEEN :start AND :end
            ORDER BY s.date, c.sort_order
        """), {"start": start, "end": end})

        rows = result.all()

    # -- Grouping (no DB needed) --
    by_date = {}
    for r in rows:
        d = r._mapping["date"]
        if d not in by_date:
            by_date[d] = {}
        cat = r._mapping["category"]
        by_date[d].setdefault(cat, [])
        cs = r._mapping["completed_sessions"]
        ts = r._mapping["total_sessions"]
        by_date[d][cat].append({
            "id": r._mapping["id"],
            "course_id": r._mapping["course_id"],
            "short_name": r._mapping["short_name"],
            "session_label": r._mapping["session_label"],
            "completed": r._mapping["completed"],
            "course_done": cs >= ts if ts > 0 else False,
        })

    return {"dates": sorted(by_date.keys()), "data": by_date}


# ======== Course Management ========
@app.post("/api/courses")
async def add_course(name: str, category: str = "行测", total_sessions: int = 1):
    async with async_session() as session:
        result = await session.execute(text("SELECT MAX(sort_order) FROM courses"))
        max_order = result.scalar() or 0
        result2 = await session.execute(
            text("INSERT INTO courses (name, short_name, category, total_sessions, completed_sessions, sort_order) VALUES (:name, :name, :cat, :total, 0, :order) RETURNING id"),
            {"name": name, "cat": category, "total": total_sessions, "order": max_order + 1},
        )
        course_id = result2.scalar_one()
        await session.commit()
        return {"id": course_id, "name": name}


@app.post("/api/courses/import")
async def import_courses(file: UploadFile = File(...)):
    import openpyxl
    contents = await file.read()
    wb = openpyxl.load_workbook(contents)
    ws = wb.active

    async with async_session() as session:
        result = await session.execute(text("SELECT id, name FROM courses"))
        existing = {r._mapping["name"]: r._mapping["id"] for r in result.all()}
        result2 = await session.execute(text("SELECT MAX(sort_order) FROM courses"))
        max_order = result2.scalar() or 0
        added = 0

        for row in ws.iter_rows(min_row=2, values_only=True):
            name = str(row[0]).strip() if row[0] else ""
            total = int(row[1]) if row[1] else 0
            date_str = str(row[2]).strip() if len(row) > 2 and row[2] else ""
            cat = str(row[3]).strip() if len(row) > 3 and row[3] else "行测"

            if not name:
                continue

            if name in existing:
                course_id = existing[name]
                if total > 0:
                    await session.execute(
                        text("UPDATE courses SET total_sessions = total_sessions + :t WHERE id = :cid"),
                        {"t": total, "cid": course_id},
                    )
            else:
                max_order += 1
                r3 = await session.execute(
                    text("INSERT INTO courses (name, short_name, category, total_sessions, completed_sessions, sort_order) VALUES (:name, :name, :cat, :total, 0, :order) RETURNING id"),
                    {"name": name, "cat": cat, "total": total, "order": max_order},
                )
                course_id = r3.scalar_one()
                existing[name] = course_id
                added += 1

            if date_str:
                date_str = date_str.replace("/", "-")
                if len(date_str) == 5:
                    date_str = "2026-" + date_str
                # schedule has no unique constraint; use plain INSERT
                await session.execute(
                    text("INSERT INTO schedule (course_id, date, session_label) VALUES (:cid, :dt, :label)"),
                    {"cid": course_id, "dt": date_str, "label": name},
                )

        await session.commit()
        return {"added": added, "total": len(existing)}


@app.put("/api/schedule/{schedule_id}/date")
async def update_schedule_date(schedule_id: int, date: str):
    async with async_session() as session:
        result = await session.execute(
            text("UPDATE schedule SET date = :dt WHERE id = :sid"),
            {"dt": date, "sid": schedule_id},
        )
        if result.rowcount == 0:
            raise HTTPException(404)
        await session.commit()
        return {"ok": True}


@app.delete("/api/schedule/{schedule_id}")
async def delete_schedule_item(schedule_id: int):
    async with async_session() as session:
        await session.execute(
            text("DELETE FROM schedule WHERE id = :sid"),
            {"sid": schedule_id},
        )
        await session.commit()
        return {"ok": True}


@app.post("/api/schedule")
async def add_schedule_item(course_id: int, date: str):
    async with async_session() as session:
        result = await session.execute(
            text("INSERT INTO schedule (course_id, date, session_label) VALUES (:cid, :dt, '') RETURNING id"),
            {"cid": course_id, "dt": date},
        )
        sid = result.scalar_one()
        await session.commit()
        return {"id": sid}


# ======== Habits ========
@app.get("/api/habits")
async def get_habits(date: Optional[str] = None):
    async with async_session() as session:
        target = date or datetime.now().strftime("%Y-%m-%d")
        result = await session.execute(text("""
            SELECT h.id, h.name, h.frequency,
                   hl.id as log_id, hl.completed, hl.completed_at
            FROM habits h
            LEFT JOIN habit_logs hl ON hl.habit_id = h.id AND hl.date = :dt
            ORDER BY h.sort_order
        """), {"dt": target})
        return [row_to_dict(r) for r in result.all()]


@app.put("/api/habits/{log_id}")
async def toggle_habit(log_id: int, body: ToggleBody):
    async with async_session() as session:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S") if body.completed else None
        result = await session.execute(
            text("UPDATE habit_logs SET completed = :done, completed_at = :at WHERE id = :lid"),
            {"done": 1 if body.completed else 0, "at": now, "lid": log_id},
        )
        if result.rowcount == 0:
            raise HTTPException(404, "记录不存在")
        await session.commit()
        return {"ok": True}


# ======== Correct Rates ========
@app.get("/api/correct-rates")
async def get_correct_rates(category: Optional[str] = None):
    async with async_session() as session:
        if category:
            result = await session.execute(
                text("SELECT * FROM correct_rates WHERE category = :cat ORDER BY date"),
                {"cat": category},
            )
        else:
            result = await session.execute(
                text("SELECT * FROM correct_rates ORDER BY category, date")
            )
        return [row_to_dict(r) for r in result.all()]


@app.post("/api/correct-rates")
async def add_correct_rate(category: str, body: RateBody):
    async with async_session() as session:
        today = date.today().strftime("%Y-%m-%d")
        await session.execute(text("""
            INSERT INTO correct_rates (category, date, rate, note)
            VALUES (:cat, :dt, :rate, :note)
            ON CONFLICT (category, date)
            DO UPDATE SET rate = :rate2, note = :note2
        """), {
            "cat": category, "dt": today,
            "rate": body.rate, "note": body.note,
            "rate2": body.rate, "note2": body.note,
        })
        await session.commit()
        return {"ok": True}


# ======== Static Files ========
app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", 8000))
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        print(f"\nPhone (same WiFi): http://{local_ip}:{port}")
    except:
        pass
    print(f"Local: http://localhost:{port}\n")
    uvicorn.run(app, host=host, port=port)
