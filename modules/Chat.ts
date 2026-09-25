import STATES from "../src/STATES.ts";
import TEMP from "../src/TEMP.ts";


import t from "../src/tags.ts";
import { create_entry, get_recent_chats, get_entry, load_chat, send, update_entry, get_bubbies, sync_chat_bubbies, get_chat_bubby_ids } from "../src/chat.ts";
import { Bubby, Chat, instantiate, LlmConfig, LlmConfigSimple, LlmParams } from "../src/definitions.ts";
import obj_editor from "../src/ui_components/obj_editor.ts";


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
          render_chat_list(await get_recent_chats(0, 10))
        } catch (e) {
          console.error(e)
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
          show_one_dom(in_chat_c)
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
        render_bubby_list(await get_bubbies(0, 10))
      } catch (e) {
        console.error(e)
        stat_c.innerHTML = (e as Error).toString();
      }
    },
  })
)

async function get_img (img_path: string) {
  const file_name = img_path.split("/").at(-1)
  if (!file_name) return ""
  const root = await navigator.storage.getDirectory();
  const img_dir = await root.getDirectoryHandle("imgs");
  const file_handle = await img_dir.getFileHandle(file_name);
  const file = await file_handle.getFile();
  return URL.createObjectURL(file);
}

const bubby_config_c = t.bubby_config()

async function render_bubby_list (all: Bubby[]) {

  function bubby_item (bubby: Bubby) {
    const img_c = t.img() as HTMLImageElement
    get_img(bubby.id).then(r => img_c.src = r)
    return t.div(
      {
        onclick () {
          render_bubby_config(bubby)
          show_one_dom(bubby_config_c)
        }
      },
      img_c,
      t.div(bubby.name)
    )
  }

  bubbies_list_c.replaceChildren(
    ...all.map(bubby_item)
  )
}

async function render_bubby_config (bubby: Bubby) {
  bubby_config_c.replaceChildren(obj_editor(Bubby, bubby, {
    async save(old_id: string) {
      try {
        await update_entry("bubbies", old_id ?? bubby.id, bubby)
        return "Updated."
      } catch (e) {
        return (e as Error).toString()
      }
    },
  }))
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

const chat_config_c = t.chat_config_c() as HTMLDivElement

const user_config_c = obj_editor(undefined, STATES) as HTMLDivElement
/* t.chat_config(
  val_c("api_key", STATES),
  t.pair_c(
    t.key_c("chat"),
    t.obj_c(
      t.val_c(STATES.chat.visual)
    )
  )
) */

const llm_config_c = () => {
  let name = randname("LLM Config")
  const base: LlmConfig = {
    id: name,
    name,
    params: {
      model: "",
      messages: []
    }
  }
  
  return t.editor_c(
    t.input({ 
      type: "range", 
      value: LlmConfigSimple.temperature.default, 
      min: LlmParams.temperature.min, 
      max: LlmParams.temperature.max 
    }),
  )
}



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

function show_one_dom (dom: typeof nav[keyof typeof nav]) {
  const doms = Object.values(nav)
  doms.forEach(d => d.style.visibility = "collapse")
  dom.style.visibility = "visible"
}


const nav = {
  Enter: enter_chat,
  Chat: in_chat_c,
  Bubbies: bubbies_c,
  // Libraries: chat_config_c,
  // Prompts: chat_config_c,
  Controls: controls_c,
  "Bubby Config": bubby_config_c,
  // "Library Config": chat_config_c,
  // "Prompt Config": chat_config_c,
  "Chat Config": chat_config_c,
  "User Config": user_config_c,
}

const refresh: Partial<Record<keyof typeof nav, Function>> = {
  Enter () {
    get_recent_chats(0, 10)
    .then(render_chat_list)
  },
  Bubbies () {
    get_bubbies(0, 10)
    .then(render_bubby_list)
  },
  async "Chat Config" () {
    
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
    chat_config_c.replaceChildren(editor, editor_2)
  },
  async "Bubby Config" () {
    if (!TEMP.edited_bubby_id) return
    const bubby = (await get_entry("bubbies", TEMP.edited_bubby_id))!
    render_bubby_config(bubby)
  },
  "User Config" () {
    let e = obj_editor(undefined, STATES, {
      async save (old_id) {
        // await update_entry("chats", TEMP.chat.id!, obj as Chat)
        return "Updated."
      }
    })
    chat_config_c.replaceChildren(...e.children)
  }
}

export async function render() {

  get_recent_chats(0, 10)
  .then(render_chat_list)
  
  show_one_dom(enter_chat)

  return [
    t.stack_c(
      ...Object.entries(nav).map(([title, dom]) => t.button({
        innerText: title,
        async onclick () {
          if (refresh[title]) await refresh[title]()
          show_one_dom(dom)
        }
      }))
    ),
    t.article(...Object.values(nav))
  ]

}