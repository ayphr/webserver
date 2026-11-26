# No-Loading Architecture (Client Cache + Background Sync)

## Intent

After a user has successfully opened the Ayphr web app once, later opens and in-app navigation should show no loading UI. The app should render from local data immediately and synchronize with the server in the background.

User decisions captured in brainstorming:
- Approach A: persistent stale-while-revalidate cache.
- Persistence: survive browser restart. Cached data and auth session persist on device.
- Staleness: acceptable for cached resources. Show last-known data instantly, refresh silently.
- Data points exception: device/location timeseries data points are always loaded from server, never served as persisted stale cache. Non-blocking fetch UI allowed while loading.

## Why now

Current dashboard boot and navigation are network-gated. Users see route fallbacks, dashboard skeletons, and panel loading states on normal use. The product goal is "opened once, no loading basically ever".

## Goals

- Zero blocking loading UI after first successful bootstrap, including browser restart on same device/browser profile.
- Instant dashboard shell and last-viewed tab/content from persisted cache.
- Background refresh for all cached queries; UI updates when fresh data arrives.
- Navigation between dashboard tabs/routes does not show suspense/loading skeleton for previously visited/cached data.
- Mutations feel immediate: optimistic local update, server sync, rollback/error state on failure.
- Logout/account switch/remove-account clears sensitive cached data.
- Data points (`deviceDataPoints`, location history/timeseries) always fetch from server; never persisted as stale cache. Fetch is non-blocking where shell can render.

## Non-goals

- Full offline write support with conflict-free multi-device merge (Approach B).
- Guaranteeing zero network wait on the very first ever visit.
- Reworking backend API contracts unless a small additive endpoint materially reduces bootstrap requests.
- Perfect real-time consistency across devices; eventual consistency after background refresh is acceptable.
- Serving persisted stale timeseries/data-point readings. Data points always come from server.

## Anti-goals

- Showing stale sensitive data after logout, token expiry, or account switch.
- Hiding sync failures completely. Silent refresh is fine; failed user-initiated mutation or revoked auth must be visible/actionable.
- Adding a second ad-hoc cache system per panel. One shared cache/invalidation model.

## Current state (constraints)

- React 19 + Vite 8 SPA, React Router v7, lazy routes in `src/App.tsx`.
- Dashboard render blocked until `useDashboardUser` and `assistant.isLoading` complete (`src/pages/dashboard/DashboardPage.tsx`).
- `PolicyGate` and `EmailGate` fetch on mount; `PolicyGate` polls `users.me()` every 20s while visible.
- `api.users.me()` has 10s in-memory dedupe only (`src/lib/api/users.ts`).
- Panels fetch on mount with local `isLoading/error/data` state; no shared query cache.
- Auth token/accounts stored in `sessionStorage` (`src/lib/storage.ts`, `src/lib/accounts.ts`).
- Assistant state server-loaded on mount, debounced save (`src/components/assistant/useAssistantState.ts`).
- Vite already manualChunks vendors and has size budgets (`vite.config.ts`).

## Approaches considered

| Approach | Summary | Tradeoff | Decision |
|---|---|---|---|
| A. Persistent SWR cache | TanStack Query + IndexedDB persister. Hydrate on boot, render immediately, background revalidate. Data points excluded from persistence. | Brief staleness for cached metadata/lists; cache invalidation/versioning work; persistence security handling. | **Picked** |
| B. Local-first DB + sync | Client DB primary, bidirectional sync/conflict resolution. | Large rewrite, backend protocol, conflict semantics, high risk. | Rejected: overbuild for goal |
| C. Prefetch only | Preload chunks/data aggressively. | Cannot guarantee no loading after restart; still network-gated. | Rejected: insufficient |

## Design

### 1. Shared data layer

Add `@tanstack/react-query` and `@tanstack/react-query-persist-client` (or equivalent PersistQueryClient) with IndexedDB persister (`idb-keyval` or small wrapper).

```ts
// src/lib/query/client.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // tune per resource
      gcTime: 7 * 24 * 60 * 60_000,
      refetchOnMount: 'always',   // background refetch, but cached data renders
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 2,
      networkMode: 'online',
    },
  },
});
```

App root wraps with `PersistQueryClientProvider`. Persistence key includes app schema version (`ayphr-query-cache-v1`). On schema mismatch or corrupted cache, clear cache and continue with normal fetch.

### 2. Cache key and ownership model

Centralize query keys in `src/lib/query/keys.ts`. No panel-local ad-hoc cache.

Representative keys:
- `['bootstrap']` - canonical `UserMePayload`: current user, credits, active suspension, policy status.
- `['devices','mine']`, `['device', serial]`, `['deviceDataPoints', serial, params]` (server-only, not persisted)
- `['locations','mine']`, `['location', id, ...]`
- `['assistant','state']`
- `['notifications','unread']`, `['notifications', params]`
- `['credits','me']`, `['teams', ...]`, etc.

Each resource has explicit invalidation rules. Mutations invalidate/update affected keys through query client utilities, not custom events.

### 3. Bootstrap snapshot (first paint path)

Introduce a bootstrap query used by gates and dashboard shell:

- `useBootstrap()` returns cached bootstrap data immediately if present.
- Query fn calls `api.users.me()` (`UserMePayload`) as canonical bootstrap. It includes `user` (with email), `policyStatus`, `activeSuspension`, `credits`.
- `PolicyGate` and `EmailGate` read bootstrap query; they do not independently block on separate initial fetches when cached bootstrap exists. `EmailGate` no longer calls `api.auth.me()` for gate decision.
- `useDashboardUser` becomes a thin selector over bootstrap query or is replaced by `useBootstrap()`.

Behavior:
- **Cache hit:** render dashboard/gate decision immediately; background refetch validates policy/email/suspension/user.
- **Cache miss (first ever visit, cleared storage):** allow normal loading skeleton/fallback. This is the only acceptable blocking load after feature ships.
- **401/invalid token:** clear auth + query cache. If another stored account exists and client switches to it, clear previous account query cache before hydrating switched account. Redirect login only when no fallback account remains.
- **Fallback account switch (401 or manual):** always clear persisted query cache for previous account; never reuse across accounts.

`PolicyGate` session-revocation polling remains, but uses query refetch/invalidation and does not cause visible loading.

### 4. Auth persistence change

Current: token/accounts in `sessionStorage`. Required by product decision: persist across restart.

Changes:
- Move `STORAGE_KEYS.activeToken` and `STORAGE_KEYS.accounts` to persistent storage (localStorage or IndexedDB-backed storage abstraction). Keep `storage.ts` API explicit about area.
- Add migration on startup: if sessionStorage has auth and persistent does not, copy then remove session copy.
- Logout, account removal, expired-token cleanup, and explicit "clear local data" paths must clear:
  - active token/account records
  - TanStack Query persisted cache
  - any sensitive local caches (assistant, notifications, profile-derived data)
- Document shared-device tradeoff in settings/help copy where appropriate (product copy task).

Security note: persisted bearer token has same XSS exposure class as current sessionStorage token, but longer lifetime on device. Mitigate by strict cache clear on logout/401, schema versioning, and avoiding caching secrets beyond auth token already required.

### 5. Route and chunk loading

Goal: no loading after first open includes navigation.

- Keep route-level code splitting, but preload chunks:
  - After first successful dashboard paint, `requestIdleCallback`/timeout preload likely routes/panels (overview, devices, queries, locations, settings, profile).
  - Preload on sidebar hover/focus/touchstart for tab chunks.
  - Add `import()` preload helpers for lazy routes (`AuthPage.preload = () => import(...)` pattern or map).
- `Suspense` fallback for cached routes should be `null` or minimal non-jank placeholder only when chunk not yet loaded; after preload, chunk is warm.
- Optionally convert dashboard tab panels from mount-only lazy to preloaded lazy components once dashboard is idle.

### 6. Panel migration pattern

Migrate panels from local fetch-effect state to query hooks.

Before:
```ts
const [data, setData] = useState(); const [isLoading, setIsLoading] = useState(true);
useEffect(() => { api.x.list().then(setData).finally(() => setIsLoading(false)); }, []);
if (isLoading) return <Skeleton/>;
```

After:
```ts
const q = useDevicesMine(); // useQuery
const data = q.data ?? EMPTY;
if (!data && q.isPending) return null; // first visit only; normally cached
return <DevicesView data={data} refreshing={q.isFetching} />;
```

Rules:
- Cached/prefetched data renders immediately.
- Background refresh indicator is subtle/non-blocking (`isFetching`), not full-page/panel skeleton.
- First-ever uncached non-timeseries load: prefer aggressive prefetch so no loading; if missed, allow lightweight non-blocking placeholder, not full skeleton.
- Timeseries/data points: always server fetch on demand, never persisted stale cache. Show non-blocking loading state in chart/detail area while shell/data chrome remains visible.
- Query hooks live in `src/lib/query/hooks/*` or colocated by domain; panels consume hooks.

### 7. Assistant state

`useAssistantState` currently blocks dashboard and owns server sync. Change it to query-backed:

- `useQuery(['assistant','state'])` hydrates from persisted cache, renders immediately.
- Local edits update query cache immediately (optimistic) and enqueue debounced save mutation.
- Local pending/dirty edits are authoritative until save succeeds. Background refetch/reload must not overwrite unsaved local edits; merge server state carefully or defer apply behind save queue.
- Persist pending-save metadata/version as needed to avoid losing unsaved edits across restart; clear only after confirmed save.
- On save failure, keep local state, surface sync error banner (already exists in dashboard).
- Initial dashboard render must not wait for assistant load; assistant tab can render from cached state/empty state while background fetch runs.

### 8. Mutations and invalidation

Use `useMutation` with optimistic cache updates:

- On mutate: cancel outgoing relevant queries, snapshot previous cache, optimistically update cache.
- On error: rollback snapshot, show existing error UI/toast/banner.
- On settled/success: invalidate affected query keys.

Critical mutations: device create/update/delete, alert changes, location changes, profile edits, credits actions, team/integration changes, notification read, assistant save/delete chat.

### 9. Prefetch/warm strategy

- On login/bootstrap success: prefetch high-value queries (`devices.mine`, `locations.mine`, `notifications.unread`, credits/profile/team/settings metadata as needed).
- On dashboard idle: prefetch common tab queries and lazy chunks for all main tabs.
- On sidebar item hover/focus/touchstart: prefetch that tab chunk + primary query.
- On device row hover/focus: prefetch device detail metadata; do not prefetch/persist full timeseries by default. Data points fetch on demand from server.

Prefetch uses `queryClient.prefetchQuery` with `staleTime` guard to avoid redundant fetches.

### 10. Cache lifecycle / versioning

- Bump cache buster/version when query shapes or key semantics change.
- Clear persisted query cache on logout, auth 401 with no fallback account, any account switch/fallback switch, account removal, and schema version mismatch.
- Scope persisted cache by active account identity (or clear fully on switch) to prevent cross-account data exposure.
- Do not persist timeseries/data-point query results (`deviceDataPoints`, location history). Exclude via persister `shouldDehydrateQuery`/filter.
- Do not persist highly volatile or huge ephemeral payloads by default.
- Set max-age / garbage collection; keep bootstrap + list/metadata queries.

## File-level change map (planned)

- `package.json` - add TanStack Query + persist dependencies.
- `src/main.tsx` - wrap app with query/persist providers.
- `src/lib/query/*` - query client, persister, keys, hooks, cache clear helpers.
- `src/lib/storage.ts`, `src/lib/accounts.ts`, `src/lib/api/client.ts` - persistent auth migration and cache-clear integration.
- `src/App.tsx` - route preload helpers, suspense fallback policy.
- `src/pages/dashboard/useDashboardUser.ts` - bootstrap query-backed.
- `src/pages/dashboard/DashboardPage.tsx` - remove blocking on assistant/user cache miss where cached; use query hooks.
- `src/components/policy/PolicyGate.tsx`, `src/components/auth/EmailGate.tsx` - query-backed bootstrap, no redundant blocking fetch on cache hit.
- `src/components/assistant/useAssistantState.ts` - query-backed state.
- `src/components/overview/OverviewPanel.tsx` and other panels - migrate to query hooks.
- Tests for cache hydration, invalidation, logout clearing, migration.

## Testing

- Unit: query key helpers, cache clear on logout/401/account switch, storage migration session->persistent.
- Unit: bootstrap hook renders cached data immediately and triggers background refetch.
- Unit: persister excludes `deviceDataPoints`/timeseries keys; no persisted stale data points.
- Integration: dashboard renders from persisted cache without loading skeleton when cache present.
- Integration: mutation optimistic update + rollback on server error.
- Integration: account switch/401 fallback clears previous account cache and loads/switches correctly.
- Integration: assistant dirty local edits survive refetch/reload and are not overwritten before save.
- Regression: first-ever visit still shows acceptable loading fallback; data-point charts show non-blocking fetch state.
- Build: `npm run build`, `npm run lint`, `npm test`, `npm run test:typecheck`.

## Risks

- **Stale data confusion:** mitigated by background refetch + subtle "updating" indicator where useful.
- **Sensitive data persistence:** mitigated by aggressive clear-on-logout/401/switch and schema versioning.
- **Cache invalidation bugs:** mitigated by centralized keys and mutation invalidation tests.
- **Bundle size:** TanStack Query adds dependency; monitor Vite size budgets.
- **Large IndexedDB cache:** timeseries excluded from persistence; gcTime and selective persistence.
- **Assistant edit loss/resurrection:** mitigated by dirty-state authority, careful merge, and tests.

## Out of scope follow-up

- Service worker data precache/runtime API caching.
- Backend bootstrap aggregation endpoint.
- Real offline mutation queue/conflict resolution.