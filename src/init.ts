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
import { nuke_db, nuke_opfs } from "./database.ts";
import { instantiate, LlmParams } from "./definitions.ts";
import { apply_visual } from "./visual.ts";
import { save_asset } from "./assets.ts";
import { log_view, report } from "./log";
import Irene_desc from "./defaults/Irene.ts"

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
  nuke_opfs,

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
  // Optional visuals must not stop the app from opening.
  try { await apply_visual() }
  catch (error) { report(error, "Could not apply theme", "warn") }

  if (TEMP.backbone === "Neutralino") {
    const version = await db.exec_sql<{ user_version: number }>("PRAGMA user_version")
    was_ever_initialized = version[0]?.user_version === 1 ? "1" : null
  } else {
    was_ever_initialized = localStorage.getItem("v")
  }

  if (was_ever_initialized !== "1") {
    // Stable UUIDs let an interrupted first launch retry these inserts.
    const seed_ids = {
      ethan: "a1dad2f9-66e3-4aaa-92d4-83bf4540dee2",
      irene: "4f534aa7-be13-45ea-b481-f388a1fd4dfd",
      roleplay: "893f610a-4f55-4fdb-be3c-8832fe41766c",
      chat: "9566393c-bbde-45c3-b9ce-0772a7ff295a"
    }

    await create_entry("bubbies", {
      id: seed_ids.ethan,
      name: "Ethan",
      desc: "",
      llm_config_id: null, 
      first_message: null
    }, false, "IGNORE")
  
    await create_entry("bubbies", {
      id: seed_ids.irene,
      name: "Irene",
      desc: Irene_desc,
      llm_config_id: null, 
      first_message: null
    }, false, "IGNORE")
  
    await create_entry("llm_configs", {
      id: seed_ids.roleplay,
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
              + "{{char.desc}}\n"
              + "# About {{user.name}}\n"
              + "{{user.desc}}"
            )
          }
        ]
      }
    }, false, "IGNORE")
  
    await create_entry("chats", {
        id: seed_ids.chat,
        name: "First Chat",
        speaker_id: seed_ids.ethan,
        listener_ids: [seed_ids.irene],
        created_at: Temporal.Now.instant().epochMilliseconds,
        last_use_at: null,
        llm_config_id: seed_ids.roleplay
    }, false, "IGNORE")

    await sync_chat_bubbies(seed_ids.chat, [seed_ids.ethan, seed_ids.irene])

    // Bundle default portraits, then store them like uploaded profile images.
    // Missing or broken portraits must not block chat startup.
    try {
      // A literal path lets Vite include the portrait in production builds.
      const profiles: [string, URL][] = [
        [seed_ids.irene, new URL("../assets/Irene.webp", import.meta.url)]
      ]
      for (const [id, url] of profiles) {
        const response = await fetch(url)
        if (!response.ok) continue
        await save_asset("", new File([await response.blob()], `${id}.webp`, { type: "image/webp" }))
      }
    } catch (error) {
      report(error, "Could not load default portraits", "warn")
    }
    if (TEMP.backbone === "Neutralino") await db.exec_sql("PRAGMA user_version = 1")
    else localStorage.setItem("v", "1")
  }


  // Mount and select the first screen together, so hidden panels never flash during startup.
  q("main").replaceChildren(...await render())
  show_one_dom("Chats")
  
} catch (e) {
  const message = report(e, "Startup failed")
  document.body.replaceChildren(
    tags.div({ textContent: message }),
    tags.div("If this error persists, please issue at github.com/alanuv7v/Bubble/issues."),
    log_view()
  )
}
