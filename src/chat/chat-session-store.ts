import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatSession, ChatMessage } from "./chat-types.js";

const SESSIONS_FILE = "sessions.jsonl";
const MESSAGES_FILE = "messages.jsonl";

function now(): string {
  return new Date().toISOString();
}

function dateKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sessionId(): string {
  return `chat:${dateKey()}-${Math.random().toString(36).slice(2, 8)}`;
}

function messageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface SessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

export class ChatSessionStore {
  constructor(private readonly storeDir: string) {}

  // ---------------------------------------------------------------------------
  // Session CRUD
  // ---------------------------------------------------------------------------

  async create(title?: string): Promise<ChatSession> {
    this.ensureDir();
    const id = sessionId();
    const ts = now();
    const session: ChatSession = {
      id,
      subject: title ?? `Chat ${id}`,
      outcome: "captured",
      confidence: 1,
      reasons: ["Session created"],
      generatedAt: ts,
      title,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.#writeSessionLine(session);
    return session;
  }

  /**
   * Create a session with a specific ID. Useful when the caller has
   * an existing session id from a flag or previous message.
   */
  async createSessionWithId(id: string, title?: string): Promise<ChatSession> {
    this.ensureDir();
    const ts = now();
    const session: ChatSession = {
      id,
      subject: title ?? `Chat ${id}`,
      outcome: "captured",
      confidence: 1,
      reasons: ["Session created"],
      generatedAt: ts,
      title,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.#writeSessionLine(session);
    return session;
  }

  /**
   * Load a session with its full message history.
   * Returns null if no session with the given id exists.
   */
  async load(id: string): Promise<SessionWithMessages | null> {
    const sessions = await this.listSessions();
    const session = sessions.find((s) => s.id === id);
    if (!session) return null;
    const messages = await this.getMessages(id);
    return { ...session, messages };
  }

  /**
   * List all session metadata (without message history).
   */
  async list(): Promise<ChatSession[]> {
    return this.listSessions();
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * Append a message to a session.
   * Session must already exist — call createSessionWithId first if needed.
   * Also writes a new session metadata line with advanced updatedAt
   * so the audit trail records when each message was added.
   */
  async appendMessage(sessionId: string, msg: ChatMessage): Promise<void> {
    this.ensureDir();
    // Assert session exists
    const existing = await this.listSessions().then((s) => s.find((s) => s.id === sessionId));
    if (!existing) {
      throw new Error(`Session ${sessionId} not found. Call createSessionWithId() first.`);
    }

    // Fill in defaults
    if (!msg.id) msg.id = messageId();
    if (!msg.createdAt) msg.createdAt = now();

    await appendFile(this.messagesPath(), JSON.stringify({ sessionId, message: msg }) + "\n", "utf-8");

    // Advance updatedAt by writing a new session metadata line
    const updated: ChatSession = { ...existing, updatedAt: now() };
    await this.#writeSessionLine(updated);
  }

  /**
   * Get all messages for a session, ordered by creation time.
   */
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!existsSync(this.messagesPath())) return [];
    const raw = await readFile(this.messagesPath(), "utf-8");
    const msgs: ChatMessage[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as { sessionId: string; message: ChatMessage };
        if (entry.sessionId === sessionId) {
          msgs.push(entry.message);
        }
      } catch {
        // skip corrupt line silently
      }
    }
    return msgs.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  async #writeSessionLine(session: ChatSession): Promise<void> {
    await appendFile(this.sessionsPath(), JSON.stringify(session) + "\n", "utf-8");
  }

  private async listSessions(): Promise<ChatSession[]> {
    if (!existsSync(this.sessionsPath())) return [];
    const raw = await readFile(this.sessionsPath(), "utf-8");
    const sessions: ChatSession[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        sessions.push(JSON.parse(trimmed) as ChatSession);
      } catch {
        console.warn(`ChatSessionStore: skipping corrupt session line: ${trimmed.slice(0, 80)}`);
      }
    }
    // Deduplicate by id — last write wins (append-only means older lines are stale)
    const seen = new Map<string, ChatSession>();
    for (const s of sessions) {
      seen.set(s.id, s);
    }
    return Array.from(seen.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private sessionsPath(): string {
    return join(this.storeDir, SESSIONS_FILE);
  }

  private messagesPath(): string {
    return join(this.storeDir, MESSAGES_FILE);
  }

  private ensureDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true, mode: 0o755 });
    }
  }
}
