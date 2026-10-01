import t from "./tags";
import TEMP from "./TEMP";
import Neutralino from "@neutralinojs/lib";
import { data_path } from "./native_db";

function native_asset_path(folder: string, name = "") {
  for (const part of [folder, name]) {
    if (part === "." || part === ".." || part.includes("/") || part.includes("\\"))
      throw new Error("Invalid asset name")
  }
  return `${data_path()}/assets${folder ? "/" + folder : ""}${name ? "/" + name : ""}`
}

function file_type(name: string) {
  const ext = name.split(".").pop()?.toLowerCase()
  return ({
    avif: "image/avif", bmp: "image/bmp", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", svg: "image/svg+xml", webp: "image/webp", css: "text/css"
  } as Record<string, string>)[ext ?? ""] ?? ""
}

export async function get_asset (name: string, folder?: string) {
  try {
    if (TEMP.backbone === "Neutralino") {
      const bytes = await Neutralino.filesystem.readBinaryFile(native_asset_path(folder ?? "", name))
      return new File([bytes], name, { type: file_type(name) })
    }
    const root = TEMP.assets_dir_handle
    const dir = folder ? await root?.getDirectoryHandle(folder, { create: true }) : root
    const file_handle = await dir?.getFileHandle(name)
    return await file_handle?.getFile()
  }
  catch (e) {
    console.log(e)
    console.trace()
    return
  }
}

export async function get_img_src (name: string, fallback = "") {
  try {
    const file = await get_asset(name)
    if (!file) return fallback
    return URL.createObjectURL(file)
  }
  catch (e) {
    console.log(e)
    console.trace()
    return ""
  }
}

async function convert_img(file: File|Blob, into: string, quality = 0.9): Promise<Blob|null> {
  if (!file) return null;

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    return canvas.convertToBlob({ type: 'image/' + into, quality });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return null;
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/' + into, quality);
  });
}


export async function save_profile_image(file: File, id: string) {
  const image = await convert_img(file, "webp")
  if (!image) throw new Error("Could not read profile image")
  await save_asset("", new File([image], `${id}.webp`, { type: "image/webp" }))
}

export function is_image(name: string) {
  return [".avif", ".bmp", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"]
    .some((ext) => name.toLowerCase().endsWith(ext))
}

export function safe_img(name: string, fallback = "") {
  return t.picture(
    t.source({srcset: `${name}.webp`}),
    t.source({srcset: `${name}.jpg`}),
    t.source({srcset: `${name}.jpeg`}),
    t.source({srcset: `${name}.png`}),
    t.source({srcset: `${name}.gif`}),
    t.source({srcset: `${fallback}`}),
  )
}

async function asset_dir(folder: string) {
  const root = TEMP.assets_dir_handle
  if (!root) throw new Error("Assets directory is not initialized")
  return folder ? root.getDirectoryHandle(folder, { create: true }) : root
}

export async function list_assets(folder: string) {
  if (TEMP.backbone === "Neutralino") {
    const path = native_asset_path(folder)
    await Neutralino.filesystem.createDirectory(path)
    const entries = await Neutralino.filesystem.readDirectory(path)
    return entries.filter((item) => item.type === "FILE")
      .map((item) => item.entry).sort((a, b) => a.localeCompare(b))
  }
  const dir = await asset_dir(folder)
  const names: string[] = []
  for await (const handle of dir.values()) {
    if (handle.kind === "file") names.push(handle.name)
  }
  return names.sort((a, b) => a.localeCompare(b))
}

export async function save_asset(folder: string, file: File) {
  if (TEMP.backbone === "Neutralino") {
    await Neutralino.filesystem.createDirectory(native_asset_path(folder))
    await Neutralino.filesystem.writeBinaryFile(native_asset_path(folder, file.name), await file.arrayBuffer())
    return
  }
  const dir = await asset_dir(folder)
  const handle = await dir.getFileHandle(file.name, { create: true })
  const writer = await handle.createWritable()
  await writer.write(file)
  await writer.close()
}

export async function delete_asset(folder: string, name: string) {
  if (TEMP.backbone === "Neutralino") {
    await Neutralino.filesystem.remove(native_asset_path(folder, name))
    return
  }
  await (await asset_dir(folder)).removeEntry(name)
}

export async function rename_asset(old_name: string, new_name: string): Promise<() => Promise<void>> {
  if (old_name === new_name) return async () => {}
  if (TEMP.backbone === "Neutralino") {
    const old_path = native_asset_path("", old_name)
    const new_path = native_asset_path("", new_name)
    try { await Neutralino.filesystem.getStats(old_path) }
    catch (error) {
      if ((error as any).code === "NE_FS_NOPATHE") return async () => {}
      throw error
    }
    try {
      await Neutralino.filesystem.getStats(new_path)
      throw new Error(`An asset named ${new_name} already exists`)
    } catch (error) {
      if ((error as any).code !== "NE_FS_NOPATHE") throw error
    }
    await Neutralino.filesystem.move(old_path, new_path)
    return () => Neutralino.filesystem.move(new_path, old_path)
  }
  const root = TEMP.assets_dir_handle
  if (!root) throw new Error("Assets directory is not initialized")

  let source: FileSystemFileHandle
  try {
    source = await root.getFileHandle(old_name)
  } catch (error) {
    if ((error as DOMException).name === "NotFoundError") return async () => {}
    throw error
  }

  // Avoid replacing an image that already belongs to the destination ID.
  try {
    await root.getFileHandle(new_name)
    throw new Error(`An asset named ${new_name} already exists`)
  } catch (error) {
    if ((error as DOMException).name !== "NotFoundError") throw error
  }

  const file = await source.getFile()
  const destination = await root.getFileHandle(new_name, { create: true })
  try {
    const writable = await destination.createWritable()
    await writable.write(file)
    await writable.close()
    await root.removeEntry(old_name)
  } catch (error) {
    await root.removeEntry(new_name).catch(() => {})
    throw error
  }

  // Keep the old file recoverable until the caller's database update succeeds.
  return async () => {
    const restored = await root.getFileHandle(old_name, { create: true })
    const writable = await restored.createWritable()
    await writable.write(file)
    await writable.close()
    await root.removeEntry(new_name)
  }
}
