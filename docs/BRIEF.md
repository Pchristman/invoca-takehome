# Brief

I'm building a small product for a take-home exercise, and you're helping me design and build it. This file is the context: the problem, the rules, what I learned from the people who set it, and what I found in the data. Read all of it before you propose anything.

## The problem

> "A customer's marketing team has limited visibility into inbound call performance. Build a working product that helps them track it."

The reviewers put the bar plainly: "A thin, working slice for a real user beats a broad, generic dashboard." Optimize for that.

## Hard rules

- I have 2 to 3 days, with some extra time over the weekend. Scope for that.
- The AI budget is a $250 hard cap on one Claude API key, and it covers both building and running. How we spend it is part of the evaluation. Use the cheapest model that does the job.
- Every AI call gets logged: model, purpose, cost. The total goes in my decision summary.
- The core views must work with no model at all. AI is an add-on, never a dependency.
- It runs locally with one documented command. No paid services other than Claude.
- Use only the mock CSVs in this repo. Extending them is allowed.
- I need a README with setup steps, tests on the core data logic, and basic error handling.
- Don't build: production auth, multi-tenancy, cloud deployment, a polished UI, or scale.
- Never commit API keys or other secrets.

## What I have to hand in

1. This repo, public, runnable from the README
2. A decision summary (product-focused): who it's for, what I learned, the scope and why, trade-offs, next steps, total AI spend
3. A technical deep dive (1 to 2 pages, TECHNICAL.md): architecture and key decisions with the alternatives I rejected; data model and flow, including freshness and messy data; trade-offs, shortcuts and what I'd do with more time; failure modes, edge cases and how I tested; performance and scaling at a high level; which AI tools and models I used, how I checked their output, and how I managed cost
4. An architecture diagram

## How it will be judged

- Product judgment: who I built for, what I scoped, and why
- Engineering judgment: architecture, data handling, code quality, trade-offs
- AI use and cost
- Bonus: AI features inside the product

The review is 60 minutes with an engineer and a product manager: a product walkthrough, how I went from the handoff to the build, a code deep dive, then questions. Every decision we make, I'll have to explain.

## What I learned in the handoff call

- The user is the customer's marketing manager.
- It should work for any customer's export in this shape. Don't hard-code anything to this dataset.
- Their core question is call counts by campaign.
- It needs a front end the marketer actually uses.
- What matters most: it has to lead to something the marketer can act on. A chart that only reports isn't enough.
- Local only. Docker or plain npm is my call.
- The slice I pitched, and they liked: pick a date range; a headline with total calls and the change from the previous period; calls by campaign, ranked; calls by location; a short AI-written takeaway.

## The data

Three files at the repo root: `calls.csv`, `campaigns.csv`, `locations.csv`.

- `campaigns.csv`: campaign_id, name, channel, daily_budget_usd (12 campaigns)
- `locations.csv`: location_id, name, timezone (IANA; 8 offices in 5 zones, including America/Phoenix)
- `calls.csv`:

| Field | Type | Notes |
| --- | --- | --- |
| call_id | string | Call identifier |
| started_at | timestamp, ISO 8601, UTC | When the call started |
| ended_at | timestamp, ISO 8601, UTC | When the call ended |
| duration_seconds | integer | Includes ring time |
| caller_number_hash | string | Repeat callers share a hash |
| tracking_number | string | Number dialed (fake +1-555-01xx) |
| campaign_id | string, nullable | Joins to campaigns.csv |
| marketing_channel | enum | paid_search, social, display, organic, direct, referral |
| location_id | string | Joins to locations.csv |
| answered | boolean | Whether a person answered |
| outcome | enum, nullable | booked, qualified_lead, not_qualified, missed, voicemail |
| revenue_usd | decimal, nullable | Estimated value of a booked call |
| agent_id | string, nullable | Empty for missed or voicemail |
| updated_at | timestamp, ISO 8601, UTC | When this row was written |

### What I found when I profiled it

| Finding | Numbers |
| --- | --- |
| Several rows per call | 5,411 rows for 5,000 calls. 396 calls have 2 or 3 rows. Later rows fill in the outcome or revenue, a median of ~42 hours later and up to ~72. The latest `updated_at` is the current state. |
| Outcomes still pending | 41 answered calls have no outcome yet. |
| No campaign | 144 calls (2.9%) have no campaign_id. They came in on 10 tracking numbers (+1-555-0190 to 0199) that aren't tied to any campaign, mostly organic and direct. |
| Date range | 2026-09-01 to 2026-10-29 UTC, 60 days. The last week is partial. No daylight-saving change falls inside the range. |
| Repeat callers | 2,040 unique callers; 895 called more than once. |
| Unanswered | 1,055 calls (21%): 686 missed, 369 voicemail. The rate is flat across offices and hours (20 to 23%), so don't invent a "bad office" story. Only 131 of those callers called back within 48 hours. |
| Revenue | Only on booked calls: 1,204 bookings, $432,894 total, $89 to $900 each. |
| Budget, not spend | daily_budget_usd is a budget, not actual spend. Organic and Direct have a $0 budget. |
| Already consistent | Durations match start and end; channel always matches the campaign's channel; no zero or negative durations. Still worth guarding. |

If spend is estimated as daily budget x 60 days, cost per booking runs from about $35 (Referral - Review Sites) to about $257 (Display - Retargeting), and revenue per budget dollar from about $9.86 down to $1.37. That spread is the most actionable thing in the data.

Keep a copy of the original CSVs as a regression fixture. On that copy, after keeping the latest row per call, the expected totals are 5,000 calls, 1,204 bookings, $432,894 in revenue and 144 unattributed calls.

## The slice

This is the scope I want to finish well. If something has to give, cut from the stretch goals, never from here.

The marketer picks a date range and works through four views. Each one ends with a suggested action backed by a number.

1. **Overview:** calls, unique callers, answer rate, bookings and revenue, each with the change from the previous period of the same length, plus the top actions found across the other views.
2. **Campaigns:** calls by campaign, ranked, with bookings, estimated cost per booking and revenue per budget dollar. Mark the best and worst, show calls per week for a selected campaign, and suggest where to shift budget.
3. **Locations:** calls, answer rate and bookings by office, and which campaigns work best at each office.
4. **Missed calls:** unanswered calls by office and local hour, the rough value of the bookings they likely cost, and a list of callers who never got through, downloadable as CSV.

Alongside the views:

- A data notes panel that says what was cleaned (duplicate rows, unattributed calls, pending outcomes) and what's estimated (spend from budgets).
- Optional AI: a one- or two-sentence takeaway beside each aggregation (calls by campaign, calls by office, missed calls by hour, and so on) saying what it means and what to do. A cheap model writes them from that aggregation's computed numbers. Generate all of a view's takeaways in one call, check each one against its own numbers, fall back to template text for any that fail, and cache them by data, date range and prompt version.

## Stretch goals

Only after the slice is done and tested, in this order:

1. Alerts for campaigns whose calls jumped or dropped against the previous period
2. Compare any two date ranges, not just the previous period
3. A print-friendly one-page summary for reporting up
4. Ask a question in plain English ("Which office misses the most calls on Fridays?"), turned into a filter the code runs. The model picks the filter; it never produces the numbers.

## Where I'm starting (push back on these)

- Numbers always come from code. AI only writes plain-English summaries from computed facts, and a check confirms every number and name in its text before it's shown. If the check fails, we show template text.
- Every view ends with a suggested action backed by a number: shift budget between campaigns, assign the untracked numbers to campaigns, call back the people who never got through.
- TypeScript end to end, a web front end, a pure data core with unit tests, and data held in memory (it's 5,000 rows).
- A small, cheap model (Haiku) for anything AI in the product, with caching and a spending guard.
