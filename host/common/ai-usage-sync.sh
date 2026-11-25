#!/bin/bash
# Dashling AI-tool usage collector. Runs on your Mac from the same launchd job as contrib-sync.sh.
# Tools: Claude Code (~/.claude/projects) and Codex (~/.codex/sessions). Reads ONLY token counts, model names,
# timestamps, session ids and project folder names from their local logs; message text is never kept.
# Incremental: remembers how far it has read each log, so a run only parses new bytes.
# Output: ~/.dashling/cache/ai.json (read by the SSH gate). Log formats are not documented APIs.
set -u
# stat differs between macOS (BSD) and Linux (GNU): pick the right flag and format codes once
TAB=$'\t'
if stat --version >/dev/null 2>&1; then STATF=(stat -c); F_NEWEST='%Y %n'; F_FULL="%Y${TAB}%n${TAB}%s"
else STATF=(stat -f); F_NEWEST='%m %N'; F_FULL="%m${TAB}%N${TAB}%z"; fi
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin LC_ALL=C
C="$HOME/.dashling/cache"; A="$C/ai"; mkdir -p "$A"
command -v jq >/dev/null || { echo "jq is required (macOS 15+ has it; otherwise: brew install jq)" > "$C/ai.err"; exit 0; }

# one run at a time (a first scan of large logs can take a while); a lock older than 15 min is stale
LOCK="$A/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ] && { rmdir "$LOCK"; mkdir "$LOCK" 2>/dev/null || exit 0; } || exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null; rm -f "$A"/*.tmp' EXIT

DAYS=8; NOW=$(date +%s); CUT=$((NOW - DAYS * 86400)); TAB=$(printf '\t')
TZ_OFF=$(date +%z | awk '{s=($0~/^-/)?-1:1; h=substr($0,2,2); m=substr($0,4,2); print s*(h*3600+m*60)}')

# --- per-tool extractors: read NEW log bytes on stdin, print one TSV row per message:
#     ts  dedupe-key  model  input  output  cache_write  cache_read  session  project
extract_claude() {
  grep -a '"usage"' | grep -a '"type":"assistant"' | jq -R -r '
      fromjson? | select(.type=="assistant" and .message.usage != null and (.message.model // "") != "<synthetic>")
      | try ([ (.timestamp | sub("\\.[0-9]+Z$";"Z") | fromdateiso8601), (.message.id // .uuid // ""), (.message.model // ""),
          (.message.usage.input_tokens // 0), (.message.usage.output_tokens // 0),
          (.message.usage.cache_creation_input_tokens // 0), (.message.usage.cache_read_input_tokens // 0),
          (.sessionId // ""), ((.cwd // "") | sub("/\\.claude/worktrees(/.*)?$"; "") | split("/") | last // "") ] | @tsv) catch empty' 2>/dev/null
}
extract_codex() {                      # $1 = log file (session id from the name; model + project from the log itself)
  local f="$1" sid model proj
  sid=$(basename "$f" .jsonl | sed -E 's/^rollout-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-//')
  model=$(grep -a '"turn_context"' "$f" 2>/dev/null | tail -1 | jq -r '.payload.model // ""' 2>/dev/null)
  proj=$(head -1 "$f" 2>/dev/null | jq -r '(.payload.cwd // "") | sub("/\\.claude/worktrees(/.*)?$"; "") | split("/") | last // ""' 2>/dev/null)
  grep -a '"token_count"' | jq -R -r --arg sid "$sid" --arg model "$model" --arg proj "$proj" '
      fromjson? | select(.type=="event_msg" and .payload.type=="token_count" and (.payload.info.last_token_usage != null))
      | .payload.info.last_token_usage as $u
      | try ([ (.timestamp | sub("\\.[0-9]+Z$";"Z") | fromdateiso8601), ($sid + "@" + .timestamp), $model,
          (($u.input_tokens // 0) - ($u.cached_input_tokens // 0)), ($u.output_tokens // 0), 0, ($u.cached_input_tokens // 0),
          $sid, $proj ] | @tsv) catch empty' 2>/dev/null
}
# Codex also records plan-limit readings in its logs: take the newest one
limits_codex() {
  local newest
  newest=$(find "$1" -name '*.jsonl' -mtime -$DAYS -exec "${STATF[@]}" "$F_NEWEST" {} + 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
  [ -n "$newest" ] || { echo null; return; }
  grep -a '"token_count"' "$newest" | tail -1 | jq -c '
      select(.payload.rate_limits != null) | .payload.rate_limits as $r | (.timestamp | sub("\\.[0-9]+Z$";"Z") | fromdateiso8601) as $t
      | def w($x): if $x == null or $x.used_percent == null then null else {pct: $x.used_percent, reset: $x.resets_at, mins: $x.window_minutes} end;
        [w($r.primary), w($r.secondary)] | map(select(. != null)) as $ws
        | {updated: $t,
           five_hour: ($ws | map(select(.mins != null and .mins <= 360)) | first // null | if . == null then null else {pct, reset} end),
           seven_day: ($ws | map(select(.mins != null and .mins >= 1440)) | first // null | if . == null then null else {pct, reset} end)}' 2>/dev/null || echo null
}

# --- combine whatever tools have data into one file (called after every publish, so partial results show up early)
combine_all() {
  local parts; parts=$(ls "$A"/part.*.json 2>/dev/null)
  [ -n "$parts" ] || return 0
  jq -s -c --argjson now "$NOW" 'reduce .[] as $p ({updated: $now}; . + $p)' $parts > "$A/ai.tmp" && jq -e . "$A/ai.tmp" >/dev/null && { mv "$A/ai.tmp" "$C/ai.json"; rm -f "$C/ai.err"; }
}

# --- merge new rows, aggregate, and write this tool's part + ai.json.  $1 = logs read so far, $2 = logs to read this run
#     (runs inside sync_tool: it uses that function's T / D / ENT / ROOT)
publish_tool() {
  local done_n="$1" total_n="$2"
  # merge, drop duplicates (keep the fullest copy), prune to the window
  cat "$ENT" "$D/new.tmp" | awk -F'\t' -v cut="$CUT" '$1>=cut { k=($2==""?$1"_"NR:$2); if(!(k in b) || $5>o[k]){b[k]=$0; o[k]=$5} } END{for(k in b) print b[k]}' | sort -n -k1,1 > "$D/ent.tmp"
  mv "$D/ent.tmp" "$ENT"; : > "$D/new.tmp"

  # aggregate: per-day totals by model, active 5-hour block (Claude), per-session totals
  awk -F'\t' -v now="$NOW" -v tz="$TZ_OFF" -v tool="$T" -v SESS="$D/sess.tmp" '
  function ymd(t,   z,era,doe,yoe,y,doy,mp,d,m) { z=int(t/86400)+719468; era=int(z/146097); doe=z-era*146097
    yoe=int((doe-int(doe/1460)+int(doe/36524)-int(doe/146096))/365); y=yoe+era*400; doy=doe-(365*yoe+int(yoe/4)-int(yoe/100))
    mp=int((5*doy+2)/153); d=doy-int((153*mp+2)/5)+1; m=mp+(mp<10?3:-9); if(m<=2)y++; return sprintf("%04d-%02d-%02d",y,m,d) }
  function fam(s) { s=tolower(s)
    if (tool=="claude") { if(s~/fable/)return "fable"; if(s~/opus/)return "opus"; if(s~/sonnet/)return "sonnet"; if(s~/haiku/)return "haiku"; return "other" }
    gsub(/[^a-z0-9.-]/,"_",s); return (s==""?"other":substr(s,1,24)) }
  function note(f) { if (!(f in seen)) { seen[f]=1; F[++nf]=f } }
  BEGIN { if (tool=="claude") { n=split("fable opus sonnet haiku other", P, " "); for(i=1;i<=n;i++) note(P[i]) } bs=0 }
  { t=$1; f=fam($3); note(f); tok=$4+$5+$6; d=ymd(t+tz)
    dt[d]+=tok; dc[d]+=$7; dm[d]++; di[d]+=$4; dout[d]+=$5; df[d,f]+=tok; wf[f]+=tok; last=t
    if (bs==0 || t>=bs+18000) { bs=t-(t%3600); bt=0; bc=0; bn=0 }
    bt+=tok; bc+=$7; bn++
    if ($8 != "") { ss=$8; if (!(ss in sf)) sf[ss]=t; if (t>=sl[ss]) { sl[ss]=t; if ($9 != "") sp[ss]=$9 }
      sft[ss,f]+=tok; if (sft[ss,f]>smax[ss]) { smax[ss]=sft[ss,f]; sfam[ss]=f }          # a session is labelled with the model that did most of its work
      st[ss]+=tok; sc[ss]+=$7; sm[ss]++ } }
  END {
    printf "{\"last\":%d,", last+0
    if (tool=="claude" && last>0 && now<bs+18000) printf "\"block\":{\"start\":%d,\"end\":%d,\"tokens\":%d,\"cache\":%d,\"msgs\":%d},", bs, bs+18000, bt, bc, bn; else printf "\"block\":null,"
    printf "\"days\":["
    for (i=7;i>=0;i--) { d=ymd(now+tz-i*86400)
      printf "%s{\"d\":\"%s\",\"tokens\":%d,\"cache\":%d,\"msgs\":%d,\"in\":%d,\"out\":%d,\"models\":{", (i<7?",":""), d, dt[d]+0, dc[d]+0, dm[d]+0, di[d]+0, dout[d]+0
      for (k=1;k<=nf;k++) printf "%s\"%s\":%d", (k>1?",":""), F[k], df[d,F[k]]+0
      printf "}}" }
    printf "],\"models\":{"
    for (k=1;k<=nf;k++) printf "%s\"%s\":%d", (k>1?",":""), F[k], wf[F[k]]+0
    printf "}}\n"
    for (ss in sf) printf "%s\t%s\t%d\t%d\t%d\t%d\t%d\t%s\n", ss, sp[ss], sf[ss], sl[ss], st[ss], sc[ss], sm[ss], sfam[ss] > SESS }' "$ENT" > "$D/agg.tmp"
  touch "$D/sess.tmp"
  sort -t"$TAB" -k4,4 -rn "$D/sess.tmp" | head -25 | jq -R -s -c 'split("\n") | map(select(length > 0) | split("\t") | {id: .[0], project: .[1], first: (.[2]|tonumber), last: (.[3]|tonumber), tokens: (.[4]|tonumber), cache: (.[5]|tonumber), msgs: (.[6]|tonumber), model: .[7]})' > "$D/sess.json.tmp"
  : > "$D/sess.tmp"
  local lim=null scan=null
  [ "$T" = codex ] && lim=$(limits_codex "$ROOT")
  [ "$done_n" -lt "$total_n" ] && scan="{\"done\":$done_n,\"total\":$total_n}"       # present only while older logs are still being read
  jq -c --slurpfile s "$D/sess.json.tmp" --argjson l "${lim:-null}" --argjson sc "$scan" --arg t "$T" \
    '{($t): (. + {sessions: $s[0]} + (if $l != null then {limits: $l} else {} end) + (if $sc != null then {scan: $sc} else {} end))}' "$D/agg.tmp" > "$D/part.tmp" \
    && jq -e . "$D/part.tmp" >/dev/null && mv "$D/part.tmp" "$A/part.$T.json"
  combine_all
  touch "$LOCK"                          # keep the single-run lock fresh during a long first scan
}

# --- generic incremental scan for one tool: newest logs first, publishing partial results as it goes
sync_tool() {                          # $1 = tool name, $2 = log root, $3 = extractor function
  local T="$1" ROOT="$2" EX="$3" D="$A/$1"; mkdir -p "$D"
  local OFF="$D/offsets.tsv" ENT="$D/entries.tsv"
  [ -d "$ROOT" ] || { rm -f "$A/part.$T.json"; return; }
  # schema 3: session id + project per message (worktree paths mapped to their project); older state is rebuilt once
  [ "$(cat "$D/schema" 2>/dev/null)" = 3 ] || { rm -f "$OFF" "$ENT"; echo 3 > "$D/schema"; }
  touch "$OFF" "$ENT"

  # 1) which logs changed: join current sizes with saved offsets; work list is newest-first
  find "$ROOT" -name '*.jsonl' -mtime -$DAYS -exec "${STATF[@]}" "$F_FULL" {} + 2>/dev/null > "$D/cur.tmp"
  awk -F'\t' -v W="$D/work.unsorted.tmp" -v K="$D/keep.tmp" 'FILENAME==ARGV[1]{o[$1]=$2;next}
    {p=$2; off=(p in o)?o[p]:0; if($3<off)off=0; if($3>off) print $1"\t"p"\t"$3"\t"off > W; else print p"\t"$3 > K}' "$OFF" "$D/cur.tmp"
  touch "$D/work.unsorted.tmp" "$D/keep.tmp"
  sort -rn -k1,1 "$D/work.unsorted.tmp" | cut -f2- > "$D/work.tmp"
  local total_n; total_n=$(wc -l < "$D/work.tmp" | tr -d ' ')

  # 2) parse only the new bytes of each changed log; publish early and then every ~25 s while working through a big backlog
  : > "$D/new.tmp"; : > "$D/off.tmp"
  local f size off part keep done_n=0 next_pub=$((SECONDS + 5))
  while IFS=$'\t' read -r f size off; do
    # don't consume a half-written last line: step the offset back over it
    if [ "$(tail -c +"$size" "$f" 2>/dev/null | head -c1 | od -An -c | tr -d ' ')" = '\n' ]; then part=0
    else part=$(tail -c 1048576 "$f" | awk 'END{print length($0)}'); fi
    keep=$((size - off - part)); [ "$keep" -lt 0 ] && keep=0
    tail -c +$((off + 1)) "$f" | head -c "$keep" | "$EX" "$f" >> "$D/new.tmp"
    printf '%s\t%s\n' "$f" $((off + keep)) >> "$D/off.tmp"
    done_n=$((done_n + 1))
    if [ "$done_n" -lt "$total_n" ] && [ "$SECONDS" -ge "$next_pub" ]; then
      cat "$D/off.tmp" "$D/keep.tmp" > "$D/off.snap.tmp" && mv "$D/off.snap.tmp" "$OFF"     # progress survives an interrupted run
      publish_tool "$done_n" "$total_n"; next_pub=$((SECONDS + 25))
    fi
  done < "$D/work.tmp"
  cat "$D/keep.tmp" >> "$D/off.tmp"; mv "$D/off.tmp" "$OFF"
  publish_tool "$total_n" "$total_n"
}

sync_tool claude "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects" extract_claude
sync_tool codex  "${CODEX_HOME:-$HOME/.codex}/sessions"        extract_codex

combine_all
exit 0
