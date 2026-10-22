# Telegram Student Verification Bot

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Runtime: Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![Database: Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare%20D1%20(SQLite)-003B57?logo=sqlite&logoColor=white)
![Languages: EN | FR | AR](https://img.shields.io/badge/i18n-EN%20%7C%20FR%20%7C%20AR%20(RTL)-success)

An open-source, serverless **Telegram Student Verification & Group Gatekeeper Bot** built for university departments, student clubs, and academic cohorts. It runs 100% free on **Cloudflare Workers** and **Cloudflare D1 (SQLite)** using **Telegram Webhooks** — no 24/7 server or paid hosting required.

---

## Key Features

- **100% Serverless & Free Hosting**: Powered by Cloudflare Workers and D1 SQLite. Once deployed, your computer can be turned off completely.
- **Trilingual User Interface (English, French, Arabic RTL)**:
  - `/start` presents inline buttons for **English**, **Français**, and **العربية** (with native Right-to-Left formatting) and saves each student's preference.
  - `/language` lets users switch languages at any time.
- **Strict 1-to-1 Identity Verification**:
  - Students message the bot privately, run `/verify`, and enter their official Student ID (`matricule`).
  - If the ID exists in the imported roster and is unclaimed, the bot displays the student's full name and section/group with **Confirm** and **Cancel** buttons.
  - Enforces **one Student ID per Telegram account** and **one Telegram account per Student ID** via SQLite `UNIQUE` constraints and atomic conditional updates.
  - Confirmation tokens expire after 10 minutes and are strictly locked to the Telegram user who initiated the request.
- **Numeric ID Administrator Security**:
  - Admin commands are protected strictly by numeric Telegram user IDs stored in the `ADMIN_IDS` secret — never by mutable usernames.
- **Safe 7-Day Verification Grace Period**:
  - Administrators can start a 7-day verification window (`/start_period`).
  - No one is kicked during the grace period, and no one is automatically removed when the timer expires.
  - After 7 days, admins can run `/preview_removals` to inspect unverified members and explicitly confirm or cancel removal.
  - Verified students, admins, manually approved guests/teachers (`/approve`), and users with unknown status are automatically protected.

---

## Project Structure

```text
telegram-student-verification-bot/
├── src/
│   ├── index.js            # Main Cloudflare Worker webhook handler & bot logic
│   └── i18n.js             # English, French, and Arabic (RTL) translations
├── tests/
│   └── bot.test.js         # Automated integration tests backed by real SQLite
├── schema.sql              # D1 / SQLite schema with 1-to-1 UNIQUE constraints
├── sample_students.csv     # Mock student roster for safe local testing
├── wrangler.toml           # Cloudflare Worker & D1 configuration
├── .dev.vars.example       # Template for local development secrets
├── .gitignore              # Prevents secrets and node_modules from being committed
├── LICENSE                 # MIT Open Source License
└── package.json            # Scripts for testing, local dev, and deployment
```

---

## Commands Reference

### Student Commands (Private Chat)

| Command | Description |
| :--- | :--- |
| `/start` | Start the bot and select your preferred language (`EN` / `FR` / `AR`). |
| `/verify` | Verify and link your official Student ID (`matricule`) to your Telegram account. |
| `/language` | Switch your preferred language at any time. |
| `/cancel` | Cancel an active verification prompt. |

### Administrator Commands

| Command | Context | Description |
| :--- | :--- | :--- |
| `/admin` | Private | Display the administrator command reference. |
| `/register_group` | Group | Register the current Telegram group as the tracked class group. |
| `/set_group <chat_id>` | Private | Manually set the tracked group chat ID (e.g., `-1001234567890`). |
| `/import` | Private | Upload a `.csv` roster file or paste CSV lines (`matricule,full_name,section`). |
| `/stats` | Private | View roster verification metrics, group counts, and 7-day period status. |
| `/verified_list` | Private | List verified students and their linked Telegram IDs. |
| `/unverified` | Private | List known unverified members in the tracked group. |
| `/approve <telegram_id>` | Private | Manually approve and protect a member (e.g., professor, TA, or guest). |
| `/start_period` | Private | Start the 7-day verification period. |
| `/preview_removals` | Private | Preview eligible unverified members after the 7-day deadline and confirm removal. |

---

## Quick Start & Deployment

### 1. Prerequisites
- [Node.js LTS](https://nodejs.org/) (v18+)
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)

### 2. Install & Run Tests Locally

```bash
git clone https://github.com/<YOUR_USERNAME>/telegram-student-verification-bot.git
cd telegram-student-verification-bot
npm install
npm test
```

### 3. Create & Initialize Cloudflare D1 Database

Log in to Cloudflare and create your serverless SQLite database:

```bash
npx wrangler login
npx wrangler d1 create student_verifier_db
```

Copy the `database_id` printed in your terminal and paste it into `wrangler.toml` under `[[d1_databases]]`. Then initialize the database schema:

```bash
npm run db:init:remote
```

### 4. Configure Encrypted Secrets

Never put your tokens in plain text files. Store them as encrypted Cloudflare secrets:

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ADMIN_IDS
```
*(For `ADMIN_IDS`, enter a comma-separated list of numeric Telegram user IDs, e.g., `123456789,987654321`).*

### 5. Deploy to Cloudflare Workers

```bash
npm run deploy
```

### 6. Register the Telegram Webhook

Replace `<YOUR_BOT_TOKEN>`, `<YOUR_WORKER_URL>`, and `<YOUR_WEBHOOK_SECRET>` in the command below:

**Linux / macOS (curl):**
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<YOUR_WORKER_URL>/webhook",
    "secret_token": "<YOUR_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query", "chat_member"]
  }'
```

**Windows (PowerShell):**
```powershell
Invoke-RestMethod -Uri "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"url":"https://<YOUR_WORKER_URL>/webhook","secret_token":"<YOUR_WEBHOOK_SECRET>","allowed_updates":["message","callback_query","chat_member"]}'
```

---

## Customizing for Your University or Organization

You can customize the community name and default section in `wrangler.toml`:

```toml
[vars]
COMMUNITY_NAME = "Computer Science Department"
DEFAULT_SECTION = "Section A"
```

To import your student list, prepare a `.csv` file with the following columns (see `sample_students.csv`):

```csv
matricule,full_name,section
232331001001,Amine Benali,Computer Science - Section A
232331001002,Yasmine Khelifi,Computer Science - Section B
```

Then send the `.csv` file privately to your bot with the caption `/import`.

---

## Note on Existing Group Members

Telegram's Bot API does not allow bots to fetch a full list of silent members who joined a group before the bot was added.
- **Automatic tracking**: Any user who joins the group, leaves, or sends a message after the bot is added is automatically recorded in `group_members`.
- **Silent pre-existing members**: Compare silent accounts in your Telegram Group Info list against `/verified_list`. Users with an `unknown` status are never automatically removed.

---

## License

Released under the [MIT License](./LICENSE).
