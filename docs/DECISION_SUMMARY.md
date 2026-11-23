# Decision summary

I built a local web app that shows a marketing manager how their inbound calls are performing and what to do about it. Every page ends in one suggested action with a number behind it. All of the numbers come from code. AI is optional: it writes one short takeaway per page, and the app is complete without it. Building and running it cost **$108.80 of the $250 cap**.

## Who it's for

The marketing manager at a business that takes inbound calls across several offices and campaigns. They aren't an analyst. They own the campaign budget and answer to someone above them for results. About once a week they open the app, look at a recent period, and want three answers:

1. Which campaigns are earning their budget, and which aren't?
2. Where are we losing calls?
3. What should I change this week?

## What I learned

**From the handoff call**

- The user is the customer's marketing manager, and their core question is call counts by campaign.
- What matters most is that it leads to something they can act on. A chart that only reports isn't enough, so each page ends in an action.
- It has to work for any customer's export in this shape, so nothing in the code names a campaign, office or date from this dataset. A test runs every view on an export with entirely different names, time zones and dates.
- They liked the slice I pitched: a date range, a headline with the change from the previous period, calls by campaign ranked, calls by location, and a short AI takeaway.

**From the data**

One call can have several rows. The export has 5,411 rows for 5,000 calls, because later rows fill in the outcome and revenue. Counting every row overstates calls (5,411 against 5,000) and bookings (1,222 against 1,204). Counting only the first row understates bookings (1,115), because 89 calls were marked booked only in a later row. I take the latest row per call, which gives 1,204 bookings and $432,894 in revenue.

144 calls came in on tracking numbers tied to no campaign. I kept them as their own "Unattributed" line, because they are real calls the marketer isn't getting credit for.

The export has budgets but no spend. Every cost figure is an estimate (daily budget × days in the range), and the app labels it as one wherever it appears.

About one call in five goes unanswered (1,055 of 5,000, or 21.1%), and the share is close to flat across offices: office answer rates run from 76.7% to 80.5%. No office is clearly worse than the others, so the Locations page says no office stands out.

The widest gap in the data is between campaigns. Estimated revenue per budget dollar runs from $9.86 for the best campaign (Referral - Review Sites) to $1.37 for the worst (Display - Retargeting), about seven times apart. So the first action the app suggests is about where the budget goes.

Some sentences I first wanted the app to say did not hold up when I tested them against the data. I cut them back to what the numbers support. The `docs/DECISIONS.md` lines dated 2026-11-21 list them.

## Scope and why

I finished and tested the slice first: a date range with a comparison to the previous period of equal length, and four views that each end in an action.

| View         | Action it leads to                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Overview     | The headline action from each other page, in one list                                                              |
| Campaigns    | Consider moving budget from the lowest to the highest estimated return; fix calls that no campaign gets credit for |
| Locations    | Look at an office that answers or books clearly less than the others, or say that none does                        |
| Missed calls | Call back the callers whose latest call went unanswered, as a downloadable CSV                                     |

Estimates and incomplete periods are labelled next to the number they affect.

The AI add-on is one short takeaway per view. A check confirms every name in it and that it contains no number the code didn't supply. If the check fails, the page shows template text.

I took the stretch goals in order after the slice, so the slice was never at risk (`docs/DECISIONS.md`, 2026-11-18). My reason for each:

- S1, alerts. The marketer should be told when a campaign's calls jump or drop, not have to notice it in a table.
- S2, compare any two ranges. The comparison code already took any two ranges, so this was mostly a control on the page.
- S3, print summary. The marketer answers to someone above them, and a one-page summary is what they hand up.
- S4, ask a question. An AI feature inside the product, built so the model only picks a filter and the code produces every number.
- S5, visual design. The first versions looked generic. I wanted it to look like a product in this space, so it follows Invoca's own design language.
- S6, database. The data needed to persist so a newer export could be added. It reads through the same cleaning code as the CSV path, so no number changed.
- S7, upload. The marketer can add a newer export from the page without restarting the app.

I did not build login, multiple customers, cloud hosting, editing of campaigns or budgets, or live data.

## Trade-offs

I show estimated spend because the data has none. "Cost per booking" and "return per budget dollar" are therefore models, and the wording on the page says so.

The AI can't write a number. It writes sentences with placeholders and the code fills in the values, so no figure on screen can come from a model. The takeaways read plainer than free text would, and the AI is asked to restate the page's own action without adding advice. I rejected checking free text by pulling numbers out of it, because that is easier to get around.

On the shipped data no office is worse than the rest, and the Locations page says so. The extended data plants two weak offices so the flag can be seen working, but the app doesn't open on it.

The extended data is synthetic and opt-in. It adds 1,500 invented rows so Locations and Campaigns have patterns to find. `npm start` still opens on the shipped export.

I cut 25 sentences that claimed more than the data supports. Actions now say "consider" and estimates say they are models. The advice is softer as a result.

The app is local only with no login, which matches the brief. Uploads can add rows but can't overwrite a stored campaign or office, because silently changing a budget or a time zone is worse than refusing.

Seven extras on top of the slice mean more to review. I accepted that because the slice was finished first and each extra was tested before the next began.

## Next steps

In this order:

1. Real spend data in place of the budget estimate, so cost per booking is measured and not modelled.
2. A live feed from the call platform in place of a file, so there is no export to upload.
3. A record of whether each call-back happened, so the call-back list can be judged by results.

## AI spend

**Total: $108.80 of the $250 cap (44%)**, from `docs/AI_COST_LOG.md`. Every Claude API call the app makes is also logged with time, model, purpose, tokens and cost.

| Where the money went                                                        | Cost   | Rows in the log            |
| --------------------------------------------------------------------------- | ------ | -------------------------- |
| Planning each phase (Sonnet 5.5)                                            | $17.67 | 17 (Phases 1–10 and S1–S7) |
| Building each phase (Sonnet 5.5) and an adversarial review of it (Opus 5.5) | $87.96 | 17                         |
| One small add-on to Phase 7 (Opus 5.5)                                      | $2.12  | 1                          |
| Writing the submission documents (Sonnet 5.5)                               | $1.03  | 1 (Phase 11)               |
| The running app (Haiku 5.5): takeaways and one question                     | $0.02  | 2 (about 85 paid calls)    |

By model, that is about $81.67 on Sonnet 5.5, $26.93 on Opus 5.5 and $0.21 on Haiku 5.5. The Haiku figure includes a little build-time use and seven web searches in Phase 7. The by-model figures differ from the total by a cent because of rounding in the log.

How I kept it down:

- The app uses the cheapest current model (Haiku 5.5, low effort), because the task is short structured writing. A takeaway costs about two hundredths of a cent.
- Results are cached, so a repeat costs nothing.
- The app stops calling the model past a spend limit (default $5).
- No automated test calls the real API.
