#!/usr/bin/env bash
# Usage:
#   ./build.sh          compile schemas (needed when running from this folder)
#   ./build.sh pack     build the zip for extensions.gnome.org and GitHub releases
set -euo pipefail
cd "$(dirname "$0")"
UUID="glass-windows@himuraw"

case "${1:-schemas}" in
schemas)
    glib-compile-schemas --strict schemas
    ;;
pack)
    extra=()
    for js in *.js; do [[ "$js" == extension.js || "$js" == eslint.config.js ]] || extra+=(--extra-source="$js"); done
    gnome-extensions pack --force --schema=schemas/org.gnome.shell.extensions.glass-windows.gschema.xml \
        --extra-source=LICENSE "${extra[@]}" .
    ;;
esac
