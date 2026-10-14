#!/bin/sh
set -eu

source_dir="${ASSETS_SOURCE:-/dist}"
output_dir="${ASSETS_OUTPUT:-/output}"

test -s "$source_dir/index.html"
test -s "$source_dir/version.json"
mkdir -p "$output_dir/assets"

# Publish hashed files first so old and new pages can both load during an update.
if [ -d "$source_dir/assets" ]; then
  cp -R "$source_dir/assets/." "$output_dir/assets/"
fi
for source in "$source_dir"/*; do
  case "${source##*/}" in
    assets|index.html|version.json) continue ;;
  esac
  cp -R "$source" "$output_dir/"
done

# Rename within the volume so readers never see a partially copied entry page.
cp "$source_dir/version.json" "$output_dir/.version.json.new"
cp "$source_dir/index.html" "$output_dir/.index.html.new"
mv -f "$output_dir/.version.json.new" "$output_dir/version.json"
mv -f "$output_dir/.index.html.new" "$output_dir/index.html"

# Keep old hashed files briefly for tabs opened before this release.
find "$output_dir/assets" -type f -mtime +7 -exec rm -f '{}' ';'
