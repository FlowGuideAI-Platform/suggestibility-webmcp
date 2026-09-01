# suggestibility-webmcp

**WebMCP client surface for the [suggestibility.ai](https://suggestibility.ai) AI Expert Review Board.**

Live: **https://app.suggestibility.ai**

Your agent reads an artifact, recommends a 3, 5, or 7 reviewer board, then returns
consensus and preserved dissent. The agent advises; you decide.

---

## What this is

[WebMCP](https://webmachinelearning.github.io/webmcp/) lets a **website** expose
structured tools that a browsing AI agent can discover and call. The page is the
tool provider; the agent is the consumer. This is the inverse of the stdio MCP
server model, where a server sits outside and an AI client connects in — a
distinction worth stating plainly, because the two share vocabulary and are
routinely confused.

This repository is the page. It registers eight tools on `document.modelContext`
and calls the Suggestibility.ai platform API over HTTPS.

**What is not in this repository:** the review pipeline. Board composition,
reviewer selection, synthesis, and scoring run in a separate proprietary service.
This client holds no secrets and no review logic.

## Why an agent can't just take seven reviewers

Panel size is resolved **server-side from the purchased plan**. It is not a
parameter this client can pass. An agent can read your artifact and argue hard
for a seven-reviewer board — but it cannot conjure reviewers nobody paid for.

That constraint is the design, not a limitation of it. `recommend_board_size` is
advisory by construction: it returns a recommendation and its reasoning, and the
human decides what they are willing to pay for. An agent that can both recommend
spend and trigger it is an agent you cannot leave alone with your credit card.

## The tools

| Tool | What it does |
|---|---|
| `list_review_options` | Board sizes available for purchase, with prices |
| `recommend_board_size` | Reads an artifact, argues for 3, 5, or 7 — **advisory only** |
| `submit_artifact_for_review` | Submits an artifact; returns a `review_id` |
| `get_review_status` | Polls an in-flight review |
| `get_review_package` | Consensus, preserved dissent, ranked recommendations |
| `list_sample_artifacts` | Ten sample artifacts with completed reviews attached |
| `load_sample_artifact` | Loads a sample and its review into the page |
| `explore_dissent` | Extracts only the minority positions — what the board did *not* agree on |

`explore_dissent` exists because preserved dissent is the product. Most review
tools average their models into a single confident answer; the disagreement is
where the risk actually lives, so it is surfaced as a first-class tool rather
than buried in a field.

---

## For judges

**Ten sample artifacts** ship in this repository under `public/samples/`, spanning
different domains — architecture decisions, security policy, API design, incident
review, and others. Each ships with a **completed review package produced by the
real platform**. Nothing is staged, hand-written, or mocked: these are genuine
board outputs, committed so you can read full consensus-and-dissent results
instantly, with no wait and no account.

**Twenty-one demo tokens** are reserved for judging — seven at each board size.
They run live reviews against the real pipeline at no cost to you. Everyone else
is charged normal rates.

| Board size | Demo tokens | Price to everyone else | Typical time to complete |
|---|---|---|---|
| 3 reviewers | 7 | $15 | **1–3 minutes** |
| 5 reviewers | 7 | $29 | **2–4 minutes** |
| 7 reviewers | 7 | $69 | **3+ minutes** |

**More reviewers takes longer.** Each reviewer is an independent model family
producing its own findings before synthesis, so a seven-seat board is not a
seven-times-larger prompt — it is seven separate reviews plus a synthesis pass.
If you want to see the full board without waiting, read a committed sample first;
the live run is there to prove the samples are real.

Demo tokens are entered in the page's token field, or an agent can be told to use
one. They expire after the judging period.

---

## Running it locally

Requires Node 22+.

```bash
git clone https://github.com/<owner>/suggestibility-webmcp.git
cd suggestibility-webmcp
npm install
npm run dev
```

This serves the page at `http://localhost:8787` against the production API. The
sample artifacts and their review packages are static and work offline; live
review submission needs a demo token or an account.

To point at a different API host, set `window.SUGGESTIBILITY_API_BASE` before
`webmcp-tools.js` loads.

### Seeing the tools

WebMCP is not yet in stable browsers. Use either:

- **ChatGPT's in-app browser** — open the live URL and ask the agent what tools
  the page offers.
- **Chrome with WebMCP enabled** — see the
  [Chrome documentation](https://developer.chrome.com/docs/ai/webmcp).

Without WebMCP the page degrades to a normal human UI. The agent surface is
additive and never load-bearing.

### Deploying

```bash
npm run deploy
```

Deploys the `suggestibility-webmcp` Worker. The Cloudflare account is pinned in
`wrangler.jsonc`; the route is attached at deploy time and deliberately kept out
of source so a clone cannot claim a `suggestibility.ai` hostname.

---

## Licence

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

Redistributions must retain the `NOTICE` file and its attribution; modified files
must carry prominent notices stating they were changed. "Suggestibility" and the
Suggestibility mark are trademarks of All Aligned Consulting LLC — the licence
covers the software, not the name (Apache-2.0 §6).
