#!/bin/sh
# Development entrypoint.
#
# Two compilers run in watch mode — the shared package and the service — and the
# process itself is started with `node --watch`. Node restarts on a change to
# *any* file it has loaded, which covers packages/shared/dist as well as the
# service's own output, so an edit anywhere in the workspace reloads the service.
# (Nest's own --watch only knows about the service's sources.)
set -e

pnpm --filter @paynad/shared dev &
pnpm exec tsc -p tsconfig.build.json --watch --preserveWatchOutput &

# The first compilation may not have landed yet when the container starts.
while [ ! -f dist/main.js ]; do
  sleep 0.5
done

exec node --watch --enable-source-maps --inspect=0.0.0.0:9229 dist/main.js
