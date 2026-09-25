import { cr } from "../utils/gui"

cr

type ButtonArgs = [
  name: string, 
  onclick?: (e: MouseEvent) => any, 
  icon_name?: string
]
export function button (...args: ButtonArgs) {
  let [name, onclick, icon_name] = args
  let b = cr("button", {
    innerText: name,
    onclick
  }) as HTMLButtonElement
  b.prepend(cr("img", {
    src: `./icons/${icon_name}.svg`
  }))
  return b
}

export function bulk_buttons (...args: ButtonArgs[]) {
  
}

/* 
번역 기능 등 넣기
*/