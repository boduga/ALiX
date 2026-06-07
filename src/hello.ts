/**
 * Simple hello utility to verify environment setup and communication.
 */
export function getHelloMessage(): string {
  const nodeVersion = process.version;
  const platform = process.platform;
  const arch = process.arch;
  return `Hello from ALiX! System status: Operational (Node: ${nodeVersion}, Platform: ${platform}, Arch: ${arch})`;
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(getHelloMessage());
}
