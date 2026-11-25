# Contributing to Dashling

Thanks for helping. Dashling is a small, dependency-free project, and we'd like to keep it that way: easy to read,
easy to audit, safe to run on your own computer. This page tells you how to get set up, what the checks are, and the
few rules that matter most.

## Ways to help

- **Test on a platform we can't.** Linux is tested in containers and Windows has never run on real hardware
  (see [host/windows/README.md](host/windows/README.md)). A report like "Fedora 40, Wayland: lock works, brightness
  doesn't" is genuinely useful. Use the *Platform report* issue form.
- **Add a widget** (guide below), **fix a bug**, **improve the docs**.
- **Review a pull request.** A second pair of eyes on a gate script is the most valuable review there is.

## Set up

You need **Node 22+** and (for the full checks) Docker. No build step, no bundler.

```bash
git clone https://github.com/sateesh2020/dashling.git && cd dashling
npm ci                      # one dev dependency (ws, used only to fake OBS in tests)

# run the server without Docker, with no computer connected
DATA_DIR=./.data PORT=8787 ADMIN_PORT=8788 DASHLING_TOKEN=dev-token node server/index.js
# open http://localhost:8787 and use "Use access token instead" with: dev-token
```

To work against a real machine, follow [host/README.md](host/README.md) and set `HOST_SSH`.

**Running it in Docker as a contributor:** `docker compose up -d` runs the *published* image, not your changes. To run your own
code, build from source: add `COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml` to your (git-ignored) `.env`, then
`docker compose up -d --build` (or pass `-f docker-compose.yml -f docker-compose.build.yml` each time).

## Try your change with the demo

`npm run demo` serves the real panel on <http://localhost:8799> with **fictional data** (pairing code `123456`), so you can work on
a widget or a theme without connecting a computer or running Docker. Edits to `web/` show up on reload. The fake data lives in
`scripts/demo/data.mjs`; if you add a widget that reads a new endpoint, add a fixture there and a line in `test/demo.test.mjs`.
That test also fails if anything that looks like real personal data (usernames, hostnames, home-network addresses, tokens) appears in the demo.

## The website

`site/` is the landing page for <https://sateesh2020.github.io/dashling/>; it embeds the **real panel** running on the fictional demo data, with
no server: `demo-shim.mjs` answers the panel's `/api/` calls in the browser using the same `scripts/demo/router.mjs` as `npm run demo`.
`npm run site` builds it into `_site/` (then serve that folder with any static server, for example `python3 -m http.server -d _site`).
`test/site.test.mjs` builds it and checks every link, the sub-folder paths, and that nothing private is published. The `Website` workflow
deploys it to GitHub Pages on pushes to `main` that touch `site/`, `web/`, the demo or the images.

## Screenshots and GIFs

The README images are taken from the demo, never from a real machine. To refresh them:

1. `npm run demo`, then open `/_stage` (the options are in the comment at the top of `scripts/demo/stage.html`), for example
   `http://localhost:8799/_stage?w=1280&h=800&p=system&theme=cyber&frame=tablet` for a tablet shot,
   `?trio=home,system,mac&theme=glass` for three phones, or `?themes=glass,light,graphite,dots,cyber,terminal&p=system` for the theme grid.
2. Capture just the device area (move the mouse pointer out of the shot) and save it as `<page>-<theme>.png`.
3. `scripts/demo/make-media.sh <folder>` turns the captures into `docs/img/*.jpg` and the tour GIF (needs `ffmpeg`).

Keep each image under about 250 KB and the GIF under about 2 MB.

The **social preview** (`docs/img/social-preview.jpg`, 1280x640, the picture GitHub shows when the repo link is shared) and the website's link-preview
image (`site/og.jpg`) come from `/_social`: open it with the demo running, capture the 1280x640 card, and scale it with `ffmpeg`
(`scale=1280:640`, and `scale=1200:600,pad=1200:630:0:15:color=0x05060f` for `og.jpg`). GitHub has no API for the social preview, so upload it by hand
under the repo's Settings > General > Social preview.

## Run the checks

```bash
npm run check          # syntax of every JS and shell file (+ ShellCheck if installed) and all Node tests
npm test               # Node tests only (about 1 second)
npm run test:gates     # the shell gate tests (macOS or Linux, whichever you are on)
```

| Check | What it protects |
|---|---|
| `test/layout.test.mjs` | Every widget has a card, a name and a valid width; layouts are validated; each widget lives on one page. |
| `test/extras.test.mjs` | RSS/Atom parsing, and that a feed URL can **never** reach private addresses (SSRF). |
| `test/obs.test.mjs` | The OBS client against a fake OBS: password handshake, controls, offline and wrong-password states. |
| `test/host-parse.test.mjs` | **Contract test:** what each OS's gate prints parses into what the web app expects. Also that rejected control requests never reach SSH. |
| `test/server-smoke.test.mjs` | Starts the real server: auth, security headers, path traversal, the storage whitelist, refusals when nothing is connected. |
| `test/gates/refusals.sh` | Hostile input to the gate (command injection, path traversal, out-of-range numbers, the panel's own container) is refused and runs nothing. |
| `test/gates/linux.sh` | The Linux gate's parsers for fans, temperatures, power, brightness, shortcuts and photos, against a fake `/sys`. |

Testing the Linux gate from a Mac:

```bash
docker run --rm -v "$PWD":/r:ro -w /r debian:bookworm-slim bash -c \
  'apt-get update -qq && apt-get install -y -qq procps >/dev/null && bash test/gates/linux.sh'
```

CI (`.github/workflows/ci.yml`) runs all of this on every pull request, plus ShellCheck, a macOS job that compiles the
native helpers, a Windows job that parses the PowerShell and runs PSScriptAnalyzer, and a Docker build that must answer
`/api/health`. CodeQL scans the JavaScript weekly and on pull requests. **A pull request needs green CI to merge.**

## Project layout

```
server/    Node server (no runtime dependencies): API, SSH to the host, OBS, feeds, photos
web/       the panel: index.html, app.js, extras.js, widgets.js (the widget catalogue), style.css, admin/
host/      what runs on the monitored computer: one gate per OS (macos/ linux/ windows/) + common/
test/      Node tests, fixtures, and the shell gate tests
docs/      ARCHITECTURE.md
android/   the optional kiosk app
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first if you're touching the server or a gate.

## Adding a widget

1. **Catalogue:** add an entry to `WIDGETS` in `web/widgets.js` (`id`, `name`, default width `w`, `resize`). Add it to a page in
   `DEFAULT_LAYOUT` if it should appear by default.
2. **Markup:** add one `<article data-w="<id>" class="card …">` to `web/index.html`. The tests fail if a widget has no card.
3. **Behaviour:** put the logic in `web/extras.js` (or `app.js` for core cards).
   - Poll **only while your page is on screen**: start with `if (!on('<id>')) return;` (`pageHas(idx, id)` in `app.js`).
     Idle pages must cost the computer nothing.
   - Build DOM with `el()` and `textContent`, never `innerHTML` with data you didn't write. The CSP forbids inline scripts.
   - Show a friendly message for empty, offline and "not supported on this OS" states.
4. **Style:** `web/style.css`. Use the existing CSS variables (so every theme works) and `@container` queries so the card
   still looks right at 3/12 width. Check it at phone width and in landscape.
5. **Data from the server:** add a route in `server/index.js` and a method on `HostConnector` (`server/host.js`) or a module in
   `server/`. Cache it (`cachedFetch` / `cached`) so many viewers share one call.
6. **Persisted settings:** use the generic store (`/api/store/<key>`): add your key to `STORE_KEYS` in `server/index.js`.
7. Update the README widget list if it is user-visible, then run `npm run check`.

## Adding or changing a gate command

The gate is the **security boundary**: the container's SSH key can run *only* it, so anyone who reaches that key can run
exactly the commands in it and nothing else. Treat every edit to a gate like a security change.

- **Allowlist by exact pattern.** Match the whole command with an anchored regex or a `case` pattern. Never `eval`, never
  interpolate input into a shell string, never accept a path (accept a plain file *name* and join it to a fixed folder yourself).
- **Validate every argument** (digits only, a plain name regex, a range, an allowlist file).
- **Be least-privilege.** Only the user's own processes; refuse the desktop, `sshd` and the panel's own container.
- **Exit codes matter.** A successful read must exit 0. A non-zero exit looks like an SSH failure to the server.
  (Beware `[ cond ] && echo …` as the last line: it exits 1 when `cond` is false. Use `if`.)
- **Keep OSes in step.** If you add a command, add it to the **macOS and Linux and Windows** gates, or have the others print
  an explicit "unsupported" result (for example `cal_unsupported=1`) so the UI can say so. Output keys must be identical.
- **Big numbers:** use `%.0f`, not `%d`, in `awk` (Debian's `mawk` clips `%d` at 2 GB).
- **Test it.** Add the hostile cases to `test/gates/refusals.sh`, the happy path to the OS test, and a fixture + assertion to
  `test/host-parse.test.mjs`. On the server side, validate again in `server/host.js` (defence in depth).

## Code style

- Plain JavaScript (ES modules), no TypeScript, **no new runtime dependencies**. A dev-only dependency needs a good reason.
- Comments explain *why*, not *what*. Match the surrounding style; `.editorconfig` covers whitespace.
- Shell: `bash`, passes `shellcheck -S warning`. PowerShell: passes the parser and PSScriptAnalyzer errors.
- No secrets, tokens, real hostnames or personal paths in code, fixtures, tests or docs.

## Commits and pull requests

- Small, focused pull requests. One idea each.
- Write the commit message as what changed and why, in the imperative ("Refuse docker-act on the panel's own container").
- Fill in the pull-request template: what, why, how you tested it (**which OS**), and screenshots for UI changes
  (phone width and landscape).
- If you couldn't test on an OS you touched, say so plainly. That's fine; hiding it isn't.
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Releasing (maintainers)

A release is a tag: `git tag -a v0.2.0 -m "Dashling v0.2.0" && git push origin v0.2.0`. The **Release** workflow then
runs the tests, publishes the multi-arch Docker image (`ghcr.io/sateesh2020/dashling`: `0.2.0`, `0.2` and, for a stable
release, `latest`), creates the GitHub Release if it doesn't exist, and builds, signs and attaches the **Android APK**
(`dashling-0.2.0.apk` plus `SHA256SUMS.txt`). Tags with a dash (`v0.2.0-rc1`) are pre-releases and never get `latest`.

**One-time setup for the APK.** Android only installs an update over an existing app if it is signed with the same key, so
releases use one fixed key. `android/build.sh` creates it in `~/.dashling-android/` the first time you build. Give it to
GitHub as two repository secrets (Settings > Secrets and variables > Actions), and keep a backup of that folder somewhere safe:

```bash
base64 -i ~/.dashling-android/release.keystore | gh secret set ANDROID_KEYSTORE_B64
gh secret set ANDROID_KEYSTORE_PASSWORD < ~/.dashling-android/ks.pass
```

Without the secrets the release still succeeds, but skips the APK and prints a warning. If you ever lose the key, the next APK
can't update existing installs (people must uninstall first), so never commit it and never regenerate it casually.
`versionCode` is derived from the tag (`v0.1.1` becomes 10199), so it always increases.

After a release, the **Smoke test (published image)** workflow runs by itself and pulls the new image.

## Security issues

Please **don't** open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Conduct

Be kind and assume good faith. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
