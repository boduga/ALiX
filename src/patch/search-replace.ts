export type SearchReplaceBlock = {
  path: string;
  search: string;
  replace: string;
};

const BLOCK_RE = /<<<<<<< SEARCH path=(.+?)\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

export function parseSearchReplace(input: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  for (const match of input.matchAll(BLOCK_RE)) {
    blocks.push({ path: match[1].trim(), search: match[2], replace: match[3] });
  }
  return blocks;
}

export function applySearchReplace(content: string, block: SearchReplaceBlock): string {
  const first = content.indexOf(block.search);
  if (first === -1) throw new Error(`Search block not found for ${block.path}`);
  const second = content.indexOf(block.search, first + block.search.length);
  if (second !== -1) throw new Error(`Search block is ambiguous for ${block.path}`);
  return content.slice(0, first) + block.replace + content.slice(first + block.search.length);
}
