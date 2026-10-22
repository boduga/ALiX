import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPositiveCases, validateOutputCap } from './positive-cases.mjs';

export function parsePositiveArgs(args) {
  const options = { scripted: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--scripted', '--output', '--output-cap'].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (seen.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--scripted') { options.scripted = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('-')) throw new Error(`${flag} requires ${flag === '--output' ? 'path' : 'positive integer'}`);
    if (flag === '--output') options.output = value;
    else {
      if (!/^[0-9]+$/.test(value)) throw new Error('--output-cap requires positive integer');
      options.outputCap = Number(value);
      validateOutputCap(options.outputCap);
    }
  }
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const { output, ...options } = parsePositiveArgs(args);
  const result = await runPositiveCases(options);
  const json = JSON.stringify(result, null, 2) + '\n';
  if (output) writeFileSync(resolve(output), json);
  else process.stdout.write(json);
  if (result.results.some(row => row.verdict !== 'pass' || row.error)) process.exitCode = 1;
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
