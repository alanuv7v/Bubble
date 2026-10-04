import TEMP from "./TEMP.ts";
import { save_user_config } from "./database.ts";
import { visual_controls } from "./visual.ts";

import t from "./tags.ts";
import { bubby_choices, create_entry, delete_entry, get_entry, load_chat, send, resume_last_reply, update_entry, update_chat_cast, refresh_chat_bubby_selects, get_chat_bubby_ids, get_chat_bubbies, get_recent_entries, query, TableName, TableEntryMap } from "./chat.ts";
import { Bubby, Chat, instantiate, LlmConfig, LlmParams } from "./definitions.ts";
import obj_editor from "./ui_modules/obj_editor.ts";
import { user_config_def } from "./user_config.ts";
import { make_profile_image, save_profile_image, set_img_src } from "./assets.ts";
import asset_picker from "./ui_modules/asset_picker";
import multi_select_picker from "./ui_modules/multi_select_picker.ts";
import render_list_item from "./ui_modules/render_list.ts";
import { log_view, report } from "./log";


const chat_list_c = t.list_c()

const stat_c = t.stat_c() as HTMLElement;
let view_id = 0


const randname = (prefix: string = "") => prefix + " " + Temporal.Now.zonedDateTimeISO().toPlainDateTime().round("second").toLocaleString()

async function create_bubby(name: string, first_message: string | null) {
  return create_entry("bubbies", { name, desc: "", first_message, llm_config_id: null })
}

async function create_named(
  name_input: HTMLInputElement,
  prefix: string,
  create: (name: string) => Promise<{ id: string }>,
  refresh?: () => Promise<unknown> | unknown,
  on_created?: (id: string) => void
) {
  const name = name_input.value.trim() || randname(prefix)
  try {
    const created = await create(name)
    name_input.value = ""
    stat_c.innerText = "Created."
    on_created?.(created.id)
    await refresh?.()
  } catch (e) {
    stat_c.innerText = report(e, "Create entry")
  }
}

function creation_button(
  label: string,
  prefix: string,
  create: (name: string) => Promise<{ id: string }>,
  refresh?: () => Promise<unknown> | unknown,
  on_created?: (id: string) => void
) {
  const name_input = t.input({
    type: "text",
    placeholder: "Name",
  }) as HTMLInputElement
  return t.group_c(
    { className: "horizontal" },
    name_input,
    t.button({
      innerText: label,
      onclick: () => create_named(name_input, prefix, create, refresh, on_created),
    })
  )
}

async function save_action(action: () => Promise<unknown>) {
  try {
    await action()
    return "Updated."
  } catch (e) {
    return report(e, "Save")
  }
}

// Keep one page size per list; slower refreshes cannot replace newer results.
function paged_list<K extends TableName>(
  table: K, container: HTMLElement,
  render_items: (items: TableEntryMap[K][]) => Promise<HTMLElement[]>
) {
  let limit = 10
  let latest = 0
  const refresh = async () => {
    const request = ++latest
    try {
      const items = await get_recent_entries(table, 0, limit + 1)
      const rows = await render_items(items.slice(0, limit))
      if (request !== latest) return
      container.replaceChildren(...rows)
      if (items.length > limit) container.append(t.button({
        type: "button", innerText: "Load more",
        onclick: async () => { limit += 10; await refresh() }
      }))
    } catch (error) {
      const message = report(error, `Load ${table}`)
      if (request === latest) stat_c.innerText = message
    }
  }
  return refresh
}

const refresh_chat_list = paged_list("chats", chat_list_c, render_chat_list)

function config_select(configs: LlmConfig[], selected: string | null, on_change: (id: string | null) => void) {
  const select = t.select({
    onchange: () => on_change(select.value || null)
  },
    t.option({ value: "", innerText: "None" }),
    ...configs.map((config) => t.option({ value: config.id, innerText: config.name }))
  ) as HTMLSelectElement
  select.value = selected ?? ""
  return select
}

async function set_live_chat_listeners(listener_ids: string[]) {
  const owner = TEMP.chat
  const chat_id = owner.id
  if (!chat_id) return
  try {
    const cast = await update_chat_cast(chat_id, undefined, listener_ids, TEMP.involved_bubby_ids)
    if (TEMP.chat !== owner) return
    Object.assign(owner, { speaker_id: cast.speaker_id, listener_ids: cast.listener_ids })
    TEMP.involved_bubby_ids = cast.bubby_ids
    await refresh_chat_bubby_selects(TEMP.chat as Chat)
  } catch (e) {
    const message = report(e, "Set listeners")
    if (TEMP.chat !== owner) return
    stat_c.innerText = message
    const current = await get_entry("chats", chat_id)
    if (current && TEMP.chat === owner) {
      Object.assign(TEMP.chat, current)
      await refresh_chat_bubby_selects(owner as Chat)
    }
  }
}

async function render_chat_editor() {
  const view = view_id
  const chat_id = TEMP.chat.id
  if (!chat_id) return
  const chat = await get_entry("chats", chat_id)
  if (!chat || view !== view_id) return
  let bubby_ids = await get_chat_bubby_ids(chat_id)
  const bubbies = await query("bubbies", "SELECT * FROM bubbies ORDER BY name COLLATE NOCASE, id")
  const configs = await query("llm_configs", "SELECT * FROM llm_configs ORDER BY name COLLATE NOCASE, id")
  if (view !== view_id) return
  TEMP.chat = chat
  TEMP.involved_bubby_ids = bubby_ids
  const options = bubby_choices(bubbies)

  const save = () => save_action(async () => {
    const cast = await update_chat_cast(chat.id, chat.speaker_id, chat.listener_ids, bubby_ids, chat)
    Object.assign(chat, { speaker_id: cast.speaker_id, listener_ids: cast.listener_ids })
    if (view !== view_id) return
    TEMP.involved_bubby_ids = cast.bubby_ids
    await refresh_chat_bubby_selects(chat)
    if (view === view_id) await render_chat_editor()
  })
  const editor = obj_editor({
    ...Chat,
    speaker_id: { render: () => {
      const select = t.select({
        onchange: () => { chat.speaker_id = select.value || null }
      }, t.option({ value: "", innerText: "None" }),
        ...options.map((option) => t.option({ value: option.value, innerText: option.label }))) as HTMLSelectElement
      select.value = chat.speaker_id ?? ""
      return select
    } },
    listener_ids: { render: () => multi_select_picker(
      "edit-chat-listeners", "Listeners", options, chat.listener_ids,
      (ids) => { chat.listener_ids = ids }
    ) },
    llm_config_id: { render: () => config_select(configs, chat.llm_config_id!,
      (id) => { chat.llm_config_id = id }) }
  }, chat, { save }, "Chat")
  const editor_2 = obj_editor(
    { render: () => multi_select_picker(
      "edit-chat-bubbies", "Bubbies In The Chat", options, bubby_ids,
      (ids) => { bubby_ids = ids }
    ) },
    bubby_ids,
    { save },
    "Bubbies In The Chat"
  )
  edit_chat_c.replaceChildren(editor, editor_2)
}

async function set_live_chat_speaker(value: string) {
  const owner = TEMP.chat
  const chat_id = owner.id
  if (!chat_id) return
  const previous_speaker_id = TEMP.chat.speaker_id
  TEMP.chat.speaker_id = value || null

  try {
    const cast = await update_chat_cast(
      chat_id,
      value || null,
      undefined,
      TEMP.involved_bubby_ids
    )
    if (TEMP.chat !== owner) return
    Object.assign(owner, { speaker_id: cast.speaker_id, listener_ids: cast.listener_ids })
    TEMP.involved_bubby_ids = cast.bubby_ids
    await refresh_chat_bubby_selects(TEMP.chat as Chat)
  } catch (e) {
    const message = report(e, "Set speaker")
    if (TEMP.chat !== owner) return
    TEMP.chat.speaker_id = previous_speaker_id ?? null
    stat_c.innerText = message
    const current = await get_entry("chats", chat_id)
    if (current && TEMP.chat === owner) {
      Object.assign(TEMP.chat, current)
      await refresh_chat_bubby_selects(owner as Chat)
    }
  }
}

const enter_chat = t.chats_c(
  chat_list_c,
  creation_button(
    "Create Chat", 
    "Chat", 
    async (name) => create_entry(
      "chats", 
      {
        name,
        speaker_id: null,
        listener_ids: [],
        created_at: Temporal.Now.instant().epochMilliseconds,
        last_use_at: null,
        llm_config_id: null,
      }
    ),
    refresh_chat_list
  ),
  stat_c
) as HTMLDivElement;

function timestamp_to_info(timestamp: number) {

  // 1. Define all duration keys in order from largest to smallest
  const units: (keyof Temporal.DurationLikeObject)[] = [
    'years',
    'months',
    'weeks',
    'days',
    'hours',
    'minutes',
    'seconds',
  ];

  let here = Temporal.Now.timeZoneId()
  let before = Temporal.Instant.fromEpochMilliseconds(timestamp).toZonedDateTimeISO(here)
  let now = Temporal.Now.zonedDateTimeISO(here)
  let passed = before.until(now);
  // if (passed.days === 0) return `today`
  // if (passed.days === 1) return `yesterday`
  
  const largest_unit = units.find((unit) => passed[unit] > 0) || 'seconds';
  const singular_unit = largest_unit.slice(0, -1) as Temporal.DateUnit | Temporal.TimeUnit
  
  const rounded = passed.round({
    largestUnit: singular_unit,
    smallestUnit: singular_unit,
    relativeTo: Temporal.Now.plainDateISO() // Needed for accurate variable-length month/year math
  });
  
  const count = Math.abs(rounded[largest_unit] as number);
  const unit = count === 1 ? singular_unit : largest_unit;
  return `${count} ${unit} ago`;
}

async function render_chat_list (chats: Chat[]) {
  const edit_item = async (chat: Chat) => {
    TEMP.chat = chat
    show_one_dom("Edit Chat")
  }
  const render_item = async (chat: Chat, bubbies: Bubby[]) => {
    return t.div(
      { 
        onclick () {
          show_one_dom("Chat")
          void load_chat(chat).catch((error) => { stat_c.innerText = report(error, "Open chat") })
        }
      },
      t.div(
        { className: "info" },
        t.h2({ innerText: chat.name }),
        t.div({ className: "names", innerText: bubbies.map((bubby) => bubby.name).join(", ") }),
        t.div(
          { className: "meta" },
          t.div({ innerText: `created: ${timestamp_to_info(chat.created_at).toLocaleString()}` }),
          t.div({ innerText: `last use: ${chat.last_use_at ? timestamp_to_info(chat.last_use_at).toLocaleString() : "never"}` })
        )
      ),
    )
  }
  const delete_item = async (chat: Chat) => {
    await delete_entry("chats", chat.id)
    if (TEMP.chat.id === chat.id) TEMP.chat.id = undefined
  }
  const children = await Promise.all(
    chats.map(async chat => {
      
      const bubbies = await get_chat_bubbies(chat.id)
      const dom = await render_list_item(chat, chats => render_item(chats, bubbies), edit_item, delete_item)
      const bubby_images = await Promise.all(bubbies.map(async (bubby) => {
        const img = t.img({ className: "profile", alt: bubby.name, title: bubby.name }) as HTMLImageElement
        await set_img_src(img, `${bubby.id}.webp`, "assets/profile_fallback.webp")
        return img
      }))

      dom.append(t.div({ className: "profiles" }, ...bubby_images))
      return dom
    })
  )
  return children
}

const list_c_c = t.list_c()
const refresh_bubby_list = paged_list("bubbies", list_c_c, render_bubby_list)
const bubbies_c = t.bubbies_c(
  list_c_c,
  creation_button("Create Bubby", "Bubby", (name) => create_bubby(name, ""),
    refresh_bubby_list)
)

const llm_config_list_c = t.list_c()
async function render_llm_configs(configs: LlmConfig[]) {
  const edit_item = (c: LlmConfig) => {
    TEMP.edited_llm_config_id = c.id
    show_one_dom("LLM Config")
  }
  const render_item = (c: LlmConfig) => t.div({
    onclick: () => {
      TEMP.edited_llm_config_id = c.id
      show_one_dom("LLM Config")
    }
  }, t.div({ innerText: c.name }))
  const delete_item = (c: LlmConfig) => delete_entry("llm_configs", c.id)
  const children = await Promise.all(
    configs.map(async config => await render_list_item(config, render_item, undefined, delete_item))
  )
  return children
}
const refresh_llm_config_list = paged_list("llm_configs", llm_config_list_c, render_llm_configs)
const llm_configs_c = t.llm_configs(
  llm_config_list_c,
  creation_button("Create LLM Config", "LLM Config", (name) => create_entry("llm_configs", {
    name,
    api_key: "",
    api_url: "https://openrouter.ai/api/v1/chat/completions",
    params: instantiate(LlmParams),
  }), refresh_llm_config_list)
)

async function render_bubby_list (bubbies: Bubby[]) {
  return Promise.all(bubbies.map(async (bubby) => {
    const img_c = t.img({ className: "profile" }) as HTMLImageElement
    await set_img_src(img_c, `${bubby.id}.webp`, "assets/profile_fallback.webp")

    return t.div(
      {
        onclick () {
          TEMP.edited_bubby_id = bubby.id
          show_one_dom("Edit Bubby")
        }
      },
      img_c,
      t.div({ innerText: bubby.name })
    )
  }))
}

async function render_bubby_config (bubby: Bubby) {
  const view = view_id
  const configs = await query("llm_configs", "SELECT * FROM llm_configs ORDER BY name COLLATE NOCASE, id")
  const fallback = "assets/profile_fallback.webp"
  const img = t.img({
    className: "profile",
  }) as HTMLImageElement
  const profile_src = await set_img_src(img, `${bubby.id}.webp`, fallback)

  if (view !== view_id) return
  edit_bubby_c.replaceChildren(
    t.div(
      img,
      asset_picker({
        title: "Profile image", folder: "", accept: "image/*",
        prepare_upload: (file) => make_profile_image(file, bubby.id),
        selected: profile_src === fallback ? "" : `${bubby.id}.webp`,
        show: (name) => name === `${bubby.id}.webp`,
        display_name: () => "Current image",
        on_select: async (file, name) => {
          if (file && name !== `${bubby.id}.webp`) await save_profile_image(file, bubby.id)
          await set_img_src(img, `${bubby.id}.webp`, fallback)
          await refresh_bubby_list()
          return file ? `${bubby.id}.webp` : ""
        },
        on_delete: refresh_bubby_list
      }),
    ),
    obj_editor({
      ...Bubby,
      llm_config_id: { render: () => config_select(configs, bubby.llm_config_id,
        (id) => { bubby.llm_config_id = id }) }
    }, bubby, {
      async save() {
        const id = bubby.id
        return save_action(async () => {
          await update_entry("bubbies", id, bubby)
          await refresh_bubby_list()
          const saved_bubby = await get_entry("bubbies", id)
          if (saved_bubby && view === view_id) await render_bubby_config(saved_bubby)
        })
      },
    })
  )
}

const prompt_c = t.prompt_c({
  className: "blank",
  spellcheck: false,
  contentEditable: "true",
  onkeydown: (event: KeyboardEvent) => {
    if (event.key === "Chats" && event.shiftKey) {
      event.preventDefault();
      send();
    }
  },
  oninput: (event: Event) => {
    const target = event.target as HTMLElement;
    if (target.innerText.length < 1) {
      target.classList.add("blank");
    } else {
      target.classList.remove("blank");
    }
  },
});

const in_chat_c = t.in_chat(
  t.interactions_c(),
  t.request_c(
    t.wrap_c(prompt_c),
    t.footer(
      t.group_c({ className: "horizontal" },
        t.button(
          { innerText: "Send", onclick: () => send() },
          t.img({ src: "./icons/takeoff.svg" })
        ),
        t.button(
          { innerText: "Abort", onclick: () => TEMP.text_gen_aborter.abort() },
          t.img({ src: "./icons/abort.svg" })
        ),
        t.button(
          {
            innerText: "Resume",
            onclick: async () => {
              try {
                if (!prompt_c.innerText.trim()) {
                  await send()
                  return
                }
                const resumed = await resume_last_reply()
                if (!resumed) stat_c.innerText = "No interrupted reply to resume."
              } catch (e) {
                stat_c.innerText = report(e, "Resume")
              }
            },
          },
          t.img({ src: "./icons/resume.svg" })
        )
      ),
      t.div(
        { className: "select" },
        t.img({ src: "icons/persona.svg" }),
        t.select(
          {
            className: "persona",
            onchange: (event: Event) => {
              const target = event.target as HTMLSelectElement;
              void set_live_chat_speaker(target.value)
            },
          },
          t.option({ value: "", innerText: "Speaker" })
        )
      ),
      multi_select_picker("chat-listeners", "Listeners", [], [], set_live_chat_listeners),
      t.group_c({ className: "horizontal" },
        t.button({ innerText: "Library" }, t.img({ src: "./icons/library.svg" })),
        t.button(
          { innerText: "Req. Temp." },
          t.img({ src: "./icons/template.svg" })
        )
      ),
      // WIP
      /* t.group_c({ className: "horizontal" },
        t.button(
          { innerText: "Transl." },
          t.img({ src: "./icons/translate.svg" })
        ),
        t.button({ innerText: "Narr." }, t.img({ src: "./icons/narrate.svg" })),
        t.button({ innerText: "Paint" }, t.img({ src: "./icons/paint.svg" })),
        t.button(
          { innerText: "Auto Write" },
          t.img({ src: "./icons/mind working.svg" })
        ) 
      ),*/
    )
  )
) as HTMLDivElement;


const edit_bubby_c = t.edit_bubby() as HTMLDivElement
const edit_chat_c = t.edit_chat() as HTMLDivElement
const user_config_c = t.user_config() as HTMLDivElement
const llm_config_c = t.llm_config() as HTMLDivElement
const controls_c = t.controls_c(
  t.button({
    innerText: "Fullscreen",
    onclick: () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    },
  })
)
const guide_c = t.guide_c(
  t.div(`Welcome to Bubble.
Configure your LLM API.`),
  t.input({
    type: "text",
    placeholder: `API key`,
  }),
  t.input({
    type: "text",
    placeholder: `API URL`,
  }),

  t.details(
    t.summary("What options do I have?"),
    t.div(`Currently, using OpenRouter is what this app is oriented for.
Setting other specific API URL in your LLM config is possible.
However, if the API of the provider significantly differs from OpenRouter's or OpenAI's, the app may not work as intended.`),
  ),
  creation_button(
    "Create your first bubby.",
    "New Bubby",
    (name) => create_bubby(name, null),
    undefined,
    (id) => {
      TEMP.edited_bubby_id = id;
      show_one_dom("Edit Bubby");
    },
  ),
  t.div(`Or talk to our sample bubbies.`),

  creation_button(
    "Create your persona.",
    "New Bubby (Your Persona)",
    (name) => create_bubby(name, null),
    undefined,
    (id) => {
      TEMP.edited_bubby_id = id;
      show_one_dom("Edit Bubby");
    },
  ),
  t.div(`Or go anonymous.`),

  t.button({
    innerText: "Now you can chat.",
    onclick: () => {
      show_one_dom("Chats");
    },
  }),
  t.div("You can always configure details later. Enjoy!"),

  t.details(
    t.summary("How is my data kept?"),
    t.div(`In a desktop app:
Your data is kept in a SQLite DB file in your dedvice's filesystem.

In a browser:
Your data is kept in your OPFS(Origin Private File System), meaning your browser, ultimately your device.

While this very app stores all personal data in your device only, the LLM API provider you are using might retain usage data, depending on their policies and your settings. So be sure to check them.`),
  ),
) as HTMLDivElement;

export function show_one_dom (title: keyof typeof nav) {
  view_id++
  const doms = Object.values(nav)
  doms.forEach(d => d.style.display = "none")
  nav[title].style.display = "flex"
  if (refresh[title]) Promise.resolve().then(() => refresh[title]!()).catch((error) => {
    stat_c.innerText = report(error, `Open ${title}`)
  })
}


const nav = {
  Chats: enter_chat,
  Chat: in_chat_c,
  Bubbies: bubbies_c,
  "LLM Configs": llm_configs_c,
  // Prompts: chat_config_c,
  "Edit Bubby": edit_bubby_c,
  // "Prompt Config": chat_config_c,
  "Edit Chat": edit_chat_c,
  "User Config": user_config_c,
  "LLM Config": llm_config_c,
  Controls: controls_c,
  Guide: guide_c,
  Logs: log_view(),
}

const refresh: Partial<Record<keyof typeof nav, () => void | Promise<void>>> = {
  Chats () {
    return refresh_chat_list()
  },
  Bubbies () {
    return refresh_bubby_list()
  },
  "LLM Configs" () {
    return refresh_llm_config_list()
  },
  async "Edit Chat" () {
    await render_chat_editor()
  },
  async "Edit Bubby" () {
    if (!TEMP.edited_bubby_id) return
    const view = view_id
    const bubby = await get_entry("bubbies", TEMP.edited_bubby_id)
    if (bubby && view === view_id) await render_bubby_config(bubby)
  },
  async "User Config" () {
    const def = { ...user_config_def, visual: { render: visual_controls } }
    const e = obj_editor(def, TEMP.user_config, {
      async save() {
        return save_action(save_user_config)
      },
    }) as HTMLDivElement
    user_config_c.replaceChildren(e)
  },
  async "LLM Config" () {
    if (!TEMP.edited_llm_config_id) return
    const view = view_id
    const base = await get_entry("llm_configs", TEMP.edited_llm_config_id)
    if (!base || view !== view_id) return
    const e = obj_editor(LlmConfig, base, {
      async save(old_id) {
        return save_action(() => update_entry("llm_configs", base.id, base))
      },
    }) as HTMLDivElement
    llm_config_c.replaceChildren(e)
    
    // return t.editor_c(
    //   t.input({ 
    //     type: "range", 
    //     value: LlmConfigSimple.temperature.default, 
    //     min: LlmParams.temperature.min, 
    //     max: LlmParams.temperature.max 
    //   }),
    // )
  }
}

export async function render() {
 return [
    t.stack_c(
      ...[
        "Chats",
        "Bubbies",
        "LLM Configs",
        "User Config",
        "Controls",
        "Guide",
        "Logs"
      ].map((title) => t.button({
        innerText: title,
        async onclick () {
          show_one_dom(title as keyof typeof nav)
        }
      }))
    ),
    t.article(...Object.values(nav))
  ]

}
