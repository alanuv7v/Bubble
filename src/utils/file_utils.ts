export const get_extension = (filename: string): string =>
  filename.includes(".") ? filename.split(".").pop()! : ""

export const get_pure_name = (filename: string): string =>
  filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename

export const is_text_file = (ext: string): boolean =>
  ["text", "txt", "yaml", "yml", "json"].includes(ext)

export const is_yaml_like = (ext: string): boolean =>
  ["yaml", "yml", "json"].includes(ext)

export const is_img = (ext: string): boolean =>
  ["jpg", "jpeg", "png", "webp"].includes(ext)

