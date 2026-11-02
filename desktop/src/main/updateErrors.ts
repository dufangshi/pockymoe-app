/** No published metadata for this platform: nothing to update to, which is not a failure to report as one. */
export function isNoDesktopRelease(message: string): boolean {
  return /latest(?:-mac|-linux)?\.yml|No published versions|HttpError: 404/i.test(message);
}
