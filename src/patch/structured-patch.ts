export type StructuredPatch = {
  version: 1;
  files: StructuredPatchFile[];
};

export type StructuredPatchFile = {
  path: string;
  operation: "create" | "modify" | "delete";
  preimageHash?: string;
  content?: string;
};

export function parseStructuredPatch(input: string): StructuredPatch {
  const parsed = JSON.parse(input) as StructuredPatch;
  if (parsed.version !== 1) throw new Error("Unsupported structured patch version");
  if (!Array.isArray(parsed.files)) throw new Error("Structured patch requires files");
  return parsed;
}
