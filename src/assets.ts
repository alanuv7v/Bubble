import t from "./tags";
import TEMP from "./TEMP";
import { get_extension, get_pure_name } from "./utils/file_utils";
import { pipe } from "./utils/pipe";

export async function get_asset (name: string) {
  try {
    const file_handle = await TEMP.assets_dir_handle?.getFileHandle(name)
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


export function pick_and_save_image(
  name?: string,
  convert_into?: string,
  quality = 0.9
): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.oncancel = () => resolve(null);

    input.onchange = async () => {
      const raw_file = input.files?.[0];
      if (!raw_file) return resolve(null);

      const ext = convert_into ?? get_extension(raw_file.name) ?? "";
      const base = name ?? get_pure_name(raw_file.name)
      const filename = ext ? `${base}.${ext}` : base

      let blob: Blob = raw_file
      if (convert_into) {
        const converted = await convert_img(raw_file, convert_into, quality);
        if (!converted) return resolve(null);
        blob = converted;
      }

      const file = new File([blob], filename, { type: blob.type || `image/${ext}` });
      const root = TEMP.assets_dir_handle!;
      const handle = await root.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();

      await writable.write(file);
      await writable.close();

      resolve(file);
    };

    input.click();
  });
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