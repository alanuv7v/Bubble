import { cr, q } from "./utils/gui.ts";
import { MesssageUI } from "./ui_components/MessageUI.ts";
import STATES from "./STATES.ts";
import { Chat, MessageMetadata, Bubby, History } from "./definitions.ts";
import fs from "../../old/ws_fs.ts";
import TEMP from "./TEMP.ts";
import { try_to_connect } from "./websocket/client.ts";

export async function get_history_ids() {
  const dir = await fs.get("dir", `/chats/${STATES.chat_id}/history`);
  return dir.map((o) => parseInt(o.name)).sort() as number[];
}

export async function get_last_history_id() {
  const ids = await get_history_ids();
  return ids[0];
}

export async function get_history(id: number) {
  return (await fs.get(
    "obj",
    `/chats/${STATES.chat_id}/history/${id}.yaml`
  )) as History;
}

export async function get_last_history() {
  const id = await get_last_history_id();
  return get_history(id);
}

export async function get_histories(max_msgs: number) {
  let count = 0;
  const hist_stack: History[] = [];
  const ids = (await get_history_ids()).toReversed();

  for (const id of ids) {
    const hist = await get_history(id);
    hist_stack.push(hist);
    count += hist.length;
    if (count >= max_msgs) break;
  }
  return hist_stack;
}

export async function send() {
  if (!STATES.chat_id) throw Error("Chat ID not specified");

  const listener_id = TEMP.chat.listener_id;
  const speaker_id = TEMP.chat.speaker_id;

  if (!listener_id) {
    throw Error(`STATES.send_config.target_char_id is not configured`);
  }
  if (!speaker_id) {
    throw Error(`STATES.send_config.persona_id is not configured`);
  }

  // GET DOM
  const prompt_c = q("prompt-c")! as HTMLDivElement;
  const prompt = prompt_c.innerText as string;

  // Make user msg
  const user_msg: MessageMetadata = {
    role: "user",
    content: prompt,
  };

  let user_msg_idx = -1;
  const last_id = await get_last_history_id();

  // Save user new msg
  await fs.set(
    "obj",
    `/chats/${STATES.chat_id}/history/${last_id}.yaml`,
    (hist: History) => {
      user_msg_idx = hist.length;
      return Array.isArray(hist) ? [...hist, user_msg] : [user_msg]
    }
  );

  prompt_c.innerHTML = ""; // Clean the input elem

  const user_ui = await MesssageUI(speaker_id, STATES.chat_id, last_id, user_msg_idx);
  const reply_ui = await MesssageUI(listener_id, STATES.chat_id, last_id, user_msg_idx + 1);

  user_ui.show_msg(prompt);

  // append user message elem & placeholder for char reply
  const box = q("interactions-c")!;
  box.append(user_ui.elem);
  box.append(reply_ui.elem);

  reply_ui.elem.scrollIntoView({ behavior: "smooth" });

  // ACTUALLY GENERATE THE TEXT
  await reply_ui.generate();

  /* 
  let req = await GEN_REQ.OpenRouter(
    to_char_id,
    STATES.chat_id,
    prompt
  )
  let response = await GEN_TEXT.OpenRouter(
    req
  );    */

  reply_ui.elem.scrollIntoView({ behavior: "smooth" });
}

export function text_gen_abort() {
  TEMP.text_gen_aborter.abort();
}

export async function connect_ws() {
  return try_to_connect();
}

export async function load_chat(chat_id: string) {
  const last_chat = await fs.get("obj", `/chats/${chat_id}/chat.yaml`) as Chat;
  if (!last_chat) return;

  /* 
    OPEN CHAT
  */

  const char_ids = last_chat["character ids"];

  const chars_map: Record<string, Bubby> = Object.fromEntries(
    await Promise.all(
      char_ids.map(async (id) => {
        const char = (await fs.get("obj", `/characters/${id}.yaml`)) as Bubby;
        return [id, char];
      })
    )
  );

  const chars = Object.entries(chars_map).map(([id, char]) => ({
    /* make them OnlineCharacter*/
    ...char,
    id,
    "online memory ids": [""],
  }));

  /* SEND CONFIG UI < ADD PERSONA & TARGET CHAR OPTIONS */

  const p = q("select.persona") as HTMLSelectElement;
  const t = q("select.target_char") as HTMLSelectElement;

  p.replaceChildren(
    p.firstElementChild!,
    ...chars.map((char) => cr("option", char.id))
  );
  t.replaceChildren(
    t.firstElementChild!,
    ...chars.map((char) => cr("option", char.id))
  );

  /* AUTO SELECT PERSONA */
  const persona_idx = last_chat.persona ?? 0;
  p.selectedIndex = persona_idx + 1;
  TEMP.chat.speaker_id = chars[persona_idx].id;

  /* AUTO SELECT TARGET CHAR */
  const target_idx = last_chat["default target"] ?? 1;
  t.selectedIndex = target_idx + 1;
  TEMP.chat.listener_id = chars[target_idx].id;

  /* SHOW MESSAGES */
  const history_ids = await get_history_ids();
  const elems: HTMLElement[] = [];

  for (let h_idx = 0; h_idx < history_ids.length; h_idx++) {
    const id = history_ids[h_idx];
    let raw_msgs = (await fs.get(
      "obj",
      `chats/${STATES.chat_id}/history/${id}.yaml`
    )) as History | {};

    if (!raw_msgs) continue;

    let msg_idx = 0;
    if (
      !Array.isArray(raw_msgs)
    ) {
      continue
    }
    let arr_msgs: History = raw_msgs
    let cleaned_up = false
    for (let i = arr_msgs.length; i > -1; i--) {
      let t = arr_msgs[i]
      if (t !== null) continue
      cleaned_up = true
      arr_msgs.splice(i, 1)
    }
    if (cleaned_up) {
      fs.set("obj", `chats/${STATES.chat_id}/history/${id}.yaml`, arr_msgs)
    }

    for (const msg of arr_msgs as History) {
      if (!msg) continue;

      const speaker =
        msg.speaker_id ||
        (msg.role === "assistant" ? char_ids[1] : char_ids[0]);
      const ui = await MesssageUI(speaker, chat_id, h_idx, msg_idx);
      await ui.pull();
      elems.push(ui.elem);
      msg_idx++;
    }
  }

  const container = q("interactions-c");
  if (!container) return;

  container.replaceChildren(...elems);
  container.lastChild?.scrollIntoView({ behavior: "smooth" });
}

export async function load_last_chat() {
  if (STATES.chat_id) await load_chat(STATES.chat_id);
}

export function load_last_state() {
  return fs.get("obj", "../");
}

export function show_log_in_page() {}

export function show_yaml_editor(path: string) {}

const actions = {
  get_histories,
  get_history_ids,
  get_last_history_id,
  get_history,
  get_last_history,
  send,
  text_gen_abort,
  connect_ws,
  load_chat,
  load_last_chat,
  load_last_state,
  show_log_in_page,
  show_yaml_editor,
};

export default actions;