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

Use `timeout` or explicit input only when a command has no proper non-interactive mode. Record the exact command and result in the operation ledger when a long-running or potentially prompt-prone command matters to the engagement.
