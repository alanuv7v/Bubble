import { BindingSpec } from "@sqlite.org/sqlite-wasm"
import TEMP from "./TEMP"
import { pipe } from "./utils/pipe"
import yaml from "yaml"
import user_config from "./user_config"
import { merge } from "merge-anything"
import Neutralino from "@neutralinojs/lib"
import { data_path, native_batch, native_sql, start_native_db } from "./native_db"
import { report } from "./log"

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

export const init_sql = create_tables_sql


export async function init() {
  if (TEMP.backbone === "Neutralino") {
    await start_native_db(() => {
      closing = true
      TEMP.text_gen_aborter.abort()
      return db_queue
    })
  } else {
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
      report(e.message, "Database worker crashed")
      for (const req of TEMP.db_pending!.values()) {
        req.reject(new Error(e.message || 'Database worker crashed'))
      }
      TEMP.db_pending!.clear()
    }
  }

  if (TEMP.backbone === "Neutralino") await native_batch(init_sql)
  else await exec_sql(init_sql)

  let saved = ""
  if (TEMP.backbone === "Neutralino") {
    const path = data_path() + "/user_config.yaml"
    try {
      await Neutralino.filesystem.getStats(path)
      saved = await Neutralino.filesystem.readFile(path)
    } catch (error) {
      // A new installation has no config file yet.
      if ((error as any).code !== "NE_FS_NOPATHE") throw error
    }
  } else {
    // OPFS
    TEMP.opfs_root_handle = await navigator.storage.getDirectory()
    TEMP.user_config_handle = await TEMP.opfs_root_handle.getFileHandle("user_config.yaml", { create: true })
    TEMP.assets_dir_handle = await TEMP.opfs_root_handle.getDirectoryHandle("assets", { create: true })
    saved = await pipe(await TEMP.user_config_handle.getFile(), (f: File) => f.text())
  }
  const conf = yaml.parse(saved) as typeof user_config

  TEMP.user_config = merge(user_config, conf ?? {}) as typeof user_config

  return
}


export type AsEntry<T> = {
  [K in keyof T]: NonNullable<T[K]> extends object ? string : T[K]
}

let db_queue: Promise<unknown> = Promise.resolve()
let closing = false

// A transaction owns the connection until it commits or rolls back.
function queue_db<T>(action: () => Promise<T>): Promise<T> {
  if (closing) return Promise.reject(new Error("Database is closing"))
  const result = db_queue.then(action)
  // Keep the queue usable; the caller still receives the original rejection.
  db_queue = result.catch(() => {})
  return result
}

export function exec_sql<T = any>(...args: Parameters<typeof direct_sql>): Promise<AsEntry<T>[]> {
  return queue_db(() => direct_sql<T>(...args))
}

export function transaction<T>(action: (sql: typeof direct_sql) => Promise<T>): Promise<T> {
  return queue_db(async () => {
    await direct_sql("BEGIN TRANSACTION")
    try {
      const result = await action(direct_sql)
      await direct_sql("COMMIT")
      return result
    } catch (error) {
      await direct_sql("ROLLBACK").catch((error) => { report(error, "Rollback failed") })
      throw error
    }
  })
}

function direct_sql<T = any>(
  command_sql: string, 
  bind: BindingSpec = [], 
  rowMode = "object", 
  returnValue = "resultRows"
): Promise<AsEntry<T>[]> {

  if (TEMP.backbone === "Neutralino") {
    return native_sql(command_sql, bind as unknown[], rowMode) as Promise<AsEntry<T>[]>
  }

  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    TEMP.db_pending!.set(id, { resolve, reject })
    TEMP.worker!.postMessage({ id, sql: command_sql, bind, rowMode, returnValue })
  })
  
}

export async function save_user_config() {
  const text = yaml.stringify(TEMP.user_config)
  if (TEMP.backbone === "Neutralino") {
    await Neutralino.filesystem.writeFile(data_path() + "/user_config.yaml", text)
    return
  }
  const writer = await TEMP.user_config_handle!.createWritable()
  await writer.write(text)
  await writer.close()
}

export async function nuke_db() {
  if (TEMP.backbone === "Neutralino") {
    await exec_sql("PRAGMA foreign_keys = OFF")
    try {
      const tables = await exec_sql<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      for (const table of tables) await exec_sql(`DROP TABLE "${table.name.replaceAll('"', '""')}"`)
      await exec_sql("PRAGMA user_version = 0")
    } finally {
      await exec_sql("PRAGMA foreign_keys = ON")
    }
    return
  }
  let res
  // check
  try {
    await TEMP.opfs_root_handle!.removeEntry("bubble_db", { recursive: true })
    localStorage.setItem("v", "0")
    res = await TEMP.opfs_root_handle!.getDirectoryHandle("bubble_db")
  }
  catch (e) {
    if ((e as any)?.name === "NotFoundError") console.info("Nuked!")
    else report(e, "Delete database")
    return
  }
  console.info("Nuke failed.", res)
  return
}


export async function nuke_opfs() {
  try {
    for await (const entry of TEMP.opfs_root_handle!.entries()) {
      await TEMP.opfs_root_handle!.removeEntry(entry[0], { recursive: true })
    }
  }
  catch (e) {
    report(e, "Delete OPFS files")
    return
  }
  console.info("Nuked!")
}
