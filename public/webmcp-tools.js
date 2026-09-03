/**
 * WebMCP tool surface for the Suggestibility.ai AI Expert Review Board.
 *
 * Copyright 2026 All Aligned Consulting LLC. Licensed under Apache-2.0.
 * See LICENSE and NOTICE in the repository root.
 *
 * WHAT THIS IS
 * ------------
 * A browsing agent (ChatGPT's in-app browser, or Chrome with WebMCP enabled)
 * discovers these tools from the page and calls them directly. The page is the
 * tool provider; the agent is the consumer. Nothing here runs inside the agent.
 *
 * THE DESIGN CONSTRAINT WORTH UNDERSTANDING
 * -----------------------------------------
 * A review board's size (3, 5, or 7 independent reviewers) is a property of
 * what the customer PURCHASED, resolved server-side from the plan attached to
 * their credit. It is not a parameter a client can pass. That is deliberate:
 * a client that could ask for seven reviewers could claim reviewers nobody
 * paid for.
 *
 * So `recommend_board_size` is strictly ADVISORY. The agent reads the artifact,
 * argues for a board size, and presents the trade-off — then the human decides
 * what they are willing to pay for. The agent advises; the purchase decides.
 * This split is the point of the integration, not a limitation of it.
 */

const API_BASE =
  window.SUGGESTIBILITY_API_BASE ?? "https://my.suggestibility.ai";

/** Minimum artifact length the platform accepts. Mirrors the server rule so the
 *  agent gets a useful refusal instead of a 400 it has to interpret. */
const MIN_ARTIFACT_CHARS = 200;

/** Bearer token for the current demo/authenticated session, held in memory.
 *  Deliberately NOT a cookie: ChatGPT's in-app browser is unreliable with
 *  cookies in embedded contexts, and a review submitted from an agent must not
 *  depend on third-party cookie policy to work. */
let sessionToken = null;

export function setSessionToken(token) {
  sessionToken = token;
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.body) headers["content-type"] = "application/json";
  if (sessionToken) headers["authorization"] = `Bearer ${sessionToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // A non-JSON body means an edge error page, not an API response. Say so
    // rather than surfacing raw HTML into the agent's context.
    throw new Error(`API returned a non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok) {
    // An agent cannot act on "sign in required" — this page has no sign-in of
    // its own, and redeeming a token needs auth too, so an unauthenticated
    // agent has no way out from inside the conversation. Say what would fix
    // it instead, in terms the agent can relay to the person reading.
    if (res.status === 401) {
      throw new Error(
        "Not signed in. This page must be opened with the pre-authenticated link " +
          "from the submission notes (app.suggestibility.ai/?session=...), which " +
          "carries review credits. Sample artifacts and board-size recommendations " +
          "work without it; submitting a review does not.",
      );
    }
    if (res.status === 402) {
      throw new Error(
        "No review credits remain on this account. Sample artifacts and " +
          "recommendations are still available without credits.",
      );
    }
    throw new Error(data.error ?? `request failed (HTTP ${res.status})`);
  }
  return data;
}

/**
 * Heuristic board-size advice.
 *
 * This runs in the page rather than calling the platform because it is a
 * RECOMMENDATION, not a review — it must stay free, instant, and available
 * before anyone has paid for anything. The real classification that picks
 * actual reviewers happens server-side once an artifact is submitted.
 */
function adviseBoardSize(content, stakes) {
  const chars = content.length;
  const signals = [];
  let score = 0;

  if (chars > 12000) {
    score += 2;
    signals.push(
      "long artifact (>12k chars) — more surface for reviewers to disagree about",
    );
  } else if (chars > 4000) {
    score += 1;
    signals.push("substantial artifact (>4k chars)");
  } else {
    signals.push("short artifact — a focused panel can cover it");
  }

  if (stakes === "high") {
    score += 2;
    signals.push(
      "caller flagged the decision as high-stakes or hard to reverse",
    );
  } else if (stakes === "medium") {
    score += 1;
    signals.push("caller flagged moderate stakes");
  }

  // Irreversibility and blast radius are what actually justify a wider board:
  // more independent perspectives buy you dissent you would otherwise not hear.
  const irreversible =
    /\b(migrat|irreversible|one-way door|security|compliance|privacy|architecture decision|ADR|breaking change|data loss|production)\b/i;
  if (irreversible.test(content)) {
    score += 2;
    signals.push(
      "mentions irreversible, security, or compliance-sensitive work",
    );
  }

  const size = score >= 4 ? 7 : score >= 2 ? 5 : 3;
  return { size, score, signals };
}

const PANEL_OPTIONS = [
  {
    panel_size: 3,
    plan_key: "one_time_quick",
    display_name: "Single Review",
    price_usd: 15,
    tagline: "A fast second opinion from three AI experts.",
  },
  {
    panel_size: 5,
    plan_key: "one_time_full",
    display_name: "Deep Review",
    price_usd: 29,
    tagline:
      "A broader review from five independent expert perspectives. Best for important decisions.",
  },
  {
    panel_size: 7,
    plan_key: "one_time_board",
    display_name: "Full Board Review of 7",
    price_usd: 69,
    tagline:
      "A full seven-perspective board for the decisions that matter most.",
  },
];

/**
 * Register every tool with the page's model context.
 *
 * Guarded because the page must still work for a human in a browser with no
 * WebMCP support — the agent surface is additive, never load-bearing for the UI.
 */
export async function registerTools({ onArtifactLoaded, onReviewUpdate } = {}) {
  // Per the WebMCP IDL the entry point is document.modelContext, not
  // navigator.modelContext. In Chrome it exists only behind
  // chrome://flags/#enable-webmcp-testing (Chrome 149+), so its absence in a
  // normal browser is the ordinary case, not a fault.
  if (!("modelContext" in document)) {
    console.info(
      "[suggestibility] WebMCP unavailable — human UI only. In Chrome 149+, enable chrome://flags/#enable-webmcp-testing.",
    );
    return { ok: false, reason: "unsupported", count: 0 };
  }

  // registerTool returns a Promise. Firing eight and reporting success
  // synchronously would make the status indicator a claim rather than an
  // observation, and a rejected registration would surface only as an
  // unhandled rejection in a console nobody reads during judging.
  // `attempted` is tracked separately from `pending` on purpose. The IDL says
  // registerTool returns a Promise, but an implementation that returns
  // undefined is entirely possible — and then a promise-only counter reports
  // "0 tools registered" for eight tools that registered perfectly well.
  // Counting attempts and subtracting real failures is right under both
  // behaviours.
  let attempted = 0;
  const pending = [];
  const register = (tool) => {
    attempted++;
    try {
      const p = document.modelContext.registerTool(tool);
      if (p && typeof p.then === "function") pending.push(p);
    } catch (e) {
      pending.push(Promise.reject(e));
    }
  };

  register({
    name: "list_review_options",
    description:
      "List the review board sizes available for purchase, with prices. Call this before recommending a board size so the recommendation is grounded in what the customer can actually buy.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              options: PANEL_OPTIONS,
              note: "Board size is set by what is purchased. A recommendation does not change the size delivered.",
            },
            null,
            2,
          ),
        },
      ],
    }),
  });

  register({
    name: "recommend_board_size",
    description:
      "Analyse an artifact and recommend how many independent reviewers (3, 5, or 7) it warrants, with reasoning. ADVISORY ONLY — this does not purchase or change the delivered panel. Present the trade-off and let the human choose what to pay for.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The full artifact text to assess.",
        },
        stakes: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "How consequential or hard to reverse this decision is, if the user has said.",
        },
      },
      required: ["content"],
    },
    execute: async ({ content, stakes }) => {
      const advice = adviseBoardSize(content ?? "", stakes);
      const option = PANEL_OPTIONS.find((o) => o.panel_size === advice.size);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                recommended_panel_size: advice.size,
                recommended_option: option,
                reasoning: advice.signals,
                all_options: PANEL_OPTIONS,
                advisory_note:
                  "This is a recommendation. The panel actually convened is determined by the purchased plan, server-side. Ask the user which size they want to pay for.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  });

  register({
    name: "submit_artifact_for_review",
    description:
      "Submit a technical artifact to the Suggestibility expert review board. Returns a review_id. The number of reviewers convened is determined by the purchased plan, not by this call. Reviews are asynchronous — poll get_review_status.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the artifact." },
        content: {
          type: "string",
          description: `The full artifact text (minimum ${MIN_ARTIFACT_CHARS} characters).`,
        },
        type: {
          type: "string",
          description:
            "Optional artifact type hint, e.g. 'architecture decision', 'policy', 'design doc'.",
        },
      },
      required: ["content"],
    },
    execute: async ({ title, content, type }) => {
      if (!content || content.length < MIN_ARTIFACT_CHARS) {
        return {
          content: [
            {
              type: "text",
              text: `Artifact is too short. The board needs at least ${MIN_ARTIFACT_CHARS} characters to produce a review worth reading; received ${content?.length ?? 0}.`,
            },
          ],
          isError: true,
        };
      }
      const result = await api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          title: title ?? "Untitled",
          content,
          type,
        }),
      });
      onReviewUpdate?.({ status: "queued", review_id: result.review_id });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...result,
                next_step:
                  "Poll get_review_status with this review_id. A board of 5-7 reviewers typically takes longer than a board of 3.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  });

  register({
    name: "get_review_status",
    description:
      "Check whether a submitted review has finished. Returns status and, once complete, the panel that was convened.",
    inputSchema: {
      type: "object",
      properties: { review_id: { type: "string" } },
      required: ["review_id"],
    },
    execute: async ({ review_id }) => {
      const data = await api(`/api/reviews/${encodeURIComponent(review_id)}`);
      onReviewUpdate?.(data);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  });

  register({
    name: "get_review_package",
    description:
      "Fetch the completed review package: the consensus position, the preserved dissent, prioritised recommendations, and which model produced each finding.",
    inputSchema: {
      type: "object",
      properties: { review_id: { type: "string" } },
      required: ["review_id"],
    },
    execute: async ({ review_id }) => {
      const data = await api(`/api/reviews/${encodeURIComponent(review_id)}`);
      onReviewUpdate?.(data);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  });

  register({
    name: "list_sample_artifacts",
    description:
      "List the sample artifacts bundled with this page, spanning different domains and board sizes. These are documents to review, not pre-computed results &mdash; submit one to see what the board produces.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const data = await fetch("/samples/index.json").then((r) => r.json());
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  });

  register({
    name: "load_sample_artifact",
    description:
      "Load a sample artifact by id, plus any review already run against it in this session. Renders it into the page so the human reads what you are holding.",
    inputSchema: {
      type: "object",
      properties: {
        sample_id: {
          type: "string",
          description: "id from list_sample_artifacts",
        },
      },
      required: ["sample_id"],
    },
    execute: async ({ sample_id }) => {
      const data = await fetch(
        `/samples/${encodeURIComponent(sample_id)}.json`,
      ).then((r) => {
        if (!r.ok) throw new Error(`no sample named "${sample_id}"`);
        return r.json();
      });
      onArtifactLoaded?.(data);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  });

  register({
    name: "explore_dissent",
    description:
      "Extract only the minority positions from a review package — the findings the board did NOT agree on. This is the part most review tools smooth away; use it when the human asks what the reviewers disagreed about.",
    inputSchema: {
      type: "object",
      properties: { review_id: { type: "string" } },
      required: ["review_id"],
    },
    execute: async ({ review_id }) => {
      const data = await api(`/api/reviews/${encodeURIComponent(review_id)}`);
      // ReviewPackageV1: the review row wraps the package under `package`, and
      // dissent is a first-class member of expertPanel alongside consensus —
      // not a field on a synthesis blob. Reading the wrong path here would
      // silently report "no dissent" on every review, which is the single most
      // misleading thing this product could say.
      const dissent = data?.package?.synthesis?.structured?.dissent ?? null;
      if (!dissent || (Array.isArray(dissent) && dissent.length === 0)) {
        return {
          content: [
            {
              type: "text",
              text: "The board recorded no dissent on this artifact — the reviewers converged. That is itself a finding worth reporting.",
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ dissent }, null, 2) }],
      };
    },
  });

  const results = await Promise.allSettled(pending);
  const failed = results.filter((r) => r.status === "rejected");
  const count = attempted - failed.length;

  if (failed.length) {
    console.error(
      `[suggestibility] ${failed.length} of ${results.length} WebMCP tools failed to register:`,
      failed.map((f) => String(f.reason)),
    );
    return { ok: false, reason: "error", count, failed: failed.length };
  }
  console.info(`[suggestibility] ${count} WebMCP tools registered.`);
  return { ok: true, reason: "registered", count };
}
