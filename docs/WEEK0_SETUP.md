# Week 0: Environment Setup (Windows)

Goal from the handbook: both tables imported and verified, agent sends and receives a test WhatsApp message, all API keys confirmed working.

OpenClaw recommends **WSL2 (Ubuntu)** on Windows, so everything below runs inside Ubuntu, not PowerShell (except step 1).

Tick each box as you go. Screenshot the 3 "proof" steps for your mentor.

---

## 1. Install WSL2 + Ubuntu (PowerShell as Admin)

```powershell
wsl --install -d Ubuntu
```

Restart, open **Ubuntu** from the Start menu, make a username + password. Everything after this is typed in the Ubuntu terminal.

- [ ] Ubuntu terminal opens

## 2. Base tools (Ubuntu)

```bash
sudo apt update && sudo apt install -y git curl build-essential python3-venv python3-pip mysql-server
sudo service mysql start
```

Node (OpenClaw needs Node 24+):

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24
node -v   # should say v24.x or higher
```

- [ ] `git --version`, `node -v`, `mysql --version` all work

## 3. Clone this repo

```bash
cd ~
git clone https://github.com/<your-username>/idx-openclaw-assistant.git
cd idx-openclaw-assistant
```

## 4. Python env

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

- [ ] `pip install` finishes with no errors

## 5. API keys + .env

```bash
cp .env.example .env
nano .env
```

Fill in:

- `OPENAI_API_KEY`: platform.openai.com > API keys (add a few dollars of credit or it will fail)
- `MYSQL_PASSWORD`: pick one, and put the same value in `sql/create_user.sql` (replace `change_me`)
- `EMAIL_USER` / `EMAIL_PASSWORD`: Gmail **App Password** (Google Account > Security > 2-Step Verification on > App passwords). Not your normal password.

`.env` is already in `.gitignore`. Run `git status` and make sure it never shows up.

- [ ] `.env` filled, not tracked by git

## 6. Import the MLS data

Get `rets_property.sql` and `california_sold.sql` from your IDX mentor. Copy them into `~/idx-openclaw-assistant/data/` (from Windows: `\\wsl$\Ubuntu\home\<you>\idx-openclaw-assistant\data`). The `data/` folder is gitignored so the dumps never get pushed.

```bash
mkdir -p data
bash scripts/import_db.sh data/rets_property.sql data/california_sold.sql
```

Heads up: the handbook says `idx_exchange` in the setup section but `boxgra5_cali` in the schema section. If a dump has its own `USE boxgra5_cali;` line, the tables land there instead. Check with `sudo mysql -e "SHOW DATABASES;"` and either set `MYSQL_DATABASE=boxgra5_cali` in `.env` or delete that `USE` line from the dump and re-import.

Then verify:

```bash
python scripts/verify_db.py
```

- [ ] **Proof 1:** screenshot of `verify_db.py` showing both tables with row counts

## 7. Confirm keys

```bash
python scripts/verify_keys.py
```

- [ ] **Proof 2:** all three lines say `[OK]`

## 8. Install OpenClaw

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

In the wizard: pick Anthropic > Anthropic API key (Default workspace scope) as the model provider, keep the gateway on local (127.0.0.1), and choose WhatsApp when it asks about channels (or do step 9 after).

```bash
openclaw gateway status
openclaw health
openclaw dashboard      # opens the Control UI at http://127.0.0.1:18789/
```

- [ ] Gateway status is running, dashboard opens

Note: the handbook says `git clone openclaw` + `npm install`. That is only needed if you want to hack on OpenClaw itself. The global npm install is the supported way and gives you the same `openclaw` command.

## 9. Link WhatsApp

```bash
openclaw channels login
```

Pick WhatsApp, then on your phone: WhatsApp > Settings > Linked Devices > Link a device > scan the QR in the terminal.

New DMs need approval by default. Message the linked number from another phone (or have a friend do it), then:

```bash
openclaw pairing list whatsapp
openclaw pairing approve whatsapp <code>
```

Send a test message out:

```bash
openclaw message send --target +1XXXXXXXXXX --message "Hello from my IDX OpenClaw agent"
```

- [ ] **Proof 3:** screenshot of WhatsApp showing the agent replying to you and the test message arriving

## 10. Commit

```bash
git add .
git commit -m "Week 0: environment setup, verify scripts"
git push
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `mysql` says access denied for root | In WSL use `sudo mysql` (root uses socket auth) |
| MySQL not running after reboot | `sudo service mysql start` |
| OpenAI 429 / insufficient_quota | Add billing credit on platform.openai.com |
| Gmail login fails | 2-Step Verification must be on, and use the 16-char app password with no spaces |
| QR expired | Run `openclaw channels login` again, scan within ~20 sec |
| `openclaw: command not found` | `source ~/.bashrc`, or check `npm bin -g` is on PATH |
| Import super slow | Normal for the FULLTEXT index on `L_Remarks`, let it run |
| `wsl` opens a `#` shell with no systemctl | Docker Desktop was the default distro. PowerShell: `wsl --set-default Ubuntu` |
| Gateway status: ECONNREFUSED / user bus unavailable | `sudo loginctl enable-linger $USER`, add `[wsl2]` + `guiApplications=false` to `%USERPROFILE%\.wslconfig`, `wsl --shutdown`, reopen Ubuntu |
| Gateway status: service unit not found | `openclaw gateway install` then `openclaw gateway status` |
| Doctor warns memory search has no OpenAI key | Add `OPENAI_API_KEY` (step 5); OpenClaw uses it for memory recall |
