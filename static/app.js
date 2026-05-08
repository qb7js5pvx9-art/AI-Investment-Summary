const state = {
  portfolio: [
    { ticker: "AAPL", asset_type: "stock", name: "Apple Inc." },
    { ticker: "MSFT", asset_type: "stock", name: "Microsoft Corporation" },
  ],
  results: [],
  loading: false,
};

const el = {
  listenerName: document.getElementById("listener-name"),
  generalCategory: document.getElementById("general-category"),
  notificationTime: document.getElementById("notification-time"),
  alarmMode: document.getElementById("alarm-mode"),
  notifyBtn: document.getElementById("notify-btn"),
  searchInput: document.getElementById("stock-search"),
  assetType: document.getElementById("asset-type"),
  addManual: document.getElementById("add-manual"),
  clearPortfolio: document.getElementById("clear-portfolio"),
  searchResults: document.getElementById("search-results"),
  portfolioList: document.getElementById("portfolio-list"),
  portfolioMeta: document.getElementById("portfolio-meta"),
  generateBtn: document.getElementById("generate-btn"),
  regenBtn: document.getElementById("regen-btn"),
  loadingPanel: document.getElementById("loading-panel"),
  briefContent: document.getElementById("brief-content"),
  briefDate: document.getElementById("brief-date"),
  briefName: document.getElementById("brief-name"),
  briefGreeting: document.getElementById("brief-greeting"),
  audioPlayer: document.getElementById("audio-player"),
  audioDownload: document.getElementById("audio-download"),
  quoteOfDay: document.getElementById("quote-of-day"),
  status: document.getElementById("status"),
  summaryList: document.getElementById("summary-list"),
  securityNotes: document.getElementById("security-notes"),
  generalNotes: document.getElementById("general-notes"),
  sourceLinks: document.getElementById("source-links"),
  alarmSteps: document.getElementById("alarm-steps"),
  speakerTip: document.getElementById("speaker-tip"),
  toast: document.getElementById("toast"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  tabPanels: {
    summary: document.getElementById("tab-summary"),
    articles: document.getElementById("tab-articles"),
    rules: document.getElementById("tab-rules"),
  },
};

let searchTimeout = null;
let toastTimeout = null;

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle("error", isError);
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.toast.classList.add("hidden"), 2400);
}

function normalizeTicker(value) {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, "");
}

function renderPortfolio() {
  el.portfolioList.innerHTML = "";
  el.portfolioMeta.textContent = `${state.portfolio.length} / 5`;
  if (!state.portfolio.length) {
    const p = document.createElement("p");
    p.className = "subtle";
    p.textContent = "Add 5 securities to continue.";
    el.portfolioList.appendChild(p);
    return;
  }
  state.portfolio.forEach((item) => {
    const row = document.createElement("div");
    row.className = "portfolio-item";
    row.innerHTML = `
      <div>
        <p><strong>${item.ticker}</strong> <span class="pill">${item.asset_type}</span></p>
        <p>${item.name || ""}</p>
      </div>
    `;
    const remove = document.createElement("button");
    remove.className = "btn btn--ghost";
    remove.type = "button";
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
    toast(`${ticker} already in portfolio`);
    return;
  }
  if (state.portfolio.length >= 5) {
    toast("Portfolio is limited to 5 securities for MVP");
    return;
  }
  state.portfolio.push({
    ticker,
    asset_type: entry.asset_type || el.assetType.value,
    name: entry.name || "",
  });
  renderPortfolio();
  setStatus(`${ticker} added.`);
}

function renderSearchResults() {
  el.searchResults.innerHTML = "";
  if (!state.results.length) {
    el.searchResults.classList.remove("is-open");
    return;
  }
  state.results.forEach((item) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-item";
    button.innerHTML = `<strong>${item.symbol}</strong><br /><small>${item.name}</small>`;
    button.addEventListener("click", () => {
      addSecurity({ ticker: item.symbol, name: item.name });
      el.searchInput.value = "";
      state.results = [];
      renderSearchResults();
    });
    li.appendChild(button);
    el.searchResults.appendChild(li);
  });
  el.searchResults.classList.add("is-open");
}

async function searchStocks(query) {
  const q = query.trim();
  if (!q) {
    state.results = [];
    renderSearchResults();
    return;
  }
  try {
    const res = await fetch(`/stocks/search?q=${encodeURIComponent(q)}&limit=12`);
    if (!res.ok) throw new Error("Search failed");
    const payload = await res.json();
    state.results = payload.results || [];
    renderSearchResults();
  } catch (err) {
    setStatus("Ticker search failed.", true);
  }
}

function activateTab(name) {
  el.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
  Object.entries(el.tabPanels).forEach(([key, panel]) => panel.classList.toggle("is-active", key === name));
}

function setLoading(isLoading) {
  state.loading = isLoading;
  el.loadingPanel.classList.toggle("hidden", !isLoading);
  el.generateBtn.disabled = isLoading;
  if (!isLoading && state.portfolio.length) {
    el.generateBtn.textContent = "Generate daily brief";
  } else if (isLoading) {
    el.generateBtn.textContent = "Generating...";
  }
}

function renderSources(links = []) {
  el.sourceLinks.innerHTML = "";
  if (!links.length) {
    const p = document.createElement("p");
    p.className = "subtle";
    p.textContent = "No source links yet.";
    el.sourceLinks.appendChild(p);
    return;
  }
  links.forEach((link) => {
    const card = document.createElement("div");
    card.className = "source-card";
    card.innerHTML = `
      <h4>${link.source_id} · ${link.title || "Untitled"}</h4>
      <p>${link.source} · ${new Date(link.published_at).toLocaleString()}</p>
      <p><a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.url}</a></p>
    `;
    el.sourceLinks.appendChild(card);
  });
}

function renderDailyBrief(payload) {
  el.briefContent.classList.remove("hidden");
  el.briefDate.textContent = new Date(payload.generated_at).toLocaleDateString();
  el.briefName.textContent = `${payload.listener_name}'s daily brief`;
  el.briefGreeting.textContent = payload.greeting || "";
  el.quoteOfDay.textContent = `Quote of the day: ${payload.quote_of_day || ""}`;
  el.audioPlayer.src = payload.audio_url;
  el.audioPlayer.load();
  el.audioDownload.href = payload.audio_url;

  el.summaryList.innerHTML = "";
  (payload.show_notes_summary || []).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    el.summaryList.appendChild(li);
  });

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

  el.generalNotes.innerHTML = "";
  (payload.general_news_notes || []).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    el.generalNotes.appendChild(li);
  });

  renderSources(payload.source_links || []);
  el.speakerTip.textContent = payload.speaker_tip || "";
  el.alarmSteps.innerHTML = "";
  (payload.ios_alarm_steps || []).forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    el.alarmSteps.appendChild(li);
  });
}

async function generateDailyBrief() {
  if (state.loading) return;
  if (state.portfolio.length !== 5) {
    setStatus("MVP requires exactly 5 securities.", true);
    toast("Please add exactly 5 securities");
    return;
  }

  const request = {
    listener_name: el.listenerName.value.trim() || "Investor",
    portfolio: state.portfolio.map((item) => ({ ticker: item.ticker, asset_type: item.asset_type })),
    general_category: el.generalCategory.value,
    notification_time: el.notificationTime.value || "07:00",
    wants_alarm_mode: Boolean(el.alarmMode.checked),
    hours_back: 24,
    max_articles: 36,
    target_minutes: 6,
  };

  setLoading(true);
  setStatus("Building your personalised daily brief...");
  try {
    const res = await fetch("/daily-brief-mvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to generate daily brief");
    }
    const payload = await res.json();
    renderDailyBrief(payload);
    setStatus("Daily brief ready.");
    toast("Briefing generated");
  } catch (err) {
    setStatus(err.message || "Generation failed.", true);
    toast("Generation failed");
  } finally {
    setLoading(false);
  }
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    toast("Browser notifications are not supported here");
    return;
  }
  const permission = await Notification.requestPermission();
  toast(`Notification permission: ${permission}`);
}

function bindEvents() {
  el.searchInput.addEventListener("input", (e) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => searchStocks(e.target.value), 200);
  });
  el.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSecurity({ ticker: el.searchInput.value, asset_type: el.assetType.value });
      el.searchInput.value = "";
      state.results = [];
      renderSearchResults();
    }
  });
  el.addManual.addEventListener("click", () => {
    addSecurity({ ticker: el.searchInput.value, asset_type: el.assetType.value });
    el.searchInput.value = "";
    state.results = [];
    renderSearchResults();
  });
  el.clearPortfolio.addEventListener("click", () => {
    state.portfolio = [];
    renderPortfolio();
  });
  el.generateBtn.addEventListener("click", generateDailyBrief);
  el.regenBtn.addEventListener("click", generateDailyBrief);
  el.notifyBtn.addEventListener("click", requestNotifications);
  el.tabs.forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
  document.addEventListener("click", (e) => {
    if (!el.searchResults.contains(e.target) && e.target !== el.searchInput) {
      el.searchResults.classList.remove("is-open");
    }
  });
}

function init() {
  bindEvents();
  renderPortfolio();
  setStatus("Ready. Add 5 securities and generate your daily brief.");
}

init();
