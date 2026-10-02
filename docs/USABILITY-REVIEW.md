# BazaarSignal usability review — October 2, 2026

## Visual-theme follow-up

The user preferred the original Minecraft-inspired design. The initial simplification flattened that identity too far. The subsequent release restores the sky islands, hanging wooden brand and slogan, illustrated tabs, vines, lantern, parchment, item glow and rarity ribbons, and alert bell/desk artwork. The search fix, explicit pricing and quantity labels, shorter alert copy, expandable details and two-column results layout remain. Owner navigation receives enough room for all five tabs.

This presentation-only follow-up passed the production build, two production-build desktop/mobile scenarios using the real cached Summoning Eye response, and all 14 authenticated alert browser scenarios. The final live bundle `app-CrzejrCW.js` was verified at 1440 × 1000 and 390 × 844. The existing alert remains at 1,350,000 coins for one item. No real alerts, targets, settings, emails or backend controls were changed. The release was deployed through the existing Firebase Hosting preview channel. Restored screenshots are `.local/usability-review/restored-bazaar-desktop.jpg`, `restored-eye-desktop.jpg`, `restored-eye-mobile.jpg` and `restored-alerts-mobile.jpg`.

The review and initial implementation record below are preserved as the history of the first pass; the visual changes described above supersede its flatter styling.

Reviewed the actual https://bazaarsignal.web.app in the existing signed-in Chrome session at 1440 × 1000 and 390 × 844. Navigated Bazaar, Auctions, Watchlist and Price Alerts; searched Summoning Eye; changed temporary quantity; opened its mobile details; inspected the existing active alert and its edit form; selected an item and both directions in the creation form. No alert was submitted, target changed, saved filter changed, watchlist item added, or email sent.

## First impression

The four product destinations, buy/sell direction, saved-alert status, and coin values are recognizable. The Minecraft artwork establishes the setting. The app correctly distinguishes sampled prices from fresh prices and withholds auction comparisons when stale.

The main task is buried beneath decoration and repeated explanations. At 390px, the first Bazaar screen ends inside an empty Deal of the Day panel before any item price. At 1440px, that panel takes roughly a quarter of the board. Item details repeat identical prices before reaching profit and alert actions. The page warns that prices are stale in several places but makes the user assemble quantity, trade direction, tax, and totals from different sections.

Observed example: searching Summoning Eye with the default quantity of 64 and 10,000,000-coin budget returns zero results. Changing quantity to 1 reveals a sampled buy-order price of 1,455,447, sell-offer price of 1,482,424, and after-tax estimated profit of 8,446.70. The sample is from October 2 at 11:00:08 AM EDT and was approximately 56 minutes old during the walkthrough. These are historical observations, not current trade recommendations.

## Ten improvements, ranked by user benefit

| Rank | Exact place | Observed problem | Concrete change |
| --- | --- | --- | --- |
| 1 | Bazaar search and No matching opportunities | A known item disappears because quantity and budget filters exclude the trade. The empty state does not explain which constraint applies. | Keep name searches discoverable, explicitly flag results outside filters, and retain the chosen quantity, strategy and costs. Show an over-budget reason on the item. Keep ordinary opportunity browsing filtered. |
| 2 | Bazaar/Auctions: Deal of the Day column | A large empty promotion precedes useful data on mobile and consumes a desktop column. Its suggested filter changes cannot make an hourly sample fresh. | Remove the duplicate featured column; use the result list and existing sorting to find opportunities. |
| 3 | Bazaar cards and Item Details | Buy/Sell labels require checking prose for quantity and whether tax is included. The same unit prices appear twice before profit. | Show totals with the selected quantity, label sale before tax and profit after fees, retain one unit-price pair, and move order-book context and fee breakdown into details. |
| 4 | Shared header and mobile filter bar | Large logo, slogan, landscape, sign-out row and tall illustrated tabs consume substantial space; the mobile strategy is truncated. | Keep a compact brand and plain navigation; reduce decoration behind reading surfaces; put full-width strategy and quantity first, secondary filters in a disclosure. |
| 5 | Price Alerts: existing Summoning Eye card | Target repeats in a sentence and a second block; schedule repeats the page notice; email delivery label adds no new information. Edit target sits below all this. | Keep one direction/target/quantity line, one sampled quote and timestamp, and a readily visible edit action. Keep stale waiting and errors explicit. |
| 6 | Bazaar result status and repeated card warnings | Source time, collection time, sample age and stale warning repeat across the page, card, inspector and footer. Technical phrases include “7d proxy” and “fee context.” | Keep one page sampling notice and a short stale badge per card. Keep item sample age in details; expose exact collection metadata on request. Move activity to liquidity details. |
| 7 | Price Alerts: Create alert sidebar | An alphabetically first unrelated item and price are preselected; a huge native select makes finding an item awkward. | Start with “Choose an item”; provide a simple item-search field, keep explicit selection, and require the user to enter their target. Preserve item-specific deep links. |
| 8 | Price Alerts: page title, context and creation help | Slogan, one-email promise, two explanations of hourly sampling, duplicated recipient and decorative desk compete with the form. | Use a short purpose sentence, one sampling notice, one recipient line, and a “Delivery & limits” disclosure. Preserve confirmation, disable-link, queue and capacity meaning. |
| 9 | Auctions: stale result cards | Cards say “0 matching active listings,” show unexplained dashes and offer “Find seller” while the page says comparisons are withheld. | State “Comparison unavailable · stale sample”; show the sampled asking price and missing comparison clearly. Make details the primary action when stale, retaining seller commands for eligible fresh listings. |
| 10 | Watchlist title, empty state and repeated chest sidebar | “Your treasure chest” is less direct than Watchlist; it instructs users to use a heart although save controls are stars. Header search unexpectedly routes to Bazaar. | Use “Watchlist” and “Use the star on an item to save it here.” Explain saved items versus email alerts. Remove the duplicate chest panel and misleading search from this destination. |

These observations come from the walkthrough. Expected reductions in hesitation and accidental selection are design judgments; no other users were tested. The existing Watchlist is empty, so populated behavior will be regression-tested locally rather than changing saved data. Auction comparisons were stale, so no real profitable auction or seller availability is claimed.

## Remove, combine, or move into details

- Remove: Deal of the Day duplicate, repeated watchlist chest, decorative alert desk, marketing slogans, repeated UNKNOWN rarity labels, duplicated target block and duplicate unit-price rows.
- Combine: buy/sell/profit into a quantity-labelled estimate; alert target/direction/quantity into one sentence; sampling cadence and stale meaning into one notice; recipient and confirmation explanation into one place.
- Move into details: collection timestamp, order-book top prices, activity and market-share metrics, fee evidence, additional costs, saved-filter controls, advanced filters, recent delivery history and delivery limits. Keep errors, missing data, stale state and important trade concerns visible.

## Replacement copy

| Before | After |
| --- | --- |
| Good loot. Better deals. | Remove the slogan; use the page name as the heading. |
| Bazaar Samples | Bazaar |
| Buy / Sell / Sampled profit | Buy total / Sell before tax / Sampled profit after fees |
| Order → offer · totals for 64 units · sale before tax | Buy order → sell offer · 64 items |
| Historical estimates use the sampled prices and fee context | Historical estimates. Check in-game prices before trading. |
| Every coin accounted for | Fees & calculation |
| Will it trade? | Liquidity & order book |
| Your target price. Your next good deal. | Email alerts for your buy or sell target. |
| Instant buy at or below 1,350,000 coins / item; separate Quantity: 1 | Buy 1 item at ≤ 1,350,000 coins each (instant buy). |
| Next scheduled cache check | Next price check |
| When it happens | Alert preview |
| One email when your target is reached. | A confirmation email, then one target alert. Delivery may queue. |
| Your treasure chest / Saved opportunities, just for you. | Watchlist / Saved Bazaar items and auction listings. |
| Use the heart on an item to tuck it away here. | Use the star on an item to save it here. For email notifications, set a price alert. |

## Simpler page structure

**Bazaar:** compact navigation → item search → strategy and quantity with secondary filters → page title/count and sort → sampled timestamp and stale meaning → compact cards with trade direction, quantity, buy total, sale before tax and profit after fees → item details on the desktop side or mobile sheet. Details put the estimate and alert/watchlist actions before expandable fee and liquidity evidence. No featured column or duplicate chest.

**Price Alerts:** compact navigation → page title and Create alert shortcut → hourly sampling/fresh-only notice → Active / Completed / Disabled tabs and search → concise alert cards with edit actions → collapsed delivery history. Creation stays beside the list on desktop and directly reachable via the shortcut on mobile: item search/selection → direction → target and quantity → sell tax if relevant → concise preview and sampled quote → verified recipient → Create alert → delivery/limits details.

## First three changes

1. Make Summoning Eye and other searched items discoverable without silently changing trade inputs.
2. Remove the featured column and shrink the header so results appear much sooner on mobile.
3. Consolidate trade estimates and alert cards while keeping fees, quantity, missing data and stale-price meaning explicit.

## Implemented and verified

All ten recommendations above were addressed. The existing calculations, owner authorization, email safeguards, collection schedule, cache behavior, limits, counters, cleanup and fixed operating deadline were kept. No real alert, target, saved filter or Watchlist entry was changed; no test email was sent. Creation/editing tests used local preview data or emulators.

The live Hosting release was promoted from the existing `free-preview` channel on October 2 at approximately 16:34 UTC. Verified live bundle: `app-C_f6-35W.js`. No backend, Apps Script, security-rule, billing or paid-service change was deployed.

Verification passed: **246 unit tests and 70 browser scenarios** (18 market, 18 local alert workflow, 14 authenticated alert, 8 private Watchlist/owner dashboard, 12 production-build scenarios). TypeScript and production builds passed. Tests cover searched items outside filters, unchanged trade inputs, missing data, fresh/stale estimates, paused/deadline behavior, account isolation, explicit item selection, empty targets, direction changes, edit/cancel, and responsive overflow. The build retains its existing large-bundle advisory.

The deployed site was inspected at 1440 × 1000 and 390 × 844 using real cached prices and the existing signed-in account. Additional production-build overflow checks covered widths 320, 390 and 768 with an unmodified captured cache response. Summoning Eye at quantity 1 showed buy-order cost **1,455,447.3**, gross sell-offer value **1,499,998.8**, and historical after-fee profit **25,801.51**, sampled at **12:00 PM EDT**. This sample is one hourly generation later than the review baseline; the price difference is not a calculation change. Its mobile details now show the estimate, uncertainty and both save/alert actions in the first sheet viewport.

The active alert remains **1 item at or below 1,350,000**, with **Active 1 / Completed 1 / Disabled 0**. The target and Edit target action fit in the first mobile screen. Its form was opened and cancelled; the new-alert form was inspected without submission. Watchlist remained empty. Stale Auctions exposed their sampled asking prices and View details actions while comparison values stayed unavailable.

Read-only operational snapshots from **16:33:32 to 16:38:27 UTC** showed identical collection jobs, hourly Scheduler state, quota limits and expiry (**November 1, 2026 at 07:00 UTC**). Observed collector activity and reserved upstream/collector allowances stayed unchanged (14 collector admissions and 1,344 reserved upstream requests). Seven ordinary public-cache requests incremented their normal request/resource reservations. Counters were not reset. Navigation and refresh did not start a collection.

Remaining limitations: hourly sampling still leaves prices stale for much of each hour, passive orders may not fill, and missing liquidity or fee evidence cannot support a profit estimate. The existing API origin policy prevents real-data browsing on localhost and the hosted preview; production-build tests used a captured real cache, then actual live-origin reads were checked after promotion. That access policy was preserved. No user study or real email delivery test was performed.

Before/after screenshots and the operational comparison are saved in `.local/usability-review/` as local review artifacts:

- `before-bazaar-desktop.jpg` / `after-bazaar-desktop.jpg`: removal of the featured column and reduced header/filter hierarchy.
- `before-alerts-mobile.jpg` / `after-alerts-mobile.jpg`: shorter alert card with target and edit action visible.
- `before-eye-mobile.jpg` / `after-eye-mobile.jpg`: totals, sampled profit and actions moved earlier.
- `before-eye-desktop.jpg` / `after-eye-desktop.jpg`: concise item details with secondary evidence collapsed.
- `operational-verification.json`: read-only control and collection comparison.
