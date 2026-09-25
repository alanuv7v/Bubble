export async function pipe(first: Function | any, ...funcs: Function[]) {
  let lastRes = first === "function" ? await first() : first
  for await (let func of funcs) {
    lastRes = await func(lastRes)
  }
  return lastRes
}

export function pipeSync(first: Function | any, ...funcs: Function[]) {
  let lastRes = typeof(first) === "function" ? first() : first
  for (let func of funcs) {
    lastRes = func(lastRes)
  }
  return lastRes
}

export async function pipeLog(first: Function | any, ...funcs: Function[]) {
  let i = 0
  let lastRes = typeof(first) === "function" ? await first() : first
  console.log(i, first?.name || first, lastRes)
  for await (let func of funcs) {
    i++
    lastRes = await func(lastRes)
    console.log(i, lastRes)
  }
  console.trace()
  return lastRes
}


export function pipeSyncLog(first: Function | any, ...funcs: Function[]) {
  let i = 0
  let lastRes = typeof(first) === "function" ? first() : first
  console.log(i, lastRes)
  for (let func of funcs) {
    i++
    lastRes = func(lastRes)
    console.log(i, lastRes)
  }
  console.trace()
  return lastRes
}
