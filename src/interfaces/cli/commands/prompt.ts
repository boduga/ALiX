/**
 * Interactive prompt helpers for CLI commands.
 */

import { createInterface } from "node:readline";

/**
 * Prompts the user with a question and returns their trimmed input.
 */
export async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompts the user with a yes/no question and returns a boolean.
 * Accepts 'y', 'yes' (case-insensitive) as yes; anything else is no.
 * If input is empty and defaultYes is true, returns true.
 */
export async function yesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n]: " : " [y/N]: ";
  const answer = await prompt(question + suffix);
  if (!answer) return defaultYes;
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

/**
 * Prompts the user with a question and returns their input with each
 * character echoed as `*` (or nothing, if the terminal is not a TTY).
 * Use for secret values (API keys, tokens) where the default `prompt()`
 * would echo the secret to the terminal scrollback.
 *
 * If stdin is not a TTY (piped input, CI, agent context), this falls
 * back to the regular `prompt()` — the caller is expected to be the
 * only path that supplies the secret in non-interactive contexts.
 */
export async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return prompt(question);
  }
  return new Promise<string>((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\n" || c === "\r" || c === "\x04") {
          stdin.removeListener("data", onData);
          stdin.pause();
          if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (c === "\x03") {
          // Ctrl-C: abort without saving.
          process.stdout.write("\n");
          process.exit(130);
        }
        if (c === "\x7f" || c === "\b") {
          // Backspace: drop last char.
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += c;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}