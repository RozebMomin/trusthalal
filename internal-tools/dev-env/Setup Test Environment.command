#!/usr/bin/env bash
#
# Double-click me in Finder.
#
# macOS opens .command files in Terminal and runs them, so this is the
# literal one-click entry point. It exists only to (a) cd to its own
# directory, because Finder launches with $HOME as the working directory,
# and (b) keep the window open afterwards so you can actually read what
# happened instead of watching Terminal vanish on completion.

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

./setup-test-env.sh
STATUS=$?

echo
if [ $STATUS -eq 0 ]; then
  echo "Done. You can close this window."
else
  echo "Setup failed (exit $STATUS). The error is above."
fi
echo
read -n 1 -s -r -p "Press any key to close…"
echo
