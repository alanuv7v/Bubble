import t from "./tags"

const limit = 100
const entries: string[] = []
let panel: HTMLElement | undefined
let list: HTMLElement | undefined

// Store capped text, not Error objects or references to application data.
export function report(error: unknown, context = "", level: "error" | "warn" = "error") {
  const message = error && typeof error === "object" && "message" in error
    ? String(error.message) : String(error)
  const summary = (context ? `${context}: ${message}` : message).slice(0, 1000)
  const details = error instanceof Error ? error.stack ?? message : message
  const text = `[${new Date().toLocaleTimeString()}] ${level}: ${summary}\n${details}`.slice(0, 8000)
  entries.push(text)
  if (entries.length > limit) entries.shift()
  if (list) {
    list.append(t.pre({ textContent: text, className: level }))
    if (list.childElementCount > limit) list.firstElementChild?.remove()
  }
  console[level](text)
  return summary
}

export function log_view() {
  if (panel) return panel
  list = t.div({ className: "content" }, ...entries.map((text) => t.pre({ textContent: text })))
  panel = t.logs_c(
    t.h2({ innerText: `Logs (last ${limit})` }),
    t.button({
      type: "button", innerText: "Clear",
      onclick: () => { entries.length = 0; list!.replaceChildren() }
    }),
    list
  )
  return panel
}

// Caught failures report at their recovery point; these cover uncaught failures.
window.addEventListener("error", (event) => report(event.error ?? event.message, "Uncaught error"))
window.addEventListener("unhandledrejection", (event) => report(event.reason, "Unhandled rejection"))
