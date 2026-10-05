"""Week 0 check: confirm both MLS tables imported correctly.

Usage:  python scripts/verify_db.py
Reads MySQL settings from .env
"""
import os
import sys

import mysql.connector
from dotenv import load_dotenv

load_dotenv()

CHECKS = {
    "rets_property": [
        "L_ListingID", "L_City", "L_SystemPrice", "L_Keyword2", "LM_Dec_3",
        "LM_Int2_3", "L_Status", "L_Remarks",
    ],
    "california_sold": [
        "ListingKey", "ClosePrice", "CloseDate", "City", "LivingArea",
        "DaysOnMarket", "PropertyType",
    ],
}


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
    for table, cols in CHECKS.items():
        try:
            cur.execute(f"SELECT COUNT(*) FROM `{table}`")
            count = cur.fetchone()[0]
        except mysql.connector.Error as e:
            print(f"[FAIL] {table}: {e}")
            ok = False
            continue

        cur.execute(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
            (table,),
        )
        existing = {r[0] for r in cur.fetchall()}
        missing = [c for c in cols if c not in existing]

        status = "OK" if count > 0 and not missing else "FAIL"
        ok = ok and status == "OK"
        print(f"[{status}] {table}: {count:,} rows, {len(existing)} columns")
        if missing:
            print(f"       missing expected columns: {missing}")

    # quick sanity peek (5 rows max, never bulk export)
    try:
        cur.execute(
            "SELECT L_City, COUNT(*) c FROM rets_property "
            "GROUP BY L_City ORDER BY c DESC LIMIT 5"
        )
        print("\nTop cities in rets_property:")
        for city, c in cur.fetchall():
            print(f"  {city}: {c:,}")
        cur.execute("SELECT MIN(CloseDate), MAX(CloseDate) FROM california_sold")
        lo, hi = cur.fetchone()
        print(f"\ncalifornia_sold close dates: {lo} to {hi}")
    except mysql.connector.Error:
        pass

    conn.close()
    print("\nAll good." if ok else "\nSome checks failed, see above.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
