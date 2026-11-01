import { spawn } from "node:child_process";

/** The clipboard. Library code copies text only through one of these. */
export interface Clipboard {
  /** Copies the text. Resolves false when no clipboard is available. */
  write(text: string): Promise<boolean>;
}

/** Clipboard commands, tried in order until one is present. */
const COMMANDS: [string, string[]][] = [
  ["pbcopy", []],
  ["wl-copy", []],
  ["xclip", ["-selection", "clipboard"]],
  ["clip.exe", []],
];

/**
 * The production clipboard: `pbcopy` (macOS), `wl-copy` or `xclip` (Linux) or
 * `clip.exe` (WSL), whichever is present. With none, nothing is copied.
 */
export const systemClipboard: Clipboard = {
  async write(text) {
    for (const [command, args] of COMMANDS) {
      if (await pipeTo(command, args, text)) return true;
    }
    return false;
  },
};

/** Pipes text into a command. Resolves false if it's missing or fails. */
function pipeTo(command: string, args: string[], text: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  });
}
