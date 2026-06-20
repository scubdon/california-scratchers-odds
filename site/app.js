/* California Scratchers odds — front-end. Pure vanilla, no build step. */

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));
const money = (n) => (n == null ? "—" : "$" + n.toLocaleString("en-US"));
const oddsText = (n) => (n == null ? "—" : "1 in " + n.toLocaleString("en-US"));
/* compact odds for the quick-glance strip: 1 in 12K / 1 in 3.7M */
const oddsShort = (n) => {
  if (n == null) return "—";
  if (n >= 1e6) return "1 in " + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e4) return "1 in " + Math.round(n / 1e3) + "K";
  return "1 in " + n.toLocaleString("en-US");
};

/* combined live odds of winning a prize of at least `threshold` dollars, as the N
   in "1 in N". Probabilities of each qualifying tier add; null if no tier qualifies. */
function oddsAtLeast(g, threshold) {
  const p = (g.prizes || []).reduce(
    (sum, pr) => (pr.prize >= threshold && pr.odds_one_in ? sum + 1 / pr.odds_one_in : sum),
    0
  );
  return p > 0 ? Math.round(1 / p) : null;
}

/* tiers shown before the "show all" fold kicks in */
const TIERS_VISIBLE = 5;

const state = { all: [], price: "all", search: "", sort: "over100-asc" };

const $ = (sel) => document.querySelector(sel);

init();

async function init() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    state.all = data.games || [];
    hydrateChrome(data);
    buildControls();
    render();
    wireControls();
  } catch (err) {
    $("#status").textContent =
      "Could not load Scratchers data (" + err.message + "). The data file may not have been generated yet.";
  }
}

/* ---- header, takeaways, sources ---- */
function hydrateChrome(data) {
  if (data.generated_at) {
    const d = new Date(data.generated_at);
    $("#updated").textContent =
      "Data refreshed " + d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }
  if (data.source) {
    $("#src-scratchers").href = data.source.scratchers;
  }

  const withTop = state.all.map((g) => ({ g, top: topPrize(g) })).filter((x) => x.top && x.top.odds_one_in);
  if (!withTop.length) return;
  const longest = withTop.reduce((a, b) => (b.top.odds_one_in > a.top.odds_one_in ? b : a));
  const shortest = withTop.reduce((a, b) => (b.top.odds_one_in < a.top.odds_one_in ? b : a));

  $("#stat-games").textContent = withTop.length;
  $("#stat-longest").textContent = oddsText(longest.top.odds_one_in);
  $("#stat-longest-label").innerHTML = "longest top-prize odds<br>(" + esc(longest.g.name) + ", " + money(longest.top.prize) + ")";
  $("#stat-best").textContent = oddsText(shortest.top.odds_one_in);
  $("#stat-best-label").innerHTML = "shortest top-prize odds<br>(" + esc(shortest.g.name) + ", " + money(shortest.top.prize) + ")";
  $("#takeaways").hidden = false;
}

/* the headline prize for a game = the highest dollar level that still has tickets/odds */
function topPrize(g) {
  const withOdds = (g.prizes || []).filter((p) => p.odds_one_in);
  return withOdds.length ? withOdds.reduce((a, b) => (b.prize > a.prize ? b : a)) : (g.prizes || [])[0];
}

/* ---- controls ---- */
function buildControls() {
  const prices = [...new Set(state.all.map((g) => g.price))].sort((a, b) => a - b);
  const chips = ['<button class="chip" data-price="all" aria-pressed="true">All</button>']
    .concat(prices.map((p) => `<button class="chip" data-price="${p}" aria-pressed="false">$${p}</button>`));
  $("#price-chips").innerHTML = chips.join("");
  $("#controls").hidden = false;
}

function wireControls() {
  $("#price-chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    state.price = b.dataset.price;
    document.querySelectorAll("#price-chips .chip").forEach((c) =>
      c.setAttribute("aria-pressed", String(c === b)));
    render();
  });
  $("#search").addEventListener("input", (e) => { state.search = e.target.value.toLowerCase().trim(); render(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
}

/* ---- render cards ---- */
function render() {
  let games = state.all.slice();
  if (state.price !== "all") games = games.filter((g) => String(g.price) === state.price);
  if (state.search) {
    games = games.filter((g) =>
      (g.name || "").toLowerCase().includes(state.search) ||
      String(g.game_number).includes(state.search));
  }
  const top = (g) => (topPrize(g) || {}).odds_one_in || 0;
  /* best (shortest) odds of winning >= threshold first; games with no such tier last */
  const byOver = (t) => (a, b) => {
    const oa = oddsAtLeast(a, t), ob = oddsAtLeast(b, t);
    if (oa == null) return ob == null ? 0 : 1;
    if (ob == null) return -1;
    return oa - ob;
  };
  const sorters = {
    "over100-asc": byOver(100),
    "over500-asc": byOver(500),
    "over1000-asc": byOver(1000),
    "odds-desc": (a, b) => top(b) - top(a),
    "odds-asc": (a, b) => top(a) - top(b),
    "price-desc": (a, b) => b.price - a.price || top(b) - top(a),
    "price-asc": (a, b) => a.price - b.price || top(b) - top(a),
    "unsold-desc": (a, b) => (b.percent_unsold || 0) - (a.percent_unsold || 0),
  };
  games.sort(sorters[state.sort]);

  const status = $("#status");
  status.textContent = games.length
    ? `Showing ${games.length} game${games.length === 1 ? "" : "s"}.`
    : "No games match those filters.";

  const tpl = $("#card-tpl");
  const frag = document.createDocumentFragment();
  games.forEach((g, i) => frag.appendChild(buildCard(tpl, g, i)));
  $("#cards").replaceChildren(frag);
}

function buildCard(tpl, g, i) {
  const node = tpl.content.cloneNode(true);
  const card = node.querySelector(".card");
  card.style.animationDelay = Math.min(i, 10) * 35 + "ms";

  const img = node.querySelector(".thumb");
  const frame = node.querySelector(".ticket-frame");
  if (g.image_url) {
    img.alt = g.name + " scratch ticket";
    // hotlinked calottery images occasionally fail; drop the frame rather than
    // leaving a broken-image icon behind
    img.addEventListener("error", () => frame.remove(), { once: true });
    img.src = g.image_url;
  } else {
    frame.remove();
  }
  node.querySelector(".price-tag").textContent = "$" + g.price;
  node.querySelector(".card-name").textContent = g.name;
  node.querySelector(".card-no").textContent = "Game No. " + g.game_number;
  node.querySelector(".m-left").textContent = fmt(g.tickets_remaining);
  node.querySelector(".m-unsold").textContent = g.percent_unsold != null ? g.percent_unsold + "%" : "—";
  node.querySelector(".m-overall").textContent = g.overall_odds ? "1 in " + g.overall_odds : "—";

  [100, 500, 1000].forEach((t) => {
    const n = oddsAtLeast(g, t);
    const dd = node.querySelector(".o-" + t);
    dd.textContent = oddsShort(n);
    if (n != null) dd.title = oddsText(n);
  });

  const list = node.querySelector(".tiers");
  const topP = topPrize(g);
  const prizes = g.prizes || [];
  prizes.forEach((p, idx) => {
    const li = document.createElement("li");
    li.className = "tier";
    if (p === topP) li.classList.add("top");
    if (p.remaining === 0) li.classList.add("gone");
    if (idx >= TIERS_VISIBLE && prizes.length > TIERS_VISIBLE + 2) li.classList.add("extra");

    const shortOdds = p.odds_one_in && p.odds_one_in <= g.price * 5; // "win back ~5x stake" territory
    const oddsCell = p.remaining === 0
      ? '<span class="t-odds gone-txt">all claimed</span>'
      : `<span class="t-odds${shortOdds ? " short" : ""}">${oddsText(p.odds_one_in)}</span>`;

    li.innerHTML =
      `<div class="tier-line">` +
        `<span class="t-prize">${money(p.prize)}</span>` +
        `<i class="lead" aria-hidden="true"></i>` +
        oddsCell +
      `</div>` +
      `<div class="tier-sub">` +
        `<span>${fmt(p.remaining)} of ${fmt(p.total)} unclaimed</span>` +
        `<span>printed ${oddsText(p.odds_printed)}</span>` +
      `</div>`;
    list.appendChild(li);
  });

  const hiddenCount = list.querySelectorAll(".extra").length;
  const more = node.querySelector(".more");
  if (hiddenCount > 0) {
    more.hidden = false;
    more.textContent = `Show all ${prizes.length} prize tiers ▾`;
    more.addEventListener("click", () => {
      const open = list.classList.toggle("open");
      more.textContent = open ? "Show fewer ▴" : `Show all ${prizes.length} prize tiers ▾`;
    });
  }

  const link = node.querySelector(".card-link");
  if (g.article_url) link.href = g.article_url; else link.remove();
  return node;
}

/* ---- helpers ---- */
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
