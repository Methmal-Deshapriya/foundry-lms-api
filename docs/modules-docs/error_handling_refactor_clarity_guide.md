# Error Handling Refactor Clarity Guide

This document explains the error-handling refactor we did in the Foundry LMS backend so it is easier to reason about later.

The goal of this refactor was not to add new business features. The goal was to remove confusion, reduce ambiguity, and make the architecture easier to understand while preserving modularity.

## Why We Refactored

Before the refactor, error response responsibility was split across multiple places:

- `src/utils/responseHandler.js`
- `src/middlewares/errorHandler.js`
- some controller usages that accidentally mixed success and error concerns

This created confusion because it was hard to answer simple questions like:

- Where is the final error response created?
- Which file decides the error shape?
- Which layer should send error responses?
- Why can a success controller call accidentally behave like an error response?

There was also a real bug caused by this ambiguity:

- `ApiResponse.send(res, user, "Login successful")`

In the old design, the third argument of `send()` was treated like an error object, not a success message. So a controller could accidentally produce a fake `500 Internal Server Error` response even when the login logic itself succeeded.

## What Was Wrong In The Old Design

The old design allowed one helper to do too many things.

`ApiResponse.send()` tried to handle:

- success responses
- error responses
- status code resolution
- some message extraction rules

At the same time, `errorHandler.js` was also preparing an `errorResponse` object and passing it into `ApiResponse.send()`.

So the responsibilities looked like this:

- `errorHandler.js` shaped error meaning
- `responseHandler.js` also shaped error output

This was technically workable, but mentally expensive.

## Refactor Goal

We wanted one simple rule:

- success responses should come from the response utility
- error responses should come from the global error middleware

That gives us clear ownership.

## What We Changed

### 1. `responseHandler.js` Became Success-Focused

Current file:

- `src/utils/responseHandler.js`

What it does now:

- `ApiResponse.success(data, message)` builds a success response object
- `ApiResponse.send(res, data, message, statusCode)` sends success responses only

What it no longer does:

- it no longer formats or sends error responses

This means the success helper is now much easier to understand.

### 2. `errorHandler.js` Now Owns Final Error Responses

Current file:

- `src/middlewares/errorHandler.js`

What it does now:

1. Logs the real error for the developer using `Logger.error(...)`
2. Decides whether the error is:
   - a known `CustomError`
   - or an unknown system error
3. Builds the final client-safe error response
4. Sends the HTTP error JSON directly with `res.status(...).json(...)`

This means the global error middleware is now the single owner of client-facing error responses.

## The New Mental Model

The clean model after the refactor is:

### Success path

- service/repository returns data
- controller sends success with `ApiResponse.send(...)`

### Error path

- service/repository throws an error
- controller calls `next(error)`
- Express forwards the error to `errorHandler.js`
- `errorHandler.js` logs it and sends the final error response

So now the rule is:

- `responseHandler.js` is for success
- `errorHandler.js` is for errors

That is the core clarity improvement.

## Current Responsibility By Layer

### Repository

Responsibilities:

- talk to Prisma / database
- optionally translate database errors into custom app errors

Should not:

- send HTTP responses

### Service

Responsibilities:

- business logic
- validation orchestration
- authentication rules
- throw `ValidationError`, `UnauthorizedError`, `ConflictError`, etc.

Should not:

- send HTTP responses

### Controller

Responsibilities:

- receive request
- call service
- send success response
- call `next(error)` on failure

Should not:

- shape client-facing error responses

### Global Error Middleware

Responsibilities:

- log server-side error details
- sanitize unknown errors
- send final client-facing error JSON

This is now the only place that sends error responses.

## Why This Is Better

### 1. Less ambiguity

Now it is much easier to answer:

- Where do success responses come from?
  - `ApiResponse.send(...)`
- Where do error responses come from?
  - `errorHandler.js`

### 2. Safer controllers

Controllers no longer risk accidentally triggering error behavior by passing arguments into an overloaded method incorrectly.

### 3. Better modularity

Each piece now has a clearer job:

- response utility: success formatting
- error middleware: error formatting

That is actually more modular, not less modular, because each module owns one concern cleanly.

### 4. Easier debugging

When something goes wrong:

- the thrown error moves upward
- the controller passes it with `next(error)`
- the middleware logs the real error
- the client receives a safe response

This is much easier to reason about than having multiple layers capable of shaping error output.

## What We Did Not Change

We did not change the core business logic of registration or login as part of this response-format refactor.

We changed the structure around:

- response formatting
- error ownership
- controller clarity

So this was an architectural cleanup, not a feature rewrite.

## Example Of The New Pattern

### Success response in a controller

```js
return ApiResponse.send(res, user, "Login successful");
```

### Error response in the middleware

```js
return res.status(errorResponse.statusCode).json({
  success: false,
  error: errorResponse.message,
  code: errorResponse.code,
  ...(errorResponse.field != null ? { field: errorResponse.field } : {}),
  ...(errorResponse.details != null ? { details: errorResponse.details } : {}),
});
```

## The Most Important Rule To Remember

If the client receives an error response, it should come from `errorHandler.js`.

If the client receives a success response, it should come from `ApiResponse.send(...)`.

That single rule is the main clarity win from this refactor.

## Final Architecture Summary

After the refactor:

- `src/utils/responseHandler.js`
  - success only
- `src/middlewares/errorHandler.js`
  - error only
- controllers
  - send success or call `next(error)`
- services/repositories
  - throw errors upward

This is the architecture we should keep following going forward if we want the codebase to remain easy to understand.
