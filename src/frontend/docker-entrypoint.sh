#!/bin/sh
set -e

# Replace environment variables in JavaScript files
# This allows runtime configuration without rebuilding the image

echo "Injecting runtime environment variables..."

# Create a runtime-env.js file with environment variables
cat > /usr/share/nginx/html/runtime-env.js <<EOF
window.ENV = {
  VITE_API_URL: "${VITE_API_URL:-http://localhost:3000}",
  VITE_API_VERSION: "${VITE_API_VERSION:-v1}",
  VITE_KEYCLOAK_URL: "${VITE_KEYCLOAK_URL:-http://localhost:8080}",
  VITE_KEYCLOAK_REALM: "${VITE_KEYCLOAK_REALM:-bookstore}",
  VITE_KEYCLOAK_CLIENT_ID: "${VITE_KEYCLOAK_CLIENT_ID:-bookstore-frontend}"
};
EOF

echo "Environment variables injected successfully"

# Execute the CMD
exec "$@"
