"use strict";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : "—");
const pct = (x, n = 1) =>
  Number.isFinite(x) ? (x * 100).toFixed(n) + "%" : "—";
const signed = (x, n = 1) =>
  Number.isFinite(x) ? (x >= 0 ? "+" : "") + pct(x, n) : "—";
const money = (x) =>
  Number.isFinite(x)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(x)
    : "—";
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const colors = {
  strategy: "#b8ef73",
  intraday: "#e7bf78",
  hold: "#aa9dff",
  data: "#aa9dff",
};
let original, extension, profit, explorer, currentScenario;
let toastTimer, resizeTimer;
const state = {
  dataset: "original",
  model: "",
  period: "all",
  threshold: 0.55,
  cost: 2,
  capital: 10000,
  chart: "equity",
  benchmarks: true,
  ledger: "all",
};
const overview = { dataset: "original", model: "" };
const arena = {
  dataset: "original",
  model: "",
  family: "all",
  sort: "validation",
  ablation: "CatBoost",
};
const dataView = { dataset: "original", metric: "close", index: -1 };
const pageMeta = {
  overview: [
    "01 / THE BIG PICTURE",
    "Signals. Strategies. Evidence.",
    "Start with the measured results, then choose a question to explore.",
  ],
  lab: [
    "02 / PUT THE ASSUMPTIONS TO WORK",
    "Build your strategy.",
    "Change the setup. See the return, drawdown and every historical decision update together.",
  ],
  validation: [
    "03 / COMPARE THE EVIDENCE",
    "Meet the models.",
    "Select a model to inspect its predictions, probability reliability and fitted features.",
  ],
  data: [
    "04 / GO BACK TO THE INPUTS",
    "Explore the signal.",
    "Choose a series and replay a date to see the values available at that session’s close.",
  ],
};
const sources = {
  close: {
    title: "SPY closing price",
    short: "SPY price",
    group: "Market",
    provider: "YAHOO FINANCE / SPY",
    unit: "USD per share",
    description:
      "The unadjusted closing price at the signal date, before the next-session trade.",
    lag: "Signal-date close",
    transformation:
      "Reported daily closing price. This chart shows the price, not portfolio value.",
    url: "https://finance.yahoo.com/quote/SPY/history/",
    format: (x) => "$" + fmt(x, 2),
  },
  news_sentiment: {
    title: "Economic news sentiment",
    short: "News sentiment",
    group: "Sentiment",
    provider: "FEDERAL RESERVE BANK OF SAN FRANCISCO",
    unit: "Index score",
    description:
      "Broad economic-news sentiment, joined using its assumed historical availability.",
    lag: "Observation + 7 calendar days",
    transformation:
      "Latest available published FRBSF index value. This is not a SPY-specific sentiment classifier.",
    url: "https://www.frbsf.org/research-and-insights/data-and-indicators/daily-news-sentiment-index/",
    format: (x) => fmt(x, 3),
  },
  vix: {
    title: "Market volatility / VIX",
    short: "VIX volatility",
    group: "Market",
    provider: "FRED / VIXCLS",
    unit: "Index points",
    description:
      "The lagged VIX observation used to describe the market risk environment.",
    lag: "Observation + 2 business days",
    transformation: "Backward availability join with a 14-day staleness limit.",
    url: "https://fred.stlouisfed.org/series/VIXCLS",
    format: (x) => fmt(x, 2),
  },
  yield_curve: {
    title: "Treasury yield curve",
    short: "Yield curve",
    group: "Macro",
    provider: "FRED / T10Y2Y",
    unit: "Percentage points",
    description:
      "The 10-year minus 2-year Treasury spread. A negative value indicates inversion.",
    lag: "Observation + 2 business days",
    transformation:
      "Published term spread, then backward-joined on the assumed availability date.",
    url: "https://fred.stlouisfed.org/series/T10Y2Y",
    format: (x) => fmt(x, 2) + " pp",
  },
  fed_funds: {
    title: "Federal funds rate",
    short: "Policy rate",
    group: "Macro",
    provider: "FRED / DFF",
    unit: "Percent",
    description:
      "The lagged effective federal funds rate used as a policy-stance predictor.",
    lag: "Observation + 2 business days",
    transformation:
      "Published percent level. No future observation is backfilled.",
    url: "https://fred.stlouisfed.org/series/DFF",
    format: (x) => fmt(x, 2) + "%",
  },
  inflation_yoy: {
    title: "Consumer price inflation",
    short: "CPI inflation",
    group: "Macro",
    provider: "FRED / CPIAUCSL",
    unit: "Year-over-year percent",
    description:
      "Twelve-observation CPI growth, with a conservative monthly publication lag.",
    lag: "Observation month end + 45 calendar days",
    transformation:
      "CPI index / CPI index 12 observations earlier − 1, multiplied by 100, then availability-lagged.",
    url: "https://fred.stlouisfed.org/series/CPIAUCSL",
    format: (x) => fmt(x, 2) + "%",
  },
  unemployment: {
    title: "Unemployment rate",
    short: "Unemployment",
    group: "Macro",
    provider: "FRED / UNRATE",
    unit: "Percent",
    description:
      "The monthly unemployment rate available under the project’s lag assumptions.",
    lag: "Observation month end + 45 calendar days",
    transformation:
      "Published percent level, backward-joined with a 100-day staleness limit.",
    url: "https://fred.stlouisfed.org/series/UNRATE",
    format: (x) => fmt(x, 1) + "%",
  },
};
function finance(r, positions) {
  let wealth = 1,
    peak = 1,
    drawdown = 0;
  const equity = [1],
    active = [];
  r.forEach((x, i) => {
    wealth *= 1 + x;
    peak = Math.max(peak, wealth);
    drawdown = Math.min(drawdown, wealth / peak - 1);
    equity.push(wealth);
    if (positions[i]) active.push(x);
  });
  const mean = r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
  const sd = Math.sqrt(
    r.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, r.length - 1),
  );
  const losses = -active.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  return {
    total_return: wealth - 1,
    annual_return: r.length ? wealth ** (252 / r.length) - 1 : 0,
    sharpe: sd ? (mean / sd) * Math.sqrt(252) : 0,
    max_drawdown: drawdown,
    exposure: r.length ? active.length / r.length : 0,
    round_trips: active.length,
    hit_rate: active.length
      ? active.filter((x) => x > 0).length / active.length
      : null,
    profit_factor: losses
      ? active.filter((x) => x > 0).reduce((a, b) => a + b, 0) / losses
      : null,
    equity,
  };
}
function series(data, probability, threshold, cost) {
  const position = probability.map((p) => (p >= threshold ? 1 : 0));
  const returns = data.map(
    (row, i) => position[i] * (row.market_return - (2 * cost) / 10000),
  );
  const intraday = data.map((row) => row.market_return - (2 * cost) / 10000);
  const hold = data.map((row) => row.buy_hold_return);
  if (hold.length) {
    hold[0] -= cost / 10000;
    hold[hold.length - 1] -= cost / 10000;
  }
  const all = data.map(() => 1);
  return {
    position,
    returns,
    stats: finance(returns, position),
    intraday: finance(intraday, all),
    hold: finance(hold, all),
    intradayReturns: intraday,
    holdReturns: hold,
  };
}
function models(sample) {
  if (sample === "extension" && extension) {
    const r = extension.report;
    return [
      {
        id: "fresh",
        family: r.selected.family,
        features: r.selected.features,
        feature_count: r.selected.columns.length,
        classification: r.classification,
        strategy: r.strategy,
        validation: r.selected.cv_balanced_accuracy,
        tradeThreshold: r.trade_threshold,
        classThreshold: r.selected.threshold,
        selected: true,
      },
      {
        id: "reference",
        family: "Logistic",
        features: "Original full specification",
        feature_count: 24,
        classification: r.original_specification.classification,
        strategy: r.original_specification.strategy,
        validation: null,
        tradeThreshold: 0.55,
        classThreshold: 0.5,
        selected: false,
      },
    ];
  }
  const list = original.report.models.map((m) => ({
    ...m,
    classification: m.holdout,
    validation: m.cv_balanced_accuracy,
    tradeThreshold: 0.55,
    classThreshold: 0.5,
    selected: m.id === original.report.selected_model,
  }));
  if (profit)
    profit.report.models
      .filter((m) => profit.probabilities[m.id])
      .forEach((m) =>
        list.push({
          ...m,
          classification: m.holdout,
          validation: m.cv_balanced_accuracy,
          tradeThreshold: 0.55,
          classThreshold: 0.5,
          selected: false,
        }),
      );
  return list;
}
function modelFor(sample, id) {
  return models(sample).find((m) => m.id === id) || models(sample)[0];
}
function defaultModel(sample) {
  return sample === "extension" ? "fresh" : original.report.selected_model;
}
function labelFor(model) {
  return model.family + " · " + model.features;
}
function sampleRows(sample) {
  return sample === "extension"
    ? extension.observations
    : original.observations;
}
function probabilities(sample, id) {
  if (sample === "extension")
    return extension.observations.map((row) =>
      id === "reference" ? row.original_probability_up : row.probability_up,
    );
  return original.probabilities[id] || profit?.probabilities[id] || [];
}
function setupOptions(selector, sample, selected) {
  $(selector).innerHTML = models(sample)
    .map(
      (m) =>
        '<option value="' + esc(m.id) + '">' + esc(labelFor(m)) + "</option>",
    )
    .join("");
  $(selector).value = selected;
}
function sampleLabel(sample) {
  return sample === "extension"
    ? "Fresh evaluation · Jan–Oct 2026"
    : "Historical backtest · 2022–2025";
}
function kpi(label, value, note, help = "", tone = "") {
  return (
    '<div class="kpi"><span class="kpi-label">' +
    label +
    (help
      ? '<button class="help-inline" data-help="' +
        help +
        '" aria-label="Explain ' +
        label +
        '">?</button>'
      : "") +
    '</span><strong class="kpi-value ' +
    tone +
    '">' +
    value +
    '</strong><span class="kpi-note">' +
    note +
    "</span></div>"
  );
}
function legend(selector, sets) {
  $(selector).innerHTML = sets
    .map(
      (s) =>
        '<span><i style="background:' +
        s.color +
        '"></i>' +
        esc(s.name) +
        "</span>",
    )
    .join("");
}
function drawdowns(equity) {
  let peak = equity[0];
  return equity.map((v) => {
    peak = Math.max(peak, v);
    return v / peak - 1;
  });
}
function chartSets(result, capital, view = "equity", benchmarks = true) {
  const make = (stats, returns) =>
    view === "drawdown"
      ? drawdowns(stats.equity)
      : view === "daily"
        ? [0, ...returns]
        : stats.equity.map((x) => x * capital);
  const list = [
    {
      name: "Long / cash",
      color: colors.strategy,
      values: make(result.stats, result.returns),
    },
  ];
  if (benchmarks)
    list.push(
      {
        name: "Always-long intraday",
        color: colors.intraday,
        values: make(result.intraday, result.intradayReturns),
      },
      {
        name: "Buy & hold",
        color: colors.hold,
        values: make(result.hold, result.holdReturns),
      },
    );
  return list;
}
function lineChart(
  selector,
  dates,
  sets,
  {
    formatter = (x) => fmt(x, 0),
    onPick = null,
    description = "Historical observations",
  } = {},
) {
  const compact = matchMedia("(max-width: 740px)").matches;
  const target = $(selector),
    W = compact ? 600 : 920,
    H = compact ? 310 : 285,
    L = compact ? 70 : 53,
    R = 16,
    T = 18,
    B = 31;
  const values = sets.flatMap((s) => s.values).filter(Number.isFinite);
  let lo = Math.min(...values),
    hi = Math.max(...values);
  const pad = Math.max(
    (hi - lo) * 0.14,
    Math.abs(hi) * 0.01,
    hi === lo ? 0.01 : 1e-8,
  );
  lo -= pad;
  hi += pad;
  const n = dates.length,
    x = (i) => L + (i / Math.max(1, n - 1)) * (W - L - R),
    y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  let svg =
    '<svg viewBox="0 0 ' +
    W +
    " " +
    H +
    '" role="img" tabindex="0" aria-label="' +
    esc(description) +
    '. Hover or use arrow keys to inspect; click or press Enter for details."><title>' +
    esc(description) +
    "</title>";
  for (let i = 0; i < 5; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    svg +=
      '<line x1="' +
      L +
      '" y1="' +
      y(v) +
      '" x2="' +
      (W - R) +
      '" y2="' +
      y(v) +
      '" stroke="#273349"/><text x="' +
      (L - 10) +
      '" y="' +
      (y(v) + 3) +
      '" text-anchor="end">' +
      esc(formatter(v)) +
      "</text>";
  }
  for (let i = 0; i < 5; i++) {
    const k = Math.round(((n - 1) * i) / 4);
    svg +=
      '<text x="' +
      x(k) +
      '" y="' +
      (H - 8) +
      '" text-anchor="' +
      (i === 0 ? "start" : i === 4 ? "end" : "middle") +
      '">' +
      esc((dates[k] || "").slice(0, 7)) +
      "</text>";
  }
  sets.forEach((s, j) => {
    svg +=
      '<path d="' +
      s.values
        .map((v, i) => (i ? "L" : "M") + fmt(x(i), 2) + "," + fmt(y(v), 2))
        .join(" ") +
      '" fill="none" stroke="' +
      s.color +
      '" stroke-width="' +
      (j === 0 ? 2.7 : 1.6) +
      '" stroke-linejoin="round" opacity="' +
      (j === 0 ? 1 : 0.8) +
      '"/>';
  });
  svg +=
    '<line class="hover-line" x1="0" x2="0" y1="' +
    T +
    '" y2="' +
    (H - B) +
    '" stroke="#b9aed9" stroke-dasharray="4 4" visibility="hidden"/></svg><div class="chart-tooltip" hidden></div>';
  target.innerHTML = svg;
  const graph = target.querySelector("svg"),
    tip = target.querySelector(".chart-tooltip"),
    cursor = target.querySelector(".hover-line");
  let index = n - 1;
  const show = (i) => {
    index = clamp(i, 0, n - 1);
    cursor.setAttribute("x1", x(index));
    cursor.setAttribute("x2", x(index));
    cursor.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML =
      "<b>" +
      esc(dates[index]) +
      "</b><br>" +
      sets
        .map((s) => esc(s.name) + ": " + esc(formatter(s.values[index])))
        .join("<br>") +
      (onPick ? "<br><span class='muted'>Click to inspect</span>" : "");
  };
  const pointerIndex = (event) => {
    const box = graph.getBoundingClientRect();
    return clamp(
      Math.round(
        ((((event.clientX - box.left) / box.width) * W - L) / (W - L - R)) *
          (n - 1),
      ),
      0,
      n - 1,
    );
  };
  graph.addEventListener("pointermove", (event) => show(pointerIndex(event)));
  graph.addEventListener("pointerleave", () => {
    tip.hidden = true;
    cursor.setAttribute("visibility", "hidden");
  });
  graph.addEventListener("focus", () => show(index));
  graph.addEventListener("blur", () => {
    tip.hidden = true;
    cursor.setAttribute("visibility", "hidden");
  });
  graph.addEventListener("click", (event) => {
    if (onPick) onPick(pointerIndex(event));
  });
  graph.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      show(index + (event.key === "ArrowRight" ? 1 : -1));
    } else if (event.key === "Enter" && onPick) {
      event.preventDefault();
      onPick(index);
    }
  });
}
function setTab(name, { push = true, focus = false } = {}) {
  if (!pageMeta[name]) name = "overview";
  $$(".tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== name;
    panel.classList.toggle("tab-enter", panel.id === name);
  });
  $$("[data-tab]").forEach((button) => {
    if (button.dataset.tab === name)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const meta = pageMeta[name];
  $("#page-kicker").textContent = meta[0];
  $("#page-title").textContent = meta[1];
  $("#page-summary").textContent = meta[2];
  document.title = meta[1] + " · Market Direction";
  if (original) {
    if (name === "overview") renderOverview();
    if (name === "lab") renderLab();
    if (name === "validation") renderArena();
    if (name === "data") renderData();
  }
  if (push && location.hash !== "#" + name)
    history.pushState(null, "", "#" + name);
  if (focus) {
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    $("#page-title").focus({ preventScroll: true });
  }
}
function renderOverview() {
  const model = modelFor(overview.dataset, overview.model),
    rows = sampleRows(overview.dataset),
    p = probabilities(overview.dataset, model.id);
  const result = series(rows, p, model.tradeThreshold, 2),
    v = result.stats;
  $("#overview-kpis").innerHTML =
    kpi(
      "Net total return",
      signed(v.total_return),
      rows[0].date + " to " + rows.at(-1).date,
      "return",
      v.total_return >= 0 ? "positive" : "negative",
    ) +
    kpi(
      "Balanced accuracy",
      pct(model.classification.balanced_accuracy),
      "Same model · same evaluation sample",
      "accuracy",
    ) +
    kpi(
      "Net Sharpe",
      fmt(v.sharpe),
      "Daily net return · zero reference rate",
      "sharpe",
    ) +
    kpi(
      "Max drawdown",
      pct(v.max_drawdown),
      "Largest decline from a prior peak",
      "drawdown",
    );
  $("#overview-caption").textContent =
    labelFor(model) +
    " · " +
    pct(model.tradeThreshold, 0) +
    " trade threshold · 2 bps each side";
  const sets = chartSets(result, 10000);
  legend("#overview-legend", sets);
  lineChart(
    "#overview-chart",
    [rows[0].signal_date, ...rows.map((r) => r.date)],
    sets,
    {
      formatter: (x) => "$" + fmt(x, 0),
      description: "Growth of $10,000 for " + labelFor(model),
      onPick: (i) =>
        openSession(
          rows,
          p,
          result,
          clamp(i - 1, 0, rows.length - 1),
          10000,
          2,
          model.tradeThreshold,
        ),
    },
  );
  $("#snapshot-title").textContent = labelFor(model);
  $("#snapshot-period").textContent =
    overview.dataset === "extension" ? "2026 / 209 SESSIONS" : "2022–2025";
  const selected = model.selected
    ? "Selected using development validation."
    : "A recorded model comparison, not the original validation winner.";
  $("#snapshot-body").innerHTML =
    '<div class="snapshot-score ' +
    (v.total_return >= 0 ? "positive" : "negative") +
    '">' +
    money(10000 * (1 + v.total_return)) +
    "</div><p>Ending value of $10,000 after assumed costs. " +
    selected +
    '</p><div class="snapshot-metrics"><div><span>ACTIVE SESSIONS</span><b>' +
    v.round_trips +
    " / " +
    rows.length +
    "</b></div><div><span>UP / NOT-UP AUC</span><b>" +
    fmt(model.classification.roc_auc, 3) +
    '</b></div></div><p class="fine-print">' +
    (overview.dataset === "extension"
      ? "The selected CatBoost’s balanced-accuracy interval includes 50%; improved direction does not establish durable profitability."
      : "Buy & hold has different overnight exposure. Positive historical profit does not establish future returns.") +
    "</p>";
}
function configureLab(sample, modelId, { keepCapital = true } = {}) {
  state.dataset =
    sample === "extension" && extension ? "extension" : "original";
  state.model = models(state.dataset).some((m) => m.id === modelId)
    ? modelId
    : defaultModel(state.dataset);
  $("#dataset").value = state.dataset;
  setupOptions("#model", state.dataset, state.model);
  const years = [
    ...new Set(sampleRows(state.dataset).map((r) => r.date.slice(0, 4))),
  ];
  $("#period").innerHTML =
    '<option value="all">Full evaluation sample</option>' +
    years
      .map((year) => '<option value="' + year + '">' + year + "</option>")
      .join("");
  state.period = "all";
  if (!keepCapital) state.capital = 10000;
  state.threshold = modelFor(state.dataset, state.model).tradeThreshold;
  state.cost = 2;
  state.chart = "equity";
  state.ledger = "all";
  $("#ledger-filter").value = "all";
  $("#capital").value = state.capital;
  renderLab();
}
function labData() {
  const all = sampleRows(state.dataset),
    p = probabilities(state.dataset, state.model);
  const indices = all
    .map((r, i) => i)
    .filter(
      (i) => state.period === "all" || all[i].date.startsWith(state.period),
    );
  return { rows: indices.map((i) => all[i]), p: indices.map((i) => p[i]) };
}
function renderLab() {
  $("#threshold").value = state.threshold;
  $("#cost").value = state.cost;
  $("#threshold-value").textContent = pct(state.threshold, 0);
  $("#cost-value").textContent = fmt(state.cost, 1) + " bps";
  $("#show-benchmarks").checked = state.benchmarks;
  $$("[data-chart]").forEach((button) =>
    button.classList.toggle("active", button.dataset.chart === state.chart),
  );
  const defaultThreshold = modelFor(state.dataset, state.model).tradeThreshold;
  $$("[data-preset]").forEach((button) => {
    const id = button.dataset.preset;
    button.classList.toggle(
      "active",
      id === "default"
        ? Math.abs(state.threshold - defaultThreshold) < 1e-8 &&
            state.cost === 2
        : id === "cost"
          ? state.cost === 10 &&
            Math.abs(state.threshold - defaultThreshold) < 1e-8
          : id === "confidence"
            ? state.threshold === 0.65 && state.cost === 2
            : state.threshold === 0.5 && state.cost === 2,
    );
  });
  const { rows, p } = labData(),
    result = series(rows, p, state.threshold, state.cost),
    v = result.stats;
  currentScenario = {
    rows,
    p,
    result,
    model: modelFor(state.dataset, state.model),
  };
  $("#lab-kpis").innerHTML =
    kpi(
      "Ending capital",
      money(state.capital * (1 + v.total_return)),
      signed(v.total_return) + " net total return",
      "return",
      v.total_return >= 0 ? "positive" : "negative",
    ) +
    kpi(
      "Annualized return",
      pct(v.annual_return),
      "Geometric · 252 sessions / year",
      "return",
    ) +
    kpi(
      "Net Sharpe",
      fmt(v.sharpe),
      rows.length + " evaluation sessions",
      "sharpe",
    ) +
    kpi(
      "Max drawdown",
      pct(v.max_drawdown),
      v.round_trips + " long positions",
      "drawdown",
    );
  $("#lab-caption").textContent =
    rows[0].date +
    " → " +
    rows.at(-1).date +
    " · " +
    pct(state.threshold, 0) +
    " minimum confidence · " +
    fmt(state.cost, 1) +
    " bps / side";
  const chartTitles = {
    equity: "Portfolio value",
    drawdown: "Distance from the peak",
    daily: "Daily net returns",
  };
  $("#lab-chart-title").textContent = chartTitles[state.chart];
  const sets = chartSets(result, state.capital, state.chart, state.benchmarks);
  lineChart(
    "#lab-chart",
    [rows[0].signal_date, ...rows.map((r) => r.date)],
    sets,
    {
      formatter:
        state.chart === "equity" ? (x) => "$" + fmt(x, 0) : (x) => pct(x, 1),
      description: chartTitles[state.chart],
      onPick: (i) =>
        openSession(
          rows,
          p,
          result,
          clamp(i - 1, 0, rows.length - 1),
          state.capital,
          state.cost,
          state.threshold,
        ),
    },
  );
  legend("#lab-legend", sets);
  const reference = series(rows, p, defaultThreshold, 2).stats;
  const delta = v.total_return - reference.total_return,
    tradeDelta = v.round_trips - reference.round_trips;
  $("#scenario-change").innerHTML =
    Math.abs(delta) < 1e-10 && tradeDelta === 0
      ? "<b>Research settings loaded.</b> Change confidence, cost or period to test a different historical setup. Click the chart or a ledger row to inspect a session."
      : "<b>Compared with this model’s research settings</b> (" +
        pct(defaultThreshold, 0) +
        ', 2 bps / side): <span class="' +
        (delta >= 0 ? "positive" : "negative") +
        '">' +
        (delta >= 0 ? "+" : "") +
        fmt(delta * 100, 2) +
        " percentage points</span> net return · " +
        (tradeDelta >= 0 ? "+" : "") +
        tradeDelta +
        " active sessions. The evaluation period is unchanged.";
  renderMonths(rows, result);
  $("#exposure").innerHTML =
    '<div class="exposure-grid"><div><span>Active sessions</span><b>' +
    pct(v.exposure) +
    "</b></div><div><span>Winning active days</span><b>" +
    pct(v.hit_rate) +
    "</b></div><div><span>Profit factor</span><b>" +
    fmt(v.profit_factor) +
    "</b></div><div><span>Round-trip cost</span><b>" +
    fmt(state.cost * 2, 1) +
    ' bps</b></div><div><span>Intraday benchmark</span><b class="' +
    (result.intraday.total_return >= 0 ? "positive" : "negative") +
    '">' +
    signed(result.intraday.total_return) +
    '</b></div><div><span>Buy & hold</span><b class="' +
    (result.hold.total_return >= 0 ? "positive" : "negative") +
    '">' +
    signed(result.hold.total_return) +
    '</b></div></div><div class="allocation-bar"><span style="width:' +
    v.exposure * 100 +
    '%"></span></div><p class="fine-print">Purple: active sessions. The rest are cash. No overnight positions or cash yield are included in the strategy.</p>';
  renderLedger();
}
function renderMonths(rows, result) {
  const months = {};
  rows.forEach((row, i) => {
    const key = row.date.slice(0, 7);
    months[key] = (months[key] ?? 1) * (1 + result.returns[i]);
  });
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))],
    names = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
  $("#monthly").innerHTML =
    '<table class="heatmap"><thead><tr><th>Year</th>' +
    names.map((name) => "<th>" + name + "</th>").join("") +
    "</tr></thead><tbody>" +
    years
      .map(
        (year) =>
          "<tr><td>" +
          year +
          "</td>" +
          names
            .map((name, i) => {
              const key = year + "-" + String(i + 1).padStart(2, "0"),
                r = months[key] === undefined ? null : months[key] - 1;
              return (
                "<td>" +
                (r === null
                  ? '<span class="empty-month"></span>'
                  : '<button data-month="' +
                    key +
                    '" aria-label="Inspect ' +
                    name +
                    " " +
                    year +
                    " net return " +
                    pct(r) +
                    '" style="background:' +
                    (r >= 0 ? "rgba(137,182,81," : "rgba(186,88,117,") +
                    Math.min(0.7, 0.13 + Math.abs(r) * 8) +
                    ')">' +
                    pct(r, 1) +
                    "</button>") +
                "</td>"
              );
            })
            .join("") +
          "</tr>",
      )
      .join("") +
    "</tbody></table>";
}
function renderLedger() {
  if (!currentScenario) return;
  const { rows, p, result } = currentScenario;
  const indices = rows
    .map((r, i) => i)
    .filter(
      (i) =>
        state.ledger === "all" ||
        (state.ledger === "active"
          ? result.position[i] === 1
          : result.position[i] === 0),
    )
    .slice(-12)
    .reverse();
  $("#ledger").innerHTML = indices.length
    ? '<table><thead><tr><th>Signal / trade date</th><th class="number">P(up)</th><th>Decision</th><th class="number">SPY intraday</th><th class="number">Net return</th><th></th></tr></thead><tbody>' +
      indices
        .map(
          (i) =>
            '<tr data-session="' +
            i +
            '" tabindex="0" role="button" aria-label="Inspect session ' +
            rows[i].date +
            '"><td>' +
            rows[i].signal_date +
            ' <span class="muted">→</span> ' +
            rows[i].date +
            '</td><td class="number">' +
            pct(p[i], 2) +
            "</td><td>" +
            (result.position[i]
              ? '<span class="positive">Long</span>'
              : '<span class="muted">Cash</span>') +
            '</td><td class="number">' +
            signed(rows[i].market_return) +
            '</td><td class="number ' +
            (result.returns[i] >= 0 ? "positive" : "negative") +
            '">' +
            signed(result.returns[i]) +
            '</td><td class="muted">→</td></tr>',
        )
        .join("") +
      "</tbody></table>"
    : '<div class="empty-state">No sessions match this decision filter. Lower the confidence threshold or choose All sessions.</div>';
}
function metricTable(model) {
  const s = model.strategy,
    c = model.classification;
  return (
    '<div class="detail-stat-grid"><div><span>Balanced accuracy</span><b>' +
    pct(c.balanced_accuracy) +
    "</b></div><div><span>ROC AUC</span><b>" +
    fmt(c.roc_auc, 3) +
    '</b></div><div><span>Net return</span><b class="' +
    (s.total_return >= 0 ? "positive" : "negative") +
    '">' +
    signed(s.total_return) +
    "</b></div><div><span>Max drawdown</span><b>" +
    pct(s.max_drawdown) +
    "</b></div></div>"
  );
}
function calibration(y, p) {
  const bins = new Map();
  p.forEach((value, i) => {
    const key = clamp(Math.ceil(value * 10) - 1, 0, 9);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push({ p: value, y: y[i] });
  });
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, rows]) => ({
      predicted: rows.reduce((s, r) => s + r.p, 0) / rows.length,
      observed: rows.reduce((s, r) => s + r.y, 0) / rows.length,
      count: rows.length,
    }));
}
function calibrationChart(points) {
  const W = 500,
    H = 235,
    L = 42,
    R = 17,
    T = 15,
    B = 32,
    x = (v) => L + v * (W - L - R),
    y = (v) => H - B - v * (H - B - T);
  let html =
    '<svg viewBox="0 0 ' +
    W +
    " " +
    H +
    '" role="img" aria-label="Predicted probability versus observed up frequency"><title>Probability reliability</title>';
  for (const v of [0, 0.25, 0.5, 0.75, 1])
    html +=
      '<line x1="' +
      x(0) +
      '" x2="' +
      x(1) +
      '" y1="' +
      y(v) +
      '" y2="' +
      y(v) +
      '" stroke="#283349"/><text x="' +
      (L - 9) +
      '" y="' +
      (y(v) + 3) +
      '" text-anchor="end">' +
      fmt(v, 2) +
      '</text><text x="' +
      x(v) +
      '" y="' +
      (H - 10) +
      '" text-anchor="middle">' +
      fmt(v, 2) +
      "</text>";
  html +=
    '<line x1="' +
    x(0) +
    '" x2="' +
    x(1) +
    '" y1="' +
    y(0) +
    '" y2="' +
    y(1) +
    '" stroke="#68758e" stroke-dasharray="5 5"/>';
  points.forEach((point) => {
    html +=
      '<circle cx="' +
      x(point.predicted) +
      '" cy="' +
      y(point.observed) +
      '" r="' +
      Math.max(4, Math.min(14, Math.sqrt(point.count))) +
      '" fill="#aa9dff" fill-opacity=".75"><title>' +
      point.count +
      " sessions; predicted " +
      pct(point.predicted) +
      ", observed " +
      pct(point.observed) +
      "</title></circle>";
  });
  $("#calibration").innerHTML = html + "</svg>";
}
function importanceFor(sample, id) {
  if (sample === "extension")
    return id === "fresh" ? extension.report.feature_importance : null;
  const rows = original.report.feature_importance.filter((r) => r.model === id);
  return rows.length ? rows : null;
}
function renderArena() {
  const all = models(arena.dataset),
    filtered = all.filter(
      (m) => arena.family === "all" || m.family === arena.family,
    );
  const score = (m) =>
    arena.sort === "return"
      ? m.strategy.total_return
      : arena.sort === "sharpe"
        ? m.strategy.sharpe
        : arena.sort === "accuracy"
          ? m.classification.balanced_accuracy
          : (m.validation ?? -1);
  filtered.sort((a, b) => score(b) - score(a));
  if (!filtered.some((m) => m.id === arena.model))
    arena.model = filtered[0]?.id || "";
  $("#arena-count").textContent = filtered.length + " MODELS";
  $("#arena-period").textContent =
    arena.dataset === "extension" ? "JAN–OCT 2026" : "2022–2025";
  $("#model-table").innerHTML = filtered.length
    ? '<table><thead><tr><th>Model / feature set</th><th class="number">Validation BA</th><th class="number">Test BA</th><th class="number">Net return</th><th class="number">Sharpe</th><th></th></tr></thead><tbody>' +
      filtered
        .map(
          (m) =>
            '<tr data-model="' +
            m.id +
            '" tabindex="0" role="button" aria-label="Inspect ' +
            esc(labelFor(m)) +
            '" class="' +
            (m.id === arena.model ? "selected-row" : "") +
            '"><td><span class="table-model-name">' +
            esc(m.family) +
            '</span><span class="table-model-note">' +
            esc(m.features) +
            "</span>" +
            (m.selected
              ? '<span class="table-label">Validation pick</span>'
              : "") +
            '</td><td class="number">' +
            pct(m.validation, 2) +
            '</td><td class="number">' +
            pct(m.classification.balanced_accuracy, 2) +
            '</td><td class="number ' +
            (m.strategy.total_return >= 0 ? "positive" : "negative") +
            '">' +
            signed(m.strategy.total_return) +
            '</td><td class="number">' +
            fmt(m.strategy.sharpe) +
            '</td><td class="muted">→</td></tr>',
        )
        .join("") +
      "</tbody></table>"
    : '<div class="empty-state">No models from this family were evaluated in this sample. Choose All families or switch to the historical sample.</div>';
  const selected = filtered.find((m) => m.id === arena.model);
  if (!selected) {
    $("#arena-detail-title").textContent = "Choose an available model";
    $("#arena-detail-subtitle").textContent =
      "The selected family is not in this sample.";
    $("#arena-distribution").innerHTML = "";
    $("#arena-detail-stats").innerHTML = "";
    $("#confusion").innerHTML = "";
    $("#confusion-note").textContent = "";
    $("#arena-feature-count").textContent = "NO FIT";
    $("#arena-to-builder").disabled = true;
    $("#calibration").innerHTML =
      '<div class="empty-state">Choose a model to inspect its probabilities.</div>';
    $("#calibration-note").textContent = "No fit selected";
    $("#importance-note").textContent = "No fit selected";
    $("#importance").innerHTML = "";
    return;
  }
  $("#arena-to-builder").disabled = false;
  $("#arena-detail-title").textContent = selected.family;
  $("#arena-detail-subtitle").textContent = selected.features;
  $("#arena-feature-count").textContent =
    (selected.feature_count ?? (selected.features === "Full" ? 24 : 10)) +
    " FEATURES";
  $("#arena-detail-stats").innerHTML = metricTable(selected);
  const rows = sampleRows(arena.dataset),
    p = probabilities(arena.dataset, selected.id),
    y = rows.map((r) => r.actual_up);
  const buckets = Array.from({ length: 10 }, () => []);
  p.forEach((value, i) => buckets[clamp(Math.floor(value * 10), 0, 9)].push(i));
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.length));
  $("#arena-distribution").innerHTML =
    '<div class="distribution-heading"><h4>Where this model’s confidence landed</h4><span>Click a bar to inspect</span></div><div class="probability-distribution">' +
    buckets
      .map(
        (bucket, i) =>
          '<button data-prob-bin="' +
          i +
          '" aria-label="Inspect ' +
          i * 10 +
          " to " +
          (i + 1) * 10 +
          " percent probability, " +
          bucket.length +
          ' sessions"><span class="distribution-bar" style="height:' +
          Math.max(2, (bucket.length / peak) * 90) +
          'px"></span><small>' +
          i * 10 +
          "%</small></button>",
      )
      .join("") +
    '</div><p class="fine-print">Each bar counts sessions by predicted probability. A narrow cluster near 50% means the model rarely expresses strong directional confidence.</p>';
  const cells = { tp: 0, tn: 0, fp: 0, fn: 0 };
  p.forEach((value, i) => {
    const up = value >= selected.classThreshold;
    cells[up ? (y[i] ? "tp" : "fp") : y[i] ? "fn" : "tn"]++;
  });
  $("#confusion").innerHTML = [
    ["tp", "Called up", "Market rose", false],
    ["fp", "Called up", "Market did not rise", true],
    ["fn", "Called not-up", "Market rose", true],
    ["tn", "Called not-up", "Market did not rise", false],
  ]
    .map(
      ([key, title, note, error]) =>
        '<div class="confusion-cell ' +
        (error ? "error-cell" : "") +
        '"><b>' +
        cells[key] +
        "</b><span>" +
        title +
        "</span><small>" +
        note +
        "</small></div>",
    )
    .join("");
  $("#confusion-note").textContent =
    rows.length +
    " sessions · " +
    pct(selected.classThreshold, 0) +
    " classification threshold. This is different from the " +
    pct(selected.tradeThreshold, 0) +
    " trading threshold.";
  $("#calibration-note").textContent =
    labelFor(selected) + " · " + sampleLabel(arena.dataset);
  calibrationChart(calibration(y, p));
  const importance = importanceFor(arena.dataset, selected.id);
  $("#importance-note").textContent =
    labelFor(selected) + " · recorded training fit";
  if (importance) {
    const sorted = [...importance]
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 8),
      max = sorted[0].importance;
    $("#importance").innerHTML =
      sorted
        .map(
          (item) =>
            '<div class="bar-row"><span>' +
            esc(item.feature.replaceAll("_", " ")) +
            '</span><div class="bar-track"><div class="bar-fill" style="width:' +
            (item.importance / max) * 100 +
            '%"></div></div><span class="bar-value">' +
            pct(item.importance) +
            "</span></div>",
        )
        .join("") +
      '<p class="fine-print">Normalized importance or absolute standardized coefficients. These describe the fitted model, not causal effects.</p>';
  } else
    $("#importance").innerHTML =
      '<div class="empty-state">Feature importance was not exported for this particular fit. Its predictions and performance are available above; select a recorded CatBoost, Random Forest or original Logistic fit to inspect importance.</div>';
}
function renderAblation() {
  $$("[data-ablation]").forEach((button) =>
    button.classList.toggle(
      "active",
      button.dataset.ablation === arena.ablation,
    ),
  );
  const list = original.report.models.filter(
      (m) => m.family === arena.ablation,
    ),
    base = list.find((m) => m.features === "Market").cv_balanced_accuracy;
  $("#ablation").innerHTML =
    '<div class="ablation-grid">' +
    list
      .filter((m) => m.features !== "Market")
      .map((m) => {
        const delta = (m.cv_balanced_accuracy - base) * 100;
        return (
          '<div class="ablation-item"><span>' +
          esc(m.features) +
          '</span><b class="' +
          (delta >= 0 ? "positive" : "negative") +
          '">' +
          (delta >= 0 ? "+" : "") +
          fmt(delta, 2) +
          " pp</b><p>" +
          arena.ablation +
          " · validation balanced accuracy</p></div>"
        );
      })
      .join("") +
    '</div><p class="fine-print">These are changes versus market-only features, not total accuracy. Macro and sentiment did not consistently improve the one-session target. The fresh extension selected enhanced market features.</p>';
}
function renderResearchDetails() {
  const r = extension.report;
  $("#extension-summary").innerHTML =
    '<div class="research-callout"><b>Fresh-test development winner:</b> ' +
    esc(r.selected.family) +
    ", " +
    esc(r.selected.features) +
    ", depth " +
    r.selected.depth +
    ", " +
    r.selected.window +
    "-year rolling history. Classification threshold " +
    pct(r.selected.threshold, 0) +
    "; trading threshold " +
    pct(r.trade_threshold, 0) +
    ". No fresh-test retuning.</div>";
  $("#uncertainty").innerHTML =
    '<div class="uncertainty-row"><div><h3>Fresh balanced accuracy: 95% interval</h3><p>' +
    r.holdout.rows +
    " sessions. The interval includes the 50% baseline, so a durable forecasting edge is not established.</p></div><b>" +
    pct(r.direction_interval.lower_95) +
    " – " +
    pct(r.direction_interval.upper_95) +
    "</b></div>";
}
function dataRows() {
  return explorer[dataView.dataset] || [];
}
function renderData() {
  const rows = dataRows();
  dataView.index = clamp(
    dataView.index < 0 ? rows.length - 1 : dataView.index,
    0,
    rows.length - 1,
  );
  const source = sources[dataView.metric],
    row = rows[dataView.index],
    visible = rows.slice(Math.max(0, dataView.index - 119), dataView.index + 1);
  $("#source-buttons").innerHTML = Object.entries(sources)
    .map(
      ([key, s]) =>
        '<button data-source="' +
        key +
        '" class="' +
        (key === dataView.metric ? "active" : "") +
        '">' +
        s.short +
        "<small>" +
        s.group +
        "</small></button>",
    )
    .join("");
  $("#data-provider").textContent = source.provider;
  $("#data-title").textContent = source.title;
  $("#data-description").textContent = source.description;
  const previous = rows[Math.max(0, dataView.index - 1)][dataView.metric],
    change = row[dataView.metric] - previous;
  $("#data-value").innerHTML =
    "<strong>" +
    esc(source.format(row[dataView.metric])) +
    "</strong><span>" +
    source.unit +
    "</span><small>" +
    (change >= 0 ? "+" : "") +
    fmt(change, 3) +
    " vs previous signal session</small>";
  $("#data-date").max = rows.length - 1;
  $("#data-date").value = dataView.index;
  $("#data-date-label").textContent = row.date;
  lineChart(
    "#data-chart",
    visible.map((r) => r.date),
    [
      {
        name: source.short,
        color: colors.data,
        values: visible.map((r) => r[dataView.metric]),
      },
    ],
    {
      formatter: (x) => fmt(x, dataView.metric === "close" ? 0 : 2),
      description: source.title + " through " + row.date,
      onPick: (i) => {
        dataView.index = Math.max(0, dataView.index - 119) + i;
        renderData();
      },
    },
  );
  $("#availability-caption").textContent =
    "Signal close " + row.date + " → next trade " + row.trade_date;
  $("#availability").innerHTML = [
    "news_sentiment",
    "vix",
    "yield_curve",
    "inflation_yoy",
  ]
    .map(
      (key) =>
        '<div class="availability-row"><div><span>' +
        sources[key].short +
        "</span><small>Assumed available " +
        row[key + "_available_date"] +
        "</small></div><b>" +
        esc(sources[key].format(row[key])) +
        "</b></div>",
    )
    .join("");
  const manifest =
    dataView.dataset === "extension"
      ? extension.report.data
      : original.report.data;
  $("#source-detail").innerHTML =
    '<div class="source-detail"><dl><div><dt>PROVIDER</dt><dd><a href="' +
    esc(source.url) +
    '" target="_blank" rel="noopener">' +
    esc(source.provider) +
    " →</a></dd></div><div><dt>TRANSFORMATION</dt><dd>" +
    esc(source.transformation) +
    "</dd></div><div><dt>AVAILABILITY ASSUMPTION</dt><dd>" +
    esc(source.lag) +
    "</dd></div><div><dt>SELECTED OBSERVATION AVAILABLE BY</dt><dd>" +
    row[dataView.metric + "_available_date"] +
    "</dd></div></dl><p class='fine-print'>Latest-vintage downloads. These lags are assumptions, not proof of point-in-time tradability.</p></div>";
  $("#data-log").innerHTML =
    '<table><thead><tr><th>Signal date</th><th class="number">' +
    esc(source.short) +
    "</th><th>Assumed available</th><th>Next trade</th></tr></thead><tbody>" +
    rows
      .slice(Math.max(0, dataView.index - 9), dataView.index + 1)
      .reverse()
      .map(
        (r) =>
          "<tr><td>" +
          r.date +
          '</td><td class="number">' +
          esc(source.format(r[dataView.metric])) +
          "</td><td>" +
          r[dataView.metric + "_available_date"] +
          "</td><td>" +
          r.trade_date +
          "</td></tr>",
      )
      .join("") +
    "</tbody></table>";
  $("#provenance").innerHTML =
    Object.entries(manifest.files)
      .map(
        ([file, info]) =>
          '<div class="source-row"><span>' +
          esc(file) +
          " · " +
          info.rows.toLocaleString() +
          " observations</span><code>SHA-256 " +
          info.sha256.slice(0, 18) +
          "…</code></div>",
      )
      .join("") +
    '<p class="fine-print">Full source URLs, UTC retrieval times and checksums are recorded in provenance.json. Original code uses the MIT license; third-party data retain their provider terms.</p>';
}
function openDialog(kicker, title, body) {
  const dialog = $("#detail-dialog");
  $("#dialog-kicker").textContent = kicker;
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = body;
  if (!dialog.open) dialog.showModal();
  $("#close-dialog").focus();
}
function openSession(rows, p, result, index, capital, cost, threshold) {
  const row = rows[index],
    active = result.position[index],
    gross = active ? row.market_return : 0,
    charged = active ? (2 * cost) / 10000 : 0;
  const start = capital * result.stats.equity[index],
    net = result.returns[index];
  openDialog(
    "HISTORICAL SESSION / " + row.date,
    row.date + " · " + (active ? "Long position" : "Stayed in cash"),
    '<span class="badge ' +
      (active ? "violet" : "") +
      '">' +
      (active ? "THRESHOLD MET" : "THRESHOLD NOT MET") +
      '</span><div class="dialog-big-number ' +
      (net >= 0 ? "positive" : "negative") +
      '">' +
      signed(net, 2) +
      "</div><p>Net return for this session. The model probability was " +
      pct(p[index], 2) +
      " against a " +
      pct(threshold, 0) +
      ' minimum confidence.</p><dl class="dialog-facts"><div><dt>Signal observed after close</dt><dd>' +
      row.signal_date +
      "</dd></div><div><dt>Trade session</dt><dd>" +
      row.date +
      "</dd></div><div><dt>SPY open-to-close return</dt><dd>" +
      signed(row.market_return, 2) +
      "</dd></div><div><dt>Gross strategy return</dt><dd>" +
      signed(gross, 2) +
      "</dd></div><div><dt>Entry + exit cost</dt><dd>" +
      fmt(charged * 10000, 1) +
      " bps</dd></div><div><dt>Capital at session start</dt><dd>" +
      money(start) +
      "</dd></div><div><dt>Net dollar P&L</dt><dd>" +
      money(start * net) +
      "</dd></div></dl><p>Calculation: position × SPY intraday return − position × 2 × cost per side. No overnight position, cash yield or leverage is included.</p>",
  );
}
function openMonth(key) {
  const { rows, p, result } = currentScenario,
    indices = rows.map((r, i) => i).filter((i) => rows[i].date.startsWith(key));
  const net =
    indices.reduce((wealth, i) => wealth * (1 + result.returns[i]), 1) - 1;
  openDialog(
    "MONTHLY BREAKDOWN",
    new Date(key + "-15T12:00:00").toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }),
    '<div class="dialog-big-number ' +
      (net >= 0 ? "positive" : "negative") +
      '">' +
      signed(net, 2) +
      "</div><p>" +
      indices.length +
      " sessions, " +
      indices.filter((i) => result.position[i]).length +
      ' active positions. Click a session for its prediction and cost calculation.</p><div class="dialog-session-list">' +
      indices
        .map(
          (i) =>
            '<button data-dialog-session="' +
            i +
            '"><span>' +
            rows[i].date +
            " · " +
            (result.position[i] ? "Long" : "Cash") +
            '</span><b class="' +
            (result.returns[i] >= 0 ? "positive" : "negative") +
            '">' +
            signed(result.returns[i], 2) +
            " →</b></button>",
        )
        .join("") +
      "</div>",
  );
}
const help = {
  equity: [
    "The equity curve",
    "This shows how the initial capital changes when each daily net return is compounded. The green line is the model strategy; benchmarks have different exposure. Click a date for its actual decision and trading costs.",
  ],
  return: [
    "Net return, after costs",
    "Net total return is the change in portfolio value after the assumed entry and exit costs. Annualized return converts the same compounded outcome to a 252-session year. A positive historical return is not a guarantee of future profit.",
  ],
  accuracy: [
    "Why balanced accuracy?",
    "Balanced accuracy averages the success rate for up sessions and not-up sessions. Always predicting up scores 50% balanced accuracy even when the market rises more often. It measures direction, not how much money a trading rule earns.",
  ],
  sharpe: [
    "Return relative to variability",
    "Net Sharpe is mean daily net return divided by its sample standard deviation, then multiplied by the square root of 252. The study uses a zero reference rate. It is sensitive to sample length and does not measure all investment risks.",
  ],
  drawdown: [
    "How far did the strategy fall?",
    "Maximum drawdown is the largest percentage drop from a previous portfolio peak, including the initial capital peak. Switch the strategy chart to Drawdown to see when those declines occurred.",
  ],
  threshold: [
    "When does a signal become a trade?",
    "Minimum confidence is the raw model probability needed to enter a long position. Below it, the strategy stays in cash. A higher setting usually reduces activity, but does not guarantee better predictions. Raw probabilities have not been post-calibrated.",
  ],
  cost: [
    "Every active day pays twice",
    "The cost slider is in basis points per side. One basis point is 0.01%. At 2 bps per side, each active session pays 4 bps total: an entry at the open and an exit at the close. Consecutive active days are still separate round trips.",
  ],
  calibration: [
    "Does 60% mean 60%?",
    "Each dot groups similar model probabilities. Its horizontal position is the average predicted up probability; the vertical position is the actual up-session frequency. Perfect reliability follows the diagonal. Larger dots contain more sessions.",
  ],
  importance: [
    "What mattered to this fit?",
    "These bars show normalized training importance or absolute standardized Logistic coefficients. They describe association in a particular fit, not causal influence or a trading recommendation. Different model families use different importance measures.",
  ],
};
function showHelp(key) {
  const item = help[key] || help.return;
  openDialog(
    "METRIC GUIDE",
    item[0],
    "<p>" +
      item[1] +
      '</p><button class="button secondary full" data-dialog-close>Got it</button>',
  );
}
function openGuide() {
  openDialog(
    "A QUICK TOUR",
    "Four ways to explore the research.",
    '<div class="guide-step"><span>01</span><div><h3>Start with one result</h3><p>On Overview, change the sample and model. Every number and chart belongs to that same selection.</p><button class="text-button" data-go="overview">Open overview →</button></div></div><div class="guide-step"><span>02</span><div><h3>Try a different setup</h3><p>Use Strategy builder to change confidence, cost, capital and period. Click a month or session to inspect what happened.</p><button class="text-button" data-go="lab">Open strategy builder →</button></div></div><div class="guide-step"><span>03</span><div><h3>Compare actual predictions</h3><p>Select a model row in Model arena. Its confusion matrix, probability plot and feature importance update together.</p><button class="text-button" data-go="validation">Open model arena →</button></div></div><div class="guide-step"><span>04</span><div><h3>Replay the inputs</h3><p>Choose a series and move the date slider in Data explorer to inspect the values available at that close.</p><button class="text-button" data-go="data">Open data explorer →</button></div></div>',
  );
}
function toast(text) {
  clearTimeout(toastTimer);
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function downloadCSV(filename, header, records) {
  const value = (x) => '"' + String(x ?? "").replaceAll('"', '""') + '"';
  const csv = [
    header.map(value).join(","),
    ...records.map((row) => row.map(value).join(",")),
  ].join("\r\n");
  const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Download prepared: " + filename);
}
function exportScenario() {
  const { rows, p, result } = currentScenario;
  downloadCSV(
    "market-direction-scenario.csv",
    [
      "signal_date",
      "trade_date",
      "model",
      "probability_up",
      "position",
      "market_return",
      "net_return",
      "equity_usd",
      "threshold",
      "cost_per_side_bps",
    ],
    rows.map((row, i) => [
      row.signal_date,
      row.date,
      state.model,
      p[i],
      result.position[i],
      row.market_return,
      result.returns[i],
      state.capital * result.stats.equity[i + 1],
      state.threshold,
      state.cost,
    ]),
  );
}
async function shareScenario() {
  const url = new URL(location.href);
  url.search = "";
  Object.entries({
    sample: state.dataset,
    model: state.model,
    year: state.period,
    threshold: state.threshold,
    cost: state.cost,
    capital: state.capital,
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  url.hash = "lab";
  try {
    await navigator.clipboard.writeText(url.href);
    toast("Scenario link copied. It reopens this exact setup.");
  } catch {
    openDialog(
      "SHARE THIS SETUP",
      "Your scenario link",
      '<p>Copy this link to reopen the same model, sample, period, confidence, costs and capital.</p><input class="share-input" aria-label="Scenario URL" readonly value="' +
        esc(url.href) +
        '">',
    );
    $(".share-input").select();
  }
}
function applyPreset(name) {
  state.threshold = modelFor(state.dataset, state.model).tradeThreshold;
  state.cost = 2;
  if (name === "cost") state.cost = 10;
  if (name === "confidence") state.threshold = 0.65;
  if (name === "participation") state.threshold = 0.5;
  renderLab();
}
function bindEvents() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button,[data-session],[data-model]");
    if (!button) return;
    if (button.dataset.tab || button.dataset.go) {
      if ($("#detail-dialog").open) $("#detail-dialog").close();
      setTab(button.dataset.tab || button.dataset.go, { focus: true });
    }
    if (button.dataset.help) showHelp(button.dataset.help);
    if (button.dataset.question) {
      const key = button.dataset.question;
      if (key === "cost") {
        configureLab("original", original.report.selected_model);
        applyPreset("cost");
        setTab("lab", { focus: true });
        toast("Cost stress loaded: 10 bps each side.");
      }
      if (key === "sentiment") {
        arena.dataset = "original";
        arena.family = "CatBoost";
        arena.model = "catboost__market_sentiment";
        $("#arena-dataset").value = "original";
        $("#arena-family").value = "CatBoost";
        renderArena();
        renderAblation();
        setTab("validation", { focus: true });
      }
      if (key === "timing") {
        dataView.metric = "news_sentiment";
        renderData();
        setTab("data", { focus: true });
      }
    }
    if (button.dataset.preset) applyPreset(button.dataset.preset);
    if (button.dataset.chart) {
      state.chart = button.dataset.chart;
      renderLab();
    }
    if (button.dataset.model) {
      arena.model = button.dataset.model;
      renderArena();
    }
    if (button.dataset.probBin !== undefined) {
      const model = modelFor(arena.dataset, arena.model),
        rows = sampleRows(arena.dataset),
        p = probabilities(arena.dataset, model.id),
        bin = Number(button.dataset.probBin);
      const indices = p
        .map((value, i) => i)
        .filter((i) => clamp(Math.floor(p[i] * 10), 0, 9) === bin);
      const actual = indices.length
        ? indices.reduce((n, i) => n + rows[i].actual_up, 0) / indices.length
        : null;
      openDialog(
        "MODEL CONFIDENCE / " + model.family,
        bin * 10 + "–" + (bin + 1) * 10 + "% predicted probability",
        '<div class="dialog-big-number">' +
          indices.length +
          "</div><p>Evaluation sessions in this probability band for " +
          esc(labelFor(model)) +
          '.</p><dl class="dialog-facts"><div><dt>Observed up-session frequency</dt><dd>' +
          pct(actual) +
          "</dd></div><div><dt>Share of evaluation sample</dt><dd>" +
          pct(indices.length / rows.length) +
          "</dd></div></dl><p>The observed frequency is measured after the fact. It helps inspect raw probability reliability; it does not recalibrate or retrain the model.</p>",
      );
    }
    if (button.dataset.ablation) {
      arena.ablation = button.dataset.ablation;
      renderAblation();
    }
    if (button.dataset.source) {
      dataView.metric = button.dataset.source;
      renderData();
    }
    if (button.dataset.month) openMonth(button.dataset.month);
    if (
      button.dataset.session !== undefined ||
      button.dataset.dialogSession !== undefined
    ) {
      const i = Number(button.dataset.session ?? button.dataset.dialogSession),
        { rows, p, result } = currentScenario;
      openSession(
        rows,
        p,
        result,
        i,
        state.capital,
        state.cost,
        state.threshold,
      );
    }
    if (button.hasAttribute("data-dialog-close")) $("#detail-dialog").close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      const row = event.target.closest("tr[data-model],tr[data-session]");
      if (row) {
        event.preventDefault();
        row.click();
      }
    }
  });
  window.addEventListener("popstate", () =>
    setTab(location.hash.slice(1), { push: false, focus: true }),
  );
  window.addEventListener("hashchange", () =>
    setTab(location.hash.slice(1), { push: false }),
  );
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(
      () => setTab(location.hash.slice(1) || "overview", { push: false }),
      150,
    );
  });
  $("#overview-dataset").addEventListener("change", (event) => {
    overview.dataset = event.target.value;
    overview.model = defaultModel(overview.dataset);
    setupOptions("#overview-model", overview.dataset, overview.model);
    renderOverview();
  });
  $("#overview-model").addEventListener("change", (event) => {
    overview.model = event.target.value;
    renderOverview();
  });
  $("#open-snapshot").addEventListener("click", () => {
    configureLab(overview.dataset, overview.model);
    setTab("lab", { focus: true });
  });
  $("#dataset").addEventListener("change", (event) =>
    configureLab(event.target.value, defaultModel(event.target.value)),
  );
  $("#model").addEventListener("change", (event) => {
    state.model = event.target.value;
    state.threshold = modelFor(state.dataset, state.model).tradeThreshold;
    state.cost = 2;
    renderLab();
  });
  $("#period").addEventListener("change", (event) => {
    state.period = event.target.value;
    renderLab();
  });
  $("#capital").addEventListener("change", (event) => {
    state.capital = clamp(Number(event.target.value) || 10000, 100, 100000000);
    event.target.value = state.capital;
    renderLab();
  });
  $("#threshold").addEventListener("input", (event) => {
    state.threshold = Number(event.target.value);
    renderLab();
  });
  $("#cost").addEventListener("input", (event) => {
    state.cost = Number(event.target.value);
    renderLab();
  });
  $("#show-benchmarks").addEventListener("change", (event) => {
    state.benchmarks = event.target.checked;
    renderLab();
  });
  $("#ledger-filter").addEventListener("change", (event) => {
    state.ledger = event.target.value;
    renderLedger();
  });
  $("#reset").addEventListener("click", () => {
    configureLab(state.dataset, state.model, { keepCapital: false });
    toast("Research settings restored.");
  });
  $("#download-scenario").addEventListener("click", exportScenario);
  $("#share-scenario").addEventListener("click", shareScenario);
  $("#arena-dataset").addEventListener("change", (event) => {
    arena.dataset = event.target.value;
    arena.model = defaultModel(arena.dataset);
    arena.family = "all";
    $("#arena-family").value = "all";
    renderArena();
  });
  $("#arena-family").addEventListener("change", (event) => {
    arena.family = event.target.value;
    renderArena();
  });
  $("#arena-sort").addEventListener("change", (event) => {
    arena.sort = event.target.value;
    renderArena();
  });
  $("#arena-to-builder").addEventListener("click", () => {
    configureLab(arena.dataset, arena.model);
    setTab("lab", { focus: true });
  });
  $("#data-dataset").addEventListener("change", (event) => {
    dataView.dataset = event.target.value;
    dataView.index = -1;
    renderData();
  });
  $("#data-date").addEventListener("input", (event) => {
    dataView.index = Number(event.target.value);
    renderData();
  });
  $("#download-data").addEventListener("click", () => {
    const rows = dataRows().slice(
        Math.max(0, dataView.index - 119),
        dataView.index + 1,
      ),
      metric = dataView.metric;
    downloadCSV(
      "market-direction-" + metric + ".csv",
      ["signal_date", "next_trade_date", metric, "assumed_available_date"],
      rows.map((r) => [
        r.date,
        r.trade_date,
        r[metric],
        r[metric + "_available_date"],
      ]),
    );
  });
  $("#open-guide").addEventListener("click", openGuide);
  $("#close-dialog").addEventListener("click", () =>
    $("#detail-dialog").close(),
  );
  $("#detail-dialog").addEventListener("click", (event) => {
    if (event.target === $("#detail-dialog")) {
      const r = event.target.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        event.target.close();
    }
  });
}
function restoreScenario() {
  const q = new URLSearchParams(location.search);
  if (!q.has("sample")) return;
  const sample = q.get("sample") === "extension" ? "extension" : "original",
    id = q.get("model");
  configureLab(
    sample,
    models(sample).some((m) => m.id === id) ? id : defaultModel(sample),
  );
  const year = q.get("year");
  if ([...$("#period").options].some((o) => o.value === year)) {
    state.period = year;
    $("#period").value = year;
  }
  if (q.has("threshold"))
    state.threshold = clamp(Number(q.get("threshold")) || 0.55, 0.45, 0.75);
  if (q.has("cost")) state.cost = clamp(Number(q.get("cost")) || 0, 0, 20);
  if (q.has("capital"))
    state.capital = clamp(Number(q.get("capital")) || 10000, 100, 100000000);
  $("#capital").value = state.capital;
  renderLab();
}
function navIcons() {
  const paths = [
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    '<path d="M4 20V12h4v8m4 0V4h4v16m4 0v-9h2v9"/>',
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  ];
  $$(".nav-icon").forEach(
    (el, i) =>
      (el.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        paths[i] +
        "</svg>"),
  );
}
async function load() {
  try {
    const fetchJSON = async (name) => {
      const r = await fetch("data/" + name + ".json");
      if (!r.ok) throw new Error("Unable to load " + name + " artifact");
      return r.json();
    };
    [original, extension, profit, explorer] = await Promise.all(
      ["research", "extension", "profitability", "explorer"].map(fetchJSON),
    );
    navIcons();
    overview.model = defaultModel("original");
    arena.model = overview.model;
    setupOptions("#overview-model", "original", overview.model);
    renderOverview();
    configureLab("original", overview.model);
    renderArena();
    renderAblation();
    renderResearchDetails();
    renderData();
    restoreScenario();
    bindEvents();
    $("#loading").hidden = true;
    $("#research").hidden = false;
    setTab(location.hash.slice(1) || "overview", { push: false });
    window.researchFinance = finance;
    window.researchState = () => ({ ...state });
  } catch (error) {
    $("#loading").hidden = true;
    $("#error").hidden = false;
    $("#error").textContent =
      "The research data could not be loaded. Refresh this page or open the GitHub repository. " +
      error.message;
  }
}
load();
