import t from "../tags"

export default function confirm_btn(
  label: string,
  on_confirm: () => void,
  confirm_label = "Sure?"
) {
  let confirming = false
  const button = t.button({
    type: "button",
    innerText: label,
    onclick: () => {
      if (!confirming) {
        confirming = true
        button.innerText = confirm_label
        return
      }
      confirming = false
      button.innerText = label
      on_confirm()
    },
    onblur: () => {
      confirming = false
      button.innerText = label
    }
  }) as HTMLButtonElement
  return button
}
