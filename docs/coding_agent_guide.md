# Coding Agent Guide

This guide defines how agents should write and organize code in this API.

## Core architecture

Use this layer order for all features:

`Route -> Controller -> Service -> Repository -> Data source`

Supporting layers:

- `models`: shared domain shapes/transformers
- `constants`: static values, enums, and config keys

## What each layer does

### Routes

- Define endpoint path and HTTP method.
- Attach request middlewares.
- Call controller methods only.
- Do not place business logic in routes.

### Controllers

Controllers are the HTTP boundary.

Controllers should:

- Read `req.params`, `req.query`, `req.body`, and `req.user`.
- Call one service method per use case.
- Return API responses using `ApiResponse`.
- Map thrown errors to proper HTTP responses.

Controllers should not:

- Perform direct Supabase/DB queries.
- Contain heavy business logic.
- Contain reusable domain rules.

### Services

Services contain business logic and use-case orchestration.

Services should:

- Validate business rules.
- Coordinate multiple repositories if needed.
- Transform raw repository data into domain output.
- Throw `CustomError` types from `src/utils/Errors.js`.

Services should not:

- Access `req`/`res` directly.
- Know anything about Express routing.

### Repositories

Repositories are the data access layer.

Repositories should:

- Contain raw database/supabase queries.
- Return plain data objects.
- Keep queries small and predictable.
- Translate low-level failures with `handleSupabaseError` where applicable.

Repositories should not:

- Apply business decisions (for example, permission strategy or pricing rules).
- Format HTTP responses.

### Models

Models define domain data structures and mapping helpers.

Models should:

- Hold pure data mapping/shape logic.
- Convert database rows to domain-friendly objects when needed.
- Stay framework-agnostic (no Express or HTTP logic).

Models should not:

- Make network/database calls.
- Contain endpoint-specific controller logic.

### Constants

Constants hold fixed values used across the app.

Constants should:

- Store enums, status maps, regex patterns, and reusable limits.
- Be grouped by API version/domain when applicable (`src/constants/v1/...`).
- Use clear `UPPER_SNAKE_CASE` names for immutable values.

Constants should not:

- Include executable business workflows.
- Depend on request/response objects.

## Request flow standard

1. Route receives request and forwards to controller.
2. Controller extracts input and calls service.
3. Service validates rules and calls repository.
4. Repository reads/writes data source.
5. Service returns processed result.
6. Controller sends response with `ApiResponse.success(...)`.

Error flow:

- Repository or service throws typed error.
- Controller catches and returns `ApiResponse.error(...)` with matching status code.

## Folder and naming convention

Use this structure for v1:

```text
src/
  constants/v1/<domain>.constants.js
  controllers/v1/<domain>/<domain>.controller.js
  models/v1/<domain>/<domain>.model.js
  services/v1/<domain>/<domain>.service.js
  repositories/v1/<domain>/<domain>.repository.js
  routes/v1/<domain>/<domain>.routes.js
```

Naming rules:

- One domain per folder (`finance`, `user`, `auth`, etc.).
- Use suffixes: `.controller.js`, `.service.js`, `.repository.js`, `.routes.js`, `.model.js`, `.constants.js`.
- Export named functions for actions; avoid large default-export objects.

## Coding rules for agents

- Keep functions small and single-purpose.
- Validate input as early as possible.
- Reuse utilities from `src/utils` before adding new helpers.
- Use existing error classes from `src/utils/Errors.js`.
- Return consistent responses through `src/utils/responseHandler.js`.
- Avoid duplicate logic across controllers; move shared logic to services.
- Put hardcoded strings/numbers shared across files into `src/constants`.
- Keep data-shape mapping in `src/models`, not controllers.
- Do not add dead code, TODO placeholders, or unused imports.

## Example responsibility split

Use case: `POST /v1/finance/quote`

- Route: wire `POST /finance/quote` to controller.
- Controller: read symbol from body, call service, return HTTP 200.
- Service: check symbol format and business rules, call repository.
- Repository: fetch quote from DB/external provider and return raw data.
- Model: normalize raw quote row into API-facing quote object.
- Constants: hold symbol validation regex and default limits.

## Minimal patterns

Controller pattern:

```js
import { ApiResponse } from "../../../utils/responseHandler.js";
import { getQuote } from "../../../services/v1/finance/finance.service.js";

export async function getQuoteController(req, res) {
  try {
    const result = await getQuote({ symbol: req.body.symbol });
    return res.status(200).json(ApiResponse.success(result, "Quote fetched"));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res
      .status(statusCode)
      .json(ApiResponse.error(error.message, error.code || "ERROR"));
  }
}
```

Service pattern:

```js
import { ValidationError } from "../../../utils/Errors.js";
import { findQuoteBySymbol } from "../../../repositories/v1/finance/finance.repository.js";

export async function getQuote({ symbol }) {
  if (!symbol) {
    throw new ValidationError("symbol is required", "symbol");
  }

  const quote = await findQuoteBySymbol(symbol);
  return quote;
}
```

Repository pattern:

```js
import supabase from "../../../utils/supabaseClient.js";
import { handleSupabaseError } from "../../../utils/Errors.js";

export async function findQuoteBySymbol(symbol) {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("symbol", symbol)
    .single();

  if (error) {
    handleSupabaseError(error);
  }

  return data;
}
```

Model pattern:

```js
export function toQuoteModel(row) {
  return {
    symbol: row.symbol,
    price: row.price,
    updatedAt: row.updated_at,
  };
}
```

Constants pattern:

```js
export const SYMBOL_REGEX = /^[A-Z.]{1,10}$/;
export const DEFAULT_QUOTE_LIMIT = 50;
```

## Auth and protection

- **Public routes**: No `authenticate` middleware (e.g. `POST /v1/auth/login`, `POST /v1/auth/refresh`).
- **Protected routes**: Use `authenticate` so `req.user` (id, email, role) is set; return 401 if missing/invalid token or user suspended.
- **Role-based access**: Use `requireRole(allowedRoles)` after `authenticate`; return 403 if role not in list.
- **Layers**: Auth is applied only in routes (middleware). Controllers read `req.user`; services receive `userId` from controllers.
- **Response**: Use `ApiResponse.success(data, message)` and `ApiResponse.error(message, code)`; use error `statusCode` for HTTP status.

## Definition of done for new endpoints

A feature is complete only if:

- Route, controller, service, repository, and (when useful) model/constants are separated correctly.
- Errors are typed and response format is consistent.
- No business logic exists in routes/controllers.
- No direct DB calls exist in controllers/services.
- Naming and folder conventions match this guide.
