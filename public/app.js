/**
 * Page wiring for the Suggestibility.ai WebMCP showcase.
 *
 * Copyright 2026 All Aligned Consulting LLC. Apache-2.0.
 *
 * The human UI and the agent tool surface render from the SAME state, so what
 * a judge sees on screen is what the agent just did. A demo where the agent
 * narrates one thing while the page shows another is worse than no demo.
 *
 * Everything below builds DOM with createElement/textContent rather than
 * innerHTML. Today the sample data is static JSON in this repo, but it is the
 * exact surface that later gets pointed at an API response, and a manual
 * escape helper only holds until someone adds one interpolation that skips it.
 */
import { registerTools, setSessionToken } from "/webmcp-tools.js";

const API_BASE =
  window.SUGGESTIBILITY_API_BASE ?? "https://api.suggestibility.ai";

const $ = (id) => document.getElementById(id);

/** el("span", {class: "x"}, "text") — text is always set via textContent. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) {
    if (child == null) continue;
    node.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return node;
}

// ---------------------------------------------------------------- samples

async function loadSamples() {
  const grid = $("samples");
  try {
    const { samples } = await fetch("/samples/index.json").then((r) =>
      r.json(),
    );
    grid.replaceChildren();
    for (const s of samples) {
      const card = el(
        "button",
        { class: "card", type: "button" },
        el(
          "div",
          { class: "meta" },
          el("span", { class: "seats" }, `${s.panel_size} reviewers`),
          el("span", {}, String(s.domain ?? "")),
          el("span", {}, `${Number(s.word_count ?? 0).toLocaleString()} words`),
        ),
        el("h3", {}, String(s.title ?? "Untitled")),
        el("p", {}, String(s.summary ?? "")),
      );
      card.addEventListener("click", () => showSample(s.id));
      grid.append(card);
    }
  } catch {
    grid.replaceChildren(
      el(
        "p",
        { style: "color:var(--secondary)" },
        "Samples could not be loaded.",
      ),
    );
  }
}

/** Pull the first line of text out of a package section, whatever its shape. */
function firstText(items, keys) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const item = items[0];
  if (typeof item === "string") return item;
  for (const k of keys) if (typeof item?.[k] === "string") return item[k];
  return null;
}

function renderPackage(title, pkg) {
  $("viewer").classList.remove("hidden");
  $("viewer-title").textContent = title;

  if (!pkg) {
    $("v-consensus").textContent =
      "This sample has not been run through the board yet.";
    $("v-dissent").textContent = "—";
    $("v-recs").textContent = "—";
    return;
  }

  const panel = pkg.expertPanel ?? {};
  $("v-consensus").textContent =
    firstText(panel.consensus, ["statement", "text", "summary", "position"]) ??
    "No consensus recorded.";
  // "No dissent" is a real finding, not an empty state — the board converging
  // is information, and blanking the column would hide it.
  $("v-dissent").textContent =
    firstText(panel.dissent, ["position", "statement", "text", "summary"]) ??
    "The board recorded no dissent — the reviewers converged.";
  $("v-recs").textContent =
    firstText(pkg.recommendations, ["text", "title", "summary", "action"]) ??
    "No recommendations recorded.";

  $("viewer").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function showSample(id) {
  const data = await fetch(`/samples/${encodeURIComponent(id)}.json`).then(
    (r) => r.json(),
  );
  renderPackage(data.title, data.review);
  return data;
}

// ---------------------------------------------------------------- token

async function redeemToken() {
  const code = $("token").value.trim();
  const msg = $("redeem-msg");
  if (!code) {
    msg.textContent = "Enter the demo token from the submission notes.";
    return;
  }
  msg.textContent = "Redeeming…";
  try {
    const res = await fetch(`${API_BASE}/api/trials/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) {
      // 401 is the common case and the least self-explanatory: a token grants
      // review credits to an account, so there has to be an account first.
      msg.textContent =
        res.status === 401
          ? "Sign in first — a demo token grants review credits to an account."
          : (data.error ?? "That token could not be redeemed.");
      return;
    }
    msg.textContent = `Token accepted — a ${data.tier} board is available on this account for ${data.days} days.`;
  } catch {
    msg.textContent = "Network error while redeeming. Try again.";
  }
}

// ---------------------------------------------------------------- WebMCP

function reportMcpStatus(ok) {
  const el_ = $("mcp-status");
  el_.className = ok ? "pill" : "pill warn";
  el_.replaceChildren(
    el("span", { class: "dot" }),
    document.createTextNode(
      ok ? "WebMCP tools registered" : "No WebMCP — open in an agent browser",
    ),
  );
}

const registered = registerTools({
  onArtifactLoaded: (data) => renderPackage(data.title, data.review),
  onReviewUpdate: (data) => {
    if (data?.package) renderPackage("Live review", data.package);
  },
});
reportMcpStatus(registered);

// A token in the URL lets a judge land on a working page from the submission
// notes without typing anything. Stripped from the address bar immediately so
// it does not survive in history or get shared in a screenshot.
const urlToken = new URL(location.href).searchParams.get("token");
if (urlToken) {
  $("token").value = urlToken;
  history.replaceState({}, "", location.pathname);
}

$("redeem").addEventListener("click", redeemToken);
$("token").addEventListener("keydown", (e) => {
  if (e.key === "Enter") redeemToken();
});

loadSamples();

export { setSessionToken };
