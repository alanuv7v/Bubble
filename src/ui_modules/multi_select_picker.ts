import t from "../tags"

type Option = { value: string, label: string }

let modal: HTMLDialogElement | undefined
let modal_close: HTMLButtonElement | undefined

function get_modal() {
  if (!modal) {
    modal = t.dialog({ id: "modal", tabIndex: -1 }) as HTMLDialogElement
    modal_close = t.button({
      type: "button",
      className: "close",
      innerText: "Close",
      onclick: () => modal?.close()
    }) as HTMLButtonElement
    document.body.append(modal)
  }
  return { modal, close: modal_close! }
}

export default function multi_select_picker(
  id: string,
  title: string,
  options: Option[] = [],
  selected: string[] = [],
  on_change?: (values: string[]) => void
) {
  const list = t.div({ className: "options" })
  const picker = t.div({ className: "multiselect" }, t.header(title), list)
  const open = () => {
    const { modal, close } = get_modal()
    modal.replaceChildren(close, picker)
    if (!modal.open) modal.showModal()
  }
  const button = t.button({
    type: "button",
    onclick: open
  })
  const root = t.div({ id }, button) as HTMLDivElement & {
    setOptions: (next_options: Option[], next_selected: string[]) => void
  }

  let current_options = options
  let current_selected = selected
  // Derive checkbox order from the available options to keep selections stable.
  const render = () => {
    button.innerText = `${title} (${current_selected.length})`
    list.replaceChildren(...current_options.map((option) => {
      const checkbox = t.input({
        type: "checkbox",
        value: option.value,
        checked: current_selected.includes(option.value),
        onchange: (event: Event) => {
          const input = event.currentTarget as HTMLInputElement
          current_selected = current_options.filter((item) =>
            item.value === input.value ? input.checked : current_selected.includes(item.value)
          ).map((item) => item.value)
          render()
          on_change?.([...current_selected])
        }
      })
      return t.label(checkbox, document.createTextNode(option.label))
    }))
  }

  root.setOptions = (next_options, next_selected) => {
    current_options = next_options
    current_selected = next_selected.filter((value) => next_options.some((option) => option.value === value))
    render()
  }
  render()
  return root
}
