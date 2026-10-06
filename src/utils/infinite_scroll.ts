// Insert prepared messages without moving the text the user is reading.
// Returns false when trimming would remove visible or focused messages.
export default function shift_messages(
  container: HTMLElement,
  incoming: HTMLElement[],
  direction: "older" | "newer",
  limit = 20
) {
  if (!incoming.length) return true
  if (limit < 1 || incoming.length > limit) return false

  const rows = Array.from(container.children)
  const bounds = container.getBoundingClientRect()
  const count = Math.max(0, rows.length + incoming.length - limit)
  const removed = direction === "older" ? rows.slice(rows.length - count) : rows.slice(0, count)

  // Only discard messages beyond the opposite edge of the viewport.
  if (removed.some((elem) => {
    const rect = elem.getBoundingClientRect()
    return elem.contains(document.activeElement) ||
      (direction === "older" ? rect.top < bounds.bottom : rect.bottom > bounds.top)
  })) return false

  const anchor = rows.find((elem) => {
    const rect = elem.getBoundingClientRect()
    return rect.bottom > bounds.top && rect.top < bounds.bottom
  })
  const top = anchor?.getBoundingClientRect().top

  for (const elem of removed) elem.remove()
  if (direction === "older") container.prepend(...incoming)
  else container.append(...incoming)

  // Insert, trim, and compensate synchronously so no intermediate layout is painted.
  // Do not animate this correction: the anchored message should stay still.
  if (anchor && top !== undefined) container.scrollTop += anchor.getBoundingClientRect().top - top
  return true
}
