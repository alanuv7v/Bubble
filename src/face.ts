import TEMP from "./TEMP.ts";
import yaml from "yaml";
import { theme_controls } from "./theme.ts";

import t from "./tags.ts";
import { create_entry, delete_entry, get_entry, load_chat, send, resume_last_reply, update_entry, update_chat_cast, refresh_chat_bubby_selects, get_chat_bubby_ids, get_chat_bubbies, get_recent_entries } from "./chat.ts";
import { Bubby, Chat, instantiate, LlmConfig, LlmParams } from "./definitions.ts";
import obj_editor from "./ui_modules/obj_editor.ts";
import { user_config_def } from "./user_config.ts";
import { get_img_src, pick_and_save_image, rename_asset } from "./assets.ts";
import multi_select_picker from "./ui_modules/multi_select_picker.ts";
import render_list_item from "./ui_modules/render_list.ts";


const chat_list_c = t.list_c()

const stat_c = t.stat_c() as HTMLElement;


const randname = (prefix: string = "") => prefix + " " + Temporal.Now.zonedDateTimeISO().toPlainDateTime().round("second").toLocaleString()

async function create_named(
  id_input: HTMLInputElement,
  prefix: string,
  create: (id: string) => Promise<unknown>,
  refresh?: () => Promise<unknown> | unknown,
  on_created?: (id: string) => void
) {
  const id = id_input.value.trim() || randname(prefix)
  try {
    await create(id)
    id_input.value = ""
    stat_c.innerText = "Created."
    on_created?.(id)
    await refresh?.()
  } catch (e) {
    stat_c.innerText = (e as Error).message || String(e)
  }
}

function creation_button(
  label: string,
  prefix: string,
  create: (name: string) => Promise<unknown>,
  refresh?: () => Promise<unknown> | unknown,
  on_created?: (id: string) => void
) {
  const id_input = t.input({
    type: "text",
    placeholder: "ID",
  }) as HTMLInputElement
  return t.group_c(
    { className: "horizontal" },
    id_input,
    t.button({
      innerText: label,
      onclick: () => create_named(id_input, prefix, create, refresh, on_created),
    })
  )
}

async function save_action(action: () => Promise<unknown>) {
  try {
    await action()
    return "Updated."
  } catch (e) {
    return (e as Error).message || String(e)
  }
}

async function replace_list<T>(
  container: HTMLElement,
  items: T[],
  render_item: (item: T) => HTMLElement | Promise<HTMLElement>
) {
  container.replaceChildren(...await Promise.all(items.map(render_item)))
}

async function save_active_chat_cast() {
  const chat_id = TEMP.chat.id
  if (!chat_id) throw new Error("Chat ID not specified")
  const cast = await update_chat_cast(
    chat_id,
    TEMP.chat.speaker_id ?? null,
    undefined,
    TEMP.involved_bubby_ids,
    TEMP.chat as Chat
  )
  Object.assign(TEMP.chat, { speaker_id: cast.speaker_id, listener_ids: cast.listener_ids })
  TEMP.involved_bubby_ids = cast.bubby_ids
  await refresh_chat_bubby_selects(TEMP.chat as Chat)
}

async function set_live_chat_listeners(listener_ids: string[]) {
  const chat_id = TEMP.chat.id
  if (!chat_id) return
  try {
    const cast = await update_chat_cast(chat_id, undefined, listener_ids, TEMP.involved_bubby_ids)
    Object.assign(TEMP.chat, { speaker_id: cast.speaker_id, listener_ids: cast.listener_ids })
    TEMP.involved_bubby_ids = cast.bubby_ids
    await refresh_chat_bubby_selects(TEMP.chat as Chat)
  } catch (e) {
    stat_c.innerText = (e as Error).message || String(e)
    const current = await get_entry("chats", chat_id)
    if (current) {
      Object.assign(TEMP.chat, current)
      await refresh_chat_bubby_selects(current)
    }
  }
}

async function render_chat_editor() {
  const chat_id = TEMP.chat.id
  if (!chat_id) return
  TEMP.chat = (await get_entry("chats", chat_id))!
  TEMP.involved_bubby_ids = await get_chat_bubby_ids(chat_id)

  const save = () => save_action(async () => {
    await save_active_chat_cast()
    await render_chat_editor()
  })
  const editor = obj_editor(Chat, TEMP.chat, { save }, "Chat")
  const editor_2 = obj_editor(
    { __type: "set", allows: { __type: "string" } },
    TEMP.involved_bubby_ids,
    { save },
    "Bubbies In The Chat"
  )
  edit_chat_c.replaceChildren(editor, editor_2)
}

async function set_live_chat_speaker(value: string) {
  const chat_id = TEMP.chat.id
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
    Object.assign(TEMP.chat, { speaker_id: cast.speaker_id, listener_ids: cast.listener_ids })
    TEMP.involved_bubby_ids = cast.bubby_ids
    await refresh_chat_bubby_selects(TEMP.chat as Chat)
  } catch (e) {
    TEMP.chat.speaker_id = previous_speaker_id ?? null
    stat_c.innerText = (e as Error).message || String(e)
    const current = await get_entry("chats", chat_id)
    if (current) {
      Object.assign(TEMP.chat, current)
      await refresh_chat_bubby_selects(current)
    }
  }
}

const enter_chat = t.enter_chat(
  chat_list_c,
  creation_button(
    "Create Chat", 
    "Chat", 
    async (name) => create_entry(
      "chats", 
      {
        id: name,
        name,
        speaker_id: null,
        listener_ids: [],
        created_at: Temporal.Now.instant().epochMilliseconds,
        last_use_at: null,
        llm_config_id: null,
      }
    ),
    async () => render_chat_list(await get_recent_entries("chats", 0, 10))
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
          load_chat(chat)
        }
      },
      t.div(
        { className: "info" },
        t.h2(chat.name),
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
      const bubby_images = await Promise.all(bubbies.map(async (bubby) => t.img({
        className: "profile",
        src: await get_img_src(`${bubby.id}.webp`, "assets/profile_fallback.webp"),
        alt: bubby.name,
        title: bubby.name,
      })))

      dom.append(t.div({ className: "profiles" }, ...bubby_images))
      return dom
    })
  )
  chat_list_c.replaceChildren(...children)
}

const list_c_c = t.list_c()
const bubbies_c = t.bubbies_c(
  list_c_c,
  creation_button("Create Bubby", "Bubby", async (name) => {
    const bubby: Bubby = {
      id: name,
      name,
      desc: "",
      first_message: "",
      llm_config_id: null,
    }
    return create_entry("bubbies", bubby)
  }, async () => render_bubby_list(await get_recent_entries("bubbies", 0, 10)))
)

const llm_config_list_c = t.list_c()
async function refresh_llm_config_list () {
  const edit_item = (c: LlmConfig) => {
    TEMP.edited_llm_config_id = c.id
    show_one_dom("LLM Config")
  }
  const render_item = (c: LlmConfig) => t.div({
    onclick: () => {
      TEMP.edited_llm_config_id = c.id
      show_one_dom("LLM Config")
    }
  }, t.div(c.name))
  const delete_item = (c: LlmConfig) => delete_entry("llm_configs", c.id)
  const configs = await get_recent_entries("llm_configs", 0, 10)
  const children = await Promise.all(
    configs.map(async config => await render_list_item(config, render_item, undefined, delete_item))
  )
  llm_config_list_c.replaceChildren(...children)
}
const llm_configs_c = t.llm_configs(
  llm_config_list_c,
  creation_button("Create LLM Config", "LLM Config", (name) => create_entry("llm_configs", {
    id: name,
    name,
    api_key: "",
    api_url: "https://openrouter.ai/api/v1/chat/completions",
    params: instantiate(LlmParams),
  }), refresh_llm_config_list)
)

async function render_bubby_list (bubbies: Bubby[]) {
  await replace_list(list_c_c, bubbies, async (bubby) => {
    let profile_img_src = await get_img_src(bubby.id + ".webp", "assets/profile_fallback.webp")

    const img_c = t.img({
      className: "profile",
      src: profile_img_src
    }) as HTMLImageElement

    return t.div(
      {
        onclick () {
          render_bubby_config(bubby)
          show_one_dom("Edit Bubby")
        }
      },
      img_c,
      t.div(bubby.name)
    )
  })
}

async function render_bubby_config (bubby: Bubby) {
  
  const img = t.img({
    className: "profile",
    src: await get_img_src(bubby.id + ".webp", "assets/profile_fallback.webp"),
  }) as HTMLImageElement

  edit_bubby_c.replaceChildren(
    t.div(
      img,
      t.button({
        innerText: "Set profile image",
        onclick: async () => {
          await pick_and_save_image(bubby.id, "webp", 0.9)
          img.src = await get_img_src(bubby.id + ".webp", "assets/profile_fallback.webp")
        }
      }),
    ),
    obj_editor(Bubby, bubby, {
      async save(old_id) {
        const prev_id = old_id ?? bubby.id
        const next_id = bubby.id
        return save_action(async () => {
          const rollback_image_rename = await rename_asset(`${prev_id}.webp`, `${next_id}.webp`)
          try {
            await update_entry("bubbies", prev_id, bubby)
          } catch (error) {
            await rollback_image_rename()
            throw error
          }
          TEMP.edited_bubby_id = next_id
          await render_bubby_list(await get_recent_entries("bubbies", 0, 10))
          const saved_bubby = await get_entry("bubbies", next_id)
          if (saved_bubby) await render_bubby_config(saved_bubby)
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
    if (event.key === "Enter" && event.shiftKey) {
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
                stat_c.innerText = (e as Error).message || String(e)
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
    (id) =>
      create_entry("bubbies", {
        id,
        name: id,
        desc: "",
        first_message: null,
        llm_config_id: null,
      }),
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
    (id) =>
      create_entry("bubbies", {
        id,
        name: id,
        desc: "",
        first_message: null,
        llm_config_id: null,
      }),
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
      show_one_dom("Enter");
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
  const doms = Object.values(nav)
  doms.forEach(d => d.style.display = "none")
  nav[title].style.display = "flex"
  if (refresh[title]) refresh[title]()
}


const nav = {
  Enter: enter_chat,
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
}

const refresh: Partial<Record<keyof typeof nav, () => void | Promise<void>>> = {
  Enter () {
    get_recent_entries("chats", 0, 10)
    .then(render_chat_list)
  },
  Bubbies () {
    get_recent_entries("bubbies", 0, 10)
    .then(render_bubby_list)
  },
  "LLM Configs" () {
    refresh_llm_config_list()
  },
  async "Edit Chat" () {
    await render_chat_editor()
  },
  async "Edit Bubby" () {
    if (!TEMP.edited_bubby_id) return
    const bubby = (await get_entry("bubbies", TEMP.edited_bubby_id))!
    render_bubby_config(bubby)
  },
  async "User Config" () {
    const theme = await theme_controls()
    // Theme has dedicated controls, so keep its filenames out of the generic editor.
    const config_for_editor = { ...TEMP.user_config }
    delete (config_for_editor as Partial<typeof TEMP.user_config>).theme
    const e = obj_editor(user_config_def, config_for_editor, {
      async save() {
        return save_action(async () => {
          const writer = await TEMP.user_config_handle?.createWritable()
          await writer?.write(yaml.stringify(TEMP.user_config))
          await writer?.close()
        })
      },
    }) as HTMLDivElement
    user_config_c.replaceChildren(theme, e)
  },
  async "LLM Config" () {
    if (!TEMP.edited_llm_config_id) return
    const base = await get_entry("llm_configs", TEMP.edited_llm_config_id)
    if (!base) return
    const e = obj_editor(LlmConfig, base, {
      async save(old_id) {
        return save_action(() => update_entry("llm_configs", old_id ?? TEMP.edited_llm_config_id!, base))
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
        "Enter",
        "Chat",
        "Bubbies",
        "LLM Configs",
        "User Config",
        "Controls",
        "Guide"
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
