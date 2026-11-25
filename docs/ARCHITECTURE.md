# Architecture

Dashling is three small pieces and one rule.

```
 phone / tablet / browser                 Docker container                         the computer you monitor
┌──────────────────────────┐   HTTP    ┌─────────────────────────┐   SSH      ┌──────────────────────────────┐
│ web/  (the panel)        │ ───────▶  │ server/  (Node, no deps)│ ─────────▶ │ ~/.dashling/dashling-gate.*  │
│  index.html  app.js      │  token    │  API, pairing, cache    │  one key,  │  the ONLY command the key    │
│  extras.js  widgets.js   │ ◀───────  │  OBS client, feeds,     │  locked to │  may run: a fixed list,      │
│  style.css  sw.js        │   JSON    │  photos, store          │  the gate  │  every argument validated    │
└──────────────────────────┘           └───────────┬─────────────┘            └───────────────┬──────────────┘
                                                   │ HTTPS (public only)                       │ reads /proc, /sys, SMC, WMI…
                                                   ▼                                           │ background jobs write ~/.dashling/cache
                                      Open-Meteo · Hacker News · RSS · exchange rates          ▼
                                                   └─ and, on the same machine: OBS WebSocket (ws://host.docker.internal:4455)
```

**The rule:** the container can do on your computer *only what the gate script lists*. Everything else in the design
follows from keeping that list short, validated and reviewable.

## The pieces

### `web/`: the panel
A single-page app with no framework and no build step.
- `widgets.js` is the **widget catalogue** and default layout. It is imported by the panel, the admin page and the server (which validates saved layouts against it).
- `index.html` holds one `<article data-w="<id>">` card per widget. The layout is applied by *moving* those elements between pages, so anything bound to a card keeps working.
- `app.js` has the core cards (clock, weather, stats, deck, themes). `extras.js` has the newer widgets (time, personal, news, photos, weather extras) and exposes `refresh()`, `onWeather()` and a list of timers to `app.js`.
- **Polling rule:** a widget only polls while its page is on screen (`pageHas(idx, id)`). This is what keeps the cost on the monitored computer near zero when you're not looking.
- The panel reloads itself when the server's front-end fingerprint (`/api/health` → `build`) changes, so phones pick up updates without a manual refresh.
- Strict CSP: `default-src 'self'`, no inline scripts. All third-party data goes through the server.

### `server/`: the container
- `index.js`: HTTP router, pairing and token auth, rate limiting, static files, the admin server (separate port, loopback only), weather, GitHub/GitLab fallbacks, and the generic per-widget store (`/api/store/<key>`, whitelisted keys, size-capped, kept in the data volume).
- `host.js` (`HostConnector`): runs gate commands over SSH, parses their `key=value` output, caches results so many viewers share one call, and **validates arguments a second time** before building a command (`control()`, `killProc()`).
- `extras.js`: Hacker News, RSS/Atom (with a hand-rolled parser), exchange rates, air quality, and `safeFetchText`, which refuses anything but `https://` to public addresses (SSRF protection).
- `obs.js`: an obs-websocket v5 client with a lazy, shared connection.

### `host/`: the monitored computer
- One **gate** per OS (`macos/dashling-gate.sh`, `linux/dashling-gate.sh`, `windows/dashling-gate.ps1`). Same commands, same output keys. Where something doesn't exist on an OS the gate prints an explicit marker (`fan_none=1`, `cal_unsupported=1`) and the UI says so.
- macOS ships three tiny native helpers (`smcfan`, `dispctl`, `calevents`); Linux reads `/proc` and `/sys` directly; Windows uses CIM/WMI plus a desktop-session task for things SSH can't reach.
- **Background jobs** (launchd / systemd timer / cron) run in your desktop session to produce cache files (GitHub/GitLab contributions, AI usage, calendar). The gate just `cat`s those files, so credentials and keychain access never cross the SSH boundary.
- Installers are separate from the gate on purpose (`host/README.md` explains why).

## Request flow, by example

*You drag the brightness slider.*
1. `app.js` → `POST /api/ctl {action:'brightness', value:40}` with the bearer token.
2. `index.js` → `host.control('brightness', 40)`, which re-validates (integer 0 to 100) and builds the literal string `display-set 40`.
3. `host.run()` → `ssh … 'display-set 40'`. sshd runs the forced command, the gate, with `SSH_ORIGINAL_COMMAND='display-set 40'`.
4. The gate matches `display-set [0-9]|display-set [0-9][0-9]|display-set 100` (an anchored pattern), runs the OS's tool, prints `ok`.
5. Anything that doesn't match any pattern prints `refused` and exits 126.

## Output contract

Gates print one `key=value` per line (some keys repeat as `procN=`, `fanN=`, `pcoreN=`, `ev=`). The server turns these into JSON.
`test/host-parse.test.mjs` and its fixtures pin this format for every OS; change a key in one gate and that test (and the other
gates) must change too. Big numbers are printed as plain integers.

| Command | Prints |
|---|---|
| `stats` | `name cores cpu_user cpu_sys cpu_idle mem_total mem_used disk_total disk_used batt_pct batt_state batt_time load procN boot volume net_rx net_tx` |
| `fans` / `temps` | `fanN=` / `pcoreN= ecoreN= gpu=` or `fan_none=1` / `temp_none=1` |
| `power` | `sys_w adapter_in_w batt_w ac designcapacity nominalchargecapacity cyclecount temperature adapter_rated_w` |
| `calendar` | `ev=start\|end\|allday\|calendar\|title` lines, or `cal_empty` / `cal_denied` / `cal_unsupported` / `cal_setup` |
| `docker-ps` | `name\|state\|status\|image` lines, or `docker_down=1` |
| `nowplaying` | `src title artist album duration elapsed rate` (nothing when idle) |

## Trust boundaries

| Boundary | What crosses it | Guard |
|---|---|---|
| Browser → server | JSON over HTTP on your LAN | bearer token or per-device key, rate limit on failures, CSP |
| Server → computer | one SSH command string | forced command, `restrict`, gate allowlist, double validation |
| Server → internet | feeds, weather, rates, HN | https only, public addresses only, size and time caps |
| Container → host filesystem | nothing | read-only root, non-root user, capabilities dropped; only the `/data` volume is writable |
| Background jobs → gate | cache files | the gate only reads them |

## The demo

`scripts/demo/` is a second, tiny server (`npm run demo`) that serves the same `web/` folder with invented data from `data.mjs`
instead of talking to a computer. It exists to let people try the panel in seconds and to take the README screenshots
(`stage.html` frames the panel as a phone, tablet or theme grid). It listens on localhost unless you set `DEMO_HOST`.

## Tests, in one line each

`layout` (catalogue and layouts) · `extras` (parsers, SSRF) · `obs` (fake OBS) · `host-parse` (the output contract) ·
`server-smoke` (real server) · `demo` (the demo server and its fictional data) · `gates/refusals.sh` (hostile input) · `gates/linux.sh` (fake `/sys`). Details in
[CONTRIBUTING.md](../CONTRIBUTING.md).
