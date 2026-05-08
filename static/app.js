const state = {
  portfolio: [
    { ticker: "ESMV", asset_type: "etf", name: "iShares Edge MSCI USA Min Vol ETF" },
    { ticker: "GEMD", asset_type: "bond", name: "iShares Emerging Markets Bond ETF" },
    { ticker: "LGTH", asset_type: "etf", name: "iShares Global Health ETF" },
    { ticker: "DBVT", asset_type: "stock", name: "DBV Technologies" },
    { ticker: "NVDA", asset_type: "stock", name: "NVIDIA Corporation" },
  ],
  results: [],
  loading: false,
  activeScreen: "briefings",
  activeNotesTab: "summary",
  articleFilter: "all",
  brief: null,
  reminderTimeout: null,
};

const el = {
  briefDate: document.getElementById("brief-date"),
  notifyBtn: document.getElementById("notify-btn"),
  screens: Array.from(document.querySelectorAll(".screen")),
  navItems: Array.from(document.querySelectorAll(".nav-item")),
  greetingTitle: document.getElementById("brief-greeting-title"),
  briefSubtitle: document.getElementById("brief-subtitle"),
  estLength: document.getElementById("est-length"),
  statPortfolio: document.getElementById("stat-portfolio"),
  statGeneral: document.getElementById("stat-general"),
  audioPlayer: document.getElementById("audio-player"),
  generateBtn: document.getElementById("generate-btn"),
  regenBtn: document.getElementById("regen-btn"),
  audioDownload: document.getElementById("audio-download"),
  status: document.getElementById("status"),
  loadingPanel: document.getElementById("loading-panel"),
  quoteOfDay: document.getElementById("quote-of-day"),
  speakerTip: document.getElementById("speaker-tip"),
  usageDisclaimer: document.getElementById("usage-disclaimer"),
  showNotesDate: document.getElementById("show-notes-date"),
  notesTabs: Array.from(document.querySelectorAll("[data-notes-tab]")),
  notesSummary: document.getElementById("notes-summary"),
  notesArticles: document.getElementById("notes-articles"),
  summaryList: document.getElementById("summary-list"),
  tonePositive: document.getElementById("tone-positive"),
  toneNeutral: document.getElementById("tone-neutral"),
  toneNegative: document.getElementById("tone-negative"),
  toneMixed: document.getElementById("tone-mixed"),
  securityNotes: document.getElementById("security-notes"),
  generalNotes: document.getElementById("general-notes"),
  sourceLinksNotes: document.getElementById("source-links-notes"),
  articlesList: document.getElementById("articles-list"),
  articlesCount: document.getElementById("articles-count"),
  articleFilters: Array.from(document.querySelectorAll(".article-filter")),
  listenerName: document.getElementById("listener-name"),
  occupation: document.getElementById("occupation"),
  investorType: document.getElementById("investor-type"),
  appUse: document.getElementById("app-use"),
  generalCategory: document.getElementById("general-category"),
  notificationTime: document.getElementById("notification-time"),
  alarmMode: document.getElementById("alarm-mode"),
  portfolioMeta: document.getElementById("portfolio-meta"),
  stockSearch: document.getElementById("stock-search"),
  assetType: document.getElementById("asset-type"),
  addManual: document.getElementById("add-manual"),
  clearPortfolio: document.getElementById("clear-portfolio"),
  searchResults: document.getElementById("search-results"),
  portfolioList: document.getElementById("portfolio-list"),
  alarmSteps: document.getElementById("alarm-steps"),
  articleSheet: document.getElementById("article-sheet"),
  closeArticleSheet: document.getElementById("close-article-sheet"),
  articleTag: document.getElementById("article-tag"),
  articleTitle: document.getElementById("article-title"),
  articleMeta: document.getElementById("article-meta"),
  articleWhy: document.getElementById("article-why"),
  articlePoints: document.getElementById("article-points"),
  articleLink: document.getElementById("article-link"),
  toast: document.getElementById("toast"),
};

let toastTimer = null;
let searchTimer = null;

function nowDateString() {
  const d = new Date();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle("error", isError);
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2200);
}

function normalizeTicker(value) {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, "");
}

function switchScreen(target) {
  state.activeScreen = target;
  el.screens.forEach((screen) => screen.classList.toggle("is-active", screen.dataset.screen === target));
  el.navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.screenTarget === target));
}

function renderPortfolio() {
  el.portfolioMeta.textContent = `${state.portfolio.length} / 5`;
  el.portfolioList.innerHTML = "";
  if (!state.portfolio.length) {
    const p = document.createElement("p");
    p.className = "subtle dark";
    p.textContent = "Add 5 securities for the MVP brief.";
    el.portfolioList.appendChild(p);
    return;
  }
  state.portfolio.forEach((item) => {
    const row = document.createElement("div");
    row.className = "note-card";
    row.innerHTML = `
      <h4>${item.ticker} <span class="pill">${item.asset_type}</span></h4>
      <p>${item.name || ""}</p>
    `;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn--ghost";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      state.portfolio = state.portfolio.filter((v) => v.ticker !== item.ticker);
      renderPortfolio();
    });
    row.appendChild(remove);
    el.portfolioList.appendChild(row);
  });
}

function addSecurity(entry) {
  const ticker = normalizeTicker(entry.ticker);
  if (!ticker) {
    toast("Enter a valid ticker");
    return;
  }
  if (state.portfolio.some((v) => v.ticker === ticker)) {
    toast(`${ticker} already added`);
    return;
  }
  if (state.portfolio.length >= 5) {
    toast("MVP supports 5 securities only");
    return;
  }
  state.portfolio.push({
    ticker,
    asset_type: entry.asset_type || el.assetType.value,
    name: entry.name || "",
  });
  renderPortfolio();
}

function renderSearchResults() {
  el.searchResults.innerHTML = "";
  if (!state.results.length) {
    el.searchResults.classList.remove("is-open");
    return;
  }
  state.results.forEach((item) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "result-item";
    btn.innerHTML = `<strong>${item.symbol}</strong><br /><small>${item.name}</small>`;
    btn.addEventListener("click", () => {
      addSecurity({ ticker: item.symbol, name: item.name });
      el.stockSearch.value = "";
      state.results = [];
      renderSearchResults();
    });
    li.appendChild(btn);
    el.searchResults.appendChild(li);
  });
  el.searchResults.classList.add("is-open");
}

async function searchTickers(query) {
  const q = query.trim();
  if (!q) {
    state.results = [];
    renderSearchResults();
    return;
  }
  try {
    const res = await fetch(`/stocks/search?q=${encodeURIComponent(q)}&limit=12`);
    if (!res.ok) throw new Error("search failed");
    const payload = await res.json();
    state.results = payload.results || [];
    renderSearchResults();
  } catch (err) {
    setStatus("Stock search failed.", true);
  }
}

function setLoading(isLoading) {
  state.loading = isLoading;
  el.loadingPanel.classList.toggle("hidden", !isLoading);
  el.generateBtn.disabled = isLoading;
  el.regenBtn.disabled = isLoading;
  el.generateBtn.textContent = isLoading ? "Generating..." : "Generate daily brief";
}

function estimateDuration(script) {
  if (!script) return "--:--";
  const words = script.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 140));
  return `0${minutes}:${String(Math.floor((words % 140) / 2)).padStart(2, "0")}`.slice(-5);
}

function renderTone(notes) {
  const tally = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  (notes || []).forEach((note) => {
    const key = (note.sentiment || "neutral").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(tally, key)) tally[key] += 1;
  });
  el.tonePositive.textContent = String(tally.positive);
  el.toneNeutral.textContent = String(tally.neutral);
  el.toneNegative.textContent = String(tally.negative);
  el.toneMixed.textContent = String(tally.mixed);
}

function renderSummary(payload) {
  el.summaryList.innerHTML = "";
  (payload.show_notes_summary || []).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    el.summaryList.appendChild(li);
  });
}

function renderSecurityNotes(payload) {
  el.securityNotes.innerHTML = "";
  (payload.security_impact_notes || []).forEach((note) => {
    const card = document.createElement("div");
    card.className = "note-card";
    card.innerHTML = `
      <h4>${note.ticker} <span class="pill">${note.asset_type}</span></h4>
      <p>${note.update}</p>
      <p><strong>Why it matters:</strong> ${note.why_it_matters}</p>
      <span class="sentiment ${note.sentiment}">${note.sentiment}</span>
    `;
    el.securityNotes.appendChild(card);
  });
}

function renderGeneralNotes(payload) {
  el.generalNotes.innerHTML = "";
  (payload.general_news_notes || []).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    el.generalNotes.appendChild(li);
  });
}

function sourceCategory(link) {
  const title = (link.title || "").toUpperCase();
  const hasPortfolioTicker = state.portfolio.some((item) => title.includes(item.ticker));
  return hasPortfolioTicker ? "portfolio" : "macro";
}

function renderSourceCards(container, links) {
  container.innerHTML = "";
  if (!links.length) {
    const p = document.createElement("p");
    p.className = "subtle dark";
    p.textContent = "No article links yet.";
    container.appendChild(p);
    return;
  }
  links.forEach((link, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "article-row";
    card.innerHTML = `
      <h4>${link.title || "Untitled article"}</h4>
      <p>${link.source} · ${new Date(link.published_at).toLocaleDateString()} · ${sourceCategory(link)}</p>
    `;
    card.addEventListener("click", () => openArticleSheet(link, index));
    container.appendChild(card);
  });
}

function openArticleSheet(link, index) {
  if (!state.brief) return;
  const notes = state.brief.security_impact_notes || [];
  const matchingNote =
    notes.find((n) => (link.title || "").toUpperCase().includes((n.ticker || "").toUpperCase())) || notes[index % Math.max(1, notes.length)] || null;
  const points = state.brief.show_notes_summary || [];

  el.articleTag.textContent = `${link.source_id} · ${sourceCategory(link)}`;
  el.articleTitle.textContent = link.title || "Article";
  el.articleMeta.textContent = `${link.source} · ${new Date(link.published_at).toLocaleString()}`;
  el.articleWhy.textContent = matchingNote ? matchingNote.why_it_matters : "Relevant context from your selected category and portfolio.";
  el.articlePoints.innerHTML = "";
  points.slice(0, 3).forEach((point) => {
    const li = document.createElement("li");
    li.textContent = point;
    el.articlePoints.appendChild(li);
  });
  el.articleLink.href = link.url;
  el.articleSheet.classList.remove("hidden");
}

function closeArticleSheet() {
  el.articleSheet.classList.add("hidden");
}

function renderArticles(payload) {
  const links = payload.source_links || [];
  const filtered = links.filter((link) => {
    if (state.articleFilter === "all") return true;
    return sourceCategory(link) === state.articleFilter;
  });
  el.articlesCount.textContent = `${filtered.length} articles`;
  renderSourceCards(el.articlesList, filtered);
}

function renderAlarmSteps(payload) {
  el.alarmSteps.innerHTML = "";
  (payload.ios_alarm_steps || []).forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    el.alarmSteps.appendChild(li);
  });
}

function renderBrief(payload) {
  state.brief = payload;
  const generatedDate = new Date(payload.generated_at);
  const dateLabel = generatedDate.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  el.briefDate.textContent = dateLabel;
  el.showNotesDate.textContent = dateLabel;
  el.greetingTitle.textContent = payload.greeting || `Good morning, ${payload.listener_name}`;
  el.briefSubtitle.textContent = `${payload.listener_name}, here is your personalised market brief.`;
  el.estLength.textContent = estimateDuration(payload.script || "");
  el.statPortfolio.textContent = String((payload.security_impact_notes || []).length);
  el.statGeneral.textContent = String((payload.general_news_notes || []).length);
  el.quoteOfDay.textContent = payload.quote_of_day || "-";
  el.speakerTip.textContent = payload.speaker_tip || "";
  el.usageDisclaimer.textContent = payload.usage_disclaimer || "Informational only. Not financial advice.";
  el.audioPlayer.src = payload.audio_url;
  el.audioPlayer.load();
  el.audioDownload.href = payload.audio_url;

  renderSummary(payload);
  renderTone(payload.security_impact_notes || []);
  renderSecurityNotes(payload);
  renderGeneralNotes(payload);
  renderSourceCards(el.sourceLinksNotes, payload.source_links || []);
  renderArticles(payload);
  renderAlarmSteps(payload);
}

async function generateDailyBrief() {
  if (state.loading) return;
  if (state.portfolio.length !== 5) {
    setStatus("MVP requires exactly 5 securities.", true);
    toast("Please select exactly 5 securities");
    switchScreen("portfolio");
    return;
  }

  const body = {
    listener_name: el.listenerName.value.trim() || "Investor",
    occupation: el.occupation.value.trim() || "Professional",
    investor_type: el.investorType.value,
    app_use: el.appUse.value,
    portfolio: state.portfolio.map((item) => ({ ticker: item.ticker, asset_type: item.asset_type })),
    general_category: el.generalCategory.value,
    notification_time: el.notificationTime.value || "07:00",
    wants_alarm_mode: Boolean(el.alarmMode.checked),
    hours_back: 24,
    max_articles: 36,
    target_minutes: 6,
  };

  setLoading(true);
  setStatus("Building your daily brief...");
  try {
    const res = await fetch("/daily-brief-mvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to generate briefing");
    }
    const payload = await res.json();
    renderBrief(payload);
    switchScreen("briefings");
    setStatus("Daily brief ready.");
    toast("Briefing ready");
  } catch (err) {
    setStatus(err.message || "Generation failed.", true);
    toast("Generation failed");
  } finally {
    setLoading(false);
  }
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    toast("Notifications unsupported in this browser");
    return;
  }
  const permission = await Notification.requestPermission();
  toast(`Notification permission: ${permission}`);
  scheduleReminder();
}

function scheduleReminder() {
  if (state.reminderTimeout) {
    clearTimeout(state.reminderTimeout);
    state.reminderTimeout = null;
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const raw = el.notificationTime.value || "07:00";
  const [h, m] = raw.split(":").map((v) => Number(v));
  const now = new Date();
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - now.getTime();
  state.reminderTimeout = setTimeout(() => {
    new Notification("Morning Brief Reminder", {
      body: "Your daily financial briefing is ready to generate.",
    });
    scheduleReminder();
  }, delay);
}

function bindEvents() {
  el.navItems.forEach((btn) => btn.addEventListener("click", () => switchScreen(btn.dataset.screenTarget)));
  el.notesTabs.forEach((btn) =>
    btn.addEventListener("click", () => {
      state.activeNotesTab = btn.dataset.notesTab;
      el.notesTabs.forEach((b) => b.classList.toggle("is-active", b === btn));
      el.notesSummary.classList.toggle("is-active", state.activeNotesTab === "summary");
      el.notesArticles.classList.toggle("is-active", state.activeNotesTab === "articles");
    })
  );
  el.articleFilters.forEach((btn) =>
    btn.addEventListener("click", () => {
      state.articleFilter = btn.dataset.filter;
      el.articleFilters.forEach((b) => b.classList.toggle("is-active", b === btn));
      if (state.brief) renderArticles(state.brief);
    })
  );
  el.stockSearch.addEventListener("input", (e) => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchTickers(e.target.value), 180);
  });
  el.stockSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSecurity({ ticker: el.stockSearch.value, asset_type: el.assetType.value });
      el.stockSearch.value = "";
      state.results = [];
      renderSearchResults();
    }
  });
  el.addManual.addEventListener("click", () => {
    addSecurity({ ticker: el.stockSearch.value, asset_type: el.assetType.value });
    el.stockSearch.value = "";
    state.results = [];
    renderSearchResults();
  });
  el.clearPortfolio.addEventListener("click", () => {
    state.portfolio = [];
    renderPortfolio();
    toast("Portfolio cleared");
  });
  el.generateBtn.addEventListener("click", generateDailyBrief);
  el.regenBtn.addEventListener("click", generateDailyBrief);
  el.notifyBtn.addEventListener("click", requestNotifications);
  el.notificationTime.addEventListener("change", scheduleReminder);
  el.closeArticleSheet.addEventListener("click", closeArticleSheet);
  el.articleSheet.addEventListener("click", (e) => {
    if (e.target === el.articleSheet) closeArticleSheet();
  });
  document.addEventListener("click", (e) => {
    if (!el.searchResults.contains(e.target) && e.target !== el.stockSearch) {
      el.searchResults.classList.remove("is-open");
    }
  });
}

function init() {
  el.briefDate.textContent = nowDateString();
  renderPortfolio();
  bindEvents();
  setStatus("Ready. Generate your briefing.");
}

init();
