#!/usr/bin/env bash
# Create persistent upload directories on HostingRaja (run once as the app user).
# Usage:
#   bash backend/scripts/setup-uploads-hostingraja.sh
#   bash backend/scripts/setup-uploads-hostingraja.sh /home/YOURUSER/aaoms-data/uploads

set -euo pipefail

UPLOAD_ROOT="${1:-$HOME/aaoms-data/uploads}"

echo "==> Creating upload tree at: $UPLOAD_ROOT"

mkdir -p \
  "$UPLOAD_ROOT/profile" \
  "$UPLOAD_ROOT/products" \
  "$UPLOAD_ROOT/videos" \
  "$UPLOAD_ROOT/banners" \
  "$UPLOAD_ROOT/testimonials" \
  "$UPLOAD_ROOT/gallery" \
  "$UPLOAD_ROOT/documents"

# Writable by app user; readable by web/node process
chmod -R u+rwX,go+rX "$UPLOAD_ROOT"

echo "==> Directory listing:"
find "$UPLOAD_ROOT" -maxdepth 1 -type d | sort

echo ""
echo "Done. Set in backend/.env (or process env):"
echo "  UPLOADS_DIR=$UPLOAD_ROOT"
echo "  BACKEND_PUBLIC_URL=https://YOUR-DOMAIN"
echo ""
echo "Then restart Node (example):"
echo "  pm2 restart aaoms-backend --update-env"
echo "  # or: systemctl restart your-node-service"
