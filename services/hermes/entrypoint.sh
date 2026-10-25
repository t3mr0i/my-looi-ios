#!/bin/sh
set -eu
umask 077

DATA_DIR=/opt/data/looi-hermes
UID_EXPECTED=10000
GID_EXPECTED=10000

if [ "$(id -u)" -eq 0 ]; then
    if ! command -v setpriv >/dev/null 2>&1; then
        echo "looi-hermes: required setpriv is unavailable" >&2
        exit 1
    fi

    mkdir -p "$DATA_DIR"
    chown -R "$UID_EXPECTED:$GID_EXPECTED" "$DATA_DIR"
    exec setpriv \
        --reuid="$UID_EXPECTED" \
        --regid="$GID_EXPECTED" \
        --clear-groups \
        --no-new-privs \
        -- "$@"
fi

if [ "$(id -u)" -eq "$UID_EXPECTED" ] && [ -d "$DATA_DIR" ] && [ -w "$DATA_DIR" ]; then
    exec "$@"
fi

echo "looi-hermes: start as root for volume initialization or UID $UID_EXPECTED with a writable data directory" >&2
exit 1
