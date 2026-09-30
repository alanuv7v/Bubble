import { show_one_dom } from "../face"
import t from "../tags"
import confirm_btn from "./confirm_btn"

export default async function render_list_item<T>(
  item: T,
  edit_item: (item: T) => any,
  render_item: (item: T) => HTMLElement | Promise<HTMLElement>,
  delete_item: (item: T) => Promise<unknown>
) {
  const row = t.div({ className: "item" })
  const content = await render_item(item)
  content.classList.add("content")

  const edit_button = t.button({
    innerText: "Edit",
    onclick: () => edit_item(item)
  })
  const delete_button = confirm_btn("X", () => {
    delete_button.disabled = true
    void Promise.resolve().then(() => delete_item(item)).then(() => {
      row.remove()
    }).catch((error) => {
      delete_button.disabled = false
      error_c.innerText = (error as Error).message || String(error)
    })
  })
  Object.assign(delete_button, {
    className: "delete",
    title: "Delete item"
  })
  delete_button.addEventListener("click", (event) => event.stopPropagation())
  const error_c = t.span({ className: "error", role: "status" })

  content.append(error_c, t.group_c({ className: "horizontal" }, edit_button, delete_button))
  row.append(content)
  return row
}
