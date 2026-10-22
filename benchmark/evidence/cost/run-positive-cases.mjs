import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPositiveCases } from './positive-cases.mjs';

export async function main(args = process.argv.slice(2)) {
  const outputIndex = args.indexOf('--output');
  const output = outputIndex < 0 ? null : args[outputIndex + 1];
  if (outputIndex >= 0 && (!output || output.startsWith('--'))) throw new Error('--output requires path');
  if (args.some((arg, index) => arg !== '--scripted' && arg !== '--output' && !(outputIndex >= 0 && index === outputIndex + 1))) throw new Error('Usage: node run-positive-cases.mjs [--scripted] [--output path]');
  const result = await runPositiveCases({ scripted: args.includes('--scripted') });
  const json = JSON.stringify(result, null, 2) + '\n';
  if (output) writeFileSync(resolve(output), json);
  else process.stdout.write(json);
  if (result.results.some(row => row.verdict !== 'pass' || row.error)) process.exitCode = 1;
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
