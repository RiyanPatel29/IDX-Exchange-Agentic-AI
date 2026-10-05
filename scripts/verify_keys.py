"""Week 0 check: confirm every key in .env works. Never prints secrets."""
import json, os, smtplib, sys, urllib.request
from dotenv import load_dotenv

load_dotenv()
results = []

class SkipCheck(Exception):
    pass

def is_set(name):
    v = os.getenv(name, "").strip()
    return bool(v) and not v.endswith("...") and "your_" not in v

def check(name, fn, required=True):
    try:
        fn(); results.append((name, "OK", ""))
    except SkipCheck as e:
        results.append((name, "FAIL" if required else "SKIP", str(e)))
    except Exception as e:
        results.append((name, "FAIL", type(e).__name__ + ": " + str(e)[:120]))

def anthropic_check():
    if not is_set("ANTHROPIC_API_KEY"):
        raise SkipCheck("ANTHROPIC_API_KEY not set")
    req = urllib.request.Request("https://api.anthropic.com/v1/models", headers={
        "x-api-key": os.environ["ANTHROPIC_API_KEY"].strip(),
        "anthropic-version": "2023-06-01"})
    with urllib.request.urlopen(req, timeout=15) as r:
        assert json.load(r).get("data"), "no models returned"

def openai_check():
    if not is_set("OPENAI_API_KEY"):
        raise SkipCheck("OPENAI_API_KEY not set (needed Weeks 6-8)")
    from openai import OpenAI
    r = OpenAI().embeddings.create(model="text-embedding-3-small", input="hello")
    assert r.data[0].embedding

def mysql_check():
    import mysql.connector
    mysql.connector.connect(host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", "3306")), user=os.getenv("MYSQL_USER"),
        password=os.getenv("MYSQL_PASSWORD"), database=os.getenv("MYSQL_DATABASE")).close()

def email_check():
    if not (is_set("EMAIL_USER") and is_set("EMAIL_PASSWORD")):
        raise SkipCheck("EMAIL_USER / EMAIL_PASSWORD not set")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as s:
        s.login(os.environ["EMAIL_USER"], os.environ["EMAIL_PASSWORD"])

check("Anthropic API key", anthropic_check)
check("OpenAI API key", openai_check, required=False)
check("MySQL login", mysql_check)
check("Gmail app password", email_check, required=False)

for name, status, err in results:
    print(f"[{status}] {name}" + (f"  ->  {err}" if err else ""))
sys.exit(0 if all(s != "FAIL" for _, s, _ in results) else 1)
