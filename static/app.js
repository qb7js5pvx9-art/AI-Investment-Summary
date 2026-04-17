const state = {
  watchlist: ["AAPL", "MSFT", "NVDA"],
  results: [],
  loading: false,
};

const el = {
  searchInput: document.getElementById("stock-search"),
  searchResults: document.getElementById("search-results"),
  quickPicks: document.getElementById("quick-picks"),
  watchlist: document.getElementById("watchlist"),
  watchlistMeta: document.getElementById("watchlist-meta"),
  addManual: document.getElementById("add-manual"),
  hoursBack: document.getElementById("hours-back"),
  maxArticles: document.getElementById("max-articles"),
  targetMinutes: document.getElementById("target-minutes"),
  generateBtn: document.getElementById("generate-btn"),
  clearBtn: document.getElementById("clear-btn"),
  status: document.getElementById("status"),
  outputPlaceholder: document.getElementById("output-placeholder"),
  loadingPanel: document.getElementById("loading-panel"),
  outputPanel: document.getElementById("output-panel"),
  toast: document.getElementById("toast"),
  generatedAt: document.getElementById("generated-at"),
  articleCount: document.getElementById("article-count"),
  tickersUsed: document.getElementById("tickers-used"),
  audioPlayer: document.getElementById("audio-player"),
  audioDownload: document.getElementById("audio-download"),
  scriptText: document.getElementById("script-text"),
  sourceList: document.getElementById("source-list"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  tabPanels: {
    script: document.getElementById("tab-script"),
    sources: document.getElementById("tab-sources"),
  },
};

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle("is-error", isError);
}

let toastTimer = null;
function showToast(message) {
  if (!message) return;
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    el.toast.classList.add("hidden");
  }, 2200);
}

function normalizeSymbol(value) {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, "");
}

function renderWatchlist() {
  el.watchlist.innerHTML = "";
  el.watchlistMeta.textContent = `${state.watchlist.length}/10 selected`;
  if (!state.watchlist.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No symbols yet.";
    el.watchlist.appendChild(empty);
    return;
  }

  state.watchlist.forEach((symbol) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${symbol}</span>`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${symbol}`);
    remove.textContent = "x";
    remove.addEventListener("click", () => {
      state.watchlist = state.watchlist.filter((s) => s !== symbol);
      renderWatchlist();
    });
    chip.appendChild(remove);
    el.watchlist.appendChild(chip);
  });
}

function addSymbol(symbol) {
  const clean = normalizeSymbol(symbol);
  if (!clean) {
    setStatus("Enter a valid ticker symbol.", true);
    showToast("Enter a valid ticker symbol");
    return;
  }
  if (state.watchlist.includes(clean)) {
    setStatus(`${clean} is already in your watchlist.`);
    showToast(`${clean} is already selected`);
    return;
  }
  if (state.watchlist.length >= 10) {
    setStatus("Watchlist limit reached (10 symbols).", true);
    showToast("Watchlist limit reached");
    return;
  }

  state.watchlist.push(clean);
  renderWatchlist();
  setStatus(`${clean} added.`);
  showToast(`${clean} added`);
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
    button.className = "result-item";
    button.type = "button";
    button.innerHTML = `<span><strong>${item.symbol}</strong></span><span class="result-name">${item.name}</span>`;
    button.addEventListener("click", () => {
      addSymbol(item.symbol);
      el.searchInput.value = "";
      state.results = [];
      renderSearchResults();
    });
    li.appendChild(button);
    el.searchResults.appendChild(li);
  });

  el.searchResults.classList.add("is-open");
}

let searchTimeout = null;
async function searchStocks(query) {
  if (!query.trim()) {
    state.results = [];
    renderSearchResults();
    return;
  }

  try {
    const res = await fetch(`/stocks/search?q=${encodeURIComponent(query)}&limit=12`);
    if (!res.ok) {
      throw new Error("Failed to search");
    }
    const payload = await res.json();
    state.results = payload.results || [];
    renderSearchResults();
  } catch (err) {
    state.results = [];
    renderSearchResults();
    setStatus("Stock search failed. Check server logs.", true);
  }
}

function activateTab(tabName) {
  el.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === tabName));
  Object.entries(el.tabPanels).forEach(([name, panel]) => {
    panel.classList.toggle("is-active", name === tabName);
  });
}

function setLoadingUI(isLoading) {
  el.loadingPanel.classList.toggle("hidden", !isLoading);
  if (isLoading) {
    el.outputPlaceholder.classList.add("hidden");
    el.outputPanel.classList.add("hidden");
  } else if (el.outputPanel.classList.contains("hidden")) {
    el.outputPlaceholder.classList.remove("hidden");
  }
}

function renderResult(payload) {
  setLoadingUI(false);
  el.outputPlaceholder.classList.add("hidden");
  el.outputPanel.classList.remove("hidden");

  el.generatedAt.textContent = new Date(payload.generated_at).toLocaleString();
  el.articleCount.textContent = String(payload.article_count);
  el.tickersUsed.textContent = (payload.tickers || []).join(", ");
  el.scriptText.textContent = payload.script || "";

  const audioPath = payload.audio_url;
  el.audioPlayer.src = audioPath;
  el.audioPlayer.load();
  el.audioDownload.href = audioPath;

  const entries = Object.entries(payload.citations || {});
  el.sourceList.innerHTML = "";
  if (!entries.length) {
    const li = document.createElement("li");
    li.textContent = "No citations returned.";
    el.sourceList.appendChild(li);
  } else {
    entries.forEach(([sid, url]) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${sid}</strong><br /><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      el.sourceList.appendChild(li);
    });
  }
}

async function generateBriefing() {
  if (state.loading) return;
  if (!state.watchlist.length) {
    setStatus("Add at least one ticker first.", true);
    showToast("Add at least one ticker");
    return;
  }

  const body = {
    tickers: state.watchlist,
    hours_back: Number(el.hoursBack.value),
    max_articles: Number(el.maxArticles.value),
    target_minutes: Number(el.targetMinutes.value),
  };

  state.loading = true;
  el.generateBtn.disabled = true;
  el.generateBtn.textContent = "Generating...";
  setLoadingUI(true);
  setStatus("Fetching news, writing script, and generating audio...");

  try {
    const res = await fetch("/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to generate briefing");
    }

    const payload = await res.json();
    renderResult(payload);
    setStatus("Briefing generated successfully.");
    showToast("Briefing ready");
  } catch (err) {
    setLoadingUI(false);
    setStatus(err.message || "Unexpected error while generating briefing.", true);
    showToast("Generation failed");
  } finally {
    state.loading = false;
    el.generateBtn.disabled = false;
    el.generateBtn.textContent = "Generate morning briefing";
  }
}

function renderQuickPicks() {
  const picks = ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "META", "GOOGL", "SPY"];
  el.quickPicks.innerHTML = "";
  picks.forEach((symbol) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-pick";
    button.textContent = symbol;
    button.addEventListener("click", () => addSymbol(symbol));
    el.quickPicks.appendChild(button);
  });
}

function bindEvents() {
  el.searchInput.addEventListener("input", (event) => {
    const query = event.target.value.trim();
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    searchTimeout = setTimeout(() => searchStocks(query), 180);
  });

  el.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSymbol(el.searchInput.value);
      el.searchInput.value = "";
      state.results = [];
      renderSearchResults();
    }
  });

  el.addManual.addEventListener("click", () => {
    addSymbol(el.searchInput.value);
    el.searchInput.value = "";
    state.results = [];
    renderSearchResults();
  });

  el.clearBtn.addEventListener("click", () => {
    state.watchlist = [];
    renderWatchlist();
    setStatus("Watchlist cleared.");
    showToast("Watchlist cleared");
  });

  el.generateBtn.addEventListener("click", generateBriefing);

  el.tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });

  document.addEventListener("click", (event) => {
    if (!el.searchResults.contains(event.target) && event.target !== el.searchInput) {
      el.searchResults.classList.remove("is-open");
    }
  });
}

async function init() {
  renderWatchlist();
  renderQuickPicks();
  bindEvents();
  setStatus("Ready.");
}

init();
