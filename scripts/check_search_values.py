"""Week 2 check: what values do the search columns actually hold?

Confirms the parser's mappings (e.g. "condo" -> "Condominium") match the real
data in rets_property. Prints small summaries only (max 15 rows each).

Usage:  python scripts/check_search_values.py
"""
import os

import mysql.connector
from dotenv import load_dotenv

load_dotenv()

PARSER_TYPES = {
    "SingleFamilyResidence", "Condominium", "Townhouse", "Duplex",
    "Triplex", "ManufacturedHome", "UnimprovedLand",
}

conn = mysql.connector.connect(
    host=os.getenv("MYSQL_HOST", "localhost"),
    port=int(os.getenv("MYSQL_PORT", "3306")),
    user=os.getenv("MYSQL_USER"),
    password=os.getenv("MYSQL_PASSWORD"),
    database=os.getenv("MYSQL_DATABASE", "idx_exchange"),
)
cur = conn.cursor()


def show(title, sql):
    cur.execute(sql)
    rows = cur.fetchall()
    print(f"\n{title}")
    for value, count in rows:
        print(f"  {value!r:<32} {count:>8,}")
    return {r[0] for r in rows}


types = show("L_Type_ (property type)",
             "SELECT L_Type_, COUNT(*) c FROM rets_property GROUP BY L_Type_ ORDER BY c DESC LIMIT 15")
show("L_Status", "SELECT L_Status, COUNT(*) c FROM rets_property GROUP BY L_Status ORDER BY c DESC LIMIT 15")
show("PoolPrivateYN", "SELECT PoolPrivateYN, COUNT(*) c FROM rets_property GROUP BY PoolPrivateYN ORDER BY c DESC LIMIT 15")
show("ViewYN", "SELECT ViewYN, COUNT(*) c FROM rets_property GROUP BY ViewYN ORDER BY c DESC LIMIT 15")

cur.execute("SELECT COUNT(DISTINCT L_City), MIN(L_SystemPrice), MAX(L_SystemPrice) FROM rets_property")
cities, lo, hi = cur.fetchone()
print(f"\n{cities:,} distinct cities, list prices ${lo:,} to ${hi:,}")

missing = sorted(PARSER_TYPES - types)
print("\nParser types not found in top values:", missing or "none, all good")
conn.close()
