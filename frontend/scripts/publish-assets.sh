#!/bin/sh
set -eu

output=/output
assets="$output/assets"
mkdir -p "$assets"

# Hashed files are copied first and retained for seven days so a browser that
# loaded the previous index can still finish loading its JS and CSS.
if [ -d /dist/assets ]; then
  cp -a /dist/assets/. "$assets/"
fi

# Publish root metadata before index.html. Each rename stays on the volume's
# filesystem, so readers see either the old file or the complete new file.
for source in /dist/*; do
  name="$(basename "$source")"
  if [ "$name" = assets ] || [ "$name" = index.html ]; then
    continue
  fi
  temporary="$output/.${name}.new.$$"
  cp -a "$source" "$temporary"
  mv -f "$temporary" "$output/$name"
done

index_temporary="$output/.index.html.new.$$"
cp /dist/index.html "$index_temporary"
mv -f "$index_temporary" "$output/index.html"

find "$assets" -type f -mtime +7 -delete
find "$assets" -depth -type d -empty -delete
