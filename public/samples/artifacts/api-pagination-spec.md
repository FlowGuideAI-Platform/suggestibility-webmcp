# Public API Spec: Pagination for List Endpoints (v2)

**Status:** Approved for implementation
**Author:** M. Reyes, API Platform
**Reviewers:** Developer Experience, Partner Integrations
**Target release:** Quillstack Public API v2, Q3

## Summary

This spec defines the pagination contract for all list-returning endpoints
in Quillstack Public API v2, starting with `GET /v2/documents` and
`GET /v2/workspaces/{id}/members`, and intended as the standard every future
list endpoint follows without re-litigating the decision. We are adopting
**offset-based pagination** using `limit` and `offset` query parameters.
This document covers the request/response contract, defaults and bounds,
error handling, and how this interacts with our rate limits and API
versioning policy.

## Background

Public API v1 shipped three years ago with no pagination at all —
`GET /v1/documents` returns every document in a workspace, sorted by
`created_at`. This was fine when average workspace size was a few hundred
documents. Our largest customers now have workspaces north of 90,000
documents, and the unpaginated v1 endpoint has become a real problem: it's
the single most common cause of partner integration timeouts we see in
support tickets, and it's the top offender in our own API gateway's
"slowest endpoints" dashboard, not because it's inefficient per se but
because the response bodies are enormous.

v2 needs real pagination. This spec settles on the approach so that every
team building a v2 list endpoint over the next two quarters implements the
same pattern instead of five slightly different ones.

## Decision: Offset-based pagination

Every v2 list endpoint accepts two query parameters:

| Parameter | Type    | Default | Max   | Description                                  |
|-----------|---------|---------|-------|-----------------------------------------------|
| `limit`   | integer | 25      | 100   | Number of items to return                     |
| `offset`  | integer | 0       | —     | Number of items to skip before returning results |

### Example request

```
GET /v2/documents?limit=25&offset=50
Authorization: Bearer qsk_live_************************
```

### Example response

```json
{
  "data": [
    { "id": "doc_9f2a1c", "title": "Q3 Planning Notes", "created_at": "2026-05-02T14:21:00Z" },
    { "id": "doc_7b13ee", "title": "Onboarding Checklist", "created_at": "2026-05-01T09:04:12Z" }
  ],
  "pagination": {
    "limit": 25,
    "offset": 50,
    "total_count": 1420,
    "has_more": true
  }
}
```

`total_count` is the total number of items matching the query, independent
of pagination. `has_more` is `true` when `offset + limit < total_count`.
Clients paginate forward by incrementing `offset` by `limit` on each
request, and can jump to an arbitrary page directly — e.g., `offset=975`
to view the 40th page at `limit=25` — without walking through every page
in between.

## Why offset over cursor-based pagination

We evaluated cursor-based pagination (opaque `next_cursor` token, no
`offset` param, no direct page-jumping) and are not adopting it for v2, for
three reasons.

**Simplicity for API consumers.** Most of our partner integrations are
built by teams with one or two engineers who spend a few hours a quarter on
the Quillstack integration and then don't touch it again. `limit`/`offset`
is a pattern every one of them has already implemented against some other
API. A cursor token is one more opaque concept to explain in the docs, and
our developer support queue already spends too much time walking partners
through concepts that a more familiar pattern would avoid entirely. Every
support ticket we've fielded asking "how do I skip to a specific page" has
come from a partner assuming offset semantics were already in place — that
tells us what our audience expects.

**Direct page access.** Several of our partners build admin-style UIs on
top of the documents endpoint with a page-number selector (1, 2, 3, ... 57).
That UX pattern requires being able to compute an arbitrary page's offset
directly (`offset = (page - 1) * limit`), which cursor pagination does not
support — cursors are inherently sequential, you can't jump from page 2 to
page 40 without walking through the cursors in between. Since this UI
pattern shows up repeatedly in how partners consume the API, offset is the
better fit for our actual usage, not just the theoretically cleaner one.

**Our query pattern is already indexed correctly.** `documents` is indexed
on `(workspace_id, created_at DESC, id)`, which is exactly the sort order
this endpoint uses. An `OFFSET n LIMIT m` query against an indexed sort
column is a straightforward index scan that skips `n` rows before
collecting `m` — Postgres doesn't need to materialize or sort the full
result set to do this, so there's no full-table-scan concern here the way
there would be against an unindexed or unsorted column. Given that, the
commonly cited performance argument against offset pagination doesn't
apply to the way we're using it, and we'd rather keep the simpler, more
familiar contract than pay the added client-side complexity of cursors for
a performance problem we don't believe we have.

We also decided against **keyset pagination** (a variant using
`created_at`/`id` as an exposed cursor rather than a raw offset) for the
same simplicity argument — it solves a real problem but it's a problem we
don't think we have at current scale, and it changes the response shape in
a way that isn't backward compatible with how v1 partners already think
about pagination.

## Bounds and validation

- `limit` must be a positive integer between 1 and 100. Values above 100
  are clamped to 100 with no error (chosen over rejecting the request,
  since several partners pass `limit=1000` expecting "give me everything,"
  and clamping degrades gracefully rather than breaking their integration).
- `offset` must be a non-negative integer. There is no upper bound enforced
  by the API — offsets beyond `total_count` return an empty `data` array
  with `has_more: false` rather than an error, which is simpler for clients
  than having to special-case an out-of-range error.
- Both parameters are optional; omitting either uses the default.
- Non-integer or negative values for either parameter return `400 Bad
  Request` with an error body identifying the invalid parameter.

## Sort order and filtering

List endpoints default to `created_at DESC`. Some endpoints accept a `sort`
parameter (documented per-endpoint) to change this. Pagination parameters
apply after sorting and filtering — `offset` always means "skip this many
items from the already-sorted, already-filtered result set."

## Consistency during pagination

Because `offset` is a position in the result set at query time, not a
reference to a specific item, a client paginating through results while
other users are actively creating or deleting documents in the same
workspace may see an item shift between pages, or, in rare cases, see the
same item appear twice across two page requests (if an item was deleted
between the two requests, causing later items to shift up by one position).
This is expected behavior and consistent with how offset pagination works
generally. We considered this an acceptable trade-off given how
infrequently our partners page all the way through a large result set in a
single sitting — most integrations pull the first page or two on a
schedule, not the full history — and it keeps the contract simple. This is
called out explicitly in the public docs so partners aren't caught off
guard by it.

## Rate limiting interaction

Each paginated request counts as one call against the caller's rate limit,
regardless of `limit` size. A partner pulling 90,000 documents at
`limit=100` will make 900 requests. At our standard tier (300 requests/
minute), that's a 3-minute pull in the worst case. This is documented in
the Rate Limits section of the API reference, with a recommendation to use
the maximum `limit` of 100 for bulk pulls to minimize request count.

## Versioning and stability

This contract is considered stable for the lifetime of API v2. Per our API
versioning policy, we do not make breaking changes to a stable v2 endpoint
without shipping a v3. If a future scale requirement means we need to
introduce cursor-based pagination, that would ship as an additive,
backward-compatible option (e.g., accepting a `cursor` param as an
alternative entry point on the same endpoint) rather than a replacement of
`limit`/`offset`, so existing integrations are never broken by a
pagination change.

## Error responses

| Status | Condition                              |
|--------|-----------------------------------------|
| 400    | `limit` or `offset` is negative or non-integer |
| 401    | Missing or invalid API key               |
| 403    | Key valid but lacks access to the resource |
| 429    | Rate limit exceeded                      |

Example error body:

```json
{
  "error": {
    "code": "invalid_parameter",
    "message": "`offset` must be a non-negative integer.",
    "parameter": "offset"
  }
}
```

## Rollout plan

1. Ship on `GET /v2/documents` first (highest-traffic list endpoint,
   most partner usage, best signal on real-world behavior)
2. Add to `GET /v2/workspaces/{id}/members` and `GET /v2/comments` in the
   same release
3. Publish updated OpenAPI spec and partner migration guide
4. All new v2 list endpoints going forward use this contract by default;
   any exception requires sign-off from API Platform

## Open questions

- Should `total_count` be optional (via an `include=total_count` opt-in)
  for endpoints where computing it is expensive? Not a concern for
  `documents` today since the count comes from the same indexed query, but
  worth flagging for future endpoints with more complex filtering.
- Do we want a documented maximum on how deep into a result set a client
  can page (e.g., reject `offset` beyond some large ceiling) to protect
  against pathological usage? Not implementing for v1 of this spec; revisit
  if we see abuse patterns.
