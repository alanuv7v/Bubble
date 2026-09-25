import { BindingSpec } from "@sqlite.org/sqlite-wasm"
import TEMP from "./TEMP"

const create_tables_sql = `--sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS llm_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS bubbies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  desc TEXT NOT NULL DEFAULT '',
  first_message TEXT NOT NULL DEFAULT '',
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
  listener_id TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL,
  last_use_at INTEGER DEFAULT NULL,
  llm_config_id TEXT DEFAULT NULL,
  FOREIGN KEY(speaker_id) REFERENCES bubbies(id) ON DELETE SET NULL
  FOREIGN KEY(listener_id) REFERENCES bubbies(id) ON DELETE SET NULL
  FOREIGN KEY(llm_config_id) REFERENCES llm_configs(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_name ON chats(name);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT DEFAULT NULL,
  chat_id TEXT NOT NULL,
  speaker_id TEXT NOT NULL,
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
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_libraries ON chat_libraries(library_id);
CREATE INDEX IF NOT EXISTS idx_library_chats ON chat_libraries(library_id, chat_id);

CREATE TABLE IF NOT EXISTS library_prompts (
  library_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  PRIMARY KEY (library_id, prompt_id),
  FOREIGN KEY (prompt_id) REFERENCES s(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_library_prompt ON library_prompts(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_libraries ON library_prompts(prompt_id, library_id);
`

/* 
type SyncRelation = [table_a: string, col_a: string, table_b: string, col_b: string]
type RefRelation = [owner_table: string, owner_col: string, ref_table: string]

const gen_ref_trigger = ([owner_table, owner_col, ref_table]: RefRelation): string => {
  const name = `trigger_cleanup_${ref_table}_del_${owner_table}_${owner_col}`

  return `--sql
CREATE TRIGGER IF NOT EXISTS ${name}
AFTER DELETE ON ${ref_table}
BEGIN
  UPDATE ${owner_table}
  SET ${owner_col} = coalesce(
    (
      SELECT json_group_array(value)
      FROM json_each(${owner_table}.${owner_col})
      WHERE value != OLD.id
    ),
    '[]'
  )
  WHERE ${owner_col} LIKE '%' || OLD.id || '%';
END;`.trim()
}

const gen_sync_trigger = (
  a_table: string,
  a_col: string,
  b_table: string,
  b_col: string
): string => {
  const name = `trigger_sync_${a_table}_${a_col}_to_${b_table}_${b_col}`

  return `--sql
CREATE TRIGGER IF NOT EXISTS ${name}
AFTER UPDATE OF ${a_col} ON ${a_table}
WHEN (OLD.${a_col} IS NOT NEW.${a_col})
BEGIN
  UPDATE ${b_table}
  SET ${b_col} = coalesce(
    (
      SELECT json_group_array(value)
      FROM json_each(${b_table}.${b_col})
      WHERE value != OLD.id
    ),
    '[]'
  )
  WHERE id IN (
    SELECT value FROM json_each(OLD.${a_col})
    WHERE value NOT IN (SELECT value FROM json_each(NEW.${a_col}))
  );

  UPDATE ${b_table}
  SET ${b_col} = json_insert(${b_col}, '$[#]', NEW.id)
  WHERE id IN (
    SELECT value FROM json_each(NEW.${a_col})
    WHERE value NOT IN (SELECT value FROM json_each(OLD.${a_col}))
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(${b_table}.${b_col}) WHERE value = NEW.id
  );
END;`.trim()
}

const gen_dual_triggers = ([table_a, col_a, table_b, col_b]: SyncRelation): string => {
  const ref_a = gen_ref_trigger([table_b, col_b, table_a])
  const ref_b = gen_ref_trigger([table_a, col_a, table_b])
  const sync_a = gen_sync_trigger(table_a, col_a, table_b, col_b)
  const sync_b = gen_sync_trigger(table_b, col_b, table_a, col_a)

  return [ref_a, ref_b, sync_a, sync_b].join('\n\n')
}

const gen_schema_triggers = (one_way_rels: RefRelation[], dual_rels: SyncRelation[]): string => {
  const one_way_sql = one_way_rels.map(gen_ref_trigger).join('\n\n')
  const dual_sql = dual_rels.map(gen_dual_triggers).join('\n\n')

  return `${one_way_sql}\n\n${dual_sql}`
}

const ref_rels: RefRelation[] = [
  ['bubbies', 'memory_ids', 'memories'],
  ['chats', 'library_ids', 'libraries'],
  ['libraries', 'book_ids', 'books'],
]

const sync_rels: SyncRelation[] = [
  ['chats', 'bubby_ids', 'bubbies', 'chat_ids']
]

const create_triggers_sql = gen_schema_triggers(ref_rels, sync_rels)
 */



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
    console.log("result:\n", res, err)

    TEMP.db_pending!.delete(id)
    err ? req.reject(new Error(err)) : req.resolve(res)
  }

  TEMP.worker.onerror = (e) => {
    console.error('Worker crash:', e.message)
  }

  await exec_sql(init_sql)

  return
}


export type AsEntry<T> = {
  [K in keyof T]: NonNullable<T[K]> extends object ? string : T[K]
}

export function exec_sql<T = any>(command_sql: string, bind: BindingSpec = [], rowMode = "object", returnValue = "resultRows"): Promise<AsEntry<T>[]> {

  console.log("command:\n", command_sql)
  console.log("bindings:\n", bind)

  if (!TEMP.worker) init()

  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    TEMP.db_pending!.set(id, { resolve, reject })
    TEMP.worker!.postMessage({ id, sql: command_sql, bind, rowMode, returnValue })
  })
  
}

export async function nuke_db() {
  const opfs_root = await navigator.storage.getDirectory()
  await opfs_root.removeEntry("bubble_db", { recursive: true })
  
  let res
  // check
  try {
    res = await opfs_root.getDirectoryHandle("bubble_db")
  }
  catch (e) {
    console.info("Nuked!", e, res)
    return
  }
  console.info("Nuke failed.", res)
  return
}