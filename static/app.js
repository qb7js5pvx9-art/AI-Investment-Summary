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
  articleFilter: "portfolio",
  expandedArticleUrl: null,
  articleDetailUrl: null,
  profileView: "profile",
  watchlistRemovePending: null,
  brief: null,
  reminderTimeout: null,
  watchlistQuotes: {},
  preparedArticles: [],
  sessionMutedDomains: new Set(),
  masterUnlocked: false,
  limitCountdownTimer: null,
};

const USER_BRIEF_ERROR_MESSAGE = "Something went wrong, please try again";

const SEEN_ARTICLE_IDS_KEY = "marketcall_seen_article_ids";
const PROFILE_STORAGE_KEY = "marketcall_profile_v1";
const SAVED_NOTES_KEY = "marketcall_saved_notes";
const LAST_TONE_COUNTS_KEY = "marketcall_last_tone_counts";
const BRIEF_LISTENED_KEY = "marketcall_brief_listened_v1";
const DAILY_GENERATION_LIMIT_KEY = "marketcall_daily_generation_limit_v1";
const MASTER_UNLOCK_SESSION_KEY = "marketcall_master_unlocked_session_v1";
const DEFAULT_BRIEF_MINUTES = 4;
const SAVED_ARTICLES_KEY = "savedArticles";
const MUTED_SOURCES_KEY = "mutedSources";
const GENERIC_WHY_PLACEHOLDER = "From your watchlist quote snapshot";
const APP_VERSION = "1.0.0";
const WATCHLIST_SLOT_LIMIT = 5;

const FOCUS_AREA_FULL_LABELS = {
  macro: "Macro Economics",
  "stock-markets": "Stock Markets",
  "central-banks-rates": "Central Banks & Rates",
  "commodities-energy": "Commodities & Energy",
  "technology-ai": "Technology & AI",
  "real-estate-housing": "Real Estate & Housing",
  "crypto-digital-assets": "Crypto & Digital Assets",
  "geopolitics-trade": "Geopolitics & Trade",
  "uk-politics-economy": "UK Politics & Economy",
  "us-politics-economy": "US Politics & Economy",
  sport: "Sport & Business",
  "manufacturing-industry": "Manufacturing & Industry",
  "consumer-retail": "Consumer & Retail",
  "healthcare-pharma": "Healthcare & Pharma",
  "uk-politics": "UK Politics & Economy",
  tech: "Technology & AI",
  energy: "Commodities & Energy",
};

/** Short labels for Articles filter pills. */
const FOCUS_AREA_PILL_LABELS = {
  macro: "Macro",
  "stock-markets": "Markets",
  "central-banks-rates": "Rates",
  "commodities-energy": "Energy",
  "technology-ai": "Tech",
  "real-estate-housing": "Property",
  "crypto-digital-assets": "Crypto",
  "geopolitics-trade": "Geopolitics",
  "uk-politics-economy": "UK",
  "us-politics-economy": "US",
  sport: "Sport",
  "manufacturing-industry": "Industry",
  "consumer-retail": "Consumer",
  "healthcare-pharma": "Healthcare",
  "uk-politics": "UK",
  tech: "Tech",
  energy: "Energy",
};

/** @deprecated Use FOCUS_AREA_FULL_LABELS — kept for profile picker option text. */
const FOCUS_AREA_LABELS = FOCUS_AREA_FULL_LABELS;

const FOCUS_AREA_HINTS = {
  macro: "Focuses on broad economic trends, growth, and global market context.",
  "stock-markets": "Focuses on equity indices, share prices, and market moves.",
  "central-banks-rates": "Focuses on central banks, interest rates, and monetary policy.",
  "commodities-energy": "Focuses on oil, gas, metals, renewables, and commodity markets.",
  "technology-ai": "Focuses on technology companies, AI, semiconductors, and software.",
  "real-estate-housing": "Focuses on property markets, mortgages, and housing policy.",
  "crypto-digital-assets": "Focuses on bitcoin, crypto markets, and digital assets.",
  "geopolitics-trade": "Focuses on geopolitical risk, trade policy, and sanctions.",
  "uk-politics-economy": "Focuses on Westminster, UK policy, and the British economy.",
  "us-politics-economy": "Focuses on Washington, US policy, and the American economy.",
  sport: "Focuses on sports business, media rights, and major events.",
  "manufacturing-industry": "Focuses on factories, industrial output, and supply chains.",
  "consumer-retail": "Focuses on retail sales, brands, and consumer spending.",
  "healthcare-pharma": "Focuses on pharma, biotech, healthcare policy, and drug approvals.",
  "uk-politics": "Focuses on Westminster, UK policy, and the British economy.",
  tech: "Focuses on technology companies, AI, semiconductors, and software.",
  energy: "Focuses on oil, gas, metals, renewables, and commodity markets.",
};

const LEGACY_FOCUS_AREA_KEYS = {
  "uk-politics": "uk-politics-economy",
  tech: "technology-ai",
  energy: "commodities-energy",
};

function normalizeFocusAreaKey(key) {
  const raw = String(key || "macro").trim().toLowerCase();
  const mapped = LEGACY_FOCUS_AREA_KEYS[raw] || raw;
  return Object.prototype.hasOwnProperty.call(FOCUS_AREA_FULL_LABELS, mapped) ? mapped : "macro";
}

function focusAreaPillLabel(key) {
  const k = normalizeFocusAreaKey(key);
  return FOCUS_AREA_PILL_LABELS[k] || FOCUS_AREA_FULL_LABELS[k] || k;
}

function focusAreaKeyFromFullLabel(fullName) {
  const target = String(fullName || "").trim();
  if (!target) return null;
  for (const [key, label] of Object.entries(FOCUS_AREA_FULL_LABELS)) {
    if (label === target) return key;
  }
  if (target === "Macro") return "macro";
  return null;
}

function readProfileFocusCategories() {
  const saved = readProfileStorage();
  if (Array.isArray(saved?.focusCategories) && saved.focusCategories.length) {
    const seen = new Set();
    const out = [];
    for (const raw of saved.focusCategories) {
      const k = normalizeFocusAreaKey(raw);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    if (out.length) return out;
  }
  return [normalizeFocusAreaKey(saved?.generalCategory || el.generalCategory?.value)];
}

function ensureValidArticleFilter() {
  const valid = new Set(["portfolio", "category"]);
  if (!valid.has(state.articleFilter)) state.articleFilter = "portfolio";
}

const DEFAULT_ALARM_STEPS = [
  "On your iPhone, open the Shortcuts app.",
  "Create an automation for the time you wake up.",
  'Add the "Open URLs" action and paste your morning-brief page link.',
  "Optionally add a short pause so the page can load, then pick your speaker.",
];

const el = {
  appTitle: document.getElementById("app-title"),
  appTagline: document.getElementById("app-tagline"),
  notifyBtn: document.getElementById("notify-btn"),
  newStoriesBadge: document.getElementById("new-stories-badge"),
  newStoriesText: document.getElementById("new-stories-text"),
  screens: Array.from(document.querySelectorAll(".screen")),
  navItems: Array.from(document.querySelectorAll(".nav-item")),
  appPhone: document.querySelector(".app-phone"),
  appFootnote: document.getElementById("app-ai-footnote"),
  bottomNav: document.querySelector(".bottom-nav"),
  homeDateLine: document.getElementById("home-date-line"),
  greetingTitle: document.getElementById("brief-greeting-title"),
  briefCard: document.getElementById("brief-card"),
  briefDurationWrap: document.getElementById("brief-duration-wrap"),
  briefDurationLabel: document.getElementById("brief-duration-label"),
  playBtn: document.getElementById("play-btn"),
  playIconPlay: document.getElementById("play-icon-play"),
  playIconPause: document.getElementById("play-icon-pause"),
  episodeTitle: document.getElementById("episode-title"),
  episodeMeta: document.getElementById("episode-meta"),
  playerProgress: document.getElementById("player-progress"),
  progressTrack: document.getElementById("progress-track"),
  progressFill: document.getElementById("progress-fill"),
  progressThumb: document.getElementById("progress-thumb"),
  progressTimeCurrent: document.getElementById("progress-time-current"),
  progressTimeTotal: document.getElementById("progress-time-total"),
  progressCurrent: document.getElementById("progress-current"),
  progressTotal: document.getElementById("progress-total"),
  statStories: document.getElementById("stat-stories"),
  statArticles: document.getElementById("stat-articles"),
  statWatchlist: document.getElementById("stat-watchlist"),
  refreshBriefBtn: document.getElementById("refresh-brief-btn"),
  refreshIcon: document.getElementById("refresh-icon"),
  refreshSpinner: document.getElementById("refresh-spinner"),
  refreshBriefLabel: document.getElementById("refresh-brief-label"),
  homeQuickCards: Array.from(document.querySelectorAll(".home-quick-card")),
  notesNavBadge: document.getElementById("notes-nav-badge"),
  articlesNavBadge: document.getElementById("articles-nav-badge"),
  portfolioInsightsList: document.getElementById("portfolio-insights-list"),
  portfolioInsightsEmpty: document.getElementById("portfolio-insights-empty"),
  portfolioInsightsMore: document.getElementById("portfolio-insights-more"),
  audioPlayer: document.getElementById("audio-player"),
  listenStatusMessage: document.getElementById("listen-status-message"),
  showNotesDate: document.getElementById("show-notes-date"),
  notesEmpty: document.getElementById("notes-empty"),
  notesLoading: document.getElementById("notes-loading"),
  notesBody: document.getElementById("notes-body"),
  notesTopHeadline: document.getElementById("notes-top-headline"),
  notesSecondaryStories: document.getElementById("notes-secondary-stories"),
  tonePositive: document.getElementById("tone-positive"),
  toneNeutral: document.getElementById("tone-neutral"),
  toneNegative: document.getElementById("tone-negative"),
  toneCompare: document.getElementById("tone-compare"),
  securityNotes: document.getElementById("security-notes"),
  generalNotes: document.getElementById("general-notes"),
  articlesEyebrow: document.getElementById("articles-eyebrow"),
  articlesLoading: document.getElementById("articles-loading"),
  articlesBody: document.getElementById("articles-body"),
  articlesTopStorySlot: document.getElementById("articles-top-story-slot"),
  articlesSectionLabel: document.getElementById("articles-section-label"),
  articlesList: document.getElementById("articles-list"),
  articlesEmpty: document.getElementById("articles-empty"),
  articlesFilters: document.getElementById("articles-filters"),
  articleDetailBack: document.getElementById("article-detail-back"),
  articleDetailSave: document.getElementById("article-detail-save"),
  articleDetailMeta: document.getElementById("article-detail-meta"),
  articleDetailHeadline: document.getElementById("article-detail-headline"),
  articleDetailSummary: document.getElementById("article-detail-summary"),
  articleDetailWhy: document.getElementById("article-detail-why"),
  articleDetailWhyText: document.getElementById("article-detail-why-text"),
  articleDetailOpen: document.getElementById("article-detail-open"),
  articlesPage: document.querySelector(".articles-page"),
  manageMutedSources: document.getElementById("manage-muted-sources"),
  mutedSourcesSheet: document.getElementById("muted-sources-sheet"),
  closeMutedSheet: document.getElementById("close-muted-sheet"),
  mutedSourcesList: document.getElementById("muted-sources-list"),
  mutedSourcesEmpty: document.getElementById("muted-sources-empty"),
  listenerName: document.getElementById("listener-name"),
  listenerEmail: document.getElementById("listener-email"),
  occupation: document.getElementById("occupation"),
  investorType: document.getElementById("investor-type"),
  investorTypeHint: document.getElementById("investor-type-hint"),
  appUse: document.getElementById("app-use"),
  generalCategory: document.getElementById("general-category"),
  focusAreaHint: document.getElementById("focus-area-hint"),
  notificationTime: document.getElementById("notification-time"),
  alarmMode: document.getElementById("alarm-mode"),
  alarmSetupBtn: document.getElementById("alarm-setup-btn"),
  masterPassword: document.getElementById("master-password"),
  masterUnlockBtn: document.getElementById("master-unlock-btn"),
  masterUnlockStatus: document.getElementById("master-unlock-status"),
  accountPageTitle: document.getElementById("account-page-title"),
  accountSegment: document.getElementById("account-segment"),
  accountSegmentThumb: document.getElementById("account-segment-thumb"),
  accountViewProfile: document.getElementById("account-view-profile"),
  accountViewWatchlist: document.getElementById("account-view-watchlist"),
  profileDisplayName: document.getElementById("profile-display-name"),
  profileDisplayInvestor: document.getElementById("profile-display-investor"),
  profileDisplayEmail: document.getElementById("profile-display-email"),
  profileDisplayFocus: document.getElementById("profile-display-focus"),
  profileDisplayNotify: document.getElementById("profile-display-notify"),
  profileDisplayAppUse: document.getElementById("profile-display-app-use"),
  accountVersion: document.getElementById("account-version"),
  watchlistEmpty: document.getElementById("watchlist-empty"),
  watchlistUpgradeNudge: document.getElementById("watchlist-upgrade-nudge"),
  accountPickerSheet: document.getElementById("account-picker-sheet"),
  accountPickerTitle: document.getElementById("account-picker-title"),
  accountPickerList: document.getElementById("account-picker-list"),
  accountFieldSheet: document.getElementById("account-field-sheet"),
  accountFieldSheetTitle: document.getElementById("account-field-sheet-title"),
  accountFieldSheetBody: document.getElementById("account-field-sheet-body"),
  accountFieldSheetSave: document.getElementById("account-field-sheet-save"),
  portfolioMeta: document.getElementById("portfolio-meta"),
  watchlistCapMsg: document.getElementById("watchlist-cap-msg"),
  stockSearch: document.getElementById("stock-search"),
  assetType: document.getElementById("asset-type"),
  addManual: document.getElementById("add-manual"),
  searchResults: document.getElementById("search-results"),
  portfolioList: document.getElementById("portfolio-list"),
  alarmSheet: document.getElementById("alarm-sheet"),
  closeAlarmSheet: document.getElementById("close-alarm-sheet"),
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

/**
 * Fail fast if markup and script are out of sync (avoids half-rendered briefs and cryptic null errors).
 */
function assertRequiredDom() {
  const required = [
    ["appTitle", el.appTitle],
    ["appTagline", el.appTagline],
    ["notifyBtn", el.notifyBtn],
    ["newStoriesBadge", el.newStoriesBadge],
    ["newStoriesText", el.newStoriesText],
    ["homeDateLine", el.homeDateLine],
    ["greetingTitle", el.greetingTitle],
    ["briefCard", el.briefCard],
    ["playBtn", el.playBtn],
    ["episodeTitle", el.episodeTitle],
    ["episodeMeta", el.episodeMeta],
    ["progressTrack", el.progressTrack],
    ["progressFill", el.progressFill],
    ["statStories", el.statStories],
    ["statArticles", el.statArticles],
    ["statWatchlist", el.statWatchlist],
    ["refreshBriefBtn", el.refreshBriefBtn],
    ["portfolioInsightsList", el.portfolioInsightsList],
    ["audioPlayer", el.audioPlayer],
    ["listenStatusMessage", el.listenStatusMessage],
    ["showNotesDate", el.showNotesDate],
    ["notesEmpty", el.notesEmpty],
    ["notesLoading", el.notesLoading],
    ["notesBody", el.notesBody],
    ["notesTopHeadline", el.notesTopHeadline],
    ["notesSecondaryStories", el.notesSecondaryStories],
    ["tonePositive", el.tonePositive],
    ["toneNeutral", el.toneNeutral],
    ["toneNegative", el.toneNegative],
    ["toneCompare", el.toneCompare],
    ["securityNotes", el.securityNotes],
    ["generalNotes", el.generalNotes],
    ["articlesList", el.articlesList],
    ["articlesEyebrow", el.articlesEyebrow],
    ["articlesBody", el.articlesBody],
    ["listenerName", el.listenerName],
    ["listenerEmail", el.listenerEmail],
    ["occupation", el.occupation],
    ["investorType", el.investorType],
    ["appUse", el.appUse],
    ["generalCategory", el.generalCategory],
    ["focusAreaHint", el.focusAreaHint],
    ["notificationTime", el.notificationTime],
    ["alarmMode", el.alarmMode],
    ["alarmSetupBtn", el.alarmSetupBtn],
    ["portfolioMeta", el.portfolioMeta],
    ["watchlistCapMsg", el.watchlistCapMsg],
    ["stockSearch", el.stockSearch],
    ["assetType", el.assetType],
    ["addManual", el.addManual],
    ["searchResults", el.searchResults],
    ["portfolioList", el.portfolioList],
    ["alarmSheet", el.alarmSheet],
    ["closeAlarmSheet", el.closeAlarmSheet],
    ["alarmSteps", el.alarmSteps],
    ["articleSheet", el.articleSheet],
    ["closeArticleSheet", el.closeArticleSheet],
    ["articleTag", el.articleTag],
    ["articleTitle", el.articleTitle],
    ["articleMeta", el.articleMeta],
    ["articleWhy", el.articleWhy],
    ["articlePoints", el.articlePoints],
    ["articleLink", el.articleLink],
    ["toast", el.toast],
  ];
  const missing = required.filter(([, node]) => !node).map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `UI markup is missing required elements (null refs): ${missing.join(", ")}. ` +
        "Restore ids in static/index.html or reload without cache."
    );
  }
  if (!el.navItems.length) throw new Error("Missing .nav-item buttons.");
  if (!el.articlesFilters) throw new Error("Missing #articles-filters container.");
  if (!el.screens.length) throw new Error("Missing .screen sections.");
}

let toastTimer = null;
let searchTimer = null;
let audioElementListenersBound = false;
/** Prevents duplicate global/UI listeners if bindEvents were ever invoked more than once. */
let appUiEventsBound = false;
/** Timeouts driving in-flight status copy while waiting on `/daily-brief-mvp` (cleared when loading ends). */
let briefProgressTimeouts = [];
/** AbortController for the in-flight `/daily-brief-mvp` request (cancel button). */
let activeBriefAbortController = null;

function resolveMediaUrl(relativeOrAbsolute) {
  if (!relativeOrAbsolute) return "";
  try {
    return new URL(relativeOrAbsolute, window.location.origin).href;
  } catch {
    return relativeOrAbsolute;
  }
}

/** Strip model citation tags like [S1] or [S12, S19] from text shown in the UI (audio/script payloads unchanged). */
function stripSourceCitationMarkers(value) {
  if (value == null) return "";
  let s = String(value).replace(/\[\s*S\d+(?:\s*,\s*S\d+)*\s*\]/gi, "");
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  return s;
}

/** Raw `security_impact_notes` from the API (snake_case; tolerate camelCase or a JSON string). */
function primarySecurityImpactNotes(payload) {
  let v = payload.security_impact_notes ?? payload.securityImpactNotes;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = [];
    }
  }
  return Array.isArray(v) ? v : [];
}

/** One line of human-readable session snapshot for the Notes cards (quote feed only; no model text). */
function formatQuoteSnapshotLine(q) {
  const ticker = String(q?.ticker || "").trim();
  const name = String(q?.display_name || "").trim();
  const label =
    name && name.toUpperCase() !== ticker.toUpperCase() ? `${ticker} (${name})` : ticker || "Holding";
  const bits = [];
  const price = formatQuotePrice(q);
  const change = formatQuotePointAndPercent(q);
  if (price) bits.push(`Current price: ${price}`);
  if (change) bits.push(`Change today: ${change}`);
  if (!bits.length) return "";
  return `${label}: ${bits.join(", ")}.`;
}

function quoteChangePercentValue(quote) {
  if (!quote || quote.change_pct == null || quote.change_pct === "") {
    if (!quote || quote.change_percent == null || quote.change_percent === "") return null;
  }
  const raw = quote?.change_pct ?? quote?.change_percent;
  const pct = Number(raw);
  return Number.isFinite(pct) ? pct : null;
}

function quoteChangeValue(quote) {
  if (!quote || quote.change == null || quote.change === "") return null;
  const change = Number(quote?.change);
  return Number.isFinite(change) ? change : null;
}

function formatQuotePrice(quote) {
  if (!quote || quote.price == null || quote.price === "") return "";
  const price = Number(quote?.price);
  if (!Number.isFinite(price) || price === 0) return "";
  return `$${price.toFixed(2)}`;
}

function formatQuoteChangeToday(quote) {
  const pct = quoteChangePercentValue(quote);
  if (pct == null || pct === 0) return "";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}% today`;
}

function formatQuotePointAndPercent(quote) {
  const change = quoteChangeValue(quote);
  const pct = quoteChangePercentValue(quote);
  if (change == null || pct == null) return "";
  if (change === 0 && pct === 0) return "";
  const changeSign = change >= 0 ? "+" : "-";
  const pctSign = pct > 0 ? "+" : "";
  return `${changeSign}$${Math.abs(change).toFixed(2)} (${pctSign}${pct.toFixed(2)}% today)`;
}

function quoteChangeClassName(quote, prefix) {
  const pct = quoteChangePercentValue(quote);
  if (pct == null || Math.abs(pct) < 1e-9) return "";
  return pct > 0 ? `${prefix}--up` : `${prefix}--down`;
}

function impactNotesForNotesUi(payload) {
  return primarySecurityImpactNotes(payload);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** British English locale for all user-visible dates (consistent regardless of device region). */
const UK_LOCALE = "en-GB";

function formatBritishDateFull(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString(UK_LOCALE, { day: "numeric", month: "long", year: "numeric" });
}

/** e.g. "13 May" when the year matches `reference`, otherwise "13 May 2025". */
function formatBritishDateInYear(date, reference = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const ref = reference instanceof Date ? reference : new Date(reference);
  if (d.getFullYear() === ref.getFullYear()) {
    return d.toLocaleDateString(UK_LOCALE, { day: "numeric", month: "long" });
  }
  return formatBritishDateFull(d);
}

function formatBritishDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString(UK_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSourceCategoryLabel(category) {
  if (category === "portfolio") return "Portfolio";
  if (category === "macro") return "Macro";
  return String(category || "").replace(/^\w/, (c) => c.toUpperCase());
}

function truncatePreviewText(text, maxLen) {
  const t = String(text || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!t) return "";
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > Math.min(48, maxLen * 0.45) ? cut.slice(0, lastSpace) : cut.trimEnd();
  return `${base.replace(/[.,;:]$/, "")}…`;
}

function deriveFeaturedArticlePreview(link) {
  if (!state.brief) return "";
  const notes = impactNotesForNotesUi(state.brief);
  const t = (link.title || "").toUpperCase();
  const matchingNote = notes.find((n) => t.includes(String(n.ticker || "").toUpperCase())) || null;
  const raw = matchingNote
    ? String(matchingNote.update || matchingNote.why_it_matters || "").trim()
    : String((state.brief.show_notes_summary || [])[0] || "").trim();
  return truncatePreviewText(stripSourceCitationMarkers(raw), 130);
}

/** mm:ss for display clocks */
function formatDurationSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "--:--";
  const s = Math.round(totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Rough spoken length from script word count (~150 wpm). */
function estimateSecondsFromScript(script) {
  if (!script || !script.trim()) return null;
  const words = script.trim().split(/\s+/).length;
  return (words / 150) * 60;
}

function getAudioDurationSeconds() {
  const a = el.audioPlayer;
  if (!a) return null;
  if (Number.isFinite(a.duration) && a.duration > 0) return a.duration;
  if (state.brief) {
    const est = estimateSecondsFromScript(state.brief.script || "");
    if (est != null) return est;
  }
  return null;
}

function updatePlayerDurationLabels() {
  const totalSec = getAudioDurationSeconds();
  const totalLabel = totalSec != null ? formatDurationSeconds(totalSec) : "0:00";
  if (el.progressTotal) el.progressTotal.textContent = totalLabel;
  if (el.progressTimeTotal) el.progressTimeTotal.textContent = totalLabel;
  if (state.brief && el.briefDurationLabel) {
    el.briefDurationLabel.textContent = `${estimateBriefMinutes(state.brief)} min`;
  }
}

function updateProgressUi() {
  const a = el.audioPlayer;
  if (!a || !el.progressFill) return;
  const total = getAudioDurationSeconds();
  const current = Number.isFinite(a.currentTime) ? a.currentTime : 0;
  const pct = total && total > 0 ? Math.min(100, (current / total) * 100) : 0;
  const currentLabel = formatDurationSeconds(current);
  el.progressFill.style.width = `${pct}%`;
  if (el.progressThumb) el.progressThumb.style.left = `${pct}%`;
  if (el.progressCurrent) el.progressCurrent.textContent = currentLabel;
  if (el.progressTimeCurrent) el.progressTimeCurrent.textContent = currentLabel;
  if (el.progressTrack) {
    el.progressTrack.setAttribute("aria-valuenow", String(Math.round(pct)));
    el.progressTrack.setAttribute("aria-valuemax", "100");
  }
}

function syncPlayButtonState() {
  const a = el.audioPlayer;
  const hasSrc = Boolean(a?.src);
  const playing = hasSrc && a && !a.paused && !a.ended;
  if (el.playBtn) {
    el.playBtn.disabled = state.loading || !hasSrc || Boolean(a?.error);
    el.playBtn.classList.toggle("is-playing", playing);
    el.playBtn.setAttribute("aria-label", playing ? "Pause briefing" : "Play briefing");
  }
  el.playIconPlay?.classList.toggle("hidden", playing);
  el.playIconPause?.classList.toggle("hidden", !playing);
  syncHomeEpisodeMeta();
}

function onAudioLoadedMetadata() {
  updatePlayerDurationLabels();
  updateProgressUi();
  syncPlayButtonState();
}

function onAudioDurationChange() {
  updatePlayerDurationLabels();
  updateProgressUi();
}

function onAudioTimeUpdate() {
  updateProgressUi();
}

function onAudioError() {
  const a = el.audioPlayer;
  if (!a?.src) return;
  const code = a.error?.code;
  const msg =
    code === MediaError.MEDIA_ERR_NETWORK
      ? "Network error while loading audio."
      : code === MediaError.MEDIA_ERR_DECODE
        ? "Audio decoding failed."
        : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? "Audio file missing or URL invalid."
          : "Could not load briefing audio.";
  setStatus(msg, true);
  toast("Audio failed to load");
  syncPlayButtonState();
}

function bindAudioElementListeners() {
  if (audioElementListenersBound) return;
  if (!el.audioPlayer) {
    throw new Error("Missing required #audio-player element in index.html.");
  }
  audioElementListenersBound = true;
  const a = el.audioPlayer;
  a.addEventListener("loadedmetadata", onAudioLoadedMetadata);
  a.addEventListener("durationchange", onAudioDurationChange);
  a.addEventListener("timeupdate", onAudioTimeUpdate);
  a.addEventListener("error", onAudioError);
  ["play", "pause", "ended"].forEach((evt) => a.addEventListener(evt, syncPlayButtonState));
  a.addEventListener("ended", () => {
    markBriefListened();
    syncHomeEpisodeMeta();
  });
}

/** Browser-local day-part for greetings (must match `DailyBriefRequest.local_time_of_day` on the server). */
function getLocalTimeOfDay() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  return "evening";
}

function greetingStemForPeriod(period) {
  if (period === "afternoon") return "Good afternoon";
  if (period === "evening") return "Good evening";
  return "Good morning";
}

function firstNameFrom(rawName) {
  const trimmed = (rawName || "").trim();
  if (!trimmed) return "Investor";
  return trimmed.split(/\s+/)[0];
}

function buildLocalGreeting(rawName) {
  return `${greetingStemForPeriod(getLocalTimeOfDay())}, ${firstNameFrom(rawName)}.`;
}

function formatHomeDateLine(date = new Date()) {
  return date.toLocaleDateString(UK_LOCALE, { weekday: "long", day: "numeric", month: "long" });
}

function getLondonMinutesAndWeekday(now = new Date()) {
  const parts = new Intl.DateTimeFormat(UK_LOCALE, {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: dayMap[weekday] ?? 0, minutes: hour * 60 + minute };
}

function formatMarketWaitLabel(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** LSE hours (Europe/London) for the home date line suffix. */
function getMarketStatusSuffix() {
  const { weekday, minutes } = getLondonMinutesAndWeekday();
  const open = 8 * 60;
  const close = 16 * 60 + 30;
  if (weekday === 0 || weekday === 6) return "Markets closed";
  if (minutes < open) {
    return `Markets open in ${formatMarketWaitLabel(open - minutes)}`;
  }
  if (minutes < close) {
    const untilClose = close - minutes;
    if (untilClose <= 60) return `Markets close in ${formatMarketWaitLabel(untilClose)}`;
    return "Markets open";
  }
  return "Markets closed";
}

function refreshHomeDateLine() {
  if (!el.homeDateLine) return;
  el.homeDateLine.textContent = `${formatHomeDateLine(new Date())} · ${getMarketStatusSuffix()}`;
}

function briefListenedStorageKey(payload) {
  if (!payload?.generated_at) return null;
  const day = new Date(payload.generated_at).toDateString();
  return `${BRIEF_LISTENED_KEY}:${day}`;
}

function markBriefListened(payload = state.brief) {
  const key = briefListenedStorageKey(payload);
  if (!key) return;
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}

function hasListenedToBrief(payload = state.brief) {
  const key = briefListenedStorageKey(payload);
  if (!key) return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function estimateBriefMinutes(payload) {
  const script = payload?.script || "";
  if (script.trim()) {
    const words = script.trim().split(/\s+/).length;
    return Math.max(1, Math.round(words / 150));
  }
  const sec = getAudioDurationSeconds();
  if (sec != null && sec > 0) return Math.max(1, Math.round(sec / 60));
  return DEFAULT_BRIEF_MINUTES;
}

function countBriefStories(payload) {
  if (!payload) return 0;
  const summary = (payload.show_notes_summary || []).length;
  const macro = (payload.general_news_notes || []).length;
  return summary + macro;
}

function countWatchlistCoverage(payload) {
  if (!payload) return 0;
  return impactNotesForNotesUi(payload).length;
}

function isBriefReady() {
  return Boolean(state.brief && (state.brief.audio_url || state.brief.script) && !state.loading);
}

function isUnavailableInsightText(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  return false;
}

function sentimentSignal(sentimentKey) {
  if (sentimentKey === "positive") {
    return { label: "↑ Positive", className: "home-insight-row__signal--positive" };
  }
  if (sentimentKey === "negative") {
    return { label: "↓ Caution", className: "home-insight-row__signal--caution" };
  }
  return { label: "↔ Watch", className: "home-insight-row__signal--watch" };
}

function setBriefStatsSkeleton(active) {
  for (const node of [el.statStories, el.statArticles, el.statWatchlist]) {
    if (!node) continue;
    if (active) {
      node.textContent = "";
      node.classList.add("brief-stat__value--skeleton");
    } else {
      node.classList.remove("brief-stat__value--skeleton");
    }
  }
}

function setBriefProgressVisible(visible) {
  if (!el.playerProgress) return;
  el.playerProgress.classList.toggle("brief-progress--hidden", !visible);
  el.playerProgress.setAttribute("aria-hidden", visible ? "false" : "true");
}

const AI_FOOTNOTE_SCREENS = new Set(["briefings", "show-notes", "articles", "portfolio", "article-detail"]);

function syncAiFootnote() {
  if (!el.appFootnote) return;
  const screen = state.activeScreen;
  if (!AI_FOOTNOTE_SCREENS.has(screen)) {
    el.appFootnote.classList.add("hidden");
    return;
  }
  let show = false;
  if (screen === "portfolio") {
    show = true;
  } else if (state.loading) {
    show = false;
  } else if (screen === "briefings") {
    show = isBriefReady();
  } else {
    show = Boolean(state.brief);
  }
  el.appFootnote.classList.toggle("hidden", !show);
}

function syncHomePageChrome() {
  syncAiFootnote();
  const ready = isBriefReady();
  if (el.listenStatusMessage) {
    const hideStatus = state.loading || !ready;
    el.listenStatusMessage.classList.toggle("hidden", hideStatus);
    if (hideStatus) el.listenStatusMessage.textContent = "";
  }
}

function renderInsightSkeletonRows(count = 3) {
  if (!el.portfolioInsightsList) return;
  el.portfolioInsightsList.innerHTML = "";
  for (let i = 0; i < count; i += 1) {
    const li = document.createElement("li");
    li.className = "home-insight-row home-insight-row--skeleton";
    li.setAttribute("aria-hidden", "true");
    li.innerHTML = `
      <span class="insight-sk insight-sk--chip"></span>
      <span class="insight-sk--lines">
        <span class="insight-sk insight-sk--line insight-sk--line-full"></span>
        <span class="insight-sk insight-sk--line insight-sk--line-short"></span>
      </span>
      <span class="insight-sk insight-sk--signal"></span>
    `;
    el.portfolioInsightsList.appendChild(li);
  }
}

function renderHomeQuickCards(payload) {
  const notesCount = countNotesItems(payload);
  const articleCount = deduplicatedArticleCount(payload);
  if (el.notesNavBadge) {
    el.notesNavBadge.textContent = notesCount === 1 ? "1 item" : `${notesCount} items`;
  }
  if (el.articlesNavBadge) {
    el.articlesNavBadge.textContent = articleCount === 1 ? "1 article" : `${articleCount} articles`;
  }
}

function syncHomeEpisodeMeta() {
  if (!el.episodeMeta) return;
  if (state.loading) {
    el.episodeMeta.textContent = "AI-narrated";
    return;
  }
  if (!state.brief) {
    el.episodeMeta.textContent = "Tap Refresh to generate · AI-narrated";
    return;
  }
  if (hasListenedToBrief()) {
    el.episodeMeta.textContent = "Listened today";
    return;
  }
  const a = el.audioPlayer;
  if (a?.src && !a.paused && !a.ended) {
    el.episodeMeta.textContent = "Now playing · AI-narrated";
    return;
  }
  el.episodeMeta.textContent = "AI-narrated · Ready now";
}

function syncHomeBriefUi() {
  refreshHomeDateLine();
  if (el.greetingTitle) {
    const name = state.brief?.listener_name || el.listenerName?.value;
    el.greetingTitle.textContent = state.brief?.greeting
      ? stripSourceCitationMarkers(state.brief.greeting)
      : buildLocalGreeting(name);
  }
  const ready = isBriefReady();
  if (el.briefDurationWrap) {
    el.briefDurationWrap.classList.toggle("hidden", !ready);
  }
  if (el.briefDurationLabel && ready) {
    el.briefDurationLabel.textContent = `${estimateBriefMinutes(state.brief)} min`;
  }
  if (el.briefCard) {
    el.briefCard.classList.toggle("brief-card--loading", Boolean(state.loading));
  }
  setBriefProgressVisible(ready);
  if (el.episodeTitle) {
    if (state.loading) {
      el.episodeTitle.textContent = "Generating your brief…";
    } else if (!ready) {
      el.episodeTitle.textContent = "Generate your brief to listen";
    } else {
      el.episodeTitle.textContent = deriveEpisodeTitle(state.brief);
    }
  }
  syncHomeEpisodeMeta();
  if (state.loading) {
    setBriefStatsSkeleton(true);
  } else if (ready) {
    setBriefStatsSkeleton(false);
    if (el.statStories) el.statStories.textContent = String(countBriefStories(state.brief));
    if (el.statArticles) el.statArticles.textContent = String(deduplicatedArticleCount(state.brief));
    if (el.statWatchlist) el.statWatchlist.textContent = String(countWatchlistCoverage(state.brief));
  } else {
    setBriefStatsSkeleton(false);
    if (el.statStories) el.statStories.textContent = "0";
    if (el.statArticles) el.statArticles.textContent = "0";
    if (el.statWatchlist) el.statWatchlist.textContent = "0";
  }
  renderHomeQuickCards(state.brief);
  renderPortfolioInsights(state.brief);
  syncHomePageChrome();
}

function taglineForPeriod(period) {
  if (period === "afternoon") return "Your afternoon brief";
  if (period === "evening") return "Your evening brief";
  return "Your morning brief";
}

/** App header tagline + document title from local clock. */
function refreshAppTitle() {
  const period = getLocalTimeOfDay();
  const tagline = taglineForPeriod(period);
  if (el.appTagline) el.appTagline.textContent = tagline;
  document.title = `MarketCall — ${tagline}`;
}

function formatBritishTimeShort(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString(UK_LOCALE, { hour: "numeric", minute: "2-digit" });
}

function formatBritishDateShort(date) {
  return formatBritishDateInYear(date, new Date());
}

function countNotesItems(payload) {
  if (!payload) return state.portfolio.length;
  const summary = (payload.show_notes_summary || []).length;
  const holdings = impactNotesForNotesUi(payload).length;
  return summary + holdings || state.portfolio.length;
}

function readSeenArticleIds() {
  try {
    const raw = localStorage.getItem(SEEN_ARTICLE_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeSeenArticleIds(ids) {
  try {
    localStorage.setItem(SEEN_ARTICLE_IDS_KEY, JSON.stringify([...new Set(ids.map(String))]));
  } catch {
    /* ignore quota errors */
  }
}

function todayLocalKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function midnightTonight(date = new Date()) {
  const next = new Date(date);
  next.setHours(24, 0, 0, 0);
  return next;
}

function formatCountdownToMidnight(now = new Date()) {
  const ms = Math.max(0, midnightTonight(now).getTime() - now.getTime());
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function readDailyGenerationLimit() {
  try {
    const raw = localStorage.getItem(DAILY_GENERATION_LIMIT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDailyGenerationLimit(value) {
  try {
    localStorage.setItem(DAILY_GENERATION_LIMIT_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function markDailyBriefGenerated(payload) {
  const record = {
    date: todayLocalKey(),
    generatedAt: payload?.generated_at || new Date().toISOString(),
    count: 1,
  };
  const stored = writeDailyGenerationLimit(record);
  console.info("Daily generation limit recorded", { stored, date: record.date });
  syncDailyLimitUi();
}

function hasReachedDailyLimit() {
  if (state.masterUnlocked) return false;
  const saved = readDailyGenerationLimit();
  return saved?.date === todayLocalKey() && Number(saved.count || 0) >= 1;
}

function readMasterUnlockSession() {
  try {
    return sessionStorage.getItem(MASTER_UNLOCK_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMasterUnlockSession(unlocked) {
  try {
    if (unlocked) sessionStorage.setItem(MASTER_UNLOCK_SESSION_KEY, "1");
    else sessionStorage.removeItem(MASTER_UNLOCK_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function syncMasterUnlockUi() {
  if (el.masterUnlockStatus) {
    el.masterUnlockStatus.textContent = state.masterUnlocked
      ? "Unlimited generation unlocked for this session."
      : "One successful brief per day.";
  }
  if (el.masterPassword) {
    el.masterPassword.disabled = state.masterUnlocked;
    if (state.masterUnlocked) el.masterPassword.value = "";
  }
  if (el.masterUnlockBtn) {
    el.masterUnlockBtn.disabled = state.masterUnlocked;
    el.masterUnlockBtn.textContent = state.masterUnlocked ? "Unlocked" : "Unlock";
  }
}

function syncDailyLimitUi() {
  syncMasterUnlockUi();
  setRefreshButtonLoading(state.loading);
}

function startDailyLimitCountdownTimer() {
  if (state.limitCountdownTimer) clearInterval(state.limitCountdownTimer);
  state.limitCountdownTimer = setInterval(() => {
    syncDailyLimitUi();
  }, 1000);
}

function countNewStories(links) {
  if (!links?.length) return 0;
  const seen = new Set(readSeenArticleIds());
  return links.filter((l) => l.source_id && !seen.has(String(l.source_id))).length;
}

function updateNewStoriesBadge(links) {
  const count = countNewStories(links || []);
  if (!el.newStoriesBadge || !el.newStoriesText) return;
  if (count <= 0) {
    el.newStoriesBadge.classList.add("hidden");
    el.newStoriesText.textContent = "0 new stories since yesterday";
    return;
  }
  el.newStoriesBadge.classList.remove("hidden");
  const label = count === 1 ? "1 new story since yesterday" : `${count} new stories since yesterday`;
  el.newStoriesText.textContent = label;
}

function markCurrentArticlesSeen() {
  if (!state.brief?.source_links?.length) return;
  const ids = state.brief.source_links.map((l) => String(l.source_id)).filter(Boolean);
  writeSeenArticleIds([...readSeenArticleIds(), ...ids]);
  updateNewStoriesBadge(state.brief.source_links);
}

/** Home greeting before / without a generated brief. */
function refreshIdleHeroGreeting() {
  if (state.brief) {
    syncHomeBriefUi();
    return;
  }
  syncHomeBriefUi();
}

function setStatus(message, isError = false) {
  if (!el.listenStatusMessage) {
    throw new Error("Missing required #listen-status-message element in index.html.");
  }
  el.listenStatusMessage.textContent = message;
  el.listenStatusMessage.classList.toggle("error", isError);
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

function syncAppHeaderTagline(target) {
  if (!el.appTagline) return;
  if (target === "portfolio") {
    el.appTagline.textContent = "Profile & watchlist";
    return;
  }
  refreshAppTitle();
}

function switchScreen(target) {
  state.activeScreen = target;
  el.screens.forEach((screen) => screen.classList.toggle("is-active", screen.dataset.screen === target));
  el.appPhone?.classList.toggle("app-phone--home", target === "briefings");
  el.appPhone?.classList.toggle("app-phone--articles", target === "articles");
  el.appPhone?.classList.toggle("app-phone--article-detail", target === "article-detail");
  el.appPhone?.classList.toggle("app-phone--account", target === "portfolio");
  el.navItems.forEach((item) => {
    const active =
      item.dataset.screenTarget === target ||
      (target === "article-detail" && item.dataset.screenTarget === "articles");
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  syncAppHeaderTagline(target);
  if (target === "articles") {
    markCurrentArticlesSeen();
    renderArticles();
  }
  if (target === "article-detail") {
    renderArticleDetail(state.articleDetailUrl);
  }
  if (target === "briefings") {
    refreshHomeDateLine();
    refreshIdleHeroGreeting();
  }
  if (target === "portfolio") {
    renderAccountScreen();
    void fetchWatchlistQuotes();
  }
  if (target === "show-notes") renderNotesSummary(state.brief);
  syncAiFootnote();
}

function readProfileStorage() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveProfileToStorage() {
  const focusKey = normalizeFocusAreaKey(el.generalCategory?.value);
  const data = {
    listenerName: el.listenerName?.value?.trim() || "Investor",
    email: el.listenerEmail?.value?.trim() || "",
    occupation: el.occupation?.value?.trim() || "Professional",
    investorType: el.investorType?.value || "General investor",
    appUse: el.appUse?.value || "alarm",
    generalCategory: focusKey,
    focusCategories: [focusKey],
    notificationTime: el.notificationTime?.value || "07:00",
    alarmMode: Boolean(el.alarmMode?.checked),
    portfolio: state.portfolio,
  };
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota errors */
  }
}

function loadProfileFromStorage() {
  const saved = readProfileStorage();
  if (!saved) return;
  if (saved.listenerName && el.listenerName) el.listenerName.value = saved.listenerName;
  if (saved.email != null && el.listenerEmail) el.listenerEmail.value = saved.email;
  if (saved.occupation && el.occupation) el.occupation.value = saved.occupation;
  if (saved.investorType && el.investorType) {
    const normalized = saved.investorType === "Long-term investor" ? "Long term investor" : saved.investorType;
    el.investorType.value = normalized;
  }
  if (saved.appUse && el.appUse) {
    el.appUse.value = saved.appUse === "morning-brief" ? "manual" : saved.appUse;
  }
  if (saved.generalCategory && el.generalCategory) {
    const focusKey = normalizeFocusAreaKey(saved.generalCategory);
    el.generalCategory.value = el.generalCategory.querySelector(`option[value="${focusKey}"]`)
      ? focusKey
      : "macro";
  }
  if (saved.notificationTime && el.notificationTime) el.notificationTime.value = saved.notificationTime;
  if (typeof saved.alarmMode === "boolean" && el.alarmMode) el.alarmMode.checked = saved.alarmMode;
  if (Array.isArray(saved.portfolio) && saved.portfolio.length) {
    state.portfolio = saved.portfolio.map((item) => ({
      ticker: normalizeTicker(item.ticker),
      asset_type: (item.asset_type || "stock").toLowerCase(),
      name: item.name || "",
    }));
  }
}

function syncFocusAreaHint() {
  if (!el.focusAreaHint || !el.generalCategory) return;
  const key = normalizeFocusAreaKey(el.generalCategory.value);
  el.focusAreaHint.textContent = FOCUS_AREA_HINTS[key] || FOCUS_AREA_HINTS.macro;
}

function assetTypeBadgeClass(assetType) {
  const t = (assetType || "stock").toLowerCase();
  if (t === "etf") return "watchlist-type-badge--etf";
  if (t === "bond") return "watchlist-type-badge--bond";
  return "watchlist-type-badge--stock";
}

function assetTypeLabel(assetType) {
  const t = (assetType || "stock").toLowerCase();
  if (t === "etf") return "ETF";
  if (t === "bond") return "Bond";
  return "Stock";
}

function notesHoldingTypeBadgeClass(assetType) {
  const t = (assetType || "stock").toLowerCase();
  if (t === "etf") return "notes-holding-type-badge--etf";
  if (t === "bond") return "notes-holding-type-badge--bond";
  return "notes-holding-type-badge--stock";
}

function formatWatchlistChange(quote) {
  if (!formatQuotePrice(quote)) return { text: "", className: "" };
  return {
    text: formatQuoteChangeToday(quote),
    className: quoteChangeClassName(quote, "watchlist-row__change"),
  };
}

async function fetchWatchlistQuotes() {
  if (!state.portfolio.length) return;
  const tickers = state.portfolio.map((i) => i.ticker).join(",");
  try {
    const res = await fetch(`/stocks/quotes?tickers=${encodeURIComponent(tickers)}`);
    if (!res.ok) return;
    const payload = await res.json();
    state.watchlistQuotes = payload.quotes || {};
    if (state.activeScreen === "portfolio") renderPortfolio();
  } catch {
    /* quotes are optional for display */
  }
}

function firstNameFromProfile(name) {
  const n = String(name || "").trim();
  if (!n) return "Investor";
  return n.split(/\s+/)[0];
}

function truncateEmailDisplay(email, maxLen = 26) {
  const e = String(email || "").trim();
  if (!e) return "";
  if (e.length <= maxLen) return e;
  const at = e.indexOf("@");
  if (at < 1) return `${e.slice(0, maxLen - 1)}…`;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const room = maxLen - domain.length - 2;
  if (room < 2) return `${e.slice(0, maxLen - 1)}…`;
  return `${local.slice(0, room)}…@${domain}`;
}

function appUseDisplayLabel() {
  const v = el.appUse?.value || "alarm";
  return v === "alarm" ? "Alarm briefing" : "Manual";
}

function focusAreaDisplayLabel() {
  return FOCUS_AREA_LABELS[normalizeFocusAreaKey(el.generalCategory?.value)] || FOCUS_AREA_LABELS.macro;
}

function notifyTimeDisplayLabel() {
  const raw = el.notificationTime?.value || "07:00";
  return raw;
}

function syncAlarmSetupRowVisibility() {
  if (!el.alarmSetupBtn || !el.alarmMode) return;
  el.alarmSetupBtn.classList.toggle("hidden", !el.alarmMode.checked);
}

function renderProfileDisplay() {
  if (el.profileDisplayName) {
    el.profileDisplayName.textContent = firstNameFromProfile(el.listenerName?.value);
  }
  if (el.profileDisplayInvestor) {
    el.profileDisplayInvestor.textContent = el.investorType?.value || "General investor";
  }
  if (el.profileDisplayEmail) {
    const email = String(el.listenerEmail?.value || "").trim();
    if (email) {
      el.profileDisplayEmail.textContent = truncateEmailDisplay(email);
      el.profileDisplayEmail.classList.remove("account-row__value--muted");
    } else {
      el.profileDisplayEmail.textContent = "Not set";
      el.profileDisplayEmail.classList.add("account-row__value--muted");
    }
  }
  if (el.profileDisplayFocus) el.profileDisplayFocus.textContent = focusAreaDisplayLabel();
  if (el.profileDisplayNotify) el.profileDisplayNotify.textContent = notifyTimeDisplayLabel();
  if (el.profileDisplayAppUse) el.profileDisplayAppUse.textContent = appUseDisplayLabel();
  if (el.accountVersion) el.accountVersion.textContent = `MarketCall v${APP_VERSION}`;
  syncAlarmSetupRowVisibility();
}

function updateAccountSegmentThumb() {
  if (!el.accountSegment || !el.accountSegmentThumb) return;
  const active = el.accountSegment.querySelector(".account-segment__btn.is-active");
  if (!active) return;
  const segmentRect = el.accountSegment.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  el.accountSegmentThumb.style.width = `${activeRect.width}px`;
  el.accountSegmentThumb.style.transform = `translateX(${activeRect.left - segmentRect.left}px)`;
}

function setAccountPageTitle(view) {
  if (!el.accountPageTitle) return;
  const next = view === "watchlist" ? "Watchlist." : "Profile.";
  el.accountPageTitle.classList.add("is-fading");
  window.setTimeout(() => {
    el.accountPageTitle.textContent = next;
    el.accountPageTitle.classList.remove("is-fading");
  }, 75);
}

function switchAccountView(view) {
  const next = view === "watchlist" ? "watchlist" : "profile";
  if (state.profileView === next) return;
  state.profileView = next;
  state.watchlistRemovePending = null;

  el.accountSegment?.querySelectorAll(".account-segment__btn").forEach((btn) => {
    const active = btn.dataset.accountView === next;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  updateAccountSegmentThumb();
  setAccountPageTitle(next);

  el.accountViewProfile?.classList.toggle("is-active", next === "profile");
  el.accountViewWatchlist?.classList.toggle("is-active", next === "watchlist");
  if (el.accountViewProfile) {
    if (next === "profile") el.accountViewProfile.removeAttribute("hidden");
    else el.accountViewProfile.setAttribute("hidden", "");
  }
  if (el.accountViewWatchlist) {
    if (next === "watchlist") el.accountViewWatchlist.removeAttribute("hidden");
    else el.accountViewWatchlist.setAttribute("hidden", "");
  }

  window.scrollTo({ top: 0, behavior: "instant" });
  document.querySelector(".account-page")?.scrollIntoView({ block: "start", behavior: "instant" });

  if (next === "watchlist") renderPortfolio();
}

function openUpgradePlaceholder() {
  toast("MarketCall Pro — coming soon");
}

function closeAccountPicker() {
  el.accountPickerSheet?.classList.add("hidden");
}

let accountFieldSheetSaveHandler = null;

function closeAccountFieldSheet() {
  el.accountFieldSheet?.classList.add("hidden");
  if (el.accountFieldSheetBody) el.accountFieldSheetBody.innerHTML = "";
  accountFieldSheetSaveHandler = null;
}

function openAccountFieldSheet({ title, inputType, value, placeholder = "" }) {
  if (!el.accountFieldSheet || !el.accountFieldSheetBody || !el.accountFieldSheetTitle) return;
  closeAccountPicker();
  el.accountFieldSheetTitle.textContent = title;
  el.accountFieldSheetBody.innerHTML = "";
  const input = document.createElement("input");
  input.className = `account-field-sheet__input${inputType === "time" ? " account-field-sheet__input--time" : ""}`;
  input.type = inputType === "time" ? "time" : inputType === "email" ? "email" : "text";
  input.value = value || "";
  if (placeholder) input.placeholder = placeholder;
  input.autocomplete = inputType === "email" ? "email" : inputType === "text" ? "name" : "off";
  el.accountFieldSheetBody.appendChild(input);
  el.accountFieldSheet.classList.remove("hidden");
  window.setTimeout(() => {
    input.focus();
    if (inputType === "time" && typeof input.showPicker === "function") {
      try {
        input.showPicker();
      } catch {
        /* showPicker may require a direct user gesture */
      }
    }
  }, 50);
  return input;
}

function saveAccountFieldSheet() {
  const input = el.accountFieldSheetBody?.querySelector("input");
  if (!input || !accountFieldSheetSaveHandler) return;
  const ok = accountFieldSheetSaveHandler(input.value);
  if (ok !== false) closeAccountFieldSheet();
}

function openAccountPicker({ title, options, value, onSelect }) {
  if (!el.accountPickerSheet || !el.accountPickerList || !el.accountPickerTitle) return;
  el.accountPickerTitle.textContent = title;
  el.accountPickerList.innerHTML = "";
  options.forEach((opt) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `account-picker-sheet__option${opt.value === value ? " is-selected" : ""}`;
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      onSelect(opt.value);
      closeAccountPicker();
      renderProfileDisplay();
      saveProfileToStorage();
    });
    li.appendChild(btn);
    el.accountPickerList.appendChild(li);
  });
  el.accountPickerSheet.classList.remove("hidden");
}

function editProfileName() {
  openAccountFieldSheet({
    title: "Your name",
    inputType: "text",
    value: el.listenerName?.value?.trim() || "",
    placeholder: "First name",
  });
  accountFieldSheetSaveHandler = (raw) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) {
      toast("Name cannot be empty");
      return false;
    }
    if (el.listenerName) el.listenerName.value = trimmed;
    saveProfileToStorage();
    refreshIdleHeroGreeting();
    renderProfileDisplay();
    return true;
  };
}

function editProfileEmail() {
  openAccountFieldSheet({
    title: "Email address",
    inputType: "email",
    value: el.listenerEmail?.value?.trim() || "",
    placeholder: "your@email.com (optional)",
  });
  accountFieldSheetSaveHandler = (raw) => {
    if (el.listenerEmail) el.listenerEmail.value = String(raw || "").trim();
    saveProfileToStorage();
    renderProfileDisplay();
    return true;
  };
}

function openInvestorTypePicker() {
  if (!el.investorType) return;
  const options = Array.from(el.investorType.options).map((o) => ({
    value: o.value,
    label: o.textContent || o.value,
  }));
  openAccountPicker({
    title: "Investor type",
    options,
    value: el.investorType.value,
    onSelect: (v) => {
      el.investorType.value = v;
    },
  });
}

function openFocusAreaPicker() {
  if (!el.generalCategory) return;
  const options = Array.from(el.generalCategory.options).map((o) => ({
    value: o.value,
    label: o.textContent || o.value,
  }));
  openAccountPicker({
    title: "Focus area",
    options,
    value: el.generalCategory.value,
    onSelect: (v) => {
      el.generalCategory.value = normalizeFocusAreaKey(v);
      syncFocusAreaHint();
      saveProfileToStorage();
      buildArticleFilterPills();
      renderProfileDisplay();
      if (state.brief) renderArticles();
    },
  });
}

function openAppUsePicker() {
  if (!el.appUse) return;
  const options = Array.from(el.appUse.options).map((o) => ({
    value: o.value,
    label: o.textContent || o.value,
  }));
  openAccountPicker({
    title: "App use",
    options,
    value: el.appUse.value,
    onSelect: (v) => {
      el.appUse.value = v;
    },
  });
}

function openNotifyTimePicker() {
  const current = el.notificationTime?.value || "07:00";
  openAccountFieldSheet({
    title: "Notify at",
    inputType: "time",
    value: current,
  });
  accountFieldSheetSaveHandler = (raw) => {
    const next = String(raw || "").trim() || "07:00";
    if (el.notificationTime) el.notificationTime.value = next;
    saveProfileToStorage();
    renderProfileDisplay();
    scheduleReminder();
    return true;
  };
}

function clearAllUserData() {
  if (
    !window.confirm(
      "Are you sure? This will delete all your saved data and preferences."
    )
  ) {
    return;
  }
  [
    PROFILE_STORAGE_KEY,
    SAVED_ARTICLES_KEY,
    SAVED_NOTES_KEY,
    LAST_TONE_COUNTS_KEY,
    BRIEF_LISTENED_KEY,
    DAILY_GENERATION_LIMIT_KEY,
    SEEN_ARTICLE_IDS_KEY,
    MUTED_SOURCES_KEY,
  ].forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  });
  state.portfolio = [];
  state.brief = null;
  state.preparedArticles = [];
  state.watchlistQuotes = {};
  state.sessionMutedDomains = new Set();
  state.masterUnlocked = false;
  writeMasterUnlockSession(false);
  if (el.listenerName) el.listenerName.value = "Angus";
  if (el.listenerEmail) el.listenerEmail.value = "";
  if (el.investorType) el.investorType.value = "General investor";
  if (el.generalCategory) el.generalCategory.value = "macro";
  if (el.notificationTime) el.notificationTime.value = "07:00";
  if (el.appUse) el.appUse.value = "alarm";
  if (el.alarmMode) el.alarmMode.checked = true;
  renderAccountScreen();
  renderNotesSummary(null);
  renderArticles();
  syncHomeBriefUi();
  syncDailyLimitUi();
  refreshIdleHeroGreeting();
  toast("All data cleared");
}

function renderAccountScreen() {
  renderProfileDisplay();
  renderPortfolio();
  updateAccountSegmentThumb();
}

function syncWatchlistToolbarState() {
  const used = state.portfolio.length;
  const atCap = used >= WATCHLIST_SLOT_LIMIT;
  if (el.portfolioMeta) {
    el.portfolioMeta.textContent = `${used} / ${WATCHLIST_SLOT_LIMIT} slots`;
    el.portfolioMeta.classList.toggle("is-full", atCap);
  }
  if (el.watchlistCapMsg) {
    el.watchlistCapMsg.classList.toggle("hidden", !atCap);
  }
  if (el.addManual) el.addManual.disabled = atCap;
  if (el.watchlistUpgradeNudge) el.watchlistUpgradeNudge.classList.toggle("hidden", !atCap);
}

function finalizeRemoveWatchlistItem(ticker) {
  state.portfolio = state.portfolio.filter((v) => v.ticker !== ticker);
  delete state.watchlistQuotes[ticker];
  state.watchlistRemovePending = null;
  saveProfileToStorage();
  renderPortfolio();
  void fetchWatchlistQuotes();
}

function removeWatchlistItem(ticker) {
  finalizeRemoveWatchlistItem(ticker);
}

function renderPortfolio() {
  syncWatchlistToolbarState();
  if (!el.portfolioList) return;
  el.portfolioList.innerHTML = "";

  const hasStocks = state.portfolio.length > 0;
  el.portfolioList.classList.toggle("hidden", !hasStocks);
  el.watchlistEmpty?.classList.toggle("hidden", hasStocks);

  if (!hasStocks) {
    renderHomeQuickCards(state.brief);
    renderPortfolioInsights(state.brief);
    syncHomeBriefUi();
    return;
  }

  state.portfolio.forEach((item) => {
    const row = document.createElement("div");
    row.className = "account-watchlist-item";
    row.style.maxHeight = `${row.scrollHeight || 56}px`;
    const name = escapeHtml(item.name || "");
    const ticker = item.ticker;
    const tickerHtml = escapeHtml(ticker);
    const avatar = escapeHtml(ticker.slice(0, 4));
    const isPending = state.watchlistRemovePending === ticker;
    const quote = state.watchlistQuotes[ticker] || quoteForTicker(ticker, state.brief);
    const priceText = formatQuotePrice(quote);
    const change = formatWatchlistChange(quote);
    const quoteHtml = priceText
      ? `<div class="account-watchlist-item__quote">
          <span class="account-watchlist-item__price">${escapeHtml(priceText)}</span>
          ${change.text ? `<span class="account-watchlist-item__change ${escapeHtml(change.className)}">${escapeHtml(change.text)}</span>` : ""}
        </div>`
      : "";

    row.innerHTML = `
      <span class="account-watchlist-item__avatar" aria-hidden="true">${avatar}</span>
      <div class="account-watchlist-item__copy">
        <span class="account-watchlist-item__ticker">${tickerHtml}</span>
        ${name ? `<p class="account-watchlist-item__name">${name}</p>` : ""}
      </div>
      <div class="account-watchlist-item__actions">
        ${quoteHtml}
        ${
          isPending
            ? `<button type="button" class="account-watchlist-item__confirm" data-confirm-remove="${escapeHtml(ticker)}">Confirm remove</button>
               <button type="button" class="account-watchlist-item__cancel" data-cancel-remove>Cancel</button>`
            : `<button type="button" class="account-watchlist-item__remove" data-remove-ticker="${escapeHtml(ticker)}">Remove</button>`
        }
      </div>`;

    if (!isPending) {
      row.querySelector("[data-remove-ticker]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        state.watchlistRemovePending = ticker;
        renderPortfolio();
      });
    } else {
      row.querySelector("[data-confirm-remove]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        row.classList.add("is-removing");
        window.setTimeout(() => finalizeRemoveWatchlistItem(ticker), 200);
      });
      row.querySelector("[data-cancel-remove]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        state.watchlistRemovePending = null;
        renderPortfolio();
      });
    }

    el.portfolioList.appendChild(row);
  });

  renderHomeQuickCards(state.brief);
  renderPortfolioInsights(state.brief);
  if (el.statWatchlist && state.brief) {
    el.statWatchlist.textContent = String(countWatchlistCoverage(state.brief));
  }
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
  if (state.portfolio.length >= WATCHLIST_SLOT_LIMIT) {
    toast("Your list is full — five is the max for now.");
    return;
  }
  state.portfolio.push({
    ticker,
    asset_type: entry.asset_type || el.assetType.value,
    name: entry.name || "",
  });
  saveProfileToStorage();
  renderPortfolio();
  void fetchWatchlistQuotes();
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

const DEFAULT_LOADING_PROGRESS = "Putting your brief together...";

function clearBriefProgress() {
  briefProgressTimeouts.forEach((id) => clearTimeout(id));
  briefProgressTimeouts = [];
}

/** Reserved for future staged progress; loading UI lives in the brief card and insight skeletons. */
function beginBriefProgress() {
  clearBriefProgress();
  setStatus("");
}

/** Idle label for the in-card refresh control (icon is separate). */
function refreshBriefButtonIdleLabel() {
  if (hasReachedDailyLimit()) return `Resets in ${formatCountdownToMidnight()}`;
  return state.brief ? "Refresh" : "Generate";
}

function syncRefreshBriefButtonIdleLabel() {
  if (!el.refreshBriefLabel || state.loading) return;
  el.refreshBriefLabel.textContent = refreshBriefButtonIdleLabel();
}

function setRefreshButtonLoading(isLoading) {
  if (!el.refreshBriefBtn) return;
  const limited = hasReachedDailyLimit();
  el.refreshBriefBtn.disabled = isLoading || limited;
  el.refreshBriefBtn.classList.toggle("brief-refresh--loading", isLoading);
  el.refreshBriefBtn.classList.toggle("brief-refresh--limited", !isLoading && limited);
  el.refreshBriefBtn.classList.toggle("brief-refresh--ready", !isLoading && !limited && isBriefReady());
  el.refreshIcon?.classList.toggle("hidden", isLoading);
  el.refreshSpinner?.classList.toggle("hidden", !isLoading);
  if (el.refreshBriefLabel) {
    el.refreshBriefLabel.textContent = isLoading ? "Generating…" : refreshBriefButtonIdleLabel();
  }
}

function setLoading(isLoading) {
  state.loading = isLoading;
  setRefreshButtonLoading(isLoading);
  if (isLoading) {
    beginBriefProgress();
  } else {
    clearBriefProgress();
  }
  syncHomeBriefUi();
  syncPlayButtonState();
  renderNotesSummary(state.brief);
  renderArticles();
}

async function toggleAudioPlayback() {
  const a = el.audioPlayer;
  if (!a) {
    toast("Audio player is not available. Reload the page.");
    return;
  }
  if (!a.src) {
    toast("Generate your daily brief first — then you can listen.");
    return;
  }
  if (a.error) {
    toast("Fix the audio error below, or regenerate your brief.");
    return;
  }
  try {
    if (a.paused) {
      await a.play();
    } else {
      a.pause();
    }
  } catch (err) {
    setStatus("Playback was blocked or failed. Try the controls on the player below.", true);
    toast("Playback failed");
  }
  syncPlayButtonState();
}

let progressScrubbing = false;

function scrubRatioFromClientX(clientX) {
  const track = el.progressTrack;
  if (!track) return 0;
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

function scrubAudioToClientX(clientX) {
  const a = el.audioPlayer;
  if (!a?.src || !el.progressTrack) return;
  const total = getAudioDurationSeconds();
  if (!total || total <= 0) return;
  a.currentTime = scrubRatioFromClientX(clientX) * total;
  updateProgressUi();
}

function setProgressScrubbing(active) {
  progressScrubbing = active;
  el.progressTrack?.classList.toggle("is-scrubbing", active);
}

function skipAudioSeconds(delta) {
  const a = el.audioPlayer;
  if (!a?.src) return;
  const total = getAudioDurationSeconds();
  if (!total || total <= 0) return;
  a.currentTime = Math.min(total, Math.max(0, a.currentTime + delta));
  updateProgressUi();
}

function bindProgressScrubbing() {
  const track = el.progressTrack;
  if (!track) return;

  track.addEventListener("pointerdown", (e) => {
    if (!el.audioPlayer?.src) return;
    if (e.button !== 0) return;
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    setProgressScrubbing(true);
    scrubAudioToClientX(e.clientX);
  });

  track.addEventListener("pointermove", (e) => {
    if (!progressScrubbing) return;
    scrubAudioToClientX(e.clientX);
  });

  const endScrub = (e) => {
    if (!progressScrubbing) return;
    setProgressScrubbing(false);
    if (track.hasPointerCapture(e.pointerId)) {
      track.releasePointerCapture(e.pointerId);
    }
  };

  track.addEventListener("pointerup", endScrub);
  track.addEventListener("pointercancel", endScrub);

  track.addEventListener("keydown", (e) => {
    const a = el.audioPlayer;
    const total = getAudioDurationSeconds();
    if (!a?.src || !total) return;
    const step = 10;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      skipAudioSeconds(step);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      skipAudioSeconds(-step);
    }
  });
}

function normalizeSentimentKey(raw) {
  const key = String(raw || "neutral").toLowerCase();
  if (key === "mixed") return "neutral";
  if (key === "positive" || key === "negative") return key;
  return "neutral";
}

function readSavedNoteIds() {
  try {
    const raw = localStorage.getItem(SAVED_NOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSavedNoteIds(ids) {
  try {
    localStorage.setItem(SAVED_NOTES_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

function toggleSavedNote(saveId) {
  const ids = readSavedNoteIds();
  if (ids.has(saveId)) ids.delete(saveId);
  else ids.add(saveId);
  writeSavedNoteIds(ids);
  return ids.has(saveId);
}

function readLastToneCounts() {
  try {
    const raw = localStorage.getItem(LAST_TONE_COUNTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Number.isFinite(parsed.positive) &&
      Number.isFinite(parsed.neutral) &&
      Number.isFinite(parsed.negative)
    ) {
      return {
        positive: parsed.positive,
        neutral: parsed.neutral,
        negative: parsed.negative,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeLastToneCounts(tally) {
  try {
    localStorage.setItem(
      LAST_TONE_COUNTS_KEY,
      JSON.stringify({
        positive: tally.positive,
        neutral: tally.neutral,
        negative: tally.negative,
        saved_at: new Date().toISOString(),
      })
    );
  } catch {
    /* ignore */
  }
}

function computeToneTally(notes) {
  const tally = { positive: 0, neutral: 0, negative: 0 };
  (notes || []).forEach((note) => {
    tally[normalizeSentimentKey(note.sentiment)] += 1;
  });
  return tally;
}

function formatNotesToneCompareLine(today, previous) {
  if (!previous) return "Tone unchanged vs yesterday";
  if (
    today.positive === previous.positive &&
    today.neutral === previous.neutral &&
    today.negative === previous.negative
  ) {
    return "Tone unchanged vs yesterday";
  }
  const posDelta = today.positive - previous.positive;
  const negDelta = today.negative - previous.negative;
  if (posDelta > negDelta) return "Tone up vs yesterday";
  if (negDelta > posDelta) return "Tone down vs yesterday";
  return "Tone mixed vs yesterday";
}

function quoteForTicker(ticker, payload) {
  const key = String(ticker || "").toUpperCase();
  const byTicker = payload?.quotes || state.watchlistQuotes || {};
  const direct = byTicker[key] || byTicker[String(ticker || "")];
  if (direct) return direct;
  const quotes = payload?.portfolio_quotes ?? payload?.portfolioQuotes ?? [];
  return quotes.find((q) => String(q?.ticker || "").toUpperCase() === key) || null;
}

function holdingDisplayName(ticker, payload) {
  const quote = quoteForTicker(ticker, payload);
  const watch = state.portfolio.find((p) => p.ticker === ticker);
  return quote?.display_name || watch?.name || ticker;
}

function holdingSummaryLine(note) {
  let detail = stripSourceCitationMarkers(note.update || "").trim();
  const dashIdx = detail.indexOf(" — ");
  if (dashIdx >= 0) detail = detail.slice(dashIdx + 3).trim();
  else detail = detail.replace(new RegExp(`^${note.ticker}[^:]*:\\s*`, "i"), "").trim();
  if (!detail) return "";
  return detail;
}

function isFallbackStockNews(text) {
  const value = stripSourceCitationMarkers(text || "").trim();
  if (value.length < 20) return true;
  if (/^no significant news for this holding today\.?$/i.test(value)) return true;
  if (/^data unavailable\.?$/i.test(value)) return true;
  if (/^no data\.?$/i.test(value)) return true;
  return false;
}

function noteHasPortfolioCoverage(note) {
  const summary = holdingSummaryLine(note);
  return Boolean(summary) && !isFallbackStockNews(summary);
}

function sentimentDisplayLabel(sentiment) {
  const key = normalizeSentimentKey(sentiment);
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function displayWhyItMatters(raw) {
  const text = stripSourceCitationMarkers(raw || "").trim();
  if (!text || text.includes(GENERIC_WHY_PLACEHOLDER) || /quote snapshot/i.test(text)) {
    return "";
  }
  return text;
}

function bookmarkButtonHtml(saveId, isSaved, variant = "card") {
  const label = isSaved ? "Saved" : "Save";
  const rowMod = variant === "row" ? " notes-save-btn--row" : "";
  const savedMod = isSaved ? " notes-save-btn--saved" : "";
  return `<button type="button" class="notes-save-btn${rowMod}${savedMod}" data-save-id="${escapeHtml(saveId)}" aria-pressed="${isSaved ? "true" : "false"}">${label}</button>`;
}

function bindSaveButtons(container) {
  container.querySelectorAll("[data-save-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-save-id");
      if (!id) return;
      const saved = toggleSavedNote(id);
      btn.classList.toggle("notes-save-btn--saved", saved);
      btn.setAttribute("aria-pressed", saved ? "true" : "false");
      btn.textContent = saved ? "Saved" : "Save";
      toast(saved ? "Saved to notes" : "Removed from saved");
    });
  });
}

function renderNotesSummary(payload) {
  const loading = state.loading;
  const hasBrief = Boolean(payload) && !loading;
  const showEmpty = !payload && !loading;

  if (el.showNotesDate) {
    const d = payload?.generated_at ? new Date(payload.generated_at) : new Date();
    el.showNotesDate.textContent = formatBritishDateFull(d);
  }

  el.notesEmpty?.classList.toggle("hidden", !showEmpty);
  el.notesLoading?.classList.toggle("hidden", !loading);
  el.notesBody?.classList.toggle("hidden", !hasBrief);
  syncAiFootnote();

  if (loading || showEmpty || !payload) return;

  const summaryLines = (payload.show_notes_summary || [])
    .map((line) => stripSourceCitationMarkers(line))
    .filter(Boolean);

  if (el.notesTopHeadline) {
    el.notesTopHeadline.textContent = summaryLines[0] || "";
  }

  if (el.notesSecondaryStories) {
    el.notesSecondaryStories.innerHTML = "";
    summaryLines.slice(1, 4).forEach((line) => {
      const li = document.createElement("li");
      li.className = "notes-top-card__row";
      li.innerHTML = `
        <span class="notes-top-card__dash" aria-hidden="true">—</span>
        <p class="notes-top-card__line">${escapeHtml(line)}</p>`;
      el.notesSecondaryStories.appendChild(li);
    });
  }

  const allNotes = impactNotesForNotesUi(payload);
  const notes = allNotes.filter(noteHasPortfolioCoverage);
  const tally = computeToneTally(notes);
  const previousTone = readLastToneCounts();
  if (el.tonePositive) el.tonePositive.textContent = String(tally.positive);
  if (el.toneNeutral) el.toneNeutral.textContent = String(tally.neutral);
  if (el.toneNegative) el.toneNegative.textContent = String(tally.negative);
  if (el.toneCompare) el.toneCompare.textContent = formatNotesToneCompareLine(tally, previousTone);
  writeLastToneCounts(tally);

  const savedIds = readSavedNoteIds();
  if (el.securityNotes) {
    el.securityNotes.innerHTML = "";
    notes.forEach((note) => {
      const sent = normalizeSentimentKey(note.sentiment);
      const summary = holdingSummaryLine(note);
      const why = displayWhyItMatters(note.why_it_matters);
      const saveId = `holding:${note.ticker}`;
      const quote = quoteForTicker(note.ticker, payload);
      const priceText = formatQuotePrice(quote);
      const changeText = priceText ? formatQuoteChangeToday(quote) : "";
      const changeClass = quoteChangeClassName(quote, "notes-stock-card__change");
      const card = document.createElement("article");
      card.className = "notes-stock-card";
      card.innerHTML = `
        <div class="notes-stock-card__head">
          <span class="notes-stock-card__chip">${escapeHtml(note.ticker)}</span>
          <p class="notes-stock-card__name">${escapeHtml(holdingDisplayName(note.ticker, payload))}</p>
          <span class="notes-stock-card__sentiment notes-stock-card__sentiment--${sent}">${escapeHtml(sentimentDisplayLabel(sent))}</span>
          ${bookmarkButtonHtml(saveId, savedIds.has(saveId), "card")}
        </div>
        ${
          priceText
            ? `<p class="notes-stock-card__quote"><span>${escapeHtml(priceText)}</span>${changeText ? ` <span class="notes-stock-card__change ${escapeHtml(changeClass)}">${escapeHtml(changeText)}</span>` : ""}</p>`
            : ""
        }
        <p class="notes-stock-card__summary">${escapeHtml(summary)}</p>
        ${
          why
            ? `<div class="notes-why-block">
          <span class="notes-why-block__label">Why it matters</span>
          <p class="notes-why-block__text">${escapeHtml(why)}</p>
        </div>`
            : ""
        }`;
      el.securityNotes.appendChild(card);
    });
    bindSaveButtons(el.securityNotes);
  }

  const portfolioSection = el.notesBody?.querySelector(".notes-portfolio-section");
  portfolioSection?.classList.toggle("hidden", notes.length === 0);

  if (el.generalNotes) {
    el.generalNotes.innerHTML = "";
    (payload.general_news_notes || []).forEach((line, index) => {
      const text = stripSourceCitationMarkers(line);
      if (!text) return;
      const saveId = `general:${index}:${text.slice(0, 48)}`;
      const li = document.createElement("li");
      li.className = "notes-general__row";
      li.innerHTML = `
        <span class="notes-general__dot" aria-hidden="true"></span>
        <p class="notes-general__text">${escapeHtml(text)}</p>
        ${bookmarkButtonHtml(saveId, savedIds.has(saveId), "row")}`;
      el.generalNotes.appendChild(li);
    });
    bindSaveButtons(el.generalNotes);
  }

  const generalSection = el.notesBody?.querySelector(".notes-general-section");
  const generalCount = el.generalNotes?.children.length ?? 0;
  generalSection?.classList.toggle("hidden", generalCount === 0);
}

function sourceCategory(link) {
  const text = [link.title, link.description, link.content].filter(Boolean).join(" ");
  const hasPortfolioTicker = state.portfolio.some((item) => articleTextMentionsTicker(text, item.ticker, item));
  if (link.relevance_tag && link.relevance_tag !== "Macro") return "portfolio";
  if (link.category === "portfolio" || hasPortfolioTicker) return "portfolio";
  return "macro";
}

function sentenceCase(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function extractSourceDomain(url) {
  if (url && String(url).trim()) {
    const fromApi = String(url).trim();
    try {
      const host = new URL(fromApi).hostname.toLowerCase();
      return host.startsWith("www.") ? host.slice(4) : host;
    } catch {
      /* fall through */
    }
  }
  return "";
}

function readingTimeLabel(wordCount) {
  const wc = Number(wordCount);
  if (!Number.isFinite(wc) || wc <= 0) return "3 min";
  return `${Math.max(1, Math.ceil(wc / 200))} min`;
}

function estimateWordCountFromLink(link) {
  if (link.word_count != null && Number(link.word_count) > 0) return Number(link.word_count);
  const text = `${link.title || ""} ${link.description || ""}`.trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function readSavedArticleUrls() {
  try {
    const raw = localStorage.getItem(SAVED_ARTICLES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSavedArticleUrls(urls) {
  try {
    localStorage.setItem(SAVED_ARTICLES_KEY, JSON.stringify([...urls]));
  } catch {
    /* ignore */
  }
}

function toggleSavedArticle(url) {
  const ids = readSavedArticleUrls();
  if (ids.has(url)) ids.delete(url);
  else ids.add(url);
  writeSavedArticleUrls(ids);
  return ids.has(url);
}

function readMutedSourceDomains() {
  try {
    const raw = localStorage.getItem(MUTED_SOURCES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed)
        ? parsed.map((d) => String(d).toLowerCase()).filter(Boolean)
        : []
    );
  } catch {
    return new Set();
  }
}

function writeMutedSourceDomains(domains) {
  try {
    localStorage.setItem(MUTED_SOURCES_KEY, JSON.stringify([...domains]));
  } catch {
    /* ignore */
  }
}

function allMutedDomains() {
  const merged = new Set(readMutedSourceDomains());
  state.sessionMutedDomains.forEach((d) => merged.add(d));
  return merged;
}

function tickerMentionedInText(text, ticker) {
  const sym = String(ticker || "").trim();
  if (!sym || !text) return false;
  const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\$${escaped}\\b`, "i").test(text)) return true;
  if (new RegExp(`\\(${escaped}\\)`, "i").test(text)) return true;
  if (sym.length <= 3) {
    const re = new RegExp(`\\b(${escaped})\\b`, "g");
    let match;
    while ((match = re.exec(text)) !== null) {
      if (match[1] === sym) return true;
    }
    return false;
  }
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function watchlistBrandMentioned(text, item) {
  const name = String(item?.name || "").trim();
  if (!name) return false;
  const primary = name.split(",")[0].trim();
  if (primary.length >= 4 && new RegExp(`\\b${primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
    return true;
  }
  if (String(item.ticker || "").length <= 3) return false;
  const token = primary.split(/\s+/)[0] || "";
  if (token.length < 4) return false;
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

function articleTextMentionsTicker(text, ticker, watchItem) {
  if (tickerMentionedInText(text, ticker)) return true;
  if (watchItem && watchlistBrandMentioned(text, watchItem)) return true;
  return false;
}

function noteTickersFromBrief(payload) {
  const set = new Set();
  (payload?.security_impact_notes || []).forEach((n) => {
    const t = String(n?.ticker || "").trim().toUpperCase();
    if (t) set.add(t);
  });
  return set;
}

function assignRelevanceFromLink(link, payload) {
  const text = [link.title, link.description, link.content].filter(Boolean).join(" ");
  if (link.relevance_tag) {
    if (link.relevance_tag === "Macro" || link.relevance_tag === "Portfolio") return link.relevance_tag;
    const item = state.portfolio.find((p) => p.ticker === link.relevance_tag);
    if (articleTextMentionsTicker(text, link.relevance_tag, item)) return link.relevance_tag;
  }
  for (const item of state.portfolio) {
    if (articleTextMentionsTicker(text, item.ticker, item)) return item.ticker;
  }
  const noteTickers = noteTickersFromBrief(payload);
  for (const item of state.portfolio) {
    if (noteTickers.has(item.ticker) && articleTextMentionsTicker(text, item.ticker, item)) {
      return item.ticker;
    }
  }
  return "Macro";
}

function resolveArticleFocusCategoryKey(link) {
  const fromApi = focusAreaKeyFromFullLabel(link.focus_category);
  if (fromApi) return fromApi;
  if (link.relevance_tag === "Macro" || link.category === "macro") {
    return normalizeFocusAreaKey(readProfileFocusCategories()[0] || "macro");
  }
  return "";
}

function isPortfolioArticle(article) {
  return Boolean(article) && !article.focusCategoryKey && article.relevanceTag !== "Macro";
}

function mapLinkToArticle(link, index, payload) {
  const url = String(link.url || "").trim();
  const relevanceTag = assignRelevanceFromLink(link, payload);
  const focusCategoryKey = resolveArticleFocusCategoryKey(link);
  const domain = (link.source_domain || extractSourceDomain(url)).toLowerCase();
  return {
    id: link.source_id || `article-${index}`,
    url,
    headline: sentenceCase(link.headline_normalized || link.title || "Untitled article"),
    source: link.source || domain || "Source",
    sourceDomain: domain,
    date: link.published_at,
    wordCount: link.word_count != null ? Number(link.word_count) : estimateWordCountFromLink(link),
    category: focusCategoryKey || (relevanceTag === "Macro" ? "macro" : "portfolio"),
    focusCategoryKey,
    relevanceTag,
    isTopStory: Boolean(link.is_top_story),
    description: String(link.description || "").trim(),
    content: String(link.content || "").trim(),
  };
}

/** Deduplicate by URL, drop muted domains, normalise headlines — run once per brief. */
function prepareArticlesFromBrief(payload) {
  const seen = new Set();
  const articles = [];

  const portfolioLinks = Array.isArray(payload.portfolio_articles) ? payload.portfolio_articles : [];
  const categoryLinks = Array.isArray(payload.category_articles) ? payload.category_articles : [];
  const dedicatedPools = portfolioLinks.length || categoryLinks.length;
  const inputLinks = dedicatedPools
    ? [
        ...portfolioLinks.map((link) => ({ link, pool: "portfolio" })),
        ...categoryLinks.map((link) => ({ link, pool: "category" })),
      ]
    : (payload.source_links || []).map((link) => ({
        link,
        pool: sourceCategory(link) === "portfolio" ? "portfolio" : "category",
      }));

  inputLinks.forEach(({ link, pool }, index) => {
    const url = String(link.url || "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    articles.push({ ...mapLinkToArticle(link, index, payload), pool });
  });

  const muted = allMutedDomains();
  state.preparedArticles = articles.filter((a) => !muted.has(a.sourceDomain));
  return state.preparedArticles;
}

function watchlistRank(ticker) {
  const idx = state.portfolio.findIndex((p) => p.ticker === ticker);
  return idx < 0 ? 999 : idx;
}

function sortPortfolioArticles(list) {
  return [...list].sort((a, b) => watchlistRank(a.relevanceTag) - watchlistRank(b.relevanceTag));
}

function sortByDateDesc(list) {
  return [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function assetTypeForTicker(ticker) {
  const item = state.portfolio.find((p) => p.ticker === ticker);
  return (item?.asset_type || "stock").toLowerCase();
}

function articleCounts(articles) {
  const counts = { portfolio: 0, category: 0, total: articles.length };
  articles.forEach((a) => {
    if (a.pool === "portfolio" || isPortfolioArticle(a)) {
      counts.portfolio += 1;
    } else if (a.pool === "category" || a.focusCategoryKey) {
      counts.category += 1;
    }
  });
  return counts;
}

function articlesSectionLabelForFilter(filter) {
  if (filter === "portfolio") return "Portfolio";
  return articlesCategoryTabLabel();
}

function articlesEmptyMessageForFilter(filter) {
  if (filter === "portfolio" && !state.portfolio.length) {
    return "Add stocks to your watchlist to see portfolio articles here.";
  }
  if (filter === "portfolio") return "No portfolio articles in today's brief.";
  return `No ${articlesCategoryTabLabel()} articles in today's brief.`;
}

function articlesCategoryTabLabel() {
  return (
    String(state.brief?.category_name || "").trim() ||
    focusAreaPillLabel(readProfileFocusCategories()[0] || "macro")
  );
}

function buildArticleFilterPills() {
  if (!el.articlesFilters) return;
  const categoryLabel = articlesCategoryTabLabel();
  const signature = categoryLabel;
  if (el.articlesFilters.dataset.signature === signature && el.articlesFilters.childElementCount) {
    syncArticleFilterPillActiveState();
    return;
  }
  el.articlesFilters.dataset.signature = signature;
  ensureValidArticleFilter();
  const active = state.articleFilter;
  el.articlesFilters.innerHTML = "";
  const specs = [
    { filter: "portfolio", label: "Portfolio" },
    { filter: "category", label: categoryLabel },
  ];
  specs.forEach(({ filter, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "articles-filter-pill article-filter";
    btn.dataset.filter = filter;
    btn.setAttribute("role", "tab");
    const isActive = filter === active;
    if (isActive) btn.classList.add("is-active");
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    btn.innerHTML = `${escapeHtml(label)} <span class="articles-filter-pill__count">0</span>`;
    el.articlesFilters.appendChild(btn);
  });
}

function syncArticleFilterPillActiveState() {
  if (!el.articlesFilters) return;
  el.articlesFilters.querySelectorAll(".article-filter").forEach((btn) => {
    const active = btn.dataset.filter === state.articleFilter;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function syncArticleFilterPillCounts(counts) {
  if (!el.articlesFilters) return;
  el.articlesFilters.querySelectorAll(".article-filter").forEach((btn) => {
    const key = btn.dataset.filter;
    const countNode = btn.querySelector(".articles-filter-pill__count");
    if (countNode && counts[key] != null) countNode.textContent = String(counts[key]);
  });
}

function articleTickerLabel(article) {
  if (article.relevanceTag && article.relevanceTag !== "Macro") return article.relevanceTag;
  return "";
}

function matchingNoteForArticle(article) {
  if (!state.brief) return null;
  const notes = impactNotesForNotesUi(state.brief);
  const tag = article.relevanceTag;
  if (tag && tag !== "Macro") {
    return notes.find((n) => String(n.ticker || "").toUpperCase() === String(tag).toUpperCase()) || null;
  }
  const title = (article.headline || "").toUpperCase();
  return notes.find((n) => title.includes(String(n.ticker || "").toUpperCase())) || null;
}

function firstSentences(text, maxSentences = 3) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const parts = raw.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!parts?.length) return raw;
  return parts
    .slice(0, maxSentences)
    .join(" ")
    .trim();
}

function articleSummaryText(article, { long = false } = {}) {
  const desc = String(article.description || "").trim();
  if (desc) {
    const text = stripSourceCitationMarkers(sentenceCase(desc));
    return long ? text : firstSentences(text, 3);
  }
  const note = matchingNoteForArticle(article);
  if (note?.update) {
    const text = stripSourceCitationMarkers(String(note.update).trim());
    return long ? text : firstSentences(text, 3);
  }
  if (state.brief) {
    const fromBrief = deriveFeaturedArticlePreview({
      title: article.headline,
      relevance_tag: article.relevanceTag,
    });
    if (fromBrief) return long ? fromBrief : firstSentences(fromBrief, 3);
  }
  const fallback = stripSourceCitationMarkers(article.headline || "");
  return long ? fallback : firstSentences(fallback, 3);
}

function articleWhyRelevantText(article) {
  if (article.relevanceTag === "Macro") return "";
  const note = matchingNoteForArticle(article);
  if (note?.why_it_matters) {
    const why = stripSourceCitationMarkers(String(note.why_it_matters).trim());
    if (why && why !== GENERIC_WHY_PLACEHOLDER) return why;
  }
  const item = state.portfolio.find((p) => p.ticker === article.relevanceTag);
  if (item) {
    return `This story may affect ${item.name} (${item.ticker}), which is on your watchlist.`;
  }
  return "";
}

function articlePortfolioImpactText(article) {
  const direct = articleWhyRelevantText(article);
  if (direct) return firstSentences(direct, 1);
  if (article.relevanceTag === "Macro" && state.brief) {
    const general = (state.brief.general_news_notes || [])
      .map((line) => stripSourceCitationMarkers(String(line || "").trim()))
      .filter(Boolean);
    if (general.length) return firstSentences(general[0], 1);
    const tickers = state.portfolio
      .slice(0, 3)
      .map((p) => p.ticker)
      .join(", ");
    if (tickers) {
      return `Macro developments like this can shift rates, currencies, and sector sentiment that affect holdings such as ${tickers} on your watchlist.`;
    }
  }
  return "This story may affect themes and risk factors tied to names on your watchlist.";
}

function isArticleCardWhyPlaceholder(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (isUnavailableInsightText(t)) return true;
  if (/no significant news for this holding today/i.test(t)) return true;
  return false;
}

function articleCardSummaryForDisplay(article) {
  const summary = articleSummaryText(article);
  if (isUnavailableInsightText(summary)) return "";
  return String(summary || "").trim();
}

function articleCardWhyForDisplay(article) {
  const why = articlePortfolioImpactText(article);
  if (isArticleCardWhyPlaceholder(why)) return "";
  return String(why || "").trim();
}

function articlesSaveButtonHtml(url, savedUrls, className = "articles-save-btn", id = "") {
  const saved = savedUrls.has(url);
  const label = saved ? "Saved ✓" : "Save";
  const idAttr = id ? ` id="${escapeHtml(id)}"` : "";
  return `<button type="button" class="${className}${saved ? " is-saved" : ""}"${idAttr} data-article-url="${escapeHtml(url)}" aria-label="${saved ? "Saved" : "Save article"}" aria-pressed="${saved ? "true" : "false"}">${label}</button>`;
}

function articlesClockIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v4l2.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

function articlesCardClockIconSvg() {
  return `<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><circle cx="6.5" cy="6.5" r="5.5" stroke="#B0ADA8" stroke-width="1" fill="none"/><path d="M6.5 3.5V6.5L8.5 8" stroke="#B0ADA8" stroke-width="1.1" stroke-linecap="round"/></svg>`;
}

function collapseArticleCard(card) {
  if (!card) return;
  card.classList.remove("is-expanded");
  card.setAttribute("aria-expanded", "false");
}

function expandArticleCard(card, { scrollIntoView = false } = {}) {
  if (!card) return;
  card.classList.add("is-expanded");
  card.setAttribute("aria-expanded", "true");
  if (scrollIntoView) {
    window.setTimeout(() => {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 220);
  }
}

function formatArticleEyebrowDate(date) {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) return "—";
  return formatBritishDateInYear(d, new Date()).toUpperCase();
}

function syncArticlesHeader(articles) {
  buildArticleFilterPills();
  const counts = articleCounts(articles);
  syncArticleFilterPillCounts(counts);
  if (el.articlesEyebrow) {
    const ref = state.brief?.generated_at ? new Date(state.brief.generated_at) : new Date();
    const datePart = formatBritishDateFull(ref);
    const n = counts.total;
    el.articlesEyebrow.textContent = `${datePart} · ${n} ${n === 1 ? "article" : "articles"}`;
  }
}

function findArticleByUrl(url) {
  return state.preparedArticles.find((a) => a.url === url) || null;
}

function openArticleDetail(url) {
  if (!url) return;
  state.articleDetailUrl = url;
  switchScreen("article-detail");
}

function renderArticleDetail(url) {
  const article = findArticleByUrl(url);
  if (!article || !el.articleDetailHeadline) return;
  const savedUrls = readSavedArticleUrls();
  const ticker = articleTickerLabel(article);
  const dateLabel = formatBritishDateInYear(article.date, new Date());
  const readLabel = `${readingTimeLabel(article.wordCount)} read`;

  if (el.articleDetailMeta) {
    el.articleDetailMeta.innerHTML = `
      ${ticker ? `<span class="articles-ticker-chip">${escapeHtml(ticker)}</span>` : ""}
      <span class="articles-meta-text">${escapeHtml(article.source)}</span>
      <span class="articles-meta-dot" aria-hidden="true"></span>
      <span class="articles-meta-text">${escapeHtml(dateLabel)}</span>
      <span class="articles-meta-dot" aria-hidden="true"></span>
      <span class="articles-item-card__read-time">${articlesClockIconSvg()}${escapeHtml(readLabel)}</span>`;
  }

  el.articleDetailHeadline.textContent = article.headline;
  el.articleDetailSummary.textContent = articleSummaryText(article, { long: true });

  const why = articleWhyRelevantText(article);
  if (el.articleDetailWhy && el.articleDetailWhyText) {
    el.articleDetailWhy.classList.toggle("hidden", !why);
    el.articleDetailWhyText.textContent = why;
  }

  const detailBar = document.querySelector(".article-detail-page__bar");
  const existingSave = document.getElementById("article-detail-save");
  if (existingSave) {
    existingSave.outerHTML = articlesSaveButtonHtml(article.url, savedUrls, "articles-save-btn", "article-detail-save");
    el.articleDetailSave = document.getElementById("article-detail-save");
    bindArticleSaveButtons(detailBar);
  }

  if (el.articleDetailOpen) {
    el.articleDetailOpen.onclick = () => {
      if (article.url) window.open(article.url, "_blank", "noopener,noreferrer");
    };
  }
}

function renderTopStoryCard(article, savedUrls) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "articles-top-story";
  const ticker = articleTickerLabel(article);
  const dateLabel = formatBritishDateInYear(article.date, new Date());
  btn.innerHTML = `
    <div class="articles-top-story__eyebrow">
      <span class="articles-top-story__eyebrow-label">Top story</span>
      <span class="articles-top-story__eyebrow-date">${escapeHtml(formatArticleEyebrowDate(article.date))}</span>
    </div>
    <h2 class="articles-top-story__headline">${escapeHtml(article.headline)}</h2>
    <div class="articles-top-story__meta">
      ${ticker ? `<span class="articles-ticker-chip">${escapeHtml(ticker)}</span>` : ""}
      ${ticker ? `<span class="articles-meta-dot" aria-hidden="true"></span>` : ""}
      <span class="articles-meta-text">${escapeHtml(article.source)}</span>
      <span class="articles-meta-dot" aria-hidden="true"></span>
      <span class="articles-meta-text">${escapeHtml(dateLabel)}</span>
      ${articlesSaveButtonHtml(article.url, savedUrls)}
    </div>`;
  btn.addEventListener("click", () => openArticleDetail(article.url));
  bindArticleSaveButtons(btn);
  return btn;
}

function renderArticleListCard(article, savedUrls) {
  const card = document.createElement("article");
  card.className = "articles-item-card";
  card.dataset.articleUrl = article.url;
  const ticker = articleTickerLabel(article);
  const summary = articleCardSummaryForDisplay(article);
  const why = articleCardWhyForDisplay(article);
  const readLabel = `${readingTimeLabel(article.wordCount)} read`;
  const expanded = state.expandedArticleUrl === article.url;

  if (expanded) card.classList.add("is-expanded");
  card.setAttribute("aria-expanded", expanded ? "true" : "false");

  card.innerHTML = `
    <div class="articles-item-card__head">
      ${ticker ? `<span class="articles-ticker-chip">${escapeHtml(ticker)}</span>` : ""}
      <span class="articles-item-card__source">${escapeHtml(article.source)}</span>
      ${articlesSaveButtonHtml(article.url, savedUrls)}
    </div>
    <div class="articles-item-card__headline-row">
      <h3 class="articles-item-card__headline">${escapeHtml(article.headline)}</h3>
      <span class="articles-item-card__chevron" aria-hidden="true">›</span>
    </div>
    <div class="articles-item-card__expand">
      <div class="articles-item-card__expand-inner">
        ${
          summary
            ? `<p class="articles-item-card__summary">${escapeHtml(summary)}</p>`
            : ""
        }
        ${
          why
            ? `<div class="articles-why-block">
          <p class="articles-why-block__label">Why it impacts your portfolio</p>
          <p class="articles-why-block__body">${escapeHtml(why)}</p>
        </div>`
            : ""
        }
        <div class="articles-item-card__footer">
          <span class="articles-item-card__read-time">${articlesCardClockIconSvg()}${escapeHtml(readLabel)}</span>
          <button type="button" class="articles-read-btn" data-read-url="${escapeHtml(article.url)}">
            <span class="articles-read-btn__label">Read article</span>
            <span class="articles-read-btn__arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>`;

  const toggleCardExpanded = () => {
    const isExpanded = card.classList.contains("is-expanded");
    if (isExpanded) {
      state.expandedArticleUrl = null;
      collapseArticleCard(card);
      return;
    }
    document.querySelectorAll(".articles-item-card.is-expanded").forEach((node) => {
      if (node !== card) collapseArticleCard(node);
    });
    state.expandedArticleUrl = article.url;
    expandArticleCard(card, { scrollIntoView: true });
  };

  card.addEventListener("click", (e) => {
    if (e.target.closest(".articles-save-btn") || e.target.closest(".articles-read-btn")) return;
    toggleCardExpanded();
  });
  card.querySelector(".articles-read-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openArticleDetail(article.url);
  });

  bindArticleSaveButtons(card);

  return card;
}

function bindArticleSaveButtons(container) {
  if (!container) return;
  container.querySelectorAll(".articles-save-btn[data-article-url]").forEach((btn) => {
    if (btn.dataset.saveBound === "1") return;
    btn.dataset.saveBound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = btn.getAttribute("data-article-url");
      if (!url) return;
      const saved = toggleSavedArticle(url);
      btn.classList.toggle("is-saved", saved);
      btn.setAttribute("aria-pressed", saved ? "true" : "false");
      btn.textContent = saved ? "Saved ✓" : "Save";
      document.querySelectorAll(".articles-save-btn[data-article-url]").forEach((other) => {
        if (other === btn) return;
        if (other.getAttribute("data-article-url") !== url) return;
        other.classList.toggle("is-saved", saved);
        other.setAttribute("aria-pressed", saved ? "true" : "false");
        other.textContent = saved ? "Saved ✓" : "Save";
      });
      toast(saved ? "Article saved" : "Removed from saved");
    });
  });
}

let muteUndoTimer = null;
let lastMutedDomain = null;

function muteArticleSource(domain) {
  const key = String(domain).toLowerCase();
  if (!key) return;
  lastMutedDomain = key;
  state.sessionMutedDomains.add(key);
  const stored = readMutedSourceDomains();
  stored.add(key);
  writeMutedSourceDomains(stored);
  if (state.brief) prepareArticlesFromBrief(state.brief);
  renderArticles();
  showMuteUndoToast(key);
  syncManageMutedLink();
}

function showMuteUndoToast(domain) {
  const existing = document.getElementById("articles-mute-toast");
  if (existing) existing.remove();
  if (muteUndoTimer) clearTimeout(muteUndoTimer);

  const toastEl = document.createElement("p");
  toastEl.id = "articles-mute-toast";
  toastEl.className = "articles-mute-toast";
  toastEl.innerHTML = `Source muted — <button type="button">undo?</button>`;
  toastEl.querySelector("button")?.addEventListener("click", () => {
    undoMuteSource(domain);
    toastEl.remove();
  });
  el.articlesList?.appendChild(toastEl);
  muteUndoTimer = setTimeout(() => {
    toastEl.remove();
    muteUndoTimer = null;
  }, 4000);
}

function undoMuteSource(domain) {
  const key = String(domain).toLowerCase();
  state.sessionMutedDomains.delete(key);
  const stored = readMutedSourceDomains();
  stored.delete(key);
  writeMutedSourceDomains(stored);
  if (state.brief) prepareArticlesFromBrief(state.brief);
  renderArticles();
  syncManageMutedLink();
}

function syncManageMutedLink() {
  const count = readMutedSourceDomains().size;
  if (!el.manageMutedSources) return;
  el.manageMutedSources.classList.toggle("hidden", count === 0);
}

function openMutedSourcesSheet() {
  if (!el.mutedSourcesSheet) return;
  const domains = [...readMutedSourceDomains()].sort();
  if (el.mutedSourcesList) {
    el.mutedSourcesList.innerHTML = "";
    domains.forEach((domain) => {
      const li = document.createElement("li");
      li.className = "muted-sources-list__item";
      li.innerHTML = `
        <span>${escapeHtml(domain)}</span>
        <button type="button" class="muted-sources-list__remove" data-unmute="${escapeHtml(domain)}">Remove</button>`;
      li.querySelector("button")?.addEventListener("click", () => {
        const stored = readMutedSourceDomains();
        stored.delete(domain);
        writeMutedSourceDomains(stored);
        state.sessionMutedDomains.delete(domain);
        openMutedSourcesSheet();
        if (state.brief) prepareArticlesFromBrief(state.brief);
        renderArticles();
        syncManageMutedLink();
      });
      el.mutedSourcesList.appendChild(li);
    });
  }
  el.mutedSourcesEmpty?.classList.toggle("hidden", domains.length > 0);
  el.mutedSourcesSheet.classList.remove("hidden");
}

function closeMutedSourcesSheet() {
  el.mutedSourcesSheet?.classList.add("hidden");
}

function filterArticlesForTab(articles, filter) {
  const list = articles.filter((a) => !a.isTopStory);
  if (filter === "portfolio") return list.filter((a) => a.pool === "portfolio" || isPortfolioArticle(a));
  return list.filter((a) => a.pool === "category" || a.focusCategoryKey);
}

function appendArticlesSectionLabel(container, text) {
  const label = document.createElement("p");
  label.className = "articles-section-label";
  label.textContent = text;
  container.appendChild(label);
}

function setArticlesLoadingUi(loading) {
  el.articlesLoading?.classList.toggle("hidden", !loading);
  el.articlesBody?.classList.toggle("hidden", loading);
}

function renderArticles() {
  const filter = state.articleFilter;
  const loading = state.loading;

  setArticlesLoadingUi(loading);

  if (loading) {
    el.articlesEmpty?.classList.add("hidden");
    if (el.articlesTopStorySlot) el.articlesTopStorySlot.innerHTML = "";
    if (el.articlesList) el.articlesList.innerHTML = "";
    syncArticlesHeader([]);
    return;
  }

  if (!state.brief) {
    syncArticlesHeader([]);
    if (el.articlesSectionLabel) {
      el.articlesSectionLabel.textContent = articlesSectionLabelForFilter(filter);
      el.articlesSectionLabel.classList.add("hidden");
    }
    if (el.articlesTopStorySlot) el.articlesTopStorySlot.innerHTML = "";
    if (el.articlesList) el.articlesList.innerHTML = "";
    if (el.articlesEmpty) {
      el.articlesEmpty.textContent =
        filter === "portfolio" && !state.portfolio.length
          ? "Add stocks to your watchlist to see portfolio articles here."
          : "Generate today's brief from the Home screen to see your articles here.";
      el.articlesEmpty.classList.remove("hidden");
    }
    syncManageMutedLink();
    return;
  }

  if (!state.preparedArticles.length) prepareArticlesFromBrief(state.brief);

  const allArticles = state.preparedArticles;
  syncArticlesHeader(allArticles);

  const savedUrls = readSavedArticleUrls();
  const activePool = filter === "portfolio"
    ? allArticles.filter((a) => a.pool === "portfolio" || isPortfolioArticle(a))
    : allArticles.filter((a) => a.pool === "category" || a.focusCategoryKey);
  const sortedPool = filter === "portfolio" ? sortPortfolioArticles(activePool) : sortByDateDesc(activePool);
  const topStory = sortedPool.find((a) => a.isTopStory) || sortedPool[0] || null;
  const visible = sortedPool.filter((a) => a.url !== topStory?.url);

  if (el.articlesTopStorySlot) {
    el.articlesTopStorySlot.innerHTML = "";
    if (topStory) {
      el.articlesTopStorySlot.appendChild(renderTopStoryCard(topStory, savedUrls));
    }
  }

  if (el.articlesSectionLabel) {
    el.articlesSectionLabel.textContent = articlesSectionLabelForFilter(filter);
    el.articlesSectionLabel.classList.toggle("hidden", !activePool.length);
  }

  if (el.articlesList) {
    el.articlesList.innerHTML = "";
    visible.forEach((article) => {
      el.articlesList.appendChild(renderArticleListCard(article, savedUrls));
    });
  }

  const listEmpty = activePool.length === 0;
  if (el.articlesEmpty) {
    if (listEmpty && state.brief) {
      el.articlesEmpty.textContent = articlesEmptyMessageForFilter(filter);
      el.articlesEmpty.classList.remove("hidden");
    } else {
      el.articlesEmpty.classList.add("hidden");
    }
  }

  syncManageMutedLink();
}

function renderSourceCards(container, links, options = {}) {
  const featureFirst = Boolean(options.featureFirst);
  container.innerHTML = "";
  if (!links.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "No article links yet.";
    container.appendChild(p);
    return;
  }
  const refNow = new Date();
  links.forEach((link, index) => {
    const card = document.createElement("button");
    card.type = "button";
    const category = sourceCategory(link);
    const catLabel = formatSourceCategoryLabel(category);
    const dateLabel = formatBritishDateInYear(link.published_at, refNow);
    const isFeatured = featureFirst && index === 0;
    card.className = isFeatured ? "article-row article-row--featured" : "article-row";
    const previewText = isFeatured ? deriveFeaturedArticlePreview(link) : "";
    const kickerHtml = isFeatured ? `<span class="article-row__kicker">Top story</span>` : "";
    const previewHtml = previewText
      ? `<p class="article-row__preview">${escapeHtml(previewText)}</p>`
      : "";
    card.innerHTML = `
      ${kickerHtml}
      <h4>${escapeHtml(stripSourceCitationMarkers(link.title || "Untitled article"))}</h4>
      ${previewHtml}
      <p class="article-row__meta">
        <span class="article-row__source">${escapeHtml(link.source)}</span>
        <span class="article-row__tail">
          <span class="article-row__date">${escapeHtml(dateLabel)}</span><span class="article-row__sep"> · </span><span class="article-row__cat">${escapeHtml(catLabel)}</span>
        </span>
      </p>
    `;
    card.addEventListener("click", () => openArticleSheet(link, index));
    container.appendChild(card);
  });
}

function openArticleSheet(link, index) {
  if (!state.brief) return;
  const notes = impactNotesForNotesUi(state.brief);
  const matchingNote =
    notes.find((n) => (link.title || "").toUpperCase().includes((n.ticker || "").toUpperCase())) || notes[index % Math.max(1, notes.length)] || null;
  const points = state.brief.show_notes_summary || [];

  el.articleTag.textContent = stripSourceCitationMarkers(`${link.source_id} · ${sourceCategory(link)}`);
  el.articleTitle.textContent = stripSourceCitationMarkers(link.title || "Article");
  const catLabel = formatSourceCategoryLabel(sourceCategory(link));
  el.articleMeta.innerHTML = `
    <span class="article-sheet-meta__source">${escapeHtml(link.source)}</span>
    <span class="article-sheet-meta__sub">
      <span class="article-sheet-meta__date">${escapeHtml(formatBritishDateTime(link.published_at))}</span>
      <span class="article-sheet-meta__sep"> · </span>
      <span class="article-sheet-meta__cat">${escapeHtml(catLabel)}</span>
    </span>
  `;
  el.articleWhy.textContent = matchingNote
    ? stripSourceCitationMarkers(matchingNote.why_it_matters)
    : "Relevant context from your selected category and portfolio.";
  el.articlePoints.innerHTML = "";
  points.slice(0, 3).forEach((point) => {
    const li = document.createElement("li");
    li.textContent = stripSourceCitationMarkers(point);
    el.articlePoints.appendChild(li);
  });
  el.articleLink.href = link.url;
  el.articleSheet.classList.remove("hidden");
}

function closeArticleSheet() {
  el.articleSheet.classList.add("hidden");
}

function renderAlarmStepsList(steps) {
  if (!el.alarmSteps) return;
  el.alarmSteps.innerHTML = "";
  (steps || []).forEach((step) => {
    const li = document.createElement("li");
    li.textContent = stripSourceCitationMarkers(step);
    el.alarmSteps.appendChild(li);
  });
}

function renderAlarmSteps(payload) {
  renderAlarmStepsList(payload?.ios_alarm_steps || DEFAULT_ALARM_STEPS);
}

function openAlarmSheet() {
  const steps = state.brief?.ios_alarm_steps?.length
    ? state.brief.ios_alarm_steps
    : DEFAULT_ALARM_STEPS;
  renderAlarmStepsList(steps);
  el.alarmSheet?.classList.remove("hidden");
}

function closeAlarmSheet() {
  el.alarmSheet?.classList.add("hidden");
}

function deriveEpisodeTitle(payload) {
  const fromApi = String(payload.episode_title || "").trim();
  if (fromApi) return stripSourceCitationMarkers(fromApi);
  const headlines = (payload.show_notes_summary || [])
    .slice(0, 3)
    .map((line) => stripSourceCitationMarkers(line))
    .filter(Boolean);
  if (!headlines.length) {
    const links = payload.source_links || [];
    return links
      .slice(0, 3)
      .map((l) => stripSourceCitationMarkers(l.title || ""))
      .filter(Boolean)
      .join(", ")
      .slice(0, 72) || "Today's market brief";
  }
  const joined = headlines.join(" · ");
  const words = joined.split(/\s+/).filter(Boolean);
  if (words.length <= 8) return joined;
  return `${words.slice(0, 8).join(" ")}…`;
}

function derivePortfolioInsightRows(payload) {
  if (!payload) return [];
  const rows = [];
  const notes = impactNotesForNotesUi(payload);
  if (notes.length) {
    for (const note of notes) {
      const detail = stripSourceCitationMarkers(note.update || note.why_it_matters || "").trim();
      if (isUnavailableInsightText(detail)) continue;
      rows.push({
        ticker: note.ticker,
        text: detail,
        sentiment: normalizeSentimentKey(note.sentiment),
      });
    }
  }
  if (!rows.length) {
    const fromApi = payload.portfolio_insights;
    if (Array.isArray(fromApi)) {
      for (const row of fromApi) {
        const text = stripSourceCitationMarkers(row.text || "").trim();
        if (isUnavailableInsightText(text)) continue;
        const ticker =
          state.portfolio.find((p) => text.toUpperCase().includes(p.ticker))?.ticker ||
          state.portfolio[0]?.ticker ||
          "";
        if (!ticker) continue;
        rows.push({
          ticker,
          text,
          sentiment: row.tone === "positive" ? "positive" : "neutral",
        });
      }
    }
  }
  return rows;
}

function renderPortfolioInsights(payload) {
  if (!el.portfolioInsightsList) return;

  if (state.loading) {
    el.portfolioInsightsEmpty?.classList.add("hidden");
    el.portfolioInsightsList.classList.remove("hidden");
    el.portfolioInsightsMore?.classList.add("hidden");
    renderInsightSkeletonRows(3);
    return;
  }

  const rows = payload && isBriefReady() ? derivePortfolioInsightRows(payload) : [];
  if (!rows.length) {
    el.portfolioInsightsEmpty?.classList.remove("hidden");
    el.portfolioInsightsList.classList.add("hidden");
    el.portfolioInsightsList.innerHTML = "";
    el.portfolioInsightsMore?.classList.add("hidden");
    return;
  }

  el.portfolioInsightsEmpty?.classList.add("hidden");
  el.portfolioInsightsList.classList.remove("hidden");
  el.portfolioInsightsList.innerHTML = "";
  rows.slice(0, 3).forEach((row) => {
    const quote = quoteForTicker(row.ticker, payload);
    const priceText = formatQuotePrice(quote);
    const changeText = priceText ? formatQuoteChangeToday(quote) : "";
    const quoteSignalClass = quoteChangeClassName(quote, "home-insight-row__signal");
    const signal = changeText
      ? { label: changeText, className: quoteSignalClass }
      : sentimentSignal(row.sentiment);
    const text = priceText ? `${priceText} · ${row.text}` : row.text;
    const li = document.createElement("li");
    li.className = "home-insight-row";
    li.innerHTML = `
      <span class="home-insight-row__chip">${escapeHtml(row.ticker)}</span>
      <p class="home-insight-row__text">${escapeHtml(text)}</p>
      <span class="home-insight-row__signal ${signal.className}">${escapeHtml(signal.label)}</span>
    `;
    el.portfolioInsightsList.appendChild(li);
  });

  el.portfolioInsightsMore?.classList.remove("hidden");
}

function deduplicatedArticleCount(payload) {
  if (!payload) return 0;
  const seen = new Set();
  let n = 0;
  const links =
    Array.isArray(payload.portfolio_articles) || Array.isArray(payload.category_articles)
      ? [...(payload.portfolio_articles || []), ...(payload.category_articles || [])]
      : payload.source_links || [];
  for (const link of links) {
    const url = String(link.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    n += 1;
  }
  return n;
}

function renderBrief(payload) {
  state.brief = payload;
  state.watchlistQuotes = payload.quotes || state.watchlistQuotes || {};
  const generatedDate = new Date(payload.generated_at);
  el.showNotesDate.textContent = formatBritishDateFull(generatedDate);
  const audioUrl = resolveMediaUrl(payload.audio_url);
  requestAnimationFrame(() => {
    el.audioPlayer.src = audioUrl;
    el.audioPlayer.load();
    updatePlayerDurationLabels();
    updateProgressUi();
    syncPlayButtonState();
  });
  updateNewStoriesBadge(payload.source_links || []);
  renderHomeQuickCards(payload);
  syncHomeBriefUi();

  state.sessionMutedDomains = new Set();
  state.preparedArticles = [];
  prepareArticlesFromBrief(payload);
  renderNotesSummary(payload);
  renderArticles();
  renderAlarmSteps(payload);
}

function applyBriefGenerationCancelledUi() {
  clearBriefProgress();
  setStatus("");
}

async function generateDailyBrief(evt) {
  evt?.preventDefault?.();
  if (state.loading) return;
  if (hasReachedDailyLimit()) {
    const msg = `Daily generation limit reached. Try again in ${formatCountdownToMidnight()}, or unlock unlimited generation in Profile.`;
    setStatus(msg, true);
    toast("Daily limit reached");
    syncDailyLimitUi();
    return;
  }
  if (!state.portfolio.length) {
    setStatus("Add at least one holding to your watchlist on the Profile tab.", true);
    toast("Add a holding to your watchlist first");
    switchScreen("portfolio");
    return;
  }
  setLoading(true);
  if (state.portfolio.length < WATCHLIST_SLOT_LIMIT) {
    toast(`Using ${state.portfolio.length} of ${WATCHLIST_SLOT_LIMIT} watchlist slots — add more on Profile for fuller coverage.`);
  }

  const ac = new AbortController();
  activeBriefAbortController = ac;
  console.time("daily-brief-mvp:request");

  try {
    const body = {
      listener_name: el.listenerName.value.trim() || "Investor",
      occupation: el.occupation.value.trim() || "Professional",
      investor_type: el.investorType.value,
      app_use: el.appUse.value === "manual" ? "morning-brief" : el.appUse.value.trim(),
      portfolio: state.portfolio.map((item) => ({ ticker: item.ticker, asset_type: item.asset_type })),
      general_category: normalizeFocusAreaKey(el.generalCategory?.value),
      focus_categories: readProfileFocusCategories(),
      notification_time: el.notificationTime.value || "07:00",
      wants_alarm_mode: Boolean(el.alarmMode.checked),
      hours_back: 48,
      max_articles: 36,
      target_minutes: 4,
      local_time_of_day: getLocalTimeOfDay(),
    };

    const refreshNews = Boolean(state.brief);
    const res = await fetch(`/daily-brief-mvp${refreshNews ? "?refresh_news=true" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (ac.signal.aborted) {
      applyBriefGenerationCancelledUi();
      return;
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const apiDetail = errBody.detail;
      console.error("Daily brief API error", {
        status: res.status,
        detail: apiDetail,
        body: errBody,
      });
      throw new Error(USER_BRIEF_ERROR_MESSAGE);
    }
    const payload = await res.json();
    if (ac.signal.aborted) {
      applyBriefGenerationCancelledUi();
      return;
    }
    renderBrief(payload);
    if (!state.masterUnlocked) markDailyBriefGenerated(payload);
    switchScreen("briefings");
    setStatus("Daily brief ready.");
    toast("Briefing ready");
  } catch (err) {
    const aborted = ac.signal.aborted || err?.name === "AbortError";
    if (aborted) {
      applyBriefGenerationCancelledUi();
      return;
    }
    console.error("Daily brief generation failed", err);
    setStatus(USER_BRIEF_ERROR_MESSAGE, true);
    toast(USER_BRIEF_ERROR_MESSAGE);
  } finally {
    console.timeEnd("daily-brief-mvp:request");
    if (activeBriefAbortController === ac) {
      activeBriefAbortController = null;
    }
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

async function unlockUnlimitedGeneration() {
  const password = String(el.masterPassword?.value || "").trim();
  if (!password) {
    toast("Enter the master password");
    el.masterPassword?.focus();
    return;
  }
  if (el.masterUnlockBtn) el.masterUnlockBtn.disabled = true;
  try {
    const res = await fetch("/profile/master-unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.unlocked) {
      writeMasterUnlockSession(false);
      state.masterUnlocked = false;
      syncDailyLimitUi();
      toast("Incorrect master password");
      return;
    }
    state.masterUnlocked = true;
    writeMasterUnlockSession(true);
    syncDailyLimitUi();
    setStatus("");
    toast("Unlimited generation unlocked");
  } catch (err) {
    console.error("Master unlock failed", err);
    toast("Could not verify password");
  } finally {
    syncDailyLimitUi();
  }
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
      body: "Your morning brief is ready to generate.",
    });
    scheduleReminder();
  }, delay);
}

function bindEvents() {
  if (appUiEventsBound) return;
  appUiEventsBound = true;

  el.navItems.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = btn.dataset.screenTarget;
      if (target) switchScreen(target);
    });
  });
  el.articlesFilters?.addEventListener("click", (e) => {
    const btn = e.target.closest(".article-filter");
    if (!btn || !el.articlesFilters?.contains(btn)) return;
    state.articleFilter = btn.dataset.filter || "portfolio";
    state.expandedArticleUrl = null;
    syncArticleFilterPillActiveState();
    el.articlesPage?.scrollIntoView({ block: "start", behavior: "instant" });
    window.scrollTo({ top: 0, behavior: "instant" });
    renderArticles();
  });
  el.articleDetailBack?.addEventListener("click", () => {
    state.articleDetailUrl = null;
    switchScreen("articles");
  });
  el.manageMutedSources?.addEventListener("click", openMutedSourcesSheet);
  el.closeMutedSheet?.addEventListener("click", closeMutedSourcesSheet);
  el.mutedSourcesSheet?.addEventListener("click", (e) => {
    if (e.target === el.mutedSourcesSheet) closeMutedSourcesSheet();
  });
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
  const profileFields = [
    el.listenerName,
    el.listenerEmail,
    el.investorType,
    el.appUse,
    el.generalCategory,
    el.notificationTime,
    el.alarmMode,
  ];
  profileFields.forEach((field) => {
    if (!field) return;
    const evt = field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input";
    field.addEventListener(evt, () => {
      if (field === el.generalCategory) {
        syncFocusAreaHint();
        buildArticleFilterPills();
        if (state.brief) renderArticles();
      }
      saveProfileToStorage();
      renderProfileDisplay();
      if (field === el.listenerName) refreshIdleHeroGreeting();
      if (field === el.notificationTime) scheduleReminder();
      if (field === el.alarmMode) syncAlarmSetupRowVisibility();
    });
  });

  el.accountSegment?.querySelectorAll(".account-segment__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.accountView;
      if (view) switchAccountView(view);
    });
  });

  window.addEventListener("resize", () => {
    if (state.activeScreen === "portfolio") updateAccountSegmentThumb();
  });

  document.querySelectorAll("[data-upgrade-cta]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openUpgradePlaceholder();
    });
  });

  document.querySelectorAll("[data-profile-field]").forEach((row) => {
    row.addEventListener("click", () => {
      const field = row.dataset.profileField;
      if (field === "name") editProfileName();
      else if (field === "email") editProfileEmail();
      else if (field === "investor-type") openInvestorTypePicker();
      else if (field === "focus") openFocusAreaPicker();
      else if (field === "notify") openNotifyTimePicker();
      else if (field === "app-use") openAppUsePicker();
    });
  });

  document.querySelectorAll("[data-profile-action]").forEach((row) => {
    row.addEventListener("click", () => {
      const action = row.dataset.profileAction;
      if (action === "rate") toast("App Store rating — coming soon");
      else if (action === "feedback") {
        window.location.href = "mailto:feedback@marketcall.app?subject=MarketCall%20Feedback";
      } else if (action === "terms") {
        window.open("/static/docs/AI_Investment_Summary_Terms_and_Conditions.pdf", "_blank", "noopener,noreferrer");
      } else if (action === "clear") clearAllUserData();
    });
  });

  el.accountPickerSheet?.querySelectorAll("[data-close-picker]").forEach((node) => {
    node.addEventListener("click", closeAccountPicker);
  });

  el.accountFieldSheetSave?.addEventListener("click", saveAccountFieldSheet);
  el.accountFieldSheet?.querySelectorAll("[data-close-field-sheet]").forEach((node) => {
    node.addEventListener("click", closeAccountFieldSheet);
  });
  el.accountFieldSheetBody?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveAccountFieldSheet();
    }
  });
  el.alarmSetupBtn?.addEventListener("click", openAlarmSheet);
  el.closeAlarmSheet?.addEventListener("click", closeAlarmSheet);
  el.alarmSheet?.addEventListener("click", (e) => {
    if (e.target === el.alarmSheet) closeAlarmSheet();
  });
  el.masterUnlockBtn?.addEventListener("click", () => void unlockUnlimitedGeneration());
  el.masterPassword?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void unlockUnlimitedGeneration();
    }
  });
  el.refreshBriefBtn?.addEventListener("click", generateDailyBrief);
  el.playBtn?.addEventListener("click", () => void toggleAudioPlayback());
  el.portfolioInsightsMore?.addEventListener("click", () => switchScreen("show-notes"));
  el.homeQuickCards.forEach((card) => {
    card.addEventListener("click", () => {
      const target = card.dataset.screenTarget;
      if (target) switchScreen(target);
    });
  });
  bindAudioElementListeners();
  bindProgressScrubbing();
  el.notifyBtn.addEventListener("click", requestNotifications);
  el.notificationTime.addEventListener("change", scheduleReminder);
  el.closeArticleSheet.addEventListener("click", closeArticleSheet);
  el.articleSheet.addEventListener("click", (e) => {
    if (e.target === el.articleSheet) closeArticleSheet();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshAppTitle();
      refreshHomeDateLine();
      refreshIdleHeroGreeting();
      syncDailyLimitUi();
    }
  });
  document.addEventListener("click", (e) => {
    if (!el.searchResults.contains(e.target) && e.target !== el.stockSearch) {
      el.searchResults.classList.remove("is-open");
    }
  });
}

function initTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
  };
  apply();
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", apply);
  } else if (typeof mq.addListener === "function") {
    mq.addListener(apply);
  }
}

function init() {
  initTheme();
  assertRequiredDom();
  state.masterUnlocked = readMasterUnlockSession();
  startDailyLimitCountdownTimer();
  loadProfileFromStorage();
  syncFocusAreaHint();
  buildArticleFilterPills();
  renderAccountScreen();
  bindEvents();
  el.appPhone?.classList.add("app-phone--home");
  syncAppHeaderTagline(state.activeScreen);
  refreshHomeDateLine();
  syncHomeBriefUi();
  syncPlayButtonState();
  refreshAppTitle();
  updatePlayerDurationLabels();
  updateProgressUi();
  updateNewStoriesBadge([]);
  renderHomeQuickCards(null);
  renderPortfolioInsights(null);
  setStatus("");
  syncRefreshBriefButtonIdleLabel();
  setRefreshButtonLoading(false);
  syncDailyLimitUi();
  renderNotesSummary(state.brief);
  renderArticles();
  syncAiFootnote();
  syncManageMutedLink();
  saveProfileToStorage();
  void fetchWatchlistQuotes();
}

init();
