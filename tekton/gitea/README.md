# Gitea Integration for Tekton Pipelines

This directory contains Tekton Triggers configuration for integrating with Gitea (APL Core Git service).

## Quick Start

### 1. Apply Gitea Tekton Resources

```bash
# Create namespace if not exists
kubectl create namespace bookstore --dry-run=client -o yaml | kubectl apply -f -

# Apply all Gitea Tekton resources
kubectl apply -k tekton/gitea/

# Verify EventListener is running
kubectl get eventlistener -n bookstore
kubectl get pods -n bookstore -l eventlistener=gitea-listener
```

### 2. Configure Gitea Credentials

```bash
# Get Gitea admin password (if using default admin)
kubectl get secret gitea-admin-secret -n gitea -o jsonpath="{.data.password}" | base64 -d

# Create access token in Gitea:
# 1. Login to Gitea UI
# 2. Settings → Applications → Generate New Token
# 3. Name: "Tekton Pipelines"
# 4. Copy the token

# Update the secret
kubectl edit secret gitea-credentials -n bookstore
# Replace CHANGEME_GITEA_TOKEN with your actual token

# Generate webhook secret
WEBHOOK_SECRET=$(openssl rand -hex 20)
echo "Webhook secret: $WEBHOOK_SECRET"

# Update webhook secret
kubectl patch secret gitea-webhook-secret -n bookstore \
  --type='json' \
  -p="[{\"op\": \"replace\", \"path\": \"/data/webhook-secret\", \"value\": \"$(echo -n $WEBHOOK_SECRET | base64)\"}]"
```

### 3. Configure Gitea Webhook

**Option A: Using Cluster-Internal URL (Recommended)**

If Gitea and Tekton are in the same cluster:

```
Payload URL: http://el-gitea-listener.bookstore.svc.cluster.local:8080
```

**Option B: Using External Ingress**

If you need external access or Gitea is outside cluster:

```bash
# Create ingress (uncomment in gitea-eventlistener.yaml)
# Then use:
Payload URL: https://webhook.bookstore.example.com
```

**Webhook Configuration**:
1. Go to your Gitea repository
2. Settings → Webhooks → Add Webhook → Gitea
3. **Payload URL**: (see above)
4. **Content Type**: `application/json`
5. **Secret**: (the webhook secret from step 2)
6. **Trigger On**: Just the push event
7. **Branch filter**: `main` (optional)
8. **Active**: ✓
9. Click **Add Webhook**

### 4. Test the Integration

```bash
# Push a commit to Gitea
echo "# Test webhook" >> README.md
git add README.md
git commit -m "test: Trigger Tekton pipeline from Gitea"
git push gitea main

# Watch for triggered pipeline
watch kubectl get pipelinerun -n bookstore

# View pipeline logs
tkn pipelinerun logs -f -n bookstore --last

# Or view in Tekton Dashboard
kubectl port-forward svc/tekton-dashboard -n tekton-pipelines 9097:9097
# Access: http://localhost:9097
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer Workflow                        │
└─────────────────────────────────────────────────────────────┘
                              │
                      git push gitea main
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Gitea Repository                          │
│  http://gitea.gitea.svc.cluster.local:3000/gitea_admin/... │
└─────────────────────────────────────────────────────────────┘
                              │
                     Webhook (POST request)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Tekton EventListener                            │
│        el-gitea-listener.bookstore.svc:8080                 │
│                                                              │
│  Interceptors:                                              │
│  1. Gitea Interceptor (validates secret)                    │
│  2. CEL Filter (checks branch == main)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                  ┌───────────┴───────────┐
                  │                       │
                  ▼                       ▼
        ┌─────────────────┐    ┌─────────────────┐
        │ Frontend Trigger│    │  API Trigger    │
        │                 │    │                 │
        │ TriggerBinding  │    │ TriggerBinding  │
        │       +         │    │       +         │
        │ TriggerTemplate │    │ TriggerTemplate │
        └─────────────────┘    └─────────────────┘
                  │                       │
                  ▼                       ▼
        ┌─────────────────┐    ┌─────────────────┐
        │  PipelineRun    │    │  PipelineRun    │
        │  (Frontend S3)  │    │  (API Docker)   │
        └─────────────────┘    └─────────────────┘
```

## Files Description

- **gitea-serviceaccount.yaml**: Service account with permissions for Tekton
- **gitea-secrets.yaml**: Git credentials and webhook secret
- **gitea-eventlistener.yaml**: EventListener that receives webhooks
- **gitea-triggerbindings.yaml**: Extracts data from webhook payload
- **gitea-triggertemplates.yaml**: Creates PipelineRuns from webhook data
- **kustomization.yaml**: Kustomize configuration

## Triggers Configuration

### Frontend Trigger

- **Event**: Push to `main` branch
- **Pipeline**: `bookstore-frontend-s3-deploy`
- **Destination**: Linode Object Storage
- **Filter**: Any push to main (no path filter)

### API Trigger

- **Event**: Push to `main` branch
- **Pipeline**: `bookstore-api-build-deploy`
- **Build**: Docker image with commit SHA tag
- **Deploy**: Updates Knative service

## Monitoring

### View EventListener Logs

```bash
# Get EventListener pod
kubectl get pods -n bookstore -l eventlistener=gitea-listener

# View logs
kubectl logs -n bookstore -l eventlistener=gitea-listener -f
```

### View Pipeline Runs

```bash
# List all pipeline runs
tkn pipelinerun list -n bookstore

# Describe a specific run
tkn pipelinerun describe <name> -n bookstore

# View logs
tkn pipelinerun logs <name> -n bookstore -f
```

### Tekton Dashboard

```bash
# Port forward dashboard
kubectl port-forward svc/tekton-dashboard -n tekton-pipelines 9097:9097

# Access: http://localhost:9097
```

## Troubleshooting

### Webhook Not Triggering

1. **Check EventListener is running**:
   ```bash
   kubectl get pods -n bookstore -l eventlistener=gitea-listener
   ```

2. **Check EventListener logs**:
   ```bash
   kubectl logs -n bookstore -l eventlistener=gitea-listener
   ```

3. **Test webhook manually**:
   ```bash
   # Get webhook secret
   WEBHOOK_SECRET=$(kubectl get secret gitea-webhook-secret -n bookstore -o jsonpath='{.data.webhook-secret}' | base64 -d)

   # Test POST
   kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
     curl -X POST \
     http://el-gitea-listener.bookstore.svc.cluster.local:8080 \
     -H "Content-Type: application/json" \
     -H "X-Gitea-Event: push" \
     -H "X-Gitea-Signature: sha256=$WEBHOOK_SECRET" \
     -d '{
       "ref": "refs/heads/main",
       "after": "abc123",
       "repository": {
         "clone_url": "http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git",
         "name": "awsbookstoreconverter",
         "full_name": "gitea_admin/awsbookstoreconverter"
       },
       "pusher": {"username": "test"},
       "commits": [{"message": "test"}]
     }'
   ```

4. **Check Gitea webhook delivery**:
   - Go to Gitea → Repository → Settings → Webhooks
   - Click on webhook → Recent Deliveries
   - Check response code and body

### Pipeline Fails

1. **Check credentials**:
   ```bash
   kubectl get secret gitea-credentials -n bookstore -o yaml
   ```

2. **Test Git clone manually**:
   ```bash
   kubectl run -it --rm git-test --image=alpine/git --restart=Never -- \
     git clone http://gitea.gitea.svc.cluster.local:3000/gitea_admin/awsbookstoreconverter.git
   ```

3. **Check pipeline logs**:
   ```bash
   tkn pipelinerun logs -f -n bookstore --last
   ```

### EventListener Pod CrashLoopBackOff

```bash
# Check pod status
kubectl describe pod -n bookstore -l eventlistener=gitea-listener

# Check if ServiceAccount has required secrets
kubectl get sa tekton-gitea-sa -n bookstore -o yaml
```

## Security Notes

1. **Webhook Secret**: Always use a strong, randomly generated secret
2. **Git Credentials**: Use tokens with minimal required permissions
3. **RBAC**: ServiceAccount has minimal permissions needed
4. **Network**: EventListener runs in cluster, reducing attack surface
5. **TLS**: Use HTTPS for external webhook endpoints

## Advanced Configuration

### Selective Triggers Based on File Changes

To trigger frontend pipeline only when frontend files change:

```yaml
# Add to interceptor in gitea-eventlistener.yaml
- ref:
    name: "cel"
  params:
  - name: "filter"
    value: "body.commits.exists(c, c.modified.exists(f, f.startsWith('src/frontend/')))"
```

### Multi-Environment Deployments

Create separate triggers for different branches:

```yaml
# Production trigger (main branch)
- name: gitea-frontend-prod
  interceptors:
  - ref:
      name: "cel"
    params:
    - name: "filter"
      value: "body.ref == 'refs/heads/main'"

# Staging trigger (develop branch)
- name: gitea-frontend-staging
  interceptors:
  - ref:
      name: "cel"
    params:
    - name: "filter"
      value: "body.ref == 'refs/heads/develop'"
```

## References

- [Tekton Triggers Documentation](https://tekton.dev/docs/triggers/)
- [Gitea Webhooks](https://docs.gitea.io/en-us/webhooks/)
- [APL Core Documentation](https://apl-docs.net)
