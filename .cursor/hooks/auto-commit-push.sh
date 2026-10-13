#!/usr/bin/env bash
# After each agent turn: commit safe frontend files on redesign and push.
# Fail open. Never commit secrets. Stdout must stay JSON for Cursor.

set -u
cat >/dev/null || true

ok() {
  printf '%s\n' '{ }'
  exit 0
}

trap ok EXIT

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT" || exit 0

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ "$branch" != "redesign" ]; then
  exit 0
fi

if [ -d "$ROOT/.git/rebase-merge" ] || [ -d "$ROOT/.git/rebase-apply" ] || [ -f "$ROOT/.git/MERGE_HEAD" ]; then
  exit 0
fi

# Stage only product files. Secrets and local Cursor settings stay out.
git add -- \
  DESIGN_NOTES.md \
  index.html \
  public \
  src \
  .cursor/hooks.json \
  .cursor/hooks \
  .cursor/rules \
  .env.example \
  2>/dev/null || true

# Drop anything that looks like a secret if it slipped in.
git diff --cached --name-only 2>/dev/null | while IFS= read -r file; do
  case "$file" in
    *.env|*.env.*|.env|.env.*)
      git restore --staged -- "$file" 2>/dev/null || true
      ;;
    functions/.env*|**/.env*)
      git restore --staged -- "$file" 2>/dev/null || true
      ;;
  esac
done

if git diff --cached --quiet 2>/dev/null; then
  exit 0
fi

git commit -m "$(cat <<'EOF'
Auto: save redesign work.

Keep the last agent turn on GitHub without a manual commit.
EOF
)" >/dev/null 2>&1 || true

git push -u origin HEAD >/dev/null 2>&1 || true
