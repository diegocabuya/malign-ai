#!/bin/sh
set -eu

database_name="${1:?usage: m2a-backup.sh malign_m2a_database output.dump}"
output_path="${2:?usage: m2a-backup.sh malign_m2a_database output.dump}"
case "$database_name" in
  malign_m2a_*) ;;
  *) echo "database must use the malign_m2a_ prefix" >&2; exit 2 ;;
esac

pg_bin="${MALIGN_PG_BIN:-/usr/local/bin}"
"$pg_bin/pg_dump" --format=custom --file="$output_path" "$database_name"
"$pg_bin/pg_restore" --list "$output_path"
