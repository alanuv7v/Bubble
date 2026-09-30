import TEMP from "./TEMP";
import { Bubby, Chat, GeneralRequestTemplate, TextGen, Id, CoreMessage, Prompt, LlmParams, Message, LlmConfig, instantiate } from "./definitions";
import { q } from "./utils/gui";
import t from "./tags";
import * as llm from "./llm";
import { pipe } from "./utils/pipe";
import format_displayed_msg from "./utils/format_displayed_msg";
import { AsEntry, exec_sql } from "./database";
import { merge } from "merge-anything"
import { get_img_src } from "./assets";
import confirm_btn from "./ui_components/confirm_btn";


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

const junction_columns = {
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

const json_columns = {
  bubbies: [],
  messages: ['speaker_ids'],
  chats: ['listener_ids'],
  llm_configs: ['params'],
  textgens: [],
  prompts: ['trigger_words'],
} satisfies Record<TableName, string[]>

// Keep JSON-backed columns as arrays and objects in app code, strings only at SQLite boundaries.
export function parse_entry<K extends TableName>(
  table: K, 
  row: AsEntry<TableEntryMap[K]> | null
): TableEntryMap[K] | null {
  if (row === null) return null
  const entry = { ...row }
  for (const column of json_columns[table]) {
    entry[column] = safe_parse(entry[column])
  }
  return entry as TableEntryMap[K]
}

export function parse_entries<K extends TableName>(
  table: K, 
  rows: AsEntry<TableEntryMap[K]>[]
): TableEntryMap[K][] {
  return rows.map((row) => parse_entry(table, row)!)
}

export function stringify_entry<K extends TableName>(
  table: K, 
  item: Record<string, any>
): Record<string, any> {
  const entry = { ...item }
  for (const column of json_columns[table]) {
    if (entry[column] != null && typeof entry[column] !== 'string') {
      entry[column] = safe_stringify(entry[column])
    }
  }
  return entry
}


/**
 * Recent ones first (descending creation time order) 
*/
export async function get_recent_messages(
  chat_id: Id,
  start: number,
  end: number
) {
  const messages = await (exec_sql(
    `SELECT * FROM messages 
      WHERE chat_id = ? 
      ORDER BY created_at DESC, rowid DESC
      LIMIT ? 
      OFFSET ?`,
    [chat_id, end - start, start]
  )) as unknown as Message[]
  return messages.map((message) => ensure_message_speaker_ids(message as Message)).toReversed()
}

export async function get_messages_before(
  chat_id: Id,
  last_created_at: number,
  limit = 50
) {
  const messages = await exec_sql(
    `SELECT * FROM messages
      WHERE chat_id = ? AND created_at < ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?`,
    [chat_id, last_created_at, limit]
  ) as unknown as Message[]
  return messages.map((message) => ensure_message_speaker_ids(message as Message)).toReversed()
}

async function get_messages_before_message(message: Message, limit = 50) {
  const messages = await exec_sql(
    `SELECT * FROM messages
      WHERE chat_id = ? AND (
        created_at < (SELECT created_at FROM messages WHERE id = ?)
        OR (created_at = (SELECT created_at FROM messages WHERE id = ?)
          AND rowid < (SELECT rowid FROM messages WHERE id = ?))
      )
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?`,
    [message.chat_id, message.id, message.id, message.id, limit]
  ) as unknown as Message[]
  return messages.map((message) => ensure_message_speaker_ids(message as Message)).toReversed()
}

function parse_id_list(value: unknown, fallback_id?: Id): Id[] {
  // Accept stored JSON or runtime arrays, and keep only unique, non-empty IDs.
  let parsed_value: unknown = value
  if (typeof parsed_value === "string") {
    try { parsed_value = JSON.parse(parsed_value) } catch { parsed_value = [] }
  }
  if (!Array.isArray(parsed_value)) parsed_value = []
  const ids = [...new Set((parsed_value as unknown[]).filter((id): id is Id => typeof id === "string" && id.length > 0))]
  if (!ids.length && fallback_id) ids.push(fallback_id)
  return ids
}

function ensure_message_speaker_ids(message: Message): Message {
  // Older messages have one speaker_id instead of a speaker_ids list.
  message.speaker_ids = parse_id_list(message.speaker_ids, message.speaker_id)
  return message
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

export function get_recent_entries<K extends TableName>(table: K, start: number, end: number) {
  return query(
    table,
    `SELECT * FROM ${table} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
    [end - start, start]
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
  need_id: boolean = true,
  behavior = "FAIL" as "FAIL" | "IGNORE" | "REPLACE" 
): Promise<TableEntryMap[K]> {
  const item = { 
    ...data
  } as TableEntryMap[K]
  if (need_id) item["id"] = data.id ?? crypto.randomUUID() 
  const keys = Object.keys(item)
  const columns = keys.join(',')
  const placeholders = keys.map(() => '?').join(',')
  const values = Object.values(stringify_entry(table, item))
  await exec_sql(`INSERT OR ${behavior} INTO ${table} (${columns}) VALUES (${placeholders})`, values)
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
  const sql = `SELECT bubby_id FROM chat_bubbies WHERE chat_id = ? ORDER BY bubby_id;`
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
WHERE cb.chat_id = ?
ORDER BY b.name COLLATE NOCASE, b.id;`
  return (await exec_sql(sql, [chat_id])) as unknown as Bubby[]
}

export async function refresh_chat_bubby_selects(chat: Chat) {
  const bubbies = await get_chat_bubbies(chat.id)
  TEMP.involved_bubby_ids = bubbies.map((bubby) => bubby.id)

  const speaker_select = q("select.persona") as HTMLSelectElement
  speaker_select.replaceChildren(
    speaker_select.firstElementChild!,
    ...bubbies.map((bubby) => t.option(bubby.id))
  )
  speaker_select.value = chat.speaker_id ?? ""
  const listener_picker = q("#chat-listeners") as HTMLElement & { setOptions?: (options: { value: Id, label: string }[], selected: Id[]) => void }
  listener_picker?.setOptions?.(
    bubbies.filter((bubby) => bubby.id !== chat.speaker_id).map((bubby) => ({ value: bubby.id, label: bubby.name || bubby.id })),
    parse_id_list(chat.listener_ids).filter((id) => id !== chat.speaker_id)
  )
  return TEMP.involved_bubby_ids
}

export async function get_bubby_chats(bubby_id: Id) {
  const sql = `SELECT c.*
FROM chats c
INNER JOIN chat_bubbies cb ON c.id = cb.chat_id
WHERE cb.bubby_id = ?;`
  return (await exec_sql(sql, [bubby_id])) as unknown as Id[]
}

export type ChatCastState = {
  speaker_id: Id | null
  listener_ids: Id[]
  bubby_ids: Id[]
}

let chat_cast_write_queue: Promise<unknown> = Promise.resolve()

// Serialize cast changes so membership and selected speakers cannot race each other.
export function update_chat_cast(
  chat_id: Id,
  speaker_id: Id | null | undefined,
  listener_ids: Id[] | undefined,
  requested_bubby_ids: Id[],
  chat_patch?: Partial<Chat>
): Promise<ChatCastState> {
  const write = chat_cast_write_queue.then(async () => {
    const chat = await get_entry("chats", chat_id)
    if (!chat) throw new Error(`Chat ${chat_id} does not exist`)

    const bubby_ids = [...new Set(requested_bubby_ids.filter(Boolean))]
    let next_speaker_id = speaker_id === undefined ? chat.speaker_id : speaker_id || null
    let next_listener_ids = listener_ids === undefined ? parse_id_list(chat.listener_ids) : [...new Set(listener_ids.filter(Boolean))]

    if (next_speaker_id && next_speaker_id === chat.speaker_id && !bubby_ids.includes(next_speaker_id)) {
      next_speaker_id = null
    } else if (next_speaker_id && !bubby_ids.includes(next_speaker_id)) {
      bubby_ids.push(next_speaker_id)
    }
    const next_bubby_ids = [...new Set(bubby_ids)]
    // Explicit listener changes add members; membership edits prune removed listeners.
    if (listener_ids !== undefined) {
      for (const id of next_listener_ids) if (!next_bubby_ids.includes(id)) next_bubby_ids.push(id)
    } else {
      next_listener_ids = next_listener_ids.filter((id) => next_bubby_ids.includes(id))
    }
    next_listener_ids = next_listener_ids.filter((id) => id !== next_speaker_id && next_bubby_ids.includes(id))
    // Commit the junction rows and JSON selection together to keep them in sync.
    await exec_sql("BEGIN TRANSACTION")
    try {
      if (next_bubby_ids.length) {
        const placeholders = next_bubby_ids.map(() => "?").join(",")
        await exec_sql(
          `DELETE FROM chat_bubbies WHERE chat_id = ? AND bubby_id NOT IN (${placeholders})`,
          [chat_id, ...next_bubby_ids]
        )
      } else {
        await exec_sql("DELETE FROM chat_bubbies WHERE chat_id = ?", [chat_id])
      }

      for (const bubby_id of next_bubby_ids) {
        await exec_sql(
          "INSERT OR IGNORE INTO chat_bubbies (chat_id, bubby_id) VALUES (?, ?)",
          [chat_id, bubby_id]
        )
      }
      const chat_fields = { ...chat_patch }
      delete chat_fields.id
      await update_entry("chats", chat_id, {
        ...chat_fields,
        speaker_id: next_speaker_id,
        listener_ids: next_listener_ids
      })
      await exec_sql("COMMIT")

      return {
        speaker_id: next_speaker_id,
        listener_ids: next_listener_ids,
        bubby_ids: next_bubby_ids
      }
    } catch (error) {
      await exec_sql("ROLLBACK").catch(() => {})
      throw error
    }
  })
  chat_cast_write_queue = write.then(() => undefined, () => undefined)
  return write
}

export async function sync_chat_bubbies(chat_id: Id, bubby_ids: Id[]) {
  return update_chat_cast(chat_id, undefined, undefined, bubby_ids)
}

export const sync_chat_libraries = (
  chat_id: string,
  library_ids: string[]
) => {
  return sync_junction_table("chat_libraries", chat_id, library_ids)
}

export const sync_library_prompts = (
  library_id: string,
  prompt_ids: string[]
) => {
  return sync_junction_table("library_prompts", library_id, prompt_ids)
}

export const sync_junction_table = async (
  table: JunctionTableName,
  owner_id: string,
  item_ids: string[]
) => {

  const [owner_column, item_column] = junction_columns[table]

  if (item_ids.length === 0) {
    return await exec_sql(`--sql
DELETE FROM ${table} WHERE ${owner_column} = ?`, [owner_id])
  }

  const item_placeholders = item_ids.map(() => '?').join(',')
  const insert_values = item_ids.map(() => '(?, ?)').join(',')

  const delete_sql = `--sql
BEGIN TRANSACTION;
DELETE FROM ${table} WHERE ${owner_column} = ? AND ${item_column} NOT IN (${item_placeholders});`
  const delete_params = [owner_id, ...item_ids]
  
  const insert_sql = `--sql
INSERT OR IGNORE INTO ${table} (${owner_column}, ${item_column}) VALUES ${insert_values};
COMMIT;`
  const insert_params = item_ids.flatMap((id) => [owner_id, id])

  await exec_sql(delete_sql, delete_params)
  await exec_sql(insert_sql, insert_params)
}

export async function get_junction_entries<K extends JunctionTableName>(
  table: K, lookup_column: keyof JunctionEntryMap[K], ids: Id[]
) {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  //@ts-ignore
  const sql = `SELECT * FROM ${table} WHERE ${lookup_column} IN (${placeholders});`
  return exec_sql(sql, ids)
}

export async function update_entry<K extends TableName>(
  table: K,
  id: Id,
  data: Partial<TableEntryMap[K]>
) {
  const entry = stringify_entry(table, data)
  const columns = Object.keys(entry)
  if (columns.length === 0) return
  const set_clause = columns.map((column) => `${column} = ?`).join(', ')
  const values = [...Object.values(entry), id]

  return exec_sql(`UPDATE ${table} SET ${set_clause} WHERE id = ?`, values)
}

export function text_gen_abort() {
  TEMP.text_gen_aborter.abort();
}



type GenContext = {
  speaker: Bubby,
  listener: Bubby,
  listeners: Bubby[],
  chat: Chat,
}

function is_prompt_triggered(prompt: Prompt, messages: CoreMessage[]) {
  if (!Array.isArray(prompt.trigger_words) || prompt.trigger_words.length === 0) {
    return false
  }
  return prompt.trigger_words.some((trigger) =>
    messages.some((message) => message.content.includes(trigger))
  )
}

function get_path_value(root_value: Record<string, any>, path: string[]) {
  let value = root_value
  for (const key of path) {
    if (value == null) return ""
    value = value[key]
  }
  if (typeof value === "string") return value
  // Template values are text; represent linked objects by their ID instead of JSON.
  if (typeof value === "object" && value !== null) return value.id ?? ""
  return ""
}

function format_listener_property(listeners: Bubby[], property_path: string[]) {
  const listener_values = listeners.map((listener) => ({
    name: listener.name || listener.id,
    value: get_path_value(listener, property_path).trim()
  })).filter((entry) => entry.value.length > 0)

  if (listener_values.length < 2) return listener_values[0]?.value ?? ""

  // In a shared call, {{char.prop}} must describe every listener without blending their traits.
  const has_long_value = listener_values.some((entry) =>
    entry.value.length > 100 || /[\r\n]/.test(entry.value)
  )
  if (!has_long_value) {
    // Short values read naturally as a list: "John and Gerald".
    const values = listener_values.map((entry) => entry.value)
    if (values.length === 2) return `${values[0]} and ${values[1]}`
    return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`
  }

  // Keep long or multiline values separate so each description stays attributable.
  const blocks = listener_values.map((entry) => `${entry.name}:\n${entry.value}`)
  const longest_backtick_run = Math.max(
    0,
    ...blocks.flatMap((block) => block.match(/`+/g) ?? []).map((run) => run.length)
  )
  const fence = "`".repeat(Math.max(3, longest_backtick_run + 1))
  return blocks.map((block) => `${fence}text\n${block}\n${fence}`).join("\n\n")
}

const speaker_label_re = /^\s*\[([^\]\r\n]+)\]\s*:\s*/

/** Read a starting `[name]:` prefix and lowercase its label for comparison. */
function get_leading_speaker_label(content: string) {
  return speaker_label_re.exec(content)?.[1]?.trim().toLocaleLowerCase()
}

const template_replacers: Record<
  string, (path: string[], messages: CoreMessage[]) => Promise<string | undefined>
> = {
  prompts: async (path, messages) => {
    const id = path[1]
    if (!id) return ""
    const prompt = await get_entry("prompts", id)
    if (!prompt) return ""
    return is_prompt_triggered(prompt, messages) ? prompt.content : ""
  },
  libraries: async (_, messages) => {
    const library_rows = await exec_sql<{ library_id: Id }>(
      "SELECT library_id FROM chat_libraries WHERE chat_id = ?",
      [TEMP.chat.id]
    )
    const library_ids = library_rows.map((row) => row.library_id)
    if (library_ids.length === 0) return ""

    const prompt_rows = await get_junction_entries(
      "library_prompts",
      "library_id",
      library_ids
    ) as { prompt_id: Id }[]
    const prompt_ids = prompt_rows.map((row) => row.prompt_id)
    const prompts = (await get_entries("prompts", prompt_ids)) as Prompt[]

    return prompts
      .filter((prompt) => is_prompt_triggered(prompt, messages))
      .map((prompt) => `# ${prompt.id}\n${prompt.content}`)
      .join("\n")
  },
}

async function replace_vars_in_text(
  gen_context: GenContext,
  messages: CoreMessage[],
  text: string
) {
  const matches = [...text.matchAll(/\{\{(.+?)\}\}/g)]
  if (matches.length === 0) return text

  const tags = [...new Set(matches.map((m) => m[1].trim()))]
  const template_context = {
    ...gen_context,
    char: gen_context.listener,
    user: gen_context.speaker,
    listeners: gen_context.listeners,
  }

  const replacements = await Promise.all(
    tags.map(async (tag) => {
      const path = tag.split(".")
      const tag_root = path[0]

      if (template_replacers[tag_root]) {
        try {
          const value = await template_replacers[tag_root](path, messages)
          return [tag, value ?? ""]
        } catch (error) {
          console.log(error)
          return [tag, ""]
        }
      }
      // `char` means all listeners in a shared call; other roots use the primary context.
      if (tag_root === "char" && path.length > 1 && gen_context.listeners.length > 1) {
        return [tag, format_listener_property(gen_context.listeners, path.slice(1))]
      }
      const value = get_path_value(template_context, path)
      return [tag, value]
    })
  )

  let result = text
  for (const [tag, value] of replacements) {
    result = result.replaceAll(`{{${tag}}}`, value)
  }

  return result
}

async function replace_vars_in_messages (
  gen_context: GenContext,
  messages: CoreMessage[],
) {
  for (let message_index = 0; message_index < messages.length; message_index++) {
    messages[message_index].content = await replace_vars_in_text(
      gen_context, messages, messages[message_index].content
    )
  }
  return messages
}

export async function gen_text_req (
  gen_context: GenContext,
  max_input_messages = 50,
  before_message?: Message
) {
  const history = before_message
    ? await get_messages_before_message(before_message, max_input_messages)
    : await get_recent_messages(TEMP.chat.id!, 0, max_input_messages)

  const is_group_chat = (await get_chat_bubby_ids(gen_context.chat.id)).length > 2
  const needs_speaker_labels = is_group_chat || history.some((message) =>
    ensure_message_speaker_ids(message).speaker_ids.length > 1
  )
  const speakers = needs_speaker_labels
    ? await get_entries("bubbies", [...new Set(history.flatMap((message) => ensure_message_speaker_ids(message).speaker_ids))])
    : []
  const speaker_names = new Map<Id, string>(
    speakers.map((speaker): [Id, string] => [speaker.id, speaker.name])
  )
  
  const labeled_history: CoreMessage[] = (await Promise.all(
    history.map(async (message) => {
      let content: string
      if (message.role === "user") {
        content = message.content ?? ""
      } else {
        const gens: TextGen[] = await exec_sql(
          `SELECT * FROM textgens WHERE msg_id = ? ORDER BY created_at, rowid`, [message.id]
        )
        const picked = gens[message.picked]
        content = picked?.content ?? message.content ?? ""
      }

      // Detect "[name]:" at the start
      const speaker_label = get_leading_speaker_label(content)
      
      // Assistant role alone loses who spoke in a group, so label history with its speaker IDs.
      // Group history needs speaker labels, but generated labels should not be doubled.
      const has_speaker_label = message.role === "assistant" && speaker_label !== undefined &&
        ensure_message_speaker_ids(message).speaker_ids.some((id) => [id, speaker_names.get(id)]
          .some((name) => name?.toLocaleLowerCase() === speaker_label))
      if ((is_group_chat || message.speaker_ids.length > 1) && !has_speaker_label) {
        const display_names = message.speaker_ids.map((id) => (speaker_names.get(id) ?? id)
          .replace(/[\r\n\[\]]/g, " "))
        content = `[${display_names.join(" & ")}]: ${content}`
      }
      return {
        role: message.role,
        content
      }
    })
  ))

  const default_llm_params = instantiate(LlmParams) as LlmParams
  const chat_llm_config: Partial<LlmConfig> = TEMP.chat.llm_config_id ?
    (await get_entry("llm_configs", TEMP.chat.llm_config_id)) ?? {}
    : {}
  const first_listener = gen_context.listeners[0] ?? gen_context.listener
  const bubby_llm_config: Partial<LlmConfig> = first_listener.llm_config_id ?
    (await get_entry("llm_configs", first_listener.llm_config_id)) ?? {}
    : {}
  
  // prepare the llm_config
  const merged_config = structuredClone({
    ...default_llm_params,
    ...chat_llm_config.params ?? {},
    ...bubby_llm_config.params ?? {},
  }) as LlmParams

  // remove null, blank out optional params
  for (let key in merged_config) {
    if (merged_config[key] === undefined) delete merged_config[key]
  }

  const api_key = chat_llm_config.api_key ?? bubby_llm_config.api_key
  if (!api_key) {
    throw Error("API key is not configured.")
  }
  
  const api_url = chat_llm_config.api_url ?? 
    bubby_llm_config.api_url ?? 
    "https://openrouter.ai/api/v1/chat/completions"
  
  // A shared call needs each selected listener's identity and a distinct reaction.
  const speaker_label_instruction: CoreMessage = {
    role: "system",
    content: `Label response from each character with that character's name.`
  }
  const request_messages = await replace_vars_in_messages(
    gen_context, [...merged_config.messages, speaker_label_instruction, ...labeled_history]
  );

  return {
    api_key,
    api_url,
    body: {
      ...merged_config,
      messages: request_messages
    } as LlmParams
  }
}


type MessageController = Awaited<ReturnType<typeof message_controller>>
const message_controllers = new Map<Id, MessageController>()
let gen_active = false
let gen_msg_id: Id | null = null

async function delete_message(controller: MessageController) {
  if (controller.delete_btn.disabled || (gen_active && gen_msg_id === controller.message.id)) return

  controller.delete_btn.disabled = true
  try {
    await delete_entry("messages", controller.message.id)
    controller.elem.remove()
    message_controllers.delete(controller.message.id)
  } catch (error) {
    controller.delete_btn.disabled = false
    controller.elem.classList.add("error")
    controller.content_c.append(t.error_c({ innerText: `Delete failed: ${(error as Error).message ?? String(error)}` }))
  }
}

async function message_controller (bubby: Bubby, chat: Chat, message: Message, textgens: TextGen[]) {
  ensure_message_speaker_ids(message)
  const speaker_entries = await get_entries("bubbies", message.speaker_ids)
  const speakers = message.speaker_ids
    .map((id) => speaker_entries.find((speaker) => speaker.id === id))
    .filter((speaker): speaker is Bubby => Boolean(speaker))
  const display_name = message.speaker_ids.map((id) =>
    speakers.find((speaker) => speaker.id === id)?.name ?? id
  ).join(" & ") || bubby.name

  const picked_content = (message.role === "user" && message.content !== null) ?
  message.content
  : textgens[message.picked]?.content ?? message.content ?? ""

  const content_c = t.content_c({
    innerText: picked_content
  })
  const elem = t.message_c(
    t.img({
      className: "profile",
      src: await get_img_src(bubby.id + ".webp", "assets/profile_fallback.webp")
      // src: speaker?.profile_img || ""
    }),
    t.h3({
      className: "name",
      innerText: display_name
    }),
    content_c
  )

  const delete_button = confirm_btn("X", () => void delete_message(controller))
  Object.assign(delete_button, {
    title: "Delete message"
  })
  const gen_label = t.span() as HTMLButtonElement
  const previous_button = t.button({
    type: "button",
    innerText: "<",
    title: "Previous generation"
  }) as HTMLButtonElement
  const next_button = t.button({
    type: "button",
    innerText: ">",
    title: "Next generation"
  }) as HTMLButtonElement

  const gen_controls_c = t.utils_c(delete_button)
  if (message.role === "assistant") {
    gen_controls_c.append(t.group_c(
      previous_button,
      gen_label,
      next_button
    ))
  }
  elem.append(gen_controls_c)

  const controller = {
    bubby,
    speakers: speakers.length ? speakers : [bubby],
    chat,
    message,
    textgens,
    elem,
    content_c,
    delete_btn: delete_button,
    gen_label,
    prev_btn: previous_button,
    next_btn: next_button
  }
  message_controllers.set(message.id, controller)
  refresh_gen_controls(controller)
  previous_button.addEventListener("click", () => void select_gen(controller, -1))
  next_button.addEventListener("click", () => void select_gen(controller, 1))
  return controller
}

function refresh_gen_controls(controller: MessageController) {
  const count = controller.textgens.length
  const picked = Math.max(0, Math.min(controller.message.picked, Math.max(0, count - 1)))
  controller.message.picked = picked
  controller.gen_label.innerText = count ? `${picked + 1} / ${count}` : "1 / 1"
  controller.prev_btn.disabled = gen_active || picked <= 0
  controller.next_btn.disabled = gen_active
  controller.delete_btn.disabled = gen_active && gen_msg_id === controller.message.id
}

async function select_gen(controller: MessageController, direction: -1 | 1) {
  if (gen_active) return
  const next_index = controller.message.picked + direction
  if (next_index < 0) return

  if (next_index < controller.textgens.length) {
    controller.message.picked = next_index
    await update_entry("messages", controller.message.id, { picked: next_index })
    const content = controller.textgens[next_index].content
    controller.message.content = content
    controller.content_c.innerHTML = await format_displayed_msg(content)
    refresh_gen_controls(controller)
    return
  }

  const speaker = await get_entry("bubbies", controller.message.listener_id)
  if (!speaker) return
  await gen_message(speaker, controller, false, true)
}

function safe_stringify(value: Record<string, any>) {
  try {
    return JSON.stringify(value)
  } catch (error) {
    console.log(error)
    return ""
  }
}

function safe_parse(value: string | any) {
  try {
    return JSON.parse(value)
  } catch (error) {
    console.log(error)
    return {}
  }
}

const format_chunk = (text: string) => pipe(text, (chunk) =>
  chunk.replaceAll("\\n", "<br>").replaceAll(`\\"`, `"`)
);

function strip_leading_speaker_label(content: string, speakers: Bubby[]) {
  const match = speaker_label_re.exec(content)
  if (!match) return content

  // Remove a redundant whole-reply prefix before saving; per-character labels carry distinct reactions.
  // In a group reply, labels identify individual reactions. Only remove a
  // redundant label for the whole group; preserve labels for each speaker.
  if (speakers.length > 1) {
    const group_labels = [
      speakers.map((speaker) => speaker.name).join(" & "),
      speakers.map((speaker) => speaker.id).join(" & "),
      speakers.map((speaker) => speaker.name).join(", "),
      speakers.map((speaker) => speaker.id).join(", ")
    ]
    if (!group_labels.includes(match[1].trim())) return content
  }

  return content.slice(match[0].length)
}

export async function stream_gen_text(
  stream: boolean,
  response: Response,
  controller: MessageController,
  initial_text = "",
  persist_message = true
) {
  if (!response.ok) {
    const error_text = await response.text()
    controller.elem.classList.add("error")
    controller.content_c.replaceChildren(
      t.error_c({ innerText: `Error: ${error_text}` })
    );
    throw Error(`Error: ${error_text}`)
  }

  async function format_content (text: string) {
    return await pipe(
      text,
      format_chunk,
      format_displayed_msg,
    );
  }

  if (!stream) {
    const text = strip_leading_speaker_label(
      initial_text + await llm.no_stream_parse(response),
      controller.speakers
    );
    if (persist_message) controller.message.content = text
    controller.content_c.innerHTML = await format_content(text)
    if (persist_message) await update_entry("messages", controller.message.id, { content: text })
    return text;
  }

  let buffer = "";
  let last_saved_at = Date.now()
  await llm.stream_response_body(response.body!, async (response_chunk: any) => {
    const delta = response_chunk.choices[0]?.delta?.content;
    if (!delta) return;

    buffer += await format_chunk(delta);
    const full_text = initial_text + buffer
    if (persist_message) controller.message.content = full_text
    controller.content_c.innerHTML = await format_content(full_text)
    if (persist_message && Date.now() - last_saved_at >= 750) {
      last_saved_at = Date.now()
      await update_entry("messages", controller.message.id, { content: full_text })
    }
  });
  const full_text = strip_leading_speaker_label(initial_text + buffer, controller.speakers)
  controller.content_c.innerHTML = await format_content(full_text)
  if (persist_message) {
    controller.message.content = full_text
    await update_entry("messages", controller.message.id, { content: full_text })
  }
  return full_text;
}

async function gen_message (
  speaker: Bubby,
  controller: MessageController,
  is_resuming = false,
  is_alternative = false
): Promise<TextGen|undefined> {
  if (gen_active) return
  gen_active = true
  gen_msg_id = controller.message.id
  refresh_gen_controls(controller)
  TEMP.text_gen_aborter = new AbortController()
  const initial_text = is_resuming ? controller.message.content ?? "" : ""
  controller.content_c.innerHTML = "";
  controller.elem.classList.remove("error")
  controller.content_c.classList.add("pending");
  controller.elem.scrollIntoView({ behavior: "smooth" });

  let request!: GeneralRequestTemplate
  let text: string

  try {
    request = await gen_text_req({
      speaker: speaker,
      listener: controller.bubby,
      listeners: controller.speakers,
      chat: TEMP.chat as Chat
    }, TEMP.user_config.chat.max_input_messages ?? 50,
    is_alternative ? controller.message : undefined)
    if (!is_resuming && !is_alternative) {
      controller.message.content = ""
      await create_entry("messages", controller.message)
    }
    const response = await llm.GEN_TEXT.OpenRouter(request);
    text = await stream_gen_text(
      Boolean(request.body.stream), response, controller, initial_text, !is_alternative
    );
  } catch (error) {
    const message = TEMP.text_gen_aborter.signal.aborted
      ? "Generation cancelled."
      : `Generation failed: ${(error as Error).message ?? String(error)}`
    if (!is_alternative && controller.message.content !== null) {
      const partial_text = strip_leading_speaker_label(controller.message.content, controller.speakers)
      controller.message.content = partial_text
      await update_entry("messages", controller.message.id, { content: partial_text })
      controller.content_c.innerHTML = await format_displayed_msg(partial_text)
    }
    controller.content_c.append(t.error_c({ innerText: message }))
    controller.elem.classList.add("error")
    return
  } finally {
    controller.content_c.classList.remove("pending");
    gen_active = false
    gen_msg_id = null
    refresh_gen_controls(controller)
  }
  
  if (!is_alternative) await update_entry("messages", controller.message.id, { content: text })

  const llm_gen_entry: TextGen = {
    msg_id: controller.message.id,
    model: request.body.model,
    content: text,
    tokens: 0, // to be implemented later
    cost: 0, // to be implemented later
    created_at: Temporal.Now.instant().epochMilliseconds
  }
  await create_entry("textgens", llm_gen_entry, false)

  controller.textgens = await exec_sql(
    "SELECT * FROM textgens WHERE msg_id = ? ORDER BY created_at, rowid",
    [controller.message.id]
  ) as TextGen[]
  controller.message.picked = is_alternative ? controller.textgens.length - 1 : Math.max(0, controller.textgens.length - 1)
  await update_entry("messages", controller.message.id, {
    picked: controller.message.picked,
    ...(!is_alternative ? { content: text } : {})
  })
  controller.message.content = text
  controller.content_c.innerHTML = await format_displayed_msg(text)
  refresh_gen_controls(controller)

  return llm_gen_entry
}

export async function resume_last_reply() {
  if (gen_active) return false
  if (!TEMP.chat.id) throw Error("Chat ID not specified")
  const [message] = await get_recent_messages(TEMP.chat.id, 0, 1)
  if (!message || message.role !== "assistant" || message.content === null) return false

  const gen_rows = (await exec_sql(
    "SELECT msg_id FROM textgens WHERE msg_id = ?",
    [message.id]
  )).filter((message) => message.role !== "assistant" || message.content.length > 0)
  if (gen_rows.length > 0) return false

  const original_speaker = await get_entry("bubbies", message.listener_id)
  const reply_character = await get_entry("bubbies", ensure_message_speaker_ids(message).speaker_ids[0])
  if (!original_speaker || !reply_character) return false

  const controller = message_controllers.get(message.id) ?? await message_controller(
    reply_character,
    TEMP.chat as Chat,
    message,
    []
  )
  const interactions = q("interactions-c") as HTMLElement
  if (!controller.elem.isConnected) interactions.append(controller.elem)
  await gen_message(original_speaker, controller, true)
  return true
}

export async function send() {
  if (gen_active) return
  if (!TEMP.chat.id) throw Error("Chat ID not specified");

  // GET DOM
  const prompt_c = q("prompt-c")! as HTMLDivElement;
  const interaction_list = q("interactions-c")!;

  // GET CHAT AND CHARACTERS
  const speaker_id = TEMP.chat.speaker_id;

  if (!speaker_id) {
    throw Error(`Speaker is not specified`);
  }
  const listener_ids = parse_id_list(TEMP.chat.listener_ids).filter((id) => id !== speaker_id)
  const listener_rows = await get_entries("bubbies", listener_ids)
  const listeners = listener_ids.map((id) => listener_rows.find((bubby) => bubby.id === id)).filter((bubby): bubby is Bubby => !!bubby)
  if (!listeners.length) throw Error("Add at least one Bubby besides the speaker to this chat.")

  // Empty prompts request an assistant continuation without adding a user turn.
  const prompt = prompt_c.innerText as string;
  const has_prompt = prompt.trim().length > 0
  const first_listener_id = listener_ids[0]
  const saved_user_msg: Message | null = has_prompt ? {
    role: "user",
    content: prompt,
    chat_id: TEMP.chat.id!,
    id: crypto.randomUUID(),
    speaker_id,
    speaker_ids: [speaker_id],
    listener_id: first_listener_id,
    created_at: Temporal.Now.instant().epochMilliseconds,
    picked: 0,
  } : null

  const saved_llm_msg: Message = {
    role: "assistant",
    content: null,
    chat_id: TEMP.chat.id!,
    id: crypto.randomUUID(),
    speaker_id: first_listener_id,
    speaker_ids: listener_ids,
    listener_id: speaker_id,
    created_at: Temporal.Now.instant().epochMilliseconds,
    picked: 0,
  }

  const speaker = await get_entry("bubbies", speaker_id)
  if (!speaker) throw Error(`Speaker with ID ${speaker_id} does not exist`)
  
  if (saved_user_msg) await create_entry("messages", saved_user_msg)

  prompt_c.innerHTML = ""; // Clean the input elem

  
  const chat = TEMP.chat as Chat

  const assistant_message_controller = await message_controller(listeners[0], chat, saved_llm_msg, [])

  // Append the user turn only when the prompt contains text.
  if (saved_user_msg) {
    const user_message_controller = await message_controller(speaker, chat, saved_user_msg, [])
    interaction_list.append(user_message_controller.elem)
  }
  interaction_list.append(assistant_message_controller.elem);

  // ACTUALLY GENERATE THE TEXT
  try {
    await gen_message(speaker, assistant_message_controller) as TextGen
    assistant_message_controller.elem.scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.log(error)
  }
}

export async function load_chat(chat: Chat) {
  
  TEMP.chat = merge(TEMP.chat, chat)
  const cast = await sync_chat_bubbies(chat.id, await get_chat_bubby_ids(chat.id))
  Object.assign(TEMP.chat, { speaker_id: cast.speaker_id, listener_ids: cast.listener_ids })
  /* 
    OPEN CHAT
  */
  const interaction_c = q("interactions-c")! as HTMLDivElement
  await refresh_chat_bubby_selects(TEMP.chat as Chat)

  /* SHOW MESSAGES */
  const history = await get_recent_messages(chat.id, 0, 20)
  const chat_speaker = TEMP.chat.speaker_id ? await get_entry("bubbies", TEMP.chat.speaker_id) : null
  const chat_listener = TEMP.chat.listener_ids![0] ? await get_entry("bubbies", TEMP.chat.listener_ids![0]) : null

  // Repair messages saved with the visible dropdown placeholder labels as IDs.
  if (chat_speaker && chat_listener) {
    for (const message of history) {
      const has_placeholder_id = [message.speaker_id, message.listener_id]
        .some((id) => id === "Speaker" || id === "Listener")
      if (!has_placeholder_id) continue
      const speaker_id = message.role === "user" ? TEMP.chat.speaker_id! : chat_listener.id
      const listener_id = message.role === "user" ? chat_listener.id : TEMP.chat.speaker_id!
      await update_entry("messages", message.id, { speaker_id, speaker_ids: [speaker_id], listener_id })
      message.speaker_id = speaker_id
      message.speaker_ids = [speaker_id]
      message.listener_id = listener_id
    }
  }

  const message_elements: HTMLElement[] = []

  for (const message of history) {
    const speaker = await get_entry("bubbies", message.speaker_id)
    if (!speaker) {
      console.log(`Speaker of ID ${message.speaker_id} does not exist!`)
      const err = t.message_c(
        { className: "error" },
        t.img({
          className: "profile",
          src: "assets/profile_fallback.webp"
        }),
        t.content_c({
          innerText: `<Speaker of ID ${message.speaker_id} does not exist!>`
        })
      )
      message_elements.push(err)
      continue
    }
    const textgens = message.role === "assistant" ? 
    (await exec_sql(`SELECT * FROM textgens WHERE msg_id = ? ORDER BY created_at, rowid`, [message.id])) as TextGen[] 
    : []
    const msg_c = await message_controller(speaker, chat, message, textgens)
    message_elements.push(msg_c.elem)
  }
  interaction_c.replaceChildren(...message_elements)
  const last_message_element = message_elements.at(-1)
  if (last_message_element) last_message_element.scrollIntoView({ behavior: "smooth" });
}
