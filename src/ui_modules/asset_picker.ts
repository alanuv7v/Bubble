import t from "../tags"
import { delete_asset, get_asset, is_image, list_assets, save_asset } from "../assets"
import confirm_btn from "./confirm_btn"

type Options = {
  title: string
  folder: string
  accept: string
  selected?: string
  empty_label?: string
  show?: (name: string) => boolean
  on_select: (file: File | null, name: string) => string | void | Promise<string | void>
  on_delete?: (name: string) => void | Promise<void>
}

export default function asset_picker(options: Options) {
  let selected = options.selected ?? ""
  const button = t.button({ type: "button" }) as HTMLButtonElement
  const files = t.div({ className: "files" })
  const status = t.span({ role: "status" })
  const input = t.input({ type: "file", accept: options.accept, hidden: true }) as HTMLInputElement
  const panel = t.section({ hidden: true },
    t.h3(options.folder || "Assets"),
    t.button({ type: "button", innerText: "Add", onclick: () => input.click() }),
    ...(options.empty_label ? [t.button({
      type: "button", innerText: options.empty_label,
      onclick: () => void choose(null, "")
    })] : []),
    files,
    status,
    input
  )

  function update_label() {
    button.innerText = `${options.title}: ${selected || options.empty_label || "Choose"}`
  }

  async function choose(file: File | null, name: string) {
    try {
      selected = await options.on_select(file, name) ?? name
      update_label()
      panel.hidden = true
      status.innerText = ""
    } catch (error) {
      status.innerText = String(error)
    }
  }

  async function refresh() {
    const names = (await list_assets(options.folder)).filter(options.show ?? (() => true))
    const rows = await Promise.all(names.map(async (name) => {
      const file = await get_asset(name, options.folder)
      if (!file) return
      const row = t.div({ className: "file" })
      if (is_image(name)) {
        const url = URL.createObjectURL(file)
        const preview = t.img({ src: url, alt: "" }) as HTMLImageElement
        preview.onload = preview.onerror = () => URL.revokeObjectURL(url)
        row.append(preview)
      }
      row.append(
        t.button({ type: "button", innerText: name, onclick: () => void choose(file, name) }),
        confirm_btn("Delete", () => void remove(name))
      )
      return row
    }))
    const visible_rows = rows.filter((row): row is HTMLElement => Boolean(row))
    files.replaceChildren(...visible_rows)
    if (!visible_rows.length) files.append(t.p("No files"))
  }

  async function remove(name: string) {
    try {
      await delete_asset(options.folder, name)
      if (name === selected) await choose(null, "")
      else await options.on_delete?.(name)
      await refresh()
    } catch (error) {
      status.innerText = String(error)
    }
  }

  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      await save_asset(options.folder, file)
      input.value = ""
      await refresh()
      await choose(file, file.name)
    } catch (error) {
      status.innerText = String(error)
    }
  }
  button.onclick = async () => {
    panel.hidden = !panel.hidden
    if (panel.hidden) return
    try { await refresh() }
    catch (error) { status.innerText = String(error) }
  }
  update_label()
  return t.asset_picker(button, panel)
}
