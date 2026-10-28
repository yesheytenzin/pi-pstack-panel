import { strict as assert } from "node:assert";
import { clean, parseRecord, parseResultDetails, parseTranscript, safeText } from "./model.ts";

const agent = {
  id: "a0123456789abcdef", description: "Try \u001b[31mred", sessionId: "abcd-1234",
  sessionDir: "/tmp/agents", startedAt: "2026-01-01T00:00:00Z",
};
assert.deepEqual(parseResultDetails({ agentId: agent.id, status: "running" }), { id: agent.id.slice(0, 9), status: "running" });
assert.equal(parseResultDetails({ agentId: agent.id, status: "\u001b[2J" }), undefined);
assert.equal(parseResultDetails({ agentId: "\u001b[2J", status: "completed" }), undefined);
const running = parseRecord({ agent, status: "running", parentPid: 123 });
assert.equal(running?.status, "running");
assert.equal(running?.agent.description, "Try [31mred");
assert.equal(parseRecord({ agent, status: "running", finalText: "ignored" })?.status, "running");
assert.equal(parseRecord({ agent: { ...agent, id: "bad" }, status: "running" }), undefined);
assert.equal(parseRecord({ agent, status: "completed" }), undefined);
const multiline = parseRecord({ agent, status: "completed", endedAt: "now", finalText: "first\n    second\u001b[0m" });
assert.equal(multiline?.status === "completed" && multiline.finalText, "first\n    second [0m");

const json = (message: unknown) => JSON.stringify({ type: "message", message });
const transcript = parseTranscript([
  json({ role: "user", content: [{ type: "text", text: "Show code" }] }),
  json({ role: "assistant", content: [
    { type: "thinking", thinking: "secret" },
    { type: "text", text: "Intro\n```ts\n    const x = 1;\n```\n\u001b]0;hijack\u0007" },
    { type: "toolCall", id: "call1", name: "read", arguments: { path: "\u001b[31m/tmp/a", nested: ["a\u001b[0m"] } },
    { type: "text", text: "Between calls" },
    { type: "toolCall", id: "call2", name: "bash", arguments: { command: "pwd" } },
    { type: "text", text: "After calls" },
  ] }),
  json({ role: "toolResult", toolCallId: "call2", toolName: "bash", content: [{ type: "text", text: "pwd output" }], isError: false }),
  json({ role: "toolResult", toolCallId: "call1", toolName: "read", content: [{ type: "text", text: "file output" }], isError: true }),
  "{incomplete",
].join("\n"));
assert.equal(transcript.items.length, 6);
assert.deepEqual(transcript.items.map((item) => item.kind), ["user", "assistant", "tool", "assistant", "tool", "assistant"]);
assert.equal(transcript.items[1]?.kind === "assistant" && transcript.items[1].text.includes("\n    const x = 1;\n```"), true);
assert.equal(transcript.items[2]?.kind === "tool" && transcript.items[2].result?.text, "file output");
assert.equal(transcript.items[2]?.kind === "tool" && transcript.items[2].result?.isError, true);
assert.equal(transcript.items[4]?.kind === "tool" && transcript.items[4].result?.text, "pwd output");
assert.equal(transcript.items[5]?.kind === "assistant" && transcript.items[5].text, "After calls");
assert.equal(transcript.latest, "file output");
assert.ok(!JSON.stringify(transcript).includes("secret"));
assert.ok(!JSON.stringify(transcript).includes("\u001b"));
const orphan = parseTranscript(json({ role: "toolResult", toolCallId: "old", toolName: "read", content: [{ type: "text", text: "older result" }], isError: false }));
assert.equal(orphan.items[0]?.kind === "tool" && orphan.items[0].result?.text, "older result");
const bounded = parseTranscript(Array.from({ length: 42 }, (_, i) => json({ role: "user", content: `message ${i}` })).join("\n"));
assert.equal(bounded.items.length, 40);
assert.equal(bounded.truncated, true);
const long = parseTranscript(json({ role: "assistant", content: [{ type: "text", text: "first\n" + "x".repeat(13000) }] }));
assert.ok(long.items[0]?.kind === "assistant" && long.items[0].text.endsWith("[excerpt truncated]"));
assert.ok(parseRecord({ agent, status: "completed", endedAt: "now", finalText: "x".repeat(13000) })?.status === "completed");
assert.equal(safeText("```\n  a\t= 1\n```"), "```\n  a    = 1\n```");
assert.equal(clean("x\u001b[31my\u001b[0m"), "x [31my [0m");
console.log("pstack-panel self-check passed");
