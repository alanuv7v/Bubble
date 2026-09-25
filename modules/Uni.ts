import { cr } from "../src/utils/gui.ts"
import STATES from "../src/STATES.ts"
import { get_uni_seed } from "../../old/uni.ts"

export async function render () {
  return cr("uni-c", { spellcheck: false },
    ...(await get_uni_seed("dir", "dir", STATES.online_profile_path)).map(s => s.elem)
  )
}

export const config = {
  // whatever goes here
}