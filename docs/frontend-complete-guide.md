
# Frontend Complete Guide - Bookstore React Application

## Overview

The Bookstore frontend is a complete React 18 Single Page Application (SPA) that replicates all features from the AWS Bookstore Demo, migrated to work with Akamai App Platform.

## Architecture

```
User Browser
     ↓
Akamai CDN / Linode CDN
     ↓
Linode Object Storage (Static Files)
     ↓
React SPA (served as static files)
     ↓
API Calls → Istio Gateway → Knative Services
```

## Technology Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 5
- **State Management**: Redux Toolkit
- **Routing**: React Router v6
- **Authentication**: Keycloak (via @react-keycloak/web)
- **UI Library**: React Bootstrap 5
- **API Client**: Axios
- **Notifications**: React Toastify
- **Form Validation**: Formik + Yup

## Project Structure

```
src/frontend/
├── public/                    # Static assets
│   ├── images/
│   │   ├── books/            # Book cover images
│   │   └── logo.svg          # Application logo
│   ├── index.html            # HTML template
│   ├── favicon.svg           # Favicon
│   └── silent-check-sso.html # Keycloak SSO
│
├── src/
│   ├── components/           # Reusable components
│   │   ├── Header.tsx        # Navigation header
│   │   ├── Footer.tsx        # Footer
│   │   ├── ProductCard.tsx   # Product display card
│   │   ├── ProtectedRoute.tsx # Auth guard
│   │   ├── LoadingSpinner.tsx
│   │   └── ErrorMessage.tsx
│   │
│   ├── pages/                # Route pages
│   │   ├── HomePage.tsx      # Landing page with bestsellers
│   │   ├── ProductsPage.tsx  # Product catalog with filters
│   │   ├── ProductDetailPage.tsx # Single product view
│   │   ├── SearchPage.tsx    # Search results
│   │   ├── CartPage.tsx      # Shopping cart
│   │   ├── CheckoutPage.tsx  # Checkout flow
│   │   ├── OrdersPage.tsx    # Order history
│   │   └── NotFoundPage.tsx  # 404 page
│   │
│   ├── store/                # Redux state management
│   │   ├── index.ts          # Store configuration
│   │   └── slices/
│   │       ├── productsSlice.ts # Products state
│   │       ├── cartSlice.ts     # Cart state
│   │       ├── ordersSlice.ts   # Orders state
│   │       └── userSlice.ts     # User state
│   │
│   ├── services/             # External services
│   │   ├── api.ts           # API client with interceptors
│   │   └── keycloak.ts      # Keycloak configuration
│   │
│   ├── hooks/                # Custom React hooks
│   │   └── useAuth.ts       # Authentication hook
│   │
│   ├── types/                # TypeScript interfaces
│   │   └── index.ts         # Product, Cart, Order types
│   │
│   ├── utils/                # Utility functions
│   │   └── sampleBooks.ts   # Sample data helpers
│   │
│   ├── App.tsx               # Main application component
│   ├── main.tsx              # Application entry point
│   └── index.css             # Global styles
│
├── package.json              # Dependencies
├── vite.config.ts            # Vite configuration
├── tsconfig.json             # TypeScript configuration
├── .env.example              # Environment variables template
└── .env.production           # Production configuration
```

## Features Implemented

### ✅ Core Features (AWS Parity)

1. **Product Catalog**
   - Browse all books
   - Filter by category
   - View product details
   - Product ratings and reviews

2. **Search**
   - Full-text search
   - Search by title, author, category
   - Real-time search suggestions

3. **Shopping Cart**
   - Add/remove items
   - Update quantities
   - Persistent cart (stored in backend)
   - Cart badge with item count

4. **Checkout**
   - Review order
   - Place order
   - Order confirmation

5. **Orders**
   - View order history
   - Order details
   - Order status tracking

6. **Authentication**
   - Keycloak OAuth2/OIDC
   - Login/Logout
   - Protected routes
   - Token refresh

7. **Bestsellers**
   - Top selling books
   - Displayed on homepage

### 🆕 Enhanced Features (Beyond AWS)

1. **Modern UI/UX**
   - Responsive design (mobile, tablet, desktop)
   - Loading states
   - Error handling
   - Toast notifications

2. **Type Safety**
   - Full TypeScript implementation
   - Type-safe API calls
   - IntelliSense support

3. **State Management**
   - Redux Toolkit (modern Redux)
   - Async thunks for API calls
   - Centralized state

## Development Setup

### Prerequisites

- Node.js 20+
- npm or yarn

### Local Development

```bash
# Navigate to frontend directory
cd src/frontend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Update .env with local backend URLs
cat > .env <<EOF
VITE_API_URL=http://localhost:3000
VITE_API_VERSION=v1
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=bookstore
VITE_KEYCLOAK_CLIENT_ID=bookstore-frontend
EOF

# Start development server
npm run dev

# Application runs on http://localhost:3001
```

### Development Commands

```bash
# Start dev server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run linter
npm run lint

# Type check
npm run type-check  # (if configured)
```

## Deployment

### Option 1: Manual Deployment with Script

```bash
# From project root
./deploy-frontend.sh

# With custom bucket
./deploy-frontend.sh --bucket my-bookstore --region eu-central-1

# Skip build (use existing dist/)
./deploy-frontend.sh --skip-build

# With environment variables
VITE_API_URL=https://api.example.com ./deploy-frontend.sh
```

### Option 2: Tekton Pipeline (GitOps)

```bash
# Apply Tekton task
kubectl apply -f tekton/tasks/s3-upload-task.yaml

# Apply pipeline
kubectl apply -f tekton/pipeline-frontend-s3.yaml

# Create secret for Object Storage
kubectl create secret generic object-storage-credentials \
  --from-literal=access-key="YOUR_KEY" \
  --from-literal=secret-key="YOUR_SECRET" \
  -n bookstore

# Trigger pipeline run
kubectl create -f tekton/pipeline-frontend-s3.yaml

# Or use tkn CLI
tkn pipeline start bookstore-frontend-s3-deploy \
  --param git-url=https://github.com/YOUR_ORG/awsbookstoreconverter.git \
  --param git-revision=main \
  --param bucket-name=bookstore-frontend \
  --workspace name=shared-workspace,volumeClaimTemplateFile=workspace-template.yaml \
  -n bookstore
```

### Option 3: ArgoCD GitOps

```yaml
# Create ArgoCD Application for frontend
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: bookstore-frontend-pipeline
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/YOUR_ORG/awsbookstoreconverter.git
    targetRevision: HEAD
    path: tekton
  destination:
    server: https://kubernetes.default.svc
    namespace: bookstore
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `VITE_API_URL` | Backend API base URL | `http://localhost:3000` | ✅ |
| `VITE_API_VERSION` | API version | `v1` | ✅ |
| `VITE_KEYCLOAK_URL` | Keycloak server URL | `http://localhost:8080` | ✅ |
| `VITE_KEYCLOAK_REALM` | Keycloak realm name | `bookstore` | ✅ |
| `VITE_KEYCLOAK_CLIENT_ID` | Keycloak client ID | `bookstore-frontend` | ✅ |
| `VITE_APP_NAME` | Application name | `Bookstore` | ❌ |

### API Endpoints Used

The frontend consumes the following API endpoints:

- `GET /api/v1/products` - List all products
- `GET /api/v1/products/:id` - Get product details
- `GET /api/v1/products/category/:category` - Filter by category
- `GET /api/v1/products/bestsellers` - Get bestsellers
- `GET /api/v1/search?q=query` - Search products
- `GET /api/v1/cart/:userId` - Get user cart
- `POST /api/v1/cart/:userId/items` - Add to cart
- `PUT /api/v1/cart/:userId/items/:productId` - Update cart item
- `DELETE /api/v1/cart/:userId/items/:productId` - Remove from cart
- `DELETE /api/v1/cart/:userId` - Clear cart
- `POST /api/v1/orders` - Create order
- `GET /api/v1/orders/:userId` - Get user orders
- `GET /api/v1/recommendations/:userId` - Get recommendations

## Testing

### Unit Tests (TODO)

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage
```

### E2E Tests (TODO)

```bash
# Run E2E tests with Playwright/Cypress
npm run test:e2e
```

### Manual Testing Checklist

- [ ] Homepage loads with bestsellers
- [ ] Browse products page with filters
- [ ] Search functionality
- [ ] Product detail page
- [ ] Add to cart (requires login)
- [ ] Cart page with quantity updates
- [ ] Checkout flow
- [ ] Order confirmation
- [ ] Order history
- [ ] Login/Logout
- [ ] Protected routes redirect to login
- [ ] Token refresh on expiry
- [ ] Responsive design (mobile/tablet/desktop)

## Troubleshooting

### CORS Issues

If you see CORS errors in the browser console:

1. **Backend CORS Configuration**: Ensure API allows frontend origin

```typescript
// src/api/src/server.ts
app.use(cors({
  origin: [
    'http://localhost:3001',
    'https://bookstore.example.com',
    'https://bookstore-frontend.us-east-1.linodeobjects.com',
    'https://bookstore-frontend.us-east-1.cdn.linode.com'
  ],
  credentials: true
}));
```

2. **Istio Gateway CORS**: Check VirtualService configuration

```yaml
# kubernetes/base/gateway/istio-gateway.yaml
corsPolicy:
  allowOrigins:
  - exact: "https://bookstore.example.com"
  - regex: "https://.*\\.linodeobjects\\.com"
  allowCredentials: true
```

### Keycloak Authentication Issues

1. **Check Keycloak Configuration**:
   - Realm exists: `bookstore`
   - Client exists: `bookstore-frontend`
   - Client type: `public`
   - Valid redirect URIs: `https://bookstore.example.com/*`
   - Web origins: `https://bookstore.example.com`

2. **Check Environment Variables**:
   - `VITE_KEYCLOAK_URL` matches actual Keycloak URL
   - Realm and client ID match Keycloak configuration

3. **Network Issues**:
   - Keycloak must be accessible from user's browser
   - Check browser console for network errors

### Build Issues

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Vite cache
rm -rf node_modules/.vite

# Check Node version
node --version  # Should be 20+
```

### Deployment Issues

```bash
# Test s3cmd configuration
s3cmd ls

# Test bucket access
s3cmd ls s3://bookstore-frontend/

# Verify files uploaded
s3cmd ls -r s3://bookstore-frontend/

# Check bucket website configuration
s3cmd info s3://bookstore-frontend/
```

## Performance Optimization

### Build Optimization

The Vite build automatically:
- Code splitting
- Tree shaking
- Minification
- Asset optimization
- Source maps for debugging

### CDN Configuration

Use Linode CDN or Akamai CDN for:
- Global distribution
- Edge caching
- DDoS protection
- SSL/TLS termination

### Cache Strategy

- **HTML files**: No cache (`Cache-Control: no-cache`)
- **JS/CSS/Images**: Long cache (`Cache-Control: max-age=31536000, immutable`)

## Security

### Implemented Security Measures

1. **Authentication**: Keycloak OAuth2/OIDC
2. **Token Refresh**: Automatic token renewal
3. **Protected Routes**: Client-side route guards
4. **HTTPS**: Enforced in production
5. **Content Security Policy**: Configured via CDN
6. **XSS Protection**: React's built-in protection

### Security Best Practices

- Never commit `.env` files with secrets
- Use Sealed Secrets for Kubernetes
- Enable HTTPS in production
- Configure CSP headers
- Regular dependency updates
- Security audits: `npm audit`

## Comparison with AWS Original

| Feature | AWS Bookstore | This Implementation | Status |
|---------|---------------|---------------------|--------|
| Frontend Framework | React | React 18 + TypeScript | ✅ Enhanced |
| State Management | Redux | Redux Toolkit | ✅ Enhanced |
| Build Tool | Webpack | Vite | ✅ Faster |
| Hosting | S3 + CloudFront | Object Storage + CDN | ✅ Equivalent |
| Authentication | Cognito | Keycloak | ✅ Equivalent |
| API Client | Axios | Axios with interceptors | ✅ Enhanced |
| CI/CD | CodeBuild → S3 | Tekton → Object Storage | ✅ Cloud-native |
| Type Safety | Limited | Full TypeScript | ✅ Enhanced |
| UI Library | React Bootstrap | React Bootstrap 5 | ✅ Updated |

## Future Enhancements

- [ ] Add unit tests (Jest + React Testing Library)
- [ ] Add E2E tests (Playwright or Cypress)
- [ ] Implement PWA features (offline support)
- [ ] Add internationalization (i18n)
- [ ] Implement dark mode
- [ ] Add more animations and transitions
- [ ] Implement product reviews and ratings UI
- [ ] Add wishlist functionality
- [ ] Implement social sharing
- [ ] Add analytics integration

## Resources

- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vitejs.dev/)
- [Redux Toolkit](https://redux-toolkit.js.org/)
- [React Router](https://reactrouter.com/)
- [Keycloak Documentation](https://www.keycloak.org/docs/latest/)
- [Linode Object Storage](https://www.linode.com/docs/products/storage/object-storage/)
- [Tekton Pipelines](https://tekton.dev/)

## Support

For issues and questions:
- Check this documentation
- Review Tekton pipeline logs
- Check browser console for errors
- Verify API connectivity
- Review Keycloak configuration
