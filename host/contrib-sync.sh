#!/bin/bash
# Dashling contribution sync. Runs in YOUR desktop session (via launchd), where gh and glab can
# read their logins from the macOS keychain; over SSH they can't. It saves only daily counts to
# ~/.dashling/cache/. No token is ever copied anywhere. The SSH gate just reads these files.
set -u
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin
export GH_PROMPT_DISABLED=1 NO_COLOR=1
C="$HOME/.dashling/cache"; mkdir -p "$C"
HERE="$(cd "$(dirname "$0")" && pwd)"

sync_gh() {
  command -v gh >/dev/null || { echo "gh is not installed on this Mac" > "$C/gh.err"; return; }
  from=$(date -u -v-364d +%Y-%m-%dT00:00:00Z); to=$(date -u +%Y-%m-%dT23:59:59Z)
  if out=$(gh api graphql -f query="query{viewer{login contributionsCollection(from:\"$from\",to:\"$to\"){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}" 2>"$C/gh.err.tmp"); then
    printf '%s' "$out" > "$C/gh.json.tmp" && mv "$C/gh.json.tmp" "$C/gh.json"; rm -f "$C/gh.err" "$C/gh.err.tmp"
  else mv "$C/gh.err.tmp" "$C/gh.err"; fi          # keep the last good gh.json if this run failed
}

sync_gh_reviews() {      # open PRs where you are asked to review
  command -v gh >/dev/null || { echo "gh is not installed on this Mac" > "$C/gh-reviews.err"; return; }
  if out=$(gh search prs --review-requested=@me --state=open --limit 50 --json number,title,url,repository,author,updatedAt,isDraft 2>"$C/gh-reviews.err.tmp"); then
    printf '%s' "$out" > "$C/gh-reviews.json.tmp" && mv "$C/gh-reviews.json.tmp" "$C/gh-reviews.json"; rm -f "$C/gh-reviews.err" "$C/gh-reviews.err.tmp"
  else mv "$C/gh-reviews.err.tmp" "$C/gh-reviews.err"; fi
}

sync_gl_reviews() {      # open merge requests where you are a reviewer
  command -v glab >/dev/null || { echo "glab is not installed on this Mac" > "$C/gl-reviews.err"; return; }
  set -o pipefail
  me=$(glab api user 2>/dev/null | jq -r '.username // empty')
  if [ -z "$me" ]; then echo "GitLab is not reachable (VPN off?)" > "$C/gl-reviews.err"; return; fi
  if out=$(glab api "merge_requests?scope=all&state=opened&reviewer_username=$me&per_page=50" 2>"$C/gl-reviews.err.tmp" \
      | jq -c '[.[] | {number: .iid, title, url: .web_url, author: .author.username, updatedAt: .updated_at, isDraft: (.draft // false), repo: (.references.full | sub("![0-9]+$"; ""))}]'); then
    printf '%s' "$out" > "$C/gl-reviews.json.tmp" && mv "$C/gl-reviews.json.tmp" "$C/gl-reviews.json"; rm -f "$C/gl-reviews.err" "$C/gl-reviews.err.tmp"
  else mv "$C/gl-reviews.err.tmp" "$C/gl-reviews.err"; fi
}

sync_gl() {
  command -v glab >/dev/null || { echo "glab is not installed on this Mac" > "$C/gl.err"; return; }
  set -o pipefail
  after=$(date -u -v-366d +%Y-%m-%d)
  user=$(glab api user 2>/dev/null | jq -r '.username // empty')
  if out=$(glab api --paginate "events?after=$after&per_page=100" 2>"$C/gl.err.tmp" | jq -r '.[].created_at[0:10]'); then
    { echo "user=$user"; printf '%s\n' "$out"; } > "$C/gl.txt.tmp" && mv "$C/gl.txt.tmp" "$C/gl.txt"; rm -f "$C/gl.err" "$C/gl.err.tmp"
  else mv "$C/gl.err.tmp" "$C/gl.err"; fi          # e.g. VPN off: keep the last good gl.txt
}

# the job ticks every 2 minutes (AI usage is near-live); GitHub/GitLab are only refreshed every ~14 minutes
if [ ! -f "$C/.git-synced" ] || [ -n "$(find "$C/.git-synced" -mmin +13 2>/dev/null)" ]; then
  sync_gh; sync_gh_reviews; sync_gl; sync_gl_reviews; touch "$C/.git-synced"
fi
[ -x "$HERE/ai-usage-sync.sh" ] && "$HERE/ai-usage-sync.sh"
