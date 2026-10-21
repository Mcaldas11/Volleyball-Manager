#!/bin/sh
# The download zips, rebuilt in the background after every commit (run by .git/hooks/post-commit —
# `npm run hooks` puts the hook in place): itch/volleyball-manager-web.zip and
# release/volleyball-manager-<version>-windows.zip. The commit itself never waits.
#
# Commits in quick succession don't start builds side by side: one runs, and if more commits came
# in meanwhile it builds once more at the end, from the latest. Progress and errors go to
# .git/vm-build/build.log.

cd "$(git rev-parse --show-toplevel)" || exit 0
STATE=.git/vm-build
mkdir -p "$STATE"
touch "$STATE/pending"

# A build already running picks this commit up when it finishes — unless it is a stale marker,
# left by a build cut short (the PC switched off): older than half an hour, it doesn't count.
if [ -f "$STATE/running" ] && [ -z "$(find "$STATE/running" -mmin +30 2>/dev/null)" ]; then
  exit 0
fi

(
  # Committing from inside VS Code can leave Electron told to act as plain Node.
  unset ELECTRON_RUN_AS_NODE
  touch "$STATE/running"
  while [ -f "$STATE/pending" ]; do
    rm -f "$STATE/pending"
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') building downloads for: $(git log --oneline -1)"
    if npm run itch && npm run desktop -- win; then
      echo "=== done: itch/volleyball-manager-web.zip and release/*-windows.zip are up to date"
    else
      echo "=== FAILED — see the errors above; the zips were left as they were"
    fi
  done
  rm -f "$STATE/running"
) >> "$STATE/build.log" 2>&1 < /dev/null &

exit 0
