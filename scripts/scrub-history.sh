#!/usr/bin/env bash
#
# scrub-history.sh — purge .env and data.js from the entire git history of
# this repo.
#
# Background:
#   - .env (live Foursquare API credentials) was committed and pushed to this
#     public repo in 62df7d5 / b3d43c8 (2024-06-04) and only untracked in
#     e8c995a (2026-09-19).
#   - data.js (cryptocurrency wallet seed phrases and addresses, NOT app data)
#     was committed in 0d08ca3 (2024-01-22) and deleted on 2026-09-19.
# Untracking or deleting does NOT remove a file from the commits that came
# before, so anyone can still `git show 62df7d5:.env` or `git show 0d08ca3:data.js`.
# This script rewrites history so that neither file ever existed.
#
# ---------------------------------------------------------------------------
#  READ BEFORE RUNNING
# ---------------------------------------------------------------------------
#
#  1. THIS REWRITES EVERY COMMIT HASH. All branches and tags get new SHAs.
#     Any open PRs, local clones held by collaborators, and links to specific
#     commits will break. Coordinate with anyone else who has a clone; they
#     must re-clone (not pull) after you push.
#
#  2. YOU MUST FORCE-PUSH AFTERWARDS. git-filter-repo deliberately removes the
#     `origin` remote so you can inspect the result before publishing it. This
#     script re-adds it for you but does NOT push. When you're satisfied, run:
#
#         git push --force --all origin
#         git push --force --tags origin
#
#     GitHub may keep the old commits reachable for a while (PR refs, cached
#     views, "activity" pages). Contact GitHub Support to purge unreachable
#     objects if you want them gone from the server side too.
#
#  3. ROTATE / MOVE EVERYTHING ANYWAY. Rewriting history does not un-leak a
#     secret. Forks, existing clones, GitHub's cached views, search engine
#     crawls, and secret-scanning bots have all had access to the old commits
#     since 2024-01-22. Treat everything as compromised:
#       - Foursquare: generate new keys in the developer console, revoke old.
#       - Wallets in data.js: if any seed phrase is real, move funds to a
#         freshly generated wallet FIRST, before running this script. Bots
#         scan GitHub for seed phrases continuously.
#     History scrubbing is hygiene, not remediation.
#
#  4. git-filter-repo refuses to run on anything but a fresh clone unless
#     forced, because a rewrite on a working repo with stashes, untracked
#     files, or extra refs can lose data. The safest workflow is:
#
#         git clone https://github.com/gadgetboy27/brains.js.git brains.js-scrub
#         cd brains.js-scrub
#         bash /path/to/scrub-history.sh
#
#     This script passes --force so it also works in place, but back up first.
#
# ---------------------------------------------------------------------------

set -euo pipefail

# --- preflight -------------------------------------------------------------

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "error: not inside a git repository" >&2
    exit 1
fi

if ! git filter-repo --version >/dev/null 2>&1; then
    cat >&2 <<'MSG'
error: git-filter-repo is not installed.

Install it with one of:
    brew install git-filter-repo
    pip install git-filter-repo
    https://github.com/newren/git-filter-repo#how-do-i-install-it
MSG
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "error: working tree is not clean; commit or stash your changes first" >&2
    exit 1
fi

# Capture the remote URL now — filter-repo deletes the `origin` remote.
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"

echo "Commits currently touching .env or data.js:"
git log --all --format='  %h  %ad  %s' --date=short -- .env data.js
echo

# --- rewrite ---------------------------------------------------------------

# --invert-paths: keep everything EXCEPT the listed paths.
# --force:        allow running on a non-fresh clone (see note 4 above).
git filter-repo --path .env --path data.js --invert-paths --force

# --- restore remote (NOT pushing) -----------------------------------------

if [ -n "$ORIGIN_URL" ]; then
    git remote add origin "$ORIGIN_URL"
    echo "Re-added remote 'origin' -> $ORIGIN_URL"
fi

# Drop leftover reflog/backup refs so the old objects can actually be gc'd
# locally. (This only affects YOUR clone; see note 2 about the server.)
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo
echo "Done. Verify that both files are gone from history:"
echo "    git log --all --oneline -- .env data.js   # should print nothing"
echo
echo "Then, when ready, force-push (this is NOT done automatically):"
echo "    git push --force --all origin"
echo "    git push --force --tags origin"
echo
echo "And ROTATE THE FOURSQUARE CREDENTIALS and MOVE ANY WALLET FUNDS — the old"
echo "secrets are still compromised regardless of this rewrite."
