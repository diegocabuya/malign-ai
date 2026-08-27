#!/bin/sh
set -eu

database_name="${1:?usage: m2a-restore.sh malign_m2a_database input.dump}"
input_path="${2:?usage: m2a-restore.sh malign_m2a_database input.dump}"
case "$database_name" in
  malign_m2a_*) ;;
  *) echo "database must use the malign_m2a_ prefix" >&2; exit 2 ;;
esac

pg_bin="${MALIGN_PG_BIN:-/usr/local/bin}"
"$pg_bin/createdb" "$database_name"
"$pg_bin/pg_restore" --exit-on-error --dbname="$database_name" "$input_path"
