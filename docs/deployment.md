# Guide de Déploiement - Bookstore sur Akamai App Platform

Ce guide détaille le déploiement de l'application Bookstore sur Akamai App Platform (APL) avec Linode Kubernetes Engine (LKE).

## Prérequis

### Infrastructure
- Cluster Kubernetes (LKE recommandé)
- Akamai App Platform (APL) installé sur le cluster
- `kubectl` configuré pour accéder au cluster
- `linode-cli` installé et configuré

### Outils
- Docker (pour les builds locaux)
- Node.js 20+ (pour le développement local)
- PostgreSQL client (pour les migrations)

## Étapes de Déploiement

### 1. Créer le Cluster LKE

```bash
# Créer un cluster LKE avec linode-cli
linode-cli lke cluster-create \
  --label bookstore-cluster \
  --region us-east \
  --k8s_version 1.28 \
  --node_pools.type g6-standard-2 \
  --node_pools.count 3

# Récupérer le kubeconfig
linode-cli lke kubeconfig-view <cluster-id> --text | base64 -d > ~/.kube/bookstore-config
export KUBECONFIG=~/.kube/bookstore-config
```

### 2. Installer Akamai App Platform

```bash
# Cloner le repository APL
git clone https://github.com/linode/apl-core.git
cd apl-core

# Installer APL avec les composants requis
./install.sh --enable-all

# Vérifier l'installation
kubectl get pods -n apl-system
```

### 3. Configurer le Stockage (Linode Block Storage)

```bash
# Créer la classe de stockage pour Linode
cat <<EOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: linode-block-storage-retain
provisioner: linodebs.csi.linode.com
parameters:
  type: ext4
reclaimPolicy: Retain
allowVolumeExpansion: true
EOF
```

### 4. Déployer les Bases de Données

#### PostgreSQL (via CloudNative-pg)

```bash
# Installer l'opérateur CloudNative-pg (si pas déjà installé par APL)
kubectl apply -f \
  https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.21/releases/cnpg-1.21.0.yaml

# Créer le namespace
kubectl create namespace bookstore

# Configurer les secrets
kubectl create secret generic bookstore-postgres-credentials \
  -n bookstore \
  --from-literal=username=bookstore \
  --from-literal=password=$(openssl rand -base64 32)

kubectl create secret generic linode-object-storage-credentials \
  -n bookstore \
  --from-literal=ACCESS_KEY_ID=your-access-key \
  --from-literal=SECRET_ACCESS_KEY=your-secret-key

# Déployer PostgreSQL
kubectl apply -k kubernetes/base/databases/
```

#### Vérifier le déploiement des bases de données

```bash
# Attendre que PostgreSQL soit prêt
kubectl wait --for=condition=ready pod \
  -l postgresql=bookstore-postgres \
  -n bookstore \
  --timeout=300s

# Vérifier Redis
kubectl get statefulset redis -n bookstore

# Vérifier Elasticsearch
kubectl get statefulset elasticsearch -n bookstore
```

### 5. Configurer Keycloak pour l'Authentification

```bash
# Keycloak devrait être déjà installé via APL
# Accéder à l'interface Keycloak
kubectl port-forward -n apl-system svc/keycloak 8080:8080

# Ouvrir http://localhost:8080 dans le navigateur
# Identifiants par défaut: admin / admin (à changer en production!)
```

#### Configuration Keycloak

1. Créer un nouveau realm `bookstore`
2. Créer un client `bookstore-api` :
   - Client Protocol: openid-connect
   - Access Type: confidential
   - Valid Redirect URIs: `https://api.bookstore.example.com/*`
3. Créer un client `bookstore-frontend` :
   - Client Protocol: openid-connect
   - Access Type: public
   - Valid Redirect URIs: `https://bookstore.example.com/*`
   - Web Origins: `https://bookstore.example.com`
4. Noter les secrets des clients

### 6. Initialiser la Base de Données

```bash
# Port-forward vers PostgreSQL
kubectl port-forward -n bookstore svc/bookstore-postgres-rw 5432:5432

# Installer les dépendances et exécuter les migrations
cd src/api
npm install
npx prisma migrate deploy

# Optionnel: Charger des données de test
npm run db:seed
```

### 7. Builder et Pusher les Images Docker

```bash
# Configurer un registry (Harbor inclus dans APL ou Docker Hub)
export REGISTRY=harbor.apl.example.com/bookstore
# ou
export REGISTRY=docker.io/votre-username

# Builder et pusher l'API
cd src/api
docker build -t $REGISTRY/bookstore-api:v1.0.0 .
docker push $REGISTRY/bookstore-api:v1.0.0

# Builder et pusher le Frontend
cd ../frontend
docker build -t $REGISTRY/bookstore-frontend:v1.0.0 \
  --build-arg VITE_API_URL=https://api.bookstore.example.com \
  --build-arg VITE_KEYCLOAK_URL=https://auth.bookstore.example.com \
  .
docker push $REGISTRY/bookstore-frontend:v1.0.0
```

### 8. Mettre à Jour les Manifests avec vos Images

```bash
# Mettre à jour kubernetes/base/api/deployment.yaml
sed -i 's|image: bookstore-api:latest|image: '$REGISTRY'/bookstore-api:v1.0.0|' \
  kubernetes/base/api/deployment.yaml

# Mettre à jour kubernetes/base/frontend/deployment.yaml
sed -i 's|image: bookstore-frontend:latest|image: '$REGISTRY'/bookstore-frontend:v1.0.0|' \
  kubernetes/base/frontend/deployment.yaml
```

### 9. Configurer les Secrets de l'API

```bash
# Récupérer le mot de passe PostgreSQL
POSTGRES_PASSWORD=$(kubectl get secret bookstore-postgres-credentials \
  -n bookstore -o jsonpath='{.data.password}' | base64 -d)

# Récupérer le secret Keycloak du client API
KEYCLOAK_CLIENT_SECRET="votre-secret-depuis-keycloak"

# Créer/Mettre à jour le secret
kubectl create secret generic bookstore-api-secrets \
  -n bookstore \
  --from-literal=database-url="postgresql://bookstore:${POSTGRES_PASSWORD}@bookstore-postgres-rw.bookstore.svc.cluster.local:5432/bookstore" \
  --from-literal=keycloak-client-id="bookstore-api" \
  --from-literal=keycloak-client-secret="${KEYCLOAK_CLIENT_SECRET}" \
  --from-literal=jwt-secret=$(openssl rand -base64 32) \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 10. Déployer l'API Backend

```bash
kubectl apply -k kubernetes/base/api/

# Vérifier le déploiement
kubectl rollout status deployment/bookstore-api -n bookstore
kubectl get pods -n bookstore -l app=bookstore-api
```

### 11. Déployer le Frontend

```bash
kubectl apply -k kubernetes/base/frontend/

# Vérifier le déploiement
kubectl rollout status deployment/bookstore-frontend -n bookstore
kubectl get pods -n bookstore -l app=bookstore-frontend
```

### 12. Configurer Istio Gateway

```bash
# Créer un certificat TLS (exemple avec cert-manager)
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: bookstore-tls-cert
  namespace: bookstore
spec:
  secretName: bookstore-tls-cert
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
  - bookstore.example.com
  - api.bookstore.example.com
  - auth.bookstore.example.com
EOF

# Déployer le Gateway Istio
kubectl apply -k kubernetes/base/gateway/

# Récupérer l'IP externe du Gateway
kubectl get svc istio-ingressgateway -n istio-system
```

### 13. Configurer le DNS

Configurer les enregistrements DNS suivants pour pointer vers l'IP du Gateway Istio :

```
A    bookstore.example.com         -> <ISTIO_GATEWAY_IP>
A    api.bookstore.example.com     -> <ISTIO_GATEWAY_IP>
A    auth.bookstore.example.com    -> <ISTIO_GATEWAY_IP>
```

### 14. Vérifier le Déploiement

```bash
# Tester l'API
curl https://api.bookstore.example.com/health

# Tester le Frontend
curl https://bookstore.example.com/health

# Vérifier les logs
kubectl logs -n bookstore -l app=bookstore-api --tail=50
kubectl logs -n bookstore -l app=bookstore-frontend --tail=50
```

## CI/CD avec Tekton

### Installer les Pipelines Tekton

```bash
# Appliquer les pipelines
kubectl apply -f tekton/pipeline-api.yaml
kubectl apply -f tekton/pipeline-frontend.yaml

# Créer les workspaces
kubectl create pvc shared-workspace -n bookstore --storage-class=linode-block-storage-retain --size=10Gi
```

### Déclencher un Build

```bash
# Pour l'API
tkn pipeline start bookstore-api-build-deploy \
  -n bookstore \
  --param git-url=https://github.com/votre-repo/bookstore.git \
  --param git-revision=main \
  --param image-name=$REGISTRY/bookstore-api \
  --param image-tag=v1.0.1 \
  --workspace name=shared-workspace,claimName=shared-workspace \
  --showlog

# Pour le Frontend
tkn pipeline start bookstore-frontend-build-deploy \
  -n bookstore \
  --param git-url=https://github.com/votre-repo/bookstore.git \
  --param git-revision=main \
  --param image-name=$REGISTRY/bookstore-frontend \
  --param image-tag=v1.0.1 \
  --workspace name=shared-workspace,claimName=shared-workspace \
  --showlog
```

## Monitoring et Observabilité

### Installer Prometheus et Grafana (si pas déjà installé par APL)

```bash
# Prometheus
kubectl apply -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/main/bundle.yaml

# Grafana
kubectl apply -f https://raw.githubusercontent.com/grafana/grafana/main/deploy/kubernetes/grafana.yaml
```

### Accéder aux Dashboards

```bash
# Grafana
kubectl port-forward -n monitoring svc/grafana 3000:3000

# Prometheus
kubectl port-forward -n monitoring svc/prometheus 9090:9090

# Jaeger (tracing)
kubectl port-forward -n istio-system svc/jaeger-query 16686:16686
```

## Mise à l'Échelle

### Auto-scaling Horizontal (HPA)

```bash
# API
kubectl autoscale deployment bookstore-api \
  -n bookstore \
  --cpu-percent=70 \
  --min=3 \
  --max=10

# Frontend
kubectl autoscale deployment bookstore-frontend \
  -n bookstore \
  --cpu-percent=70 \
  --min=2 \
  --max=5
```

## Backup et Recovery

### Configurer Velero pour les Backups

```bash
# Installer Velero (si pas déjà installé par APL)
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.8.0 \
  --bucket bookstore-backups \
  --backup-location-config region=us-east-1,s3ForcePathStyle="true",s3Url=https://us-east-1.linodeobjects.com \
  --secret-file ./credentials-velero

# Créer un backup planifié
velero schedule create bookstore-daily \
  --schedule="0 2 * * *" \
  --include-namespaces bookstore
```

## Dépannage

### Problèmes Courants

#### Pods ne démarrent pas
```bash
kubectl describe pod <pod-name> -n bookstore
kubectl logs <pod-name> -n bookstore
```

#### Problèmes de connexion à PostgreSQL
```bash
kubectl exec -it bookstore-postgres-1 -n bookstore -- psql -U bookstore -d bookstore
```

#### Problèmes Istio/Gateway
```bash
kubectl logs -n istio-system -l app=istio-ingressgateway
istioctl analyze -n bookstore
```

## Sécurité

### Recommandations de Production

1. **Secrets** : Utiliser Sealed Secrets ou External Secrets Operator
2. **RBAC** : Configurer des rôles spécifiques pour chaque composant
3. **Network Policies** : Limiter le trafic entre les pods
4. **Pod Security Standards** : Appliquer des politiques de sécurité strictes
5. **Image Scanning** : Scanner les images pour les vulnérabilités
6. **TLS** : Activer mTLS avec Istio

### Exemple de Network Policy

```bash
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: bookstore-api-netpol
  namespace: bookstore
spec:
  podSelector:
    matchLabels:
      app: bookstore-api
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: istio-system
    - podSelector:
        matchLabels:
          app: bookstore-frontend
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: redis
    - podSelector:
        matchLabels:
          postgresql: bookstore-postgres
    - podSelector:
        matchLabels:
          app: elasticsearch
EOF
```

## Ressources Supplémentaires

- [Documentation APL](https://github.com/linode/apl-core)
- [Documentation LKE](https://www.linode.com/docs/products/compute/kubernetes/)
- [Documentation Istio](https://istio.io/latest/docs/)
- [Documentation CloudNative-pg](https://cloudnative-pg.io/)
- [Documentation Tekton](https://tekton.dev/docs/)
