#!/bin/sh
# Build the ZIP that you upload to Claude (Settings > Capabilities > Skills).
set -e
cd "$(dirname "$0")/../skill"
mkdir -p ../dist
rm -f ../dist/study-highlighter.zip
zip -rq -X ../dist/study-highlighter.zip study-highlighter -x '*.DS_Store'
echo "wrote dist/study-highlighter.zip"
