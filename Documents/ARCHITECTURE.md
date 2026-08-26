# Bottle Bee — Architecture & Conventions

> **Cheers Delivered Fast.**

## 0. Repository Audit (Phase 1)

Audit performed before any code was written.

| Path | State at audit |
|---|---|
| `BottleBeeApi/` | empty directory |
| `BottleBeeUi/` | empty directory |
| `Documents/Business Requirement Document.pdf` | BRD v1.0 (draft) |
| `Logo.jpeg` | brand asset |

**Result: no pre-existing source code, no git repository, no established conventions.**
Therefore the conventions below are *established* here (not inherited) and are binding for all
future work. Every subsequent change must conform to this document rather than inventing a
parallel style.

Verified toolchain: Node v22.21.0 · npm 11.7.0 · MySQL 8.0.44 · Angular CLI 21.0.5 · git 2.54.

## 1. Layout

```
BottleBeeApi/          Node.js + Express + Sequelize + MySQL  (backend)
BottleBeeUi/           Angular                                (frontend)
Documents/             BRD, architecture, API notes
```

Backend folders sit directly under `BottleBeeApi/` (no `src/`), per spec section 6:

```
BottleBeeApi/
  config/        env loading, sequelize instance, constants, logger
  controllers/   business logic: read req.body, query, transact, respond
  middlewares/   auth, rbac, validate, errors, rate limits, uploads, audit ctx
  migrations/    the ONLY way schema changes
  models/        Sequelize models + associations
  routes/        versioned routers (/api/v1)
  seeders/       RBAC, super admin, compliance, catalog samples
  services/      cross-cutting only (pricing, compliance, stock, notify)
  validators/    Joi schemas per module
  utils/         response, errors, jwt, pagination, state machine, audit
  swagger/       OpenAPI components + generator
  tests/         Jest + Supertest
```

## 2. Binding backend conventions

1. **Inputs always come from `req.body`.** Never `req.query`, never `req.params`
   for business identifiers. Pagination (`page`, `limit`), sorting (`sortBy`,
   `sortOrder`), filters and IDs all arrive in the body.
2. **`POST` for everything**, including list / getAll / detail / update / delete.
   This is the project-wide convention; it keeps a single input contract.
3. **Centralized responses only** — `utils/response.js`. A controller never calls
   `res.json()` directly and never leaks a Sequelize error.
4. **Business logic lives in the controller.** A controller function owns its
   module end to end: the follow-up checks validation cannot express, the
   Sequelize queries, the transaction, the audit write and the response. There is
   **no service per module** — no `user.service.js` behind `user.controller.js`.
   Module-private helpers sit at the top of the controller file that uses them.
5. **`services/` is for cross-cutting logic only** — logic that more than one
   controller genuinely calls. Today that is pricing, notifications, compliance
   evaluation, inventory movements, coupon validation, vendor access guards, the
   shared cart primitives and `requireProfile`. If exactly one controller needs
   it, it does not belong here. If two controllers need it, it does — do not
   duplicate it into both to satisfy rule 4.
6. **Transactions belong to the controller function that owns the operation.**
   Checkout, order transitions, inventory movements and refunds each open their
   own `sequelize.transaction()` and pass it down into any shared service they
   call, so a shared helper never commits independently of its caller.
7. **Route middleware order is fixed:**
   `validate(schema)` → `authenticate` → `authorize(PERMISSION)` → controller.
   No endpoint reaches a controller unauthenticated unless it is explicitly
   public.
8. **Each controller function is wrapped in its own `try/catch`** and returns
   through `utils/response.js`. `AppError` and the central error handler remain
   the backstop for anything unanticipated.
9. **Swagger for every route** via JSDoc `@openapi` blocks in `routes/`.
10. **Schema changes only via migrations.** `sequelize.sync()` is never used.
11. **Soft delete everywhere** — Sequelize `paranoid: true` on `deleted_at`, plus
    `deleted_by`. Queries exclude soft-deleted rows unless an admin/audit path
    explicitly opts in with `paranoid: false`.

### Naming

* **Database:** `snake_case` tables and columns.
* **JavaScript / API:** `camelCase`. Models set `underscored: true`, so
  `firstName` maps to `first_name` automatically. API payloads are camelCase.
* Model files: `PascalCase.js` matching the model name (`CustomerProfile.js`).
* Everything else (controllers, services, routes, validators): `camelCase.js`
  named after the module (`order.controller.js`, `order.routes.js`).

### Audit fields

Every business table carries:

```
created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, is_active
```

Sequelize handles `created_at` / `updated_at` / `deleted_at` via
`timestamps: true, paranoid: true, underscored: true`. The `*_by` columns are
explicit attributes (`createdBy`, `updatedBy`, `deletedBy`) written by the
controller from `req.user.id`. `audit_logs` is exempt (append-only, `created_at`
only).

### Types

| Concern | Type |
|---|---|
| Primary key | `BIGINT UNSIGNED AUTO_INCREMENT` |
| Money | `DECIMAL(10,2)` |
| Lat / Lng | `DECIMAL(10,6)` |
| Names, emails, labels | `VARCHAR(255)` unless narrowed |
| Long text | `TEXT` |
| Flexible payloads | `JSON` (provider responses, rule metadata) only |

Every foreign key declares `ON DELETE` and `ON UPDATE` explicitly.

## 3. Response contract

Success:

```json
{ "success": true, "message": "...", "data": {} }
```

Paginated:

```json
{ "success": true, "message": "...", "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 } }
```

Error:

```json
{ "success": false, "message": "Validation failed", "errors": [] }
```

HTTP status codes are still meaningful (200/201/400/401/403/404/409/422/429/500);
the envelope is in addition to, not instead of, the status code.

## 4. Security posture

bcrypt password hashing · short-lived JWT access token · rotating refresh tokens
stored **hashed** with reuse detection · helmet · env-driven CORS · rate limits on
login / OTP / password reset / checkout · Joi validation and sanitization on every
input · MIME + size validation on uploads · zero secrets in source · audit log on
every sensitive operation.

## 5. Stack decisions (rationale)

| Choice | Why |
|---|---|
| Joi for validation | Body-only contract fits `req.body` convention cleanly |
| `underscored: true` | snake_case DB per spec, camelCase JS/API for the Angular client |
| `paranoid: true` | Native soft delete on `deleted_at`, no hand-rolled filters |
| Razorpay + mock provider | BRD targets India; mock provider keeps dev/test runnable without keys |
| swagger-jsdoc | Docs live next to the route they describe, so they stay current |
| Jest + Supertest | Backend unit + API tests |
| Playwright | Frontend E2E, per spec |
