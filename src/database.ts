import { BindingSpec } from "@sqlite.org/sqlite-wasm"
import TEMP from "./TEMP"
import { pipe } from "./utils/pipe"
import yaml from "yaml"
import user_config from "./user_config"
import { merge } from "merge-anything"

const create_tables_sql = `--sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS llm_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT DEFAULT NULL,
  api_url TEXT DEFAULT NULL,
  params TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS bubbies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  desc TEXT NOT NULL DEFAULT '',
  first_message TEXT DEFAULT NULL,
  --memory_ids TEXT NOT NULL DEFAULT '[]',
  --chat_ids TEXT NOT NULL DEFAULT '[]',
  llm_config_id TEXT DEFAULT NULL,
  FOREIGN KEY(llm_config_id) REFERENCES llm_configs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE DEFAULT 'New Chat',
  --bubby_ids TEXT NOT NULL DEFAULT '[]',
  --library_ids TEXT NOT NULL DEFAULT '[]',
  speaker_id TEXT DEFAULT NULL,
  listener_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  last_use_at INTEGER DEFAULT NULL,
  llm_config_id TEXT DEFAULT NULL,
  FOREIGN KEY(speaker_id) REFERENCES bubbies(id) ON DELETE SET NULL,
  FOREIGN KEY(llm_config_id) REFERENCES llm_configs(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_name ON chats(name);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT DEFAULT NULL,
  chat_id TEXT NOT NULL,
  speaker_id TEXT NOT NULL,
  speaker_ids TEXT NOT NULL DEFAULT '[]',
  listener_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  picked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS textgens (
  msg_id TEXT NOT NULL,
  content TEXT DEFAULT NULL,
  model TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0.0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(msg_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_when ON messages(chat_id, created_at ASC);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  trigger_words TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS chat_bubbies (
  chat_id TEXT NOT NULL,
  bubby_id TEXT NOT NULL,
  PRIMARY KEY (chat_id, bubby_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (bubby_id) REFERENCES bubbies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_bubbies ON chat_bubbies(bubby_id);
CREATE INDEX IF NOT EXISTS idx_bubby_chats ON chat_bubbies(bubby_id, chat_id);

INSERT OR IGNORE INTO chat_bubbies (chat_id, bubby_id)
  SELECT id, speaker_id FROM chats WHERE speaker_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS chat_libraries (
  chat_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  PRIMARY KEY (chat_id, library_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_libraries ON chat_libraries(library_id);
CREATE INDEX IF NOT EXISTS idx_library_chats ON chat_libraries(library_id, chat_id);

CREATE TABLE IF NOT EXISTS library_prompts (
  library_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  PRIMARY KEY (library_id, prompt_id),
  FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE,
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_library_prompt ON library_prompts(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_libraries ON library_prompts(prompt_id, library_id);
`

// Nah I'm just using junction tables...
export const init_sql = create_tables_sql // + create_triggers_sql


export async function init() {
  TEMP.worker = new Worker(
    new URL('./worker.ts', import.meta.url),
    { type: 'module' }
  )

  TEMP.worker.onmessage = (e) => {
    const { id, res, err } = e.data
    const req = TEMP.db_pending!.get(id)
    if (!req) return
    TEMP.db_pending!.delete(id)
    err ? req.reject(new Error(err)) : req.resolve(res)
  }

  TEMP.worker.onerror = (e) => {
    console.log('Worker crash:', e.message)
    for (const req of TEMP.db_pending!.values()) {
      req.reject(new Error(e.message || 'Database worker crashed'))
    }
    TEMP.db_pending!.clear()
  }

  await exec_sql(init_sql)

  // Add JSON-backed group cast columns to databases created by older versions.
  const ensure_column = async (table: string, column: string, definition: string) => {
    const columns = await exec_sql<{ name: string }>(`PRAGMA table_info(${table})`)
    if (!columns.some((entry) => entry.name === column)) {
      await exec_sql(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }
  await ensure_column("chats", "listener_ids", "TEXT NOT NULL DEFAULT '[]'")
  await ensure_column("messages", "speaker_ids", "TEXT NOT NULL DEFAULT '[]'")

  const chat_columns = await exec_sql<{ name: string }>("PRAGMA table_info(chats)")
  const has_legacy_listener_id = chat_columns.some((entry) => entry.name === "listener_id")
  // Fold the old single listener into the JSON list before removing that column.
  const chats_to_migrate = await exec_sql<{ id: string, listener_id: string | null, listener_ids: string }>(
    `SELECT id, ${has_legacy_listener_id ? "listener_id" : "NULL AS listener_id"}, listener_ids FROM chats`
  )
  for (const chat of chats_to_migrate) {
    let listener_ids: string[] = []
    try { listener_ids = JSON.parse(chat.listener_ids || "[]") } catch { listener_ids = [] }
    if (!listener_ids.length && chat.listener_id) listener_ids = [chat.listener_id]
    listener_ids = [...new Set(listener_ids.filter((id) => typeof id === "string" && id.length > 0))]
    if (chat.listener_id && !listener_ids.includes(chat.listener_id)) listener_ids.push(chat.listener_id)
    await exec_sql("UPDATE chats SET listener_ids = ? WHERE id = ?", [JSON.stringify(listener_ids), chat.id])
    for (const bubby_id of listener_ids) {
      await exec_sql("INSERT OR IGNORE INTO chat_bubbies (chat_id, bubby_id) SELECT ?, id FROM bubbies WHERE id = ?", [chat.id, bubby_id])
    }
  }
  if (has_legacy_listener_id) {
    // SQLite cannot drop this referenced column directly; rebuild chats while preserving its rows.
    await exec_sql("PRAGMA foreign_keys = OFF")
    await exec_sql("BEGIN TRANSACTION")
    try {
      await exec_sql(`CREATE TABLE chats_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE DEFAULT 'New Chat',
        speaker_id TEXT DEFAULT NULL,
        listener_ids TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        last_use_at INTEGER DEFAULT NULL,
        llm_config_id TEXT DEFAULT NULL,
        FOREIGN KEY(speaker_id) REFERENCES bubbies(id) ON DELETE SET NULL,
        FOREIGN KEY(llm_config_id) REFERENCES llm_configs(id) ON DELETE SET NULL
      )`)
      await exec_sql(`INSERT INTO chats_new (id, name, speaker_id, listener_ids, created_at, last_use_at, llm_config_id)
        SELECT id, name, speaker_id, listener_ids, created_at, last_use_at, llm_config_id FROM chats`)
      await exec_sql("DROP TABLE chats")
      await exec_sql("ALTER TABLE chats_new RENAME TO chats")
      await exec_sql("CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_name ON chats(name)")
      await exec_sql("COMMIT")
    } catch (e) {
      await exec_sql("ROLLBACK").catch(() => {})
      throw e
    } finally {
      await exec_sql("PRAGMA foreign_keys = ON")
    }
  }
  const messages_to_migrate = await exec_sql<{ id: string, speaker_id: string, speaker_ids: string }>(
    "SELECT id, speaker_id, speaker_ids FROM messages WHERE speaker_id IS NOT NULL AND speaker_ids = '[]'"
  )
  for (const message of messages_to_migrate) {
    await exec_sql("UPDATE messages SET speaker_ids = ? WHERE id = ?", [JSON.stringify([message.speaker_id]), message.id])
  }

  TEMP.opfs_root_handle = await navigator.storage.getDirectory()
  TEMP.user_config_handle = await TEMP.opfs_root_handle.getFileHandle("user_config.yaml", { create: true })
  TEMP.assets_dir_handle = await TEMP.opfs_root_handle.getDirectoryHandle("assets", { create: true })

  const conf = await pipe(
    await TEMP.user_config_handle.getFile(),
    (f: File) => f.text(),
    yaml.parse
  ) as typeof user_config

  TEMP.user_config = merge(user_config, conf ?? {}) as typeof user_config

  return
}


export type AsEntry<T> = {
  [K in keyof T]: NonNullable<T[K]> extends object ? string : T[K]
}

export function exec_sql<T = any>(command_sql: string, bind: BindingSpec = [], rowMode = "object", returnValue = "resultRows"): Promise<AsEntry<T>[]> {

  if (!TEMP.worker) init()

  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    TEMP.db_pending!.set(id, { resolve, reject })
    TEMP.worker!.postMessage({ id, sql: command_sql, bind, rowMode, returnValue })
  })
  
}

export async function nuke_db() {
  let res
  // check
  try {
    await TEMP.opfs_root_handle!.removeEntry("bubble_db", { recursive: true })
    localStorage.setItem("v", "0")
    res = await TEMP.opfs_root_handle!.getDirectoryHandle("bubble_db")
  }
  catch (e) {
    console.info("Nuked!", e, res)
    return
  }
  console.info("Nuke failed.", res)
  return
}
