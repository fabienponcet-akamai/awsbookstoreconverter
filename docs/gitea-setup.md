# Gitea Setup for Bookstore - APL Core Git Service

## Overview

Gitea is included in APL Core as a self-hosted Git service. This provides a **100% cloud-native, self-contained** solution without external dependencies on GitHub or GitLab.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Akamai App Platform (LKE)              │
│                                                     │
│  ┌──────────┐    ┌─────────────┐    ┌──────────┐  │
│  │  Gitea   │───▶│   Tekton    │───▶│ Knative  │  │
│  │  (Git)   │    │  Pipelines  │    │ Services │  │
│  └──────────┘    └─────────────┘    └──────────┘  │
│       │                  │                          │
│       │                  ▼                          │
│       │          ┌──────────────┐                   │
│       │          │ Object Store │                   │
│       │          │  (Frontend)  │                   │
│       │          └──────────────┘                   │
│       ▼                                             │
│  ┌──────────┐                                       │
│  │ ArgoCD   │  (monitors Gitea repos)               │
│  └──────────┘                                       │
└─────────────────────────────────────────────────────┘
```

## Benefits of Using Gitea

✅ **100% Self-Hosted** - No external Git service needed
✅ **APL Core Included** - Already installed with APL
✅ **Private Repositories** - Full control over code
✅ **Webhook Support** - Triggers for Tekton Pipelines
✅ **GitOps Ready** - Works with ArgoCD
✅ **Cost Effective** - No GitHub/GitLab subscription
✅ **Fast** - No external network calls
✅ **Compliant** - Data stays in your infrastructure

## Prerequisites

- APL Core installed on LKE
- Gitea deployed (part of APL Core bootstrap)
- `kubectl` access to cluster

## Step 1: Access Gitea

### Get Gitea URL

```bash
# Get Gitea service
kubectl get svc -n gitea

# Port forward for local access (development)
kubectl port-forward svc/gitea-http -n gitea 3000:3000

# Access: http://localhost:3000
```

### Get Gitea Admin Password

```bash
# Get admin password from secret
kubectl get secret gitea-admin-secret -n gitea -o jsonpath="{.data.password}" | base64 -d
echo

# Or from APL installation logs
```

### Initial Gitea Setup

1. **Access Gitea UI**: http://gitea.example.com (or localhost:3000)
2. **Login**:
   - Username: `gitea_admin`
   - Password: (from secret above)
3. **Configure**:
   - Go to Settings → Applications
   - Create Access Token for automation

## Step 2: Create Repository in Gitea

### Via Web UI

1. Click **+** → New Repository
2. Repository name: `awsbookstoreconverter`
3. Description: "AWS Bookstore migrated to APL"
4. Visibility: Private
5. Initialize: No (we'll push existing code)
6. Click **Create Repository**

### Via Git CLI

```bash
# Add Gitea remote
git remote add gitea http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git

# Or if using external URL
git remote add gitea https://gitea.example.com/gitea_admin/awsbookstoreconverter.git

# Push to Gitea
git push gitea main

# Set Gitea as default upstream
git remote set-url origin http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git
```

## Step 3: Configure Git Credentials for Tekton

### Create Secret for Git Clone

```bash
# Method 1: Using token
kubectl create secret generic gitea-credentials \
  --from-literal=username=gitea_admin \
  --from-literal=password=YOUR_GITEA_TOKEN \
  -n bookstore

# Add annotation for Tekton
kubectl annotate secret gitea-credentials \
  tekton.dev/git-0=http://gitea.gitea.svc.cluster.local:3000 \
  -n bookstore

# Method 2: Using SSH key (recommended for production)
ssh-keygen -t ed25519 -C "tekton@bookstore" -f gitea-ssh-key

# Add public key to Gitea (Settings → SSH Keys)

# Create Kubernetes secret
kubectl create secret generic gitea-ssh-key \
  --from-file=ssh-privatekey=gitea-ssh-key \
  --from-literal=known_hosts="$(ssh-keyscan gitea.gitea.svc.cluster.local)" \
  -n bookstore

kubectl annotate secret gitea-ssh-key \
  tekton.dev/git-0=gitea.gitea.svc.cluster.local \
  -n bookstore
```

## Step 4: Update Tekton Pipelines for Gitea

### Update git-url Parameter

Edit pipeline runs to use Gitea internal URL:

```yaml
# tekton/pipeline-frontend-s3.yaml
apiVersion: tekton.dev/v1beta1
kind: PipelineRun
metadata:
  generateName: bookstore-frontend-s3-deploy-run-
  namespace: bookstore
spec:
  pipelineRef:
    name: bookstore-frontend-s3-deploy
  params:
  - name: git-url
    # Internal cluster URL (faster, no external network)
    value: http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git
    # Or external URL if needed
    # value: https://gitea.example.com/gitea_admin/awsbookstoreconverter.git
  - name: git-revision
    value: main
  workspaces:
  - name: shared-workspace
    volumeClaimTemplate:
      spec:
        accessModes:
        - ReadWriteOnce
        resources:
          requests:
            storage: 1Gi
  # Link Gitea credentials
  serviceAccountName: tekton-gitea-sa
```

### Create Service Account with Gitea Access

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: tekton-gitea-sa
  namespace: bookstore
secrets:
- name: gitea-credentials
- name: object-storage-credentials
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: tekton-gitea-role
  namespace: bookstore
rules:
- apiGroups: [""]
  resources: ["pods", "services", "secrets", "configmaps"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["tekton.dev"]
  resources: ["pipelineruns", "taskruns"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: tekton-gitea-binding
  namespace: bookstore
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: tekton-gitea-role
subjects:
- kind: ServiceAccount
  name: tekton-gitea-sa
  namespace: bookstore
```

## Step 5: Configure Webhooks (Tekton Triggers)

### Install Tekton Triggers (if not already)

```bash
# Tekton Triggers is included in APL Core
# Verify installation
kubectl get pods -n tekton-pipelines | grep triggers
```

### Create EventListener for Gitea Webhooks

```yaml
apiVersion: triggers.tekton.dev/v1beta1
kind: EventListener
metadata:
  name: gitea-listener
  namespace: bookstore
spec:
  serviceAccountName: tekton-gitea-sa
  triggers:
  - name: gitea-push-trigger
    interceptors:
    - ref:
        name: "gitea"
      params:
      - name: "secretRef"
        value:
          secretName: gitea-webhook-secret
          secretKey: webhook-secret
      - name: "eventTypes"
        value: ["push"]
    bindings:
    - ref: gitea-push-binding
    template:
      ref: gitea-pipeline-template
---
apiVersion: v1
kind: Secret
metadata:
  name: gitea-webhook-secret
  namespace: bookstore
type: Opaque
stringData:
  webhook-secret: "changeme-webhook-secret"  # Generate with: openssl rand -hex 20
```

### Create TriggerBinding

```yaml
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerBinding
metadata:
  name: gitea-push-binding
  namespace: bookstore
spec:
  params:
  - name: git-repo-url
    value: $(body.repository.clone_url)
  - name: git-revision
    value: $(body.after)  # Commit SHA
  - name: git-repo-name
    value: $(body.repository.name)
```

### Create TriggerTemplate

```yaml
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerTemplate
metadata:
  name: gitea-pipeline-template
  namespace: bookstore
spec:
  params:
  - name: git-repo-url
    description: The git repository URL
  - name: git-revision
    description: The git revision (commit SHA)
  - name: git-repo-name
    description: The repository name
  resourcetemplates:
  - apiVersion: tekton.dev/v1beta1
    kind: PipelineRun
    metadata:
      generateName: gitea-triggered-run-
      namespace: bookstore
    spec:
      pipelineRef:
        name: bookstore-frontend-s3-deploy
      params:
      - name: git-url
        value: $(tt.params.git-repo-url)
      - name: git-revision
        value: $(tt.params.git-revision)
      workspaces:
      - name: shared-workspace
        volumeClaimTemplate:
          spec:
            accessModes:
            - ReadWriteOnce
            resources:
              requests:
                storage: 1Gi
      serviceAccountName: tekton-gitea-sa
```

### Expose EventListener

```yaml
apiVersion: v1
kind: Service
metadata:
  name: el-gitea-listener
  namespace: bookstore
spec:
  type: ClusterIP
  selector:
    eventlistener: gitea-listener
  ports:
  - port: 8080
    targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: gitea-webhook-ingress
  namespace: bookstore
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - webhook.bookstore.example.com
    secretName: webhook-tls
  rules:
  - host: webhook.bookstore.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: el-gitea-listener
            port:
              number: 8080
```

## Step 6: Configure Gitea Webhook

### Via Gitea Web UI

1. Go to repository: `awsbookstoreconverter`
2. Settings → Webhooks → Add Webhook → Gitea
3. **Payload URL**: `http://el-gitea-listener.bookstore.svc.cluster.local:8080`
   - Or external: `https://webhook.bookstore.example.com`
4. **Content Type**: `application/json`
5. **Secret**: (same as gitea-webhook-secret)
6. **Trigger On**: Just the push event
7. **Active**: ✓
8. Click **Add Webhook**

### Test Webhook

```bash
# Make a change and push to Gitea
echo "# Test" >> README.md
git add README.md
git commit -m "test: Trigger webhook"
git push gitea main

# Watch pipeline run
tkn pipelinerun list -n bookstore
tkn pipelinerun logs -f -n bookstore
```

## Step 7: Configure ArgoCD to Monitor Gitea

### Add Gitea Repository to ArgoCD

```bash
# Get ArgoCD admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Login to ArgoCD CLI
argocd login argocd-server.argocd.svc.cluster.local

# Add Gitea repository
argocd repo add http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git \
  --username gitea_admin \
  --password YOUR_GITEA_TOKEN \
  --name bookstore-gitea

# Or via YAML
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: gitea-repo-secret
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: git
  url: http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git
  username: gitea_admin
  password: YOUR_GITEA_TOKEN
EOF
```

### Update ArgoCD Applications

```yaml
# gitops/applications/bookstore-api.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: bookstore-api
  namespace: argocd
spec:
  project: default
  source:
    repoURL: http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git
    targetRevision: HEAD
    path: kubernetes/overlays/dev
  destination:
    server: https://kubernetes.default.svc
    namespace: bookstore
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

## Complete GitOps Flow with Gitea

```
Developer
   ↓ (git push)
Gitea Repository
   ↓ (webhook)
Tekton EventListener
   ↓ (trigger)
Tekton Pipeline
   ↓ (build & deploy)
Object Storage / Knative
   ↓ (monitors)
ArgoCD
   ↓ (sync)
Kubernetes Resources
```

## Advantages of Gitea vs External Git

| Feature | GitHub/GitLab | Gitea (APL Core) |
|---------|---------------|------------------|
| **Cost** | $4-20/user/month | Included in LKE |
| **Network** | External calls | Internal (faster) |
| **Privacy** | Third-party | 100% self-hosted |
| **Control** | Limited | Full control |
| **Integration** | API limits | Direct K8s access |
| **Compliance** | Shared infra | Your infrastructure |
| **Speed** | Internet latency | Cluster-local (ms) |

## Troubleshooting

### Gitea Not Accessible

```bash
# Check Gitea pods
kubectl get pods -n gitea

# Check logs
kubectl logs -n gitea -l app=gitea

# Port forward
kubectl port-forward svc/gitea-http -n gitea 3000:3000
```

### Webhook Not Triggering

```bash
# Check EventListener
kubectl get eventlistener -n bookstore

# Check EventListener logs
kubectl logs -n bookstore -l eventlistener=gitea-listener

# Test webhook manually
curl -X POST http://el-gitea-listener.bookstore.svc.cluster.local:8080 \
  -H "Content-Type: application/json" \
  -H "X-Gitea-Event: push" \
  -d '{}'
```

### Git Clone Fails

```bash
# Verify credentials
kubectl get secret gitea-credentials -n bookstore

# Test from pod
kubectl run test-git --rm -it --image=alpine/git -- \
  git clone http://gitea_admin:TOKEN@gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git
```

## Security Best Practices

1. **Use SSH Keys** instead of tokens for production
2. **Rotate Secrets** regularly
3. **Enable 2FA** for Gitea admin account
4. **Use Private Repos** for sensitive code
5. **Configure RBAC** for Gitea users
6. **Enable Audit Logs** in Gitea
7. **Backup Gitea** data regularly

## Backup Gitea

```bash
# Backup Gitea data
kubectl exec -n gitea gitea-0 -- gitea dump -c /etc/gitea/app.ini

# Or use Velero (included in APL Core)
velero backup create gitea-backup --include-namespaces gitea
```

## Summary

✅ **100% Cloud-Native Stack**:
- Gitea (Git) ✅
- Tekton (CI/CD) ✅
- ArgoCD (GitOps) ✅
- Knative (Serverless) ✅
- Istio (Service Mesh) ✅
- CloudNative-PG (Database) ✅

**No external dependencies needed!** 🚀
