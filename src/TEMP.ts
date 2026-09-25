import backbone from "./backbone"
import { Bubby, Chat, History, Id } from "./definitions"

const TEMP = {
  backbone: backbone() as ReturnType<typeof backbone>,
  windows: [] as any[],

  text_gen_aborter: new AbortController(),
  profile_dir_handle: null as null | FileSystemDirectoryHandle,
  
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

  involved_bubby_ids: [] as Id[],
  involved_bubbies: [] as Bubby[],
  history: [] as History,

  worker: null as null | Worker,
  db_pending: new Map<string, { 
    resolve: Function,
    reject: Function
  }>()

}

export default TEMP