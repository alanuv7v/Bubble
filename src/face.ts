import TEMP from "./TEMP.ts";
import yaml from "yaml";

import t from "./tags.ts";
import { create_entry, get_entry, load_chat, send, update_entry, sync_chat_bubbies, get_chat_bubby_ids, get_entries, get_recent_entries } from "./chat.ts";
import { Bubby, Chat, instantiate, LlmConfig, LlmParams } from "./definitions.ts";
import obj_editor from "./ui_components/obj_editor.ts";
import { user_config_def } from "./user_config.ts";
import { pipe } from "./utils/pipe.ts";
import { get_img_src, pick_and_save_image } from "./assets.ts";


const chat_list_c = t.chat_list()

const new_chat_input = t.new_chat_id({
  contentEditable: "true",
}) as HTMLElement;

const stat_c = t.stat_c() as HTMLElement;


const randname = (prefix: string = "") => prefix + " " + Temporal.Now.zonedDateTimeISO().toPlainDateTime().round("second").toLocaleString()

const enter_chat = t.enter_chat(
  chat_list_c,
  t.group_c(
    { className: "horizontal" },
    new_chat_input,
    t.button({
      innerText: "Create Chat",
      onclick: async () => {
        let name = new_chat_input.innerText.trim();
        try {
          if (name === "") name = randname("Chat")
          await create_entry("chats", {
            id: name,
            name,
            speaker_id: null,
            listener_id: null,
            created_at: Temporal.Now.instant().epochMilliseconds,
            last_use_at: null,
            llm_config_id: null,
          })
          stat_c.innerHTML = "Created.";
          render_chat_list(await get_recent_entries("chats", 0, 10))
        } catch (e) {
          console.log(e)
          stat_c.innerHTML = "The ID is already occupied!";
        }
      },
    })
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
  const inners = await Promise.all(chats.map(async chat => {
    const bubby_ids = await get_chat_bubby_ids(chat.id)
    return t.div(
      { 
        onclick () {
          show_one_dom("Chat")
          load_chat(chat)
        }
      },
      t.h2(chat.name),
      t.div({ innerText: bubby_ids.join(", ") }),
      t.div({ innerText: `created: ${timestamp_to_info(chat.created_at).toLocaleString()}` }),
      t.div({ innerText: `last use: ${chat.last_use_at ? timestamp_to_info(chat.last_use_at).toLocaleString() : "never"}` })
    )
  }))
  chat_list_c.replaceChildren(
    ...inners
  )
}

const bubbies_list_c = t.bubbies_list()
const bubbies_c = t.bubbies_c(
  bubbies_list_c,
  t.button({
    innerText: "Create Bubby",
    onclick: async () => {
      let name = new_chat_input.innerText.trim();
      try {
        if (name === "") name = randname("Bubby")
        const new_bubby: Bubby = {
          id: name,
          name,
          desc: "",
          first_message: "",
          llm_config_id: null
        }
        await create_entry("bubbies", new_bubby)
        stat_c.innerHTML = "Created.";
        render_bubby_list(await get_recent_entries("bubbies", 0, 10))
      } catch (e) {
        console.log(e)
        stat_c.innerHTML = (e as Error).toString();
      }
    },
  })
)

const llm_config_list_c = t.list_c()
async function refresh_llm_config_list () {
  llm_config_list_c.replaceChildren(
    ...(await get_recent_entries("llm_configs", 0, 10))
    .map(c => t.div({
      innerHTML: c.name, 
      onclick: () => {
        TEMP.edited_llm_config_id = c.id
        show_one_dom("LLM Config")
      }
    }))
  )
}
const llm_configs_c = t.llm_configs(
  llm_config_list_c,
  t.button({
    innerText: "Prev",
    onclick: async () => {
      // WIP
    }
  }),
  t.button({
    innerText: "Next",
    onclick: async () => {
      // WIP
    }
  }),
  t.button({
    innerText: "Create LLM Config",
    onclick: async () => {
      let name = new_chat_input.innerText.trim();
      try {
        if (name === "") name = randname("LLM Config")
        const new_conf: LlmConfig = {
          id: name,
          name,
          api_key: "",
          api_url: "https://openrouter.ai/api/v1/chat/completions",
          params: instantiate(LlmParams)
        }
        await create_entry("llm_configs", new_conf)
        stat_c.innerHTML = "Created.";
        refresh_llm_config_list()
      } catch (e) {
        console.log(e)
        stat_c.innerHTML = (e as Error).toString();
      }
    },
  })
)

async function render_bubby_list (bubbies: Bubby[]) {

  async function bubby_item (bubby: Bubby) {
    
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
  }

  bubbies_list_c.replaceChildren(
    ...(await Promise.all(bubbies.map(bubby_item)))
  )
}

async function render_bubby_config (bubby: Bubby) {
  
  const img = t.img({
    className: "profile",
    src: await get_img_src(bubby.id, "assets/profile_fallback.webp"),
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
        try {
          await update_entry("bubbies", old_id ?? bubby.id, bubby)
          return "Updated."
        } catch (e) {
          return (e as Error).toString()
        }
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
            /* onclick: () => actions.text_gen_resume() */
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
              TEMP.chat.speaker_id =
                target.options[target.selectedIndex].text;
            },
          },
          t.option({ innerText: "Speaker" })
        )
      ),
      t.div(
        { className: "select" },
        t.img({ src: "icons/face.svg" }),
        t.select(
          {
            className: "target_char",
            onchange: (event: Event) => {
              const target = event.target as HTMLSelectElement;
              TEMP.chat.listener_id =
                target.options[target.selectedIndex].text;
            },
          },
          t.option({ innerText: "Listener" })
        )
      ),
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
const edit_chat_c = t.edit_chat_c() as HTMLDivElement
const user_config_c = t.user_config() as HTMLDivElement
const llm_config_c = t.llm_config_c() as HTMLDivElement
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
/* 
Welcome to Bubble.
Configure your API key.
OpenRouter

Create your first bubby.
Or talk to our sample bubbies.
Iris Hepburn
Olivia Bell
Indigo Gomez

Create your persona.
Or go anonymous.

Create your first chat.
You can include your persona and 1+ bubbies.

Now you can chat.
You can always configurate specifics later.
Enjoy!
*/
) as HTMLDivElement

function show_one_dom (title: keyof typeof nav) {
  const doms = Object.values(nav)
  doms.forEach(d => d.style.visibility = "collapse")
  nav[title].style.visibility = "visible"
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

const refresh: Partial<Record<keyof typeof nav, Function>> = {
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
    
    TEMP.chat = (await get_entry("chats", TEMP.chat.id!))!
    TEMP.involved_bubby_ids = await get_chat_bubby_ids(TEMP.chat.id!)

    let editor = obj_editor(Chat, TEMP.chat, {
      async save (old_id) {
        try {
          await update_entry("chats", old_id ?? TEMP.chat.id!, TEMP.chat)
          return "Updated."
        } catch (e) {
          return (e as Error).toString()
        }
      }
    }, "Chat")
    let editor_2 = obj_editor({ allows: { __type: "string" } }, TEMP.involved_bubby_ids, {
      async save (old_id) {
        try {
          await sync_chat_bubbies(old_id ?? TEMP.chat.id!, TEMP.involved_bubby_ids)
          return "Updated."
        } catch (e) {
          return (e as Error).toString()
        }
      }
    }, "Bubbies In The Chat")
    edit_chat_c.replaceChildren(editor, editor_2)
  },
  async "Edit Bubby" () {
    if (!TEMP.edited_bubby_id) return
    const bubby = (await get_entry("bubbies", TEMP.edited_bubby_id))!
    render_bubby_config(bubby)
  },
  "User Config" () {
    const e = obj_editor(user_config_def, TEMP.user_config, {
      async save() {
        const writer = await TEMP.user_config_handle?.createWritable()
        await writer?.write(yaml.stringify(TEMP.user_config))
        return "Updated."
      },
    }) as HTMLDivElement
    user_config_c.replaceChildren(...e.children)
  },
  async "LLM Config" () {
    if (!TEMP.edited_llm_config_id) return
    const base = await get_entry("llm_configs", TEMP.edited_llm_config_id)
    if (!base) return
    const e = obj_editor(LlmConfig, base, {
      async save(old_id) {
        await update_entry("llm_configs", old_id ?? TEMP.edited_llm_config_id!, base)
        return "Updated."
      },
    }) as HTMLDivElement
    llm_config_c.replaceChildren(...e.children)
    
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

  show_one_dom("Enter")

  return [
    t.stack_c(
      ...Object.keys(nav).map((title) => t.button({
        innerText: title,
        async onclick () {
          show_one_dom(title as keyof typeof nav)
        }
      }))
    ),
    t.article(...Object.values(nav))
  ]

}