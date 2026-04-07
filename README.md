# tg-worker-echo

Canary/echo worker Lambda for end-to-end SQS architecture testing. This is the first `tg-worker-*` repo and serves as the reference implementation for building workers that integrate with the shared SQS-based architecture.

## What it does

The echo worker validates the full message pipeline:

1. **Webhook Lambda** parses a `/echo` command and sends an `OrderMessage` to the Order Queue
2. **Echo Worker** (this repo) picks it up, echoes the payload back as a `ResultMessage` to the Result Queue
3. **Feedback Lambda** picks up the result and sends it back to the user via Telegram

This round-trip validates every component in the pipeline: SQS permissions, message schema compatibility, KMS encryption, IAM roles, and event source filtering.

## Architecture

```
Telegram → Webhook Lambda → Order Queue → Echo Worker → Result Queue → Feedback Lambda → Telegram
                                            (this repo)
```

The echo worker:
- Consumes from Order Queue filtered by `taskType: "echo"`
- Produces to Result Queue with `status: "success"` and `followUpAction: "notify"`
- Echoes the original payload back with processing metadata

## Prerequisites

- Node.js 22+
- AWS CDK v2
- Shared infrastructure deployed via [tg-assistant-infra](https://github.com/qlibin/tg-assistant-infra)
- `@qlibin/tg-assistant-contracts` package (SQS message schemas)

## Setup

```bash
# Install dependencies
npm install
cd infrastructure && npm install && cd ..

# Run validation
npm run validate
cd infrastructure && npm run validate && cd ..

# Bundle for deployment
npm run package:lambda
```

## Deployment

Automated via GitHub Actions on push to `main`. See `.github/workflows/cd.yml`.

Manual deployment:

```bash
cd infrastructure
npx cdk deploy -c environment=dev
```

## Using as a template

To create a new worker (e.g., `tg-worker-playwright`):

1. Copy this repo
2. Replace `echo` with your task type name in file names, filter values, CDK construct IDs, and Lambda names
3. Replace the handler logic in `src/index.ts`
4. Update the SQS filter: `FilterRule.isEqual('echo')` → your task type
5. Adjust Lambda memory and timeout for your workload
6. Add your dependencies
7. Update documentation

## Related repos

- [tg-assistant-infra](https://github.com/qlibin/tg-assistant-infra) — shared SQS, API Gateway, IAM infrastructure
- [tg-assistant](https://github.com/qlibin/tg-assistant) — webhook + feedback Lambdas
- [tg-assistant-echo](https://github.com/qlibin/tg-assistant-echo) — Canary/echo worker Lambda for end-to-end testing
- [@qlibin/tg-assistant-contracts](https://www.npmjs.com/package/@qlibin/tg-assistant-contracts) — shared message schemas

## Related repos

- [tg-assistant-infra](https://github.com/qlibin/tg-assistant-infra) — shared SQS, API Gateway, IAM infrastructure
- [tg-assistant](https://github.com/qlibin/tg-assistant) — webhook + feedback Lambdas
- [tg-worker-echo](https://github.com/qlibin/tg-worker-echo) — Canary/echo worker Lambda for end-to-end testing
- [@qlibin/tg-assistant-contracts](https://www.npmjs.com/package/@qlibin/tg-assistant-contracts) — shared message schemas
