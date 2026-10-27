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

export type Transcript = { lines: string[]; latest?: string; truncated?: boolean };

const AGENT_ID = /^a[0-9a-f]{16}$/;

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
  ) return { agent: identity, status: value.status, finalText: excerpt(value.finalText, 2000), endedAt: value.endedAt };
}

export function parseResultDetails(value: unknown): { status: AgentRecord["status"]; id: string } | undefined {
  if (!object(value) || typeof value.agentId !== "string" || !AGENT_ID.test(value.agentId)) return;
  if (value.status !== "running" && value.status !== "completed" && value.status !== "failed" && value.status !== "stopped") return;
  return { status: value.status, id: value.agentId.slice(0, 9) };
}

export function clean(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, " ").replace(/\s+/g, " ").trim();
}

function excerpt(text: string, limit: number): string {
  const safe = text.split(/\r?\n/).map(clean).join("\n");
  return safe.length > limit ? `${safe.slice(0, limit)}\n[excerpt truncated]` : safe;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => object(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function parseTranscript(tail: string): Transcript {
  const lines: string[] = [];
  let latest: string | undefined;
  for (const raw of tail.split("\n")) {
    let entry: unknown;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (!object(entry) || entry.type !== "message" || !object(entry.message)) continue;
    const message = entry.message;
    let label: string;
    let text: string;
    if (message.role === "assistant") {
      label = "assistant";
      const parts = Array.isArray(message.content) ? message.content : [];
      const tool = parts.find((part): part is Record<string, unknown> => object(part) && part.type === "toolCall" && typeof part.name === "string");
      text = tool ? `last tool: ${tool.name}` : contentText(parts);
    } else if (message.role === "toolResult") {
      label = "tool";
      text = contentText(message.content);
    } else if (message.role === "user") {
      label = "user";
      text = contentText(message.content);
    } else continue;
    text = excerpt(text, 1000);
    if (!text.trim()) continue;
    lines.push(`${label}  ${text}`);
    if (label !== "user") latest = clean(text).slice(0, 160);
  }
  return { lines: lines.slice(-40), latest };
}
