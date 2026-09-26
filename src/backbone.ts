export default function () {
  // Detect Neutralino (injected globally by the native wrapper at startup)
  if ("NL_MODE" in window) {
    return "Neutralino"
  }
  // Detect Chrome/Edge Native Disk Access (FileSystem Access API)
  // ...This is discarded in favor of OPFS.
  /* if ('showOpenFilePicker' in window) {
    return "FileSystemAPI"
  } */
  // Detect OPFS Support (Modern Browser Private Storage)
  if (
    'navigator' in window && 
    'storage' in navigator && 
    'getDirectory' in navigator.storage
  ) {
    return "OPFS"
  }
  return "Simple"
}