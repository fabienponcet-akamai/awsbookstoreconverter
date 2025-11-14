#!/bin/bash
# Frontend deployment script to Linode Object Storage
# Exactly like AWS S3 + CloudFront approach

set -e

# Configuration
BUCKET_NAME="${BUCKET_NAME:-bookstore-frontend}"
CLUSTER="${CLUSTER:-us-east-1}"
CDN_DOMAIN="${CDN_DOMAIN:-$BUCKET_NAME.$CLUSTER.cdn.linode.com}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Bookstore Frontend Deployment${NC}"
echo "=================================="

# Check prerequisites
command -v s3cmd >/dev/null 2>&1 || {
  echo -e "${RED}❌ s3cmd is required but not installed.${NC}"
  echo "Install with: pip install s3cmd"
  exit 1
}

# Check s3cmd configuration
if [ ! -f ~/.s3cfg ]; then
  echo -e "${YELLOW}⚠️  s3cmd not configured. Please run:${NC}"
  echo "s3cmd --configure"
  echo "Or set ACCESS_KEY and SECRET_KEY environment variables"
  exit 1
fi

# Build React frontend
echo -e "${GREEN}📦 Building React frontend...${NC}"
cd src/frontend

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Build for production
npm run build

if [ ! -d "dist" ]; then
  echo -e "${RED}❌ Build failed - dist directory not found${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Build completed${NC}"

# Upload to Linode Object Storage
echo -e "${GREEN}📤 Uploading to Linode Object Storage...${NC}"

# Upload non-HTML files with long cache
echo "Uploading static assets (with 1 year cache)..."
s3cmd sync --delete-removed \
  --acl-public \
  --no-mime-magic \
  --guess-mime-type \
  --add-header="Cache-Control: public, max-age=31536000, immutable" \
  --exclude="*.html" \
  --exclude="*.map" \
  dist/ s3://$BUCKET_NAME/

# Upload HTML files with no cache (for instant updates)
echo "Uploading HTML files (no cache)..."
s3cmd sync --delete-removed \
  --acl-public \
  --no-mime-magic \
  --guess-mime-type \
  --add-header="Cache-Control: no-cache, no-store, must-revalidate" \
  --add-header="Pragma: no-cache" \
  --add-header="Expires: 0" \
  --include="*.html" \
  dist/ s3://$BUCKET_NAME/

echo -e "${GREEN}✅ Upload completed${NC}"

# Display URLs
echo ""
echo -e "${GREEN}🎉 Deployment successful!${NC}"
echo "=================================="
echo ""
echo -e "${YELLOW}Access URLs:${NC}"
echo "  Direct URL: https://$BUCKET_NAME.$CLUSTER.linodeobjects.com"
echo "  CDN URL:    https://$CDN_DOMAIN"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Configure DNS CNAME to point to CDN:"
echo "     bookstore.example.com → $CDN_DOMAIN"
echo "  2. Configure CORS on API to allow:"
echo "     https://$CDN_DOMAIN"
echo "  3. Test the deployment:"
echo "     curl -I https://$CDN_DOMAIN"
echo ""
