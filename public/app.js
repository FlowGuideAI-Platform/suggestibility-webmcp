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
  window.SUGGESTIBILITY_API_BASE ?? "https://my.suggestibility.ai";

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
    // Say what is true and what to do about it. The first version of this
    // rendered three empty columns and nothing else, which read as a broken
    // page rather than as "no board has run yet" — the artifact was right
    // there in the bundle and never shown.
    $("v-consensus").textContent =
      "No board has run against this artifact yet. The document itself is above — copy or download it, or run a live review below.";
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

/** The artifact currently on screen, so copy/download act on what is shown. */
let current = null;

/**
 * Show a sample: the artifact FIRST, then whatever the board returned.
 *
 * The artifact is the point. Someone evaluating this needs to read what the
 * board was asked to review before any verdict means anything — and needs to
 * be able to take it away, paste it into the review form, or hand it to their
 * agent. Rendering only the package left twelve samples that opened onto
 * nothing.
 */
function renderSample(data) {
  current = data;
  $("viewer").classList.remove("hidden");
  $("viewer-title").textContent = data.title;

  $("v-meta").replaceChildren(
    el("span", { class: "seats" }, `${data.panel_size} reviewers`),
    el("span", {}, String(data.domain ?? "")),
    el("span", {}, `${Number(data.word_count ?? 0).toLocaleString()} words`),
    el(
      "span",
      {},
      `${Number(data.char_count ?? 0).toLocaleString()} characters`,
    ),
  );
  $("v-artifact").textContent = data.artifact ?? "";
  $("copy-msg").textContent = "";
  $("v-review-heading").textContent = data.review
    ? "Review package"
    : "Review package — not yet run";

  renderPackage(data.title, data.review);
}

async function showSample(id) {
  const data = await fetch(`/samples/${encodeURIComponent(id)}.json`).then(
    (r) => r.json(),
  );
  renderSample(data);
  return data;
}

async function copyArtifact() {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(current.artifact);
    $("copy-msg").textContent = "Copied";
  } catch {
    // Clipboard access is blocked in plenty of embedded browsers, which is
    // exactly where this page is meant to run. Fall back to selecting the
    // text so the copy is still one keystroke away rather than impossible.
    const range = document.createRange();
    range.selectNodeContents($("v-artifact"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    $("copy-msg").textContent = "Selected — press Cmd/Ctrl+C";
  }
}

function downloadArtifact() {
  if (!current) return;
  const blob = new Blob([current.artifact], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `${current.id}.md` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  $("copy-msg").textContent = `Downloaded ${current.id}.md`;
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

/**
 * Report what actually happened, not what was attempted.
 *
 * Three distinct states, because they need three different responses from
 * whoever is looking: the browser has no WebMCP (enable the flag, or use an
 * agent browser), registration threw (a bug worth reporting), or the tools are
 * genuinely live. Collapsing the middle case into either neighbour is how a
 * broken integration gets demoed as a working one.
 */
function reportMcpStatus(status) {
  const el_ = $("mcp-status");
  const ok = status?.ok === true;
  el_.className = ok ? "pill" : "pill warn";
  const label = ok
    ? `${status.count} WebMCP tools registered`
    : status?.reason === "error"
      ? `WebMCP registration failed (${status.failed})`
      : "No WebMCP — open in an agent browser";
  el_.replaceChildren(
    el("span", { class: "dot" }),
    document.createTextNode(label),
  );
  el_.title = ok
    ? "This page exposed its tools to the browsing agent."
    : "Chrome 149+: enable chrome://flags/#enable-webmcp-testing, or open in ChatGPT's in-app browser.";
}

const registered = registerTools({
  // When the agent loads a sample, the human sees the same artifact the agent
  // is holding — same state, one screen, no divergence between what is
  // narrated and what is shown.
  onArtifactLoaded: (data) => renderSample(data),
  onReviewUpdate: (data) => {
    if (data?.package) renderPackage("Live review", data.package);
  },
});
// registerTools is async now — the status must reflect settled registrations.
registered.then(reportMcpStatus).catch((e) => {
  console.error("[suggestibility] WebMCP registration threw", e);
  reportMcpStatus({ ok: false, reason: "error", failed: "?" });
});

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
$("copy-artifact").addEventListener("click", copyArtifact);
$("download-artifact").addEventListener("click", downloadArtifact);

loadSamples();

export { setSessionToken };
