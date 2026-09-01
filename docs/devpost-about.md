# About the project

## Inspiration

suggestibility.ai is an AI Expert Review Board. Submit an artifact — an
architecture decision record, a policy, a design doc — and it convenes a panel
of independent model families that returns consensus, preserved dissent, and
prioritized recommendations. Boards come in three sizes: 3 reviewers for $15,
5 for $29, 7 for $69. It runs on Cloudflare Workers and D1, and it has real
paying customers. None of that was built for this hackathon.

What the product already had, before any of this, was a rule: panel size is
resolved server-side from the plan attached to the customer's credit. It is
not a parameter anyone — human or agent — can pass in. That rule existed for
revenue integrity, not for a hackathon. But it turns out to be exactly the
right shape for agent-driven commerce: an agent that can both recommend spend
and trigger it is an agent you cannot leave alone with your credit card.

The WebMCP Challenge was a chance to put that rule directly in front of an
agent and see if it held. WebMCP's topology — the website is the tool
provider, the browsing agent is the consumer — is a natural fit for a product
whose whole premise is that the agent gets real capability, minus the one
capability that actually matters. So the build became: expose the review
board as page-side tools an agent can discover and call, and let the
constraint be the point of the submission rather than a footnote. The agent
advises; the purchase decides.

## What we learned

The most useful surprise arrived on day one. The platform already runs a
working JSON-RPC MCP server, the kind where an external client connects in
from outside. Almost none of that experience transferred. WebMCP is
page-side: the website is the tool provider, the agent is the consumer. Same
vocabulary, opposite direction — and building for one taught almost nothing
about the other.

The rest of what got learned came from watching a guard fail, then watching a
second guard fail differently.

A leak-check script was written to stop demo tokens from reaching the public
repository. It caught something real on its first run: the token input's
placeholder text read `SUGGJUDGE…`, which published the naming scheme for the
judging codes and made the live ones guessable on sight. It looked like
ordinary UI copy. It was a disclosure.

A second guard, checking sample metadata for person names, was written in
shell — and silently did nothing. Its role-word exclusion matched anywhere on
the line, so `| Author | Sana Okafor, Mobile Platform |` was suppressed by
the word "Mobile" further along, and the script reported success every time
it ran. It was rewritten in JavaScript with positional anchoring and given a
self-test, which immediately found a second gap (bold metadata went unmatched
entirely) and one false positive (team names read as person names). A guard
that has not been watched fail is a guess, not a guard.

The last lesson was about what counts as a billing surface. An existing demo
code granted a subscription tier whose allowance was 25 reviews, and the code
had 25 redemptions available — meaning one code was worth up to 625
seven-reviewer boards. Nobody had chosen that number as demo policy; it was
just what the tier meant once multiplied out. Fixed with a per-code review
cap.

## How we built it

The result is a public, Apache-2.0 WebMCP client. It holds no secrets and no
review logic — board composition, reviewer selection, synthesis, and scoring
stay in the existing platform service. What lives in this repository is eight
tools registered on `document.modelContext`: `list_review_options`,
`recommend_board_size`, `submit_artifact_for_review`, `get_review_status`,
`get_review_package`, `list_sample_artifacts`, `load_sample_artifact`, and
`explore_dissent`.

`recommend_board_size` carries the central constraint directly: it reads an
artifact and argues for 3, 5, or 7 reviewers, but the parameter that would
let it actually set panel size was never exposed to it. It can only ever be
advisory, by construction.

`explore_dissent` exists because preserved dissent is the product's actual
differentiator — most review tooling averages disagreement into a single
confident answer, and this platform doesn't, so pulling out only the minority
positions felt like it deserved a first-class tool rather than a field buried
in a larger response.

Twelve sample artifacts ship with the client, four at each board size, 33,760
words total, spanning architecture decisions, security architecture, data
policy, API design, payments, accessibility, and incident review. Each
carries a review package already produced by the real platform, so a board
can be read in full — consensus and dissent both — with no account and no
wait.

## Challenges we faced

Turnstile runs on the review endpoint when configured, and it is currently
unset in production for one specific reason: an agent cannot solve a
CAPTCHA. Turning it on would break every agent-driven submission with an
unexplained "verification failed." Leaving it off keeps the agent path
working — a tradeoff, not a solved problem.

Cookies were the other authentication fight. The session cookie is
httpOnly, SameSite=Lax, and host-only, which is not something to depend on
inside an embedded browser like ChatGPT's, where third-party cookie handling
is not guaranteed. The client authenticates with a bearer token instead.
Getting there meant consolidating five hand-rolled session lookups scattered
across the codebase into a single resolver — four of which had only ever
accepted a cookie and would otherwise have quietly rejected a token.

Latency turned out to be a design constraint, not an implementation detail.
A seven-seat board is seven independent reviews plus a synthesis pass, not
one larger prompt — so it takes minutes, not seconds. That is why the sample
artifacts ship with their review packages already captured: exploring a
board has to be instant even though generating one is not.

And honesty had to be made mechanical, not promised. The README states that
every sample carries a genuine platform review, nothing staged. A release
check enforces that directly: the build fails if any sample is missing a
real review package, or if a package's reviewer count contradicts what the
catalog advertises for that board size.
