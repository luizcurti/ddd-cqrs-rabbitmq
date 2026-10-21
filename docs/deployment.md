# Deployment (AWS)

Every push to `main` deploys the docker-compose stack to AWS with GitHub
Actions, once the CI checks pass:

```
           HTTPS                 HTTP (CloudFront ranges only)
client ──► CloudFront ─────────► ALB ──► ECS Fargate: app ──────────────┐
                                                                        ├──► RDS PostgreSQL 17
                   ECS Fargate: outbox-relay ──► RabbitMQ ──► consumer ─┘    (write + read models,
                   (polls outbox_messages)       (Fargate)    (projects        outbox table)
                                                               order_summaries)
                   RabbitMQ: rabbitmq.ddd-cqrs.internal (Cloud Map private DNS)
```

| docker-compose service                       | AWS                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `app` + `nginx`                              | ECS Fargate service behind an ALB, HTTPS through CloudFront's default certificate |
| `consumer`                                   | ECS Fargate service (same image, `node dist/consumer.js`)                         |
| `outbox-relay`                               | ECS Fargate service (same image, `node dist/outbox-relay.js`)                     |
| `postgres`                                   | RDS PostgreSQL 17 (`db.t4g.micro`), `DB_SSL=true`                                 |
| `rabbitmq`                                   | ECS Fargate service (`rabbitmq:3.13-alpine`), Cloud Map private DNS name          |
| `jaeger`, `prometheus`, `grafana`, `pgadmin` | Not deployed: `OTEL_SDK_DISABLED=true`, logs in CloudWatch (`/ecs/ddd-cqrs-app`)  |

Notes:

- **Secrets**: the PostgreSQL password is managed by RDS in Secrets Manager;
  `API_KEY`, `RABBITMQ_URL` and the RabbitMQ password are SSM SecureString
  parameters under `/ddd-cqrs/`. ECS injects them as environment variables.
- **Migrations** run at startup in every process, under the existing Postgres
  advisory lock, exactly as in docker-compose.
- **RabbitMQ** is a single container without persistence. Thanks to the
  transactional outbox, a broker restart loses nothing that is not yet
  published (the relay retries pending rows); messages already queued but not
  consumed would be lost. Amazon MQ would be the managed alternative, at a much
  higher hourly cost for a demo.
- **`TRUST_PROXY=2`** (CloudFront, then the ALB) keeps the per-IP rate limiter
  keyed on the client.
- **`/metrics`** is answered with a 404 by the ALB: it is unauthenticated and
  meant for Prometheus inside the network.
- **Network**: public subnets and no NAT gateway (tasks get a public IP to
  reach ECR, SSM and Secrets Manager). Only the ALB accepts traffic from outside
  the VPC, and only from CloudFront; PostgreSQL and RabbitMQ only accept the
  API and worker tasks.

## One-time setup

Requirements: Terraform >= 1.10, AWS CLI credentials (admin) of the target
account, and the GitHub CLI logged in with admin access to the repository.

```bash
scripts/bootstrap.sh
```

It applies [`bootstrap/`](../bootstrap) (an S3 bucket for the Terraform state
and an IAM role GitHub Actions assumes through OIDC, scoped to the `ddd-cqrs-*`
resources and the `production` environment), then creates the `production`
GitHub environment with the `AWS_DEPLOY_ROLE_ARN`, `TF_STATE_BUCKET` and
`AWS_REGION` variables. On an account where no other project created the GitHub
OIDC provider yet, run `scripts/bootstrap.sh -var="create_oidc_provider=true"`.

## Deploy

Every push to `main` deploys; to deploy without a push:

```bash
gh workflow run ci.yml --repo luizcurti/ddd-cqrs-rabbitmq --ref main
```

The **Deploy to AWS** job creates the ECR repository, builds and pushes the
image, applies [`infra/`](../infra) (the first run takes ~15 minutes, mostly
RDS), waits for the four ECS services and runs
[`scripts/smoke-test.sh`](../scripts/smoke-test.sh) against the live stack:
readiness, API-key auth, the Postman collection, and an order that must appear
in `GET /read-models/orders/:id` — proof that the outbox relay published
`OrderPlaced` to RabbitMQ and the consumer projected it.

## Try it

```bash
API=https://xxxx.cloudfront.net   # from the run summary
KEY=$(aws ssm get-parameter --with-decryption --name /ddd-cqrs/API_KEY \
  --query Parameter.Value --output text)
API_URL=$API API_KEY=$KEY scripts/smoke-test.sh
curl -s $API/read-models/orders -H "X-API-Key: $KEY"
```

## Destroy

RDS, the ALB and the Fargate tasks are billed by the hour. Tear the stack down
when you are done (the bootstrap resources are kept):

```bash
gh workflow run destroy.yml --repo luizcurti/ddd-cqrs-rabbitmq --ref main -f confirm=destroy
```

Recreate it with the deploy command above.
