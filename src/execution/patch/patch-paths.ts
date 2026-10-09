export function extractPatchPaths(format: string | undefined, patchTextValue: unknown): string[] {
  const patchText = typeof patchTextValue === "string" ? patchTextValue : "";
  const paths = new Set<string>();

  if (format === "structured_patch") {
    try {
      const parsed = JSON.parse(patchText) as { files?: Array<{ path?: unknown }> };
      for (const file of parsed.files ?? []) {
        if (typeof file.path === "string" && file.path.length > 0) paths.add(file.path);
      }
    } catch {
      // Invalid patches are rejected by the patch engine later. Scope extraction should not hide that error.
    }
  }

  for (const match of patchText.matchAll(/<<<<<<< SEARCH path=([^\s\n]+)/g)) {
    paths.add(match[1]);
  }

  for (const match of patchText.matchAll(/^[+-]{3} (?:[ab]\/)?(.+)$/gm)) {
    const path = match[1].trim();
    if (path && path !== "/dev/null") paths.add(path);
  }

  return [...paths];
}
