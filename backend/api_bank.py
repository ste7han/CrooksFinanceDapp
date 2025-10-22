# backend/api_bank.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import time
from db_utils import get_connection, safe_int

router = APIRouter(prefix="/api/bank", tags=["bank"])

WITHDRAW_COOLDOWN_SEC = 60 * 30     # 30 min (tune as you like)
MIN_WITHDRAW_CRO = 1.0              # minimum CRO per request (tune)

class WithdrawReq(BaseModel):
    address: str = Field(..., description="Player wallet (0x...) or user_id fallback")
    amount: float = Field(..., gt=0, description="Requested CRO amount")

def _row_to_dict(row):
    return dict(row) if row else None

def _find_user_by_address(conn, address: str):
    a = (address or "").lower().strip()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE lower(linked_wallet)=? OR lower(user_id)=?", (a, a))
    return _row_to_dict(cur.fetchone())

@router.get("")
def get_bank(address: str):
    conn = get_connection()
    user = _find_user_by_address(conn, address)
    if not user:
        conn.close()
        # Return zeros so UI still works for first-time users
        return {
            "bank_cro": 0.0, "dirty_cro": 0.0, "cro_withdrawn_total": 0.0,
            "last_withdrawal": 0, "pending": [], "history": []
        }

    # Ensure queue table exists
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS bank_withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        address TEXT,
        amount REAL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        txhash TEXT
    )
    """)
    # pull pending for this user
    cur.execute("SELECT id, amount, status, created_at, txhash FROM bank_withdrawals WHERE (lower(address)=? OR user_id=?) AND status IN ('pending','queued','processing') ORDER BY id DESC LIMIT 20",
                ((address or "").lower(), user.get("user_id")))
    pending = [dict(r) for r in cur.fetchall()]

    # optional: last 20 history entries (if you store them in users.history)
    history = []
    try:
        import json
        history = json.loads(user.get("history") or "[]")
    except Exception:
        history = []

    resp = {
        "bank_cro": float(user.get("bank_cro") or 0.0),
        "dirty_cro": float(user.get("dirty_cro") or 0.0),
        "cro_withdrawn_total": float(user.get("cro_withdrawn_total") or 0.0),
        "last_withdrawal": safe_int(user.get("last_withdrawal") or 0),
        "pending": pending,
        "history": history[-20:][::-1],
    }
    conn.close()
    return resp

@router.post("/withdraw")
def request_withdraw(req: WithdrawReq):
    now = int(time.time())
    amt = float(req.amount)
    if amt < MIN_WITHDRAW_CRO:
        raise HTTPException(400, f"Minimum withdrawal is {MIN_WITHDRAW_CRO} CRO")

    conn = get_connection()
    cur = conn.cursor()

    user = _find_user_by_address(conn, req.address)
    if not user:
        conn.close()
        raise HTTPException(404, "User not found or wallet not linked")

    bank_cro = float(user.get("bank_cro") or 0.0)
    last_withdrawal = safe_int(user.get("last_withdrawal") or 0)

    if bank_cro < amt:
        conn.close()
        raise HTTPException(400, "Insufficient bank balance")

    if now - last_withdrawal < WITHDRAW_COOLDOWN_SEC:
        wait = WITHDRAW_COOLDOWN_SEC - (now - last_withdrawal)
        conn.close()
        raise HTTPException(429, f"Cooldown active. Try again in {wait} seconds")

    # Ensure queue table exists
    cur.execute("""
    CREATE TABLE IF NOT EXISTS bank_withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        address TEXT,
        amount REAL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        txhash TEXT
    )
    """)

    # Reserve funds immediately to prevent double-spend
    new_balance = round(bank_cro - amt, 2)
    cur.execute("UPDATE users SET bank_cro = ?, last_withdrawal = ? WHERE user_id = ?",
                (new_balance, now, user["user_id"]))

    # Enqueue withdrawal
    cur.execute(
        "INSERT INTO bank_withdrawals (user_id, address, amount, status) VALUES (?, ?, ?, 'pending')",
        (user["user_id"], (req.address or "").lower(), amt)
    )

    # Optional: append to history
    try:
        import json
        h = []
        try:
            cur.execute("SELECT history FROM users WHERE user_id = ?", (user["user_id"],))
            row = cur.fetchone()
            h = json.loads(row[0] or "[]") if row else []
        except Exception:
            h = []
        h.append({"type":"withdraw_request","amount":amt,"created_at": now})
        cur.execute("UPDATE users SET history = ? WHERE user_id = ?", (json.dumps(h[-200:]), user["user_id"]))
    except Exception:
        pass

    conn.commit()
    conn.close()
    return {"ok": True}
