import TEMP from "./TEMP"
import t from "./tags"
import yaml from "yaml"
import { get_asset, list_assets, save_asset } from "./assets"

let bg_url = ""
const user_theme = t.style()
document.head.append(user_theme)

export async function apply_theme() {
  const chosen_theme = TEMP.user_config.theme
  const file = chosen_theme.file && await get_asset(chosen_theme.file, "themes")
  if (file) user_theme.textContent = await file.text()
  else user_theme.textContent = ""

  if (bg_url) URL.revokeObjectURL(bg_url)
  const background = chosen_theme.background && await get_asset(chosen_theme.background, "backgrounds")
  if (!background) return
  bg_url = URL.createObjectURL(background)
  document.body.style.backgroundImage = `url("${bg_url}")`
}

export async function theme_controls() {
  const theme = t.select() as HTMLSelectElement
  const background = t.select() as HTMLSelectElement
  const css_input = t.input({ type: "file", accept: ".css,text/css", hidden: true }) as HTMLInputElement
  const image_input = t.input({ type: "file", accept: "image/*", hidden: true }) as HTMLInputElement

  async function refresh() {
    theme.replaceChildren(
      t.option({ innerText: "default" }),
      ...(await list_assets("themes")).map((name) => t.option({ innerText: name }))
    )
    background.replaceChildren(
      t.option({ innerText: "default" }),
      ...(await list_assets("backgrounds")).map((name) => t.option({ innerText: name }))
    )
    theme.value = TEMP.user_config.theme.file
    background.value = TEMP.user_config.theme.background
  }

  async function save() {
    const writer = await TEMP.user_config_handle!.createWritable()
    await writer.write(yaml.stringify(TEMP.user_config))
    await writer.close()
  }

  theme.onchange = async () => {
    TEMP.user_config.theme.file = theme.value
    await apply_theme()
    await save()
  }
  background.onchange = async () => {
    TEMP.user_config.theme.background = background.value
    await apply_theme()
    await save()
  }
  css_input.onchange = async () => {
    const file = css_input.files?.[0]
    if (!file) return
    await save_asset("themes", file)
    TEMP.user_config.theme.file = file.name
    css_input.value = ""
    await refresh()
    await apply_theme()
    await save()
  }
  image_input.onchange = async () => {
    const file = image_input.files?.[0]
    if (!file) return
    await save_asset("backgrounds", file)
    TEMP.user_config.theme.background = file.name
    image_input.value = ""
    await refresh()
    await apply_theme()
    await save()
  }

  await refresh()
  return t.theme_c(
    t.h2("Theme"),
    t.label("Theme", theme),
    t.button({ type: "button", innerText: "Upload CSS", onclick: () => css_input.click() }),
    t.label("Background", background),
    t.button({ type: "button", innerText: "Upload image", onclick: () => image_input.click() }),
    css_input,
    image_input
  )
}
