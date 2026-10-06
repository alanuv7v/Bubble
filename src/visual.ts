import TEMP from "./TEMP"
import t from "./tags"
import { get_asset, is_image } from "./assets"
import asset_picker from "./ui_modules/asset_picker"

let bg_url = ""
const user_stylesheet = t.style()
document.head.append(user_stylesheet)

export async function apply_visual() {
  const visual = TEMP.user_config.visual
  document.documentElement.className = visual.theme.join(" ")
  const file = visual.stylesheet && await get_asset(visual.stylesheet, "themes")
  user_stylesheet.textContent = file ? await file.text() : ""

  if (bg_url) URL.revokeObjectURL(bg_url)
  bg_url = ""
  document.body.style.backgroundImage = ""
  const background = visual.background && await get_asset(visual.background, "backgrounds")
  if (!background) return
  bg_url = URL.createObjectURL(background)
  document.body.style.backgroundImage = `url("${bg_url}")`
}

export function visual_controls(visual: typeof TEMP.user_config.visual) {
  const classes = t.input({ type: "text", value: visual.theme.join(" ") }) as HTMLInputElement

  classes.onchange = async () => {
    visual.theme = classes.value.trim().split(" ").filter(Boolean)
    classes.value = visual.theme.join(" ")
    await apply_visual()
  }

  return t.obj_c({ className: "visual" },
    t.pair_c(t.key_c("theme_classes"), classes),
    t.pair_c(asset_picker({
      title: "Stylesheet", folder: "themes", accept: ".css,text/css",
      selected: visual.stylesheet, empty_label: "default",
      show: (name) => name.toLowerCase().endsWith(".css"),
      on_select: async (_, name) => {
        visual.stylesheet = name
        await apply_visual()
      }
    })),
    t.pair_c(asset_picker({
      title: "Background", folder: "backgrounds", accept: "image/*",
      selected: visual.background, empty_label: "default",
      show: is_image,
      on_select: async (_, name) => {
        visual.background = name
        await apply_visual()
      }
    }))
  )
}
