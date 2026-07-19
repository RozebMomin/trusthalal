#!/usr/bin/env bash
#
# Double-click me in Finder to run the whole API test suite.
#
# For a subset (a single file, -k, --lf) use run-api-tests.sh from a
# terminal instead — a double-click has nowhere to type arguments.

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

./run-api-tests.sh
STATUS=$?

echo
if [ $STATUS -eq 0 ]; then
  echo "All tests passed."
else
  echo "Tests failed (exit $STATUS). Scroll up for the failures."
fi
echo
read -n 1 -s -r -p "Press any key to close…"
echo
