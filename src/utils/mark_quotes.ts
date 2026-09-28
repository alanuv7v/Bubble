type QuoteType = { close: string; className: string }

const quote_types: Record<string, QuoteType> = {
  "'": { close: "'", className: "single" },
  '"': { close: '"', className: "double" },
  [String.fromCharCode(0x2018)]: {
    close: String.fromCharCode(0x2019),
    className: "single curly",
  },
  [String.fromCharCode(0x201c)]: {
    close: String.fromCharCode(0x201d),
    className: "double curly",
  },
  "`": { close: "`", className: "backtick" },
}

/** Marks complete and still-open quotations, so streamed text can be styled. */
export default function mark_quotes(text: string): string {
  const stack: QuoteType[] = []
  let result = ""
  let backslash_count = 0

  const is_word = (char: string | undefined) =>
    char !== undefined && (
      char.toLocaleLowerCase() !== char.toLocaleUpperCase()
      || (char >= "0" && char <= "9")
    )

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char.charCodeAt(0) === 92) {
      result += char
      backslash_count++
      continue
    }

    const escaped = backslash_count % 2 === 1
    backslash_count = 0
    const apostrophe = char === "'" && is_word(text[i - 1]) && is_word(text[i + 1])
    if (escaped || apostrophe) {
      result += char
      continue
    }

    const active = stack.at(-1)
    if (active?.close === char) {
      result += `</span>${char}`
      stack.pop()
      continue
    }

    const type = quote_types[char]
    if (!type) {
      result += char
      continue
    }

    stack.push(type)
    result += `<span class="quote ${type.className}">${char}`
  }

  while (stack.length > 0) {
    result += "</span>"
    stack.pop()
  }
  return result
}
