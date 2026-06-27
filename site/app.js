/* California Scratchers odds — front-end. Pure vanilla, no build step. */

/* Muted single-hue slate ramp for the compare charts: price encoded by darkness. */
const PRICE_COLORS = {
  1: "#a9b2bb", 2: "#94a0ac", 3: "#7f8e9c", 5: "#6a7d8d",
  10: "#586c7e", 20: "#475b6d", 25: "#384b5c", 30: "#2b3c4b", 40: "#1f2c38",
};
const colorFor = (p) => PRICE_COLORS[p] || "#9aa0a6";

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

/* Which "worth keeping" thresholds to show on a card. Most games use the standard
   $100 / $500 / $1,000 ladder, but games that top out below $1,000 (e.g. the
   "$100 or $200" games) would just show empty $500+/$1,000+ columns — so for those
   we fall back to the game's own prize tiers. */
function oddsThresholds(g) {
  const top = topPrize(g);
  const ladder = [100, 500, 1000].filter((t) => t <= (top ? top.prize : 0));
  if (ladder.length >= 2) return ladder;
  const distinct = [...new Set((g.prizes || []).map((p) => p.prize))].sort((a, b) => a - b);
  return distinct.slice(-3);
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
    wireViews();
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
  $("#odds-key").hidden = games.length === 0;

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

  const oddsRow = node.querySelector(".odds-over");
  oddsRow.replaceChildren();
  oddsThresholds(g).forEach((t) => {
    const n = oddsAtLeast(g, t);
    const div = document.createElement("div");
    const dd = document.createElement("dd");
    dd.className = "o-" + t;
    dd.textContent = oddsShort(n);
    if (n != null) dd.title = oddsText(n);
    const dt = document.createElement("dt");
    dt.textContent = "Win " + money(t) + "+";
    div.append(dt, dd);
    oddsRow.appendChild(div);
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

    // Color the odds by how much of your stake this single prize tier returns on
    // average: (prize / odds) ÷ ticket price. Green when that share is strong
    // (>= 10%) — a prize large relative to how rare it is — maroon otherwise.
    const stakeReturn = p.odds_one_in ? (p.prize / p.odds_one_in) / g.price : 0;
    const shortOdds = stakeReturn >= 0.10;
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

/* ================================================================
   Compare view — visualizations, built once from the same data.json
   ================================================================ */

let compareBuilt = false;
const redraws = []; /* responsive charts re-run these on resize / view switch */

function wireViews() {
  document.querySelectorAll(".viewtab").forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.view)));
  window.addEventListener("hashchange", () => showView(hashView()));

  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => { if (!$("#view-compare").hidden) redraws.forEach((fn) => fn()); }, 140);
  });

  showView(hashView());
}

const hashView = () => (location.hash.replace("#", "") === "compare" ? "compare" : "games");

function showView(view) {
  const compare = view === "compare";
  $("#view-games").hidden = compare;
  $("#view-compare").hidden = !compare;
  document.querySelectorAll(".viewtab").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.view === view)));
  const want = compare ? "#compare" : "#games";
  if (location.hash !== want) history.replaceState(null, "", want);

  if (compare) {
    if (!compareBuilt) { buildCompare(); compareBuilt = true; }
    else redraws.forEach((fn) => fn()); /* remeasure now that it's visible */
  }
}

/* full-game expected value: prize money printed ÷ tickets printed, per game */
function evData() {
  return state.all
    .map((g) => {
      const tp = g.tickets_printed;
      if (!tp) return null;
      const ev = (g.prizes || []).reduce((s, p) => s + p.prize * (p.total || 0), 0) / tp;
      return { g, price: g.price, ev, pct: ev / g.price };
    })
    .filter(Boolean);
}

function buildCompare() {
  buildByPrice();
  buildReturnStrip();
  buildWhere();
  buildLadders();
  buildWorthwhile();
  buildJackpot();
}

/* ---- shared SVG helpers ---- */
const NS = "http://www.w3.org/2000/svg";
function el(name, attrs, text) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}
const pctTxt = (x) => Math.round(x * 100) + "%";
function shortNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "K";
  return String(n);
}

/* ---- shared tooltip ---- */
let tipEl = null;
function tip() {
  if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "chart-tip"; document.body.appendChild(tipEl); }
  return tipEl;
}
function showTip(html, x, y) {
  const t = tip();
  t.innerHTML = html;
  t.classList.add("show");
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.max(6, Math.min(x - w / 2, window.innerWidth - w - 6)) + "px";
  t.style.top = Math.max(6, y - h - 12) + "px";
}
function hideTip() { if (tipEl) tipEl.classList.remove("show"); }
function attachTip(node, html) {
  const move = (e) => { const p = e.touches ? e.touches[0] : e; showTip(html, p.clientX, p.clientY); };
  node.addEventListener("mouseenter", move);
  node.addEventListener("mousemove", move);
  node.addEventListener("mouseleave", hideTip);
  node.addEventListener("touchstart", (e) => { move(e); }, { passive: true });
}

/* ---- Chart A: average return per $1, by ticket price (horizontal bars) ---- */
function buildByPrice() {
  const data = evData();
  const byPrice = {};
  data.forEach((d) => { (byPrice[d.price] ||= []).push(d.pct); });
  const rows = Object.keys(byPrice)
    .map(Number)
    .sort((a, b) => a - b)
    .map((price) => {
      const arr = byPrice[price];
      return { price, pct: arr.reduce((s, x) => s + x, 0) / arr.length, n: arr.length };
    });

  const host = $("#chart-byprice");
  const draw = () => {
    const W = Math.max(300, Math.round(host.getBoundingClientRect().width) || 700);
    const padL = 46, padR = 52, padT = 8, padB = 24;
    const rowH = 30, gap = 10;
    const innerW = W - padL - padR;
    const H = padT + rows.length * (rowH + gap) - gap + padB;
    const x = (v) => padL + v * innerW; /* v is 0..1 (fraction of $1) */

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": "Average value returned per dollar, by ticket price" });

    rows.forEach((r, i) => {
      const y = padT + i * (rowH + gap);
      svg.appendChild(el("text", { x: padL - 8, y: y + rowH / 2 + 4, "text-anchor": "end",
        class: "bar-label" }, "$" + r.price));
      svg.appendChild(el("rect", { x: padL, y, width: innerW, height: rowH, rx: 2, class: "bar-track" }));
      svg.appendChild(el("rect", { x: padL, y, width: Math.max(2, r.pct * innerW), height: rowH, rx: 2,
        fill: colorFor(r.price) }));
      svg.appendChild(el("text", { x: x(r.pct) + 8, y: y + rowH / 2 + 4, class: "bar-val",
        "font-size": 13 }, pctTxt(r.pct)));
    });

    /* break-even reference at 100% */
    svg.appendChild(el("line", { x1: x(1), x2: x(1), y1: padT - 2, y2: H - padB + 2, class: "ref-line" }));
    svg.appendChild(el("text", { x: x(1), y: H - 6, "text-anchor": "end", class: "ref-label" }, "break even $1.00"));

    host.replaceChildren(svg);
  };
  redraws.push(draw); draw();

  const best = data.reduce((a, b) => (b.pct > a.pct ? b : a));
  const worst = data.reduce((a, b) => (b.pct < a.pct ? b : a));
  $("#note-byprice").innerHTML =
    `Best single game: <strong>${esc(best.g.name)}</strong> ($${best.price}) returns about ` +
    `<strong>${pctTxt(best.pct)}</strong> of what you put in. Worst: <strong>${esc(worst.g.name)}</strong> ` +
    `($${worst.price}) at <strong>${pctTxt(worst.pct)}</strong>. The house keeps the rest.`;
}

/* ---- Chart B: every game's return, as a strip plot (0–100%) ---- */
function buildReturnStrip() {
  const data = evData().sort((a, b) => a.pct - b.pct);
  const pts = data.map((d) => ({
    v: d.pct, color: colorFor(d.price),
    tip: `<b>${esc(d.g.name)}</b> · $${d.price}<br><span class="tip-sub">returns ${pctTxt(d.pct)} per $1</span>`,
  }));
  const host = $("#chart-return");
  const draw = () => stripPlot(host, pts, {
    min: 0, max: 1, log: false,
    ticks: [0, 0.25, 0.5, 0.75, 1].map((v) => ({ v, label: pctTxt(v) })),
    ref: { v: 1, label: "break even" },
    aria: "Each game's average return per dollar, from 0 to 100 percent",
  });
  redraws.push(draw); draw();
  priceLegend("#legend-return", data.map((d) => d.price));
}

/* ---- Chart D: odds of a win over a threshold, log strip plot ---- */
let worthwhileThreshold = 100;
function buildWorthwhile() {
  const host = $("#chart-worthwhile");
  const draw = () => {
    const rows = state.all
      .map((g) => ({ g, n: oddsAtLeast(g, worthwhileThreshold) }))
      .filter((r) => r.n);
    const excluded = state.all.length - rows.length;
    const pts = rows
      .sort((a, b) => a.n - b.n)
      .map((r) => ({
        v: r.n, color: colorFor(r.g.price),
        tip: `<b>${esc(r.g.name)}</b> · $${r.g.price}<br><span class="tip-sub">1 in ${fmt(r.n)} win $${worthwhileThreshold}+</span>`,
      }));
    const odds = pts.map((p) => p.v);
    const minE = Math.floor(Math.log10(Math.min(...odds)));
    const maxE = Math.ceil(Math.log10(Math.max(...odds)));
    const ticks = [];
    for (let e = minE; e <= maxE; e++) ticks.push({ v: Math.pow(10, e), label: "1 in " + shortNum(Math.pow(10, e)) });
    stripPlot(host, pts, {
      log: true, min: minE, max: maxE, ticks,
      aria: `Live odds of winning over $${worthwhileThreshold}, one dot per game, log scale`,
      note: excluded ? `${excluded} game${excluded === 1 ? " has" : "s have"} no prize tier at $${worthwhileThreshold}+ and ${excluded === 1 ? "is" : "are"} not shown.` : "",
    });
    const sorted = rows.slice().sort((a, b) => a.n - b.n);
    const list = $("#list-worthwhile");
    list.classList.remove("open");
    list.innerHTML = sorted
      .map((r, i) => `<li class="${i >= 10 ? "extra" : ""}">
        <span class="wl-rank">${i + 1}</span>
        <i class="wl-dot" style="background:${colorFor(r.g.price)}"></i>
        <span class="wl-name">${esc(r.g.name)}</span>
        <span class="wl-price">$${r.g.price}</span>
        <span class="wl-odds">1 in ${fmt(r.n)}</span>
      </li>`).join("");
    const more = $("#more-worthwhile");
    const closedLabel = `Show all ${sorted.length} games ▾`;
    if (sorted.length > 10) {
      more.hidden = false;
      more.textContent = closedLabel;
    } else {
      more.hidden = true;
    }
  };
  redraws.push(draw);

  $("#more-worthwhile").addEventListener("click", () => {
    const list = $("#list-worthwhile");
    const open = list.classList.toggle("open");
    const total = list.querySelectorAll("li").length;
    $("#more-worthwhile").textContent = open ? "Show fewer ▴" : `Show all ${total} games ▾`;
  });

  $("#seg-worthwhile").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn"); if (!b) return;
    worthwhileThreshold = Number(b.dataset.th);
    document.querySelectorAll("#seg-worthwhile .seg-btn").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b)));
    draw();
  });
  draw();
  priceLegend("#legend-worthwhile", state.all.map((g) => g.price));
}

/* ---- generic beeswarm strip plot ----
   pts: [{v, color, tip}]; opts: {log, min, max, ticks:[{v,label}], ref?, aria, note?} */
function stripPlot(host, pts, opts) {
  const W = Math.max(300, Math.round(host.getBoundingClientRect().width) || 760);
  const narrow = W < 520;
  const padL = 8, padR = 8, padT = 14, padB = 40;
  const innerW = W - padL - padR;
  const dotR = narrow ? 5 : 6;
  const step = 2 * dotR + 1;

  const pos = opts.log
    ? (v) => padL + ((Math.log10(v) - opts.min) / (opts.max - opts.min)) * innerW
    : (v) => padL + ((v - opts.min) / (opts.max - opts.min)) * innerW;

  /* assign beeswarm levels: stack dots that land in the same column */
  const slotW = 2 * dotR;
  const counts = {};
  const placed = pts.map((p) => {
    const px = pos(p.v);
    const slot = Math.round(px / slotW);
    const level = counts[slot] || 0;
    counts[slot] = level + 1;
    return { ...p, px, level };
  });
  const maxLevel = Math.max(0, ...placed.map((p) => p.level));
  const bandH = (maxLevel + 1) * step;
  const H = padT + bandH + padB;
  const baseY = padT + bandH;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.aria });

  /* gridlines + axis ticks */
  opts.ticks.forEach((t, i) => {
    const gx = pos(t.v);
    svg.appendChild(el("line", { x1: gx, x2: gx, y1: padT, y2: baseY, class: "grid" }));
    const anchor = i === 0 ? "start" : i === opts.ticks.length - 1 ? "end" : "middle";
    svg.appendChild(el("text", { x: gx, y: baseY + 18, "text-anchor": anchor, "font-size": 11, class: "tick" }, t.label));
  });
  svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: baseY, y2: baseY, class: "axis-line" }));

  if (opts.ref) {
    const rx = pos(opts.ref.v);
    svg.appendChild(el("line", { x1: rx, x2: rx, y1: padT - 4, y2: baseY, class: "ref-line" }));
    svg.appendChild(el("text", { x: rx, y: padT - 6, "text-anchor": "end", class: "ref-label" }, opts.ref.label));
  }

  placed.forEach((p) => {
    const cy = baseY - p.level * step - dotR;
    const c = el("circle", { cx: p.px, cy, r: dotR, fill: p.color, class: "dot", tabindex: "0" });
    attachTip(c, p.tip);
    svg.appendChild(c);
  });

  host.replaceChildren(svg);

  /* optional caption note under the chart (worthwhile-odds exclusions) */
  let noteEl = host.nextElementSibling && host.nextElementSibling.classList && host.nextElementSibling.classList.contains("strip-note")
    ? host.nextElementSibling : null;
  if (opts.note) {
    if (!noteEl) { noteEl = document.createElement("p"); noteEl.className = "fig-note strip-note"; host.after(noteEl); }
    noteEl.textContent = opts.note;
  } else if (noteEl) { noteEl.remove(); }
}

/* ---- Chart C2: small-multiples of every game's prize ladder ----
   One mini bar chart per game. x = prize size, bar height = how many of that
   prize exist — both on a shared log scale so jackpots stay visible beside the
   millions of small wins. Fixed viewBox (CSS scales it), so no resize redraw. */
function buildLadders() {
  const games = state.all
    .filter((g) => (g.prizes || []).some((p) => p.prize > 0 && (p.total || 0) > 0))
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  if (!games.length) return;

  /* shared domains across all games, so panels are directly comparable */
  let minP = Infinity, maxP = 0, maxN = 0;
  games.forEach((g) => (g.prizes || []).forEach((p) => {
    if (!(p.prize > 0) || !(p.total > 0)) return;
    minP = Math.min(minP, p.prize); maxP = Math.max(maxP, p.prize);
    maxN = Math.max(maxN, p.total);
  }));
  const lpMin = Math.log10(minP), lpMax = Math.log10(maxP), lnMax = Math.log10(maxN);

  const VB_W = 200, VB_H = 92, padL = 6, padR = 6, padT = 6, padB = 8;
  const innerW = VB_W - padL - padR, innerH = VB_H - padT - padB;
  const baseY = padT + innerH;
  const xPos = (v) => padL + ((Math.log10(v) - lpMin) / (lpMax - lpMin)) * innerW;
  const barH = (v) => Math.max(1.5, (Math.log10(v) / lnMax) * innerH);

  const host = $("#chart-ladders");
  const frag = document.createDocumentFragment();

  games.forEach((g) => {
    const cell = document.createElement("figure");
    cell.className = "ladder-cell";
    cell.innerHTML =
      `<figcaption class="ladder-cap"><span class="ladder-name">${esc(g.name)}</span>` +
      `<span class="ladder-price">$${g.price}</span></figcaption>`;

    const svg = el("svg", { viewBox: `0 0 ${VB_W} ${VB_H}`, role: "img",
      "aria-label": `Prize ladder for ${g.name}` });

    /* faint decade reference lines at $100 / $10K / $1M, where in range */
    [100, 1e4, 1e6].forEach((d) => {
      if (d < minP || d > maxP) return;
      svg.appendChild(el("line", { x1: xPos(d), x2: xPos(d), y1: padT, y2: baseY, class: "grid" }));
    });

    (g.prizes || [])
      .filter((p) => p.prize > 0 && p.total > 0)
      .forEach((p) => {
        const h = barH(p.total), x = xPos(p.prize);
        const rect = el("rect", { x: x - 2.5, y: baseY - h, width: 5, height: h,
          fill: colorFor(g.price), class: "ladder-bar" });
        attachTip(rect, `<b>${money(p.prize)}</b><br><span class="tip-sub">${fmt(p.total)} printed</span>`);
        svg.appendChild(rect);
      });

    svg.appendChild(el("line", { x1: padL, x2: VB_W - padR, y1: baseY, y2: baseY, class: "axis-line" }));
    cell.appendChild(svg);
    frag.appendChild(cell);
  });

  host.replaceChildren(frag);
  priceLegend("#legend-ladders", games.map((g) => g.price));
}

/* ---- Chart C: where the prize money goes (100% stacked bar) ---- */
function buildWhere() {
  const bands = [
    { label: "Under $50", lo: 0, hi: 50, color: "#a9b2bb", blurb: "small change" },
    { label: "$50 – $1K", lo: 50, hi: 1000, color: "#6a7d8d", blurb: "a decent day" },
    { label: "$1K – $100K", lo: 1000, hi: 100000, color: "#475b6d", blurb: "genuinely useful" },
    { label: "Over $100K", lo: 100000, hi: Infinity, color: "#8a2b2f", blurb: "the dream" },
  ];
  let total = 0;
  state.all.forEach((g) => (g.prizes || []).forEach((p) => {
    const v = p.prize * (p.total || 0);
    total += v;
    const b = bands.find((b) => p.prize >= b.lo && p.prize < b.hi);
    if (b) b.sum = (b.sum || 0) + v;
  }));

  const stack = document.createElement("div");
  stack.className = "stack";
  bands.forEach((b) => {
    const frac = (b.sum || 0) / total;
    const seg = document.createElement("div");
    seg.className = "stack-seg";
    seg.style.flex = frac;
    seg.style.background = b.color;
    if (frac > 0.06) seg.innerHTML = `<span>${pctTxt(frac)}</span>`;
    seg.title = `${b.label}: ${pctTxt(frac)} of all prize money`;
    stack.appendChild(seg);
  });
  $("#chart-where").replaceChildren(stack);

  $("#legend-where").innerHTML = bands
    .map((b) => `<span><i style="background:${b.color}"></i>${b.label} — ${pctTxt((b.sum || 0) / total)} <em style="font-style:italic;opacity:.8">${b.blurb}</em></span>`)
    .join("");
}

/* ---- Chart E: the jackpot reality (top-prize odds translated to dollars) ---- */
function buildJackpot() {
  const rows = state.all
    .map((g) => {
      const withOdds = (g.prizes || []).filter((p) => p.odds_one_in);
      if (!withOdds.length) return null;
      const top = withOdds.reduce((a, b) => (b.prize > a.prize ? b : a));
      return { g, prize: top.prize, odds: top.odds_one_in };
    })
    .filter(Boolean)
    .sort((a, b) => b.odds - a.odds)
    .slice(0, 6);

  const grid = $("#jackpot-grid");
  grid.innerHTML = rows
    .map((r) => {
      const cost = r.odds * r.g.price;
      const daily = r.odds / 365; /* years buying one ticket a day */
      return (
        `<div class="jp-card">` +
          `<div class="jp-top"><span class="jp-name">${esc(r.g.name)}</span>` +
            `<span class="jp-prize">${money(r.prize)}</span></div>` +
          `<div class="jp-odds">1 in ${fmt(r.odds)} · $${r.g.price} ticket</div>` +
          `<p class="jp-line">Tickets needed to expect one win: <strong>${fmt(r.odds)}</strong></p>` +
          `<p class="jp-line">What they'd cost: <strong>$${shortNum(cost)}</strong></p>` +
          `<p class="jp-line">At one ticket a day: <strong>${fmt(Math.round(daily))} years</strong></p>` +
        `</div>`
      );
    })
    .join("");
}

/* legend of the price colors actually present in a chart */
function priceLegend(sel, prices) {
  const uniq = [...new Set(prices)].sort((a, b) => a - b);
  $(sel).innerHTML = uniq.map((p) => `<span><i style="background:${colorFor(p)}"></i>$${p}</span>`).join("");
}

/* ---- helpers ---- */
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
