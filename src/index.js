import { t, getLanguageKeyboard, getConfirmKeyboard, SUPPORTED_LANGUAGES } from './i18n.js';

const CONFIRMATION_TTL_MS = 10 * 60 * 1000; // 10 minutes for Confirm/Cancel buttons
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // Exactly 7 days in milliseconds

/**
 * Parse authorized numeric administrator Telegram IDs from env.ADMIN_IDS.
 * Never authorizes by username. Only strict numeric IDs are accepted.
 */
export function getAdminIds(env) {
  const raw = String(env.ADMIN_IDS || '');
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
  );
}

export function isAdminUser(env, telegramUserId) {
  if (telegramUserId === undefined || telegramUserId === null) return false;
  const idStr = String(telegramUserId).trim();
  if (!/^\d+$/.test(idStr)) return false;
  return getAdminIds(env).has(idStr);
}

/**
 * Parse CSV text into an array of { matricule, full_name, section } objects.
 * Supports header row (matricule,full_name,section) or headerless 2/3-column CSV.
 */
export function parseStudentCsv(csvText, defaultSection = 'General') {
  const lines = String(csvText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const records = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 2) continue;

    const firstColLower = cols[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      i === 0 &&
      (firstColLower === 'matricule' ||
        firstColLower === 'id' ||
        firstColLower === 'studentid' ||
        firstColLower === 'numero')
    ) {
      continue; // Skip header row
    }

    const matricule = normalizeMatricule(cols[0]);
    const fullName = cols[1].trim();
    const section = (cols[2] || defaultSection).trim();

    if (matricule && fullName) {
      records.push({ matricule, full_name: fullName, section });
    }
  }
  return records;
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  const delimiter = line.includes(';') && !line.includes(',') ? ';' : ',';

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function normalizeMatricule(input) {
  const cleaned = String(input || '').trim().replace(/\s+/g, '');
  if (!/^[A-Za-z0-9]{4,20}$/.test(cleaned)) {
    return null;
  }
  return cleaned.toUpperCase();
}

function generateToken() {
  const bytes = new Uint8Array(12);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Helper to call Telegram Bot API methods.
 * Allows injecting a custom `__testTelegramFetch` in env for offline automated tests.
 */
async function callTelegram(env, method, payload) {
  const fetchFn = env.__testTelegramFetch || fetch;
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

async function downloadTelegramFile(env, fileId) {
  const fileInfo = await callTelegram(env, 'getFile', { file_id: fileId });
  if (!fileInfo || !fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error('Could not retrieve file path from Telegram.');
  }
  const fetchFn = env.__testTelegramFetch || fetch;
  const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileInfo.result.file_path}`;
  const res = await fetchFn(fileUrl, { method: 'GET' });
  if (!res.ok) {
    throw new Error('Failed to download CSV file from Telegram.');
  }
  return res.text();
}

async function getOrCreateUser(db, from, now) {
  const telegramId = String(from.id);
  const existing = await db
    .prepare('SELECT * FROM users WHERE telegram_id = ?')
    .bind(telegramId)
    .first();

  if (existing) {
    await db
      .prepare('UPDATE users SET username = ?, first_name = ?, updated_at = ? WHERE telegram_id = ?')
      .bind(from.username || null, from.first_name || '', now, telegramId)
      .run();
    return existing;
  }

  const defaultLang = 'fr';
  await db
    .prepare(
      'INSERT INTO users (telegram_id, username, first_name, language, state, verified_matricule, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?)'
    )
    .bind(telegramId, from.username || null, from.first_name || '', defaultLang, 'IDLE', now)
    .run();

  return {
    telegram_id: telegramId,
    username: from.username || null,
    first_name: from.first_name || '',
    language: defaultLang,
    state: 'IDLE',
    verified_matricule: null,
    updated_at: now
  };
}

/**
 * Checks whether a Telegram user is already verified in either `students` or `users`.
 */
async function isUserAlreadyVerified(db, telegramId) {
  const claimedStudent = await db
    .prepare('SELECT matricule, full_name FROM students WHERE claimed_by_telegram_id = ?')
    .bind(String(telegramId))
    .first();
  if (claimedStudent) return true;

  const userRow = await db
    .prepare('SELECT verified_matricule FROM users WHERE telegram_id = ? AND verified_matricule IS NOT NULL')
    .bind(String(telegramId))
    .first();
  return Boolean(userRow && userRow.verified_matricule);
}

async function getSetting(db, key) {
  const row = await db.prepare('SELECT value FROM bot_settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

async function setSetting(db, key, value, now) {
  await db
    .prepare(
      'INSERT INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    )
    .bind(key, String(value), now)
    .run();
}

/**
 * Passively tracks group membership from group messages, joins, or chat_member updates.
 * Note: Telegram does not provide an API to list all pre-existing quiet members.
 */
async function recordGroupMemberActivity(db, chatId, userObj, status, now) {
  if (!userObj || userObj.is_bot) return;
  const telegramId = String(userObj.id);
  const fullName = [userObj.first_name, userObj.last_name].filter(Boolean).join(' ').trim() || 'Unknown';
  const username = userObj.username || null;

  const existing = await db
    .prepare('SELECT status, manually_approved FROM group_members WHERE chat_id = ? AND telegram_id = ?')
    .bind(String(chatId), telegramId)
    .first();

  // Do not downgrade known administrator/creator status when they simply send a normal message
  let nextStatus = status || 'member';
  if (existing && (existing.status === 'administrator' || existing.status === 'creator') && status === 'member') {
    nextStatus = existing.status;
  }

  await db
    .prepare(
      `INSERT INTO group_members (chat_id, telegram_id, username, full_name, status, manually_approved, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(chat_id, telegram_id) DO UPDATE SET
         username = excluded.username,
         full_name = excluded.full_name,
         status = ?,
         last_seen_at = excluded.last_seen_at`
    )
    .bind(String(chatId), telegramId, username, fullName, nextStatus, now, now, nextStatus)
    .run();

  // Remember the primary group chat ID if not set yet
  const savedChatId = await getSetting(db, 'group_chat_id');
  if (!savedChatId) {
    await setSetting(db, 'group_chat_id', String(chatId), now);
  }
}

/**
 * Returns the list of known unverified members in the target group who are eligible for review/removal.
 * Protects:
 *   1. Verified students (claimed_by_telegram_id in `students` or verified_matricule in `users`)
 *   2. Administrators (in ADMIN_IDS or status in ('administrator', 'creator'))
 *   3. Manually approved members (manually_approved = 1)
 *   4. People whose membership status is unknown or not currently in group (only 'member' or 'restricted' are eligible)
 */
export async function getUnverifiedCandidates(db, env, chatId) {
  const rows = await db
    .prepare(
      `SELECT gm.chat_id, gm.telegram_id, gm.username, gm.full_name, gm.status, gm.manually_approved
       FROM group_members gm
       LEFT JOIN students s ON s.claimed_by_telegram_id = gm.telegram_id
       LEFT JOIN users u ON u.telegram_id = gm.telegram_id
       WHERE gm.chat_id = ?
         AND gm.manually_approved = 0
         AND gm.status IN ('member', 'restricted')
         AND s.matricule IS NULL
         AND (u.verified_matricule IS NULL OR u.verified_matricule = '')
       ORDER BY gm.first_seen_at ASC`
    )
    .bind(String(chatId))
    .all();

  const list = rows?.results || [];
  return list.filter((member) => !isAdminUser(env, member.telegram_id));
}

async function handleMatriculeLookup(env, chatId, user, rawText, now) {
  const db = env.DB;
  const lang = user.language;

  // Double-check if user is already verified
  if (await isUserAlreadyVerified(db, user.telegram_id)) {
    await db.prepare("UPDATE users SET state = 'IDLE', updated_at = ? WHERE telegram_id = ?").bind(now, user.telegram_id).run();
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: t(lang, 'already_verified')
    });
    return;
  }

  const matricule = normalizeMatricule(rawText);
  if (!matricule) {
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: t(lang, 'invalid_matricule_format')
    });
    return;
  }

  const student = await db
    .prepare('SELECT matricule, full_name, section, claimed_by_telegram_id FROM students WHERE matricule = ?')
    .bind(matricule)
    .first();

  if (!student) {
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: t(lang, 'unknown_matricule')
    });
    return;
  }

  if (student.claimed_by_telegram_id && String(student.claimed_by_telegram_id) !== String(user.telegram_id)) {
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: t(lang, 'matricule_already_claimed')
    });
    return;
  }

  // Found and available -> Create a pending confirmation token bound to this Telegram user ID
  const token = generateToken();
  const expiresAt = now + CONFIRMATION_TTL_MS;

  await db
    .prepare('DELETE FROM pending_confirmations WHERE telegram_id = ?')
    .bind(user.telegram_id)
    .run();

  await db
    .prepare(
      'INSERT INTO pending_confirmations (token, telegram_id, matricule, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(token, user.telegram_id, student.matricule, now, expiresAt)
    .run();

  await db
    .prepare("UPDATE users SET state = 'IDLE', updated_at = ? WHERE telegram_id = ?")
    .bind(now, user.telegram_id)
    .run();

  await callTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: t(lang, 'confirm_identity', {
      fullName: student.full_name,
      matricule: student.matricule,
      section: student.section
    }),
    reply_markup: getConfirmKeyboard(lang, token)
  });
}

async function handleAdminCsvImport(env, chatId, csvContent, now) {
  const db = env.DB;
  const defaultSection = env.DEFAULT_SECTION || 'General';
  const records = parseStudentCsv(csvContent, defaultSection);
  if (records.length === 0) {
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: '⚠️ No valid student rows found in CSV. Expected format:\nmatricule,full_name,section\n232331001001,Amine Benali,Section A'
    });
    return;
  }

  let insertedOrUpdated = 0;
  for (const row of records) {
    await db
      .prepare(
        `INSERT INTO students (matricule, full_name, section)
         VALUES (?, ?, ?)
         ON CONFLICT(matricule) DO UPDATE SET
           full_name = excluded.full_name,
           section = excluded.section`
      )
      .bind(row.matricule, row.full_name, row.section)
      .run();
    insertedOrUpdated++;
  }

  const totalRow = await db.prepare('SELECT COUNT(*) AS count FROM students').first();
  await callTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: `✅ CSV Import Complete!\n• Processed rows: ${insertedOrUpdated}\n• Total students in database: ${totalRow?.count || insertedOrUpdated}\n\nExisting verified student links were preserved.`
  });
}

async function handleAdminCommand(env, message, user, command, argsText, now) {
  const db = env.DB;
  const chatId = message.chat.id;
  const communityName = env.COMMUNITY_NAME || 'Student Community';

  if (command === '/admin' || command === '/admin_help') {
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text:
        `🛡️ Administrator Commands (${communityName}):\n\n` +
        '• /import - Upload a CSV file (with caption /import) or run /import to paste CSV rows privately\n' +
        '• /stats - View verification statistics & 7-day period status\n' +
        '• /unverified - Review known unverified group members\n' +
        '• /verified_list - View verified students and their linked Telegram IDs\n' +
        '• /start_period - Start the 7-day verification period (no one is kicked during or automatically after)\n' +
        '• /preview_removals - Preview unverified members eligible for removal after the 7-day deadline\n' +
        '• /approve <telegram_id> - Manually protect/approve a member (e.g., delegate, teacher, or guest)\n' +
        '• /set_group <chat_id> - Set the target group chat ID (or run /register_group inside the group)\n\n' +
        'ℹ️ Note on existing members: Telegram bots cannot automatically list silent members who joined before the bot was added. When members join, send a message, or verify, the bot tracks them. For completely silent pre-existing members, compare your group member list in Telegram against /verified_list.'
    });
    return true;
  }

  if (command === '/register_group') {
    if (message.chat.type === 'private') {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: 'ℹ️ Run /register_group inside your Telegram group, or use /set_group <chat_id> here.'
      });
      return true;
    }
    await setSetting(db, 'group_chat_id', String(chatId), now);
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: `✅ This group (${chatId}) is now registered as the official class group.`
    });
    return true;
  }

  // All other admin commands must be used in private chat for security
  if (message.chat.type !== 'private') {
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: '🔒 Please run administrator commands in a private message with the bot.'
    });
    return true;
  }

  if (command === '/set_group') {
    const targetGroup = argsText.trim();
    if (!/^-\d+$/.test(targetGroup)) {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: '⚠️ Please provide a valid negative group chat ID, e.g.: /set_group -1001234567890'
      });
      return true;
    }
    await setSetting(db, 'group_chat_id', targetGroup, now);
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: `✅ Target group chat ID set to: ${targetGroup}`
    });
    return true;
  }

  if (command === '/import') {
    if (argsText.trim().length > 0) {
      await handleAdminCsvImport(env, chatId, argsText, now);
      return true;
    }
    await db
      .prepare("UPDATE users SET state = 'AWAITING_CSV', updated_at = ? WHERE telegram_id = ?")
      .bind(now, user.telegram_id)
      .run();
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text:
        '📂 Send your official student `.csv` file as a document attachment now, or paste the CSV lines (`matricule,full_name,section`) in your next message.\n\nType /cancel to exit import mode.'
    });
    return true;
  }

  if (command === '/stats') {
    const totalRoster = (await db.prepare('SELECT COUNT(*) AS c FROM students').first())?.c || 0;
    const verifiedRoster =
      (await db.prepare('SELECT COUNT(*) AS c FROM students WHERE claimed_by_telegram_id IS NOT NULL').first())?.c || 0;
    const unverifiedRoster = totalRoster - verifiedRoster;

    const groupChatId = (await getSetting(db, 'group_chat_id')) || 'unconfigured';
    const knownGroupMembers =
      (
        await db
          .prepare("SELECT COUNT(*) AS c FROM group_members WHERE chat_id = ? AND status IN ('member', 'restricted', 'administrator', 'creator')")
          .bind(groupChatId)
          .first()
      )?.c || 0;
    const manuallyApproved =
      (
        await db
          .prepare('SELECT COUNT(*) AS c FROM group_members WHERE chat_id = ? AND manually_approved = 1')
          .bind(groupChatId)
          .first()
      )?.c || 0;

    const candidates = groupChatId !== 'unconfigured' ? await getUnverifiedCandidates(db, env, groupChatId) : [];

    const periodStart = Number((await getSetting(db, 'period_start')) || 0);
    const periodEnd = Number((await getSetting(db, 'period_end')) || 0);
    let periodStatus = 'Not started (/start_period)';
    if (periodStart && periodEnd) {
      if (now < periodEnd) {
        const hoursLeft = Math.ceil((periodEnd - now) / (1000 * 60 * 60));
        periodStatus = `Active (${hoursLeft}h remaining — ends ${new Date(periodEnd).toISOString().slice(0, 16).replace('T', ' ')} UTC)`;
      } else {
        periodStatus = `Expired on ${new Date(periodEnd).toISOString().slice(0, 16).replace('T', ' ')} UTC (Ready for /preview_removals)`;
      }
    }

    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text:
        `📊 Verification Statistics (${communityName})\n\n` +
        `🎓 Official CSV Roster:\n` +
        `• Total students in CSV: ${totalRoster}\n` +
        `• Verified students: ${verifiedRoster}\n` +
        `• Remaining unverified in CSV: ${unverifiedRoster}\n\n` +
        `👥 Group Tracking (${groupChatId}):\n` +
        `• Known active group members: ${knownGroupMembers}\n` +
        `• Manually approved members: ${manuallyApproved}\n` +
        `• Known unverified group members: ${candidates.length}\n\n` +
        `⏳ 7-Day Verification Period:\n` +
        `• Status: ${periodStatus}`
    });
    return true;
  }

  if (command === '/verified_list') {
    const rows = await db
      .prepare(
        `SELECT s.matricule, s.full_name, s.claimed_by_telegram_id, u.username
         FROM students s
         LEFT JOIN users u ON u.telegram_id = s.claimed_by_telegram_id
         WHERE s.claimed_by_telegram_id IS NOT NULL
         ORDER BY s.full_name ASC
         LIMIT 100`
      )
      .all();
    const verified = rows?.results || [];
    if (verified.length === 0) {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: '📋 No students have completed verification yet.'
      });
      return true;
    }
    const lines = verified.map(
      (r, idx) =>
        `${idx + 1}. ${r.full_name} (${r.matricule}) — TG ID: ${r.claimed_by_telegram_id}${r.username ? ` (@${r.username})` : ''}`
    );
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: `✅ Verified Students (${verified.length}):\n\n${lines.join('\n')}`
    });
    return true;
  }

  if (command === '/unverified') {
    const groupChatId = await getSetting(db, 'group_chat_id');
    if (!groupChatId) {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: '⚠️ No group chat is registered yet. Run /register_group inside your group or /set_group <chat_id> first.'
      });
      return true;
    }

    const candidates = await getUnverifiedCandidates(db, env, groupChatId);
    if (candidates.length === 0) {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: '✅ There are currently 0 known unverified members in the tracked group.'
      });
      return true;
    }

    const listText = candidates
      .slice(0, 50)
      .map(
        (m, idx) =>
          `${idx + 1}. ${m.full_name}${m.username ? ` (@${m.username})` : ''} — ID: ${m.telegram_id} [${m.status}]`
      )
      .join('\n');

    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text:
        `📋 Known Unverified Group Members (${candidates.length}):\n\n${listText}\n\n` +
        `💡 To manually protect a member (such as a teacher or guest), send:\n/approve <telegram_id>\n\n` +
        `ℹ️ Note: Telegram bots cannot automatically discover silent members who joined before the bot was added and never sent a message. Please manually review silent members in your Telegram Group Info list against /verified_list.`
    });
    return true;
  }

  if (command === '/approve') {
    const targetId = argsText.trim();
    if (!/^\d+$/.test(targetId)) {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: '⚠️ Usage: /approve <numeric_telegram_id>'
      });
      return true;
    }
    const groupChatId = (await getSetting(db, 'group_chat_id')) || 'default';
    await db
      .prepare(
        `INSERT INTO group_members (chat_id, telegram_id, username, full_name, status, manually_approved, first_seen_at, last_seen_at)
         VALUES (?, ?, NULL, 'Manually Approved', 'member', 1, ?, ?)
         ON CONFLICT(chat_id, telegram_id) DO UPDATE SET manually_approved = 1, last_seen_at = excluded.last_seen_at`
      )
      .bind(groupChatId, targetId, now, now)
      .run();

    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: `✅ Telegram user ID ${targetId} is now marked as manually approved and protected from removal.`
    });
    return true;
  }

  if (command === '/start_period') {
    const periodStart = now;
    const periodEnd = now + SEVEN_DAYS_MS;
    await setSetting(db, 'period_start', String(periodStart), now);
    await setSetting(db, 'period_end', String(periodEnd), now);
    await setSetting(db, 'removal_preview_token', '', now);

    const endIso = new Date(periodEnd).toISOString().slice(0, 16).replace('T', ' ');
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text:
        `⏳ Seven-Day Verification Period Started!\n\n` +
        `• Start: ${new Date(periodStart).toISOString().slice(0, 16).replace('T', ' ')} UTC\n` +
        `• Deadline (7 days): ${endIso} UTC\n\n` +
        `🛡️ Safety guarantees:\n` +
        `• No member will be kicked or restricted during this 7-day period.\n` +
        `• No member will be automatically removed when the deadline expires.\n` +
        `• After ${endIso} UTC, run /preview_removals to review and explicitly confirm any removals.`
    });
    return true;
  }

  if (command === '/preview_removals') {
    const groupChatId = await getSetting(db, 'group_chat_id');
    if (!groupChatId) {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: '⚠️ No group chat is registered yet. Run /register_group in your group or /set_group <chat_id> first.'
      });
      return true;
    }

    const periodStart = Number((await getSetting(db, 'period_start')) || 0);
    const periodEnd = Number((await getSetting(db, 'period_end')) || 0);

    if (!periodStart || !periodEnd) {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: '⚠️ No 7-day verification period has been started yet. Use /start_period first, or use /unverified to view unverified members without removing anyone.'
      });
      return true;
    }

    if (now < periodEnd) {
      const remainingHours = Math.ceil((periodEnd - now) / (1000 * 60 * 60));
      const endIso = new Date(periodEnd).toISOString().slice(0, 16).replace('T', ' ');
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text:
          `🛡️ The 7-day verification period is still active (${remainingHours} hours remaining until ${endIso} UTC).\n\n` +
          `No removals are allowed before the 7-day deadline finishes. You can use /unverified to inspect the current list safely.`
      });
      return true;
    }

    const candidates = await getUnverifiedCandidates(db, env, groupChatId);
    if (candidates.length === 0) {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: '✅ The 7-day period has completed, and there are 0 known unverified members eligible for removal.'
      });
      return true;
    }

    const previewToken = generateToken();
    await setSetting(db, 'removal_preview_token', previewToken, now);

    const previewLines = candidates
      .slice(0, 40)
      .map((m, idx) => `${idx + 1}. ${m.full_name}${m.username ? ` (@${m.username})` : ''} — ID: ${m.telegram_id}`)
      .join('\n');

    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text:
        `⚠️ Removal Preview (7-Day Deadline Passed)\n\n` +
        `The following ${candidates.length} known unverified member(s) in group ${groupChatId} are eligible for removal:\n\n` +
        `${previewLines}\n\n` +
        `🛡️ Protected automatically: Verified students, administrators, manually approved members, and anyone with unknown membership status.\n\n` +
        `Please review the list carefully. Click Confirm below ONLY if you want the bot to remove these ${candidates.length} member(s) now:`,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `🚨 Confirm Removal (${candidates.length})`,
              callback_data: `admin_remove_confirm:${previewToken}`
            },
            {
              text: '❌ Cancel',
              callback_data: `admin_remove_cancel:${previewToken}`
            }
          ]
        ]
      }
    });
    return true;
  }

  return false;
}

async function handleCallbackQuery(env, callbackQuery, now) {
  const db = env.DB;
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat?.id;
  const data = String(callbackQuery.data || '');
  const user = await getOrCreateUser(db, from, now);

  // 1. Language Selection Buttons: lang:en | lang:fr | lang:ar
  if (data.startsWith('lang:')) {
    const chosenLang = data.split(':')[1];
    if (SUPPORTED_LANGUAGES.includes(chosenLang)) {
      await db
        .prepare('UPDATE users SET language = ?, updated_at = ? WHERE telegram_id = ?')
        .bind(chosenLang, now, user.telegram_id)
        .run();

      await callTelegram(env, 'answerCallbackQuery', {
        callback_query_id: callbackQuery.id
      });
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(chosenLang, 'language_saved')
      });
    }
    return;
  }

  // 2. Student Verification Confirm / Cancel Buttons
  if (data.startsWith('confirm:') || data.startsWith('cancel:')) {
    const [action, token] = data.split(':');
    const pending = await db
      .prepare('SELECT * FROM pending_confirmations WHERE token = ?')
      .bind(token)
      .first();

    if (!pending) {
      await callTelegram(env, 'answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: t(user.language, 'button_expired'),
        show_alert: true
      });
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'button_expired')
      });
      return;
    }

    // Strict check: ONLY the Telegram account that started verification can confirm or cancel
    if (String(pending.telegram_id) !== String(from.id)) {
      await callTelegram(env, 'answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: t(user.language, 'button_wrong_user'),
        show_alert: true
      });
      return;
    }

    // Check expiration
    if (now > Number(pending.expires_at)) {
      await db.prepare('DELETE FROM pending_confirmations WHERE token = ?').bind(token).run();
      await callTelegram(env, 'answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: t(user.language, 'button_expired'),
        show_alert: true
      });
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'button_expired')
      });
      return;
    }

    if (action === 'cancel') {
      await db.prepare('DELETE FROM pending_confirmations WHERE token = ?').bind(token).run();
      await callTelegram(env, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'verification_cancelled')
      });
      return;
    }

    // Action === 'confirm'
    // First check if this Telegram account is already verified
    if (await isUserAlreadyVerified(db, user.telegram_id)) {
      await db.prepare('DELETE FROM pending_confirmations WHERE token = ?').bind(token).run();
      await callTelegram(env, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'already_verified')
      });
      return;
    }

    // Check if the matricule is still unclaimed and atomically link it
    const student = await db
      .prepare('SELECT matricule, full_name, section, claimed_by_telegram_id FROM students WHERE matricule = ?')
      .bind(pending.matricule)
      .first();

    if (!student) {
      await db.prepare('DELETE FROM pending_confirmations WHERE token = ?').bind(token).run();
      await callTelegram(env, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'unknown_matricule')
      });
      return;
    }

    if (student.claimed_by_telegram_id && String(student.claimed_by_telegram_id) !== String(user.telegram_id)) {
      await db.prepare('DELETE FROM pending_confirmations WHERE token = ?').bind(token).run();
      await callTelegram(env, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'matricule_already_claimed')
      });
      return;
    }

    try {
      // Atomic conditional claim on students table + update users table
      const claimResult = await db
        .prepare(
          'UPDATE students SET claimed_by_telegram_id = ?, claimed_at = ? WHERE matricule = ? AND claimed_by_telegram_id IS NULL'
        )
        .bind(user.telegram_id, now, pending.matricule)
        .run();

      const changes = claimResult?.meta?.changes ?? claimResult?.changes ?? 0;
      if (changes === 0) {
        await db.prepare('DELETE FROM pending_confirmations WHERE token = ?').bind(token).run();
        await callTelegram(env, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });
        await callTelegram(env, 'sendMessage', {
          chat_id: chatId,
          text: t(user.language, 'matricule_already_claimed')
        });
        return;
      }

      await db
        .prepare("UPDATE users SET verified_matricule = ?, state = 'IDLE', updated_at = ? WHERE telegram_id = ?")
        .bind(pending.matricule, now, user.telegram_id)
        .run();

      await db.prepare('DELETE FROM pending_confirmations WHERE token = ?').bind(token).run();

      await callTelegram(env, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'verification_success', {
          fullName: student.full_name,
          matricule: student.matricule
        })
      });
    } catch (err) {
      await db.prepare('DELETE FROM pending_confirmations WHERE token = ?').bind(token).run();
      await callTelegram(env, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'matricule_already_claimed')
      });
    }
    return;
  }

  // 3. Administrator Explicit Removal Confirmation / Cancellation
  if (data.startsWith('admin_remove_confirm:') || data.startsWith('admin_remove_cancel:')) {
    if (!isAdminUser(env, from.id)) {
      await callTelegram(env, 'answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: '⛔ Unauthorized: Only numeric admin IDs can perform this action.',
        show_alert: true
      });
      return;
    }

    const [action, token] = data.split(':');
    const savedToken = await getSetting(db, 'removal_preview_token');

    if (!savedToken || savedToken !== token) {
      await callTelegram(env, 'answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: '⌛ This removal preview has expired. Run /preview_removals again.',
        show_alert: true
      });
      return;
    }

    if (action === 'admin_remove_cancel') {
      await setSetting(db, 'removal_preview_token', '', now);
      await callTelegram(env, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: '❎ Removal cancelled. No members were removed.'
      });
      return;
    }

    // Verify 7-day period has genuinely expired before removing anyone
    const periodEnd = Number((await getSetting(db, 'period_end')) || 0);
    if (!periodEnd || now < periodEnd) {
      await callTelegram(env, 'answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: '⛔ Cannot remove members before the 7-day period expires.',
        show_alert: true
      });
      return;
    }

    const groupChatId = await getSetting(db, 'group_chat_id');
    const candidates = await getUnverifiedCandidates(db, env, groupChatId);
    await setSetting(db, 'removal_preview_token', '', now);

    let removedCount = 0;
    let skippedCount = 0;

    for (const candidate of candidates) {
      // Final safety re-check right before kicking
      if (
        isAdminUser(env, candidate.telegram_id) ||
        candidate.manually_approved === 1 ||
        !['member', 'restricted'].includes(candidate.status) ||
        (await isUserAlreadyVerified(db, candidate.telegram_id))
      ) {
        skippedCount++;
        continue;
      }

      // Remove from group using banChatMember + unbanChatMember so they can rejoin later if they verify
      const kickRes = await callTelegram(env, 'banChatMember', {
        chat_id: groupChatId,
        user_id: Number(candidate.telegram_id)
      });

      if (kickRes && kickRes.ok) {
        await callTelegram(env, 'unbanChatMember', {
          chat_id: groupChatId,
          user_id: Number(candidate.telegram_id),
          only_if_banned: true
        });
        await db
          .prepare("UPDATE group_members SET status = 'left', last_seen_at = ? WHERE chat_id = ? AND telegram_id = ?")
          .bind(now, groupChatId, candidate.telegram_id)
          .run();
        removedCount++;
      } else {
        skippedCount++;
      }
    }

    await callTelegram(env, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: `✅ Confirmed Removal Complete.\n• Removed unverified members: ${removedCount}\n• Skipped/Protected: ${skippedCount}`
    });
  }
}

export async function handleTelegramUpdate(env, update, now = Date.now()) {
  const db = env.DB;

  // 1. Track chat_member updates in the group (never auto-kick or restrict)
  if (update.chat_member && update.chat_member.chat && update.chat_member.new_chat_member) {
    const chatId = update.chat_member.chat.id;
    const newMember = update.chat_member.new_chat_member;
    await recordGroupMemberActivity(db, chatId, newMember.user, newMember.status || 'member', now);
    return;
  }

  // 2. Handle inline button callbacks
  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query, now);
    return;
  }

  const message = update.message;
  if (!message || !message.from || !message.chat) return;

  const chatType = message.chat.type;
  const chatId = message.chat.id;

  // 3. If message is inside a group/supergroup, passively record member presence
  if (chatType === 'group' || chatType === 'supergroup') {
    if (Array.isArray(message.new_chat_members)) {
      for (const joinedUser of message.new_chat_members) {
        await recordGroupMemberActivity(db, chatId, joinedUser, 'member', now);
      }
    }
    if (message.left_chat_member) {
      await recordGroupMemberActivity(db, chatId, message.left_chat_member, 'left', now);
    }
    await recordGroupMemberActivity(db, chatId, message.from, 'member', now);

    const text = String(message.text || '').trim();
    if (text.startsWith('/verify')) {
      const user = await getOrCreateUser(db, message.from, now);
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        reply_to_message_id: message.message_id,
        text: t(user.language, 'private_only')
      });
      return;
    }

    if (text.startsWith('/register_group') && isAdminUser(env, message.from.id)) {
      const user = await getOrCreateUser(db, message.from, now);
      await handleAdminCommand(env, message, user, '/register_group', '', now);
    }
    return;
  }

  // 4. Private chat handling
  const user = await getOrCreateUser(db, message.from, now);

  // Check if an authorized admin uploaded a CSV document in private chat
  if (message.document && isAdminUser(env, message.from.id)) {
    const caption = String(message.caption || '').trim();
    if (caption.startsWith('/import') || user.state === 'AWAITING_CSV' || String(message.document.file_name || '').endsWith('.csv')) {
      try {
        const csvContent = await downloadTelegramFile(env, message.document.file_id);
        await db.prepare("UPDATE users SET state = 'IDLE', updated_at = ? WHERE telegram_id = ?").bind(now, user.telegram_id).run();
        await handleAdminCsvImport(env, chatId, csvContent, now);
      } catch (err) {
        await callTelegram(env, 'sendMessage', {
          chat_id: chatId,
          text: `⚠️ Failed to import CSV document: ${err.message}`
        });
      }
      return;
    }
  }

  const text = String(message.text || '').trim();
  if (!text) return;

  // Parse command if message starts with '/'
  if (text.startsWith('/')) {
    const spaceIdx = text.indexOf(' ');
    const rawCmd = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
    const command = rawCmd.split('@')[0].toLowerCase();
    const argsText = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

    if (command === '/cancel') {
      await db.prepare("UPDATE users SET state = 'IDLE', updated_at = ? WHERE telegram_id = ?").bind(now, user.telegram_id).run();
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'verification_cancelled')
      });
      return;
    }

    if (command === '/start') {
      await db.prepare("UPDATE users SET state = 'IDLE', updated_at = ? WHERE telegram_id = ?").bind(now, user.telegram_id).run();
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'welcome_select_language'),
        reply_markup: getLanguageKeyboard()
      });
      return;
    }

    if (command === '/language') {
      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'choose_language'),
        reply_markup: getLanguageKeyboard()
      });
      return;
    }

    if (command === '/verify') {
      if (await isUserAlreadyVerified(db, user.telegram_id)) {
        await db.prepare("UPDATE users SET state = 'IDLE', updated_at = ? WHERE telegram_id = ?").bind(now, user.telegram_id).run();
        await callTelegram(env, 'sendMessage', {
          chat_id: chatId,
          text: t(user.language, 'already_verified')
        });
        return;
      }

      if (argsText.length > 0) {
        await handleMatriculeLookup(env, chatId, user, argsText, now);
        return;
      }

      await db
        .prepare("UPDATE users SET state = 'AWAITING_MATRICULE', updated_at = ? WHERE telegram_id = ?")
        .bind(now, user.telegram_id)
        .run();

      await callTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: t(user.language, 'prompt_matricule')
      });
      return;
    }

    // Check admin commands (strictly guarded by numeric Telegram user ID in env.ADMIN_IDS)
    const adminCommands = new Set([
      '/admin',
      '/admin_help',
      '/import',
      '/stats',
      '/unverified',
      '/verified_list',
      '/approve',
      '/start_period',
      '/preview_removals',
      '/set_group',
      '/register_group'
    ]);

    if (adminCommands.has(command)) {
      if (!isAdminUser(env, message.from.id)) {
        await callTelegram(env, 'sendMessage', {
          chat_id: chatId,
          text: '⛔ Unauthorized. Administrator commands require an authorized numeric Telegram user ID.'
        });
        return;
      }
      await handleAdminCommand(env, message, user, command, argsText, now);
      return;
    }

    await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: t(user.language, 'help_student')
    });
    return;
  }

  // Handle stateful plain-text input in private chat
  if (user.state === 'AWAITING_CSV' && isAdminUser(env, message.from.id)) {
    await db.prepare("UPDATE users SET state = 'IDLE', updated_at = ? WHERE telegram_id = ?").bind(now, user.telegram_id).run();
    await handleAdminCsvImport(env, chatId, text, now);
    return;
  }

  if (user.state === 'AWAITING_MATRICULE') {
    await handleMatriculeLookup(env, chatId, user, text, now);
    return;
  }

  // If user sends plain text without a state, show student help
  await callTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: t(user.language, 'help_student')
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('Telegram Student Verification Bot is running on Cloudflare Workers.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      // Verify Telegram secret token header if WEBHOOK_SECRET is configured
      if (env.WEBHOOK_SECRET) {
        const headerSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (headerSecret !== env.WEBHOOK_SECRET) {
          return new Response('Forbidden: Invalid webhook secret token', { status: 403 });
        }
      }

      try {
        const update = await request.json();
        await handleTelegramUpdate(env, update);
        return new Response('OK', { status: 200 });
      } catch (err) {
        return new Response('Internal Error', { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};
