#!/usr/bin/env bash
# Ejecuta todas las pruebas: sintaxis de la web, backend contra una hoja simulada y publicación con la API de Google simulada.
set -u
cd "$(dirname "$0")/.."
fallos=0
for f in web/*.js .github/scripts/*.mjs; do node --check "$f" || fallos=1; done
cp apps-script/Code.gs /tmp/_code_check.js && node --check /tmp/_code_check.js || fallos=1
for t in tests/*.test.js tests/*.test.mjs; do
  out=$(node "$t" 2>&1); code=$?
  ok=$(printf '%s\n' "$out" | grep -c '^ok')
  if [ $code -ne 0 ] || printf '%s\n' "$out" | grep -q '^FAIL'; then
    echo "✗ $t"; printf '%s\n' "$out" | grep -v '^ok'; fallos=1
  else
    echo "✓ $t ($ok)"
  fi
done
[ $fallos -eq 0 ] && echo "Todo correcto." || { echo "HAY FALLOS"; exit 1; }
