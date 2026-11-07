/** Cooperative startup gate for GE-04 qualification. Not a security boundary. */
import { readFileSync } from 'node:fs';
export function awaitSupervisorStartupRelease(fd:number):void {
  if (!Number.isSafeInteger(fd) || fd !== 4) throw new Error('Invalid worker startup descriptor');
  // A bounded blocking read: the parent sends a single exact release marker.
  // Pipe EOF or a malformed marker is always denied.
  const bytes=readFileSync(fd);
  const expectedMarker = 'GE04_READY\n';
  if (bytes.length !== Buffer.byteLength(expectedMarker, 'utf8') || bytes.toString('utf8') !== expectedMarker)
    throw new Error('Worker startup release denied');
}
