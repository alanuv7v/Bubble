import TEMP from "./TEMP";
import { Bubby, Chat, GeneralRequestTemplate, TextGen as TextGen, Id, CoreMessage as CoreMessage, Prompt, LlmParams, Message, LlmConfig, instantiate } from "./definitions";
import { q } from "./utils/gui";
import t from "./tags";
import * as llm from "./llm";
import { pipe } from "./utils/pipe";
import format_displayed_msg from "./utils/format_displayed_msg";
import { AsEntry, exec_sql } from "./database";
import { merge } from "merge-anything"
import obj_path from "./utils/obj_path";
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
  prompts: ['trigger_words'],
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


/**
 * Recent ones first (descending creation time order) 
*/
export async function get_recent_messages(
  chat_id: Id,
  start: number,
  end: number
) {
  const res = await (exec_sql(
    `SELECT * FROM messages 
      WHERE chat_id = ? 
      ORDER BY created_at DESC, rowid DESC
      LIMIT ? 
      OFFSET ?`,
    [chat_id, end - start, start]
  )) as unknown as Message[]
  return res.toReversed()
}

export async function get_messages_before(
  chat_id: Id,
  last_created_at: number,
  limit = 50
) {
  const res = await exec_sql(
    `SELECT * FROM messages
      WHERE chat_id = ? AND created_at < ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?`,
    [chat_id, last_created_at, limit]
  ) as unknown as Message[]
  return res.toReversed()
}

async function get_messages_before_message(message: Message, limit = 50) {
  const res = await exec_sql(
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
  return res.toReversed()
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

export function get_entries<K extends TableName>(table: K, ids: Id[], ) {
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

export async function refresh_chat_bubby_selects(chat: Chat) {
  const bubbies = await get_chat_bubbies(chat.id)
  TEMP.involved_bubby_ids = bubbies.map((bubby) => bubby.id)

  const speaker_select = q("select.persona") as HTMLSelectElement
  const listener_select = q("select.target_char") as HTMLSelectElement
  speaker_select.replaceChildren(
    speaker_select.firstElementChild!,
    ...bubbies.map((bubby) => t.option(bubby.id))
  )
  listener_select.replaceChildren(
    listener_select.firstElementChild!,
    ...bubbies.map((bubby) => t.option(bubby.id))
  )
  speaker_select.value = chat.speaker_id ?? ""
  listener_select.value = chat.listener_id ?? ""
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
  listener_id: Id | null
  bubby_ids: Id[]
}

let chat_cast_write_queue: Promise<unknown> = Promise.resolve()

export function update_chat_cast(
  chat_id: Id,
  speaker_id: Id | null | undefined,
  listener_id: Id | null | undefined,
  req_bubby_ids: Id[],
  chat_patch?: Partial<Chat>
): Promise<ChatCastState> {
  const write = chat_cast_write_queue.then(async () => {
    const chat = await get_entry("chats", chat_id)
    if (!chat) throw new Error(`Chat ${chat_id} does not exist`)

    const bubby_ids = [...new Set(req_bubby_ids.filter(Boolean))]
    let next_speaker_id = speaker_id === undefined ? chat.speaker_id : speaker_id || null
    let next_listener_id = listener_id === undefined ? chat.listener_id : listener_id || null

    if (next_speaker_id && next_speaker_id === chat.speaker_id && !bubby_ids.includes(next_speaker_id)) {
      next_speaker_id = null
    } else if (next_speaker_id && !bubby_ids.includes(next_speaker_id)) {
      bubby_ids.push(next_speaker_id)
    }
    if (next_listener_id && next_listener_id === chat.listener_id && !bubby_ids.includes(next_listener_id)) {
      next_listener_id = null
    } else if (next_listener_id && !bubby_ids.includes(next_listener_id)) {
      bubby_ids.push(next_listener_id)
    }

    const normalized_bubby_ids = [...new Set(bubby_ids)]
    await exec_sql("BEGIN TRANSACTION")
    try {
      if (normalized_bubby_ids.length) {
        const placeholders = normalized_bubby_ids.map(() => "?").join(",")
        await exec_sql(
          `DELETE FROM chat_bubbies WHERE chat_id = ? AND bubby_id NOT IN (${placeholders})`,
          [chat_id, ...normalized_bubby_ids]
        )
      } else {
        await exec_sql("DELETE FROM chat_bubbies WHERE chat_id = ?", [chat_id])
      }

      for (const bubby_id of normalized_bubby_ids) {
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
        listener_id: next_listener_id
      })
      await exec_sql("COMMIT")

      return {
        speaker_id: next_speaker_id,
        listener_id: next_listener_id,
        bubby_ids: normalized_bubby_ids
      }
    } catch (e) {
      await exec_sql("ROLLBACK").catch(() => {})
      throw e
    }
  })
  chat_cast_write_queue = write.then(() => undefined, () => undefined)
  return write
}

export async function sync_chat_bubbies(chat_id: Id, bubby_ids: Id[]) {
  return update_chat_cast(chat_id, undefined, undefined, bubby_ids)
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
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  //@ts-ignore
  const sql = `SELECT * FROM ${table} WHERE ${lookup_col} IN (${placeholders});`
  return (await exec_sql(sql, ids))
}

export async function update_entry<K extends TableName>(
  table: K,
  id: Id,
  data: Partial<TableEntryMap[K]>
) {
  const entry_obj = stringify_entry(table, data)
  const keys = Object.keys(entry_obj)
  if (keys.length === 0) return
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

function is_prompt_triggered(prompt: Prompt, msgs: CoreMessage[]) {
  if (!Array.isArray(prompt.trigger_words) || prompt.trigger_words.length === 0) {
    return false
  }
  return prompt.trigger_words.some((trigger) =>
    msgs.some((m) => m.content.includes(trigger))
  )
}

function resolve_ctx_path(obj: Record<string, any>, path: string[]) {
  let curr = obj
  for (const key of path) {
    if (curr == null) return ""
    curr = curr[key]
  }
  if (typeof curr === "string") return curr
  if (typeof curr === "object" && curr !== null) return curr.id ?? ""
  return ""
}

const keywords_replacers: Record<
  string, (path: string[], msgs: CoreMessage[]) => Promise<string | undefined>
> = {
  prompts: async (path, msgs) => {
    const id = path[1]
    if (!id) return ""
    const prompt = await get_entry("prompts", id)
    if (!prompt) return ""
    return is_prompt_triggered(prompt, msgs) ? prompt.content : ""
  },
  libraries: async (_, msgs) => {
    const lib_rows = await exec_sql<{ library_id: Id }>(
      "SELECT library_id FROM chat_libraries WHERE chat_id = ?",
      [TEMP.chat.id]
    )
    const lib_ids = lib_rows.map((row) => row.library_id)
    if (lib_ids.length === 0) return ""

    const prompt_rows = await get_junction_entries(
      "library_prompts",
      "library_id",
      lib_ids
    ) as { prompt_id: Id }[]
    const prompt_ids = prompt_rows.map((row) => row.prompt_id)
    const prompts = (await get_entries("prompts", prompt_ids)) as Prompt[]

    return prompts
      .filter((p) => is_prompt_triggered(p, msgs))
      .map((p) => `# ${p.id}\n${p.content}`)
      .join("\n")
  },
}

async function replace_vars_from_text(
  ctx: TextGenContext,
  msgs: CoreMessage[],
  text: string
) {
  const matches = [...text.matchAll(/\{\{(.+?)\}\}/g)]
  if (matches.length === 0) return text

  const tags = [...new Set(matches.map((m) => m[1].trim()))]
  const ctx_alias = {
    ...ctx,
    char: ctx.listener,
    user: ctx.speaker,
  }

  const resolved = await Promise.all(
    tags.map(async (tag) => {
      const path = tag.split(".")
      const root = path[0]

      if (keywords_replacers[root]) {
        try {
          const val = await keywords_replacers[root](path, msgs)
          return [tag, val ?? ""]
        } catch (e) {
          console.log(e)
          return [tag, ""]
        }
      }
      const val = resolve_ctx_path(ctx_alias, path)
      return [tag, val]
    })
  )

  let result = text
  for (const [tag, val] of resolved) {
    result = result.replaceAll(`{{${tag}}}`, val)
  }

  return result
}

async function replace_all_content_variables (
  ctx: TextGenContext,
  all_msgs: CoreMessage[],
) {
  for (let i = 0; i < all_msgs.length; i++) {
    all_msgs[i].content = await replace_vars_from_text(
      ctx, all_msgs, all_msgs[i].content
    )
  }
  return all_msgs
}

export async function gen_text_req (
  ctx: TextGenContext,
  max_input_messages = 50,
  before_message?: Message
) {
  const raw_history = before_message
    ? await get_messages_before_message(before_message, max_input_messages)
    : await get_recent_messages(TEMP.chat.id!, 0, max_input_messages)
  
  const core_history: CoreMessage[] = (await Promise.all(
    raw_history.map(async h => {
      if (h.role === "user") {
        return {
          role: h.role,
          content: h.content!
        }
      }
      const gens: TextGen[] = await exec_sql(
        `SELECT * FROM textgens WHERE msg_id = ? ORDER BY created_at, rowid`, [h.id]
      )
      const picked = gens[h.picked]
      return {
        role: h.role,
        content: picked?.content ?? h.content ?? ""
      }
    })
  ))

  const default_llm_params = instantiate(LlmParams) as LlmParams
  const chat_llm_config: Partial<LlmConfig> = TEMP.chat.llm_config_id ?
    (await get_entry("llm_configs", TEMP.chat.llm_config_id)) ?? {}
    : {}
  const bubby_llm_config: Partial<LlmConfig> = ctx.listener.llm_config_id ?
    (await get_entry("llm_configs", ctx.listener.llm_config_id)) ?? {}
    : {}
  
  // prepare the llm_config
  const merged_config = structuredClone({
    ...default_llm_params,
    ...chat_llm_config.params ?? {},
    ...bubby_llm_config.params ?? {},
  }) as LlmParams
  
  const api_key = chat_llm_config.api_key ?? bubby_llm_config.api_key
  if (!api_key) {
    throw Error("API key is not configured.")
  }
  
  const api_url = chat_llm_config.api_url ?? 
    bubby_llm_config.api_url ?? 
    "https://openrouter.ai/api/v1/chat/completions"
  
  const all_msgs = await replace_all_content_variables(
    ctx, [...merged_config.messages, ...core_history]
  );

  return {
    api_key,
    api_url,
    body: {
      ...merged_config,
      messages: all_msgs
    } as LlmParams
  }
}


type MessageController = Awaited<ReturnType<typeof message_controller>>
const message_controllers = new Map<Id, MessageController>()
let generation_active = false
let generating_message_id: Id | null = null

async function delete_message(ctrl: MessageController) {
  if (ctrl.delete_btn.disabled || (generation_active && generating_message_id === ctrl.message.id)) return

  ctrl.delete_btn.disabled = true
  try {
    await delete_entry("messages", ctrl.message.id)
    ctrl.elem.remove()
    message_controllers.delete(ctrl.message.id)
  } catch (e) {
    ctrl.delete_btn.disabled = false
    ctrl.elem.classList.add("error")
    ctrl.content_c.append(t.error_c({ innerText: `Delete failed: ${(e as Error).message ?? String(e)}` }))
  }
}

async function message_controller (bubby: Bubby, chat: Chat, message: Message, textgens: TextGen[]) {

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
    content_c
  )

  const delete_button = confirm_btn("X", () => void delete_message(controller))
  Object.assign(delete_button, {
    className: "delete-message",
    title: "Delete message"
  })
  delete_button.setAttribute("aria-label", "Delete message")
  const generation_label = t.span({ className: "generation-index" }) as HTMLButtonElement
  const previous_button = t.button({
    type: "button",
    className: "previous-generation",
    innerText: "<",
    title: "Previous generation"
  }) as HTMLButtonElement
  const next_button = t.button({
    type: "button",
    className: "next-generation",
    innerText: ">",
    title: "Next generation"
  }) as HTMLButtonElement

  const generations_c = t.utils_c(delete_button)
  if (message.role === "assistant") {
    generations_c.append(t.group_c(
      previous_button,
      generation_label,
      next_button
    ))
  }
  elem.append(generations_c)

  const controller = {
    bubby,
    chat,
    message,
    textgens,
    elem,
    content_c,
    delete_btn: delete_button,
    textgen_label: generation_label,
    prev_btn: previous_button,
    next_btn: next_button
  }
  message_controllers.set(message.id, controller)
  refresh_textgen_ctrls(controller)
  previous_button.addEventListener("click", () => void select_generation(controller, -1))
  next_button.addEventListener("click", () => void select_generation(controller, 1))
  return controller
}

function refresh_textgen_ctrls(ctrl: MessageController) {
  const count = ctrl.textgens.length
  const picked = Math.max(0, Math.min(ctrl.message.picked, Math.max(0, count - 1)))
  ctrl.message.picked = picked
  ctrl.textgen_label.innerText = count ? `${picked + 1} / ${count}` : "1 / 1"
  ctrl.prev_btn.disabled = generation_active || picked <= 0
  ctrl.next_btn.disabled = generation_active
  ctrl.delete_btn.disabled = generation_active && generating_message_id === ctrl.message.id
}

async function select_generation(ctrl: MessageController, direction: -1 | 1) {
  if (generation_active) return
  const next_index = ctrl.message.picked + direction
  if (next_index < 0) return

  if (next_index < ctrl.textgens.length) {
    ctrl.message.picked = next_index
    await update_entry("messages", ctrl.message.id, { picked: next_index })
    const content = ctrl.textgens[next_index].content
    ctrl.message.content = content
    ctrl.content_c.innerHTML = await format_displayed_msg(content)
    refresh_textgen_ctrls(ctrl)
    return
  }

  const speaker = await get_entry("bubbies", ctrl.message.listener_id)
  if (!speaker) return
  await gen_message(speaker, ctrl, false, true)
}

function safe_stringify (str: Record<string, any>) {
  try {
    return JSON.stringify(str)
  } catch (e) {
    console.log(e)
    return ""
  }
}

function safe_parse (str: string|any) {
  try {
    return JSON.parse(str)
  } catch (e) {
    console.log(e)
    return {}
  }
}

const format_chunk = (str: string) => pipe(str, (s) =>
  s.replaceAll("\\n", "<br>").replaceAll(`\\"`, `"`)
);

export async function stream_and_show_text_gen(
  stream: boolean,
  response: Response,
  ctrl: MessageController,
  initial_text = "",
  persist_message = true
) {
  if (!response.ok) {
    const error_text = await response.text()
    ctrl.elem.classList.add("error")
    ctrl.content_c.replaceChildren(
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
    const text = initial_text + await llm.no_stream_parse(response);
    if (persist_message) ctrl.message.content = text
    ctrl.content_c.innerHTML = await format_content(text)
    if (persist_message) await update_entry("messages", ctrl.message.id, { content: text })
    return text;
  }

  let buffer = "";
  let last_saved_at = Date.now()
  await llm.stream_response_body(response.body!, async (res: any) => {
    const delta = res.choices[0]?.delta?.content;
    if (!delta) return;

    buffer += await format_chunk(delta);
    const full_text = initial_text + buffer
    if (persist_message) ctrl.message.content = full_text
    ctrl.content_c.innerHTML = await format_content(full_text)
    if (persist_message && Date.now() - last_saved_at >= 750) {
      last_saved_at = Date.now()
      await update_entry("messages", ctrl.message.id, { content: full_text })
    }
  });
  const full_text = initial_text + buffer
  if (persist_message) {
    ctrl.message.content = full_text
    await update_entry("messages", ctrl.message.id, { content: full_text })
  }
  return full_text;
}

async function gen_message (
  speaker: Bubby,
  ctrl: MessageController,
  resume = false,
  alternative = false
): Promise<TextGen|undefined> {
  if (generation_active) return
  generation_active = true
  generating_message_id = ctrl.message.id
  refresh_textgen_ctrls(ctrl)
  TEMP.text_gen_aborter = new AbortController()
  const initial_text = resume ? ctrl.message.content ?? "" : ""
  ctrl.content_c.innerHTML = "";
  ctrl.elem.classList.remove("error")
  ctrl.content_c.classList.add("pending");
  ctrl.elem.scrollIntoView({ behavior: "smooth" });

  let req!: GeneralRequestTemplate
  let text: string

  try {
    req = await gen_text_req({
      speaker: speaker,
      listener: ctrl.bubby,
      chat: TEMP.chat as Chat
    }, TEMP.user_config.chat.max_input_messages ?? 50,
    alternative ? ctrl.message : undefined)
    if (!resume && !alternative) {
      ctrl.message.content = ""
      await create_entry("messages", ctrl.message)
    }
    const res = await llm.GEN_TEXT.OpenRouter(req);
    text = await stream_and_show_text_gen(
      Boolean(req.body.stream), res, ctrl, initial_text, !alternative
    );
  } catch (e) {
    const message = TEMP.text_gen_aborter.signal.aborted
      ? "Generation cancelled."
      : `Generation failed: ${(e as Error).message ?? String(e)}`
    if (!alternative && ctrl.message.content !== null) {
      await update_entry("messages", ctrl.message.id, { content: ctrl.message.content })
    }
    ctrl.content_c.append(t.error_c({ innerText: message }))
    ctrl.elem.classList.add("error")
    return
  } finally {
    ctrl.content_c.classList.remove("pending");
    generation_active = false
    generating_message_id = null
    refresh_textgen_ctrls(ctrl)
  }
  
  if (!alternative) await update_entry("messages", ctrl.message.id, { content: text })

  const llm_gen_entry: TextGen = {
    msg_id: ctrl.message.id,
    model: req.body.model,
    content: text,
    tokens: 0, // to be implemented later
    cost: 0, // to be implemented later
    created_at: Temporal.Now.instant().epochMilliseconds
  }
  await create_entry("textgens", llm_gen_entry, false)

  ctrl.textgens = await exec_sql(
    "SELECT * FROM textgens WHERE msg_id = ? ORDER BY created_at, rowid",
    [ctrl.message.id]
  ) as TextGen[]
  ctrl.message.picked = alternative ? ctrl.textgens.length - 1 : Math.max(0, ctrl.textgens.length - 1)
  await update_entry("messages", ctrl.message.id, {
    picked: ctrl.message.picked,
    ...(!alternative ? { content: text } : {})
  })
  ctrl.message.content = text
  ctrl.content_c.innerHTML = await format_displayed_msg(text)
  refresh_textgen_ctrls(ctrl)

  return llm_gen_entry
}

export async function resume_last_reply() {
  if (generation_active) return false
  if (!TEMP.chat.id) throw Error("Chat ID not specified")
  const [message] = await get_recent_messages(TEMP.chat.id, 0, 1)
  if (!message || message.role !== "assistant" || message.content === null) return false

  const generations = (await exec_sql(
    "SELECT msg_id FROM textgens WHERE msg_id = ?",
    [message.id]
  )).filter((message) => message.role !== "assistant" || message.content.length > 0)
  if (generations.length > 0) return false

  const original_speaker = await get_entry("bubbies", message.listener_id)
  const reply_character = await get_entry("bubbies", message.speaker_id)
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
  if (generation_active) return
  if (!TEMP.chat.id) throw Error("Chat ID not specified");

  // GET DOM
  const prompt_c = q("prompt-c")! as HTMLDivElement;
  const msg_list = q("interactions-c")!;

  // GET CHAT AND CHARACTERS
  const listener_id = TEMP.chat.listener_id;
  const speaker_id = TEMP.chat.speaker_id;

  if (!listener_id) {
    throw Error(`listener is not specified`);
  }
  if (!speaker_id) {
    throw Error(`Speaker is not specified`);
  }

  // Empty prompts request an assistant continuation without adding a user turn.
  const prompt = prompt_c.innerText as string;
  const has_prompt = prompt.trim().length > 0
  const saved_user_msg: Message | null = has_prompt ? {
    role: "user",
    content: prompt,
    chat_id: TEMP.chat.id!,
    id: crypto.randomUUID(),
    speaker_id,
    listener_id,
    created_at: Temporal.Now.instant().epochMilliseconds,
    picked: 0,
  } : null

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

  const speaker = await get_entry("bubbies", speaker_id)
  const listener = await get_entry("bubbies", listener_id)
  if (!speaker) throw Error(`Speaker with ID ${speaker_id} does not exist`)
  if (!listener) throw Error(`Listener with ID ${listener_id} does not exist`)
  
  if (saved_user_msg) await create_entry("messages", saved_user_msg)

  prompt_c.innerHTML = ""; // Clean the input elem

  
  const chat = TEMP.chat as Chat

  const llm_msg_ctrl = await message_controller(listener, chat, saved_llm_msg, [])

  // Append the user turn only when the prompt contains text.
  if (saved_user_msg) {
    const user_msg_ctrl = await message_controller(speaker, chat, saved_user_msg, [])
    msg_list.append(user_msg_ctrl.elem)
  }
  msg_list.append(llm_msg_ctrl.elem);

  // ACTUALLY GENERATE THE TEXT
  try {
    await gen_message(speaker, llm_msg_ctrl) as TextGen
    llm_msg_ctrl.elem.scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    console.log(e)
  }
}

export async function load_chat(chat: Chat) {
  
  TEMP.chat = merge(TEMP.chat, chat)
  /* 
    OPEN CHAT
  */
  const interaction_c = q("interactions-c")! as HTMLDivElement
  await refresh_chat_bubby_selects(TEMP.chat as Chat)

  /* SHOW MESSAGES */
  const history = await get_recent_messages(chat.id, 0, 20)
  const chat_speaker = chat.speaker_id ? await get_entry("bubbies", chat.speaker_id) : null
  const chat_listener = chat.listener_id ? await get_entry("bubbies", chat.listener_id) : null

  // Repair messages saved with the visible dropdown placeholder labels as IDs.
  if (chat_speaker && chat_listener) {
    for (const message of history) {
      const has_placeholder_id = [message.speaker_id, message.listener_id]
        .some((id) => id === "Speaker" || id === "Listener")
      if (!has_placeholder_id) continue
      const speaker_id = message.role === "user" ? chat.speaker_id! : chat.listener_id!
      const listener_id = message.role === "user" ? chat.listener_id! : chat.speaker_id!
      await update_entry("messages", message.id, { speaker_id, listener_id })
      message.speaker_id = speaker_id
      message.listener_id = listener_id
    }
  }

  const c: HTMLElement[] = []

  for (let i = 0; i < history.length; i++) {
    const message = history[i] as Message
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
      c.push(err)
      continue
    }
    const textgens = message.role === "assistant" ? 
    (await exec_sql(`SELECT * FROM textgens WHERE msg_id = ? ORDER BY created_at, rowid`, [message.id])) as TextGen[] 
    : []
    const msg_c = await message_controller(speaker, chat, message, textgens)
    c.push(msg_c.elem)
  }
  interaction_c.replaceChildren(...c)
  let last = c.at(-1)
  if (last) last.scrollIntoView({ behavior: "smooth" });
}
