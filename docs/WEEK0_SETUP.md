# Week 0: Environment Setup (Windows + WSL2)

Handbook deliverable: both tables imported and verified, agent sends and receives a test WhatsApp message, all API keys confirmed working.

**Status: done** (Oct 2026). This guide is the path that actually worked on a Windows laptop.

Rule of thumb: a prompt starting with `PS C:\` is **PowerShell** (Windows). A prompt like `patel@Riyansasus:~$` is **Ubuntu**. Everything runs in Ubuntu unless marked PowerShell.

---

## 1. WSL2 + Ubuntu (PowerShell as Admin)

```powershell
wsl --install -d Ubuntu
wsl --set-default Ubuntu          # needed if Docker Desktop is installed
```

Then turn off WSLg (it breaks the systemd user session OpenClaw needs). Open `notepad $env:USERPROFILE\.wslconfig` and add:

```
[wsl2]
guiApplications=false
```

Run `wsl --shutdown`, then open Ubuntu with `wsl -d Ubuntu --cd ~`.

## 2. Base tools (Ubuntu)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential unzip rsync pv python3-venv python3-pip mysql-server
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24
sudo loginctl enable-linger $USER
```

Check: `git --version && node -v && npm -v` and `systemctl --user status` (should show a process tree, not an error).

## 3. OpenClaw

```bash
npm install -g openclaw@latest --allow-scripts=openclaw,esbuild,koffi,protobufjs,@google/genai
openclaw onboard --install-daemon
```

Wizard choices: QuickStart > **Anthropic > Anthropic API key** (console.anthropic.com, Default workspace scope) > keep the default model > channel **WhatsApp (QR link)**, install from npm, scan QR > "This is my personal phone number" > skip admin, web search and skills.

The handbook's `git clone openclaw && npm install` is only for hacking on OpenClaw itself. The global install gives the same `openclaw` command.

```bash
openclaw gateway install     # if status says "service unit not found"
openclaw gateway status      # want: Runtime running, Connectivity probe ok
openclaw doctor --fix
```

## 4. WhatsApp test

Personal phone mode: open WhatsApp > chat with **yourself** ("You") > send `hi`. The agent replies there.

- [x] **Proof 1:** screenshot of the agent replying

## 5. Project + Python (Ubuntu)

Work in a Linux folder (fast), keep the Windows clone for git:

```bash
cd ~/idx-openclaw-assistant
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 6. Keys in `.env`

Paste these **one line at a time** (pasting `read` lines as a block makes them swallow the next lines). Input stays hidden.

```bash
read -sp "Paste Anthropic key: " A; echo
read -sp "Type MySQL password: " M; echo
```

Then paste this block:

```bash
cat > .env <<ENVEOF
ANTHROPIC_API_KEY=$A
OPENAI_API_KEY=
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=idx_user
MYSQL_PASSWORD=$M
MYSQL_DATABASE=idx_exchange
EMAIL_USER=
EMAIL_PASSWORD=
ENVEOF
unset A M
```

`.env` is gitignored. Never put keys or passwords in tracked files.

## 7. MySQL database + user

```bash
sudo systemctl enable --now mysql
bash scripts/create_db_user.sh          # reads MYSQL_PASSWORD from .env
mysql -u idx_user -p -e "SHOW DATABASES;"   # should list idx_exchange
```

## 8. Import the MLS data

Copy the dumps (`rets_property.sql`, `california_sold.sql`, `rets_openhouse.sql`) into `data/` (gitignored):

```bash
mkdir -p data
cp "/mnt/c/path/to/folder/"{rets_property,california_sold,rets_openhouse}.sql data/
bash scripts/import_db.sh
```

`import_db.sh` turns on fast mode (batched commits). Without it the import ran at ~120 KiB/s (17 min for the 120 MB file); with it, ~6 MiB/s (under 2 min for the 629 MB file). It turns safe mode back on when done.

## 9. Verify

```bash
python scripts/verify_db.py
python scripts/verify_keys.py
```

- [x] **Proof 2:** `verify_db.py` shows both tables (rets_property 55,212 rows, california_sold 98,552 rows)
- [x] **Proof 3:** `verify_keys.py` shows Anthropic OK and MySQL OK (OpenAI needed from Week 6, Gmail from Week 11)

## 10. Push to GitHub

From Ubuntu, sync to the Windows clone (skips secrets, venv and data):

```bash
rsync -av --exclude venv --exclude .env --exclude data --exclude node_modules \
  ~/idx-openclaw-assistant/ "/mnt/c/Users/patel/OneDrive/Documents/Desktop/IDX/IDX-Exchange-Agentic-AI/"
```

Then in PowerShell in that folder: `git add .`, `git status` (check no `.env`), `git commit -m "..."`, `git push`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `wsl` opens a `#` shell with no systemctl | Docker Desktop was the default distro. PowerShell: `wsl --set-default Ubuntu` |
| `systemctl --user`: failed to connect to bus | `sudo loginctl enable-linger $USER`, set `guiApplications=false` in `.wslconfig`, `wsl --shutdown` |
| Gateway: ECONNREFUSED / service unit not found | `openclaw gateway install`, then `openclaw gateway status` |
| Doctor: memory search has no OpenAI key | Expected until `OPENAI_API_KEY` is added (Week 6) |
| `wsl --shutdown` "not found" | That is a PowerShell command, not Ubuntu |
| `mysql` access denied for root | Use `sudo mysql` (root uses socket auth in Ubuntu) |
| MySQL not running after reboot | `sudo systemctl start mysql` |
| Import very slow | Use `scripts/import_db.sh` (fast mode) |
| Terminal looks garbled after a long import | Close the window and open a fresh Ubuntu one |
| QR expired | `openclaw channels login`, scan within ~20 sec |
| `openclaw: command not found` | `source ~/.bashrc` |
