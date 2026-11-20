# CLAUDE.md

I'm building a small local web product that helps a marketing manager track inbound call performance and act on it. Read `docs/BRIEF.md` for the full context and `PLAN.md` for the design before you change anything.

## How I want you to work

- Work one step at a time from the build order in `PLAN.md`. Finish the step, run the tests, show me the results, then stop and wait for me.
- Ask before adding a dependency, changing a data rule, or going past the current step.
- If something in `PLAN.md` is wrong or unclear, tell me. Don't quietly work around it.
- Keep commits small, with messages that say why.
- Prefer simple, readable code over clever code. I'll walk reviewers through all of it.

## Rules that never bend

- Every number the user sees comes from code. A model never computes or invents a metric.
- AI-written text is checked before it's shown: every number and name in it must match the computed facts. If the check fails, show template text instead.
- The app works with AI turned off or the API key missing.
- Never commit secrets. The API key lives in `.env`, which is gitignored; `.env.example` documents it.
- Every Claude API call the app makes is logged: time, model, purpose, input and output tokens, cost.
- Nothing is hard-coded to this dataset: no campaign names, office names or dates. It must work for any export with the same columns.

## Data rules (each one gets a test)

- Several rows can share a call_id. Keep the one with the latest updated_at.
- campaign_id can be empty. Count those calls as "Unattributed"; never drop them.
- Timestamps are UTC. Convert to the office's IANA time zone for any time-of-day or day-of-week view.
- Revenue only counts on booked calls.
- Spend isn't in the data. If we estimate it from daily_budget_usd x days, label it as an estimate. Cost per booking is empty when the budget is 0, never infinity.
- Comparisons use periods of equal length by default; a second range of another length is compared per day and labelled. Never compare a partial period with a full one without saying so.
- Bad rows (bad timestamp, unknown campaign or location) are counted and reported. They never crash the app.

## AI budget

- $250 hard cap on the provided key, covering this build and the running app.
- In the app, use the cheapest model that does the job, cache results so a repeat costs nothing, and stop calling the model past a set spend.
- I keep `docs/AI_COST_LOG.md` myself. Don't write to it unless I ask.

## Docs in this repo

- `docs/BRIEF.md`: the problem, constraints and data findings. Don't edit it without asking me.
- `PLAN.md`: the design spec. Write it as instructions to the engineer building it, in this order: the user and their job; scope and non-goals; each view and the action it leads to; data rules; architecture; how AI is used, checked and budgeted; testing; build order in small steps, each one testable on its own; what "done" means.
- `docs/DECISIONS.md`: one line per real decision: date, decision, why, what we rejected.
- `docs/AI_COST_LOG.md`: the AI spend log. I maintain it; only write to it when I ask.
- `README.md`: setup and the one command to run it.

## Commands

Fill these in once `PLAN.md` sets the stack.
