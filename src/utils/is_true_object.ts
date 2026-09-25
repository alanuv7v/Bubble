export default function (obj: any) {
  return !!obj && typeof obj === "object" && !Array.isArray(obj)
}