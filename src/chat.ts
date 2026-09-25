import STATES from "./STATES";
import TEMP from "./TEMP";
import { Bubby, Chat, GeneralRequestTemplate, TextGen as TextGen, Id, SentMessage, Prompt, LlmParams, Message, LlmConfig, instantiate } from "./definitions";
import { q } from "./utils/gui";
import tags from "./tags";
import * as llm from "./llm";
import { pipe } from "./utils/pipe";
import format_displayed_msg from "./utils/format_displayed_msg";
import { AsEntry, exec_sql } from "./database";
import { merge } from "merge-anything"
import obj_path from "./utils/obj_path";


export type TableEntryMap = {
  bubbies: Bubby
  messages: Message
  textgens: TextGen
  chats: Chat
  llm_configs: LlmConfig
  prompts: Prompt
} 

export type TableName = keyof TableEntryMap

type JunctionEntryMap = {
  chat_bubbies: { chat_id: Id, bubby_id: Id }
  chat_libraries: { chat_id: Id, library_id: Id }
  library_prompts: { library_id: Id, prompt_id: Id }
}

const JunctionColumns = {
  chat_bubbies: ["chat_id", "bubby_id"],
  chat_libraries: ["chat_id", "library_id"],
  library_prompts: ["library_id", "prompt_id"],
} as const


type JunctionTableName = keyof JunctionEntryMap

export type Entry = TableEntryMap[TableName]

export async function query<K extends TableName>(
  type: K, 
  sql: string, 
  bind: any[] = []
): Promise<TableEntryMap[K][]> {
  const rows = await exec_sql<TableEntryMap[K]>(sql, bind)
  return parse_entries(type, rows)
}

const json_keys = {
  bubbies: [],
  messages: [],
  chats: [],
  llm_configs: ['params'],
  textgens: [],
  prompts: [],
} satisfies Record<TableName, string[]>

export function parse_entry<K extends TableName>(
  table: K, 
  row: AsEntry<TableEntryMap[K]> | null
): TableEntryMap[K] | null {
  if (row === null) return null
  const res = { ...row }
  const keys = json_keys[table]
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    res[k] = safe_parse(res[k])
  }
  return res as TableEntryMap[K]
}

export function parse_entries<K extends TableName>(
  table: K, 
  rows: AsEntry<TableEntryMap[K]>[]
): TableEntryMap[K][] {
  return rows.map((r) => parse_entry(table, r)!)
}

export function stringify_entry<K extends TableName>(
  table: K, 
  item: Record<string, any>
): Record<string, any> {
  const res = { ...item }
  const keys = json_keys[table]
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (res[k] != null && typeof res[k] !== 'string') {
      res[k] = safe_stringify(res[k])
    }
  }
  return res
}


export function get_recent_chats(start: number, end: number) {
  return query(
    "chats",
    `SELECT * FROM chats ORDER BY rowid DESC LIMIT ? OFFSET ?`,
    [end - start, start]
  )
}
/**
 * Recent ones first (descending creation time order) 
*/
export async function get_recent_messages(
  chat_id: Id,
  start: number,
  end: number
) {
  return query(
    "messages",
    `SELECT * FROM messages 
      WHERE chat_id = ? 
      ORDER BY created_at 
      DESC LIMIT ? 
      OFFSET ?`,
    [chat_id, end - start, start]
  )
}

export function get_messages_before(
  chat_id: Id,
  last_created_at: number,
  limit = 50
) {
  return query(
    "messages",
    `SELECT * FROM messages
      WHERE chat_id = ? AND created_at < ?
      ORDER BY created_at 
      DESC LIMIT ?`,
    [chat_id, last_created_at, limit]
  )
}

export function get_bubbies(start: number, end: number) {
  return query(
    "bubbies",
    `SELECT * FROM bubbies ORDER BY rowid DESC LIMIT ? OFFSET ?`,
    [end - start, start]
  )
}

export async function get_entry<K extends TableName>(table: K, id: Id) {
  if (!id) return null
  const rows = await query(
    table,
    `SELECT * FROM ${table} WHERE id = ? LIMIT 1`,
    [id]
  )
  return rows[0] ?? null
}

export function get_entries<K extends TableName>(table: K, ids: Id[]) {
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  return query(
    table,
    `SELECT * FROM ${table} WHERE id IN (${placeholders})`,
    ids
  )
}

export function delete_entry<K extends TableName>(
  table: K,
  id: Id
) {
  return exec_sql(`DELETE FROM ${table} WHERE id = ?`, [id])
}

export type NewEntry<T> = Omit<T, 'id'> & { id?: Id }

export async function create_entry<K extends TableName>(
  table: K,
  data: NewEntry<TableEntryMap[K]>,
  need_id: boolean = true
): Promise<TableEntryMap[K]> {
  const item = { 
    ...data
  } as TableEntryMap[K]
  if (need_id) item["id"] = data.id ?? crypto.randomUUID() 
  const keys = Object.keys(item)
  const columns = keys.join(',')
  const placeholders = keys.map(() => '?').join(',')
  const values = Object.values(stringify_entry(table, item))
  await exec_sql(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`, values)
  return item
}

export async function create_entries<K extends TableName>(
  table: K,
  items: NewEntry<TableEntryMap[K]>[]
) {
  if (!items.length) return []
  await exec_sql('BEGIN TRANSACTION', [])
  const created = await Promise.all(items.map((item) => create_entry(table, item)))
  await exec_sql('COMMIT', [])
  return created
}

export async function get_chat_bubby_ids(chat_id: Id) {
  const sql = `SELECT bubby_id FROM chat_bubbies WHERE chat_id = ?;`
  return (await exec_sql(sql, [chat_id], "array")).flat() as unknown as Id[]
}

export async function get_bubby_chat_ids(bubby_id: Id) {
  const sql = `SELECT chat_id FROM chat_bubbies WHERE bubby_id = ?;`
  return (await exec_sql(sql, [bubby_id], "array")).flat() as unknown as Id[]
}

export async function get_chat_bubbies(chat_id: Id) {
  const sql = `SELECT b.*
FROM bubbies b
INNER JOIN chat_bubbies cb ON b.id = cb.bubby_id
WHERE cb.chat_id = ?;`
  return (await exec_sql(sql, [chat_id])) as unknown as Bubby[]
}

export async function get_bubby_chats(bubby_id: Id) {
  const sql = `SELECT c.*
FROM chats c
INNER JOIN chat_bubbies cb ON c.id = cb.chat_id
WHERE cb.bubby_id = ?;`
  return (await exec_sql(sql, [bubby_id])) as unknown as Id[]
}

export const sync_chat_bubbies = async (
  chat_id: string,
  bubby_ids: string[]
) => {
  return await sync_junction_table("chat_bubbies", chat_id, bubby_ids)
}

export const sync_chat_libraries = async (
  chat_id: string,
  library_ids: string[]
) => {
  return await sync_junction_table("chat_libraries", chat_id, library_ids)
}

export const sync_library_prompts = async (
  library_id: string,
  prompt_ids: string[]
) => {
  return await sync_junction_table("library_prompts", library_id, prompt_ids)
}

export const sync_junction_table = async (
  table: JunctionTableName,
  owner_id: string,
  item_ids: string[]
) => {

  const [column_a, column_b] = JunctionColumns[table]

  if (item_ids.length === 0) {
    return await exec_sql(`--sql
DELETE FROM ${table} WHERE ${column_a} = ?`, [owner_id])
  }
  
  const delete_placeholders = item_ids.map(() => '?').join(',')
  const insert_values = item_ids.map(() => '(?, ?)').join(',')

  const delete_sql = `--sql
BEGIN TRANSACTION;
DELETE FROM ${table} WHERE ${column_a} = ? AND ${column_b} NOT IN (${delete_placeholders});`
  const delete_params = [owner_id, ...item_ids]
  
  const insert_sql = `--sql
INSERT OR IGNORE INTO ${table} (${column_a}, ${column_b}) VALUES ${insert_values};
COMMIT;`
  const insert_params = item_ids.flatMap((id) => [owner_id, id])

  await exec_sql(delete_sql, delete_params)
  await exec_sql(insert_sql, insert_params)
}

export async function get_junction_entries<K extends JunctionTableName>(
  table: K, lookup_col: keyof JunctionEntryMap[K], ids: Id[]
) {
  const placeholders = ids.map(() => '?').join(',')
  //@ts-ignore
  const sql = `SELECT * FROM ${table} WHERE ${lookup_col} IN (${placeholders});`
  return (await exec_sql(sql, ids))
}

/* 
Using json_whatever funcs in SQLite instead


type EntryUpdateHandlers = {
  [K in TableName]?: (TableEntryMap[K])[]
}
const sync_add = async (
  obj: Entry, 
  added_id: string, 
  target_table: TableName, 
  target_prop: string
) => {
  const target = await get_entry(target_table, added_id)
  if (!target) return
  return await update_entry(
    target_table, added_id, { [target_prop]: [...target[target_prop], obj.id] }
  )
}

const sync_rm = async (
  obj: Entry, 
  added_id: string, 
  target_table: TableName, 
  target_prop: string
) => {
  const target = await get_entry(target_table, added_id)
  if (!target) return
  const og_target_prop = target[target_prop] as string[]
  const idx = og_target_prop.findIndex(s => s === obj.id)
  if (idx < 0) {
    // obj.id did not exist in target prop
    return false
  }
  return await update_entry(
    target_table, added_id, { [target_prop]: og_target_prop.toSpliced(idx, 1) }
  )
} */

export async function update_entry<K extends TableName>(
  table: K,
  id: Id,
  data: Partial<TableEntryMap[K]>
) {
  const entry_obj = stringify_entry(table, data)
  const keys = Object.keys(entry_obj)
  const columns_str = keys.map((k) => `${k} = ?`).join(', ')
  const values = [...Object.values(entry_obj), id]

  return await exec_sql(`UPDATE ${table} SET ${columns_str} WHERE id = ?`, values)
}

export function text_gen_abort() {
  TEMP.text_gen_aborter.abort();
}








type TextGenContext = {
  speaker: Bubby,
  listener: Bubby,
  chat: Chat,
}

const keywords_replacers = {
  prompts: async (path: string[]) => {
    const id = path[1]
    const res = await get_entry("prompts", id)
    if (!res) return ""
    return res?.content
  },
  libraries: async (path: string[], history: SentMessage[]) => {
    const lib_ids = await exec_sql(
      "SELECT * FROM chat_libraries WHERE chat_id = ?", 
      [TEMP.chat.id]
    ) as unknown as string[]
    if (lib_ids.length === 0) return ""

    const prompt_ids = await get_junction_entries("library_prompts", "library_id", lib_ids) as unknown as string[]
    
    const prompts = (await get_entries("prompts", prompt_ids)) as Prompt[]
    
    const content = prompts
      .filter(p => {
        if (p.trigger.length === 0) return true
        // trigger detection from the history
        let triggered = p.trigger.find(t =>
          history.map(h => h.content).join("").match(t)
        )
        if (triggered) return true
        return false
      })
      .map(p => `# ${p.id}` + "\n" + p.content)
      .join("\n")

    return content
  }
}

async function replace_content_variables(
  ctx: TextGenContext,
  whole: string,
  loop = 100
) {

  const keywords = [
    ...Object.keys(ctx),
    ...Object.keys(keywords_replacers)
  ]

  while (loop > 0) {
    for await (let keyword of keywords) {
      const path = keyword.split(".")
      let replacer_text = obj_path.get(ctx, path) 
        ?? await keywords_replacers[keyword] 
        ?? ""
      whole = whole.replace(keyword, replacer_text)
      loop = loop - 1
    }
  }
  return [whole, loop] as [string, number]
}

async function replace_all_content_variables (
  ctx: TextGenContext,
  history: SentMessage[],
  config_msgs: SentMessage[],
) {
  let remaining_loops = 100
  // handle variables in the req.body.messages
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    const [content, less_loops] = await replace_content_variables(
      ctx, m.content, remaining_loops
    )
    remaining_loops = less_loops
    history[i].content = content
  }
  return history
}


export async function gen_text (
  ctx: TextGenContext,
  max_input_messages?: number
) {
  if (!STATES.api_key) throw Error("API key is not configured.")
  max_input_messages = STATES.chat["max_input_messages"] || 50
  
  let raw_history = (await get_recent_messages(TEMP.chat.id!, 0, max_input_messages))
  .toReversed(); // Chronological order

  const core_history: SentMessage[] = await Promise.all(
    raw_history.map(async h => {
      if (h.role === "user") {
        return {
          role: h.role,
          content: h.content!
        }
      }
      const gens: TextGen[] = await exec_sql("SELECT * FROM textgens WHERE msg_id = ?", [h.id])
      const picked = gens[h.picked]
      return {
        role: h.role,
        content: picked.content
      }
    })
  )

  const default_llm_config = instantiate(LlmParams) as LlmParams
  const chat_llm_config = TEMP.chat.llm_config_id ?
    (await get_entry("llm_configs", TEMP.chat.llm_config_id))?.params || {}
    : {}
  const bubby_llm_config = ctx.listener.llm_config_id ?
    (await get_entry("llm_configs", ctx.listener.llm_config_id))?.params || {}
    : {}
  
  // prepare the llm_config
  const merged = structuredClone({
    ...default_llm_config,
    ...chat_llm_config,
    ...bubby_llm_config,
  }) as LlmParams

  merged.messages = await replace_all_content_variables(
    ctx, core_history, merged.messages
  );

  return {
    api_key: STATES.api_key!,
    api_url: "https://openrouter.ai/api/v1/chat/completions",
    body: merged
  }
}


type MessageController = Awaited<ReturnType<typeof message_controller>>

async function message_controller (bubby: Bubby, chat: Chat, message: Message, textgens: TextGen[]) {

  const picked_content = (message.role === "user" && message.content !== null) ?
  message.content
  : textgens[message.picked]?.content ?? ""

  const content_c = tags.content_c({
    innerText: picked_content
  })
  const elem = tags.message_c(
    tags.img({
      className: "profile",
      // src: speaker?.profile_img || ""
    }),
    content_c
  )

  return {
    bubby,
    chat,
    message,
    textgens,
    elem,
    content_c
  }
}

function safe_stringify (str: Record<string, any>) {
  try {
    return JSON.stringify(str)
  } catch (e) {
    console.error(e)
    return {}
  }
}

function safe_parse (str: string|any) {
  try {
    return JSON.parse(str)
  } catch (e) {
    console.error(e)
    return {}
  }
}

const format_chunk = (str: string) => pipe(str, (s) =>
  s.replaceAll("\\n", "<br>").replaceAll(`\\"`, `"`)
);

export async function stream_and_show_text_gen(
  stream: boolean,
  response: Response,
  ctrl: MessageController
) {
  if (!response.ok) {
    console.log(response);
    ctrl.content_c.replaceChildren(
      tags.error_c(`Error: ${await response.text()}`)
    );
  }

  async function format_content (text: string) {
    return await pipe(
      text,
      format_chunk,
      format_displayed_msg,
    );
  }

  if (!stream) {
    const text = await llm.no_stream_parse(response);
    ctrl.content_c.innerHTML = await format_content(text)
    return text;
  }

  let buffer = "";
  await llm.stream_response_body(response.body!, async (res: any) => {
    const delta = res.choices[0]?.delta?.content;
    if (!delta) return;

    buffer += await format_chunk(delta);
    ctrl.content_c.innerHTML = await format_content(buffer)
    ctrl.elem.scrollIntoView({ behavior: "smooth" });
  });
  return buffer;
}

async function llm_message_gen (
  speaker: Bubby,
  ctrl: MessageController
): Promise<TextGen|undefined> {
  
  ctrl.content_c.innerHTML = "";
  ctrl.content_c.classList.add("pending");
  ctrl.elem.scrollIntoView({ behavior: "smooth" });

  const req = await gen_text({
    speaker: speaker,
    listener: ctrl.bubby,
    chat: TEMP.chat as Chat
  })

  let text: string

  try {
    const res = await llm.GEN_TEXT.OpenRouter(req);
    text = await stream_and_show_text_gen(Boolean(req.body.stream), res, ctrl);
  } catch (e) {
    ctrl.content_c.classList.remove("pending");
    return
  } finally {
    ctrl.content_c.classList.remove("pending");
  }

  
  // Save the generated text
  const to_add: Message = {
    ...ctrl.message,
    content: text,
    picked: 0,
  }
  exec_sql
  create_entry("messages", to_add)

  const g: TextGen = {
    msg_id: ctrl.message.id,
    model: req.body.model,
    content: text,
    tokens: 0, // to be implemented later
    cost: 0, // to be implemented later
    created_at: Temporal.Now.instant().epochMilliseconds
  }
  return g
}

export async function send() {
  if (!TEMP.chat.id) throw Error("Chat ID not specified");

  // GET DOM
  const prompt_c = q("prompt-c")! as HTMLDivElement;
  const msg_list = q("interactions-c")!;

  // GET CHAT AND CHARACTERS
  const listener_id = TEMP.chat.listener_id;
  const speaker_id = TEMP.chat.speaker_id;

  if (!listener_id) {
    throw Error(`Listner is not specified`);
  }
  if (!speaker_id) {
    throw Error(`Speaker is not specified`);
  }

  // Make user msg
  const prompt = prompt_c.innerText as string;
  const user_msg: SentMessage = {
    role: "user",
    content: prompt,
  };

  const saved_user_msg: Message = {
    ...user_msg,
    chat_id: TEMP.chat.id!,
    id: crypto.randomUUID(),
    speaker_id,
    listener_id,
    created_at: Temporal.Now.instant().epochMilliseconds,
    picked: 0,
  }

  const saved_llm_msg: Message = {
    role: "assistant",
    content: null,
    chat_id: TEMP.chat.id!,
    id: crypto.randomUUID(),
    speaker_id: listener_id,
    listener_id: speaker_id,
    created_at: Temporal.Now.instant().epochMilliseconds,
    picked: 0,
  }
  
  // Save new user msg
  create_entry("messages", saved_user_msg)

  prompt_c.innerHTML = ""; // Clean the input elem

  
  const speaker = await get_entry("bubbies", speaker_id)
  const listner = await get_entry("bubbies", listener_id)
  const chat = TEMP.chat as Chat

  if (!speaker) throw Error(`Speaker is missing`) 
  if (!listner) throw Error(`Lister is missing`)

  const user_msg_ctrl = await message_controller(speaker, chat, saved_user_msg, [])
  const llm_msg_ctrl = await message_controller(listner, chat, saved_llm_msg, [])

  // append user message elem & placeholder for char reply
  msg_list.append(user_msg_ctrl.elem);
  msg_list.append(llm_msg_ctrl.elem);

  // ACTUALLY GENERATE THE TEXT
  try {
    const llm_generation = await llm_message_gen(speaker, llm_msg_ctrl) as TextGen
    llm_msg_ctrl.elem.scrollIntoView({ behavior: "smooth" });
    create_entry("textgens", llm_generation, false)
  } catch (e) {
    console.error(e)
  }
}

export async function load_chat(chat: Chat) {
  
  TEMP.chat = merge(TEMP.chat, chat)
  /* 
    OPEN CHAT
  */
  const interaction_c = q("interactions-c")! as HTMLDivElement
  const bubbies = await get_chat_bubbies(chat.id)
  TEMP.involved_bubby_ids = bubbies.map(c => c.id)
  /* SEND CONFIG UI < ADD PERSONA & TARGET CHAR OPTIONS */

  const p = q("select.persona") as HTMLSelectElement;
  const t = q("select.target_char") as HTMLSelectElement;

  p.replaceChildren(
    p.firstElementChild!,
    ...bubbies.map((char) => tags.option(char.id))
  );
  t.replaceChildren(
    t.firstElementChild!,
    ...bubbies.map((char) => tags.option(char.id))
  );

  /* SHOW MESSAGES */
  const history = await get_recent_messages(chat.id, 0, 20)

  const c: HTMLElement[] = []

  for (let i = 0; i < history.length; i++) {
    const message = history[i] as Message
    const speaker = await get_entry("bubbies", message.speaker_id)
    if (!speaker) {
      console.error(`Speaker of ID ${message.speaker_id} does not exist!`)
      return
    }
    const textgens = message.role === "assistant" ? 
    (await exec_sql(`SELECT * FROM textgens WHERE msg_id = ?`, message.id)) as TextGen[] 
    : []
    const msg_c = await message_controller(speaker, chat, message, textgens)
    c.push(msg_c.elem)
  }
  interaction_c.replaceChildren(...c)
  let last = c.at(-1)
  if (last) last.scrollIntoView({ behavior: "smooth" });
}