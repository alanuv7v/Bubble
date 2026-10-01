import { q } from "./utils/gui.ts";
import yaml from "yaml";
import TEMP from "./TEMP.ts";
import tags from "./tags.ts";
import * as db from "./database.ts";

//------------------------------------------------------------

import { marked } from "marked";
import PATH from "path-browserify";
import * as llm from "./llm";
import { create_entries, create_entry, delete_entry, get_entry, query, update_entry, sync_chat_bubbies } from "./chat.ts";
import { render, show_one_dom } from "./face.ts";
import { nuke_db } from "./database.ts";
import { instantiate, LlmParams } from "./definitions.ts";
import { apply_visual } from "./visual.ts";

// DEBUG
Object.entries({
  marked,
  yaml,
  PATH,
  llm,
  tags, 
  exec_sql: db.exec_sql,
  query,
  nuke_db,

  get_entry, delete_entry, create_entry, create_entries, update_entry,

}).forEach(([k, v]) => (window[k] = v));

//------------------------------------------------------------

Object.defineProperty(window, "TEMP", {
  get() {
    return TEMP;
  },
});

console.log("%cWelcom to Bubble🫧", "color: skyblue");

try {
  
  let was_ever_initialized: string|null = null

  // The worker and asset handle are per-page state; only default-data seeding is one-time.
  await db.init()
  await apply_visual()

  if (TEMP.backbone === "Neutralino") {
    const version = await db.exec_sql<{ user_version: number }>("PRAGMA user_version")
    was_ever_initialized = version[0]?.user_version === 1 ? "1" : null
  } else {
    was_ever_initialized = localStorage.getItem("v")
  }

  if (was_ever_initialized !== "1") {

    await create_entry("bubbies", {
      id: "Ethan",
      name: "Ethan",
      desc: "",
      llm_config_id: null, 
      first_message: null
    }, false, "IGNORE")
  
    await create_entry("bubbies", {
      id: "Angelica",
      name: "Angelica",
      desc: "",
      llm_config_id: null, 
      first_message: null
    }, false, "IGNORE")
  
    await create_entry("llm_configs", {
      id: "Roleplay",
      name: "Roleplay",
      api_key: "",
      api_url: "https://openrouter.ai/api/v1/chat/completions",
      params: {
        ...instantiate(LlmParams) as LlmParams,
        model: "~google/gemini-flash-latest",
        messages: [
          { 
            role: "system",
            content: (
              "You are {{char.name}}. Roleplay as {{char.name}}.\n"
              + "# About {{char.name}}\n"
              + "{{char.desc}}"
              + "# About {{user.name}}\n"
              + "{{user.desc}}"
            )
          }
        ]
      }
    }, false, "IGNORE")
  
  await create_entry("chats", {
      id: "First Chat",
      name: "First Chat",
      speaker_id: "Ethan",
      listener_ids: ["Angelica"],
      created_at: Temporal.Now.instant().epochMilliseconds,
      last_use_at: null,
      llm_config_id: "Roleplay"
  }, false, "IGNORE")

  await sync_chat_bubbies("First Chat", ["Ethan", "Angelica"])
  
    if (TEMP.backbone === "Neutralino") await db.exec_sql("PRAGMA user_version = 1")
    else localStorage.setItem("v", "1")
  }


  // Mount and select the first screen together, so hidden panels never flash during startup.
  q("main").replaceChildren(...await render())
  show_one_dom("Chats")
  
} catch (e) {
  const err = e as Error
  document.body.replaceChildren(
    tags.div(err.toString()),
    tags.div(err.stack),
    tags.div("If this error persists, please issue at github.com/alanuv7v/Bubble/issues.")
  )
  console.trace()
  console.log(err)
}
