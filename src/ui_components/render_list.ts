import t from "../tags"
import confirm_btn from "./confirm_btn"

export default async function render_list<T>(
  container: HTMLElement,
  items: T[],
  render_item: (item: T) => HTMLElement | Promise<HTMLElement>,
  delete_item: (item: T) => Promise<unknown>
) {
  const rendered_items = await Promise.all(items.map(async (item) => {
    const row = t.div({ className: "item" })
    const content = await render_item(item)
    content.classList.add("content")

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
    row.append(content, delete_button, error_c)
    return row
  }))

  container.replaceChildren(...rendered_items)
}
