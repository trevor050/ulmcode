# Shell Non-Interactive Strategy

OpenCode shell commands in this profile must be written for a non-interactive environment. Any command that waits for a prompt, editor, pager, or TTY can stall a long ULMCode operation and waste the recovery window.

## Process Continuity

After each shell result, decide and run the next useful step until the task is complete, blocked by real missing information, or intentionally handed off. Do not stop only because one command finished.

## Environment Defaults

Prefer commands and environment settings that cannot prompt:

- `CI=true`
- `DEBIAN_FRONTEND=noninteractive`
- `GIT_TERMINAL_PROMPT=0`
- `GIT_EDITOR=true`
- `GIT_PAGER=cat`
- `PAGER=cat`
- `GCM_INTERACTIVE=never`
- `HOMEBREW_NO_AUTO_UPDATE=1`
- `npm_config_yes=true`
- `PIP_NO_INPUT=1`

## Command Patterns

Use explicit non-interactive forms:

- `npm init -y`
- `bun init -y`
- `apt-get install -y <package>`
- `pip install --no-input <package>`
- `git commit -m "message"`
- `git merge --no-edit <branch>`
- `git --no-pager log -n 20`
- `docker compose up -d`
- `docker build --progress=plain .`
- `ssh -o BatchMode=yes <host>`
- `curl -fsSL <url>`

Avoid editors, pagers, REPLs, and interactive flags in unattended lanes: `vim`, `nano`, `less`, `more`, `man`, `git add -p`, `git rebase -i`, plain `python`, plain `node`, `docker run -it`, and `docker exec -it`.

## Long Command Handoff

Never run a command in the foreground when it is expected to exceed two minutes. The command does not need to be cancelled; it needs to be owned by the runtime. Use `command_supervise`, `task` with `background=true`, `operation_run`, `runtime_scheduler`, or `runtime_daemon` so the main model can keep planning, validating, and reporting while the command runs.

Bad foreground examples:

- `nmap -sV -p- 10.0.0.0/16`
- `ffuf -u https://district.example/FUZZ -w big.txt`
- `nuclei -l urls.txt -o nuclei.txt`
- `docker run ... zap-baseline.py ...`

Good supervised pattern:

- Run `tool_acquire` for the required tool.
- Claim or create a work unit with `operation_queue_next` when evidence leads exist.
- Launch `command_supervise` with `operationID`, `laneID`, and `workUnitID`.
- Continue other bounded model work.
- Poll with `operation_status`, `task_status`, command heartbeat files, or scheduler output.

Use `timeout` or explicit input only when a command has no proper non-interactive mode. Record the exact command and result in the operation ledger when a long-running or potentially prompt-prone command matters to the engagement.
