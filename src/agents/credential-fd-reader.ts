/** Read the existing coordination-worker credential snapshot from a supplied FD.
 * Caller owns FD lifecycle. Never log or include values in errors.
 */
import { readFileSync } from 'node:fs';
export function readWorkerCredentialSnapshot(fd: number): Record<string,string> | undefined {
  if (!Number.isInteger(fd) || fd < 3) return undefined;
  const inherited: unknown = JSON.parse(readFileSync(fd, 'utf8'));
  if (!inherited || typeof inherited !== 'object' || Array.isArray(inherited)) return undefined;
  return Object.fromEntries(Object.entries(inherited).filter((entry): entry is [string,string] => typeof entry[1] === 'string'));
}
