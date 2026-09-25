import { q } from "./utils/gui.ts";
import yaml from "yaml";
import STATES from "./STATES.ts";
import TEMP from "./TEMP.ts";
import tags from "./tags.ts";
import * as db from "./database.ts";

//------------------------------------------------------------

import { marked } from "marked";
import PATH from "path-browserify";
import * as llm from "./llm";
import { create_entries, create_entry, delete_entry, get_entry, query, update_entry } from "./chat.ts";
import { render } from "../modules/Chat.ts";
import { nuke_db } from "./database.ts";

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

Object.defineProperty(window, "STATES", {
  get() {
    return STATES;
  },
});

Object.defineProperty(window, "TEMP", {
  get() {
    return TEMP;
  },
});

console.log("%cWelcom to Bubble🫧", "color: skyblue");

await db.init()

q("main").append(
  ...(await render())
);