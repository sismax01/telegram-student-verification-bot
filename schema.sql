-- Telegram Student Verification Bot - D1 Database Schema
-- Enforces strict 1-to-1 binding between student ID (matricule) and Telegram user ID.

PRAGMA foreign_keys = ON;

-- 1. Official student roster imported from CSV
CREATE TABLE IF NOT EXISTS students (
    matricule TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    section TEXT DEFAULT 'General',
    claimed_by_telegram_id TEXT UNIQUE, -- Ensures ONE student ID per Telegram account & ONE account per student ID
    claimed_at INTEGER
);

-- 2. Telegram users who interacted with the bot in private chat
CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    language TEXT NOT NULL DEFAULT 'fr', -- 'en', 'fr', or 'ar'
    state TEXT NOT NULL DEFAULT 'IDLE',  -- 'IDLE', 'AWAITING_MATRICULE', 'AWAITING_CSV'
    verified_matricule TEXT UNIQUE,      -- Redundant 1-to-1 UNIQUE constraint for extra safety
    updated_at INTEGER NOT NULL
);

-- 3. Temporary confirmation tokens when a student enters a valid available student ID
CREATE TABLE IF NOT EXISTS pending_confirmations (
    token TEXT PRIMARY KEY,
    telegram_id TEXT NOT NULL,
    matricule TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

-- 4. Known group members tracked by the bot (joins, messages, or admin updates)
CREATE TABLE IF NOT EXISTS group_members (
    chat_id TEXT NOT NULL,
    telegram_id TEXT NOT NULL,
    username TEXT,
    full_name TEXT,
    status TEXT NOT NULL DEFAULT 'unknown', -- 'member', 'restricted', 'administrator', 'creator', 'left', 'kicked', 'unknown'
    manually_approved INTEGER NOT NULL DEFAULT 0, -- 1 if manually approved by an admin
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, telegram_id)
);

-- 5. Bot settings (stores active group chat ID, 7-day verification period, and preview state)
CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
