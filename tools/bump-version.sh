#!/bin/sh
# Проставляет версию (короткий sha текущего коммита) в ссылки на JS/CSS и version.json.
# Запуск после коммита изменений:  sh tools/bump-version.sh && git commit -am "версия"
set -e
cd "$(dirname "$0")/.."
V=$(git rev-parse --short HEAD)
sed -i -E "s/\?v=[A-Za-z0-9_]+\"/?v=$V\"/g; s/VP_VERSION = \"[A-Za-z0-9_]+\"/VP_VERSION = \"$V\"/" index.html
printf '{"version":"%s"}\n' "$V" > version.json
echo "version $V"
