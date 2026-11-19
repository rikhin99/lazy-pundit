"""Runs a command in a pseudo-terminal of a given width and prints its output.

`npm run -s tty -- <columns> <command> [args...]`, from any folder (from a
fixture workspace, `npm --prefix <repo> run -s tty -- ...`): the command runs
in that folder and sees a terminal
(`isTTY`, `columns`), as when a pundit runs it by hand, so a scratch run can
check what only a terminal shows (a table cut to the width, a bold header).
Output keeps its escape codes, with "\r" dropped; the exit code is the
command's. `NO_COLOR` passes through, so run it under `env -u NO_COLOR` to see
the bold. `script` fails in the agents' sandbox, and Node has no pty without a
native dependency.
"""

import fcntl
import os
import pty
import struct
import sys
import termios

if len(sys.argv) < 3:
    sys.exit("usage: npm run -s tty -- <columns> <command> [args...]")
columns = int(sys.argv[1])
command = sys.argv[2:]

pid, fd = pty.fork()
if pid == 0:
    # npm runs scripts from the repo root; the command runs where npm was
    # called, such as a fixture workspace.
    os.chdir(os.environ.get("INIT_CWD", os.getcwd()))
    # Sized before exec, so the command reads the width on its first look.
    fcntl.ioctl(1, termios.TIOCSWINSZ, struct.pack("HHHH", 50, columns, 0, 0))
    os.execvp(command[0], command)

out = b""
while True:
    try:
        chunk = os.read(fd, 65536)
    except OSError:  # Linux reports the closed terminal as EIO.
        break
    if not chunk:
        break
    out += chunk
_, status = os.waitpid(pid, 0)
sys.stdout.write(out.decode().replace("\r", ""))
sys.exit(os.waitstatus_to_exitcode(status))
