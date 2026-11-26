# No-Loading Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After first successful open, render Ayphr dashboard from persisted cache immediately and sync in background, with no blocking loading UI on normal navigation.

**Architecture:** Add TanStack Query as the shared stale-while-revalidate cache with IndexedDB persistence, migrate auth/session persistence to survive restart, and make `users.me()` bootstrap the canonical cached source for gates/dashboard. Migrate panels/assistant to query hooks; preload route chunks and primary queries; exclude timeseries data points from persistence and always fetch them from server.

**Tech Stack:** React 19, TypeScript, Vite 8, React Router 7, TanStack Query v5 (`@tanstack/react-query`, `@tanstack/react-query-persist-client`), IndexedDB persister (`idb-keyval` or `@tanstack/query-async-storage-persister`), Bun test (node env).

**Spec:** `docs/superpowers/specs/2026-11-27-no-loading-architecture-design.md`

## Global Constraints

- Approach A only: persistent stale-while-revalidate cache. No local-first bidirectional sync engine.
- After first successful bootstrap, no blocking loading UI on restart/navigation for cached/prefetched data.
- Data points/timeseries (`deviceDataPoints`, location history) always fetched from server; never persisted as stale cache; non-blocking fetch UI allowed.
- Persist auth/accounts across browser restart; migration from sessionStorage required.
- Any account switch/fallback switch/401-no-fallback/logout/removal clears previous sensitive query cache.
- `api.users.me()` (`UserMePayload`) is canonical bootstrap for PolicyGate, EmailGate, dashboard user state.
- No DOM test dependency; tests run under Bun node env (`bunfig.toml`). Prefer pure helper tests.
- Keep Vite size budgets passing (`vite.config.ts`).

## Review Focus

- **Account switch leaks cache:** after 401 fallback or manual switch, previous account devices/assistant/notifications must not render. Expect empty/new-account cache boundary before new fetch.
- **Data points stale/persisted:** persisted cache restore must not include timeseries query results; charts fetch server data and show non-blocking loading.
- **Assistant unsaved edits lost:** local dirty assistant edits pending save must survive background refetch/reload/restart and never be overwritten by older server state.
- **Bootstrap gate deadlock:** cache hit must render dashboard immediately; gates must not block on fresh network when cached bootstrap is valid enough to decide.
- **First visit/regression:** cleared storage/first-ever visit still shows acceptable loading fallback, no blank/crash.

---

## File Structure

### New files
- `src/lib/query/client.ts` — create `QueryClient`, default query/mutation options, cache version.
- `src/lib/query/persist.ts` — IndexedDB persister, hydrate/dehydrate filter (exclude timeseries), clear helpers.
- `src/lib/query/keys.ts` — centralized query keys/factories.
- `src/lib/query/bootstrap.ts` — bootstrap query options/hook using `api.users.me()`.
- `src/lib/query/prefetch.ts` — route chunk + query prefetch helpers.
- `src/lib/query/cacheLifecycle.ts` — clear-on-logout/switch/401/schema mismatch helpers.
- `src/lib/query/hooks/*.ts` — domain hooks (`useDevicesMine`, `useLocationsMine`, `useAssistantStateQuery`, etc.).
- `src/lib/query/*.test.ts` — pure tests for keys, persist filter, cache lifecycle, storage migration helpers.

### Modified files
- `package.json`, `package-lock.json` — add TanStack Query/persist/idb deps.
- `src/main.tsx` — wrap with `PersistQueryClientProvider`.
- `src/lib/storage.ts` — support persistent auth keys/migration helpers.
- `src/lib/accounts.ts` — move token/accounts to persistent storage, migration from session.
- `src/lib/api/client.ts` — on 401/switch call cache lifecycle clear hook; avoid leaking previous account cache.
- `src/lib/api/users.ts` — keep/integrate with query cache invalidation; `invalidateMe` clears bootstrap query.
- `src/lib/api/index.ts` — expose cache clear integration point if needed.
- `src/App.tsx` — route preload map, suspense fallback policy.
- `src/pages/dashboard/useDashboardUser.ts` — selector over bootstrap query.
- `src/pages/dashboard/DashboardPage.tsx` — non-blocking render from cache, prefetch, assistant not blocking shell.
- `src/components/policy/PolicyGate.tsx`, `src/components/auth/EmailGate.tsx` — read bootstrap query, cache-hit instant pass, background refetch.
- `src/components/assistant/useAssistantState.ts` — query-backed state with dirty local authority.
- `src/components/overview/OverviewPanel.tsx` and dashboard panels — query hooks, non-blocking refresh, timeseries server-only.
- `vite.config.ts` — only if chunk/preload/manualChunks need adjustment for budgets.

## Task 1: Dependencies and Query Infrastructure

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/query/client.ts`
- Create: `src/lib/query/keys.ts`
- Create: `src/lib/query/persist.ts`
- Create: `src/lib/query/cacheLifecycle.ts`
- Test: `src/lib/query/keys.test.ts`
- Test: `src/lib/query/persist.test.ts`

**Interfaces:**
- Produces: `createAppQueryClient(): QueryClient`
- Produces: `queryKeys` factories with stable key shapes, including `queryKeys.bootstrap()`, `queryKeys.devicesMine()`, `queryKeys.deviceDataPoints(serial, params)`, `queryKeys.assistantState()`
- Produces: `shouldPersistQuery(query): boolean` excluding timeseries/data-point keys
- Produces: `clearPersistedQueryCache(): Promise<void>` and `clearAccountQueryCache(queryClient): Promise<void>`

- [ ] **Step 1: Write failing tests for key stability and persist filter**

```ts
import { describe, expect, test } from 'bun:test';
import { queryKeys } from './keys';
import { shouldPersistQueryKey } from './persist';

test('bootstrap key is stable', () => {
  expect(queryKeys.bootstrap()).toEqual(['bootstrap']);
});

test('device data points key is excluded from persistence', () => {
  expect(shouldPersistQueryKey(queryKeys.deviceDataPoints(12, { period: '24h' }))).toBe(false);
  expect(shouldPersistQueryKey(queryKeys.devicesMine())).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test src/lib/query/keys.test.ts src/lib/query/persist.test.ts`
Expected: FAIL with module not found / missing exports.

- [ ] **Step 3: Add dependencies**

Add: `@tanstack/react-query`, `@tanstack/react-query-persist-client`, `@tanstack/query-sync-storage-persister` or `idb-keyval`-backed async persister package chosen for small footprint. Run `npm install`.

- [ ] **Step 4: Implement query client/keys/persist helpers**

`client.ts`: export `CACHE_BUSTER = 'v1'`, default options from spec (`staleTime` conservative default, `gcTime` 7d, `refetchOnMount: 'always'`, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`).
`persist.ts`: export `shouldPersistQueryKey(queryKey)` returning false for keys whose root/shape is timeseries (`deviceDataPoints`, location history/data points). Export persister factory and clear function.
`cacheLifecycle.ts`: export `clearSensitiveQueryState(queryClient, persister)` used by logout/switch/401 fallback.

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test src/lib/query/keys.test.ts src/lib/query/persist.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/query/client.ts src/lib/query/keys.ts src/lib/query/persist.ts src/lib/query/cacheLifecycle.ts src/lib/query/keys.test.ts src/lib/query/persist.test.ts
git commit -m "feat(query): add TanStack Query cache infrastructure"
```

## Task 2: Persistent Auth Storage Migration

**Files:**
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/accounts.ts`
- Modify: `src/lib/api/client.ts`
- Test: `src/lib/accounts.test.ts`

**Interfaces:**
- Produces: auth token/accounts persisted in `localStorage` (or persistent abstraction) with one-time migration from `sessionStorage`.
- Produces: `clearStoredAuth()`/existing account helpers preserve behavior, expiry checks unchanged.
- Consumes: Task 1 cache clear helper via injected callback or module boundary; avoid circular deps by keeping cache clear in query layer and calling from app/auth integration point.

- [ ] **Step 1: Write failing migration/behavior tests**

```ts
import { describe, expect, test } from 'bun:test';
import { migrateSessionAuthToPersistent, getStoredAccounts } from './accounts';
// Use in-memory storage shim if needed; keep node env compatible.

test('migrates session auth to persistent and removes session copy', () => { /* ... */ });
test('expired accounts filtered', () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/accounts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement storage migration**

In `storage.ts`, add explicit helpers for persistent auth keys or change `ACCOUNTS_KEY`/active token area to `local`. Add `migrateAuthStorage()` called early (`main.tsx` or accounts module init) that copies session auth keys to persistent only when persistent missing, then removes session keys.
In `accounts.ts`, read/write persistent storage; preserve account shape and expiry normalization.
In `client.ts`, keep 401 account-switch behavior but expose hook/callback for cache clear: e.g. `config.onAccountSwitch?.(previousToken, nextToken)` or `config.onAuthCleared?.()` invoked before setting next active token.

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/lib/accounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/lib/accounts.ts src/lib/api/client.ts src/lib/accounts.test.ts
git commit -m "feat(auth): persist accounts across browser restart"
```

## Task 3: App Provider, Cache Lifecycle Wiring, Route Preload

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/api/index.ts`
- Create: `src/lib/query/prefetch.ts`
- Create: `src/lib/routes/preload.ts` (optional if small; may live in `App.tsx`)
- Test: `src/lib/query/cacheLifecycle.test.ts`

**Interfaces:**
- Produces: app wrapped in `PersistQueryClientProvider` with configured persister.
- Produces: `preloadDashboardRoute(tab)` / `preloadMainRoutes()` helpers.
- Produces: cache cleared on logout/401-no-fallback/account switch through wired callbacks.

- [ ] **Step 1: Write failing cache lifecycle tests**

```ts
import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { clearAccountQueryCache } from './cacheLifecycle';

test('clearAccountQueryCache removes cached queries', async () => {
  const qc = new QueryClient();
  qc.setQueryData(['bootstrap'], { user: { uuid: 'a' } });
  await clearAccountQueryCache(qc);
  expect(qc.getQueryData(['bootstrap'])).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/lib/query/cacheLifecycle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire provider and lifecycle**

`main.tsx`: create query client/persister once; run auth migration before render; wrap `<App />` in `PersistQueryClientProvider`.
`api/index.ts`: pass `onUnauthorized` and optional account-switch callback that calls query cache clear helpers. Ensure 401 fallback switch clears previous account cache before activating next.
`App.tsx`: add route preload map for lazy imports; preload dashboard/auth/landing chunks on idle; keep `RouteFallback` but avoid blocking skeleton where cache already renders inside dashboard.

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/lib/query/cacheLifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx src/App.tsx src/lib/api/index.ts src/lib/query/prefetch.ts src/lib/query/cacheLifecycle.test.ts
git commit -m "feat(app): wire query persistence and route preloading"
```

## Task 4: Bootstrap Query and Gates

**Files:**
- Create: `src/lib/query/bootstrap.ts`
- Modify: `src/lib/api/users.ts`
- Modify: `src/pages/dashboard/useDashboardUser.ts`
- Modify: `src/components/policy/PolicyGate.tsx`
- Modify: `src/components/auth/EmailGate.tsx`
- Test: `src/lib/query/bootstrap.test.ts`

**Interfaces:**
- Produces: `bootstrapQueryOptions()` / `useBootstrapQuery()` using `api.users.me()`, key `queryKeys.bootstrap()`.
- Produces: `useDashboardUser()` reads bootstrap query; no duplicate blocking fetch when cache present.
- Consumes: `PolicyGate` and `EmailGate` render from cached bootstrap when available; background refetch via `queryClient.invalidateQueries`/refetch.

- [ ] **Step 1: Write failing bootstrap behavior tests**

```ts
import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './keys';

test('bootstrap cache hit is available synchronously', () => {
  const qc = new QueryClient();
  qc.setQueryData(queryKeys.bootstrap(), { user: { email: 'a@b.com' }, policyStatus: { upToDate: true }, activeSuspension: null, credits: {} });
  expect(qc.getQueryData(queryKeys.bootstrap())).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/lib/query/bootstrap.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement bootstrap query and gate migration**

`bootstrap.ts`: queryFn `api.users.me()`, sensible staleTime; export helper for invalidation.
`users.ts`: `invalidateMe()` also invalidates bootstrap query through shared query client hook/integration; avoid tight coupling by optional setter `setUsersMeInvalidator`.
`useDashboardUser.ts`: use `useQuery(bootstrapQueryOptions())`; map to existing returned shape; `isLoading` true only when no cached data and query pending.
`PolicyGate.tsx`: read bootstrap query. If cached data exists, evaluate policy immediately (render children or required card) and refetch in background. Keep retry/401 handling. Remove separate mount fetch path when query cache present.
`EmailGate.tsx`: same pattern using `bootstrap.user.email`; remove `api.auth.me()` dependency for gate.

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/lib/query/bootstrap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/query/bootstrap.ts src/lib/api/users.ts src/pages/dashboard/useDashboardUser.ts src/components/policy/PolicyGate.tsx src/components/auth/EmailGate.tsx src/lib/query/bootstrap.test.ts
git commit -m "feat(bootstrap): render gates from cached user bootstrap"
```

## Task 5: Dashboard Shell Non-Blocking Render

**Files:**
- Modify: `src/pages/dashboard/DashboardPage.tsx`
- Modify: `src/pages/dashboard/DashboardLoadingSkeleton.tsx`
- Modify: `src/App.tsx`
- Test: `src/lib/query/prefetch.test.ts`

**Interfaces:**
- Produces: dashboard renders shell/content from cached bootstrap/assistant state without blocking on assistant load.
- Produces: prefetch hooks for tab chunk + primary query on idle/hover/focus.
- Consumes: Task 4 bootstrap, Task 6 assistant query.

- [ ] **Step 1: Write failing prefetch helper tests**

```ts
import { describe, expect, test } from 'bun:test';
import { shouldPrefetch } from './prefetch';

test('does not prefetch timeseries by default', () => {
  expect(shouldPrefetch('deviceDataPoints')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/lib/query/prefetch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement dashboard non-blocking behavior**

In `DashboardPage.tsx`, remove `assistant.isLoading` from hard blocking gate; allow render with cached bootstrap and cached/empty assistant state. Keep skeleton only when no bootstrap cache and loading first visit.
Add idle prefetch: main tab chunks and primary list queries. Add sidebar hover/focus prefetch.
Ensure `RouteFallback` for dashboard path uses skeleton only before first bootstrap cache; after cache, avoid full-screen loading where possible.

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/lib/query/prefetch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/dashboard/DashboardPage.tsx src/pages/dashboard/DashboardLoadingSkeleton.tsx src/App.tsx src/lib/query/prefetch.ts src/lib/query/prefetch.test.ts
git commit -m "feat(dashboard): make shell render from cache and prefetch tabs"
```

## Task 6: Assistant Query with Dirty-Edit Authority

**Files:**
- Modify: `src/components/assistant/useAssistantState.ts`
- Create/Modify: `src/lib/query/hooks/useAssistantState.ts` (if extracted)
- Modify: `src/pages/dashboard/DashboardPage.tsx`
- Test: `src/lib/query/assistantMerge.test.ts`

**Interfaces:**
- Produces: assistant state available from query cache immediately.
- Produces: `mergeAssistantServerState(local, server, dirtyMeta)` or equivalent pure rule where local dirty/pending edits win.
- Consumes: `api.assistant.getState/saveState/deleteChat`.

- [ ] **Step 1: Write failing merge tests**

```ts
import { describe, expect, test } from 'bun:test';
import { mergeAssistantState } from './assistantMerge';

test('local dirty chat wins over stale server refetch', () => {
  const local = { chats: [{ id: 'c1', title: 'Draft', updatedAt: 2 }], dirtyChatIds: ['c1'] };
  const server = { chats: [{ id: 'c1', title: 'Old', updatedAt: 1 }] };
  expect(mergeAssistantState(local, server).chats[0].title).toBe('Draft');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/lib/query/assistantMerge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement query-backed assistant state**

Use query cache as source. On local update, set query data immediately and mark dirty/pending metadata. Debounced save mutation sends persistable state. Background refetch applies merge that never overwrites dirty chats/folders/preferences pending save. Persist dirty metadata if needed in storage key separate from server payload; clear after confirmed save.
Ensure dashboard no longer waits for assistant initial load.

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/lib/query/assistantMerge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/assistant/useAssistantState.ts src/lib/query/hooks/useAssistantState.ts src/lib/query/assistantMerge.test.ts src/pages/dashboard/DashboardPage.tsx
git commit -m "feat(assistant): query-backed state with dirty edit authority"
```

## Task 7: Migrate Core Panels to Query Hooks

**Files:**
- Create: `src/lib/query/hooks/useDevices.ts`
- Create: `src/lib/query/hooks/useLocations.ts`
- Create: `src/lib/query/hooks/useNotifications.ts`
- Create: `src/lib/query/hooks/useCredits.ts`
- Create: `src/lib/query/hooks/useTeams.ts`
- Modify: `src/components/overview/OverviewPanel.tsx`
- Modify: `src/components/devices/DevicesPanel.tsx`
- Modify: `src/components/locations/LocationsPanel.tsx`
- Modify: `src/components/notifications/NotificationsPanel.tsx`
- Modify: `src/components/credits/CreditsPanel.tsx`
- Modify: `src/components/team/TeamPanel.tsx`
- Test: `src/lib/query/persist.test.ts` (extend)

**Interfaces:**
- Produces: domain query hooks with centralized keys.
- Consumes: `api.devices/locations/notifications/credits/teams` methods.
- Produces: panels render cached data immediately; background `isFetching` indicator only.

- [ ] **Step 1: Extend persist tests for excluded keys**

Add cases for `deviceDataPoints`, location history keys excluded; list keys included.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/lib/query/persist.test.ts`
Expected: FAIL for new cases/exports.

- [ ] **Step 3: Implement hooks and migrate panels**

For each panel, replace mount `useEffect + isLoading` with query hook. Keep existing UI; when cached data exists, do not render full skeleton. Mutations use `useMutation` + optimistic cache update/invalidation.
Timeseries hooks use `useQuery` with `meta: { persist: false }` or excluded key; do not add to persisted cache. Chart area shows non-blocking loading state.

- [ ] **Step 4: Run targeted tests**

Run: `bun test src/lib/query/persist.test.ts src/lib/query/keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/query/hooks src/components/overview/OverviewPanel.tsx src/components/devices/DevicesPanel.tsx src/components/locations/LocationsPanel.tsx src/components/notifications/NotificationsPanel.tsx src/components/credits/CreditsPanel.tsx src/components/team/TeamPanel.tsx src/lib/query/persist.test.ts
git commit -m "feat(panels): migrate core dashboard panels to query cache"
```

## Task 8: Migrate Remaining Panels and Mutations

**Files:**
- Modify: `src/components/queries/QueriesPanel.tsx`
- Modify: `src/components/integrations/IntegrationsPanel.tsx`
- Modify: `src/components/staff/UsersPanel.tsx`
- Modify: `src/components/games/GamesPanel.tsx` (if fetches)
- Modify: `src/components/radio/RadioPanel.tsx` (if fetches)
- Modify: `src/components/settings/*` and related API hooks
- Modify: any panel with mutations to invalidate/update query keys

**Interfaces:**
- Produces: all dashboard data sources use query cache or explicit non-persisted server fetch.
- Produces: mutation invalidation map in query layer.

- [ ] **Step 1: Add/extend tests for mutation invalidation helpers**

Create `src/lib/query/invalidation.test.ts` for pure key invalidation mapping.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/lib/query/invalidation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement remaining migrations**

Apply same pattern. Ensure no panel introduces local ad-hoc cache. Keep non-blocking fetch UI for uncached first view.

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/lib/query/invalidation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components src/lib/query/invalidation.test.ts src/lib/query
git commit -m "feat(panels): migrate remaining panels and mutation invalidation"
```

## Task 9: Verification, Budgets, and Docs

**Files:**
- Modify: `README.md` (brief note on client cache/persistence behavior, if appropriate)
- Modify: `docs/superpowers/specs/2026-11-27-no-loading-architecture-design.md` only if implementation reveals required spec correction
- Test: all touched tests

**Interfaces:**
- Produces: passing build/lint/tests/typecheck.

- [ ] **Step 1: Run focused tests**

Run: `bun test src/lib/query src/lib/accounts.test.ts`
Expected: PASS.

- [ ] **Step 2: Run project checks**

Run: `npm run lint`
Expected: PASS.

Run: `npm run test:typecheck`
Expected: PASS.

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: PASS; no Vite size budget errors.

- [ ] **Step 3: Manual smoke checklist (document in PR/notes)**

- First load: normal load acceptable.
- Reload/restart browser: dashboard appears from cache, no blocking skeleton.
- Tab switch: no loading skeleton for cached tabs.
- Device/location charts: data points fetched from server, non-blocking chart loading.
- Logout/switch account: no previous account data flashes.
- Assistant edit during refetch: unsaved edit preserved.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: verify no-loading cache architecture"
```
