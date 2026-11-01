#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]!==24||v[1]<21){console.error('Use Node.js 24.21.0 LTS ou atualizacao posterior da linha 24.');process.exit(1)}"
[ -d node_modules/pdf-lib ] || npm ci
node server.js
