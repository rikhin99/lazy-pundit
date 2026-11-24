# An expect driver

Read when a ticket adds or changes an expect driver (`scripts/drive-wizard.exp`, `scripts/drive-table.exp`) or a scenario in one (`ticket-workflow.md`, step 2). `drive-table.exp` (about 200 lines, scenarios in one `switch`, wrapped by `drive-table.sh` for a fixture workspace) is the shorter model to copy.

- A proc that calls `spawn` declares `global spawn_id spawn_out`. `spawn` sets them in the proc's own scope, so without it every later `expect` and `send` in another proc talks to the driver's own stdin: an instant `eof`, and a `puts` after it fails with `error writing "stdout": bad file number`. In #95 this cost about 10k to find.
- Size the terminal before the program's first look: `spawn sh -c "stty rows 30 cols 100; exec <command>"`. A resize mid-run is `exec stty cols 60 < $spawn_out(slave,name)`, which sends the program SIGWINCH.
- Wait for each screen's last line before the next key: `expect -re {(.*)<last line's text>}` consumes up to the match, so the next wait sees only the next draw. Take the last draw in a buffer from its last cursor-home (`\x1b[H`) and strip escapes with `regsub -all {\x1b\[[0-9;?]*[A-Za-z]}`.
- Check a full-screen program's exit after it restores the screen: `expect -ex "\x1b\[?1049l"`, then `expect eof` and `lassign [wait] pid spawnid oserror code`.
- To see why a scenario fails, rerun it with `log_user 1`, or `expect -d <driver> <scenario>` to a file in the scratchpad, read with `grep -a`: it names which `spawn_id` each `expect` read.
- Check a new scenario red by running it with the change's `src/` file back at HEAD (`git stash push <file>`, then `git stash pop`); `npm run mutate` runs a vitest file, so it can't drive a scenario.
