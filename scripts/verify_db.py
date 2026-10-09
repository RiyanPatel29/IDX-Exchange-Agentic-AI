"""Week 0 check: confirm the MLS tables imported correctly.

Usage:  python scripts/verify_db.py
Reads MySQL settings from .env. Only prints counts and small summaries,
never bulk data (handbook rule: max 50 rows per query).
"""
import os
import sys

import mysql.connector
from dotenv import load_dotenv

load_dotenv()

# table -> (required?, key columns that must exist)
CHECKS = {
    "rets_property": (True, [
        "L_ListingID", "L_City", "L_SystemPrice", "L_Keyword2", "LM_Dec_3",
        "LM_Int2_3", "L_Status", "L_Remarks",
    ]),
    "california_sold": (True, [
        "ListingKey", "ClosePrice", "CloseDate", "City", "LivingArea",
        "DaysOnMarket", "PropertyType",
    ]),
    "rets_openhouse": (False, []),  # extra table shipped with the dumps, not in the handbook
}


def one(cur, sql, params=()):
    cur.execute(sql, params)
    return cur.fetchone()


def main() -> int:
    try:
        conn = mysql.connector.connect(
            host=os.getenv("MYSQL_HOST", "localhost"),
            port=int(os.getenv("MYSQL_PORT", "3306")),
            user=os.getenv("MYSQL_USER"),
            password=os.getenv("MYSQL_PASSWORD"),
            database=os.getenv("MYSQL_DATABASE", "idx_exchange"),
        )
    except mysql.connector.Error as e:
        print(f"[FAIL] Could not connect to MySQL: {e}")
        return 1

    cur = conn.cursor()
    ok = True
    for table, (required, cols) in CHECKS.items():
        try:
            count = one(cur, f"SELECT COUNT(*) FROM `{table}`")[0]
        except mysql.connector.Error:
            if required:
                print(f"[FAIL] {table}: table not found")
                ok = False
            else:
                print(f"[SKIP] {table}: not imported (optional)")
            continue

        cur.execute(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
            (table,),
        )
        existing = {r[0] for r in cur.fetchall()}
        missing = [c for c in cols if c not in existing]
        status = "OK" if count > 0 and not missing else "FAIL"
        if required:
            ok = ok and status == "OK"
        print(f"[{status}] {table}: {count:,} rows, {len(existing)} columns")
        if missing:
            print(f"       missing expected columns: {missing}")

    try:
        print("\nTop cities in rets_property:")
        cur.execute(
            "SELECT L_City, COUNT(*) c FROM rets_property "
            "GROUP BY L_City ORDER BY c DESC LIMIT 5"
        )
        for city, c in cur.fetchall():
            print(f"  {city}: {c:,}")

        # CloseDate is a VARCHAR, so check it as a real date
        lo, hi, bad, future = one(cur, """
            SELECT MIN(d), MAX(d),
                   SUM(d IS NULL),
                   SUM(d > CURDATE())
            FROM (SELECT STR_TO_DATE(NULLIF(CloseDate, ''), '%Y-%m-%d') AS d
                  FROM california_sold) t
        """)
        print(f"\ncalifornia_sold close dates: {lo} to {hi}")
        if bad:
            print(f"  note: {int(bad):,} rows have a blank/invalid CloseDate")
        if future:
            print(f"  note: {int(future):,} rows have a CloseDate in the future "
                  "(data entry typos, filter with CloseDate <= CURDATE())")
    except mysql.connector.Error as e:
        print(f"(summary skipped: {e})")

    conn.close()
    print("\nAll good." if ok else "\nSome checks failed, see above.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
