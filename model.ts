export type AgentIdentity = {
  id: string;
  description: string;
  sessionId: string;
  sessionDir: string;
  startedAt: string;
};

export type AgentRecord =
  | { agent: AgentIdentity; status: "running" }
  | { agent: AgentIdentity; status: "completed" | "failed" | "stopped"; finalText: string; endedAt: string };

export type TranscriptItem =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; args: Record<string, unknown>; result?: { text: string; isError: boolean } };
export type Transcript = { items: TranscriptItem[]; latest?: string; truncated?: boolean };

const AGENT_ID = /^a[0-9a-f]{16}$/;
const MESSAGE_LIMIT = 12000;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseRecord(value: unknown): AgentRecord | undefined {
  if (!object(value) || !object(value.agent)) return;
  const agent = value.agent;
  if (
    typeof agent.id !== "string" || !AGENT_ID.test(agent.id) ||
    typeof agent.description !== "string" || typeof agent.startedAt !== "string" ||
    typeof agent.sessionDir !== "string" || typeof agent.sessionId !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(agent.sessionId)
  ) return;
  const identity = {
    id: agent.id, description: clean(agent.description), sessionId: agent.sessionId,
    sessionDir: agent.sessionDir, startedAt: agent.startedAt,
  };
  if (value.status === "running") return { agent: identity, status: "running" };
  if (
    (value.status === "completed" || value.status === "failed" || value.status === "stopped") &&
    typeof value.finalText === "string" && typeof value.endedAt === "string"
  ) return { agent: identity, status: value.status, finalText: excerpt(value.finalText), endedAt: value.endedAt };
}

export function parseResultDetails(value: unknown): { status: AgentRecord["status"]; id: string } | undefined {
  if (!object(value) || typeof value.agentId !== "string" || !AGENT_ID.test(value.agentId)) return;
  if (value.status !== "running" && value.status !== "completed" && value.status !== "failed" && value.status !== "stopped") return;
  return { status: value.status, id: value.agentId.slice(0, 9) };
}

export function clean(text: string): string {
  return safeText(text).replace(/\s+/g, " ").trim();
}

export function safeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ")
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, " ");
}

function excerpt(text: string): string {
  const safe = safeText(text);
  return safe.length > MESSAGE_LIMIT ? `${safe.slice(0, MESSAGE_LIMIT)}\n[excerpt truncated]` : safe;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => object(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function safeArgs(value: unknown): Record<string, unknown> {
  if (!object(value)) return {};
  const sanitize = (input: unknown): unknown => {
    if (typeof input === "string") return excerpt(input);
    if (Array.isArray(input)) return input.map(sanitize);
    if (object(input)) return Object.fromEntries(Object.entries(input).map(([key, item]) => [safeText(key), sanitize(item)]));
    return input;
  };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [safeText(key), sanitize(item)]));
}

export function parseTranscript(tail: string): Transcript {
  const messages: Record<string, unknown>[] = [];
  for (const raw of tail.split("\n")) {
    let entry: unknown;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (object(entry) && entry.type === "message" && object(entry.message)) messages.push(entry.message);
  }
  const items: TranscriptItem[] = [];
  const calls = new Map<string, Extract<TranscriptItem, { kind: "tool" }>>();
  let latest: string | undefined;
  for (const message of messages.slice(-40)) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!object(part)) continue;
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
          const text = excerpt(part.text);
          items.push({ kind: "assistant", text });
          latest = clean(text).slice(0, 160);
        } else if (part.type === "toolCall" && typeof part.id === "string" && typeof part.name === "string") {
          const tool: Extract<TranscriptItem, { kind: "tool" }> = {
            kind: "tool", id: safeText(part.id), name: clean(part.name), args: safeArgs(part.arguments),
          };
          items.push(tool);
          calls.set(part.id, tool);
          latest = `tool: ${tool.name}`;
        }
      }
    } else if (message.role === "user") {
      const text = excerpt(contentText(message.content));
      if (text.trim()) items.push({ kind: "user", text });
    } else if (message.role === "toolResult") {
      const text = excerpt(contentText(message.content));
      const id = typeof message.toolCallId === "string" ? message.toolCallId : "";
      const name = typeof message.toolName === "string" ? clean(message.toolName) : "tool result";
      const result = { text, isError: message.isError === true };
      const call = calls.get(id);
      if (call) call.result = result;
      else items.push({ kind: "tool", id: safeText(id), name, args: {}, result });
      latest = clean(text).slice(0, 160) || `tool: ${name}`;
    }
  }
  return { items, latest, truncated: messages.length > 40 };
}
