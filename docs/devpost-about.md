# About the project

## Inspiration

suggestibility.ai is an AI Expert Review Board. Submit an artifact — an architecture decision record, a policy, a design doc — and it convenes a panel of independent model families that returns consensus, preserved dissent, and prioritized recommendations. Boards come in three sizes: 3 reviewers for $15, 5 for $29, 7 for $69. It runs on Cloudflare Workers and D1, and it has real paying customers. None of that was built for this hackathon.

What the product already had, before any of this, was a rule: panel size is resolved server-side from the plan attached to the customer's credit. It is not a parameter anyone — human or agent — can pass in. That rule existed for revenue integrity, not for a hackathon. But it turns out to be exactly the right shape for agent-driven commerce: an agent that can both recommend spend and trigger it is an agent you cannot leave alone with your credit card.

The WebMCP Challenge was a chance to put that rule directly in front of an agent and see if it held. WebMCP's topology — the website is the tool provider, the browsing agent is the consumer — is a natural fit for a product whose whole premise is that the agent gets real capability, minus the one capability that actually matters. So the build became: expose the review board as page-side tools an agent can discover and call, and let the constraint be the point of the submission rather than a footnote. The agent advises; the purchase decides.

## What it does

An agent browsing the page discovers eight tools and can run the whole review loop without leaving the conversation: read an artifact, argue for a board size, submit it, poll it, and read back the finished package — consensus, preserved dissent, and ranked recommendations, with per-finding provenance.

The one thing it cannot do is decide what you pay. `recommend_board_size` returns a recommendation and its reasoning. The size actually convened comes from the purchase. An agent can make the case for seven reviewers; it cannot conjure reviewers nobody bought.

## How we built it

The result is a public, Apache-2.0 WebMCP client. It holds no secrets and no review logic — board composition, reviewer selection, synthesis, and scoring stay in the existing platform service. What lives in this repository is eight tools registered on `document.modelContext`: `list_review_options`, `recommend_board_size`, `submit_artifact_for_review`, `get_review_status`, `get_review_package`, `list_sample_artifacts`, `load_sample_artifact`, and `explore_dissent`.

`recommend_board_size` carries the central constraint directly: it reads an artifact and argues for 3, 5, or 7 reviewers, but the parameter that would let it actually set panel size was never exposed to it. It can only ever be advisory, by construction.

`explore_dissent` exists because preserved dissent is the product's actual differentiator — most review tooling averages disagreement into a single confident answer, and this platform doesn't, so pulling out only the minority positions deserved a first-class tool rather than a field buried in a larger response.

Twelve sample artifacts ship with the client, four at each board size, 23,082 words total, spanning architecture decisions, security architecture, data policy, API design, payments, accessibility, and incident review. They ship as artifacts rather than as pre-computed results: reviews run live against the production pipeline, on demand, from the page or from an agent. A canned review output is indistinguishable from a convincing fake, so there are none in the repository.

The human page and the agent tool surface render from the same state. What a person sees on screen is what the agent just did. A demo where the agent narrates one thing while the page shows another is worse than no demo.

## Challenges we ran into

Turnstile runs on the review endpoint when configured, and it is currently unset in production for one specific reason: an agent cannot solve a CAPTCHA. Turning it on would break every agent-driven submission with an unexplained "verification failed." Leaving it off keeps the agent path working — a tradeoff, not a solved problem.

Cookies were the other authentication fight. The session cookie is httpOnly, SameSite=Lax, and host-only, which is not something to depend on inside an embedded browser like ChatGPT's, where third-party cookie handling is not guaranteed. The client authenticates with a bearer token instead. Getting there meant consolidating five hand-rolled session lookups scattered across the codebase into a single resolver — four of which had only ever accepted a cookie and would otherwise have quietly rejected a token.

Latency turned out to be a design constraint, not an implementation detail. A seven-seat board is seven independent reviews plus a synthesis pass, not one larger prompt — so it takes minutes, not seconds. That is why the sample artifacts ship with their review packages already captured: exploring a board has to be instant even though generating one is not.

And honesty had to be made mechanical, not promised. An early draft of the README claimed every sample shipped with a completed board review. It did not — the samples were written, the boards had not been run, and the sentence would have gone public unchallenged. A release check now fails the build if a stored package's reviewer count contradicts what the catalogue advertises, and the claim itself was rewritten to describe what the repository actually contains.

## Accomplishments that we're proud of

The constraint held. An agent can read a 25,000-word migration plan, make a genuine case for seven reviewers, and still be unable to spend a dollar on its own conclusion. That is the design working under a real agent rather than in a diagram.

The guards caught things a careful reader would not have. One found a disclosure hiding in ordinary-looking UI copy. Another found that a single demo code was worth up to 625 seven-reviewer boards — not because anyone chose that number, but because it was what a subscription tier meant once multiplied by its redemption count. Neither was visible by reading the code.

All of this shipped against a production system with paying customers, without breaking it: 173 tests passing, a Cloudflare account guard that refuses to deploy anything misnamed or misplaced, and a migration ledger repaired after it was found 27 migrations behind reality — which had quietly turned the documented, obvious command into a destructive one.

## What we learned

The most useful surprise arrived on day one. The platform already runs a working JSON-RPC MCP server, the kind where an external client connects in from outside. Almost none of that experience transferred. WebMCP is page-side: the website is the tool provider, the agent is the consumer. Same vocabulary, opposite direction — and building for one taught almost nothing about the other.

The rest came from watching a guard fail, then watching a second guard fail differently.

A leak-check script was written to stop demo tokens from reaching the public repository. It caught something real on its first run: the token input's placeholder published the naming scheme for the judging codes and made the live ones guessable on sight. It looked like ordinary UI copy. It was a disclosure.

A second guard, checking sample metadata for person names, was written in shell — and silently did nothing. Its role-word exclusion matched anywhere on the line, so `| Author | Sana Okafor, Mobile Platform |` was suppressed by the word "Mobile" further along, and the script reported success every time it ran. It was rewritten in JavaScript with positional anchoring and given a self-test, which immediately found a second gap (bold metadata went unmatched entirely) and one false positive (team names read as person names). A guard that has not been watched fail is a guess, not a guard.

That lesson kept collecting evidence. Later, a shell command piped a guard's output through `tail` — which reports the exit code of `tail`, not of the guard — so a failing check was read as a passing one and the commit went through anyway. The check was correct. The thing invoking it was not. The failure mode is always the same: the alarm is fine, nobody wired the bell.

## What's next for suggestibility-webmcp

**Solve Turnstile properly rather than avoiding it.** The page should mint a verification token before the agent's tool call, so bot protection and agent access stop being mutually exclusive. Right now they are, and the resolution is that one of them is switched off.

**Real API keys.** MCP access currently authenticates with a session token used as a bearer credential. That works, but a key a customer can issue, scope, name, and revoke independently of their login session is what this needs — and it is the same primitive a metered pay-per-review agent plan would be built on.

**Let the agent open a checkout the human approves.** Today the agent recommends and the human buys, in two disconnected steps. The honest version of the split is not that the agent is locked out of commerce — it is that the agent can propose a purchase and a person confirms it. The constraint stays; the seam gets less awkward.

**Progressive results.** A seven-seat board should stream reviewers as they land rather than presenting minutes of silence followed by everything at once. Dissent is the most interesting output and currently arrives last.

**Board composition, not just board size.** Panel size is the only dimension a buyer picks. Which disciplines sit on the board is chosen server-side, and it is arguably the more valuable thing to expose to an agent that has just read the document and knows what expertise it calls for.
