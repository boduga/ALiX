import { lookup } from "node:dns/promises";
import { validateNetworkHost, validateNetworkUrl } from "./web-fetch.js";

export type ResolveNetworkHost = (hostname: string) => Promise<string[]>;

const NETWORK_CLIENT_RE = /(?:^|[;&|]\s*|\b(?:sudo|env)\s+)(curl|wget|nc|ncat|netcat|telnet|ssh|scp|sftp|ping)\b/i;
const URL_RE = /https?:\/\/[^\s'"`;<>()]+/gi;
const PRIVATE_HOST_LITERAL_RE = /(?:^|[^\w.:-])(?:localhost(?:\.localhost)?|127(?:\.\d{1,3}){3}|169\.254(?:\.\d{1,3}){2}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|0\.0\.0\.0|\[?::1\]?)(?=$|[^\w.-])/i;

function shellTokens(command: string): string[] {
  return command.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];
}

function explicitClientHost(command: string, client: string): string | undefined {
  const tokens = shellTokens(command);
  const index = tokens.findIndex((token) => token.replace(/^.*[;&|]/, "") === client);
  if (index < 0) return undefined;
  const args = tokens.slice(index + 1).filter((token) => !token.startsWith("-"));
  if (client === "nc" || client === "ncat" || client === "netcat" || client === "telnet") return args[0];
  if (client === "ping" || client === "ssh") return args[0]?.replace(/^[^@]+@/, "");
  if (client === "scp" || client === "sftp") {
    const remote = args.find((arg) => arg.includes(":"));
    return remote?.split(":", 1)[0]?.replace(/^[^@]+@/, "");
  }
  return undefined;
}

/**
 * Apply the same explicit-destination policy to network-capable shell clients
 * as web_fetch. This is a command-boundary guard, not a general shell parser:
 * known network clients must expose a destination that can be validated.
 */
export async function validateShellNetworkCommand(
  command: string,
  allowDomains: string[] = [],
  resolveHost: ResolveNetworkHost = async (host) => (await lookup(host, { all: true, verbatim: true })).map(({ address }) => address),
): Promise<void> {
  if (PRIVATE_HOST_LITERAL_RE.test(command)) {
    throw new Error("Private network destinations are not allowed");
  }

  const urls = command.match(URL_RE) ?? [];
  for (const rawUrl of urls) await validateNetworkUrl(rawUrl, allowDomains, resolveHost);

  const clientMatch = command.match(NETWORK_CLIENT_RE);
  if (!clientMatch) return;
  const client = clientMatch[1]!.toLowerCase();

  if (client === "curl" || client === "wget") {
    if (urls.length === 0) throw new Error(`Network destination could not be validated for ${client}`);
    return;
  }

  const host = explicitClientHost(command, client);
  if (!host) throw new Error(`Network destination could not be validated for ${client}`);
  await validateNetworkHost(host.replace(/^\[|\]$/g, ""), allowDomains, resolveHost);
}
