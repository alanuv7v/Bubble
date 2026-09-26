import backbone from "./backbone"
import { Bubby, Chat, History, Id } from "./definitions"
import user_config from "./user_config"

const TEMP = {
  backbone: backbone() as ReturnType<typeof backbone>,
  text_gen_aborter: new AbortController(),

  opfs_root_handle: null as null | FileSystemDirectoryHandle,
  user_config_handle: null as null | FileSystemFileHandle,
  assets_dir_handle: null as null | FileSystemDirectoryHandle,
  
  chat: {
    id: undefined,
    bubby_ids: [],
    library_ids: [],
    speaker_id: undefined,
    listener_id: undefined,
    last_use_at: undefined,
    llm_config_id: undefined,
  } as Partial<Chat>,

  edited_bubby_id: null as string|null,
  edited_llm_config_id: null as string|null,
  edited_prompt_id: null as string|null,

  involved_bubby_ids: [] as Id[],
  involved_bubbies: [] as Bubby[],
  history: [] as History,

  worker: null as null | Worker,
  db_pending: new Map<string, { 
    resolve: Function,
    reject: Function
  }>(),

  user_config: user_config as typeof user_config

}

export default TEMP