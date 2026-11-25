## What and why
<!-- One or two sentences. Link the issue if there is one: Fixes #123 -->

## How I tested it
<!-- Tick what applies, and say WHICH OS. If you couldn't test on an OS you touched, say so. -->
- [ ] `npm run check` passes
- [ ] `npm run test:gates` passes on: macOS / Linux / not run
- [ ] Tried it by hand on: macOS / Linux (distro: ___) / Windows / only in the browser

## Screenshots (UI changes)
<!-- Phone width AND landscape / 3-of-12 width if it is a widget. -->

## Checklist
- [ ] No new runtime dependencies
- [ ] If I changed a **gate script**: arguments are validated, hostile cases are in `test/gates/refusals.sh`, and the other OSes' gates still print the same keys (or an explicit "unsupported")
- [ ] If I added a **widget**: catalogue entry, a card in `index.html`, polling only while its page is on screen, empty/offline states, README updated
- [ ] No secrets, tokens, hostnames or personal paths in code, tests, fixtures or docs
