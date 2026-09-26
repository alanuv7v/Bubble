import { GeneralRequestTemplate } from "./definitions.ts"
import TEMP from "./TEMP.ts"
import jju from "jju"
import { pipe, pipeLog } from "./utils/pipe.ts"


async function text_gen_common (sender: Function) {

  let done = false
  setTimeout(() => {
    if (!done) {
      throw Error("Failed to recieve response in 30s")
    }
  }, 30*1000);

  let res = await sender()
  done = true

  return res

}

export const GEN_TEXT = {

  async OpenRouter (
    template: GeneralRequestTemplate
  ): Promise<Response> {

    console.log("TEXT GENERATION", template)
    
    return text_gen_common(async () => {
      
      console.log("Waiting for the end of the AI response...");
      const signal = TEMP.text_gen_aborter.signal;
      
      let res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${template.api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(template.body),
        signal
      })
    
      return res
    })
  }
}

type TrueObject = Record<string, any>

export async function generate_json(
  req: GeneralRequestTemplate
): Promise<TrueObject> {

  req.body.stream = false

  const content = await pipeLog(
    req,
    GEN_TEXT.OpenRouter,
    no_stream_parse
  );
  let res = jju.parse(content);
  return res

}


export function noStreamEscape (input: string) {
  const 
    head_end = `"content":"`
  , start_foot = `","refusal":`
  , head_end_i = input.indexOf(head_end)
  , start_foot_i = input.indexOf(start_foot)
  , body_start_i = head_end_i < 0 ? 0 : (head_end_i + head_end.length)
  , body_end_i = start_foot_i < 0 ? input.length : start_foot_i
  , body = input.slice(body_start_i, body_end_i)
  , head = input.slice(0, body_start_i)
  , foot = input.slice(body_end_i)
  , res1 = head + encodeURI(body) + foot
  , res2 = res1.replaceAll(/u0005c/g, '\\')
  return res2
}

export function streamEscape (input: string) {
  const 
    head_end = `"content":"`
  , start_foot = `"},"finish_reason":`
  , head_end_i = input.indexOf(head_end)
  , start_foot_i = input.indexOf(start_foot)
  , body_start_i = head_end_i < 0 ? 0 : (head_end_i + head_end.length)
  , body_end_i = start_foot_i < 0 ? input.length : start_foot_i
  , body = input.slice(body_start_i, body_end_i)
  , head = input.slice(0, body_start_i)
  , foot = input.slice(body_end_i)
  , res1 = head + encodeURI(body) + foot
  , res2 = res1.replaceAll(/u0005c/g, '\\')
  return res2
}

async function process_sse_line(
  line: string,
  callback: (data: unknown) => Promise<void> | void
): Promise<boolean> {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return false

  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') return true

  try {
    const parsed = jju.parse(payload)
    await callback(parsed)
  } catch (e) {
    console.log(e)
  }

  return false
}

export async function stream_response_body(
  body: ReadableStream<Uint8Array>,
  callback: (data: unknown) => Promise<void> | void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (await process_sse_line(line, callback)) return
      }
    }

    buffer += decoder.decode()
    if (buffer) {
      await process_sse_line(buffer, callback)
    }
  } finally {
    reader.releaseLock()
  }
}

/* export async function stream_response_body(responseBody, callback: Function) {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  const stream = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
    },
  };
  
  async function handleLine (line) {
    if (line.startsWith('data:')) {
      const pure_data = line.slice(5).trim();
      if (pure_data === '[DONE]') return;
      try {
        const obj = jju.parse(pure_data)
        await callback(obj)
      } catch (e) {
        console.log(e)
      }
    }
  }
  for await (const chunk of stream) {
    for await (const line of chunk.split('\n')) {
      await handleLine(line)
    }
  }
}
 */

export async function no_stream_parse (response: Response) {
  return await pipe(
    await response.text(),
    t => jju.parse(t),
    (o) => o.choices[0].message.content,
  ) as string
}

window["text_gen"] = GEN_TEXT
window["stream_response_body"] = stream_response_body
window["jsonEscape"] = noStreamEscape