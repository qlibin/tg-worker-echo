# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Canary/echo worker Lambda that validates the full SQS message flow end-to-end and serves as the template for all `tg-worker-*` repos.

Part of the Telegram personal assistant system:
- **tg-assistant-infra** — shared infrastructure (SQS, API Gateway, IAM roles, KMS)
- **tg-assistant** — webhook + feedback Lambdas
- **tg-worker-echo** (this repo) — echo/canary worker Lambda

## Commands

```bash
npm run build          # TypeScript compilation
npm run test           # Run tests with coverage
npm run lint           # ESLint validation
npm run lint:fix       # Auto-fix lint issues
npm run format         # Format with Prettier
npm run format:check   # Check formatting
npm run type-check     # TypeScript type checking
npm run validate       # Full validation (build + lint + format + type-check + test)
npm run package:lambda # Bundle and ZIP for deployment
```

### Infrastructure (`infrastructure/` directory)

```bash
npm run build          # TypeScript compilation
npm run test           # Run CDK tests with coverage
npm run lint           # ESLint validation
npm run format:check   # Check formatting
npm run validate       # Full validation
npm run synth          # Synthesize CloudFormation
npm run diff           # Show stack diff
npm run deploy         # Deploy stack
```

**AWS Profile:** Use `aws-course` for CDK and AWS CLI commands.

## Architecture

```
Order Queue (SQS)
    │ SQS Event Source (filter: taskType = "echo")
    ▼
Echo Worker Lambda
    │ sqs:SendMessage
    ▼
Result Queue (SQS)
    │ SQS Event Source
    ▼
Feedback Lambda (tg-assistant repo)
    │
    ▼
Telegram User
```

The echo worker:
1. Consumes `OrderMessage` from Order Queue (filtered by `taskType: "echo"`)
2. Echoes the payload back as `ResultMessage` with `status: "success"` and `followUpAction: "notify"`
3. Includes metadata: `workerVersion`, `processedAt`, `echoedPayload`

## Key Files

| File | Description |
|------|-------------|
| `src/index.ts` | Lambda handler (SQS consumer + Result producer) |
| `infrastructure/lib/tg-worker-echo-stack.ts` | CDK stack |
| `infrastructure/bin/tg-worker-echo.ts` | CDK entry point |
| `scripts/bundle-lambda.js` | esbuild bundler + ZIP |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RESULT_QUEUE_URL` | Yes | SQS Result Queue URL (set by CDK from SSM) |
| `ENVIRONMENT` | Yes | Environment name (dev/test/prod) |
| `SIMULATED_DELAY_MS` | No | Optional delay in ms to simulate work |
| `AWS_ACCOUNT_ID` | CI/CD | AWS account for deployment |

## SSM Parameters (from tg-assistant-infra)

| Parameter | Used For |
|-----------|----------|
| `/automation/{env}/roles/worker/arn` | Lambda execution role |
| `/automation/{env}/queues/order/arn` | SQS event source mapping |
| `/automation/{env}/queues/result/url` | Result Queue URL env var |

## Code Conventions

- No `any` type — use `unknown` or proper types
- Naming: camelCase (vars/functions), PascalCase (classes/interfaces), SCREAMING_SNAKE_CASE (constants), kebab-case (files)
- Import order: external libraries, internal modules, relative imports
- 85% minimum test coverage (statements, functions, lines); 75% branches
- AAA pattern in tests (Arrange, Act, Assert)
- ESM modules (`"type": "module"`)

## Testing

- Handler tests: `tests/index.test.ts` — mock SQS client, test echo flow, batch failures
- CDK tests: `infrastructure/test/` — snapshot + assertion tests
- Update snapshots: `npm test -- -u` (in infrastructure/)
