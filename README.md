# TimeDebt

A single-user work timer that tracks hours against a fixed daily target and keeps a running
**time debt** balance. No accounts, no server, no network calls: the interval log lives in
IndexedDB on one device, and export is the backup.

Two numbers, side by side, legible from across a room: **hours worked today** and **hours owed**.

---

## The rules

All of this lives in [`src/ledger.ts`](src/ledger.ts) as pure functions with `now` injected, and
every rule below is covered by [`src/ledger.test.ts`](src/ledger.test.ts).

### Days are KST

Every day boundary is **Asia/Seoul (fixed UTC+9, no DST)**. Timestamps are stored as epoch
milliseconds in UTC; a day runs KST-midnight to KST-midnight. The day key flips at **15:00 UTC**,
so work logged at 00:30 KST belongs to the new day, not the old one. Start hour is irrelevant —
only the calendar day the time falls in matters.

### Daily target

| Day | Target |
| --- | --- |
| Monday–Friday | 28,800 s (8 h) |
| Saturday, Sunday | 0 s |

### Productive is all-or-nothing

A weekday counts as productive only if tracked time is **≥ 8 h**. 7 h 59 m 59 s is not productive.
There is no partial credit toward the flag — partial hours still move the balance, but they never
half-satisfy the day.

### Debt is a net balance, not a tally of failures

For each **finalized** day (any KST date strictly before today):

```
delta   = target − tracked
balance = Σ delta            (positive = debt, negative = banked credit)
```

A short weekday adds debt. A long weekday pays it down. A weekend has a target of 0, so every
tracked weekend second pays debt down.

> Worked example: 5 h on Thursday leaves 3 h of debt. 10 h on Friday reduces it to 1 h.

### The credit cap

Credit is capped at **57,600 s (16 h)** — `maxCreditSeconds` in [`src/config.ts`](src/config.ts) —
so one heroic weekend cannot buy a slack week. Debt is not capped.

**Stated choice:** the spec does not say whether the cap applies to each day's running balance or
only to the final sum. It is applied **after every finalized day**, because that is what makes the
cap mean anything: bank 24 h over a weekend and the balance is −16 h on Monday morning, so the
first missed weekday brings you to −8 h, not −16 h. Clamping only at the end would let the
discarded excess quietly survive.

### Today does not accrue debt until it ends

At 09:00 on a workday with nothing tracked, the displayed debt is whatever was carried in — not
carried-in plus 8 h. Today's shortfall lands on the balance only once KST midnight passes.

### Today's hours pay old debt only after today's own target is met

```
surplus         = max(0, todayTracked − todayTarget)
displayedDebt   = max(0, carriedBalance − surplus)
```

You cannot pay old debt with hours you still owe to today. On a weekend the target is 0, so all
tracked time is surplus and debt falls from the first second.

**Stated choice:** that formula defines debt only. Credit is its mirror — the displayed balance is
`clampCredit(carriedBalance − surplus)`, and the right-hand hero shows `max(0, balance)` as debt or
`max(0, −balance)` as banked credit. A negative-signed debt figure is never rendered; the panel
relabels itself instead.

### Streaks

Consecutive required days that met their target, walking backwards. Weekends are skipped and do not
break a run. Today is skipped while still in progress, so an unfinished morning does not read as a
broken streak — but a today that has already crossed 8 h counts.

### Cleanup before counting

The raw log is normalized on every read, in this order:

1. Open intervals are closed against `now`.
2. Intervals ending before they start are discarded.
3. Ends in the future are clamped to `now` (a start in the future is not counted yet).
4. Anything longer than **12 h** is truncated to 12 h and flagged as an abandoned session.
5. Intervals are sorted and overlaps merged, so no second is ever counted twice.

Everything the app displays is derived from that. There is no cached "hours today" counter to
drift, and no stored daily summary — editing a past interval recomputes every balance after it,
because there is nothing else it could do.

Adjustments are surfaced in a banner rather than applied silently.

---

## Data model

```ts
interface Interval {
  id: string;          // UUID, generated client-side
  start: number;       // epoch ms, UTC
  end: number | null;  // epoch ms, UTC; null means running
  heartbeatAt: number; // epoch ms, refreshed every 30 s while running
  note?: string;
}
```

A flat, append-only list. Pausing closes the current interval; resuming opens a new one. At most one
interval is open at a time.

## Timer behaviour

`idle → running → paused → running → idle`.

Elapsed time is always `now − start`, summed across intervals. The 1-second interval callback exists
only to trigger a repaint — it is never the source of truth. Background tabs get throttled to about
one tick a minute or suspended outright, so a counter incremented by that callback would lose hours;
recomputing from timestamps cannot. `visibilitychange`, `focus` and `pageshow` all just move `now`
forward and re-derive.

While running, `heartbeatAt` is written every 30 s. On load, an open interval whose heartbeat is
more than 2 minutes old means the app died rather than paused: the interval is closed at its last
heartbeat — the gap is *not* silently counted — and a prompt offers **Count it**, **Edit**, or
**Discard**. A session that died before its first heartbeat is dropped outright.

## Interface

- **Today** — the split display, a progress rail of eight ruled cells (one per hour owed), day
  status, and start / pause / stop. Nothing else.
- **Week** — Monday to Sunday: hours, target, met, delta, and the running balance after each day.
  Stated choice: the spec asked for five days, but the weekend is shown too, since weekend hours
  move the balance and hiding them would make the running balance look wrong.
- **Entries** — add, edit and delete intervals (times entered and displayed in KST regardless of
  the browser's timezone), plus **Export JSON**, **Export CSV**, and **Restore JSON**. Import is not
  in the spec, but an export that cannot be restored is not a backup; it validates strictly and
  refuses malformed files rather than coercing them.

### Visual direction

A **double-entry ledger book read in low light**. Ink-blue-black ground rather than pure black,
hairline rules like a ruled page, and a vertical spine splitting the two hero columns the way debit
and credit face each other across a ledger spread. Exactly two semantic colours, from the accounting
idiom of being *in the red* or *in the black* — and both are always paired with a word, so nothing
depends on colour vision.

Type is deliberately **system-only**: a webfont means a network fetch, and this has to work offline.
Numerals are set in the system monospace (accounting-machine lineage, inherently tabular, slashed
zero) with `font-variant-numeric: tabular-nums slashed-zero`, so digits never shift width as they
tick. The chrome is the system sans. The hero is sized in container-query units rather than viewport
units, so the numerals cannot overflow their column whatever monospace the OS supplies.

Dark only, on purpose: this is a second-monitor app that runs all day.

Responsive to mobile, visible keyboard focus, and `prefers-reduced-motion` respected — under it the
running-indicator pulse holds steady and transitions are cut. The clock itself keeps updating; it is
data, not decoration.

---

## Running it

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm test` | Vitest, one pass |
| `npm run test:watch` | Vitest, watching |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the built `dist/` |
| `node scripts/make-icons.mjs` | Regenerate the PWA raster icons |

The service worker is only registered against a real build — use `npm run build && npm run preview`
to exercise offline behaviour, not the dev server.

## Deploying

Pushes to `main` run [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): typecheck →
lint → test → build → deploy to GitHub Pages. Pull requests run everything except the deploy.

One-time setup: in the repository, **Settings → Pages → Build and deployment → Source: GitHub
Actions**.

The build uses `base: './'`, so the same output works at a project subpath
(`https://<user>.github.io/<repo>/`) or at a domain root without reconfiguration.

## Offline

A hand-written service worker ([`public/sw.js`](public/sw.js)) precaches the shell and
runtime-caches the hashed build assets. Navigations are network-first with a cached-shell fallback,
so a new deploy is picked up promptly and the app still opens with the radio off. Combined with the
manifest, it installs as a PWA.

## Not in this phase

Accounts, multi-device sync, a server, sharing, categories or projects, integrations, analytics.

## Notes on the spec

Two places where section 2 was silent rather than wrong, both resolved above and both tested: how
the credit cap composes across days, and what the "displayed debt" formula means when the carried
balance is already negative. Nothing in the rules turned out to be self-contradictory.
