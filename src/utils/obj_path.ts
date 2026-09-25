export const get = (obj: any, path: string[]) => {
  if (path.length < 1) return obj
  return path.reduce((acc, key) => (
    typeof acc === "object" && acc !== null ? 
    acc[key] : undefined
  ), obj)
}

export const set = (obj: any, path: string[], value: any) => {
  const parent = path.slice(0, -1).reduce((acc, key) => acc[key], obj)
  if (parent) parent[path[path.length - 1]] = value
}
export default {
  get, set
}