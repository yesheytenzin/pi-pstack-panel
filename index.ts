import { open, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { clean, parseRecord, parseResultDetails, parseTranscript, type AgentRecord, type Transcript } from "./model.ts";

type Viewer = { kind: "opening" } | { kind: "open"; close: () => void };
type Viewport = { kind: "follow" } | { kind: "paused"; excerpts: string[]; offset: number };

const WIDGET = "pstack-panel";
const TAIL_BYTES = 128 * 1024;
const INTERVAL_MS = 1200;
const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");

async function transcriptOf(record: AgentRecord, expectedDir: string): Promise<Transcript | undefined> {
  if (resolve(record.agent.sessionDir) !== resolve(expectedDir)) return;
  let names: string[];
  try { names = await readdir(expectedDir); } catch { return; }
  const name = names.find((n) => n.endsWith(`_${record.agent.sessionId}.jsonl`));
  if (!name) return;
  let file;
  try {
    file = await open(join(expectedDir, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    const size = (await file.stat()).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const bytes = Buffer.alloc(Math.min(size, TAIL_BYTES));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, start);
    let text = bytes.subarray(0, bytesRead).toString("utf8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    return { ...parseTranscript(text), truncated: start > 0 };
  } catch { return; }
  finally { await file?.close().catch(() => {}); }
}

export default function pstackPanel(pi: ExtensionAPI): void {
  let records = new Map<string, AgentRecord>();
  let transcripts = new Map<string, Transcript>();
  let selected: string | undefined;
  let listOffset = 0;
  let detail = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let session = 0;
  let refreshBusy = false;
  let ui: ExtensionContext["ui"] | undefined;
  let requestViewerRender: (() => void) | undefined;
  let viewer: Viewer | undefined;

  const ordered = () => [...records.values()].sort((a, b) =>
    Number(b.status === "running") - Number(a.status === "running") || b.agent.startedAt.localeCompare(a.agent.startedAt));
  const label = (record: AgentRecord) => `${record.agent.description}  ${record.status}`;
  const latest = (record: AgentRecord) => transcripts.get(record.agent.id)?.latest ||
    (record.status !== "running" ? clean(record.finalText).slice(0, 160) : "waiting for transcript");

  function widget(): void {
    if (!ui) return;
    if (viewer) { ui.setWidget(WIDGET, undefined); return; }
    const shown = ordered().slice(0, 4);
    if (!shown.length) { ui.setWidget(WIDGET, undefined); return; }
    ui.setWidget(WIDGET, (_tui, theme) => ({
      render(width: number) {
        const lines = [theme.fg("accent", ` Agents  ${records.size}${records.size > 4 ? " · showing 4" : ""}  /agents · Ctrl+Alt+A`)];
        for (const record of shown) {
          const status = theme.fg(record.status === "running" ? "warning" : record.status === "completed" ? "success" : "error", record.status);
          lines.push(`  ${status}  ${theme.fg("text", record.agent.description)}  ${theme.fg("dim", latest(record))}`);
        }
        return lines.map((line) => truncateToWidth(line, width));
      },
      invalidate() {},
    }));
  }

  async function refresh(ctx: ExtensionContext): Promise<void> {
    if (refreshBusy) return;
    refreshBusy = true;
    const generation = session;
    try {
      const next = new Map<string, AgentRecord>();
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "custom" || entry.customType !== "pstack-agents") continue;
        const record = parseRecord(entry.data);
        if (record) next.set(record.agent.id, record);
      }
      const ids = [...next.values()].sort((a, b) =>
        Number(b.status === "running") - Number(a.status === "running") || b.agent.startedAt.localeCompare(a.agent.startedAt)).slice(0, 4);
      const chosen = selected && next.get(selected);
      if (chosen && !ids.some((r) => r.agent.id === selected)) ids.push(chosen);
      const expectedDir = join(agentDir, "pstack", ctx.sessionManager.getSessionId(), "agents");
      const tails = await Promise.all(ids.map(async (r) => [r.agent.id, await transcriptOf(r, expectedDir)] as const));
      if (session !== generation) return;
      records = next;
      transcripts = new Map(tails.filter((pair): pair is readonly [string, Transcript] => pair[1] !== undefined));
      if (selected && !records.has(selected)) selected = undefined;
      selected ??= ordered()[0]?.agent.id;
      widget();
      requestViewerRender?.();
    } finally { refreshBusy = false; }
  }

  function cleanup(): void {
    session++;
    if (timer) clearInterval(timer);
    timer = undefined;
    if (viewer?.kind === "open") viewer.close();
    viewer = undefined;
    requestViewerRender = undefined;
    ui?.setWidget(WIDGET, undefined);
    ui = undefined;
    records = new Map();
    transcripts = new Map();
    selected = undefined;
    detail = false;
    listOffset = 0;
  }

  pi.on("session_start", (_event, ctx) => {
    cleanup();
    if (ctx.mode !== "tui") return;
    ui = ctx.ui;
    void refresh(ctx);
    timer = setInterval(() => void refresh(ctx), INTERVAL_MS);
    timer.unref();
  });
  pi.on("session_shutdown", cleanup);

  async function openViewer(ctx: ExtensionContext): Promise<void> {
    if (ctx.mode !== "tui" || viewer) return;
    const opening = { kind: "opening" } satisfies Viewer;
    const generation = session;
    viewer = opening;
    try {
      await refresh(ctx);
      if (session !== generation || viewer !== opening) return;
      await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
      let closed = false;
      let viewport: Viewport = { kind: "follow" };
      let displayedExcerpts: string[] = [];
      let maxScroll = 0;
      const scrollBy = (delta: number) => {
        const offset = Math.min(maxScroll, Math.max(0, (viewport.kind === "paused" ? viewport.offset : 0) + delta));
        viewport = offset ? { kind: "paused", excerpts: displayedExcerpts, offset } : { kind: "follow" };
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        viewer = undefined;
        requestViewerRender = undefined;
        done();
        widget();
      };
      viewer = { kind: "open", close: finish };
      widget();
      requestViewerRender = () => tui.requestRender();
      return {
        render(width: number): string[] {
          const items = ordered();
          const index = Math.max(0, items.findIndex((r) => r.agent.id === selected));
          const current = items[index];
          const height = Math.max(5, (process.stdout.rows || 24) - 7);
          const lines: string[] = [theme.fg("accent", ` Agents  ${items.length}  ${detail ? "transcript tail" : "list"}`), ""];
          if (!detail) {
            const page = Math.min(14, Math.max(1, Math.floor(height / 2)));
            listOffset = Math.max(0, Math.min(listOffset, Math.max(0, items.length - page)));
            if (index < listOffset) listOffset = index;
            if (index >= listOffset + page) listOffset = index - page + 1;
            if (!items.length) lines.push(theme.fg("dim", " No agents in this session. Launch one with the agent tool."));
            for (const [i, record] of items.slice(listOffset, listOffset + page).entries()) {
              const marker = listOffset + i === index ? theme.fg("accent", "❯") : " ";
              lines.push(`${marker} ${theme.fg("muted", record.agent.id.slice(0, 9))}  ${theme.fg(record.status === "running" ? "warning" : record.status === "completed" ? "success" : "error", record.status.padEnd(9))} ${record.agent.description}`);
              lines.push(`    ${theme.fg("dim", latest(record))}`);
            }
            lines.push("", theme.fg("dim", " ↑↓ select · Enter transcript · Esc close"));
          } else if (current) {
            lines.push(theme.fg("text", `${current.agent.id}  ${label(current)}`));
            const tail = transcripts.get(current.agent.id);
            lines.push(theme.fg("dim", ` Recent transcript excerpt${tail?.truncated ? " (older lines omitted)" : ""}${viewport.kind === "paused" ? " · paused" : ""} · status from session records`), "");
            const transcript = tail?.lines ?? [];
            const live = transcript.length ? [...transcript] : ["Transcript not written yet."];
            if (current.status !== "running") live.push(`final answer  ${current.finalText || "No output."}`);
            displayedExcerpts = viewport.kind === "paused" ? viewport.excerpts : live;
            const output = displayedExcerpts.flatMap((text) => text.split("\n").flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width - 2))));
            const page = Math.max(1, height - 5);
            maxScroll = Math.max(0, output.length - page);
            const offset = viewport.kind === "paused" ? Math.min(viewport.offset, maxScroll) : 0;
            if (viewport.kind === "paused") viewport = offset ? { ...viewport, offset } : { kind: "follow" };
            const end = output.length - offset;
            for (const line of output.slice(Math.max(0, end - page), end)) lines.push(` ${theme.fg("muted", line)}`);
            lines.push("", ...wrapTextWithAnsi(" ↑↓ scroll · u/d page · Tab agent · Backspace list · Esc close", width).map((line) => theme.fg("dim", line)));
          }
          return lines.map((line) => truncateToWidth(line, width));
        },
        handleInput(data: string): void {
          const items = ordered();
          const index = Math.max(0, items.findIndex((r) => r.agent.id === selected));
          if (keybindings.matches(data, "tui.select.cancel") || matchesKey(data, "escape")) { finish(); return; }
          if (detail && matchesKey(data, "backspace")) { detail = false; viewport = { kind: "follow" }; }
          else if (!detail && items.length && (keybindings.matches(data, "tui.select.confirm") || matchesKey(data, "return"))) { detail = true; viewport = { kind: "follow" }; }
          else if (detail && (matchesKey(data, "tab") || matchesKey(data, "right") || matchesKey(data, "left"))) {
            selected = items[(index + (matchesKey(data, "left") ? items.length - 1 : 1)) % items.length]?.agent.id;
            viewport = { kind: "follow" };
          } else if (detail) {
            if (matchesKey(data, "up")) scrollBy(1);
            else if (matchesKey(data, "down")) scrollBy(-1);
            else if (matchesKey(data, "pageup") || matchesKey(data, "u")) scrollBy(10);
            else if (matchesKey(data, "pagedown") || matchesKey(data, "d")) scrollBy(-10);
            else return;
          } else {
            if (matchesKey(data, "up")) selected = items[Math.max(0, index - 1)]?.agent.id;
            else if (matchesKey(data, "down")) selected = items[Math.min(items.length - 1, index + 1)]?.agent.id;
            else return;
          }
          void refresh(ctx);
          tui.requestRender();
        },
        invalidate() {},
      };
      });
    } finally {
      if (viewer === opening) { viewer = undefined; widget(); }
    }
  }

  pi.registerCommand("agents", { description: "View pstack agents and transcript tails", handler: (_args, ctx) => openViewer(ctx) });
  pi.registerShortcut(Key.ctrlAlt("a"), { description: "Open agents viewer", handler: openViewer });

  pi.registerToolRenderer((toolName, next) => {
    if (toolName !== "agent") return next();
    return {
      renderCall(args, theme) {
        const task = typeof args.description === "string" ? clean(args.description) : "agent";
        return new Text(theme.fg("toolTitle", "Agent ") + theme.fg("text", task), 0, 0);
      },
      renderResult(result, options, theme) {
        const details = parseResultDetails(result.details);
        const status = details?.status ?? (options.isPartial ? "running" : result.isError ? "failed" : "done");
        const id = details?.id ?? "";
        const wording = status === "running" && !options.isPartial ? "started in background" : status;
        const summary = theme.fg(status === "failed" || status === "stopped" ? "error" : status === "completed" ? "success" : "warning", `${wording} ${id}`);
        if (!options.expanded) return new Text(summary, 0, 0);
        const text = result.content.find((part) => part.type === "text");
        return new Text(`${summary}\n${text?.type === "text" ? text.text.split("\n").map(clean).join("\n") : ""}`, 0, 0);
      },
    };
  });
}
