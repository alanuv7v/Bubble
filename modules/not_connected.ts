import tags from "../src/tags.ts"

const {
  not_connected,
  h1,
  article,
  span,
  b
} = tags

export function render () {
  return not_connected({class: "pretty"},
    h1("Sorry, not connected to the filesystem backend:("),
    (() => {
      return article(
        span("Go to "), b("Start"), span(", choose your backend and try again.")
      )
    })()
  )
}

export const config = {}