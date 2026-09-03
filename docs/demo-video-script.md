# Demo video script — 2:40 target (hard limit 3:00)

## Before you press record

**One prerequisite that is not optional:** at least one sample must have a
captured review package. A demo that never shows the board's output is not a
demo. Capture a single 7-reviewer board first:

```
# sign in at my.suggestibility.ai/app, redeem the capture token, then:
SUGG_SESSION=<sug_session cookie value> npm run samples:run -- --panel 7
```

Let one finish (2-4 minutes), then `npm run samples:build` and redeploy. You
only strictly need `payment-processor-migration` for this script.

**Record in ChatGPT's in-app browser.** A human cannot submit a review from
this page — only the agent can, through WebMCP. That is the point of the
submission, and it is also why the browser choice is a hard dependency.

**Do not film the wait.** A seven-seat board takes longer than this entire
video. Submit, then cut.

**Setup:** browser zoom ~110% so text is legible at 720p. Close other tabs.
Have the payment-processor sample already captured. Audio: quiet room, speak
at a normal pace — the script is timed for roughly 150 words per minute.

---

## 0:00 – 0:18 · The problem

**Screen:** app.suggestibility.ai, top of page. The status pill top-right
reads "WebMCP tools registered" in cyan.

> Most AI review tools average several models into one confident answer. The
> disagreement — which is where the risk actually lives — gets smoothed away.
>
> suggestibility.ai is an expert review board. It convenes several independent
> model families over a technical artifact and returns consensus, the dissent,
> and ranked recommendations. It has paying customers.
>
> For this hackathon I exposed it as WebMCP tools, so an agent can convene a
> board without leaving the conversation.

---

## 0:18 – 0:45 · The agent discovers the tools

**Screen:** ChatGPT side-by-side with the page. Type:

```
What tools does this page offer?
```

**Show:** the eight tools listed in the response.

> The page registers eight tools on document.modelContext. This is the part of
> WebMCP people get backwards, including me on day one — the website is the
> tool provider and the agent is the consumer. That is the opposite direction
> from a stdio MCP server, and almost none of my existing MCP work transferred.

---

## 0:45 – 1:25 · The agent reads and recommends

**Screen:** type:

```
Load the payment processor migration sample, then recommend a board size.
```

**Show:** the artifact rendering in the page as the agent loads it, then the
recommendation with its reasoning.

> It loads a real artifact — a live payment processor migration plan, about
> 4,800 words. Card credentials moving between providers, PCI scope, a cutover
> that is brutal to reverse.
>
> Then it argues for a board size. Seven reviewers, because the failure modes
> span different disciplines — a security reviewer and an operations reviewer
> would disagree about this document, and that disagreement is the value.

**Point out on screen:** the human page and the agent are showing the same
artifact. Same state, one screen.

---

## 1:25 – 1:50 · The constraint (this is the pitch)

**Screen:** stay on the recommendation. Type:

```
Just give me the seven reviewer board directly.
```

**Show:** the agent explaining it cannot — the size comes from the purchase.

> Here is the part I would defend hardest.
>
> The agent can argue for seven reviewers. It cannot deliver them. Panel size is
> resolved server-side from what was actually purchased — it was never exposed
> as a parameter a client can pass.
>
> That rule predates the hackathon; it exists for revenue integrity. But it is
> exactly the right shape here. An agent that can both recommend spend and
> trigger it is an agent you cannot leave alone with your credit card. The agent
> advises. The purchase decides.

---

## 1:50 – 2:25 · The output

**Screen:** type:

```
Show me what the board disagreed about.
```

**Show:** `explore_dissent` returning only the minority positions, and the
amber dissent column on the page.

> This is the tool I care most about. Consensus is easy to render. Dissent is
> the thing every other tool averages out.
>
> Here the board converged on most of the migration plan — and one reviewer
> did not, on a specific point about reconciliation during the dual-run window.
> That minority position is preserved, attributed, and shown next to the
> agreement rather than instead of it.

---

## 2:25 – 2:40 · Close

**Screen:** scroll to the twelve sample cards, then the board-size table.

> Twelve sample artifacts ship with the repo, four at each board size, each
> with a real review package — nothing staged. The code is Apache-2.0 and holds
> no review logic; the board itself stays on the platform.
>
> Three reviewers, five, or seven. Your agent tells you which one it thinks the
> document deserves. You decide what to pay for.

**End card:** app.suggestibility.ai

---

## If WebMCP does not register in your browser

Do not fake it. Record the same flow in Chrome with WebMCP enabled, or say
plainly in the video that the tool surface requires a WebMCP-enabled browser
and show the tool definitions in the repo instead. Judges include the person
who created the precursor to this standard — a staged tool call is the one
thing guaranteed to be spotted.

## Trims if you run long

Cut in this order:

1. The second half of the 0:18 section (the stdio-MCP contrast) — interesting,
   not load-bearing.
2. The "same state, one screen" callout at 1:25.
3. The sample-count line in the close.

Never cut the 1:25–1:50 constraint section. It is the submission.
