/**
 * Compact, model-facing reference for the TQL dialect used by Ayphr queries.
 * Kept beside the parser so query-authoring prompts and editor docs can share
 * one source of truth.
 */
export const TQL_REFERENCE = `TQL is a small query language for Ayphr telemetry points. It is NOT SQL.

SHAPE
  <root>(<lambda> -> { <condition> }) [then <step>(...) ...]
  A lambda is usually named p. Every field reference inside a condition, field selector, or compute expression MUST start with the lambda name and a dot, e.g. p.temperature. Bare fields like temperature are invalid.
  Condition blocks are braces: { p.temperature > 20 }. Combine separate blocks with & (AND), | (OR), or ! (NOT), for example: findAll(p -> { p.temperature > 20 } & { p.humidity < 60 }).

ROOTS
  findAll(p -> { cond })   all matching points
  findFirst(p -> { cond }) first matching point, or null
  findLast(p -> { cond })  last matching point, or null
  count(p -> { cond })     number of matching points
  exists(p -> { cond })    true when at least one point matches
  select(p -> { cond })    alias of findAll
  Any root may omit the lambda to take all points: findAll(), findFirst(), findLast(), count(), exists(), select().

CONDITIONS
  Comparisons: ==, !=, >, >=, <, <=
  Logic: & and | between condition blocks, not / ! before a condition block, parentheses around condition blocks. The word "and" is only used inside between.
  Membership: p.device in ["Lab", "Garage"], p.serial not in [12, 13]
  Ranges: p.temperature between 18 and 25
  Null / presence: p.humidity is null, p.humidity is not null, p.humidity exists, p.humidity is missing
  Strings: p.device contains "Lab", p.device startsWith "Lab", p.device endsWith "Garage", p.device =~ "^Lab"
  Tolerance: p.temperature ~1~= 21 (absolute), p.temperature ~10%~= 21 (percent)

FIELDS AVAILABLE ON EACH POINT
  p.timestamp     Date in query results; use <, <=, >, >=, or between for time comparisons
  p.temperature   number   degrees Celsius
  p.humidity      number   relative percent
  p.airPressure   number   hectopascals (hPa)
  p.serial        number   device serial
  p.device        string   device display name
Reference only these source fields; endpoint points are flat, so do not use nested paths. Derived fields are allowed only after a step such as compute, rename, movingAverage, rate, diff, or window introduces them.

PIPELINE STEPS (chain with "then")
  sortAscending(p -> { p.field }?)      defaults to timestamp
  sortDescending(p -> { p.field }?)     defaults to timestamp
  limit(n), offset(n), skip(n), slice(start, end?), head(n), tail(n)
  timeRange(start, end)                 quoted dates or epoch ms
  select(p -> { p.field }, ...) / project(...)
  omit(p -> { p.field }, ...)
  rename(p -> { p.from }, p -> { p.to })
  filter(p -> { p.condition })          example: findAll() then filter(p -> { p.temperature > 20 })
  distinct(p -> { p.field }?) / dedup(...)
  dropNulls(p -> { p.field }, ...)
  fill(p -> { p.field }, value)
  fillPrevious(p -> { p.field })
  clamp(p -> { p.field }, min, max)
  compute(p -> { p.targetField }, expression)  supports + - * / % and lambda-prefixed field refs
  avg(p -> { p.field }), min(...), max(...), sum(...), median(...), stddev(...)
  count()                               count rows in the pipeline
  movingAverage(p -> { p.field }, windowSize, p -> { p.targetField }?)
  rate(p -> { p.field }, p -> { p.targetField }?)
  diff(p -> { p.field }, p -> { p.targetField }?)
  window('duration', 'avg', p -> { p.field })   durations like '15m', '1h', '1d'
  resample(...)                         alias of window
  summary(p -> { p.field }, ...)
  groupBy(p -> { p.field })

ADVANCED STEPS REQUIRE BOOST MODE
  distinct / dedup, movingAverage, window / resample, summary, groupBy. Use them when the request genuinely needs them; the UI will offer to switch to Boost.

EXAMPLES
  findAll(p -> { p.temperature > 25 })
  findAll(p -> { p.temperature > 25 } & { p.humidity is not null }) then sortDescending(p -> { p.timestamp }) then limit(10)
  findAll(p -> ({ p.temperature > 30 } | { p.airPressure < 990 })) then sortDescending(p -> { p.timestamp }) then limit(20)
  count(p -> { p.airPressure between 980 and 1030 })
  findAll() then window('1h', 'avg', p -> { p.temperature }) then sortAscending(p -> { p.timestamp })
  findLast(p -> { p.device == "Greenhouse" }) then select(p -> { p.timestamp }, p -> { p.temperature })
  findAll() then compute(p -> { p.dewPoint }, p.temperature - 2) then sortDescending(p -> { p.dewPoint }) then limit(10)

RULES
  - Use only the fields and operations listed above.
  - Do not write SQL, comments, or explanatory text inside the query.
  - Do not add a timeRange step; the selected dashboard range is already applied outside the query.
  - Prefer the simplest query that answers the request; add sorting and limits when the user asks for "latest", "hottest", "top", or "first".
  - The selected devices are already applied outside the query. Add a device or serial condition only when the request names one device within the selection.`;
