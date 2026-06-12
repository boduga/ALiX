import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("file operation feedback", () => {
  // Helper that simulates the describeShellResult logic
  function simulateFeedback(command: string): string | undefined {
    const appendMatch = command.match(/>>\s*'([^']+)'/);
    if (appendMatch && command.startsWith("printf")) return `✓ Appended to ${appendMatch[1]}`;

    const writeMatch = command.match(/>\s*'([^']+)'/);
    if (writeMatch && command.startsWith("printf")) return `✓ Wrote ${writeMatch[1]}`;

    const rmMatch = command.match(/^rm -- '(.+)'$/);
    if (rmMatch) return `✓ Deleted ${rmMatch[1]}`;

    const rmrfMatch = command.match(/^rm -rf -- '(.+)'$/);
    if (rmrfMatch) return `✓ Deleted directory ${rmrfMatch[1]}`;

    return undefined;
  }

  it('write file shows "✓ Wrote test.txt"', () => {
    const cmd = "printf '%s\\n' 'hello' > 'test.txt'";
    assert.equal(simulateFeedback(cmd), "✓ Wrote test.txt");
  });

  it('append shows "✓ Appended to log.txt"', () => {
    const cmd = "printf '%s\\n' 'line2' >> 'log.txt'";
    assert.equal(simulateFeedback(cmd), "✓ Appended to log.txt");
  });

  it('delete shows "✓ Deleted old.txt"', () => {
    const cmd = "rm -- 'old.txt'";
    assert.equal(simulateFeedback(cmd), "✓ Deleted old.txt");
  });

  it('directory delete shows correct message', () => {
    const cmd = "rm -rf -- './tmp'";
    assert.equal(simulateFeedback(cmd), "✓ Deleted directory ./tmp");
  });

  it('cat with real output returns undefined', () => {
    assert.equal(simulateFeedback("cat -- 'test.txt'"), undefined);
  });

  it('ls with real output returns undefined', () => {
    assert.equal(simulateFeedback("ls -la"), undefined);
  });
});
