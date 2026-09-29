type Option = { value: string, label: string }

export default function multi_select_picker(
  id: string,
  title: string,
  options: Option[] = [],
  selected: string[] = [],
  on_change?: (values: string[]) => void
) {
  const root = document.createElement("div") as HTMLDivElement & {
    setOptions: (next_options: Option[], next_selected: string[]) => void
  }
  root.className = "multi-select-picker"
  root.id = id
  const button = document.createElement("button")
  button.type = "button"
  button.className = "multi-select-picker-button"
  button.innerText = title
  const popup = document.createElement("div")
  popup.className = "multi-select-picker-popup"
  popup.hidden = true
  button.onclick = () => { popup.hidden = !popup.hidden }
  root.append(button, popup)

  let current_options = options
  let current_selected = selected
  const render = () => {
    button.innerText = `${title} (${current_selected.length})`
    popup.replaceChildren(...current_options.map((option) => {
      const label = document.createElement("label")
      const checkbox = document.createElement("input")
      checkbox.type = "checkbox"
      checkbox.value = option.value
      checkbox.checked = current_selected.includes(option.value)
      checkbox.onchange = () => {
        current_selected = current_options.filter((item) =>
          item.value === checkbox.value ? checkbox.checked : current_selected.includes(item.value)
        ).map((item) => item.value)
        render()
        on_change?.([...current_selected])
      }
      label.append(checkbox, document.createTextNode(option.label))
      return label
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
