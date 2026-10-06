import Neutralino from "@neutralinojs/lib"
import t from "./tags"
import { report } from "./log"

function control(name: string, action: () => Promise<unknown>) {
  return t.button({
    type: "button", innerText: name,
    onclick: () => { void action().catch((error) => report(error, name)) }
  })
}

// The top bar and Controls page share the same fullscreen behavior.
export function fullscreen_button() {
  const dom = control("<>", async () => {
    if (await Neutralino.window.isFullScreen()) {
      await Neutralino.window.exitFullScreen()
      return
    }
    await Neutralino.window.setFullScreen()
    dom.innerText = "><"
  })
  return dom
}

export async function show_inspector() {
  // Neutralino has no inspector API. Send the real WebView2 shortcut; JS key events cannot do this.
  await Neutralino.window.focus()
  const result = await Neutralino.os.execCommand(
    `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{F12}')"`
  )
  if (result.exitCode !== 0) throw new Error(result.stdErr || "Could not send the inspector shortcut")
}

export async function mount_window_bar() {
  if (window.NL_MODE !== "window") return
  const config = await Neutralino.app.getConfig()
  if (!config.modes?.window?.borderless) return

  const drag = t.div({ className: "drag", innerText: config.modes.window.title ?? "" })
  drag.style.cssText = "flex:1;padding:var(--space-sm);user-select:none"
  const bar = t.top_bar(
    drag,
    control("-", () => Neutralino.window.minimize()),
    fullscreen_button(),
    control("X", () => Neutralino.app.exit())
  )
  bar.style.cssText = "display: flex; flex-shrink: 0; min-height: 2lh; z-index: 999; overflow: clip; min-height: 5px;"

  // Reserve space above main rather than covering its content with a fixed bar.
  document.body.append(bar)

  // Only the empty/title area drags; the buttons remain ordinary clickable controls.
  let draggable = false
  async function update_drag() {
    const enabled = !await Neutralino.window.isMaximized()
    if (enabled === draggable) return
    if (enabled) await Neutralino.window.setDraggableRegion(drag)
    else await Neutralino.window.unsetDraggableRegion(drag)
    draggable = enabled
  }

  // Maximized windows stay put; restoring the window enables dragging again.
  for (const name of ["windowMaximize", "windowRestore"]) {
    await Neutralino.events.on(name, () => {
      void update_drag().catch((error) => report(error, "Update window dragging"))
    })
  }
  await update_drag()
}
