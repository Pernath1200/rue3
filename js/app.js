/**
 * RUE3 Vocabulary Trainer
 */

const SRS_KEY = "rue3_srs";
const SESSION_IDX_KEY = "rue3_session_index";
const BOOKMARKS_KEY = "rue3_bookmarks";
const PLACEMENT_KEY = "rue3_placement_level";

const BOX_INTERVALS = [1, 2, 4, 8, 16];

const TYPE_COLOURS = {
  concrete: "#4ecdc4",
  abstract: "#7b68ee",
  verb: "#ff6b6b",
  adjective: "#ffd93d",
  phrase: "#ff8c42",
};

const GAP_MARKER = "___";

let wordBank = [];
let sessionDeck = [];
let sessionIndex = 0;
let currentGlobalSession = 0;
let pendingLength = "20";
let advanceTimer = null;
let sessionReviewEntries = [];
let allWordsIndex = {};
let sessionSource = "core";
let lastSessionSource = "core";
let topicRegistry = [];
let placementLexicon = null;
let placementState = null;

const LEVEL_DATA_FILES = {
  A1: "../data/a1_cars.json",
  B2: "../data/b2_tech.json",
};
const TOPIC_INDEX_FILE = "../data/topics/index.json";

const views = {
  home: "view-home",
  placementIntro: "view-placement-intro",
  placementWords: "view-placement-words",
  placementResult: "view-placement-result",
  topic: "view-topic",
  levels: "view-levels",
  sessionSetup: "view-session-setup",
  caughtUp: "view-caught-up",
  quiz: "view-quiz",
  review: "view-review",
  myWords: "view-my-words",
};

const PLACEMENT_EXPLAINERS = {
  A1: "You're at the beginning — start with simple, everyday words.",
  A2: "You know the basics. Time to build on that foundation.",
  B1: "You have a good working vocabulary. Let's fill in the gaps.",
  B2: "You have a strong vocabulary. Let's refine and expand it.",
};

function normalizeWord(raw) {
  const s =
    Array.isArray(raw.sentences) && raw.sentences.length
      ? raw.sentences
      : raw.sentence
        ? [{ text: raw.sentence, hint: raw.hint || "" }]
        : [];
  return {
    ...raw,
    sentences: s.map((x) => ({
      text: x.text || "",
      hint: x.hint || "",
    })),
  };
}

function loadSRS() {
  try {
    const raw = localStorage.getItem(SRS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSRS(data) {
  localStorage.setItem(SRS_KEY, JSON.stringify(data));
}

function getSessionIndex() {
  const v = localStorage.getItem(SESSION_IDX_KEY);
  return v ? parseInt(v, 10) || 0 : 0;
}

function setSessionIndex(n) {
  localStorage.setItem(SESSION_IDX_KEY, String(n));
}

function getWordRecord(srs, id) {
  return srs[id] || null;
}

function defaultRecord() {
  const today = new Date().toISOString().slice(0, 10);
  return { box: 1, lastSeen: today, sessionCount: 0, lastSentenceIdx: -1 };
}

/** Due if sessions since last practice >= interval for current box */
function isDue(record, nextSessionNum) {
  const box = Math.min(5, Math.max(1, record.box || 1));
  const lastS = record.sessionCount ?? 0;
  const need = BOX_INTERVALS[box - 1];
  return nextSessionNum - lastS >= need;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeAnswer(s) {
  return String(s)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function matchesAnswer(user, correct) {
  return normalizeAnswer(user) === normalizeAnswer(correct);
}

/** Letter groups (per word) for dash display — letters only, no spaces */
function getWordLetterGroups(answer) {
  return answer
    .trim()
    .split(/\s+/)
    .map((w) => [...w].filter((c) => /[a-zA-Z]/.test(c)))
    .filter((g) => g.length > 0);
}

function totalLetterSlots(answer) {
  return getWordLetterGroups(answer).reduce((n, g) => n + g.length, 0);
}

/** Letters typed in order, ignoring spaces and non-letters */
function extractLetterCharsArray(str) {
  const out = [];
  for (const ch of String(str)) {
    if (/[a-zA-Z]/.test(ch)) out.push(ch);
  }
  return out;
}

/**
 * First letter of the first word for the hint: lowercase for ordinary words;
 * preserves uppercase when the lexicon stores a proper noun / intentional capital.
 */
function firstHintLetter(answer) {
  const t = answer.trim();
  if (!t) return "";
  const firstTok = t.split(/\s+/)[0];
  const c = firstTok[0];
  if (!c) return "";
  if (c === c.toUpperCase() && c !== c.toLowerCase()) {
    return c;
  }
  return c.toLowerCase();
}

function updateLetterSlotsDisplay() {
  const word = sessionDeck[sessionIndex];
  const el = document.getElementById("letter-slots");
  if (!word || !el) return;

  const groups = getWordLetterGroups(word.word);
  const flatLen = totalLetterSlots(word.word);
  const input = document.getElementById("quiz-input");
  const typed = extractLetterCharsArray(input ? input.value : "").slice(
    0,
    flatLen
  );

  let idx = 0;
  const parts = [];
  groups.forEach((group, gi) => {
    for (let li = 0; li < group.length; li++) {
      const t = typed[idx];
      idx += 1;
      if (t) {
        parts.push(
          `<span class="letter-slot letter-slot--filled">${escapeHtml(t)}</span>`
        );
      } else {
        parts.push('<span class="letter-slot letter-slot--empty">_</span>');
      }
    }
    if (gi < groups.length - 1) {
      parts.push('<span class="letter-slot-word-gap" aria-hidden="true"></span>');
    }
  });
  el.innerHTML = parts.join("") || "&nbsp;";
}

function applyFirstLetterHintToInput(answer) {
  const input = document.getElementById("quiz-input");
  if (!input || input.disabled) return;

  const h = firstHintLetter(answer);
  if (!h) return;

  const v = input.value;
  if (!v.trim()) {
    input.value = h;
  } else if (!/[a-zA-Z]/.test(v)) {
    input.value = h + v;
  } else {
    input.value = v.replace(/[a-zA-Z]/, h);
  }

  const pos = input.value.indexOf(h);
  const after = pos >= 0 ? pos + h.length : h.length;
  input.setSelectionRange(after, after);
}

function updateHomeMyWordsButton() {
  const btn = document.getElementById("btn-home-my-words");
  if (!btn) return;
  const marks = loadBookmarks();
  const has = Object.keys(marks).some((id) => marks[id]?.bookmarked);
  btn.hidden = !has;
}

function showView(name) {
  Object.values(views).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const active = Object.keys(views).find((k) => views[k] === id) === name;
    el.hidden = !active;
    el.classList.toggle("view--active", active);
  });
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._tid);
  showToast._tid = setTimeout(() => {
    t.hidden = true;
  }, 2000);
}

function typeColour(type) {
  return TYPE_COLOURS[type] || TYPE_COLOURS.abstract;
}

function pickSentenceVariant(word) {
  const variants = Array.isArray(word.sentences) ? word.sentences : [];
  const clean = variants.filter((v) => v && v.text);
  if (!clean.length) {
    return { idx: 0, text: `${GAP_MARKER}`, hint: "" };
  }
  if (clean.length === 1) {
    return { idx: 0, text: clean[0].text, hint: clean[0].hint || "" };
  }

  const srs = loadSRS();
  const rec = { ...defaultRecord(), ...(getWordRecord(srs, word.id) || {}) };
  const prevIdx = typeof rec.lastSentenceIdx === "number" ? rec.lastSentenceIdx : -1;
  const options = clean.map((_, i) => i).filter((i) => i !== prevIdx);
  const nextIdx = options[Math.floor(Math.random() * options.length)];
  return { idx: nextIdx, text: clean[nextIdx].text, hint: clean[nextIdx].hint || "" };
}

function buildCustomDeck(words, lengthMode) {
  const shuffled = shuffle(words.map((w) => ({ ...w })));
  const cap =
    lengthMode === "10" ? 10 : lengthMode === "20" ? 20 : shuffled.length;
  return shuffled.slice(0, Math.min(cap, shuffled.length));
}

/**
 * Build ordered list of word objects for session.
 * @param {string} lengthMode - '10' | '20' | 'all'
 * @param {boolean} force - include not-due words if nothing due
 * @param {string[]} priorityIds - show first (e.g. wrong answers from last run)
 */
function buildSessionDeck(lengthMode, force, priorityIds = []) {
  const srs = loadSRS();
  const prev = getSessionIndex();
  const nextSession = prev + 1;

  const all = wordBank.map((w) => ({ ...w }));
  const cap =
    lengthMode === "10"
      ? 10
      : lengthMode === "20"
        ? 20
        : all.length;

  const due = [];
  const notDue = [];
  for (const w of all) {
    const merged = { ...defaultRecord(), ...(getWordRecord(srs, w.id) || {}) };
    if (isDue(merged, nextSession)) due.push(w);
    else notDue.push(w);
  }

  if (!force && due.length === 0) {
    return { deck: [], nextSession, emptyDue: true };
  }

  const priSet = new Set(priorityIds);
  const priority = shuffle(all.filter((w) => priSet.has(w.id)));
  const duePool = shuffle(due.filter((w) => !priSet.has(w.id)));
  const notDuePool = shuffle(notDue);

  const buckets = [...priority, ...duePool, ...notDuePool];
  const seen = new Set();
  const ordered = [];

  for (const w of buckets) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    ordered.push(w);
    if (ordered.length >= cap) break;
  }

  if (ordered.length === 0 && force) {
    for (const w of shuffle(all)) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      ordered.push(w);
      if (ordered.length >= cap) break;
    }
  }

  return {
    deck: ordered.slice(0, Math.min(cap, ordered.length)),
    nextSession,
    emptyDue: false,
  };
}

function startQuizFlow(lengthMode, force, priorityIds, customWords = null) {
  clearTimeout(advanceTimer);
  const prev = getSessionIndex();
  const nextSession = prev + 1;
  const customDeck =
    Array.isArray(customWords) && customWords.length
      ? buildCustomDeck(customWords, lengthMode)
      : null;
  const { deck, emptyDue } = customDeck
    ? { deck: customDeck, emptyDue: false }
    : buildSessionDeck(lengthMode, force, priorityIds);

  if (emptyDue && !force) {
    showView("caughtUp");
    return;
  }

  currentGlobalSession = nextSession;
  setSessionIndex(nextSession);
  sessionDeck = deck;
  sessionIndex = 0;
  sessionReviewEntries = [];
  lastSessionSource = sessionSource;

  if (sessionDeck.length === 0) {
    showToast("No words available.");
    showView("sessionSetup");
    return;
  }

  showView("quiz");
  renderQuestion();
}

function applyQuizCardType(type) {
  const card = document.getElementById("quiz-card");
  if (!card) return;
  const c = typeColour(type);
  card.style.setProperty("--type-colour", c);
}

function updateProgress() {
  const total = sessionDeck.length;
  const cur = sessionIndex + 1;
  const el = document.getElementById("quiz-progress");
  const fill = document.getElementById("progress-bar-fill");
  const bar = document.getElementById("progress-bar");
  if (el) el.textContent = `${cur} / ${total}`;
  const pct = total ? Math.round(((sessionIndex + 1) / total) * 100) : 0;
  if (fill) fill.style.width = `${pct}%`;
  if (bar) {
    bar.setAttribute("aria-valuenow", String(pct));
    bar.setAttribute("aria-valuemax", "100");
  }
}

function renderSentenceHTML(word, gapClass, gapText) {
  const sentenceText = word._activeSentenceText || GAP_MARKER;
  const parts = sentenceText.split(GAP_MARKER);
  const before = parts[0] || "";
  const after = parts.slice(1).join(GAP_MARKER) || "";
  const gapCls = gapClass ? ` gap ${gapClass}` : " gap";
  return `${before}<span class="${gapCls.trim()}" id="quiz-gap">${gapText}</span>${after}`;
}

function renderQuestion() {
  const word = sessionDeck[sessionIndex];
  if (!word) return;

  const sentenceEl = document.getElementById("quiz-sentence");
  const feedback = document.getElementById("quiz-feedback");
  const hintText = document.getElementById("hint-text");
  const btnHint = document.getElementById("btn-hint");
  const btnFirstLetter = document.getElementById("btn-first-letter");
  const input = document.getElementById("quiz-input");
  const btnSubmit = document.getElementById("btn-submit");
  const btnNext = document.getElementById("btn-next");

  if (btnFirstLetter) {
    btnFirstLetter.disabled = false;
    btnFirstLetter.classList.remove("btn--used");
  }

  const selected = pickSentenceVariant(word);
  word._activeSentenceIdx = selected.idx;
  word._activeSentenceText = selected.text;
  word._activeHint = selected.hint;

  applyQuizCardType(word.type);
  sentenceEl.innerHTML = renderSentenceHTML(word, "", "_____");
  feedback.textContent = "";
  feedback.className = "feedback";
  hintText.textContent = word._activeHint;
  hintText.hidden = true;
  btnHint.setAttribute("aria-expanded", "false");
  input.value = "";
  input.disabled = false;
  btnSubmit.hidden = false;
  btnNext.hidden = true;
  updateLetterSlotsDisplay();
  input.focus();

  updateProgress();
}

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveBookmarks(data) {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(data));
}

function isBookmarked(wordId) {
  const b = loadBookmarks();
  return Boolean(b[wordId]?.bookmarked);
}

function toggleBookmark(wordId) {
  const b = loadBookmarks();
  if (b[wordId]?.bookmarked) {
    delete b[wordId];
  } else {
    b[wordId] = {
      bookmarked: true,
      dateAdded: new Date().toISOString().slice(0, 10),
    };
  }
  saveBookmarks(b);
  return Boolean(b[wordId]?.bookmarked);
}

function revealSentence(sentence, answer) {
  const parts = sentence.split(GAP_MARKER);
  const before = parts[0] || "";
  const after = parts.slice(1).join(GAP_MARKER) || "";
  return `${escapeHtml(before)}<strong class="review-card__highlight">${escapeHtml(answer)}</strong>${escapeHtml(after)}`;
}

function encouragementLine(score, total) {
  const pct = total ? (score / total) * 100 : 0;
  if (pct >= 90) return "Excellent — you know these well.";
  if (pct >= 70) return "Good work — keep practising the tricky ones.";
  if (pct >= 50) return "Getting there — review the words below.";
  return "These words need more practice. Don't worry — that's what the app is for.";
}

function reviewCardHtml(entry, showStatus = true) {
  const marked = isBookmarked(entry.wordId);
  const statusHtml = showStatus
    ? `<span class="type-dot" aria-hidden="true"></span><span class="review-card__status ${entry.correct ? "review-card__status--ok" : "review-card__status--bad"}" aria-hidden="true">${entry.correct ? "✓" : "✗"}</span>`
    : '<span class="type-dot" aria-hidden="true"></span>';
  const wrongHtml =
    !entry.correct && showStatus
      ? `<p class="review-card__mistake">You typed: <s>${escapeHtml(entry.userAnswer || "(blank)")}</s></p>`
      : "";

  return `
    <li class="review-card" style="--type-colour:${typeColour(entry.type)}">
      <div class="review-card__top">
        <div>
          <div class="review-card__word">${statusHtml}<span>${escapeHtml(entry.word)}</span><span class="review-card__pos">${escapeHtml(entry.pos)}</span></div>
          <p class="review-card__sentence">${revealSentence(entry.sentence, entry.word)}</p>
          <p class="review-card__hint">${escapeHtml(entry.hint)}</p>
          ${wrongHtml}
        </div>
        <button type="button" class="bookmark-btn ${marked ? "bookmark-btn--active" : ""}" data-bookmark-id="${escapeHtml(entry.wordId)}" aria-label="Toggle bookmark">${marked ? "★" : "☆"}</button>
      </div>
    </li>
  `;
}

function renderReviewScreen() {
  const total = sessionReviewEntries.length;
  const score = sessionReviewEntries.filter((x) => x.correct).length;
  const scoreEl = document.getElementById("review-score");
  const msgEl = document.getElementById("review-message");
  const listEl = document.getElementById("review-list");
  const btnPractice = document.getElementById("btn-practice-again");
  const wrong = sessionReviewEntries.filter((x) => !x.correct);

  scoreEl.textContent = `You scored ${score} / ${total}`;
  msgEl.textContent = encouragementLine(score, total);
  listEl.innerHTML = sessionReviewEntries.map((entry) => reviewCardHtml(entry, true)).join("");
  btnPractice.textContent = wrong.length
    ? "Practise Again"
    : "Practise Again (all words)";
}

function renderMyWords() {
  const marks = loadBookmarks();
  const ids = Object.keys(marks).filter((id) => marks[id]?.bookmarked);
  const list = document.getElementById("my-words-list");
  const empty = document.getElementById("my-words-empty");
  const countEl = document.getElementById("my-words-count");
  const minNote = document.getElementById("my-words-min-note");
  const btnPractice = document.getElementById("btn-practise-my-words");

  countEl.textContent = `${ids.length} ${ids.length === 1 ? "word" : "words"} saved`;
  btnPractice.disabled = ids.length < 3;
  btnPractice.textContent =
    ids.length < 3
      ? "Save at least 3 words to start practising"
      : "Practise My Words";
  minNote.hidden = ids.length >= 3;

  if (!ids.length) {
    list.innerHTML = "";
    empty.hidden = false;
    updateHomeMyWordsButton();
    return;
  }

  const entries = ids
    .map((id) => allWordsIndex[id])
    .filter(Boolean)
    .map((w) => ({
      wordId: w.id,
      word: w.word,
      pos: w.pos,
      type: w.type,
      sentence: w.sentences?.[0]?.text || GAP_MARKER,
      hint: w.sentences?.[0]?.hint || "",
      userAnswer: "",
      correct: true,
    }));

  empty.hidden = entries.length > 0;
  list.innerHTML = entries.map((entry) => reviewCardHtml(entry, false)).join("");
  updateHomeMyWordsButton();
}

function updateSRAfterAnswer(word, correct) {
  const srs = loadSRS();
  const prev = getWordRecord(srs, word.id) || defaultRecord();
  const merged = { ...defaultRecord(), ...prev };
  const today = new Date().toISOString().slice(0, 10);

  if (correct) {
    merged.box = Math.min(5, (merged.box || 1) + 1);
  } else {
    merged.box = 1;
  }
  merged.lastSeen = today;
  merged.sessionCount = currentGlobalSession;
  merged.lastSentenceIdx =
    typeof word._activeSentenceIdx === "number" ? word._activeSentenceIdx : -1;

  srs[word.id] = merged;
  saveSRS(srs);
}

let sessionResults = { correct: 0, wrong: [] };

function handleSubmit() {
  const word = sessionDeck[sessionIndex];
  if (!word) return;

  const btnNext = document.getElementById("btn-next");
  if (btnNext && !btnNext.hidden) return;

  const input = document.getElementById("quiz-input");
  if (input.disabled) return;

  const user = input.value;
  const ok = matchesAnswer(user, word.word);

  const gap = document.getElementById("quiz-gap");
  const feedback = document.getElementById("quiz-feedback");
  const btnSubmit = document.getElementById("btn-submit");

  input.disabled = true;
  btnSubmit.hidden = true;

  updateSRAfterAnswer(word, ok);
  sessionReviewEntries.push({
    wordId: word.id,
    word: word.word,
    pos: word.pos,
    type: word.type,
    sentence: word._activeSentenceText || GAP_MARKER,
    hint: word._activeHint || "",
    userAnswer: user.trim(),
    correct: ok,
  });

  if (ok) {
    sessionResults.correct += 1;
    if (gap) {
      gap.textContent = word.word;
      gap.classList.add("gap--filled-correct");
    }
    feedback.textContent = "Correct!";
    feedback.className = "feedback feedback--ok";

    advanceTimer = setTimeout(() => {
      goNext();
    }, 1500);
  } else {
    sessionResults.wrong.push({
      id: word.id,
      word: word.word,
      userAnswer: user.trim() || "(blank)",
    });
    if (gap) {
      gap.textContent = word.word;
      gap.classList.add("gap--filled-wrong");
    }
    feedback.innerHTML = `<span class="feedback--bad">Not quite.</span><div class="wrong-answer-line">Your answer: ${escapeHtml(user.trim() || "(blank)")}</div>`;
    feedback.className = "feedback";
    btnNext.hidden = false;
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function goNext() {
  clearTimeout(advanceTimer);
  sessionIndex += 1;
  if (sessionIndex >= sessionDeck.length) {
    showEndScreen();
    return;
  }
  renderQuestion();
}

function showEndScreen() {
  renderReviewScreen();
  showView("review");
}

function resetSessionResults() {
  sessionResults = { correct: 0, wrong: [] };
}

async function loadTopicRegistry() {
  try {
    const res = await fetch(new URL(TOPIC_INDEX_FILE, import.meta.url));
    topicRegistry = await res.json();
    return true;
  } catch (e) {
    console.error(e);
    showToast("Could not load topics.");
    topicRegistry = [];
    return false;
  }
}

function renderTopicMenu() {
  const wrap = document.getElementById("topic-list");
  if (!wrap) return;
  wrap.innerHTML = topicRegistry
    .map((topic) => {
      const muted = topic.active ? "" : " btn--muted";
      return `<button type="button" class="btn btn--large${muted}" data-topic-id="${escapeHtml(topic.id)}">${escapeHtml(topic.name)}</button>`;
    })
    .join("");
}

async function loadTopicWordBank(topicId) {
  const topic = topicRegistry.find((t) => t.id === topicId);
  if (!topic) {
    showToast("Topic not found.");
    return false;
  }
  if (!topic.active) {
    showToast("Coming soon");
    return false;
  }

  try {
    const res = await fetch(
      new URL(`../data/topics/${topic.file}`, import.meta.url)
    );
    const raw = await res.json();
    wordBank = raw.map(normalizeWord);
    return true;
  } catch (e) {
    console.error(e);
    showToast("Could not load topic words.");
    return false;
  }
}

async function loadAllWordsIndex() {
  const merged = {};
  const paths = Object.values(LEVEL_DATA_FILES);
  topicRegistry
    .filter((topic) => topic.active)
    .forEach((topic) => {
      paths.push(`../data/topics/${topic.file}`);
    });
  await Promise.all(
    paths.map(async (p) => {
      try {
        const res = await fetch(new URL(p, import.meta.url));
        const items = await res.json();
        items.forEach((w) => {
          merged[w.id] = normalizeWord(w);
        });
      } catch (e) {
        console.error(e);
      }
    })
  );
  allWordsIndex = merged;
}

async function loadPlacementData() {
  if (placementLexicon) return;
  const res = await fetch(new URL("../data/placement.json", import.meta.url));
  const data = await res.json();
  placementLexicon = data.placement_words;
}

async function openPlacementIntro() {
  try {
    await loadPlacementData();
    showView("placementIntro");
  } catch (e) {
    console.error(e);
    showToast("Could not load placement test.");
  }
}

function renderPlacementGrid(gridId, items) {
  const el = document.getElementById(gridId);
  if (!el || !placementState) return;
  el.innerHTML = items
    .map((item) => {
      const w = item.word;
      const sel = placementState.known.has(w);
      const esc = escapeHtml(w);
      return `<button type="button" class="placement-chip${sel ? " placement-chip--selected" : ""}" data-placement-word="${esc}" aria-pressed="${sel}">${esc}</button>`;
    })
    .join("");
}

function showPlacementPage(page) {
  const p1 = document.getElementById("placement-panel-1");
  const p2 = document.getElementById("placement-panel-2");
  const label = document.getElementById("placement-page-label");
  const a1 = document.getElementById("placement-actions-p1");
  const a2 = document.getElementById("placement-actions-p2");
  if (!p1 || !p2 || !label || !a1 || !a2) return;
  label.textContent = `Page ${page} of 2`;
  if (page === 1) {
    p1.classList.add("placement-panel--active");
    p2.classList.remove("placement-panel--active");
    p1.setAttribute("aria-hidden", "false");
    p2.setAttribute("aria-hidden", "true");
    a1.hidden = false;
    a2.hidden = true;
  } else {
    p1.classList.remove("placement-panel--active");
    p2.classList.add("placement-panel--active");
    p1.setAttribute("aria-hidden", "true");
    p2.setAttribute("aria-hidden", "false");
    a1.hidden = true;
    a2.hidden = false;
  }
}

function computePlacementLevel(knownSet, lexicon) {
  const counts = { A1: 0, A2: 0, B1: 0, B2: 0 };
  for (const item of lexicon) {
    if (knownSet.has(item.word)) counts[item.level] += 1;
  }
  if (counts.B2 >= 8) return "B2";
  if (counts.B1 >= 8) return "B1";
  if (counts.A2 >= 8) return "A2";
  return "A1";
}

async function beginPlacementTest() {
  try {
    await loadPlacementData();
  } catch (e) {
    console.error(e);
    showToast("Could not load placement test.");
    return;
  }
  const order = shuffle([...placementLexicon]);
  placementState = { order, known: new Set() };
  renderPlacementGrid("placement-grid-1", order.slice(0, 24));
  renderPlacementGrid("placement-grid-2", order.slice(24, 48));
  showPlacementPage(1);
  showView("placementWords");
}

function finishPlacementTest() {
  if (!placementState || !placementLexicon) return;
  const level = computePlacementLevel(placementState.known, placementLexicon);
  localStorage.setItem(PLACEMENT_KEY, level);
  document.getElementById("placement-result-line").innerHTML =
    `Your vocabulary level is approximately <strong>${escapeHtml(level)}</strong>`;
  document.getElementById("placement-result-explainer").textContent =
    PLACEMENT_EXPLAINERS[level];
  document.getElementById("placement-result-rec").innerHTML =
    `We recommend starting with <strong>${escapeHtml(level)} Core Vocabulary</strong>`;
  showView("placementResult");
}

async function init() {
  await loadTopicRegistry();
  renderTopicMenu();
  await loadAllWordsIndex();
  wordBank = [];
  updateHomeMyWordsButton();

  document.getElementById("app").addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) {
      const target = nav.getAttribute("data-nav");
      if (target === "home") showView("home");
      if (target === "core") {
        sessionSource = "core";
        showView("levels");
      }
      if (target === "topic") {
        renderTopicMenu();
        showView("topic");
      }
      if (target === "placement") {
        openPlacementIntro();
        return;
      }
      if (target === "my-words") {
        sessionSource = "myWords";
        renderMyWords();
        showView("myWords");
      }
      return;
    }

    const level = e.target.closest("[data-level]");
    if (level) {
      showToast("Coming soon");
      return;
    }

    const topicBtn = e.target.closest("[data-topic-id]");
    if (topicBtn) {
      const topicId = topicBtn.getAttribute("data-topic-id");
      const topic = topicRegistry.find((t) => t.id === topicId);
      if (!topic || !topic.active) {
        showToast("Coming soon");
        return;
      }
      loadTopicWordBank(topicId).then((ok) => {
        if (!ok) return;
        sessionSource = "topic";
        resetSessionResults();
        document.getElementById("setup-title").textContent = "How many words?";
        showView("sessionSetup");
      });
      return;
    }

    const back = e.target.closest("[data-back]");
    if (back) {
      const b = back.getAttribute("data-back");
      if (b === "levels") {
        if (sessionSource === "myWords") showView("myWords");
        else if (sessionSource === "topic") showView("topic");
        else showView("levels");
      }
      if (b === "session-setup") showView("sessionSetup");
      return;
    }
  });

  document.querySelectorAll("[data-length]").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingLength = btn.getAttribute("data-length");
      resetSessionResults();
      if (sessionSource === "myWords") {
        const marks = loadBookmarks();
        const ids = Object.keys(marks).filter((id) => marks[id]?.bookmarked);
        const words = ids.map((id) => allWordsIndex[id]).filter(Boolean);
        startQuizFlow(pendingLength, true, [], words);
      } else if (sessionSource === "topic") {
        startQuizFlow(pendingLength, true, []);
      } else {
        startQuizFlow(pendingLength, false, []);
      }
    });
  });

  document.getElementById("btn-practice-anyway").addEventListener("click", () => {
    resetSessionResults();
    startQuizFlow(pendingLength, true, []);
  });

  document.getElementById("btn-hint").addEventListener("click", () => {
    const hintText = document.getElementById("hint-text");
    const btn = document.getElementById("btn-hint");
    const open = hintText.hidden;
    hintText.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  document.getElementById("btn-first-letter").addEventListener("click", () => {
    const word = sessionDeck[sessionIndex];
    const btn = document.getElementById("btn-first-letter");
    if (!word || (btn && btn.disabled)) return;
    applyFirstLetterHintToInput(word.word);
    updateLetterSlotsDisplay();
    if (btn) {
      btn.disabled = true;
      btn.classList.add("btn--used");
    }
    document.getElementById("quiz-input").focus();
  });

  document.getElementById("quiz-input").addEventListener("input", () => {
    const input = document.getElementById("quiz-input");
    if (input.disabled) return;
    updateLetterSlotsDisplay();
  });

  document.getElementById("btn-submit").addEventListener("click", handleSubmit);

  document.getElementById("quiz-input").addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    const btnNext = document.getElementById("btn-next");
    const btnSubmit = document.getElementById("btn-submit");
    if (!btnNext.hidden) {
      ev.preventDefault();
      goNext();
    } else if (!btnSubmit.hidden) {
      ev.preventDefault();
      handleSubmit();
    }
  });

  document.getElementById("btn-next").addEventListener("click", goNext);

  document.getElementById("btn-practice-again").addEventListener("click", () => {
    const wrongEntries = sessionReviewEntries.filter((x) => !x.correct);
    if (wrongEntries.length) {
      const sourcePool =
        lastSessionSource === "myWords" ? allWordsIndex : Object.fromEntries(wordBank.map((w) => [w.id, w]));
      const wrongWords = wrongEntries
        .map((entry) => sourcePool[entry.wordId])
        .filter(Boolean);
      if (wrongWords.length) {
        resetSessionResults();
        sessionSource = lastSessionSource;
        startQuizFlow("all", true, [], wrongWords);
        return;
      }
    }
    resetSessionResults();
    if (lastSessionSource === "myWords") {
      const marks = loadBookmarks();
      const ids = Object.keys(marks).filter((id) => marks[id]?.bookmarked);
      const words = ids.map((id) => allWordsIndex[id]).filter(Boolean);
      sessionSource = "myWords";
      startQuizFlow("all", true, [], words);
      return;
    }
    if (lastSessionSource === "topic") {
      sessionSource = "topic";
      startQuizFlow("all", true, []);
      return;
    }
    sessionSource = "core";
    startQuizFlow("all", true, []);
  });

  document.getElementById("review-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bookmark-id]");
    if (!btn) return;
    const id = btn.getAttribute("data-bookmark-id");
    const active = toggleBookmark(id);
    btn.classList.toggle("bookmark-btn--active", active);
    btn.textContent = active ? "★" : "☆";
    updateHomeMyWordsButton();
  });

  document.getElementById("my-words-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bookmark-id]");
    if (!btn) return;
    const id = btn.getAttribute("data-bookmark-id");
    toggleBookmark(id);
    showToast("Removed from My Words");
    renderMyWords();
  });

  document.getElementById("btn-practise-my-words").addEventListener("click", () => {
    const marks = loadBookmarks();
    const count = Object.keys(marks).filter((id) => marks[id]?.bookmarked).length;
    if (count < 3) return;
    sessionSource = "myWords";
    resetSessionResults();
    document.getElementById("setup-title").textContent = "How many saved words?";
    showView("sessionSetup");
  });

  document.getElementById("btn-placement-start").addEventListener("click", () => {
    beginPlacementTest();
  });

  document.getElementById("btn-placement-next").addEventListener("click", () => {
    showPlacementPage(2);
  });

  document.getElementById("btn-placement-back-p2").addEventListener("click", () => {
    showPlacementPage(1);
  });

  document.getElementById("btn-placement-see-result").addEventListener("click", () => {
    finishPlacementTest();
  });

  document.getElementById("btn-placement-go-core").addEventListener("click", () => {
    sessionSource = "core";
    showView("levels");
  });

  document.getElementById("btn-placement-go-topics").addEventListener("click", () => {
    renderTopicMenu();
    showView("topic");
  });

  document.getElementById("view-placement-words").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-placement-word]");
    if (!chip || !placementState) return;
    const w = chip.getAttribute("data-placement-word");
    if (!w) return;
    if (placementState.known.has(w)) {
      placementState.known.delete(w);
      chip.classList.remove("placement-chip--selected");
      chip.setAttribute("aria-pressed", "false");
    } else {
      placementState.known.add(w);
      chip.classList.add("placement-chip--selected");
      chip.setAttribute("aria-pressed", "true");
    }
  });

  showView("home");
}

init();
