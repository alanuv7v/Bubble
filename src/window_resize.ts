import Neutralino, { type WindowSizeOptions } from "@neutralinojs/lib"
import t from "./tags"
import { report } from "./log"

export async function enable_window_resize() {
  const config = await Neutralino.app.getConfig()
  const settings = config.modes?.window
  if (window.NL_OS !== "Windows" || window.NL_MODE !== "window") return
  if (!settings?.borderless || settings.resizable === false) return

  // Invisible strips INSIDE the window: no border, padding, or layout changes.
  const edges = t.resize_c()
  edges.style.cssText = "position: fixed; inset: 0; pointer-events: none; z-index: 900"
  let stop_drag = () => {}
  let busy = false

  async function show_edges() {
    const [fullscreen, maximized] = await Promise.all([
      Neutralino.window.isFullScreen(), Neutralino.window.isMaximized()
    ])
    edges.hidden = fullscreen || maximized
    if (edges.hidden) stop_drag()
  }

  // Directions: -1 changes the left/top edge; +1 changes right/bottom; 0 leaves it alone.
  function start_drag(event: PointerEvent, horizontal: number, vertical: number) {
    if (event.button !== 0 || event.pointerType !== "mouse" || edges.hidden || busy) return
    stop_drag()
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const listeners = new AbortController()
    let ended = false
    let pending: PointerEvent | undefined
    let size: WindowSizeOptions | undefined
    let position: { x: number, y: number }
    const scale = window.devicePixelRatio

    function stop() {
      ended = true
      listeners.abort()
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    }
    function cancel() { pending = undefined; stop() }
    stop_drag = cancel

    async function resize() {
      if (busy || !size) return
      busy = true
      try {
        // Keep only the latest pointer position while a native call is running.
        while (pending) {
          const pointer = pending
          pending = undefined
          // Windows positions use physical pixels. Sizes may use logical pixels.
          const size_scale = settings.useLogicalPixels ? 1 : scale
          const dx = pointer.screenX - event.screenX
          const dy = pointer.screenY - event.screenY
          const width = Math.round(Math.min(
            size.maxWidth! > 0 ? size.maxWidth! : Infinity,
            Math.max(size.minWidth! > 0 ? size.minWidth! : 1, size.width! + dx * horizontal * size_scale)
          ))
          const height = Math.round(Math.min(
            size.maxHeight! > 0 ? size.maxHeight! : Infinity,
            Math.max(size.minHeight! > 0 ? size.minHeight! : 1, size.height! + dy * vertical * size_scale)
          ))
          // resizable:true restores Windows' frame. JS handles provide resizing instead.
          // Carry the limits forward: setSize otherwise resets Neutralino's stored options.
          await Neutralino.window.setSize({ ...size, width, height, resizable: false })
          // Moving left/top must keep the opposite edge anchored, even at a size limit.
          if (horizontal < 0 || vertical < 0) {
            await Neutralino.window.move(
              Math.round(position.x + (horizontal < 0 ? (size.width! - width) * scale / size_scale : 0)),
              Math.round(position.y + (vertical < 0 ? (size.height! - height) * scale / size_scale : 0))
            )
          }
        }
      } catch (error) {
        cancel()
        report(error, "Resize window")
      } finally {
        busy = false
      }
    }

    const options = { signal: listeners.signal }
    handle.addEventListener("pointermove", (pointer) => {
      if (pointer.pointerId !== event.pointerId) return
      pending = pointer
      void resize()
    }, options)
    handle.addEventListener("pointerup", (pointer) => {
      if (pointer.pointerId !== event.pointerId) return
      pending = pointer
      void resize()
      stop()
    }, options)
    handle.addEventListener("pointercancel", cancel, options)
    handle.addEventListener("lostpointercapture", cancel, options)
    window.addEventListener("blur", cancel, options)

    // Capture before awaiting: releasing the mouse during these calls must still end the drag.
    void Promise.all([Neutralino.window.getSize(), Neutralino.window.getPosition()])
      .then(([initial_size, initial_position]) => {
        if (ended) return
        size = initial_size
        position = {
          x: initial_position.x ?? 0,
          y: initial_position.y ?? 0
        }
        void resize()
      }).catch((error) => { cancel(); report(error, "Start window resize") })
  }

  const strips: [string, number, number, string][] = [
    ["left", -1, 0, "left:0;top:12px;bottom:12px;width:6px;cursor:ew-resize"],
    ["right", 1, 0, "right:0;top:12px;bottom:12px;width:6px;cursor:ew-resize"],
    ["top", 0, -1, "top:0;left:12px;right:12px;height:6px;cursor:ns-resize"],
    ["bottom", 0, 1, "bottom:0;left:12px;right:12px;height:6px;cursor:ns-resize"],
    ["top-left", -1, -1, "top:0;left:0;width:12px;height:12px;cursor:nwse-resize"],
    ["top-right", 1, -1, "top:0;right:0;width:12px;height:12px;cursor:nesw-resize"],
    ["bottom-left", -1, 1, "bottom:0;left:0;width:12px;height:12px;cursor:nesw-resize"],
    ["bottom-right", 1, 1, "bottom:0;right:0;width:12px;height:12px;cursor:nwse-resize"]
  ]
  for (const [name, horizontal, vertical, layout] of strips) {
    const handle = t.div({ className: name })
    handle.style.cssText = `position:absolute;pointer-events:auto;touch-action:none;background:transparent;${layout}`
    handle.addEventListener("pointerdown", (event) => start_drag(event, horizontal, vertical))
    edges.append(handle)
  }
  await show_edges()
  for (const name of ["windowFullScreenEnter", "windowFullScreenExit", "windowMaximize", "windowRestore"]) {
    await Neutralino.events.on(name, () => {
      void show_edges().catch((error) => report(error, "Update window resize"))
    })
  }
  document.body.append(edges)
}
