import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import pg from "pg";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const { Pool } = pg;

// Use SQLite for local development if no DATABASE_URL is set
const USE_SQLITE = !process.env.DATABASE_URL || process.env.USE_SQLITE === "true";

let db: any;
let pool: pg.Pool | null = null;

if (USE_SQLITE) {
  // Create local SQLite database
  const dbDir = path.join(process.cwd(), ".data");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, "local.db");
  const sqlite = new Database(dbPath);

  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled Recording',
      duration INTEGER NOT NULL DEFAULT 0,
      page_url TEXT,
      page_title TEXT,
      network_logs_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      console_count INTEGER NOT NULL DEFAULT 0,
      click_count INTEGER NOT NULL DEFAULT 0,
      video_object_path TEXT,
      share_token TEXT UNIQUE,
      tags TEXT NOT NULL DEFAULT '[]',
      events TEXT NOT NULL DEFAULT '[]',
      browser_info TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS snapcap_users (
      id TEXT PRIMARY KEY,
      api_key TEXT UNIQUE,
      api_key_preview TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Insert a default demo user with API key if not exists
  const demoApiKey = "sc_demo_key_12345678901234567890";
  sqlite.exec(`
    INSERT OR IGNORE INTO snapcap_users (id, api_key, api_key_preview)
    VALUES ('demo_user_001', '${demoApiKey}', 'sc_••••••••••••••••5678');
  `);

  db = drizzleSqlite(sqlite);
  console.log("[db] Using SQLite database at", dbPath);
  console.log("[db] Demo API key for Mohammad Makhamreh (mo@menatal.com):", demoApiKey);
} else {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzlePg(pool, { schema });
  console.log("[db] Using PostgreSQL database");
}

export { db, pool };
export * from "./schema";
