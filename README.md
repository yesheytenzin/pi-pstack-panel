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

This extension reads p-stack's persisted `pstack-agents` session records. It does not start, stop, or message agents. The strip above the editor shows up to four agents, with running agents first and recent ended agents next. Pi's existing footer remains unchanged.

## Controls

- `/agents` or `Ctrl+Alt+A` opens the viewer, including while the parent model is streaming.
- In the list, use Up and Down to select an agent, then Enter to open its transcript excerpt.
- In detail, use Up and Down to scroll, or `u` and `d` to move ten lines. Pi may reserve Page Up and Page Down for the main conversation. Use Tab, Left, or Right to switch agents. Backspace returns to the list.
- Scrolling up pauses the excerpt so incoming output does not move what you are reading. Scroll down to the bottom to resume following new output.
- Escape closes the viewer. Closing never stops an agent.

The viewer uses the last 128 KiB of each available child JSONL transcript, limited to 40 message excerpts. It polls while the session is open and retries when a child has not written its transcript file yet. These are persisted messages, not a live token stream. Thinking blocks are omitted. Tool calls read from a transcript are labeled `last tool`, not `running`. Status comes only from the latest validated session record for each agent. Long excerpts wrap to the terminal width. Individual message excerpts are capped at 1,000 characters, and the recorded final answer at 2,000 characters, with a truncation marker when shortened. Ended agents show that final answer even when the transcript excerpt omits it. The agent call card says `started in background` rather than promising it remains running.

The extension only runs its UI in interactive TUI mode. Reload, session replacement, and shutdown clear its timer and viewer. Run `bun self-check.ts` from this directory to check record parsing and transcript filtering. It does not replace pstack's `/pstack-agents` command or provide lifecycle controls.
