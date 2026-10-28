# Pi p-stack panel

An unofficial agent viewer for [p-stack](https://github.com/michael-denyer/pstack-claude) in Pi. It adds agent cards to the conversation, a compact status strip, and a keyboard-driven transcript viewer.

## Install

Requires Pi and p-stack. Tested with Pi 1.4.0 in fullscreen terminal mode.

If p-stack is not installed, run:

```bash
pi install git:github.com/michael-denyer/pstack-claude
```

Install the panel:

```bash
pi install git:github.com/yesheytenzin/pi-pstack-panel
```

After active agents finish, run `/reload` in Pi or start a new session. Open `/agents` to see the viewer. The strip appears when p-stack launches agents.

If you already use a manually copied `pstack-panel` directory under `~/.pi/agent/extensions/`, move it outside that directory before installing the package. Keep only one loaded copy.

## Behavior

This extension reads p-stack's persisted `pstack-agents` session records. It does not start, stop, or message agents. The strip above the editor shows up to four agents, with running agents first and recent ended agents next. `/agents` covers the terminal with the agent list or the selected agent's text conversation. Parent conversation text and other agents' text stay hidden until the viewer closes. Pi's existing footer remains unchanged underneath and returns when the viewer closes.

Pi 1.4.0 does not composite overlays over image-bearing terminal rows. Parent inline images may remain visible while the viewer is open. This host limitation is separate from the viewer's decision not to replay agent images.

## Controls

- `/agents` or `Ctrl+Alt+A` opens the viewer, including while the parent model is streaming.
- In the list, use Up and Down or the mouse wheel to select an agent, then Enter to open its transcript excerpt.
- In detail, use Up and Down or the mouse wheel to scroll, or `u` and `d` to move ten lines. The row indicator shows the visible range of the rendered excerpt. If the excerpt fits, it suggests expanding tools with `o`. Use Tab, Left, or Right to switch agents; switching starts at that agent's latest excerpt without retaining the previous agent's paused view. Backspace returns to the list.
- Press `o` in detail to expand or collapse tool output.
- Scrolling up pauses the excerpt so incoming output does not move what you are reading. Scroll down to the bottom to resume following new output. Mouse wheel input works in fullscreen mode; regular terminal mode leaves it to terminal scrollback.
- Escape or Backspace in detail returns to the list. Escape in the list closes the viewer. Each open starts in the list, even if you previously read a transcript. Closing never stops an agent.

The viewer reads the last 128 KiB of each available child JSONL transcript and its last 40 persisted messages. It polls while the session is open and retries when a child has not written its transcript file yet. Pi's own message components render user and assistant Markdown, including code blocks, and native tool cards. Built-in tools use Pi's renderers. Other tools use Pi's generic native card because the parent cannot access a child's custom renderer registry. Images are not replayed. Thinking blocks are omitted. A tool result remains visible even when its call fell outside the excerpt. An unmatched call shows an explicit unknown-state note rather than claiming the tool is running. Status comes only from the latest validated session record for each agent. Text blocks and the recorded final answer are capped at 12,000 characters each. The viewer marks shortened text and older messages omitted by the 40-message or 128 KiB window. An ended agent's final answer appears if the excerpt does not already contain it. The agent call card says `started in background` rather than promising it remains running.

The extension only runs its UI in interactive TUI mode. Reload, session replacement, and shutdown clear its timer and viewer. Run `bun self-check.ts` from this directory to check record parsing and transcript filtering. It does not replace pstack's `/pstack-agents` command or provide lifecycle controls.
