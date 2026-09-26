# Nelson — Budget Control (REST API)

The API behind Nelson: personal budgets per currency, items expanded into dated "buckets", transactions allocated to those buckets, and forecasts and suggestions computed from them.

**Live app:** https://fsdev-nelson-budget-frontend.vercel.app · **Web app repo:** [fsdev-nelson-budget-frontend](https://github.com/gusanchefullstack/fsdev-nelson-budget-frontend)

![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000?logo=express)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2d3748?logo=prisma)
![Neon Postgres](https://img.shields.io/badge/Neon-Postgres%2017-00e699?logo=postgresql&logoColor=white)
![Deployed on Vercel](https://img.shields.io/badge/Vercel-deployed-000?logo=vercel)
![License](https://img.shields.io/badge/license-MIT-blue)

## Table of Contents

- [Why this API?](#why-this-api)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Tests](#tests)
- [What I learned](#what-i-learned)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)
- [Author](#author)

## Why this API?

Budget apps usually compare month totals. Nelson compares each **expected occurrence** of each item with what actually happened in its window, so it can say "rent was missed in March", "electricity runs 12% over" or "you'll finish with a USD 5,000 surplus" — with rules that are small, pure and fully tested.

Key rules enforced here (and in the database where possible):

- One budget per currency per period (a PostgreSQL exclusion constraint backs the friendly 409).
- Items are clamped into their budget's dates; buckets start half a nominal period before each expected date (monthly on the 20th → the 5th to the 4th) and cover the whole item.
- Income is payor → account, expense is account → vendor; account balances and bucket actuals are recalculated in the same database transaction as every write.
- Transactions are stored as an instant plus the user's IANA timezone at the time; changing the profile timezone never moves past transactions.
- Every error leaves as `{ "error": { "code", "message", "fields?" } }` — never a stack trace.

## Installation

**Prerequisites:** Node.js 24.x, npm, a PostgreSQL database (a free [Neon](https://neon.tech) project with `dev` and `test` branches works well).

```bash
git clone https://github.com/gusanchefullstack/fsdev-nelson-budget-backend.git
cd fsdev-nelson-budget-backend
cp .env.example .env          # fill in the values below
npm install                   # also generates the Prisma client
npx prisma migrate deploy     # creates tables and constraints
npm run dev                   # http://localhost:3000
```

## Usage

The web app talks to the API through a same-origin proxy, so sessions are plain cookies. From a terminal:

```bash
# Create an account (all profile fields are required)
curl -c jar.txt -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" -H "Origin: http://localhost:5173" \
  -d '{"name":"Ana Tester","email":"ana@example.com","username":"ana","password":"correct-horse-1",
       "firstName":"Ana","lastName":"Tester","address":"Calle 1","city":"Bogotá","postalCode":"110111",
       "state":"DC","country":"CO","phoneCountryCode":"+57","phoneNumber":"3001234567","timezone":"America/Bogota"}'

# Create a budget with a category and a monthly item in one request
curl -b jar.txt -X POST http://localhost:3000/api/v1/budgets -H "Content-Type: application/json" \
  -d '{"name":"2027","currency":"USD","startDate":"2027-01-01","endDate":"2027-12-31",
       "categories":[{"type":"EXPENSE","name":"Housing","items":[{"name":"Rent","description":"Apartment",
       "estimatedAmount":"5000","firstExpectedDate":"2027-01-20","frequency":"MONTHLY"}]}]}'
```

```json
{ "data": { "id": "cmg…", "name": "2027", "currency": "USD", "startDate": "2027-01-01", "endDate": "2027-12-31" }, "notices": [] }
```

## Configuration

| Variable | Description | Required | Default |
|---|---|---|---|
| `DATABASE_URL` | Pooled Postgres URL used at runtime | Yes | — |
| `DATABASE_URL_UNPOOLED` | Direct URL used by Prisma migrations | Yes | — |
| `TEST_DATABASE_URL` | Separate database/branch for integration tests | For tests | — |
| `BETTER_AUTH_SECRET` | Secret for signing sessions (`openssl rand -base64 32`) | Yes | — |
| `BETTER_AUTH_URL` | Public URL of the web app (links in emails) | Yes | — |
| `TRUSTED_ORIGINS` | Comma-separated origins allowed to call auth routes | Yes | — |
| `RESEND_API_KEY` | [Resend](https://resend.com) key for password-reset emails | No | emails are logged |
| `EMAIL_FROM` | Sender for password-reset emails | No | `Nelson <onboarding@resend.dev>` |

## API Reference

All routes except `/api/auth/*` and `/api/health` need a session cookie.

| Area | Endpoints |
|---|---|
| Auth (Better Auth) | `POST /api/auth/sign-up/email`, `/sign-in/email`, `/sign-in/username`, `/sign-out`, `/request-password-reset`, `/reset-password`, `/change-email`; `GET /api/auth/get-session` |
| Profile | `GET` / `PATCH /api/v1/me` |
| Budgets | `GET` / `POST /api/v1/budgets`, `GET` / `PATCH` / `DELETE /api/v1/budgets/:id` |
| Categories | `POST /api/v1/budgets/:budgetId/categories`, `PATCH` / `DELETE /api/v1/categories/:id` |
| Items & buckets | `POST /api/v1/categories/:categoryId/items`, `GET` / `PATCH` / `DELETE /api/v1/items/:id` |
| Accounts, payors, vendors | `GET` / `POST /api/v1/{accounts,payors,vendors}`, `GET` / `PATCH` / `DELETE …/:id` |
| Transactions | `GET /api/v1/transactions?budgetId&type&from&to&page`, `POST`, `GET` / `PATCH` / `DELETE /:id` |
| Dashboard | `GET /api/v1/dashboard` |
| Reports | `GET /api/v1/reports/budgets/:id/execution?from&to`, `/reports/by-entity?dimension&budgetId`, `/reports/budgets/:id/top?n=5\|10\|20`, `/reports/budgets/:id/suggestions` |

### `POST /api/v1/transactions`

```json
{ "itemId": "cmg…rent", "amount": "5000", "localDateTime": "2027-02-18T20:00", "accountId": "cmg…checking", "vendorId": "cmg…landlord" }
```

**Response (201):**

```json
{ "data": { "type": "EXPENSE", "amount": "5000.00", "currency": "USD", "timezone": "America/Bogota",
  "localDate": "2027-02-18", "localDateTime": "2027-02-18T20:00", "occurredAt": "2027-02-19T01:00:00.000Z",
  "bucketId": "cmg…bucket2", "itemName": "Rent", "accountName": "Checking", "vendorName": "Landlord" } }
```

**Errors:** `422` with `fields` (e.g. a date outside the item or an account in another currency), `404` for records that aren't yours, `409` for conflicts, `429` for too many attempts.

## Project Structure

```text
src/
├── index.ts          # Express app (Vercel entry, default export)
├── dev.ts            # local listener
├── domain/           # pure logic: bucket generation, insights (projections, suggestions)
├── modules/          # one folder per resource: schemas.ts, service.ts, router.ts
└── lib/              # prisma, auth, Temporal helpers, errors, validation, balances
prisma/               # schema, migrations (incl. custom constraints), perf seed
tests/                # Vitest unit + Supertest integration tests
```

## Tests

**Vitest** for unit tests and **Supertest** integration tests against a real Postgres test branch.

```bash
npm test                                   # everything
npm run test:unit                          # pure logic (buckets, insights, Temporal)
npm run test:integration                   # API against TEST_DATABASE_URL
npx vitest run tests/unit/buckets.test.ts  # a single file
npx tsx --env-file=.env prisma/seed-perf.ts   # seed a year of data and time the heaviest endpoints
```

## What I learned

- **Pure domain modules pay off.** Bucket generation and insights take plain Temporal dates and strings (cents internally), so the tricky rules — month-end clamping, half-period windows, forecasts that never double-count a paid period — are exhaustively unit-tested without a database.
- **Let the database enforce invariants** that matter: an `EXCLUDE USING gist` constraint for non-overlapping budgets and `CHECK` constraints for transaction origin/destination, added to Prisma's generated migration SQL.
- **Serverless realities** ([Vercel Functions](https://vercel.com/docs/functions)): Better Auth's in-memory rate limiter does nothing across instances, so limits and the sign-in lockout live in the database; Neon pool timeouts turn a stuck connection into an error instead of a hung request.
- **Temporal API** ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal)) on Node 24 via `temporal-polyfill`: `disambiguation: "earlier"` plus a round-trip check rejects times that don't exist during a DST jump.
- **Prisma 7 + Neon** ([docs](https://www.prisma.io/docs/orm/overview/databases/neon)): driver adapters, `prisma.config.ts`, and why Render's free Postgres (deleted after 30 days) wasn't an option.

## Roadmap

- [x] v0.1 — budgets, buckets, transactions, dashboard, reports, suggestions
- [ ] v0.5 — receipt upload with AI extraction, alert thresholds and notifications
- [ ] v0.8 — bank aggregator integration (e.g. Plaid), smart advisor
- [ ] v1.0 — more currencies, multi-language, admin roles

## Contributing

1. Fork the repo and create a branch: `feat/short-description` or `fix/short-description`.
2. Use [Conventional Commits](https://www.conventionalcommits.org/).
3. Run `npm run lint && npm run typecheck && npm test`.
4. Open a pull request describing the change and how you tested it.

## License

Distributed under the MIT License. See [LICENSE](./LICENSE) for details.

## Credits

[Express](https://expressjs.com), [Better Auth](https://better-auth.com), [Prisma](https://www.prisma.io), [Neon](https://neon.tech), [Zod](https://zod.dev), [Resend](https://resend.com), [temporal-polyfill](https://github.com/fullcalendar/temporal-polyfill), [Vitest](https://vitest.dev), [Supertest](https://github.com/ladjs/supertest).

## Author

**Gustavo Sanchez**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?logo=linkedin&logoColor=white)](https://www.linkedin.com/in/gustavosanchezgalarza/) [![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/gusanchefullstack) [![Hashnode](https://img.shields.io/badge/Hashnode-2962FF?logo=hashnode&logoColor=white)](https://hashnode.com/@gusanchedev) [![X](https://img.shields.io/badge/X-000000?logo=x&logoColor=white)](https://x.com/gusanchedev) [![Bluesky](https://img.shields.io/badge/Bluesky-0285FF?logo=bluesky&logoColor=white)](https://bsky.app/profile/gusanchedev.bsky.social) [![freeCodeCamp](https://img.shields.io/badge/freeCodeCamp-0A0A23?logo=freecodecamp&logoColor=white)](https://www.freecodecamp.org/gusanchedev) [![Frontend Mentor](https://img.shields.io/badge/Frontend%20Mentor-3F54A3?logo=frontendmentor&logoColor=white)](https://www.frontendmentor.io/profile/gusanchefullstack)
