# CDEP GKE deployment

These manifests extend the edge-only deployment with the application services
and the in-cluster dependencies that are compatible with GKE.

## What is included

- Single-node Kafka with persistent storage and topic bootstrap
- Single-node Garage object storage with persistent storage
- ClamAV with persistent signature storage
- Eight AlloyDB Prisma migration Jobs
- Identity seed and evidence bucket bootstrap Jobs
- Eight backend Deployments and ClusterIP Services
- A two-organization Fabric 2.5 network with a Raft orderer, two peers, and the
  proof registry running as chaincode-as-a-service
- API Gateway and portal edge resources
- A GKE-managed global external Gateway and HTTPRoute

The Kafka and Garage definitions are single-node configurations. They
are suitable for a development or hackathon environment, not a production
high-availability deployment.

## Public Gateway prerequisite

The cluster must have the GKE Gateway API Standard channel enabled and the
global static address referenced by `cdep-gateway.yaml` must exist:

```bash
kubectl get gatewayclass gke-l7-global-external-managed
gcloud compute addresses create cdep-web-ip --global
```

Skip the address creation command when `cdep-web-ip` already exists. The
current Gateway listener is HTTP-only so the static IP can be used before a
domain is available. Production deployment requires a real DNS name, an HTTPS
listener, and a managed or self-managed certificate.

Garage remains cluster-internal. Configure a separate hostname and Gateway
route before setting `OBJECT_STORAGE_PUBLIC_ENDPOINT` to a public address. Its
admin and RPC ports must remain internal.

## Create secrets

The supplied database password must not be added to YAML or committed to Git.
The default database host is the private AlloyDB PSC endpoint
`10.128.15.209`. Export the passwords in Cloud Shell:

```bash
export CDEP_ALLOYDB_PASSWORD='<alloydb-password>'
export CDEP_BOOTSTRAP_ADMIN_PASSWORD='<initial-admin-password>'
bash infrastructure/kubernetes/create-runtime-secrets.sh
unset CDEP_ALLOYDB_PASSWORD CDEP_BOOTSTRAP_ADMIN_PASSWORD
```

The PSC endpoint is a reserved regional internal address named
`cdep-alloydb-psc-ip`, connected by the `cdep-alloydb-psc` forwarding rule to
the AlloyDB primary service attachment. Confirm it is accepted before running
database migrations:

```bash
gcloud compute forwarding-rules describe cdep-alloydb-psc \
  --region=us-central1 \
  --format='value(IPAddress,pscConnectionStatus)'
```

Do not switch the database URLs back to the AlloyDB public IP unless stable,
restricted authorized egress networks have been configured. Autopilot node
public addresses can change when the cluster scales.

The script creates:

- `alloydb-credentials`
- `cdep-database-urls`
- `cdep-runtime-secrets`
- `cdep-audit-secrets`

It preserves existing runtime and audit Secrets to avoid silently rotating JWT,
encryption, and audit cursor-signing keys. Store backups in an approved secret
manager.

The password must be URL-safe because it is embedded in PostgreSQL connection
URLs. Percent-encode reserved URL characters before running the script.

## Apply the deployable stack

Confirm `gitlab-registry` exists, then run:

```bash
kubectl -n cdep get secret gitlab-registry
bash infrastructure/kubernetes/deploy-gke.sh
```

The script applies resources in dependency order and waits for infrastructure,
migrations, bootstrap Jobs, the Fabric channel and proof chaincode, and
application readiness.

The deployment script recreates its migration and bootstrap Jobs on each run.
Prisma migration deployment, identity seed, evidence bucket creation, and Kafka
topic creation are required to remain idempotent.

Do not delete PVCs unless permanent data loss is intended.

## Hyperledger Fabric on GKE

`deploy-fabric-gke.sh` deploys a real Fabric 2.5 network in the `fabric`
namespace. The network keeps the existing CDEP and Audit organizations and the
`AND('CDEPMSP.peer','AuditMSP.peer')` endorsement policy. The Go proof registry
runs as chaincode-as-a-service, using the peer image's built-in CCAAS external
builder. No Docker socket, privileged container, or mock ledger is used.

Fabric crypto material and ledger state are persisted on
`fabric-network-data`. The script copies only the CDEP client TLS root,
enrollment certificate, and private key into the `fabric-client-identity`
Secret, restarts Ledger Service, and waits for both Ledger Service and API
Gateway readiness.

To reconcile Fabric independently:

```bash
bash infrastructure/kubernetes/deploy-fabric-gke.sh
```

The current single-pod Fabric topology is intended for development and
hackathon use. Production requires separate highly available orderer and peer
workloads, managed certificate enrollment and rotation, backups, monitoring,
and a disaster-recovery plan.

## Verification

```bash
kubectl -n cdep get pods,services,gateway,httproute
kubectl -n cdep get jobs
kubectl -n cdep exec deployment/api-gateway -- \
  node -e "fetch('http://localhost:3000/health/ready').then(async r => console.log(r.status, await r.text()))"
```

The final Gateway response must be HTTP 200 with every dependency reported as
`up`.
