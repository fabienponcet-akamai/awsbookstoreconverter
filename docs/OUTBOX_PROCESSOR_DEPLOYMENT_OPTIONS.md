# 🚀 Déploiement de l'Outbox Processor - Options Kubernetes

## 🎯 Le Défi

L'Outbox Processor est un **background worker** qui :
- ✅ Poll la base de données toutes les 5 secondes
- ✅ Traite les événements en continu
- ✅ Ne reçoit PAS de trafic HTTP entrant
- ✅ Doit tourner 24/7 (ou presque)

**Question** : Peut-on utiliser Knative pour ça ?

---

## 📊 Comparaison des Options de Déploiement

| Option | Scale-to-Zero | Auto-Scaling | Complexité | Recommandé Pour |
|--------|---------------|--------------|------------|-----------------|
| **Deployment** | ❌ Non | Horizontal Pod Autoscaler | Faible | ✅ Production |
| **Knative Serving** | ✅ Oui (problématique) | Basé sur requêtes HTTP | Moyenne | ❌ Pas adapté |
| **Knative Serving + min-scale** | ❌ Non | Basé sur requêtes HTTP | Moyenne | ⚠️ Possible mais complexe |
| **Knative Eventing** | ✅ Oui | Event-driven | Élevée | ✅ Si event-driven |
| **CronJob** | ✅ Oui | Non | Faible | ✅ Si polling < 1/min |

---

## 🔧 Option 1 : Deployment Kubernetes (Recommandé)

### Pourquoi c'est le Meilleur Choix

✅ **Simple** : Configuration standard Kubernetes
✅ **Fiable** : Toujours au moins N replicas actifs
✅ **Performant** : Pas de cold start
✅ **Monitoring facile** : Prometheus metrics standard

### Déploiement

```yaml
# k8s/workers/outbox-processor-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: outbox-processor
  namespace: bookstore
  labels:
    app: outbox-processor
    component: worker
spec:
  replicas: 2  # High availability

  selector:
    matchLabels:
      app: outbox-processor

  template:
    metadata:
      labels:
        app: outbox-processor
        component: worker
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"

    spec:
      # Node placement (Pool 3: Applications)
      nodeSelector:
        workload.type: application

      tolerations:
      - key: workload
        value: application
        effect: NoSchedule

      containers:
      - name: processor
        image: registry.bookstore.example.com/bookstore-api:v1.0.0

        env:
        - name: ENABLE_OUTBOX_PROCESSOR
          value: "true"  # Enable background worker

        - name: OUTBOX_POLLING_INTERVAL
          value: "5000"  # 5 seconds

        - name: OUTBOX_BATCH_SIZE
          value: "100"

        - name: MAIN_DB_HOST
          value: "bookstore-main-rw.bookstore.svc.cluster.local"

        - name: GRAPH_DB_HOST
          value: "bookstore-graph-rw.bookstore.svc.cluster.local"

        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: bookstore-pg-credentials
              key: password

        - name: NODE_ENV
          value: "production"

        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi

        # Health checks
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3

        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2

        # Graceful shutdown
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]

      # Graceful shutdown period
      terminationGracePeriodSeconds: 30

      # Spread pods across nodes
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchLabels:
                  app: outbox-processor
              topologyKey: kubernetes.io/hostname
```

### Horizontal Pod Autoscaler (optionnel)

```yaml
# k8s/workers/outbox-processor-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: outbox-processor
  namespace: bookstore
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: outbox-processor

  minReplicas: 2
  maxReplicas: 5

  metrics:
  # Scale based on pending events
  - type: Pods
    pods:
      metric:
        name: outbox_pending_events
      target:
        type: AverageValue
        averageValue: "500"  # Scale up if avg > 500 pending events per pod

  # Scale based on CPU
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70

  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # Wait 5min before scaling down
      policies:
      - type: Percent
        value: 50  # Scale down max 50% at a time
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0  # Scale up immediately
      policies:
      - type: Percent
        value: 100  # Double replicas if needed
        periodSeconds: 15
```

**Déploiement** :

```bash
kubectl apply -f k8s/workers/outbox-processor-deployment.yaml
kubectl apply -f k8s/workers/outbox-processor-hpa.yaml

# Vérifier
kubectl get pods -n bookstore -l app=outbox-processor
kubectl get hpa -n bookstore outbox-processor
```

---

## 🌊 Option 2 : Knative Serving (Pas Recommandé, mais Possible)

### Le Problème avec Knative Serving

Knative Serving est conçu pour :
- ✅ Répondre à des requêtes HTTP entrantes
- ✅ Scale-to-zero quand pas de trafic
- ✅ Auto-scaling basé sur concurrence de requêtes

Notre Outbox Processor :
- ❌ N'a PAS de trafic HTTP entrant
- ❌ Ne doit PAS scale-to-zero (sinon événements non traités)
- ❌ Auto-scaling basé sur événements en DB, pas HTTP

### Solution : Knative avec min-scale + Self-Ping

Si tu veux vraiment utiliser Knative (pour uniformiser tous les déploiements), voici comment :

```yaml
# k8s/workers/outbox-processor-knative.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: outbox-processor
  namespace: bookstore
spec:
  template:
    metadata:
      annotations:
        # IMPORTANT: Désactiver scale-to-zero
        autoscaling.knative.dev/min-scale: "2"
        autoscaling.knative.dev/max-scale: "5"

        # Scale basé sur CPU (pas requêtes HTTP)
        autoscaling.knative.dev/metric: "cpu"
        autoscaling.knative.dev/target: "70"

        # Désactiver le timeout de révision
        autoscaling.knative.dev/target-utilization-percentage: "70"

    spec:
      containers:
      - image: registry.bookstore.example.com/bookstore-api:v1.0.0

        ports:
        - containerPort: 3000
          name: http1

        env:
        - name: ENABLE_OUTBOX_PROCESSOR
          value: "true"

        - name: OUTBOX_POLLING_INTERVAL
          value: "5000"

        - name: OUTBOX_BATCH_SIZE
          value: "100"

        - name: MAIN_DB_HOST
          value: "bookstore-main-rw.bookstore.svc.cluster.local"

        - name: GRAPH_DB_HOST
          value: "bookstore-graph-rw.bookstore.svc.cluster.local"

        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: bookstore-pg-credentials
              key: password

        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
```

**Problème** : Même avec `min-scale: 2`, Knative peut quand même scale down si pas de trafic HTTP.

**Solution** : Self-Ping

```typescript
// src/workers/outboxProcessor.ts
export class OutboxProcessor {
  private selfPingInterval?: NodeJS.Timer;

  start(): void {
    // ... existing code ...

    // Self-ping to prevent Knative scale-to-zero
    if (process.env.KNATIVE_SERVICE === 'true') {
      this.startSelfPing();
    }
  }

  private startSelfPing(): void {
    // Ping self every 30 seconds to keep Knative awake
    this.selfPingInterval = setInterval(() => {
      fetch('http://localhost:3000/health')
        .catch(err => logger.error('Self-ping failed', { error: err.message }));
    }, 30000);  // 30 seconds

    logger.info('Self-ping enabled to prevent Knative scale-to-zero');
  }

  stop(): void {
    if (this.selfPingInterval) {
      clearInterval(this.selfPingInterval);
    }
    // ... existing code ...
  }
}
```

**Verdict** : ⚠️ **Possible mais complexe et hacky**. Pas recommandé.

---

## 🎪 Option 3 : Knative Eventing (Recommandé si Event-Driven)

### Concept

Au lieu de polling continu, utiliser **Knative Eventing** avec un **CronSource** pour déclencher le traitement.

```
┌─────────────────────────────────────────────────────┐
│                KNATIVE EVENTING FLOW                 │
└─────────────────────────────────────────────────────┘

┌─────────────────┐
│  CronSource     │  Trigger toutes les 5 secondes
│  */5 * * * * *  │
└────────┬────────┘
         │
         │ Envoie CloudEvent
         │
         ▼
┌─────────────────┐
│  Broker         │
│  (in-memory)    │
└────────┬────────┘
         │
         │ Route vers
         │
         ▼
┌─────────────────┐
│  Trigger        │
│  (event filter) │
└────────┬────────┘
         │
         │ Invoque
         │
         ▼
┌─────────────────────────────────┐
│  outbox-processor               │
│  (Knative Service)              │
│                                 │
│  POST /process                  │
│  { "time": "2024-01-15..." }    │
│                                 │
│  1. SELECT FROM outbox_events   │
│  2. Process events              │
│  3. Return 200 OK               │
└─────────────────────────────────┘
```

### Déploiement Knative Eventing

**1. Installer Knative Eventing** :

```bash
# Install Knative Eventing
kubectl apply -f https://github.com/knative/eventing/releases/download/knative-v1.12.0/eventing-crds.yaml
kubectl apply -f https://github.com/knative/eventing/releases/download/knative-v1.12.0/eventing-core.yaml

# Install in-memory broker
kubectl apply -f https://github.com/knative/eventing/releases/download/knative-v1.12.0/in-memory-channel.yaml
kubectl apply -f https://github.com/knative/eventing/releases/download/knative-v1.12.0/mt-channel-broker.yaml
```

**2. Créer un Broker** :

```yaml
# k8s/eventing/broker.yaml
apiVersion: eventing.knative.dev/v1
kind: Broker
metadata:
  name: default
  namespace: bookstore
spec:
  config:
    apiVersion: v1
    kind: ConfigMap
    name: config-br-default-channel
    namespace: knative-eventing
```

**3. Créer un CronSource** :

```yaml
# k8s/eventing/cronjob-source.yaml
apiVersion: sources.knative.dev/v1
kind: CronJobSource
metadata:
  name: outbox-cron
  namespace: bookstore
spec:
  # Cron expression: every 5 seconds (using seconds format)
  # Note: Standard cron doesn't support seconds, use PingSource instead
  schedule: "*/1 * * * *"  # Every minute (minimum for CronJobSource)

  # Data to send with event
  data: '{"trigger": "outbox-processor"}'

  # Send to broker
  sink:
    ref:
      apiVersion: eventing.knative.dev/v1
      kind: Broker
      name: default
```

**Note** : CronJobSource minimum est 1 minute. Pour < 1 minute, utiliser **PingSource** :

```yaml
# k8s/eventing/ping-source.yaml
apiVersion: sources.knative.dev/v1
kind: PingSource
metadata:
  name: outbox-ping
  namespace: bookstore
spec:
  # Trigger every 5 seconds (ISO 8601 duration)
  schedule: "*/5 * * * * *"

  contentType: "application/json"
  data: '{"trigger": "outbox-processor"}'

  sink:
    ref:
      apiVersion: eventing.knative.dev/v1
      kind: Broker
      name: default
```

**4. Créer le Service Knative** :

```yaml
# k8s/eventing/outbox-processor-service.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: outbox-processor
  namespace: bookstore
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/min-scale: "0"  # Scale-to-zero OK
        autoscaling.knative.dev/max-scale: "3"
    spec:
      containers:
      - image: registry.bookstore.example.com/outbox-processor-eventing:v1.0.0
        env:
        - name: MAIN_DB_HOST
          value: "bookstore-main-rw.bookstore.svc.cluster.local"
        - name: GRAPH_DB_HOST
          value: "bookstore-graph-rw.bookstore.svc.cluster.local"
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: bookstore-pg-credentials
              key: password
```

**5. Créer un Trigger** :

```yaml
# k8s/eventing/trigger.yaml
apiVersion: eventing.knative.dev/v1
kind: Trigger
metadata:
  name: outbox-trigger
  namespace: bookstore
spec:
  broker: default

  # Filter events (optional)
  filter:
    attributes:
      type: dev.knative.sources.ping

  # Send to outbox-processor
  subscriber:
    ref:
      apiVersion: serving.knative.dev/v1
      kind: Service
      name: outbox-processor
```

**6. Code du Service (event-driven)** :

```typescript
// src/workers/outboxProcessorEventing.ts
import express from 'express';
import { OutboxProcessor } from './outboxProcessor';

const app = express();
app.use(express.json());

const processor = new OutboxProcessor();

// Endpoint déclenché par Knative Eventing
app.post('/process', async (req, res) => {
  try {
    console.log('Received event:', req.body);

    // Process outbox events
    await processor.processEvents();

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Error processing events:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Outbox processor eventing listening on port ${PORT}`);
});
```

**Déploiement** :

```bash
# Appliquer tous les manifests
kubectl apply -f k8s/eventing/broker.yaml
kubectl apply -f k8s/eventing/ping-source.yaml
kubectl apply -f k8s/eventing/outbox-processor-service.yaml
kubectl apply -f k8s/eventing/trigger.yaml

# Vérifier
kubectl get pingsource -n bookstore
kubectl get broker -n bookstore
kubectl get trigger -n bookstore
kubectl get ksvc -n bookstore outbox-processor
```

**Avantages Knative Eventing** :

✅ **Scale-to-zero** : Pas de ressources utilisées entre les invocations
✅ **Event-driven** : Architecture cloud-native
✅ **Découplage** : Broker découple source et consommateur
✅ **Monitoring** : Events tracés automatiquement

**Inconvénients** :

❌ **Complexité** : Plus de composants à gérer
❌ **Cold starts** : Latence au démarrage si scale-to-zero
❌ **Overhead** : Event broker ajoute de la latence

---

## ⏰ Option 4 : Kubernetes CronJob (Si Polling Moins Fréquent)

Si tu peux te permettre de traiter les événements toutes les **1-5 minutes** (pas toutes les 5 secondes), CronJob est excellent :

```yaml
# k8s/workers/outbox-processor-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: outbox-processor
  namespace: bookstore
spec:
  # Toutes les minutes
  schedule: "*/1 * * * *"

  # Toutes les 5 minutes
  # schedule: "*/5 * * * *"

  concurrencyPolicy: Forbid  # Ne pas lancer si précédent job en cours
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3

  jobTemplate:
    spec:
      template:
        metadata:
          labels:
            app: outbox-processor
        spec:
          restartPolicy: OnFailure

          containers:
          - name: processor
            image: registry.bookstore.example.com/outbox-processor:v1.0.0

            command: ["node", "dist/workers/runOnce.js"]  # Script one-shot

            env:
            - name: MAIN_DB_HOST
              value: "bookstore-main-rw.bookstore.svc.cluster.local"
            - name: GRAPH_DB_HOST
              value: "bookstore-graph-rw.bookstore.svc.cluster.local"
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: bookstore-pg-credentials
                  key: password

            resources:
              requests:
                cpu: 100m
                memory: 256Mi
              limits:
                cpu: 500m
                memory: 512Mi
```

**Script one-shot** :

```typescript
// src/workers/runOnce.ts
import { OutboxProcessor } from './outboxProcessor';
import { mainDb, graphDb } from '../config/database';

async function main() {
  console.log('Starting outbox processor (one-shot mode)');

  const processor = new OutboxProcessor(mainDb, graphDb);

  try {
    // Process all pending events
    await processor.processEvents();

    console.log('✅ Outbox processing completed successfully');
    process.exit(0);

  } catch (error) {
    console.error('❌ Outbox processing failed:', error);
    process.exit(1);
  }
}

main();
```

**Avantages CronJob** :

✅ **Simple** : Configuration Kubernetes standard
✅ **Prévisible** : Scheduling précis
✅ **Pas de ressources gaspillées** : Tourne uniquement quand nécessaire
✅ **Monitoring facile** : Jobs Kubernetes standard

**Inconvénients** :

❌ **Latence** : Minimum 1 minute entre traitements
❌ **Pas de réactivité** : Pas adapté si événements doivent être traités immédiatement

---

## 📊 Tableau de Décision

| Critère | Deployment | Knative Serving | Knative Eventing | CronJob |
|---------|------------|-----------------|------------------|---------|
| **Latence de traitement** | < 5s | < 5s (avec hacks) | < 1min | 1-5min |
| **Ressources utilisées** | Constantes | Constantes (min-scale) | Variables (scale-to-zero) | Minimales |
| **Complexité** | ⭐ Faible | ⭐⭐⭐ Élevée | ⭐⭐ Moyenne | ⭐ Faible |
| **Fiabilité** | ⭐⭐⭐ Excellente | ⭐⭐ Bonne | ⭐⭐ Bonne | ⭐⭐⭐ Excellente |
| **Cost** | Moyen | Moyen | Faible | Très faible |
| **Monitoring** | ⭐⭐⭐ Facile | ⭐⭐ Moyen | ⭐⭐ Moyen | ⭐⭐⭐ Facile |
| **Production-ready** | ✅ Oui | ⚠️ Avec précautions | ✅ Oui | ✅ Oui (si latence OK) |

---

## 💡 Recommandation Finale

### Pour Production (latence < 10s requise) :

```yaml
# ✅ RECOMMANDÉ: Kubernetes Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: outbox-processor
spec:
  replicas: 2
  # ... (voir Option 1)
```

**Pourquoi ?**
- ✅ Simple et éprouvé
- ✅ Latence minimale (5s polling)
- ✅ Monitoring facile
- ✅ Pas de hacks nécessaires

### Pour Optimiser les Coûts (latence < 1min acceptable) :

```yaml
# ✅ RECOMMANDÉ: Knative Eventing + PingSource
apiVersion: sources.knative.dev/v1
kind: PingSource
metadata:
  name: outbox-ping
spec:
  schedule: "*/30 * * * * *"  # Toutes les 30s
  # ... (voir Option 3)
```

**Pourquoi ?**
- ✅ Scale-to-zero = économies
- ✅ Architecture event-driven
- ✅ Pas de ressources gaspillées

### Pour Traitement Non-Critique (latence > 1min acceptable) :

```yaml
# ✅ RECOMMANDÉ: Kubernetes CronJob
apiVersion: batch/v1
kind: CronJob
metadata:
  name: outbox-processor
spec:
  schedule: "*/5 * * * *"  # Toutes les 5min
  # ... (voir Option 4)
```

**Pourquoi ?**
- ✅ Très simple
- ✅ Coût minimal
- ✅ Parfait pour batch processing

---

## 🎯 Résumé

**Knative Serving seul** = ❌ **Pas adapté** pour background workers

**Mais tu peux utiliser :**
1. **Deployment classique** (recommandé pour < 10s latence)
2. **Knative Eventing** (recommandé pour optimiser coûts)
3. **CronJob** (recommandé pour batch processing)

**Mon conseil pour Bookstore** :

```yaml
# Production: Deployment (2 replicas)
replicas: 2
polling_interval: 5s
cost: ~$20/mois (2× g6-nanode-1)

# Ou si budget serré: Knative Eventing
min_scale: 0
schedule: "*/30 * * * * *"  # 30s
cost: ~$5/mois (scale-to-zero)
```

Tu veux que je te montre comment migrer du Deployment vers Knative Eventing si tu décides d'optimiser les coûts plus tard ?
