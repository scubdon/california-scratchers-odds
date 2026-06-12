/* California Scratchers odds — front-end. Pure vanilla, no build step. */

const PRICE_COLORS = {
  1: "#8c8170", 2: "#2e6e4e", 3: "#0f7287", 5: "#2a5e8c",
  10: "#5b4a9b", 20: "#b08515", 25: "#c4651a", 30: "#c8102e", 40: "#7c1f3f",
};
const colorFor = (p) => PRICE_COLORS[p] || "#8c8170";

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));
const money = (n) => (n == null ? "—" : "$" + n.toLocaleString("en-US"));
const oddsText = (n) => (n == null ? "—" : "1 in " + n.toLocaleString("en-US"));

/* tiers shown before the "show all" fold kicks in */
const TIERS_VISIBLE = 5;

const state = { all: [], price: "all", search: "", sort: "odds-desc" };

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

  /* unhide before drawing so the chart can measure its container */
  $("#landscape").hidden = false;
  drawChart(withTop);
}

/* the headline prize for a game = the highest dollar level that still has tickets/odds */
function topPrize(g) {
  const withOdds = (g.prizes || []).filter((p) => p.odds_one_in);
  return withOdds.length ? withOdds.reduce((a, b) => (b.prize > a.prize ? b : a)) : (g.prizes || [])[0];
}

/* ---- log-scale odds landscape (responsive: redrawn to fit the viewport) ---- */
let chartPoints = null;
let resizeTimer = null;

function drawChart(points) {
  chartPoints = points;
  renderChart();

  const prices = [...new Set(points.map((p) => p.g.price))].sort((a, b) => a - b);
  $("#chart-legend").innerHTML = prices
    .map((p) => `<span><i style="background:${colorFor(p)}"></i>$${p} games</span>`)
    .join("");

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderChart, 120);
  });
}

function renderChart() {
  if (!chartPoints) return;
  const host = $("#chart");
  const W = Math.max(300, Math.round(host.getBoundingClientRect().width) || 960);
  const narrow = W < 520;
  const H = narrow ? 160 : 190;
  const padL = 10, padR = 10, padT = 26, padB = 40;
  const dotR = narrow ? 5 : 6.5;
  const slotW = narrow ? 11 : 14;

  const odds = chartPoints.map((p) => p.top.odds_one_in);
  const minE = Math.floor(Math.log10(Math.min(...odds)));
  const maxE = Math.ceil(Math.log10(Math.max(...odds)));
  const x = (v) => padL + ((Math.log10(v) - minE) / (maxE - minE)) * (W - padL - padR);

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Top-prize odds for each game on a logarithmic scale");

  const baseY = H - padB;
  const axis = document.createElementNS(NS, "line");
  axis.setAttribute("class", "axis-line");
  axis.setAttribute("x1", padL); axis.setAttribute("x2", W - padR);
  axis.setAttribute("y1", baseY); axis.setAttribute("y2", baseY);
  svg.appendChild(axis);

  /* on narrow screens with many decades, label every other tick */
  const labelStep = narrow && maxE - minE > 4 ? 2 : 1;
  for (let e = minE; e <= maxE; e++) {
    const gx = x(Math.pow(10, e));
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "tick");
    const grid = document.createElementNS(NS, "line");
    grid.setAttribute("class", "grid");
    grid.setAttribute("x1", gx); grid.setAttribute("x2", gx);
    grid.setAttribute("y1", padT); grid.setAttribute("y2", baseY);
    g.appendChild(grid);
    if ((e - minE) % labelStep === 0) {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", gx); t.setAttribute("y", baseY + 22);
      t.setAttribute("text-anchor", e === minE ? "start" : e === maxE ? "end" : "middle");
      t.textContent = "1 in " + shortNum(Math.pow(10, e));
      g.appendChild(t);
    }
    svg.appendChild(g);
  }

  // beeswarm-ish vertical jitter so dots don't fully overlap
  const slots = {};
  const bandH = baseY - padT - 12;
  chartPoints
    .slice()
    .sort((a, b) => a.top.odds_one_in - b.top.odds_one_in)
    .forEach((p) => {
      const px = Math.round(x(p.top.odds_one_in));
      const key = Math.round(px / slotW);
      const n = (slots[key] = (slots[key] || 0) + 1);
      const py = baseY - 10 - ((n - 1) % 8) * (bandH / 9);

      const c = document.createElementNS(NS, "circle");
      c.setAttribute("class", "dot");
      c.setAttribute("cx", px); c.setAttribute("cy", py); c.setAttribute("r", dotR);
      c.setAttribute("fill", colorFor(p.g.price));
      c.setAttribute("opacity", ".82");
      c.dataset.tip =
        `<b>${esc(p.g.name)}</b> ($${p.g.price})<br>${money(p.top.prize)} top prize<br>` +
        `<b>${oddsText(p.top.odds_one_in)}</b> per ticket`;
      svg.appendChild(c);
    });

  $("#chart").replaceChildren(svg);
  wireTip(svg);
}

function wireTip(svg) {
  let tip = document.querySelector(".chart-tip");
  if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; document.body.appendChild(tip); }
  const show = (e) => {
    const t = e.target.closest(".dot"); if (!t) return;
    tip.innerHTML = t.dataset.tip; tip.style.opacity = "1";
    const px = (e.touches ? e.touches[0].clientX : e.clientX);
    const py = (e.touches ? e.touches[0].clientY : e.clientY);
    tip.style.left = Math.min(px + 14, window.innerWidth - 250) + "px";
    tip.style.top = (py + 16) + "px";
  };
  const hide = () => { tip.style.opacity = "0"; };
  svg.addEventListener("mousemove", show);
  svg.addEventListener("mouseleave", hide);
  svg.addEventListener("touchstart", show, { passive: true });
  svg.addEventListener("touchend", hide);
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
  const sorters = {
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
  if (g.image_url) { img.src = g.image_url; img.alt = g.name + " scratch ticket"; }
  else { img.remove(); }
  node.querySelector(".price-tag").textContent = "$" + g.price;
  node.querySelector(".card-name").textContent = g.name;
  node.querySelector(".card-no").textContent = "Game No. " + g.game_number;
  node.querySelector(".m-left").textContent = fmt(g.tickets_remaining);
  node.querySelector(".m-unsold").textContent = g.percent_unsold != null ? g.percent_unsold + "%" : "—";
  node.querySelector(".m-overall").textContent = g.overall_odds ? "1 in " + g.overall_odds : "—";

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
function shortNum(n) {
  if (n >= 1e6) return n / 1e6 + "M";
  if (n >= 1e3) return n / 1e3 + "K";
  return String(n);
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
