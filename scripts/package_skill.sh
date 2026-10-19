#!/bin/sh
# Build the two release files in dist/:
#   study-highlighter.zip             upload to Claude (Settings > Capabilities > Skills)
#   highlighter-for-claude-extension.zip  unzip, then "Load unpacked" in chrome://extensions
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/study-highlighter.zip dist/highlighter-for-claude-extension.zip
(cd skill && zip -rq -X ../dist/study-highlighter.zip study-highlighter -x '*.DS_Store')
(cd extension && zip -rq -X ../dist/highlighter-for-claude-extension.zip . -x '*.DS_Store')
echo "wrote dist/study-highlighter.zip"
echo "wrote dist/highlighter-for-claude-extension.zip"
