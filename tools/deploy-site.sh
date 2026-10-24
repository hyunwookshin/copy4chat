#!/usr/bin/env bash
# Build and publish copy4chat.com.
#
# Hashed-forever caching would need filename hashing the site does not have,
# so assets get a short max-age and HTML is always revalidated. An
# invalidation then makes a deploy visible immediately.
set -euo pipefail
cd "$(dirname "$0")/.."

BUCKET="${C4C_BUCKET:-copy4chat-site-417681847926}"
DIST="${C4C_DISTRIBUTION:-E359YBLWEDACGV}"

./tools/build-site.sh >/dev/null
echo "built site/dist"

# Long-lived assets first, then HTML with no-cache so a deploy is never
# served stale from a browser that already has the old page.
aws s3 sync site/dist "s3://$BUCKET" \
  --delete --exclude "*.html" \
  --cache-control "public, max-age=3600"
aws s3 sync site/dist "s3://$BUCKET" \
  --delete --exclude "*" --include "*.html" \
  --cache-control "no-cache, must-revalidate" --content-type "text/html; charset=utf-8"

ID=$(aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" \
     --query "Invalidation.Id" --output text)
echo "invalidation $ID queued"
echo "https://copy4chat.com/"
