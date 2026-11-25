# Security policy

Dashling runs a web server on your network and, if you connect a computer, can read its status and send it a short list
of controls. We take that seriously.

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private reporting instead:
**Security tab > Report a vulnerability** on <https://github.com/sateesh2020/dashling>.

Include what you found, how to reproduce it, and which OS/setup. You'll get an acknowledgement as soon as the maintainer
sees it, and we'll agree on a fix and a disclosure date together. This is a volunteer project, so there is no bounty
and no fixed SLA, but anything that lets someone run commands or read files on your computer is treated as urgent.

## What we consider in scope

- Anything that lets the panel, the container, or someone on your network run a command or read a file on the monitored
  computer **outside** the fixed command list in a gate script.
- Authentication bypass on the panel or the admin page, or leaking the access token or the SSH key.
- Server-side request forgery through the feed, weather or rates features (reaching your LAN or the host).
- Path traversal in static files, photos or the store.
- Cross-site scripting or CSP bypass in the panel.

Out of scope: someone who already has your access token or the container's SSH key being able to use the panel as
designed (the token is the credential; keep it private), attacks that need physical access, and the optional
"experimental" Windows scripts failing to work (that's a bug, not a vulnerability).

## How it is designed (so you can judge it)

- The container never runs anything on your computer directly. It connects over SSH with a key locked to **one script**
  (`command="…",restrict` in `authorized_keys`). That gate answers only a fixed list of commands, validates every
  argument, and refuses everything else. Read it: it is short on purpose (`host/<os>/dashling-gate.*`).
- Quitting processes works only on **your** processes, never the desktop, `sshd` or the panel's own container.
- Apps and shortcuts run only from your own allowlist or shortcuts folder, which the container can't edit.
- Feed URLs must be `https://` on public addresses; private, loopback and link-local addresses are refused.
- The page is served with a strict Content-Security-Policy (`default-src 'self'`, no inline scripts, no framing),
  `no-store` caching, and a rate limit on failed logins.
- The container runs read-only, as a non-root user, with all Linux capabilities dropped.
- Tests for all of this run in CI: `test/gates/refusals.sh` (hostile input to the gates), `test/extras.test.mjs` (SSRF),
  `test/server-smoke.test.mjs` (auth, headers, traversal).

## If you run it

- Keep the panel on your home network; don't expose port 8787 to the internet. If you need remote access, put it behind a VPN.
- The admin page (port 8788) is bound to the computer's loopback on purpose.
- Revoke every paired device with `docker compose exec dashling rm /data/devices.json`.
- Review `~/.dashling/apps.allow` and your shortcuts: those are the things the panel can launch.

## Supported versions

Only the latest `main` / latest release receives fixes.
