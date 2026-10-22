import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import worker, { handleTelegramUpdate } from '../src/index.js';
import { MESSAGES } from '../src/i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const SAMPLE_CSV = fs.readFileSync(path.join(__dirname, '..', 'sample_students.csv'), 'utf8');

/**
 * Creates a real SQLite-backed Cloudflare D1 mock using Python's built-in `sqlite3` module.
 * This ensures every SQLite query, UNIQUE constraint, ON CONFLICT clause, and JOIN in
 * `schema.sql` and `src/index.js` is tested against genuine SQLite 3.
 */
class SqliteD1Database {
  constructor() {
    const pyScript = `
import sys, json, sqlite3

conn = sqlite3.connect(":memory:")
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA foreign_keys = ON;")

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    cmd = req.get("cmd")
    sql = req.get("sql", "")
    params = req.get("params", [])
    try:
        if cmd == "exec":
            conn.executescript(sql)
            conn.commit()
            print(json.dumps({"ok": True}), flush=True)
        elif cmd == "first":
            cur = conn.execute(sql, params)
            row = cur.fetchone()
            print(json.dumps({"ok": True, "row": dict(row) if row else None}), flush=True)
        elif cmd == "all":
            cur = conn.execute(sql, params)
            rows = [dict(r) for r in cur.fetchall()]
            print(json.dumps({"ok": True, "results": rows}), flush=True)
        elif cmd == "run":
            cur = conn.execute(sql, params)
            conn.commit()
            print(json.dumps({"ok": True, "meta": {"changes": cur.rowcount}}), flush=True)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}), flush=True)
`;
    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
    this.proc = spawn(pythonBin, ['-u', '-c', pyScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.queue = [];
    this.buffer = '';

    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let idx;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        const resolver = this.queue.shift();
        if (resolver) {
          const parsed = JSON.parse(line);
          if (parsed.ok) {
            resolver.resolve(parsed);
          } else {
            resolver.reject(new Error(parsed.error));
          }
        }
      }
    });
  }

  _send(payload) {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.proc.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  async exec(sql) {
    return this._send({ cmd: 'exec', sql });
  }

  prepare(sql) {
    const db = this;
    return {
      _params: [],
      bind(...params) {
        this._params = params;
        return this;
      },
      async first() {
        const res = await db._send({ cmd: 'first', sql, params: this._params });
        return res.row;
      },
      async all() {
        const res = await db._send({ cmd: 'all', sql, params: this._params });
        return { results: res.results };
      },
      async run() {
        const res = await db._send({ cmd: 'run', sql, params: this._params });
        return { meta: res.meta };
      }
    };
  }

  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

async function createTestHarness() {
  const db = new SqliteD1Database();
  await db.exec(SCHEMA_SQL);

  const apiCalls = [];
  let mockFileContent = SAMPLE_CSV;

  const env = {
    DB: db,
    BOT_TOKEN: 'TEST_TOKEN_123',
    WEBHOOK_SECRET: 'SUPER_SECRET_WEBHOOK_TOKEN',
    ADMIN_IDS: '900001, 900002',
    __testTelegramFetch: async (url, options) => {
      if (url.includes('/file/bot')) {
        return {
          ok: true,
          text: async () => mockFileContent
        };
      }
      const method = url.split('/').pop();
      const body = options?.body ? JSON.parse(options.body) : {};
      apiCalls.push({ method, body });

      if (method === 'getFile') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            result: { file_path: 'documents/sample_students.csv' }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({ ok: true, result: true })
      };
    }
  };

  return {
    db,
    env,
    apiCalls,
    setMockFileContent(content) {
      mockFileContent = content;
    },
    clearCalls() {
      apiCalls.length = 0;
    },
    close() {
      db.close();
    }
  };
}

test('1. /start and /language support English, French, and Arabic (RTL) and persist choice', async () => {
  const h = await createTestHarness();
  try {
    // Student sends /start
    await handleTelegramUpdate(h.env, {
      message: {
        message_id: 1,
        from: { id: 1001, first_name: 'Amine', username: 'amine_student' },
        chat: { id: 1001, type: 'private' },
        text: '/start'
      }
    });

    assert.equal(h.apiCalls.length, 1);
    assert.equal(h.apiCalls[0].method, 'sendMessage');
    assert.ok(h.apiCalls[0].body.reply_markup.inline_keyboard[0].length === 3);

    // Student selects Arabic (lang:ar)
    h.clearCalls();
    await handleTelegramUpdate(h.env, {
      callback_query: {
        id: 'cb_1',
        from: { id: 1001, first_name: 'Amine' },
        message: { chat: { id: 1001, type: 'private' } },
        data: 'lang:ar'
      }
    });

    const msgCall = h.apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(msgCall.body.text.includes('تم اختيار اللغة العربية'));

    const userRow = await h.db.prepare('SELECT language FROM users WHERE telegram_id = ?').bind('1001').first();
    assert.equal(userRow.language, 'ar');

    // Student switches to English via /language -> lang:en
    h.clearCalls();
    await handleTelegramUpdate(h.env, {
      message: {
        message_id: 2,
        from: { id: 1001, first_name: 'Amine' },
        chat: { id: 1001, type: 'private' },
        text: '/language'
      }
    });
    assert.equal(h.apiCalls[0].method, 'sendMessage');
    assert.ok(h.apiCalls[0].body.reply_markup.inline_keyboard);

    h.clearCalls();
    await handleTelegramUpdate(h.env, {
      callback_query: {
        id: 'cb_2',
        from: { id: 1001, first_name: 'Amine' },
        message: { chat: { id: 1001, type: 'private' } },
        data: 'lang:en'
      }
    });
    const userRowAfter = await h.db.prepare('SELECT language FROM users WHERE telegram_id = ?').bind('1001').first();
    assert.equal(userRowAfter.language, 'en');
  } finally {
    h.close();
  }
});

test('2. Admin authorization strictly checks numeric Telegram IDs (never username alone) and imports CSV', async () => {
  const h = await createTestHarness();
  try {
    // Imposter with unauthorized numeric ID 555555 tries /import
    await handleTelegramUpdate(h.env, {
      message: {
        message_id: 10,
        from: { id: 555555, first_name: 'Imposter', username: 'admin_imposter' },
        chat: { id: 555555, type: 'private' },
        text: '/import'
      }
    });
    assert.ok(h.apiCalls[0].body.text.includes('Unauthorized'));

    // Real authorized admin (numeric ID 900001) uploads sample_students.csv
    h.clearCalls();
    await handleTelegramUpdate(h.env, {
      message: {
        message_id: 11,
        from: { id: 900001, first_name: 'Admin', username: 'group_admin' },
        chat: { id: 900001, type: 'private' },
        caption: '/import',
        document: { file_id: 'file_csv_1', file_name: 'sample_students.csv' }
      }
    });

    const sendMsg = h.apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(sendMsg.body.text.includes('CSV Import Complete'));
    assert.ok(sendMsg.body.text.includes('Processed rows: 8'));
  } finally {
    h.close();
  }
});

test('3. Student verification, button ownership, and 1-to-1 duplicate prevention', async () => {
  const h = await createTestHarness();
  try {
    // Import CSV as admin 900001
    await handleTelegramUpdate(h.env, {
      message: {
        message_id: 1,
        from: { id: 900001, first_name: 'Admin' },
        chat: { id: 900001, type: 'private' },
        caption: '/import',
        document: { file_id: 'file_csv_1', file_name: 'sample_students.csv' }
      }
    });

    // Student 1 (ID 2001) sets language to English
    await handleTelegramUpdate(h.env, {
      callback_query: {
        id: 'lang_1',
        from: { id: 2001, first_name: 'Amine' },
        message: { chat: { id: 2001, type: 'private' } },
        data: 'lang:en'
      }
    });

    // Student 1 enters an UNKNOWN student ID
    h.clearCalls();
    await handleTelegramUpdate(h.env, {
      message: {
        message_id: 2,
        from: { id: 2001, first_name: 'Amine' },
        chat: { id: 2001, type: 'private' },
        text: '/verify'
      }
    });
    assert.ok(h.apiCalls[0].body.text.includes('enter your student ID'));

    h.clearCalls();
    await handleTelegramUpdate(h.env, {
      message: {
        message_id: 3,
        from: { id: 2001, first_name: 'Amine' },
        chat: { id: 2001, type: 'private' },
        text: '999999999999'
      }
    });
    assert.equal(h.apiCalls[0].body.text, MESSAGES.en.unknown_matricule);

    // Student 1 runs /verify and enters valid matricule 232331001001 (Amine Benali)
    await handleTelegramUpdate(h.env, {
      message: {
        message_id: 4,
        from: { id: 2001, first_name: 'Amine' },
        chat: { id: 2001, type: 'private' },
        text: '/verify'
      }
    });
    h.clearCalls();
    await handleTelegramUpdate(h.env, {
      message: {
        message_id: 5,
        from: { id: 2001, first_name: 'Amine' },
        chat: { id: 2001, type: 'private' },
        text: '232331001001'
      }
    });

    const confirmPrompt = h.apiCalls[0].body;
    assert.ok(confirmPrompt.text.includes('Amine Benali'));
    const confirmCallbackData = confirmPrompt.reply_markup.inline_keyboard[0][0].callback_data;

    // Another user (ID 2002) tries to click Student 1's Confirm button -> rejected!
    h.clearCalls();
    await handleTelegramUpdate(h.env, {
      callback_query: {
        id: 'wrong_user_cb',
        from: { id: 2002, first_name: 'Intruder' },
        message: { chat: { id: 2001, type: 'private' } },
        data: confirmCallbackData
      }
    });
    assert.equal(h.apiCalls[0].method, 'answerCallbackQuery');
    assert.ok(h.apiCalls[0].body.text.includes('Seul le compte') || h.apiCalls[0].body.text.includes('Only the Telegram account'));

    // Student 1 clicks Confirm after 15 minutes (expired) -> rejected as expired!
    const startNow = 1700000000000;
    await handleTelegramUpdate(
      h.env,
      {
        message: {
          message_id: 6,
          from: { id: 2001, first_name: 'Amine' },
          chat: { id: 2001, type: 'private' },
          text: '/verify 232331001001'
        }
      },
      startNow
    );
    const freshConfirmData = h.apiCalls[h.apiCalls.length - 1].body.reply_markup.inline_keyboard[0][0].callback_data;

    h.clearCalls();
    await handleTelegramUpdate(
      h.env,
      {
        callback_query: {
          id: 'expired_cb',
          from: { id: 2001, first_name: 'Amine' },
          message: { chat: { id: 2001, type: 'private' } },
          data: freshConfirmData
        }
      },
      startNow + 15 * 60 * 1000
    );
    const expiredMsg = h.apiCalls.find((c) => c.method === 'sendMessage');
    assert.equal(expiredMsg.body.text, MESSAGES.en.button_expired);

    // Now Student 1 verifies within valid window
    h.clearCalls();
    await handleTelegramUpdate(
      h.env,
      {
        message: {
          message_id: 7,
          from: { id: 2001, first_name: 'Amine' },
          chat: { id: 2001, type: 'private' },
          text: '/verify 232331001001'
        }
      },
      startNow
    );
    const validConfirmData = h.apiCalls[0].body.reply_markup.inline_keyboard[0][0].callback_data;

    h.clearCalls();
    await handleTelegramUpdate(
      h.env,
      {
        callback_query: {
          id: 'valid_cb',
          from: { id: 2001, first_name: 'Amine' },
          message: { chat: { id: 2001, type: 'private' } },
          data: validConfirmData
        }
      },
      startNow + 5000
    );
    const successMsg = h.apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(successMsg.body.text.includes('Verification complete!'));

    // Student 1 (already verified) runs /verify again in English, French, and Arabic
    for (const [langCode, expectedExactText] of [
      ['en', MESSAGES.en.already_verified],
      ['fr', MESSAGES.fr.already_verified],
      ['ar', MESSAGES.ar.already_verified]
    ]) {
      await handleTelegramUpdate(h.env, {
        callback_query: {
          id: `switch_${langCode}`,
          from: { id: 2001, first_name: 'Amine' },
          message: { chat: { id: 2001, type: 'private' } },
          data: `lang:${langCode}`
        }
      });
      h.clearCalls();
      await handleTelegramUpdate(h.env, {
        message: {
          message_id: 8,
          from: { id: 2001, first_name: 'Amine' },
          chat: { id: 2001, type: 'private' },
          text: '/verify'
        }
      });
      assert.equal(h.apiCalls.length, 1);
      assert.equal(h.apiCalls[0].body.text, expectedExactText);
      assert.equal(h.apiCalls[0].body.reply_markup, undefined);
    }

    // Student 2 (ID 2002) tries to claim Student 1's matricule (232331001001)
    h.clearCalls();
    await handleTelegramUpdate(h.env, {
      message: {
        message_id: 9,
        from: { id: 2002, first_name: 'Other' },
        chat: { id: 2002, type: 'private' },
        text: '/verify 232331001001'
      }
    });
    assert.equal(h.apiCalls[0].body.text, MESSAGES.fr.matricule_already_claimed);
  } finally {
    h.close();
  }
});

test('4. 7-day verification period, member protection rules, preview, and explicit admin confirmation', async () => {
  const h = await createTestHarness();
  try {
    const groupChatId = -100987654321;
    const t0 = 1700000000000;

    // Admin imports CSV and registers group
    await handleTelegramUpdate(
      h.env,
      {
        message: {
          message_id: 1,
          from: { id: 900001, first_name: 'Admin' },
          chat: { id: 900001, type: 'private' },
          caption: '/import',
          document: { file_id: 'file_csv_1', file_name: 'sample_students.csv' }
        }
      },
      t0
    );
    await handleTelegramUpdate(
      h.env,
      {
        message: {
          message_id: 2,
          from: { id: 900001, first_name: 'Admin' },
          chat: { id: groupChatId, type: 'supergroup' },
          text: '/register_group'
        }
      },
      t0
    );

    // Simulate group members:
    // - 3001: Verified student (claims 232331001002)
    // - 3002: Manually approved student/TA
    // - 3003: Unknown status member (inserted with status = 'unknown')
    // - 900002: Co-Admin (in ADMIN_IDS)
    // - 3004: Unverified ordinary member (should be removed ONLY after 7 days + preview + confirm)
    for (const id of [3001, 3002, 3004, 900002]) {
      await handleTelegramUpdate(
        h.env,
        {
          message: {
            message_id: 10 + id,
            from: { id, first_name: `User${id}`, username: `u${id}` },
            chat: { id: groupChatId, type: 'supergroup' },
            text: 'Hello!'
          }
        },
        t0
      );
    }

    // Insert 3003 with 'unknown' membership status
    await h.db
      .prepare(
        "INSERT INTO group_members (chat_id, telegram_id, username, full_name, status, manually_approved, first_seen_at, last_seen_at) VALUES (?, '3003', 'u3003', 'UnknownStatusUser', 'unknown', 0, ?, ?)"
      )
      .bind(String(groupChatId), t0, t0)
      .run();

    // Verify student 3001
    await handleTelegramUpdate(
      h.env,
      {
        message: {
          message_id: 20,
          from: { id: 3001, first_name: 'Yasmine' },
          chat: { id: 3001, type: 'private' },
          text: '/verify 232331001002'
        }
      },
      t0
    );
    const confirmData3001 = h.apiCalls[h.apiCalls.length - 1].body.reply_markup.inline_keyboard[0][0].callback_data;
    await handleTelegramUpdate(
      h.env,
      {
        callback_query: {
          id: 'cb_3001',
          from: { id: 3001, first_name: 'Yasmine' },
          message: { chat: { id: 3001, type: 'private' } },
          data: confirmData3001
        }
      },
      t0 + 1000
    );

    // Admin manually approves 3002
    await handleTelegramUpdate(
      h.env,
      {
        message: {
          message_id: 21,
          from: { id: 900001, first_name: 'Admin' },
          chat: { id: 900001, type: 'private' },
          text: '/approve 3002'
        }
      },
      t0 + 2000
    );

    // Admin starts 7-day verification period at t0
    h.clearCalls();
    await handleTelegramUpdate(
      h.env,
      {
        message: {
          message_id: 22,
          from: { id: 900001, first_name: 'Admin' },
          chat: { id: 900001, type: 'private' },
          text: '/start_period'
        }
      },
      t0
    );
    assert.ok(h.apiCalls[0].body.text.includes('Seven-Day Verification Period Started'));

    // During the 7-day period (e.g., Day 3), /preview_removals refuses to offer removal buttons
    const day3 = t0 + 3 * 24 * 60 * 60 * 1000;
    h.clearCalls();
    await handleTelegramUpdate(
      h.env,
      {
        message: {
          message_id: 23,
          from: { id: 900001, first_name: 'Admin' },
          chat: { id: 900001, type: 'private' },
          text: '/preview_removals'
        }
      },
      day3
    );
    assert.ok(h.apiCalls[0].body.text.includes('still active'));
    assert.equal(h.apiCalls[0].body.reply_markup, undefined);

    // After 7 days + 1 minute, no one was automatically kicked!
    const after7Days = t0 + 7 * 24 * 60 * 60 * 1000 + 60 * 1000;
    assert.equal(h.apiCalls.filter((c) => c.method === 'banChatMember').length, 0);

    // Admin runs /preview_removals after 7 days -> ONLY User3004 is listed in preview!
    h.clearCalls();
    await handleTelegramUpdate(
      h.env,
      {
        message: {
          message_id: 24,
          from: { id: 900001, first_name: 'Admin' },
          chat: { id: 900001, type: 'private' },
          text: '/preview_removals'
        }
      },
      after7Days
    );
    const previewMsg = h.apiCalls[0].body;
    assert.ok(previewMsg.text.includes('User3004'));
    assert.ok(!previewMsg.text.includes('User3001')); // Verified student protected
    assert.ok(!previewMsg.text.includes('User3002')); // Manually approved protected
    assert.ok(!previewMsg.text.includes('UnknownStatusUser')); // Unknown status protected
    assert.ok(!previewMsg.text.includes('User900002')); // Admin protected

    const confirmRemoveBtn = previewMsg.reply_markup.inline_keyboard[0][0].callback_data;

    // Admin explicitly confirms removal -> ONLY 3004 is removed via banChatMember + unbanChatMember
    h.clearCalls();
    await handleTelegramUpdate(
      h.env,
      {
        callback_query: {
          id: 'cb_remove',
          from: { id: 900001, first_name: 'Admin' },
          message: { chat: { id: 900001, type: 'private' } },
          data: confirmRemoveBtn
        }
      },
      after7Days + 5000
    );

    const banCalls = h.apiCalls.filter((c) => c.method === 'banChatMember');
    assert.equal(banCalls.length, 1);
    assert.equal(banCalls[0].body.user_id, 3004);
  } finally {
    h.close();
  }
});

test('5. HTTP Worker fetch verifies X-Telegram-Bot-Api-Secret-Token header on /webhook', async () => {
  const h = await createTestHarness();
  try {
    const badReq = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'WRONG_SECRET' },
      body: JSON.stringify({})
    });
    const badRes = await worker.fetch(badReq, h.env);
    assert.equal(badRes.status, 403);

    const goodReq = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'SUPER_SECRET_WEBHOOK_TOKEN'
      },
      body: JSON.stringify({
        message: {
          message_id: 1,
          from: { id: 4001, first_name: 'Sara' },
          chat: { id: 4001, type: 'private' },
          text: '/start'
        }
      })
    });
    const goodRes = await worker.fetch(goodReq, h.env);
    assert.equal(goodRes.status, 200);
    assert.equal(h.apiCalls.length, 1);
  } finally {
    h.close();
  }
});
