#!/usr/bin/env bash
# install.sh — installs speckit-autopilot skills globally for Claude Code
# Structure: ~/.claude/skills/<skill-name>/SKILL.md  →  invoked as /<skill-name>
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/skills" && pwd)"
DEST_BASE="$HOME/.claude/skills"

echo "Installing speckit-autopilot skills..."
echo "  Source : $SOURCE_DIR"
echo "  Dest   : $DEST_BASE"
echo ""

for src in "$SOURCE_DIR"/*.md; do
  skill=$(basename "$src" .md)
  dest_dir="$DEST_BASE/$skill"
  dest_file="$dest_dir/SKILL.md"

  mkdir -p "$dest_dir"

  # Write frontmatter + content
  {
    echo "---"
    echo "name: $skill"
    echo "description: speckit-autopilot $skill"
    echo "---"
    echo ""
    cat "$src"
  } > "$dest_file"

  echo "  /$skill  →  $dest_file"
done

echo ""
echo "Done. Restart Claude Code to pick up the new skills."
