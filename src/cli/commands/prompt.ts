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