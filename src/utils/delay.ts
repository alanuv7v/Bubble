export function delay (ms: number) {
  return new Promise((res, reject) => {
    setTimeout(res, ms)
  })
}