#!/usr/bin/env node
/**
 * Advisory DOX instruction-efficiency audit.
 * Finds identical and potentially overlapping long contract bullets only
 * along ancestor chains. Similarity never authorizes automatic deletion.
 * This complements check-dox-scope; it is not an ownership validator.
 */
import { readFileSync, readdirSync, lstatSync, existsSync, realpathSync } from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import { homedir } from "node:os";
import { effectiveInstruction, instructionNames, loadFallbackFilenames } from "./codex-instruction-files.mjs";

const argv = process.argv.slice(2);
let root = process.cwd(), config = join(homedir(), ".codex/config.toml"), json = false, threshold = 0.72;
for (let i=0;i<argv.length;i++) {
  if (argv[i] === "--root" && argv[i+1]) root = argv[++i];
  else if (argv[i] === "--config" && argv[i+1]) config = argv[++i];
  else if (argv[i] === "--threshold" && argv[i+1]) threshold = Number(argv[++i]);
  else if (argv[i] === "--json") json=true;
  else { console.error("usage: audit-dox-overlap.mjs [--root DIR] [--config FILE] [--threshold 0..1] [--json]");process.exit(2); }
}
if (!Number.isFinite(threshold) || threshold<=0 || threshold>1) {console.error("invalid threshold");process.exit(2);}
root=realpathSync(root);
if (!existsSync(join(root,"AGENTS.md"))) {console.error("missing root AGENTS.md");process.exit(2);}
let fallbackNames;
try { fallbackNames = loadFallbackFilenames(resolve(config)); }
catch (error) { console.error("invalid project_doc_fallback_filenames: " + error.message); process.exit(2); }
const relevantNames = new Set(instructionNames(fallbackNames));
const skip = new Set(["node_modules","dist",".git","coverage",".opensrc",".gitnexus",".alix"]);
const docs = [];
function walk(dir) {
  let hasInstruction = false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (relevantNames.has(entry.name) && (entry.isFile() || entry.isSymbolicLink()))
      hasInstruction = true;
    if (entry.isDirectory() && !skip.has(entry.name)) walk(full);
    // Directory symlinks are never traversed: the lexical ancestors would
    // misrepresent the effective instruction chain.
  }
  if (hasInstruction) {
    const file = effectiveInstruction(dir, fallbackNames);
    if (file) {
      // Advisory verdict cannot claim clean coverage over a linked instruction
      // file. Do not dereference a potentially external source.
      if (!lstatSync(file).isFile()) {
        console.error("unverified instruction source: " + relative(root, file));
        process.exit(2);
      }
      docs.push(file);
    }
  }
}
walk(root); docs.sort();
function tokenize(s) {
 return new Set((s.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g)||[])
  .filter(w=>!new Set(["must","should","when","with","from","that","this","only","never","which","their","there","file","files","agent","agents","contract","contracts"]).has(w)));
}
function bullets(file) {
 const lines=readFileSync(file,"utf8").split(/\r?\n/);
 const found=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(!/^\s*[-*] \*\*/.test(line))continue;
  const start=i+1;
  const parts=[line.trim()];
  // Continue wrapped Markdown text, but stop at a new list, heading, table,
  // thematic break, or blank paragraph. Do not conflate separate contracts.
  while(i+1<lines.length){
   const next=lines[i+1];
   if(!next.trim()||/^\s*(?:[-*+] |\d+[.)] |#{1,6} |\||>|---)/.test(next))break;
   if(!/^\s+\S/.test(next))break;
   parts.push(next.trim());i++;
  }
  const text=parts.join(" ");
  if(text.length>=100)found.push({line:start,text,tokens:tokenize(text)});
 }
 return found;
}
const lookup=new Map(docs.map(file=>[file,bullets(file)]));
const exact=[],possible=[];
for (const file of docs) {
 let ancestor=dirname(file);
 while(ancestor===root || ancestor.startsWith(root+sep)) {
  const other=effectiveInstruction(ancestor, fallbackNames);
  if(other!==file && lookup.has(other)) {
   for(const child of lookup.get(file)) for(const parent of lookup.get(other)) {
    const overlap=[...child.tokens].filter(t=>parent.tokens.has(t)).length;
    const similarity=overlap/Math.max(1,child.tokens.size+parent.tokens.size-overlap);
    const item={child:relative(root,file),childLine:child.line,parent:relative(root,other),parentLine:parent.line,similarity:Number(similarity.toFixed(3)),childBytes:Buffer.byteLength(child.text)};
    if(child.text===parent.text) exact.push(item);
    else if(similarity>=threshold && child.tokens.size>=12 && parent.tokens.size>=12) possible.push(item);
   }
  }
  if(ancestor===root) break;
  ancestor=dirname(ancestor);
 }
}
possible.sort((a,b)=>b.similarity-a.similarity);
const result={
 status:"advisory",filesScanned:docs.length,exactAncestorBullets:exact.length,
 potentialSemanticOverlaps:possible.length,threshold,
 exact,possible,
 note:"Possible overlaps are review candidates, not established duplication. No contract is deleted or rewritten by this audit."
};
if(json) console.log(JSON.stringify(result,null,2));
else {
 console.log(`DOX overlap audit: ${docs.length} files, ${exact.length} exact ancestor bullets, ${possible.length} possible semantic overlaps (threshold ${threshold})`);
 for(const x of possible.slice(0,15)) console.log(`  similarity ${x.similarity}: ${x.parent}:${x.parentLine} -> ${x.child}:${x.childLine}`);
 console.log(result.note);
}
