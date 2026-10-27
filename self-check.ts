import { strict as assert } from "node:assert";
import { clean, parseRecord, parseResultDetails, parseTranscript } from "./model.ts";

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
const ended = parseRecord({ agent, status: "failed", endedAt: "2026-01-01T00:01:00Z", finalText: "error" });
assert.equal(ended?.status, "failed");
const multiline = parseRecord({ agent, status: "completed", endedAt: "now", finalText: "first\nsecond\u001b[0m" });
assert.equal(multiline?.status === "completed" && multiline.finalText, "first\nsecond [0m");

const json = (message: unknown) => JSON.stringify({ type: "message", message });
const transcript = parseTranscript([
  json({ role: "assistant", content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "Hello \u001b]0;hijack\u0007" }] }),
  json({ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "pwd" } }] }),
  json({ role: "toolResult", content: [{ type: "text", text: "done" }] }),
  "{incomplete",
].join("\n"));
assert.equal(transcript.lines.length, 3);
assert.equal(transcript.lines[1], "assistant  last tool: bash");
assert.equal(transcript.latest, "done");
const long = parseTranscript(json({ role: "toolResult", content: [{ type: "text", text: "first\n" + "x".repeat(1200) }] }));
assert.ok(long.lines[0]?.includes("first\n"));
assert.ok(long.lines[0]?.endsWith("[excerpt truncated]"));
assert.ok(!JSON.stringify(transcript).includes("secret"));
assert.ok(!JSON.stringify(transcript).includes("\u001b"));
assert.equal(clean("x\u001b[31my\u001b[0m"), "x [31my [0m");
console.log("pstack-panel self-check passed");
