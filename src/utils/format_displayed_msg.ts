import { marked } from "marked"
import DOMPurify from "dompurify"
import { pipeSync } from "./pipe.ts"
import TEMP from "../TEMP.ts";

/**
 * Splits text into an array of quotation and non-quotation parts.
 * Quotation parts are enclosed in double or single quotes, including curved quotation marks.
 * @param text The input text to split.
 * @returns string
 */
function handle_quotes(text: string): string {
  const regex_ = [
    /(\s|^)(["])((?:[^"]|\\")+?)(["])(?=\s|[.,!?;:]|$)/g,
    /(\s|^)(['])((?:[^']|\\')+?)(['])(?=\s|[.,!?;:]|$)/g,
    /(\s|^)([“])((?:[^”]|\\”)+?)([”])(?=\s|[.,!?;:]|$)/g,
    /(\s|^)([‘])((?:[^’]|\\’)+?)([’])(?=\s|[.,!?;:]|$)/g
  ];

  for (let regex of regex_) {
    text = text.replace(regex, (_, leadingSpace, openingQuote, content, closingQuote) => {
      // Ensure matching pairs for both straight and curved quotes
      const validPairs = {
        '"': '"',
        "'": "'",
        "“": "”",
        "‘": "’"
      };

      if (validPairs[openingQuote] === closingQuote) {
        return `${leadingSpace}<quote>${openingQuote}${content}${closingQuote}</quote>`;
      }

      return `${leadingSpace}${openingQuote}${content}${closingQuote}`; // Leave unmatched quotes as-is
    });
  }
  return text;
}

export default function (content: string) {
  return pipeSync(
    content,
    handle_quotes,
    (s) => TEMP.user_config.chat.safety.sanitize_message ? DOMPurify.sanitize(s) : s,
    (s) => TEMP.user_config.chat.visual.render_message_as_markdown ? marked.parse(s.replaceAll("<br>", "\n")) : s,
    s => s.replaceAll("\n", "<br>"),
  )
}

window["handle_quotes"] = handle_quotes
