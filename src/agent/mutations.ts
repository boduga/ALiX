import { extractPatchPaths } from "../patch/patch-paths.js";
import { validMutationPaths } from "../run/helpers.js";

export type MutationSessionState = {
  created: Set<string>;
  changed: Set<string>;
  deleted: Set<string>;
  fatalErrors: string[];
  pendingScopeExpansion: boolean;
};

export function extractMutationPaths(execName: string, args: Record<string, unknown>): string[] {
  if (execName === "patch.apply") {
    return extractPatchPaths(args.format as string | undefined, args.patchText);
  }
  const path = args.path;
  return typeof path === "string" && path.length > 0 ? [path] : [];
}

export function recordMutationInSessionState(
  state: MutationSessionState,
  execName: string,
  args: Record<string, unknown>
): void {
  const paths = validMutationPaths(execName, args);
  if (execName === "file.create") {
    for (const path of paths) state.created.add(path);
  }
  if (execName === "file.delete") {
    for (const path of paths) state.deleted.add(path);
  }
  if (execName === "file.write" || execName === "patch.apply") {
    for (const path of paths) state.changed.add(path);
  }
}