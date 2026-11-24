# API security hardening notes

## `X-Forwarded-For` and `TRUST_PROXY`

`server.ts` only reads `X-Forwarded-For` when `TRUST_PROXY=true`. Leave it
disabled when the server is exposed directly; in that mode the socket peer
address is used for rate limiting and audit context, and forwarded headers are
ignored.

When the server runs behind a reverse proxy:

1. Set `TRUST_PROXY=true`.
2. Ensure **every** request reaches the server through that proxy; otherwise a
   client can send its own forwarded header and bypass per-IP rate limits.
3. The proxy must append (not overwrite) the client IP to `X-Forwarded-For`.
   `resolveClientIp()` takes the **rightmost** hop by default, which is the
   value added by a single trusted proxy. If several proxies are trusted, set
   `TRUST_PROXY_HOPS` to the number of trusted hops on the right. Any value to
   the left of that window is client-controlled and is never used.

The same rule applies to `X-Forwarded-Host` / `X-Forwarded-Proto`, which are
only used to normalize the request URL when `TRUST_PROXY=true`.

## Device pairing ownership and migration

Existing firmware creates a pairing by calling `POST /api/v1/devices/pair`
without a session and later redeems the code from `GET /api/v1/devices/pair/:code`.
Requiring authentication immediately would break that flow, so the hardened
behaviour is phased:

### Phase 1 (implemented)

- A pairing request carrying a valid `Authorization: Bearer <token>` header is
  bound to the caller's team. Pairing a serial that already belongs to another
  team is rejected with `403`.
- Unauthenticated requests continue to work for legacy firmware. Final
  authorization is still enforced at link time: `linkDevice()` refuses to link
  a serial whose stored `teamId` differs from the linking user's team.
- Only the newest unlinked pairing for a serial is active. Requesting a new
  code expires any outstanding unlinked pairings for that serial, so a stale
  or attacker-squatted code cannot be redeemed after the real owner starts a
  new pairing.
- Pairings keep their short TTL and unique code index; expired pairings are
  removed by the existing TTL index.

### Phase 2 (migration path)

1. Update firmware to send the user's session token with the pairing request.
2. Roll the change out to a canary cohort and watch `device_claims_total` for
   `403 foreign_serial` responses.
3. Once all supported firmware versions authenticate, change
   `handleRequestPairing` to use `requireAuth` and remove the unauthenticated
   branch. Existing unlinked pairings expire naturally and need no data
   migration.

No database schema changes are required: `teamId`/`ownerUsername` already exist
on the `devicePairings` documents.
