(() => {
  "use strict";

  const rawWords = Array.isArray(window.CET4_WORDS) ? window.CET4_WORDS : [];
  // 例句、常用搭配和同义词按「单词」存放，避免在重复词条里存多份。
  const wordDetails =
    window.CET4_WORD_DETAILS && typeof window.CET4_WORD_DETAILS === "object"
      ? window.CET4_WORD_DETAILS
      : {};
  const partOrder = ["n", "v", "adj", "adv", "prep", "conj", "pron", "num", "art", "int"];
  const partLabels = {
    n: "名词 n",
    v: "动词 v",
    adj: "形容词 adj",
    adv: "副词 adv",
    prep: "介词 prep",
    conj: "连词 conj",
    pron: "代词 pron",
    num: "数词 num",
    art: "冠词 art",
    int: "感叹词 int",
  };
  const initialLimit = 120;
  const loadStep = 120;
  // 发音音频使用有道词典的公开音频接口，type=2 为美音，type=1 为英音。
  const audioBase = "https://dict.youdao.com/dictvoice?audio=";
  const accentOptions = {
    us: { type: 2, lang: "en-US", label: "美音 US", name: "美式发音" },
    uk: { type: 1, lang: "en-GB", label: "英音 UK", name: "英式发音" },
  };
  const speechFallbackTimeout = 2000;
  const maxCachedAudio = 40;
  const favoriteStorageKey = "cet4-favorites";
  const accentStorageKey = "cet4-accent";
  const autoSpeakStorageKey = "cet4-auto-speak";
  const detailStorageKey = "cet4-detail";
  let activeRandomWord = null;
  let randomMeaningRevealed = false;
  // 随机抽词采用「洗牌袋」：本轮先把候选词全部打乱，逐个抽出，抽完再重新洗牌。
  // 这样同一轮里不会重复，也不会因为运气差而永远抽不到某些单词。
  let randomBag = [];
  let randomBagScope = "";
  let randomBagTotal = 0;
  let randomBagDrawn = 0;
  let randomRoundNumber = 0;
  let lastRandomWord = null;
  // 被标记「遗忘」的词条留到下一轮；队列只属于当前候选范围，切换范围会清空。
  const forgottenWords = new Set();

  // 问答对战：同一套题目支持人机对战和同屏双人对战。
  const battleTimerSeconds = 15;
  const battleAiAccuracy = 0.65;
  const battleDefaultCount = 10;
  const battleState = {
    active: false,
    mode: "ai",
    questionCount: battleDefaultCount,
    scopeWords: [],
    questions: [],
    index: 0,
    phase: "setup",
    scores: [0, 0],
    answers: [null, null],
    names: ["你", "电脑"],
    avatars: ["你", "AI"],
    actor: 0,
    optionOrder: [],
    aiAnswer: null,
    timerId: 0,
    deadline: 0,
  };

  // 联机对战不依赖自建服务器：用 WebRTC DataChannel 点对点直连，
  // 房主/对手之间手动交换邀请码和应答码完成握手。
  const onlineSignalPrefix = "EW1.";
  const onlineStartDelay = 900;
  const onlineRtcConfig = {
    iceServers: [
      {
        urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
      },
      { urls: "stun:stun.miwifi.com:3478" },
    ],
    iceCandidatePoolSize: 2,
  };
  const onlineState = {
    role: null,
    pc: null,
    channel: null,
    connected: false,
    roomNumber: "",
    localAnswered: false,
    remoteAnswered: false,
    remoteChoice: null,
    revealed: false,
    startTimer: 0,
    hostTotal: 0,
    scopeLabel: "",
  };

  function normalizePartKeys(part) {
    const keys = new Set();
    String(part)
      .toLowerCase()
      .split("/")
      .map((item) => item.trim().replace(/\.$/, ""))
      .filter(Boolean)
      .forEach((item) => {
        if (item === "vt" || item === "vi") {
          keys.add("v");
          keys.add(item);
        } else {
          keys.add(item);
        }
      });
    return keys;
  }

  const words = rawWords
    .slice()
    .sort((a, b) => a.list - b.list || a.number - b.number)
    .map((item, index) => ({
      ...item,
      id: `${item.list}-${item.number}`,
      globalNumber: index + 1,
      partKeys: normalizePartKeys(item.part),
    }));

  const listNumbers = [...new Set(words.map((word) => word.list))].sort((a, b) => a - b);
  const listSummaries = listNumbers.map((number) => {
    const listWords = words.filter((word) => word.list === number);
    const start = listWords.length ? listWords[0].globalNumber : 0;
    return {
      number,
      count: listWords.length,
      start,
      end: start + listWords.length - 1,
    };
  });

  const availableParts = partOrder.filter((part) =>
    words.some((word) => word.partKeys.has(part)),
  );

  const state = {
    selectedList: "all",
    query: "",
    part: "all",
    favoritesOnly: false,
    hideWord: false,
    hideMeaning: false,
    visibleLimit: initialLimit,
    accent: loadAccent(),
    autoSpeak: loadAutoSpeak(),
    showDetails: loadShowDetails(),
    expandedIds: new Set(),
  };

  const elements = {
    headerWordCount: document.querySelector("#headerWordCount"),
    headerListCount: document.querySelector("#headerListCount"),
    summaryWordCount: document.querySelector("#summaryWordCount"),
    summaryListCount: document.querySelector("#summaryListCount"),
    listNav: document.querySelector("#listNav"),
    searchInput: document.querySelector("#searchInput"),
    clearSearch: document.querySelector("#clearSearch"),
    partFilter: document.querySelector("#partFilter"),
    favoriteFilter: document.querySelector("#favoriteFilter"),
    favoriteCount: document.querySelector("#favoriteCount"),
    wordToggle: document.querySelector("#wordToggle"),
    meaningToggle: document.querySelector("#meaningToggle"),
    accentToggle: document.querySelector("#accentToggle"),
    accentLabel: document.querySelector("#accentLabel"),
    autoSpeakToggle: document.querySelector("#autoSpeakToggle"),
    detailToggle: document.querySelector("#detailToggle"),
    collapseToggle: document.querySelector("#collapseToggle"),
    resetFilters: document.querySelector("#resetFilters"),
    viewEyebrow: document.querySelector("#viewEyebrow"),
    viewTitle: document.querySelector("#viewTitle"),
    resultCount: document.querySelector("#resultCount"),
    randomWordButton: document.querySelector("#randomWordButton"),
    randomModal: document.querySelector("#randomModal"),
    randomWordMeta: document.querySelector("#randomWordMeta"),
    randomWordTitle: document.querySelector("#randomWordTitle"),
    randomWordPhonetic: document.querySelector("#randomWordPhonetic"),
    randomWordPart: document.querySelector("#randomWordPart"),
    randomWordMeaning: document.querySelector("#randomWordMeaning"),
    randomWordMeaningText: document.querySelector("#randomWordMeaningText"),
    randomWordMeaningNote: document.querySelector("#randomWordMeaningNote"),
    randomFavoriteButton: document.querySelector("#randomFavoriteButton"),
    randomForgotButton: document.querySelector("#randomForgotButton"),
    randomForgotLabel: document.querySelector("#randomForgotLabel"),
    randomNextLabel: document.querySelector("#randomNextLabel"),
    battleButton: document.querySelector("#battleButton"),
    battleModal: document.querySelector("#battleModal"),
    battleSetup: document.querySelector("#battleSetup"),
    battlePlay: document.querySelector("#battlePlay"),
    battleResult: document.querySelector("#battleResult"),
    battleScopeLabel: document.querySelector("#battleScopeLabel"),
    battleScopeCount: document.querySelector("#battleScopeCount"),
    battleHint: document.querySelector("#battleHint"),
    battleStart: document.querySelector("#battleStart"),
    onlinePanel: document.querySelector("#onlinePanel"),
    onlineEntry: document.querySelector("#onlineEntry"),
    onlineCreate: document.querySelector("#onlineCreate"),
    onlineJoinToggle: document.querySelector("#onlineJoinToggle"),
    onlineJoinPanel: document.querySelector("#onlineJoinPanel"),
    onlineJoinInput: document.querySelector("#onlineJoinInput"),
    onlineJoin: document.querySelector("#onlineJoin"),
    onlineHostPanel: document.querySelector("#onlineHostPanel"),
    onlineRoomNumber: document.querySelector("#onlineRoomNumber"),
    onlineInvite: document.querySelector("#onlineInvite"),
    onlineCopyInvite: document.querySelector("#onlineCopyInvite"),
    onlineAnswerInput: document.querySelector("#onlineAnswerInput"),
    onlineConnect: document.querySelector("#onlineConnect"),
    onlineGuestPanel: document.querySelector("#onlineGuestPanel"),
    onlineGuestRoom: document.querySelector("#onlineGuestRoom"),
    onlineAnswer: document.querySelector("#onlineAnswer"),
    onlineCopyAnswer: document.querySelector("#onlineCopyAnswer"),
    onlineLeave: document.querySelector("#onlineLeave"),
    onlineStatus: document.querySelector("#onlineStatus"),
    battlePlayer1: document.querySelector("#battlePlayer1"),
    battlePlayer1Avatar: document.querySelector("#battlePlayer1Avatar"),
    battlePlayer1Name: document.querySelector("#battlePlayer1Name"),
    battlePlayer1Score: document.querySelector("#battlePlayer1Score"),
    battlePlayer2: document.querySelector("#battlePlayer2"),
    battlePlayer2Avatar: document.querySelector("#battlePlayer2Avatar"),
    battlePlayer2Name: document.querySelector("#battlePlayer2Name"),
    battlePlayer2Score: document.querySelector("#battlePlayer2Score"),
    battleRoundLabel: document.querySelector("#battleRoundLabel"),
    battleTurnLabel: document.querySelector("#battleTurnLabel"),
    battleTimer: document.querySelector("#battleTimer"),
    battleTimerBar: document.querySelector("#battleTimerBar"),
    battleTimerLabel: document.querySelector("#battleTimerLabel"),
    battleQuestion: document.querySelector("#battleQuestion"),
    battleQuestionType: document.querySelector("#battleQuestionType"),
    battlePrompt: document.querySelector("#battlePrompt"),
    battlePromptSub: document.querySelector("#battlePromptSub"),
    battleOptions: document.querySelector("#battleOptions"),
    battleFeedback: document.querySelector("#battleFeedback"),
    battleFeedbackTitle: document.querySelector("#battleFeedbackTitle"),
    battleAnswerCards: document.querySelector("#battleAnswerCards"),
    battleWordReveal: document.querySelector("#battleWordReveal"),
    battleNext: document.querySelector("#battleNext"),
    battleHandoff: document.querySelector("#battleHandoff"),
    battleHandoffTitle: document.querySelector("#battleHandoffTitle"),
    battleHandoffText: document.querySelector("#battleHandoffText"),
    battleHandoffNext: document.querySelector("#battleHandoffNext"),
    battleResultTitle: document.querySelector("#battleResultTitle"),
    battleResultScore: document.querySelector("#battleResultScore"),
    battleResultStats: document.querySelector("#battleResultStats"),
    battleReplay: document.querySelector("#battleReplay"),
    battleBack: document.querySelector("#battleBack"),
    wordList: document.querySelector("#wordList"),
    emptyState: document.querySelector("#emptyState"),
    emptyReset: document.querySelector("#emptyReset"),
    loadMoreWrap: document.querySelector("#loadMoreWrap"),
    loadMore: document.querySelector("#loadMore"),
    toast: document.querySelector("#toast"),
  };

  const favorites = loadFavorites();
  const fragment = document.createDocumentFragment();

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Browsing remains available if storage is disabled.
    }
  }

  function loadAccent() {
    return readStorage(accentStorageKey) === "uk" ? "uk" : "us";
  }

  function loadAutoSpeak() {
    return readStorage(autoSpeakStorageKey) === "true";
  }

  function loadShowDetails() {
    return readStorage(detailStorageKey) === "true";
  }

  function loadFavorites() {
    try {
      const stored = JSON.parse(readStorage(favoriteStorageKey) || "[]");
      return new Set(Array.isArray(stored) ? stored : []);
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    writeStorage(favoriteStorageKey, JSON.stringify([...favorites]));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildFailureHint() {
    if (location.protocol === "file:") {
      return "直接双击打开的本地文件可能被浏览器限制联网，建议改用本地服务器：python -m http.server 8000 --directory 网页版单词表";
    }
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      return "本机服务器可能没有联网，请检查网络后重试。";
    }
    if (/(^|\.)github\.io$/.test(location.hostname)) {
      return "GitHub Pages 可以正常联网，请检查当前网络连接或稍后重试。";
    }
    return "请检查网络连接或稍后重试。";
  }

  const failureHint = buildFailureHint();

  let toastTimer = 0;

  function showToast(message) {
    if (!elements.toast) {
      return;
    }
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 6000);
  }

  const audioCache = new Map();

  function audioUrl(word, accent) {
    return `${audioBase}${encodeURIComponent(word)}&type=${accentOptions[accent].type}`;
  }

  function buildAudio(word, accent) {
    const key = `${word}|${accent}`;
    const cached = audioCache.get(key);
    if (cached) {
      audioCache.delete(key);
      audioCache.set(key, cached);
      return cached;
    }
    const element = new Audio();
    element.preload = "auto";
    element.src = audioUrl(word, accent);
    audioCache.set(key, element);
    while (audioCache.size > maxCachedAudio) {
      const oldestKey = audioCache.keys().next().value;
      const oldest = audioCache.get(oldestKey);
      audioCache.delete(oldestKey);
      if (oldest) {
        oldest.removeAttribute("src");
      }
    }
    return element;
  }

  function preloadWord(word, accent) {
    if (!word) {
      return;
    }
    try {
      buildAudio(word, accent);
    } catch {
      // 预加载失败不影响后续正常播放。
    }
  }

  function playWithSystemVoice(word, accent) {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance !== "function") {
      return false;
    }
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = accentOptions[accent].lang;
    utterance.rate = 0.92;
    synth.cancel();
    synth.speak(utterance);
    return true;
  }

  let lastSpokenWord = "";
  let lastSpokenAt = 0;

  async function playWord(word, accent) {
    const now = Date.now();
    // 避免同一次点击同时触发按钮与整行的朗读。
    if (word === lastSpokenWord && now - lastSpokenAt < 300) {
      return false;
    }
    lastSpokenWord = word;
    lastSpokenAt = now;

    let element;
    try {
      element = buildAudio(word, accent);
      element.currentTime = 0;
      const playing = element.play();
      if (playing && typeof playing.then === "function") {
        await playing;
      }
      return true;
    } catch {
      if (playWithSystemVoice(word, accent)) {
        showToast(`在线真人发音暂不可用，已改用系统语音朗读「${word}」。`);
      } else {
        showToast(
          `「${word}」发音加载失败。${failureHint}`.trim(),
        );
      }
      return false;
    }
  }

  // 只在词条进入视口时才预取音频，避免一次请求上百个音频文件。
  const rowObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) {
                return;
              }
              const word = entry.target.dataset.speakWord;
              if (word) {
                preloadWord(word, state.accent);
              }
              rowObserver.unobserve(entry.target);
            });
          },
          { rootMargin: "200px 0px" },
        )
      : null;

  function observeRow(row) {
    if (rowObserver) {
      rowObserver.observe(row);
    }
  }

  function stopSpeaking() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    audioCache.forEach((element) => {
      if (!element.paused) {
        element.pause();
      }
    });
  }

  function partClass(partKeys) {
    const firstCategory = availableParts.find((part) => partKeys.has(part));
    return firstCategory ? `part-${firstCategory}` : "";
  }

  function createListNav() {
    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.dataset.list = "all";
    allButton.innerHTML = `
      <span>
        <span class="nav-label">全部词汇</span>
        <span class="nav-range">完整 ${words.length} 词</span>
      </span>
      <span class="nav-count">${words.length}</span>
    `;
    elements.listNav.append(allButton);

    listSummaries.forEach((summary) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.list = String(summary.number);
      button.innerHTML = `
        <span>
          <span class="nav-label">List ${summary.number}</span>
          <span class="nav-range">第 ${summary.start}-${summary.end} 词</span>
        </span>
        <span class="nav-count">${summary.count}</span>
      `;
      elements.listNav.append(button);
    });
  }

  function createPartOptions() {
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "全部词性";
    elements.partFilter.append(allOption);

    availableParts.forEach((part) => {
      const option = document.createElement("option");
      option.value = part;
      option.textContent = partLabels[part] || part;
      elements.partFilter.append(option);
    });
  }

  function updateListNav() {
    elements.listNav.querySelectorAll("button").forEach((button) => {
      const isActive = String(state.selectedList) === button.dataset.list;
      button.setAttribute("aria-current", isActive ? "true" : "false");
    });
  }

  function getFilteredWords() {
    const query = state.query.trim().toLocaleLowerCase("zh-CN");

    return words.filter((word) => {
      if (state.selectedList !== "all" && word.list !== Number(state.selectedList)) {
        return false;
      }
      if (state.part !== "all" && !word.partKeys.has(state.part)) {
        return false;
      }
      if (state.favoritesOnly && !favorites.has(word.id)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        word.word.toLocaleLowerCase("en-US").includes(query) ||
        word.meaning.toLocaleLowerCase("zh-CN").includes(query) ||
        String(word.number).includes(query)
      );
    });
  }

  function phoneticFor(word, accent) {
    return accent === "uk" ? word.ukphone || word.usphone || "" : word.usphone || word.ukphone || "";
  }

  function hasDetail(word) {
    const detail = wordDetails[word.word];
    if (!detail) {
      return false;
    }
    return Boolean(
      (detail.sentences && detail.sentences.length) ||
        (detail.phrases && detail.phrases.length) ||
        (detail.synonyms && detail.synonyms.length),
    );
  }

  function buildDetailPanel(word, accent) {
    const detail = wordDetails[word.word] || {};
    const accentInfo = accentOptions[accent];

    const synonyms = (detail.synonyms || [])
      .map(
        (group) => `
          <span class="detail-synonym">
            ${group.pos ? `<em>${escapeHtml(group.pos)}</em>` : ""}
            <span class="synonym-words">${group.words
              .map((item) => escapeHtml(item))
              .join("、")}</span>
            ${group.cn ? `<span class="synonym-cn">${escapeHtml(group.cn)}</span>` : ""}
          </span>`,
      )
      .join("");

    const phrases = (detail.phrases || [])
      .map(
        (item) => `
          <li class="phrase-item">
            <button
              class="phrase-en"
              type="button"
              data-action="speak-text"
              data-speak="${escapeHtml(item.en)}"
              title="朗读这个搭配"
            >${escapeHtml(item.en)}</button>
            <span class="phrase-cn">${escapeHtml(item.cn)}</span>
          </li>`,
      )
      .join("");

    const sentences = (detail.sentences || [])
      .map(
        (item) => `
          <li class="sentence-item">
            <button
              class="sentence-en"
              type="button"
              data-action="speak-text"
              data-speak="${escapeHtml(item.en)}"
              title="朗读这个例句"
            >${escapeHtml(item.en)}</button>
            <span class="sentence-cn" lang="zh-CN">${escapeHtml(item.cn)}</span>
          </li>`,
      )
      .join("");

    const panel = document.createElement("div");
    panel.className = "word-detail";
    panel.innerHTML = `
      <div class="detail-inner">
        ${
          synonyms
            ? `<div class="detail-block detail-synonyms">
                 <span class="detail-label">同义词</span>
                 <div class="detail-body">${synonyms}</div>
               </div>`
            : ""
        }
        ${
          phrases
            ? `<div class="detail-block">
                 <span class="detail-label">常用搭配</span>
                 <ul class="detail-body detail-phrases">${phrases}</ul>
               </div>`
            : ""
        }
        ${
          sentences
            ? `<div class="detail-block">
                 <span class="detail-label">例句</span>
                 <ul class="detail-body detail-sentences" lang="${accentInfo.lang}">${sentences}</ul>
               </div>`
            : ""
        }
      </div>
    `;
    return panel;
  }

  function updateDetailVisibility(row, word) {
    const panel = row.querySelector(".word-detail");
    if (!panel) {
      return;
    }
    const open = state.showDetails !== state.expandedIds.has(word.id);
    panel.hidden = !open;
    row.classList.toggle("detail-open", open);
    const toggle = row.querySelector('[data-action="detail"]');
    if (toggle) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.title = open ? "收起例句搭配" : "展开例句搭配";
    }
  }

  // 没有任何展开项时「全部收起」不可用。
  function syncCollapseButton() {
    elements.collapseToggle.disabled = !state.showDetails && state.expandedIds.size === 0;
  }

  function renderWordRow(word, previousWord) {
    const isFavorite = favorites.has(word.id);
    const order = state.selectedList === "all" ? word.globalNumber : word.number;
    const startsNewList =
      state.selectedList === "all" && previousWord && word.list !== previousWord.list;
    const wordHidden = state.hideWord;
    const meaningHidden = state.hideMeaning;
    const contentHidden = wordHidden || meaningHidden;
    const accent = state.accent;
    const accentInfo = accentOptions[accent];
    const phonetic = phoneticFor(word, accent);

    const row = document.createElement("li");
    row.className = "word-row";
    row.dataset.wordId = word.id;
    row.dataset.speakWord = word.word;
    row.classList.toggle("is-new-list", Boolean(startsNewList));
    row.classList.toggle("word-hidden", wordHidden);
    row.classList.toggle("meaning-hidden", meaningHidden);
    row.classList.toggle("content-hidden", contentHidden);
    row.innerHTML = `
      <span class="word-order">${order}</span>
      <span class="word-name">
        <span class="word-text">${escapeHtml(word.word)}</span>
        <button
          class="speak-button word-speak"
          type="button"
          data-action="speak"
          aria-label="朗读 ${escapeHtml(word.word)}（${accentInfo.name}）"
          title="朗读发音（${accentInfo.name}）"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M11 5 6 9H2v6h4l5 4V5z"></path>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
        </button>
        <span class="phonetic-inline" lang="${accentInfo.lang}" data-phonetic>${
          phonetic ? `/${escapeHtml(phonetic)}/` : ""
        }</span>
        <span class="word-reveal-note">点击查看单词</span>
      </span>
      <span class="phonetic" lang="${accentInfo.lang}" data-phonetic>${
        phonetic ? `/${escapeHtml(phonetic)}/` : "—"
      }</span>
      <span class="part-badge ${partClass(word.partKeys)}">${escapeHtml(word.part)}</span>
      <span class="meaning">
        <span class="meaning-text">${escapeHtml(word.meaning)}</span>
        <span class="meaning-reveal-note">点击查看释义</span>
        ${
          hasDetail(word)
            ? `<button
                 class="detail-toggle"
                 type="button"
                 data-action="detail"
                 aria-expanded="false"
                 aria-label="展开 ${escapeHtml(word.word)} 的例句和搭配"
                 title="展开例句搭配"
               >
                 <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
               </button>`
            : ""
        }
      </span>
      <span class="word-audio">
        <button
          class="speak-button"
          type="button"
          data-action="speak"
          aria-label="朗读 ${escapeHtml(word.word)}（${accentInfo.name}）"
          title="朗读发音（${accentInfo.name}）"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M11 5 6 9H2v6h4l5 4V5z"></path>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
        </button>
      </span>
      <button
        class="favorite-button"
        type="button"
        data-action="favorite"
        aria-label="${isFavorite ? "取消收藏" : "收藏"} ${escapeHtml(word.word)}"
        aria-pressed="${isFavorite ? "true" : "false"}"
        title="${isFavorite ? "取消收藏" : "收藏"}"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
        </svg>
      </button>
    `;
    observeRow(row);
    // 详情面板是行内独立的一行（grid-column: 2 / 7），直接插进行尾。
    if (hasDetail(word)) {
      row.append(buildDetailPanel(word, accent));
    }
    return row;
  }

  function updateHeading(filteredCount, battleCount = filteredCount) {
    if (state.selectedList === "all") {
      elements.viewEyebrow.textContent = "全部词汇";
      elements.viewTitle.textContent = "大学英语四级核心词汇";
    } else {
      const summary = listSummaries[Number(state.selectedList) - 1];
      elements.viewEyebrow.textContent = `List ${summary.number}`;
      elements.viewTitle.textContent = `第 ${summary.start}-${summary.end} 词`;
    }

    const filters = [];
    if (state.part !== "all") {
      filters.push(partLabels[state.part] || state.part);
    }
    if (state.favoritesOnly) {
      filters.push("仅收藏");
    }
    if (state.query.trim()) {
      filters.push(`“${state.query.trim()}”`);
    }

    elements.resultCount.textContent =
      filters.length > 0
        ? `${filteredCount} 条结果 · ${filters.join(" · ")}`
        : `共 ${filteredCount} 个单词`;
    elements.randomWordButton.disabled = filteredCount === 0;
    elements.battleButton.disabled = battleCount < 4;
    elements.battleButton.title =
      battleCount < 4
        ? "当前范围至少需要 4 个不重复单词才能开始对战"
        : "用当前词汇范围开始人机对战或同屏双人对战";
  }

  function randomScopeLabel() {
    if (state.selectedList === "all") {
      return "全部词汇";
    }
    const summary = listSummaries[Number(state.selectedList) - 1];
    return summary ? `List ${summary.number} · 第 ${summary.start}-${summary.end} 词` : "当前列表";
  }

  function updateRandomMeaningState() {
    elements.randomWordMeaning.classList.toggle(
      "meaning-hidden",
      !randomMeaningRevealed,
    );
    elements.randomWordMeaning.setAttribute(
      "aria-pressed",
      randomMeaningRevealed ? "true" : "false",
    );
    elements.randomWordMeaning.title = randomMeaningRevealed
      ? "点击遮住中文释义"
      : "点击显示中文释义";
    elements.randomWordMeaningNote.textContent = randomMeaningRevealed
      ? "点击遮住中文释义"
      : "点击显示中文释义";
  }

  function shuffleWords(items) {
    const shuffled = items.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  // 返回本轮进度文案；只有 1 个候选词且还是第一轮时不显示进度。
  function randomProgressLabel() {
    const progress =
      randomBagTotal > 1 ? `${randomBagDrawn}/${randomBagTotal}` : "";
    if (randomRoundNumber > 1) {
      return progress
        ? ` · 第 ${randomRoundNumber} 轮 ${progress}`
        : ` · 第 ${randomRoundNumber} 轮`;
    }
    return progress ? ` · 本轮 ${progress}` : "";
  }

  // 当前筛选范围内、已经留到下一轮的词。
  function pendingForgottenWords() {
    return getFilteredWords().filter((word) => forgottenWords.has(word.id));
  }

  function toggleForgottenWord() {
    if (!activeRandomWord) {
      return;
    }
    if (forgottenWords.has(activeRandomWord.id)) {
      forgottenWords.delete(activeRandomWord.id);
      showToast("已移出下一轮");
    } else {
      forgottenWords.add(activeRandomWord.id);
      showToast("已留到下一轮");
    }
    renderRandomWord();
  }

  function renderRandomWord() {
    if (!activeRandomWord) {
      return;
    }
    const word = activeRandomWord;
    const accent = state.accent;
    const accentInfo = accentOptions[accent];
    const phonetic = phoneticFor(word, accent);
    const isFavorite = favorites.has(word.id);

    elements.randomWordMeta.textContent = `${randomScopeLabel()} · ${accentInfo.name}${randomProgressLabel()}`;
    elements.randomWordTitle.textContent = word.word;
    elements.randomWordTitle.dataset.wordId = word.id;
    elements.randomWordPhonetic.textContent = phonetic ? `/${phonetic}/` : "—";
    elements.randomWordPhonetic.lang = accentInfo.lang;
    elements.randomWordPart.textContent = word.part;
    elements.randomWordPart.className = `random-card-part part-badge ${partClass(word.partKeys)}`;
    elements.randomWordMeaningText.textContent = word.meaning;
    updateRandomMeaningState();
    elements.randomFavoriteButton.setAttribute("aria-pressed", isFavorite ? "true" : "false");
    elements.randomFavoriteButton.title = isFavorite ? "取消收藏" : "收藏";

    const isForgotten = forgottenWords.has(word.id);
    elements.randomForgotButton.setAttribute(
      "aria-pressed",
      isForgotten ? "true" : "false",
    );
    elements.randomForgotLabel.textContent = isForgotten ? "已留" : "遗忘";
    elements.randomForgotButton.title = isForgotten
      ? "取消留到下一轮"
      : "没记住，留到下一轮再抽";

    if (randomBag.length === 0) {
      const pendingCount = pendingForgottenWords().length;
      elements.randomNextLabel.textContent =
        pendingCount > 0 ? `下一轮 ${pendingCount}` : "重新洗牌";
    } else {
      elements.randomNextLabel.textContent = "再抽一个";
    }
  }

  function closeRandomWord() {
    activeRandomWord = null;
    randomMeaningRevealed = false;
    elements.randomModal.hidden = true;
    syncModalScrollLock();
  }

  function openRandomWord() {
    const filteredWords = getFilteredWords();
    if (!filteredWords.length) {
      showToast("当前筛选下没有可抽取的单词。");
      return;
    }

    // 候选集合变化（切换 List、搜索、词性、收藏筛选）时重新开一轮。
    const scopeKey = filteredWords.map((word) => word.id).join(",");
    const scopeChanged = scopeKey !== randomBagScope;
    if (scopeChanged) {
      if (forgottenWords.size > 0) {
        showToast("已切换词汇范围，遗忘队列已清空");
      }
      forgottenWords.clear();
      randomBagScope = scopeKey;
      randomBag = [];
      randomBagTotal = 0;
      randomBagDrawn = 0;
      randomRoundNumber = 0;
    }

    if (randomBag.length === 0) {
      // 同一范围的一轮抽完后，把标记「遗忘」的词拿出来做下一轮；
      // 刚切换到新范围时队列已清空，因此会先正常过一遍。
      const pendingWords = filteredWords.filter((word) => forgottenWords.has(word.id));
      if (pendingWords.length > 0) {
        pendingWords.forEach((word) => forgottenWords.delete(word.id));
        randomBag = shuffleWords(pendingWords);
        randomBagTotal = pendingWords.length;
      } else {
        randomBag = shuffleWords(filteredWords);
        randomBagTotal = filteredWords.length;
      }
      randomBagDrawn = 0;
      randomRoundNumber += 1;
      // 新一轮的第一个词尽量避开上一轮的最后一个词，避免跨轮连续重复。
      const lastIndex = randomBag.length - 1;
      if (lastIndex > 0 && lastRandomWord && randomBag[lastIndex].id === lastRandomWord.id) {
        const swapIndex = Math.floor(Math.random() * lastIndex);
        [randomBag[lastIndex], randomBag[swapIndex]] = [
          randomBag[swapIndex],
          randomBag[lastIndex],
        ];
      }
    }

    const next = randomBag.pop();
    randomBagDrawn = randomBagTotal - randomBag.length;
    lastRandomWord = next;
    activeRandomWord = next;
    randomMeaningRevealed = false;
    renderRandomWord();
    elements.randomModal.hidden = false;
    syncModalScrollLock();
  }

  function syncModalScrollLock() {
    document.body.classList.toggle(
      "modal-open",
      !elements.randomModal.hidden || !elements.battleModal.hidden,
    );
  }

  // 同一个单词可能在词表里出现两次（第 7 组复习词），出题时按拼写去重。
  function uniqueBattleWords(items) {
    const seen = new Set();
    return items.filter((word) => {
      const key = word.word.toLocaleLowerCase("en-US");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function battleScopeText() {
    const filters = [];
    if (state.selectedList !== "all") {
      const summary = listSummaries[Number(state.selectedList) - 1];
      filters.push(summary ? `List ${summary.number}` : "当前列表");
    }
    if (state.part !== "all") {
      filters.push(partLabels[state.part] || state.part);
    }
    if (state.favoritesOnly) {
      filters.push("仅收藏");
    }
    if (state.query.trim()) {
      filters.push(`搜索“${state.query.trim()}”`);
    }
    return filters.length ? filters.join(" · ") : "全部词汇";
  }

  function pickBattleDistractors(correct, pools, count) {
    const used = new Set([correct]);
    const result = [];
    for (const pool of pools) {
      for (const text of shuffleWords(pool)) {
        if (result.length >= count) {
          break;
        }
        if (!text || used.has(text)) {
          continue;
        }
        used.add(text);
        result.push(text);
      }
      if (result.length >= count) {
        break;
      }
    }
    return result;
  }

  function buildBattleQuestions(scopeWords, total) {
    const chosen = shuffleWords(scopeWords).slice(0, total);
    const types = chosen.map((_, index) =>
      index % 2 === 0 ? "word-to-meaning" : "meaning-to-word",
    );
    const shuffledTypes = shuffleWords(types);

    return chosen
      .map((word, index) => {
        const type = shuffledTypes[index];
        const wordToMeaning = type === "word-to-meaning";
        const correct = wordToMeaning ? word.meaning : word.word;
        if (!correct) {
          return null;
        }
        const scopePool = scopeWords.map((item) =>
          wordToMeaning ? item.meaning : item.word,
        );
        const allPool = words.map((item) => (wordToMeaning ? item.meaning : item.word));
        const distractors = pickBattleDistractors(correct, [scopePool, allPool], 3);
        const options = shuffleWords([correct, ...distractors]).map((text) => ({
          text,
          correct: text === correct,
        }));
        return { type, word, correct, options };
      })
      .filter((question) => question && question.options.length === 4);
  }

  function onlineSupported() {
    return typeof window.RTCPeerConnection === "function";
  }

  function setOnlineStatus(text) {
    elements.onlineStatus.textContent = text;
  }

  function updateOnlinePanel() {
    const isOnline = battleState.mode === "online";
    elements.onlinePanel.hidden = !isOnline;
    if (!isOnline) {
      return;
    }
    const role = onlineState.role;
    const hasRole = Boolean(role);
    elements.onlineEntry.hidden = hasRole;
    elements.onlineHostPanel.hidden = role !== "host";
    elements.onlineGuestPanel.hidden = role !== "guest";
    elements.onlineLeave.hidden = !hasRole;
    elements.onlineCreate.disabled = hasRole;
    elements.onlineJoinToggle.disabled = hasRole;
    elements.onlineRoomNumber.textContent = onlineState.roomNumber || "----";
    elements.onlineGuestRoom.textContent = onlineState.roomNumber || "----";
    if (hasRole) {
      elements.onlineJoinPanel.hidden = true;
    }
  }

  function clearOnlineStartTimer() {
    if (onlineState.startTimer) {
      window.clearTimeout(onlineState.startTimer);
      onlineState.startTimer = 0;
    }
  }

  function sendOnlineMessage(payload) {
    const channel = onlineState.channel;
    if (!channel || channel.readyState !== "open") {
      return false;
    }
    try {
      channel.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  function teardownOnlineConnection() {
    clearOnlineStartTimer();
    const channel = onlineState.channel;
    const pc = onlineState.pc;
    onlineState.channel = null;
    onlineState.pc = null;
    onlineState.role = null;
    onlineState.connected = false;
    onlineState.roomNumber = "";
    onlineState.localAnswered = false;
    onlineState.remoteAnswered = false;
    onlineState.remoteChoice = null;
    onlineState.revealed = false;
    onlineState.hostTotal = 0;
    onlineState.scopeLabel = "";
    if (channel) {
      try {
        channel.close();
      } catch {
        // Ignore a channel that is already closed.
      }
    }
    if (pc) {
      try {
        pc.close();
      } catch {
        // Ignore a peer connection that is already closed.
      }
    }
    elements.onlineInvite.value = "";
    elements.onlineAnswerInput.value = "";
    elements.onlineAnswer.value = "";
    elements.onlineJoinInput.value = "";
    updateOnlinePanel();
  }

  function leaveOnlineRoom(options = {}) {
    const { notify = true, silent = false } = options;
    if (notify) {
      sendOnlineMessage({ type: "leave" });
    }
    teardownOnlineConnection();
    if (silent) {
      return;
    }
    if (battleState.active) {
      stopBattleTimer();
      battleState.active = false;
      battleState.phase = "setup";
      battleState.questions = [];
      battleState.index = 0;
      battleState.scores = [0, 0];
      battleState.answers = [null, null];
      elements.battlePlay.hidden = true;
      elements.battleResult.hidden = true;
      elements.battleSetup.hidden = false;
    }
    setOnlineStatus("已离开房间。");
    refreshBattleSetup();
  }

  async function copyOnlineText(text, label) {
    if (!text) {
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        showToast(`${label}已复制。`);
        return;
      }
    } catch {
      // Fall back to a temporary textarea below.
    }
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    helper.remove();
    showToast(copied ? `${label}已复制。` : `复制失败，请手动选择${label}。`);
  }

  function encodeOnlineSignal(sdp) {
    const bytes = new TextEncoder().encode(sdp);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return `${onlineSignalPrefix}${btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}`;
  }

  function decodeOnlineSignal(code) {
    const trimmed = String(code || "").replace(/\s+/g, "");
    if (!trimmed.startsWith(onlineSignalPrefix)) {
      throw new Error("邀请码格式不正确");
    }
    const raw = trimmed
      .slice(onlineSignalPrefix.length)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function waitForOnlineIce(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(finish, 2600);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") {
          finish();
        }
      });
      pc.addEventListener("icecandidate", (event) => {
        if (!event.candidate) {
          finish();
        }
      });
    });
  }

  function randomOnlineRoomNumber() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  function bindOnlineChannel(channel) {
    onlineState.channel = channel;
    channel.onopen = handleOnlineChannelOpen;
    channel.onmessage = (event) => handleOnlineMessage(event.data);
    channel.onclose = () => handleOnlineDisconnect("联机连接已断开。");
    channel.onerror = () => handleOnlineDisconnect("联机连接出错。");
    if (channel.readyState === "open") {
      handleOnlineChannelOpen();
    }
  }

  function handleOnlineChannelOpen() {
    if (onlineState.connected) {
      return;
    }
    onlineState.connected = true;
    if (onlineState.role === "host") {
      const scopeSize = uniqueBattleWords(getFilteredWords()).length;
      onlineState.hostTotal = Math.min(battleState.questionCount, scopeSize);
      onlineState.scopeLabel = battleScopeText();
      sendOnlineMessage({
        type: "welcome",
        roomNumber: onlineState.roomNumber,
        questionCount: onlineState.hostTotal,
        scopeLabel: onlineState.scopeLabel,
      });
      setOnlineStatus("对手已连接，可以开始对战。");
    } else {
      setOnlineStatus("已连接房主，等待房主开始。");
    }
    refreshBattleSetup();
  }

  function handleOnlineDisconnect(reason) {
    if (!onlineState.role) {
      return;
    }
    const wasActive = battleState.active;
    teardownOnlineConnection();
    if (wasActive) {
      stopBattleTimer();
      battleState.active = false;
      battleState.phase = "setup";
      battleState.questions = [];
      battleState.index = 0;
      battleState.scores = [0, 0];
      battleState.answers = [null, null];
      elements.battlePlay.hidden = true;
      elements.battleResult.hidden = true;
      elements.battleSetup.hidden = false;
    }
    setOnlineStatus(reason);
    showToast(reason);
    refreshBattleSetup();
  }

  function handleOnlineMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!message || typeof message.type !== "string") {
      return;
    }
    switch (message.type) {
      case "welcome":
        if (onlineState.role !== "guest") {
          return;
        }
        onlineState.roomNumber = String(message.roomNumber || "");
        onlineState.hostTotal = Number(message.questionCount) || 0;
        onlineState.scopeLabel = String(message.scopeLabel || "");
        elements.onlineGuestRoom.textContent = onlineState.roomNumber || "----";
        setOnlineStatus("已连接房主，等待房主开始。");
        refreshBattleSetup();
        break;
      case "start":
        applyOnlineStart(message);
        break;
      case "answer":
        if (
          onlineState.role === "host" &&
          battleState.phase === "question" &&
          !onlineState.remoteAnswered
        ) {
          const question = battleState.questions[battleState.index];
          const choice = Number.isInteger(message.choice)
            ? question?.options[message.choice]
            : null;
          onlineState.remoteAnswered = true;
          onlineState.remoteChoice = choice ? choice.text : null;
          if (onlineState.localAnswered) {
            scheduleOnlineReveal();
          } else {
            setOnlineStatus("对手已作答，轮到你。");
            updateBattleTurn();
          }
        }
        break;
      case "timeout":
        if (
          onlineState.role === "host" &&
          battleState.phase === "question" &&
          !onlineState.remoteAnswered
        ) {
          onlineState.remoteAnswered = true;
          onlineState.remoteChoice = null;
          if (onlineState.localAnswered) {
            scheduleOnlineReveal();
          } else {
            setOnlineStatus("对手已超时，请作答。");
            updateBattleTurn();
          }
        }
        break;
      case "peer-ready":
        if (onlineState.role === "guest" && battleState.phase === "question") {
          onlineState.remoteAnswered = true;
          setOnlineStatus("对手已作答，轮到你。");
          updateBattleTurn();
        }
        break;
      case "reveal":
        applyOnlineReveal(message);
        break;
      case "next":
        if (onlineState.role === "guest" && Number.isInteger(message.index)) {
          scheduleOnlineQuestion(message.index, false);
        }
        break;
      case "begin":
        if (
          onlineState.role === "guest" &&
          battleState.active &&
          battleState.phase === "starting" &&
          Number.isInteger(message.index)
        ) {
          clearOnlineStartTimer();
          beginOnlineQuestion(message.index);
        }
        break;
      case "result":
        if (onlineState.role === "guest") {
          battleState.scores = [
            Number(message.guestScore) || 0,
            Number(message.hostScore) || 0,
          ];
          showBattleResult();
        }
        break;
      case "leave":
        handleOnlineDisconnect("对手已离开房间。");
        break;
      default:
        break;
    }
  }

  async function createOnlineRoom() {
    if (!onlineSupported()) {
      showToast("当前浏览器不支持联机对战。");
      return;
    }
    if (battleState.mode !== "online") {
      return;
    }
    teardownOnlineConnection();
    onlineState.role = "host";
    onlineState.roomNumber = randomOnlineRoomNumber();
    battleState.scopeWords = uniqueBattleWords(getFilteredWords());
    updateOnlinePanel();
    setOnlineStatus("正在创建房间，请稍候…");
    try {
      const pc = new RTCPeerConnection(onlineRtcConfig);
      onlineState.pc = pc;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          handleOnlineDisconnect("联机连接中断。");
        }
      };
      const channel = pc.createDataChannel("battle", { ordered: true });
      bindOnlineChannel(channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForOnlineIce(pc);
      if (!pc.localDescription) {
        throw new Error("没有生成邀请码");
      }
      elements.onlineInvite.value = encodeOnlineSignal(pc.localDescription.sdp);
      setOnlineStatus("等待对手生成应答码…");
      refreshBattleSetup();
    } catch {
      teardownOnlineConnection();
      setOnlineStatus("创建房间失败，请重试。");
      showToast("创建房间失败，请检查浏览器是否支持 WebRTC。");
      refreshBattleSetup();
    }
  }

  async function joinOnlineRoom() {
    if (!onlineSupported()) {
      showToast("当前浏览器不支持联机对战。");
      return;
    }
    let offerSdp;
    try {
      offerSdp = decodeOnlineSignal(elements.onlineJoinInput.value);
    } catch {
      setOnlineStatus("邀请码无效，请检查后重试。");
      showToast("邀请码无效，请检查后重试。");
      return;
    }
    teardownOnlineConnection();
    onlineState.role = "guest";
    updateOnlinePanel();
    setOnlineStatus("正在生成应答码…");
    try {
      const pc = new RTCPeerConnection(onlineRtcConfig);
      onlineState.pc = pc;
      pc.ondatachannel = (event) => bindOnlineChannel(event.channel);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          handleOnlineDisconnect("联机连接中断。");
        }
      };
      await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForOnlineIce(pc);
      if (!pc.localDescription) {
        throw new Error("没有生成应答码");
      }
      elements.onlineAnswer.value = encodeOnlineSignal(pc.localDescription.sdp);
      setOnlineStatus("把应答码发回房主，等待连接…");
      refreshBattleSetup();
    } catch {
      teardownOnlineConnection();
      setOnlineStatus("生成应答码失败，请重试。");
      showToast("生成应答码失败，请重试。");
      refreshBattleSetup();
    }
  }

  async function connectOnlineRoom() {
    if (onlineState.role !== "host" || !onlineState.pc) {
      return;
    }
    let answerSdp;
    try {
      answerSdp = decodeOnlineSignal(elements.onlineAnswerInput.value);
    } catch {
      setOnlineStatus("应答码无效，请检查后重试。");
      showToast("应答码无效，请检查后重试。");
      return;
    }
    setOnlineStatus("正在建立连接…");
    try {
      await onlineState.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch {
      setOnlineStatus("应答码无效，请检查后重试。");
      showToast("应答码无效，请检查后重试。");
    }
  }

  function serializeOnlineQuestion(question) {
    return {
      type: question.type,
      correct: question.correct,
      word: {
        id: question.word.id,
        word: question.word.word,
        meaning: question.word.meaning,
        part: question.word.part,
        usphone: question.word.usphone,
        ukphone: question.word.ukphone,
        partKeys: Array.from(question.word.partKeys || []),
      },
      options: question.options.map((option) => ({
        text: option.text,
        correct: Boolean(option.correct),
      })),
    };
  }

  function normalizeOnlineQuestion(raw) {
    if (!raw || !raw.word || !raw.word.word || !raw.word.meaning) {
      return null;
    }
    if (!Array.isArray(raw.options) || raw.options.length !== 4) {
      return null;
    }
    const options = raw.options.map((option) => ({
      text: String(option?.text || ""),
      correct: Boolean(option?.correct),
    }));
    if (options.some((option) => !option.text)) {
      return null;
    }
    return {
      type: raw.type === "meaning-to-word" ? "meaning-to-word" : "word-to-meaning",
      correct:
        typeof raw.correct === "string" && raw.correct
          ? raw.correct
          : options.find((option) => option.correct)?.text || "",
      word: {
        id: raw.word.id,
        word: String(raw.word.word),
        meaning: String(raw.word.meaning),
        part: String(raw.word.part || ""),
        usphone: String(raw.word.usphone || ""),
        ukphone: String(raw.word.ukphone || ""),
        partKeys: new Set(Array.isArray(raw.word.partKeys) ? raw.word.partKeys : []),
      },
      options,
    };
  }

  function startOnlineBattle() {
    if (battleState.mode !== "online") {
      return;
    }
    if (onlineState.role !== "host") {
      showToast("等待房主开始对战。");
      return;
    }
    if (!onlineState.connected) {
      showToast("请先让对手加入房间。");
      return;
    }
    const scopeWords = uniqueBattleWords(getFilteredWords());
    if (scopeWords.length < 4) {
      showToast("当前范围至少需要 4 个不重复单词。");
      return;
    }
    const total = Math.min(battleState.questionCount, scopeWords.length);
    const questions = buildBattleQuestions(scopeWords, total);
    if (questions.length < 4) {
      showToast("当前范围可出的题目不足。");
      return;
    }
    const startPayload = {
      type: "start",
      total: questions.length,
      scopeLabel: battleScopeText(),
      questions: questions.map(serializeOnlineQuestion),
    };
    if (!sendOnlineMessage(startPayload)) {
      showToast("对手连接已断开。");
      return;
    }
    battleState.scopeWords = scopeWords;
    battleState.questions = questions;
    battleState.index = 0;
    battleState.scores = [0, 0];
    battleState.answers = [null, null];
    battleState.optionOrder = [];
    battleState.actor = 0;
    battleState.phase = "starting";
    battleState.active = true;
    battleState.names = ["你", "对手"];
    battleState.avatars = ["你", "对"];
    onlineState.localAnswered = false;
    onlineState.remoteAnswered = false;
    onlineState.remoteChoice = null;
    onlineState.revealed = false;
    elements.battleSetup.hidden = true;
    elements.battleResult.hidden = true;
    elements.battlePlay.hidden = false;
    updateBattleScoreboard();
    updateBattleTurn();
    setOnlineStatus("对战开始。");
    scheduleOnlineQuestion(0);
  }

  function applyOnlineStart(message) {
    if (onlineState.role !== "guest" || !Array.isArray(message.questions)) {
      return;
    }
    const questions = message.questions
      .map(normalizeOnlineQuestion)
      .filter(Boolean);
    if (questions.length < 4) {
      handleOnlineDisconnect("房主发来的题目无效。");
      return;
    }
    battleState.mode = "online";
    battleState.questions = questions;
    battleState.index = 0;
    battleState.scores = [0, 0];
    battleState.answers = [null, null];
    battleState.optionOrder = [];
    battleState.actor = 0;
    battleState.phase = "starting";
    battleState.active = true;
    battleState.names = ["你", "对手"];
    battleState.avatars = ["你", "对"];
    onlineState.hostTotal = questions.length;
    onlineState.scopeLabel = String(message.scopeLabel || "");
    onlineState.localAnswered = false;
    onlineState.remoteAnswered = false;
    onlineState.remoteChoice = null;
    onlineState.revealed = false;
    elements.battleReplay.disabled = false;
    elements.battleReplay.textContent = "再来一局";
    elements.battleBack.textContent = "离开房间";
    elements.battleSetup.hidden = true;
    elements.battleResult.hidden = true;
    elements.battlePlay.hidden = false;
    updateBattleScoreboard();
    updateBattleTurn();
    setOnlineStatus("对战开始。");
    scheduleOnlineQuestion(0, false);
  }

  function scheduleOnlineQuestion(index, autoStart = true) {
    if (!battleState.active || battleState.mode !== "online") {
      return;
    }
    clearOnlineStartTimer();
    stopBattleTimer();
    battleState.phase = "starting";
    battleState.index = index;
    battleState.answers = [null, null];
    onlineState.localAnswered = false;
    onlineState.remoteAnswered = false;
    onlineState.remoteChoice = null;
    onlineState.revealed = false;
    elements.battleFeedback.hidden = true;
    elements.battleHandoff.hidden = true;
    elements.battleResult.hidden = true;
    elements.battleQuestion.hidden = false;
    elements.battleOptions.hidden = true;
    elements.battleQuestionType.textContent = "准备开始";
    elements.battlePrompt.lang = "zh-CN";
    elements.battlePrompt.classList.remove("is-word");
    elements.battlePrompt.classList.add("is-meaning");
    elements.battlePrompt.textContent = "准备开始";
    elements.battlePromptSub.textContent = "题目即将出现";
    elements.battleRoundLabel.textContent = `第 ${index + 1} / ${battleState.questions.length} 题`;
    elements.battleTimerLabel.textContent = "…";
    elements.battleTimerLabel.classList.remove("is-urgent");
    elements.battleTimer.classList.remove("is-urgent");
    elements.battleTimerBar.style.width = "0%";
    updateBattleScoreboard();
    updateBattleTurn();
    if (autoStart) {
      onlineState.startTimer = window.setTimeout(() => {
        onlineState.startTimer = 0;
        beginOnlineQuestion(index);
      }, onlineStartDelay);
    }
  }

  function beginOnlineQuestion(index) {
    if (
      !battleState.active ||
      battleState.mode !== "online" ||
      !onlineState.connected
    ) {
      return;
    }
    const question = battleState.questions[index];
    if (!question) {
      return;
    }
    battleState.index = index;
    battleState.phase = "question";
    battleState.actor = 0;
    battleState.answers = [null, null];
    battleState.optionOrder = question.options.map((_, optionIndex) => optionIndex);
    onlineState.localAnswered = false;
    onlineState.remoteAnswered = false;
    onlineState.remoteChoice = null;
    onlineState.revealed = false;
    elements.battleFeedback.hidden = true;
    elements.battleHandoff.hidden = true;
    elements.battleResult.hidden = true;
    elements.battleQuestion.hidden = false;
    elements.battleOptions.hidden = false;
    elements.battleRoundLabel.textContent = `第 ${index + 1} / ${battleState.questions.length} 题`;
    renderBattlePrompt(question);
    renderBattleOptionButtons(question, null, false);
    updateBattleScoreboard();
    updateBattleTurn();
    startBattleTimer();
    const firstOption = elements.battleOptions.querySelector("button");
    if (firstOption) {
      firstOption.focus({ preventScroll: true });
    }
    if (onlineState.role === "host") {
      sendOnlineMessage({ type: "begin", index });
    }
  }

  function submitOnlineAnswer(optionIndex) {
    if (
      !battleState.active ||
      battleState.phase !== "question" ||
      onlineState.localAnswered
    ) {
      return;
    }
    const question = battleState.questions[battleState.index];
    const option = optionIndex === null ? null : question.options[optionIndex];
    if (optionIndex !== null && !option) {
      return;
    }
    onlineState.localAnswered = true;
    battleState.answers[0] = option ? option.text : null;
    elements.battleOptions.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
      if (option && Number(button.dataset.battleOption) === optionIndex) {
        button.classList.add("is-pending");
      }
    });
    updateBattleTurn();
    if (onlineState.role === "guest") {
      if (option) {
        sendOnlineMessage({ type: "answer", choice: optionIndex });
      } else {
        sendOnlineMessage({ type: "timeout" });
      }
      setOnlineStatus(option ? "已作答，等待房主揭晓。" : "时间到，等待房主揭晓。");
      return;
    }
    if (onlineState.remoteAnswered) {
      revealOnlineQuestion();
    } else {
      sendOnlineMessage({ type: "peer-ready" });
      setOnlineStatus("已作答，等待对手…");
      updateBattleTurn();
    }
  }

  function handleOnlineTimeout() {
    if (!battleState.active || battleState.phase !== "question") {
      return;
    }
    if (onlineState.role === "guest") {
      if (onlineState.localAnswered) {
        updateBattleTurn();
        return;
      }
      onlineState.localAnswered = true;
      battleState.answers[0] = null;
      elements.battleOptions.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
      updateBattleTurn();
      sendOnlineMessage({ type: "timeout" });
      setOnlineStatus("时间到，等待房主揭晓。");
      return;
    }
    if (!onlineState.localAnswered) {
      onlineState.localAnswered = true;
      battleState.answers[0] = null;
    }
    if (!onlineState.remoteAnswered) {
      onlineState.remoteAnswered = true;
      onlineState.remoteChoice = null;
    }
    revealOnlineQuestion();
  }

  function scheduleOnlineReveal() {
    revealOnlineQuestion();
  }

  function revealOnlineQuestion() {
    if (
      onlineState.role !== "host" ||
      !battleState.active ||
      battleState.phase !== "question" ||
      onlineState.revealed
    ) {
      return;
    }
    const question = battleState.questions[battleState.index];
    if (!question) {
      return;
    }
    onlineState.revealed = true;
    stopBattleTimer();
    const hostChoice = battleState.answers[0] || null;
    const guestChoice = onlineState.remoteChoice || null;
    battleState.answers = [hostChoice, guestChoice];
    if (hostChoice === question.correct) {
      battleState.scores[0] += 1;
    }
    if (guestChoice === question.correct) {
      battleState.scores[1] += 1;
    }
    sendOnlineMessage({
      type: "reveal",
      hostChoice,
      guestChoice,
      hostScore: battleState.scores[0],
      guestScore: battleState.scores[1],
    });
    setOnlineStatus("答案已揭晓。");
    renderBattleFeedback({ skipScore: true });
  }

  function applyOnlineReveal(message) {
    if (
      onlineState.role !== "guest" ||
      !battleState.active ||
      battleState.phase !== "question"
    ) {
      return;
    }
    stopBattleTimer();
    onlineState.revealed = true;
    onlineState.localAnswered = true;
    onlineState.remoteAnswered = true;
    battleState.answers = [
      message.guestChoice ?? null,
      message.hostChoice ?? null,
    ];
    battleState.scores = [
      Number(message.guestScore) || 0,
      Number(message.hostScore) || 0,
    ];
    setOnlineStatus("答案已揭晓。");
    renderBattleFeedback({ skipScore: true });
  }

  function nextOnlineQuestion() {
    if (onlineState.role !== "host") {
      showToast("等待房主开始下一题。");
      return;
    }
    if (battleState.phase !== "feedback") {
      return;
    }
    if (battleState.index + 1 >= battleState.questions.length) {
      sendOnlineMessage({
        type: "result",
        hostScore: battleState.scores[0],
        guestScore: battleState.scores[1],
      });
      showBattleResult();
      return;
    }
    const nextIndex = battleState.index + 1;
    sendOnlineMessage({ type: "next", index: nextIndex });
    scheduleOnlineQuestion(nextIndex);
  }

  function refreshBattleSetup() {
    const scope = uniqueBattleWords(getFilteredWords());
    const isOnline = battleState.mode === "online";
    const role = onlineState.role;
    battleState.scopeWords = scope;
    elements.battleScopeLabel.textContent =
      isOnline && role === "guest" && onlineState.connected
        ? onlineState.scopeLabel || "房主范围"
        : battleScopeText();
    elements.battleScopeCount.textContent =
      isOnline && role === "guest" && onlineState.connected
        ? onlineState.hostTotal
          ? `${onlineState.hostTotal} 题`
          : "以房主为准"
        : `${scope.length} 个可出题单词`;

    elements.battleModal.querySelectorAll("[data-battle-mode]").forEach((button) => {
      const selected = button.dataset.battleMode === battleState.mode;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    elements.battleModal.querySelectorAll("[data-battle-count]").forEach((button) => {
      const selected = Number(button.dataset.battleCount) === battleState.questionCount;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.disabled = isOnline && role === "guest";
    });

    updateOnlinePanel();
    const supported = onlineSupported();
    if (!supported) {
      elements.onlineCreate.disabled = true;
      elements.onlineJoinToggle.disabled = true;
      elements.onlineJoin.disabled = true;
    }

    const enough = scope.length >= 4;
    let canStart = enough;
    let startLabel =
      battleState.mode === "ai"
        ? "开始人机对战"
        : battleState.mode === "duo"
          ? "开始双人对战"
          : "开始联机对战";
    if (isOnline) {
      if (role === "host") {
        canStart = enough && onlineState.connected;
        startLabel = onlineState.connected ? "开始联机对战" : "等待对手连接";
      } else if (role === "guest") {
        canStart = false;
        startLabel = onlineState.connected ? "等待房主开始" : "等待连接";
      } else {
        canStart = false;
        startLabel = "请先创建或加入房间";
      }
    }
    elements.battleStart.disabled = !canStart;
    elements.battleStart.textContent = startLabel;

    if (isOnline) {
      let hint;
      if (!supported) {
        hint = "当前浏览器不支持 WebRTC，无法使用联机对战。";
      } else if (!role) {
        hint =
          "点“创建房间”生成邀请码；加入房间则粘贴邀请码并生成应答码。邀请码和应答码通过聊天工具互发。";
      } else if (role === "host") {
        hint = onlineState.connected
          ? `对手已连接 · ${scope.length} 个可出题单词 · 每题 15 秒，双方同时作答。`
          : "房间已创建。把邀请码发给对手，粘贴对手的应答码后点击连接。";
      } else {
        hint = onlineState.connected
          ? "已连接房主。房主开始后，双方同时作答，由房主统一揭晓答案。"
          : "把应答码发回房主，等待连接。";
      }
      if (role === "host" && !enough) {
        hint = "当前范围不足 4 个不重复单词，请更换 List 或清除筛选后再来。";
      }
      elements.battleHint.textContent = hint;
      return;
    }

    const actual = Math.min(battleState.questionCount, scope.length);
    if (!enough) {
      elements.battleHint.textContent =
        "当前范围不足 4 个不重复单词，请更换 List 或清除筛选后再来。";
      return;
    }

    let hint =
      battleState.mode === "ai"
        ? "电脑正确率约 65% · 每题 15 秒，超时算答错。"
        : "两位玩家答同一组题，每题各 15 秒；双方都作答后揭晓答案。";
    if (actual < battleState.questionCount) {
      hint += ` 当前范围只有 ${scope.length} 个词，本局 ${actual} 题。`;
    }
    elements.battleHint.textContent = hint;
  }

  function openBattle() {
    const scope = uniqueBattleWords(getFilteredWords());
    if (scope.length < 4) {
      showToast("当前范围至少需要 4 个不重复单词才能开始对战。");
      return;
    }

    if (onlineState.role) {
      leaveOnlineRoom({ notify: true, silent: true });
    }
    if (!elements.randomModal.hidden) {
      closeRandomWord();
    }
    stopBattleTimer();
    battleState.active = false;
    battleState.phase = "setup";
    battleState.scopeWords = scope;
    battleState.questions = [];
    battleState.index = 0;
    battleState.scores = [0, 0];
    battleState.answers = [null, null];
    battleState.aiAnswer = null;
    elements.battleReplay.disabled = false;
    elements.battleReplay.textContent = "再来一局";
    elements.battleBack.textContent = battleState.mode === "online" ? "离开房间" : "返回设置";
    if (
      battleState.mode === "online" &&
      !onlineState.role
    ) {
      setOnlineStatus("创建房间或加入房间。");
    }

    elements.battleSetup.hidden = false;
    elements.battlePlay.hidden = true;
    elements.battleResult.hidden = true;
    elements.battleModal.hidden = false;
    refreshBattleSetup();
    syncModalScrollLock();
    if (elements.battleStart.disabled) {
      const modeButton = elements.battleModal.querySelector("[data-battle-mode]");
      if (modeButton) {
        modeButton.focus();
      }
    } else {
      elements.battleStart.focus();
    }
  }

  function closeBattle() {
    if (onlineState.role) {
      leaveOnlineRoom({ notify: true, silent: true });
    }
    stopBattleTimer();
    battleState.active = false;
    battleState.phase = "setup";
    elements.battleModal.hidden = true;
    syncModalScrollLock();
    elements.battleButton.focus();
  }

  function startBattle() {
    if (battleState.mode === "online") {
      startOnlineBattle();
      return;
    }
    const scope = battleState.scopeWords.length
      ? battleState.scopeWords
      : uniqueBattleWords(getFilteredWords());
    if (scope.length < 4) {
      refreshBattleSetup();
      showToast("当前范围至少需要 4 个不重复单词才能开始对战。");
      return;
    }

    const total = Math.min(battleState.questionCount, scope.length);
    const questions = buildBattleQuestions(scope, total);
    if (questions.length < 4) {
      showToast("题目生成失败，请换一个范围再试。");
      return;
    }

    battleState.scopeWords = scope;
    battleState.questions = questions;
    battleState.index = 0;
    battleState.scores = [0, 0];
    battleState.answers = [null, null];
    battleState.aiAnswer = null;
    battleState.active = true;
    battleState.phase = "question";
    battleState.actor = 0;
    battleState.names = battleState.mode === "ai" ? ["你", "电脑"] : ["玩家 1", "玩家 2"];
    battleState.avatars = battleState.mode === "ai" ? ["你", "AI"] : ["1", "2"];

    elements.battleSetup.hidden = true;
    elements.battlePlay.hidden = false;
    elements.battleResult.hidden = true;
    updateBattleScoreboard();
    beginBattleTurn(0);
  }

  function updateBattleScoreboard() {
    elements.battlePlayer1Avatar.textContent = battleState.avatars[0];
    elements.battlePlayer2Avatar.textContent = battleState.avatars[1];
    elements.battlePlayer1Name.textContent = battleState.names[0];
    elements.battlePlayer2Name.textContent = battleState.names[1];
    elements.battlePlayer1Score.textContent = String(battleState.scores[0]);
    elements.battlePlayer2Score.textContent = String(battleState.scores[1]);
    elements.battlePlayer2.classList.toggle("is-ai", battleState.mode === "ai");
    const inQuestion = battleState.phase === "question";
    const onlineTurn =
      battleState.mode === "online" &&
      (battleState.phase === "question" || battleState.phase === "starting");
    elements.battlePlayer1.classList.toggle(
      "is-active",
      onlineTurn || (inQuestion && battleState.actor === 0),
    );
    elements.battlePlayer2.classList.toggle(
      "is-active",
      onlineTurn || (inQuestion && battleState.actor === 1),
    );
  }

  function updateBattleTurn() {
    let text;
    if (battleState.phase === "feedback") {
      text = "本题结束";
    } else if (battleState.phase === "starting") {
      text = "准备开始";
    } else if (battleState.mode === "online") {
      if (!onlineState.connected) {
        text = "等待连接";
      } else if (onlineState.localAnswered) {
        text =
          battleState.answers[0] === null ? "已超时，等待对手…" : "已作答，等待对手…";
      } else if (onlineState.remoteAnswered) {
        text =
          onlineState.role === "host" && !onlineState.remoteChoice
            ? "对手已超时，轮到你"
            : "对手已作答，轮到你";
      } else {
        text = "同时作答";
      }
    } else if (battleState.phase === "handoff") {
      text = `${battleState.names[0]} 已作答`;
    } else if (battleState.mode === "ai") {
      text = "轮到你";
    } else {
      text = battleState.actor === 0 ? "玩家 1 作答" : "玩家 2 作答";
    }
    elements.battleTurnLabel.textContent = text;
  }

  function renderBattlePrompt(question) {
    const wordToMeaning = question.type === "word-to-meaning";
    elements.battleQuestionType.textContent = wordToMeaning ? "英译中" : "中译英";
    elements.battlePrompt.textContent = wordToMeaning
      ? question.word.word
      : question.word.meaning;
    elements.battlePrompt.lang = wordToMeaning ? "en" : "zh-CN";
    elements.battlePrompt.classList.toggle("is-word", wordToMeaning);
    elements.battlePrompt.classList.toggle("is-meaning", !wordToMeaning);
    elements.battlePromptSub.textContent = wordToMeaning
      ? "选出正确的中文释义"
      : "选出对应的英文单词";
  }

  function renderBattleOptionButtons(question, selectedText, reveal) {
    const fragment = document.createDocumentFragment();
    battleState.optionOrder.forEach((optionIndex, position) => {
      const option = question.options[optionIndex];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "battle-option";
      button.dataset.battleOption = String(optionIndex);
      button.disabled = Boolean(reveal);
      if (reveal) {
        if (option.correct) {
          button.classList.add("is-correct");
        }
        if (!option.correct && option.text === selectedText) {
          button.classList.add("is-wrong");
        }
        if (option.correct && option.text === selectedText) {
          button.classList.add("is-selected");
        }
      }

      const key = document.createElement("span");
      key.className = "battle-option-key";
      key.textContent = String.fromCharCode(65 + position);
      const text = document.createElement("span");
      text.className = "battle-option-text";
      text.textContent = option.text;
      button.append(key, text);
      button.setAttribute("aria-label", `${key.textContent}. ${option.text}`);
      fragment.append(button);
    });
    elements.battleOptions.replaceChildren(fragment);
  }

  function beginBattleTurn(actor) {
    const question = battleState.questions[battleState.index];
    if (!question) {
      showBattleResult();
      return;
    }

    battleState.phase = "question";
    battleState.actor = actor;
    if (actor === 0) {
      battleState.aiAnswer =
        battleState.mode === "ai" ? pickBattleAiAnswer(question) : null;
    }
    battleState.optionOrder = shuffleWords(
      question.options.map((_, index) => index),
    );

    renderBattlePrompt(question);
    renderBattleOptionButtons(question, null, false);
    elements.battleQuestion.hidden = false;
    elements.battleOptions.hidden = false;
    elements.battleFeedback.hidden = true;
    elements.battleHandoff.hidden = true;
    elements.battleRoundLabel.textContent = `第 ${battleState.index + 1} / ${
      battleState.questions.length
    } 题`;
    elements.battleTimerLabel.textContent = `${battleTimerSeconds}s`;
    elements.battleTimerBar.style.width = "100%";
    elements.battleTimer.classList.remove("is-urgent");
    elements.battleTimerLabel.classList.remove("is-urgent");
    updateBattleScoreboard();
    updateBattleTurn();
    startBattleTimer();

    const firstOption = elements.battleOptions.querySelector("button");
    if (firstOption) {
      firstOption.focus({ preventScroll: true });
    }
  }

  function pickBattleAiAnswer(question) {
    const correctOption = question.options.find((option) => option.correct);
    const wrongOptions = question.options.filter((option) => !option.correct);
    if (wrongOptions.length && Math.random() > battleAiAccuracy) {
      return wrongOptions[Math.floor(Math.random() * wrongOptions.length)].text;
    }
    return correctOption ? correctOption.text : null;
  }

  function submitBattleAnswer(optionIndex) {
    if (!battleState.active || battleState.phase !== "question") {
      return;
    }
    const question = battleState.questions[battleState.index];
    if (!question) {
      return;
    }
    if (battleState.mode === "online") {
      submitOnlineAnswer(optionIndex);
      return;
    }
    const option = optionIndex === null ? null : question.options[optionIndex];
    const answerText = option ? option.text : null;

    stopBattleTimer();

    if (battleState.mode === "ai") {
      battleState.answers[0] = answerText;
      battleState.answers[1] = battleState.aiAnswer;
      renderBattleFeedback();
      return;
    }

    if (battleState.actor === 0) {
      battleState.answers[0] = answerText;
      battleState.phase = "handoff";
      showBattleHandoff();
      return;
    }

    battleState.answers[1] = answerText;
    renderBattleFeedback();
  }

  function showBattleHandoff() {
    elements.battleHandoffTitle.textContent = `${battleState.names[0]} 已作答`;
    elements.battleHandoffText.textContent = `把设备交给${battleState.names[1]}，准备答同一道题。`;
    elements.battleHandoffNext.textContent = `${battleState.names[1]} 开始`;
    elements.battleQuestion.hidden = true;
    elements.battleOptions.hidden = true;
    elements.battleFeedback.hidden = true;
    elements.battleHandoff.hidden = false;
    elements.battleTimerLabel.textContent = "—";
    elements.battleTimerBar.style.width = "0%";
    elements.battleTimer.classList.remove("is-urgent");
    elements.battleTimerLabel.classList.remove("is-urgent");
    updateBattleScoreboard();
    updateBattleTurn();
    elements.battleHandoffNext.focus();
  }

  function startSecondPlayerTurn() {
    if (
      !battleState.active ||
      battleState.phase !== "handoff" ||
      battleState.mode !== "duo"
    ) {
      return;
    }
    const question = battleState.questions[battleState.index];
    if (!question) {
      return;
    }

    battleState.phase = "question";
    battleState.actor = 1;
    battleState.optionOrder = shuffleWords(
      question.options.map((_, index) => index),
    );
    elements.battleHandoff.hidden = true;
    elements.battleQuestion.hidden = false;
    elements.battleOptions.hidden = false;
    elements.battleFeedback.hidden = true;
    renderBattlePrompt(question);
    renderBattleOptionButtons(question, null, false);
    elements.battleTimerLabel.textContent = `${battleTimerSeconds}s`;
    elements.battleTimerBar.style.width = "100%";
    elements.battleTimer.classList.remove("is-urgent");
    elements.battleTimerLabel.classList.remove("is-urgent");
    updateBattleScoreboard();
    updateBattleTurn();
    startBattleTimer();

    const firstOption = elements.battleOptions.querySelector("button");
    if (firstOption) {
      firstOption.focus({ preventScroll: true });
    }
  }

  function renderBattleFeedback(options = {}) {
    if (battleState.phase !== "question") {
      return;
    }
    const question = battleState.questions[battleState.index];
    if (!question) {
      return;
    }
    battleState.phase = "feedback";

    if (!options.skipScore) {
      battleState.answers.forEach((answer, index) => {
        if (answer !== null && answer === question.correct) {
          battleState.scores[index] += 1;
        }
      });
    }

    let title;
    if (battleState.mode === "ai") {
      if (battleState.answers[0] === null) {
        title = "时间到，未作答";
      } else if (battleState.answers[0] === question.correct) {
        title = "答对了！";
      } else {
        title = "这题没答对";
      }
    } else if (battleState.mode === "online") {
      if (battleState.answers[0] === null) {
        title = "时间到，未作答";
      } else if (battleState.answers[0] === question.correct) {
        title = "答对了！";
      } else {
        title = "这题没答对";
      }
    } else {
      title = "答案揭晓";
    }
    elements.battleFeedbackTitle.textContent = title;

    const cards = [0, 1]
      .map((index) => {
        const answer = battleState.answers[index];
        const isCorrect = answer === question.correct;
        const stateClass =
          answer === null ? "is-empty" : isCorrect ? "is-correct" : "is-wrong";
        const status = answer === null ? "未作答" : isCorrect ? "答对" : "答错";
        return `
          <div class="battle-answer-card ${stateClass}">
            <span class="battle-answer-name">${escapeHtml(battleState.names[index])}</span>
            <span class="battle-answer-status">${status}</span>
            <p class="battle-answer-text">${
              answer === null ? "超时未作答" : escapeHtml(answer)
            }</p>
          </div>`;
      })
      .join("");
    elements.battleAnswerCards.innerHTML = cards;

    const word = question.word;
    const detail = wordDetails[word.word] || {};
    const sentence = (detail.sentences || [])[0];
    const phonetic = phoneticFor(word, state.accent);
    const partKey = word.partKeys.values().next().value || "";
    const partClass = partKey ? `part-${partKey}` : "";
    elements.battleWordReveal.innerHTML = `
      <div class="battle-reveal-head">
        <button
          class="battle-speak"
          type="button"
          data-battle-action="speak"
          data-word="${escapeHtml(word.word)}"
          title="朗读 ${escapeHtml(word.word)}"
          aria-label="朗读 ${escapeHtml(word.word)}"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M11 5 6 9H2v6h4l5 4V5z" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        </button>
        <strong class="battle-reveal-word">${escapeHtml(word.word)}</strong>
        <span class="battle-reveal-phonetic">${escapeHtml(phonetic)}</span>
        <span class="part-badge ${partClass}">${escapeHtml(word.part)}</span>
      </div>
      <p class="battle-reveal-meaning">${escapeHtml(word.meaning)}</p>
      ${
        sentence
          ? `<div class="battle-example">
               <button
                 class="battle-example-en"
                 type="button"
                 data-battle-action="speak-text"
                 data-speak="${escapeHtml(sentence.en)}"
               >${escapeHtml(sentence.en)}</button>
               <p class="battle-example-cn">${escapeHtml(sentence.cn)}</p>
             </div>`
          : ""
      }`;

    const selectedText =
      battleState.mode === "duo" ? battleState.answers[1] : battleState.answers[0];
    renderBattleOptionButtons(question, selectedText, true);
    elements.battleQuestion.hidden = false;
    elements.battleOptions.hidden = false;
    elements.battleHandoff.hidden = true;
    elements.battleFeedback.hidden = false;
    elements.battleTimerLabel.textContent = "—";
    elements.battleTimerBar.style.width = "0%";
    elements.battleTimer.classList.remove("is-urgent");
    elements.battleTimerLabel.classList.remove("is-urgent");
    if (battleState.mode === "online") {
      const isHost = onlineState.role === "host";
      elements.battleNext.disabled = !isHost;
      elements.battleNext.textContent = isHost
        ? battleState.index + 1 >= battleState.questions.length
          ? "查看结果"
          : "下一题"
        : "等待房主";
    } else {
      elements.battleNext.disabled = false;
      elements.battleNext.textContent =
        battleState.index + 1 >= battleState.questions.length ? "查看结果" : "下一题";
    }
    updateBattleScoreboard();
    updateBattleTurn();
    if (!elements.battleNext.disabled) {
      elements.battleNext.focus();
    }
  }

  function nextBattleQuestion() {
    if (battleState.mode === "online") {
      nextOnlineQuestion();
      return;
    }
    if (battleState.phase !== "feedback") {
      return;
    }
    if (battleState.index + 1 >= battleState.questions.length) {
      showBattleResult();
      return;
    }
    battleState.index += 1;
    battleState.answers = [null, null];
    battleState.aiAnswer = null;
    beginBattleTurn(0);
  }

  function showBattleResult() {
    stopBattleTimer();
    battleState.active = false;
    battleState.phase = "result";
    const total = battleState.questions.length;
    const [score1, score2] = battleState.scores;
    const names = battleState.names;

    let title;
    if (score1 === score2) {
      title = "平局";
    } else if (battleState.mode === "ai") {
      title = score1 > score2 ? "你赢了！" : "电脑赢了";
    } else if (battleState.mode === "online") {
      title = score1 > score2 ? "你赢了！" : "对手赢了";
    } else {
      title = score1 > score2 ? "玩家 1 获胜！" : "玩家 2 获胜！";
    }

    const stat = (index) => {
      const correct = battleState.scores[index];
      const percent = total ? Math.round((correct / total) * 100) : 0;
      return `
        <div class="battle-stat">
          <span>${escapeHtml(names[index])}</span>
          <strong>${correct} / ${total}</strong>
          <small>正确率 ${percent}%</small>
        </div>`;
    };

    elements.battleResultTitle.textContent = title;
    elements.battleResultScore.textContent = `${names[0]} ${score1} : ${score2} ${names[1]}`;
    elements.battleResultStats.innerHTML = `${stat(0)}${stat(1)}`;
    if (battleState.mode === "online") {
      const isGuest = onlineState.role === "guest";
      elements.battleReplay.disabled = isGuest;
      elements.battleReplay.textContent = isGuest ? "等待房主" : "再来一局";
      elements.battleBack.textContent = "离开房间";
    } else {
      elements.battleReplay.disabled = false;
      elements.battleReplay.textContent = "再来一局";
      elements.battleBack.textContent = "返回设置";
    }
    elements.battlePlay.hidden = true;
    elements.battleFeedback.hidden = true;
    elements.battleResult.hidden = false;
    if (elements.battleReplay.disabled) {
      elements.battleBack.focus();
    } else {
      elements.battleReplay.focus();
    }
  }

  function backToBattleSetup() {
    const wasOnline = Boolean(onlineState.role);
    if (wasOnline) {
      leaveOnlineRoom({ notify: true, silent: true });
    }
    stopBattleTimer();
    battleState.active = false;
    battleState.phase = "setup";
    battleState.questions = [];
    battleState.index = 0;
    battleState.scores = [0, 0];
    battleState.answers = [null, null];
    elements.battleReplay.disabled = false;
    elements.battleReplay.textContent = "再来一局";
    elements.battleBack.textContent = "返回设置";
    elements.battlePlay.hidden = true;
    elements.battleResult.hidden = true;
    elements.battleSetup.hidden = false;
    if (battleState.mode === "online") {
      setOnlineStatus(wasOnline ? "已离开房间。" : "创建房间或加入房间。");
    }
    refreshBattleSetup();
    elements.battleStart.focus();
  }

  function stopBattleTimer() {
    if (battleState.timerId) {
      window.clearInterval(battleState.timerId);
      battleState.timerId = 0;
    }
  }

  function startBattleTimer() {
    stopBattleTimer();
    battleState.deadline = Date.now() + battleTimerSeconds * 1000;
    updateBattleTimer();
    battleState.timerId = window.setInterval(updateBattleTimer, 100);
  }

  function updateBattleTimer() {
    if (!battleState.active || battleState.phase !== "question") {
      return;
    }
    const remaining = Math.max(0, battleState.deadline - Date.now());
    const percent = (remaining / (battleTimerSeconds * 1000)) * 100;
    elements.battleTimerBar.style.width = `${percent}%`;
    elements.battleTimerLabel.textContent = `${Math.ceil(remaining / 1000)}s`;
    elements.battleTimer.classList.toggle("is-urgent", remaining <= 5000);
    elements.battleTimerLabel.classList.toggle("is-urgent", remaining <= 5000);
    if (remaining <= 0) {
      stopBattleTimer();
      if (battleState.mode === "online") {
        handleOnlineTimeout();
      } else {
        submitBattleAnswer(null);
      }
    }
  }

  function render() {
    const filteredWords = getFilteredWords();
    const visibleWords = filteredWords.slice(0, state.visibleLimit);
    fragment.replaceChildren();

    if (elements.headerWordCount) {
      elements.headerWordCount.textContent = String(words.length);
    }
    if (elements.headerListCount) {
      elements.headerListCount.textContent = String(listSummaries.length);
    }
    if (elements.summaryWordCount) {
      elements.summaryWordCount.textContent = String(words.length);
    }
    if (elements.summaryListCount) {
      elements.summaryListCount.textContent = String(listSummaries.length);
    }

    visibleWords.forEach((word, index) => {
      const row = renderWordRow(word, visibleWords[index - 1]);
      fragment.append(row);
      // 面板已经插进行内，这里再按当前展开状态决定显隐。
      updateDetailVisibility(row, word);
    });
    elements.wordList.replaceChildren(fragment);

    elements.emptyState.hidden = filteredWords.length !== 0;
    elements.wordList.hidden = filteredWords.length === 0;
    elements.loadMoreWrap.hidden =
      filteredWords.length === 0 || visibleWords.length >= filteredWords.length;
    elements.loadMore.textContent = `显示更多词汇（剩余 ${
      filteredWords.length - visibleWords.length
    } 条）`;

    elements.favoriteCount.textContent = String(favorites.size);
    elements.favoriteFilter.setAttribute(
      "aria-pressed",
      state.favoritesOnly ? "true" : "false",
    );
    elements.wordToggle.setAttribute("aria-pressed", state.hideWord ? "true" : "false");
    elements.wordToggle.title = state.hideWord ? "显示英文单词" : "隐藏英文单词";
    elements.meaningToggle.setAttribute(
      "aria-pressed",
      state.hideMeaning ? "true" : "false",
    );
    elements.meaningToggle.title = state.hideMeaning ? "显示中文释义" : "隐藏中文释义";
    elements.accentToggle.dataset.accent = state.accent;
    elements.accentToggle.setAttribute("aria-pressed", state.accent === "uk" ? "true" : "false");
    elements.accentToggle.title = `当前为${accentOptions[state.accent].name}，点击切换为${
      accentOptions[state.accent === "us" ? "uk" : "us"].name
    }`;
    elements.accentLabel.textContent = accentOptions[state.accent].label;
    elements.autoSpeakToggle.setAttribute(
      "aria-pressed",
      state.autoSpeak ? "true" : "false",
    );
    elements.autoSpeakToggle.title = state.autoSpeak
      ? "已开启：点击词条任意位置即可朗读"
      : "开启后点击词条任意位置即可朗读";
    elements.detailToggle.setAttribute("aria-pressed", state.showDetails ? "true" : "false");
    elements.detailToggle.title = state.showDetails
      ? "已开启：所有词条都显示例句搭配"
      : "展开或收起词条的例句、常用搭配和同义词";
    syncCollapseButton();
    elements.clearSearch.hidden = !state.query;
    if (activeRandomWord) {
      renderRandomWord();
    }

    updateHeading(
      filteredWords.length,
      uniqueBattleWords(filteredWords).length,
    );
    updateListNav();
  }

  function resetFilterState() {
    state.selectedList = "all";
    state.query = "";
    state.part = "all";
    state.favoritesOnly = false;
    state.hideWord = false;
    state.hideMeaning = false;
    state.visibleLimit = initialLimit;
    elements.searchInput.value = "";
    elements.partFilter.value = "all";
  }

  elements.listNav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-list]");
    if (!button) {
      return;
    }
    stopSpeaking();
    state.selectedList = button.dataset.list === "all" ? "all" : Number(button.dataset.list);
    state.visibleLimit = initialLimit;
    render();
  });

  elements.searchInput.addEventListener("input", (event) => {
    stopSpeaking();
    state.query = event.target.value;
    state.visibleLimit = initialLimit;
    render();
  });

  elements.clearSearch.addEventListener("click", () => {
    state.query = "";
    elements.searchInput.value = "";
    elements.searchInput.focus();
    state.visibleLimit = initialLimit;
    render();
  });

  elements.partFilter.addEventListener("change", (event) => {
    state.part = event.target.value;
    state.visibleLimit = initialLimit;
    render();
  });

  elements.favoriteFilter.addEventListener("click", () => {
    state.favoritesOnly = !state.favoritesOnly;
    state.visibleLimit = initialLimit;
    render();
  });

  elements.meaningToggle.addEventListener("click", () => {
    state.hideMeaning = !state.hideMeaning;
    render();
  });

  elements.wordToggle.addEventListener("click", () => {
    state.hideWord = !state.hideWord;
    render();
  });

  elements.accentToggle.addEventListener("click", () => {
    state.accent = state.accent === "us" ? "uk" : "us";
    writeStorage(accentStorageKey, state.accent);
    render();
  });

  elements.autoSpeakToggle.addEventListener("click", () => {
    state.autoSpeak = !state.autoSpeak;
    writeStorage(autoSpeakStorageKey, String(state.autoSpeak));
    render();
  });

  elements.detailToggle.addEventListener("click", () => {
    state.showDetails = !state.showDetails;
    writeStorage(detailStorageKey, String(state.showDetails));
    // 关闭全局展开时，逐条展开的记录一并清掉，避免语义歧义。
    if (!state.showDetails) {
      state.expandedIds.clear();
    }
    render();
  });

  elements.collapseToggle.addEventListener("click", () => {
    // 全局展开和逐条展开都要重置，否则重绘时会再次展开。
    state.expandedIds.clear();
    state.showDetails = false;
    writeStorage(detailStorageKey, "false");
    render();
  });

  elements.wordList.addEventListener("click", (event) => {
    const speakButton = event.target.closest('[data-action="speak"]');
    const speakTextButton = event.target.closest('[data-action="speak-text"]');
    const favoriteButton = event.target.closest('[data-action="favorite"]');
    const detailButton = event.target.closest('[data-action="detail"]');
    const row = event.target.closest(".word-row");
    if (!row) {
      return;
    }
    const word = words.find((item) => item.id === row.dataset.wordId);
    if (!word) {
      return;
    }

    // 例句和搭配的朗读：直接读按钮上的文本。
    if (speakTextButton) {
      stopSpeaking();
      playWord(speakTextButton.dataset.speak, state.accent);
      return;
    }

    if (speakButton) {
      playWord(word.word, state.accent);
      return;
    }

    if (favoriteButton) {
      if (favorites.has(word.id)) {
        favorites.delete(word.id);
      } else {
        favorites.add(word.id);
      }
      saveFavorites();
      render();
      return;
    }

    if (detailButton) {
      if (state.expandedIds.has(word.id)) {
        state.expandedIds.delete(word.id);
      } else {
        state.expandedIds.add(word.id);
      }
      updateDetailVisibility(row, word);
      syncCollapseButton();
      return;
    }

    // 已展开时点击词条主体即收起，方便快速翻阅。
    if (state.expandedIds.has(word.id)) {
      state.expandedIds.delete(word.id);
      updateDetailVisibility(row, word);
      syncCollapseButton();
      return;
    }

    // 开启「点击即读」后，点击词条任意位置都会朗读。
    if (state.autoSpeak) {
      playWord(word.word, state.accent);
    }

    if (state.hideWord || state.hideMeaning) {
      row.classList.toggle("content-revealed");
    }
  });

  elements.loadMore.addEventListener("click", () => {
    state.visibleLimit += loadStep;
    render();
  });

  function resetFilters() {
    resetFilterState();
    render();
  }

  elements.resetFilters.addEventListener("click", resetFilters);
  elements.emptyReset.addEventListener("click", resetFilters);
  elements.randomWordButton.addEventListener("click", openRandomWord);
  elements.battleButton.addEventListener("click", openBattle);
  elements.battleModal.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-battle-action]");
    if (actionButton) {
      const action = actionButton.dataset.battleAction;
      if (action === "close") {
        closeBattle();
      } else if (action === "speak" && actionButton.dataset.word) {
        playWord(actionButton.dataset.word, state.accent);
      } else if (action === "speak-text" && actionButton.dataset.speak) {
        stopSpeaking();
        playWord(actionButton.dataset.speak, state.accent);
      }
      return;
    }

    const modeButton = event.target.closest("[data-battle-mode]");
    if (modeButton) {
      const nextMode = modeButton.dataset.battleMode;
      if (nextMode !== "online" && battleState.mode === "online") {
        leaveOnlineRoom({ notify: true, silent: true });
      }
      battleState.mode =
        nextMode === "duo" ? "duo" : nextMode === "online" ? "online" : "ai";
      if (nextMode === "online" && !onlineState.role) {
        setOnlineStatus("创建房间或加入房间。");
      }
      refreshBattleSetup();
      return;
    }

    const countButton = event.target.closest("[data-battle-count]");
    if (countButton) {
      const count = Number(countButton.dataset.battleCount);
      if (count === 5 || count === 10 || count === 15) {
        battleState.questionCount = count;
        if (onlineState.role === "host" && onlineState.connected) {
          const scopeSize = uniqueBattleWords(getFilteredWords()).length;
          onlineState.hostTotal = Math.min(count, scopeSize);
          onlineState.scopeLabel = battleScopeText();
          sendOnlineMessage({
            type: "welcome",
            roomNumber: onlineState.roomNumber,
            questionCount: onlineState.hostTotal,
            scopeLabel: onlineState.scopeLabel,
          });
        }
        refreshBattleSetup();
      }
    }
  });
  elements.battleStart.addEventListener("click", startBattle);
  elements.onlineCreate.addEventListener("click", createOnlineRoom);
  elements.onlineJoinToggle.addEventListener("click", () => {
    const panel = elements.onlineJoinPanel;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      elements.onlineJoinInput.focus();
    }
  });
  elements.onlineJoin.addEventListener("click", joinOnlineRoom);
  elements.onlineConnect.addEventListener("click", connectOnlineRoom);
  elements.onlineCopyInvite.addEventListener("click", () => {
    copyOnlineText(elements.onlineInvite.value, "邀请码");
  });
  elements.onlineCopyAnswer.addEventListener("click", () => {
    copyOnlineText(elements.onlineAnswer.value, "应答码");
  });
  elements.onlineLeave.addEventListener("click", () => leaveOnlineRoom());
  elements.battleOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-battle-option]");
    if (!button || button.disabled) {
      return;
    }
    submitBattleAnswer(Number(button.dataset.battleOption));
  });
  elements.battleNext.addEventListener("click", nextBattleQuestion);
  elements.battleHandoffNext.addEventListener("click", startSecondPlayerTurn);
  elements.battleReplay.addEventListener("click", startBattle);
  elements.battleBack.addEventListener("click", backToBattleSetup);
  elements.randomModal.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-random-action]");
    if (!actionButton) {
      return;
    }
    const action = actionButton.dataset.randomAction;
    if (action === "close") {
      closeRandomWord();
    } else if (action === "next") {
      openRandomWord();
    } else if (action === "reveal-meaning" && activeRandomWord) {
      randomMeaningRevealed = !randomMeaningRevealed;
      updateRandomMeaningState();
    } else if (action === "speak" && activeRandomWord) {
      playWord(activeRandomWord.word, state.accent);
    } else if (action === "forget") {
      toggleForgottenWord();
    } else if (action === "favorite" && activeRandomWord) {
      if (favorites.has(activeRandomWord.id)) {
        favorites.delete(activeRandomWord.id);
      } else {
        favorites.add(activeRandomWord.id);
      }
      saveFavorites();
      render();
      renderRandomWord();
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    const battleOpen = !elements.battleModal.hidden;

    if (battleOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBattle();
        return;
      }
      if (
        battleState.phase === "question" &&
        /^[1-4]$/.test(event.key) &&
        !event.repeat
      ) {
        const options = elements.battleOptions.querySelectorAll("[data-battle-option]");
        const option = options[Number(event.key) - 1];
        if (option) {
          event.preventDefault();
          option.click();
        }
        return;
      }
      // 对战时不要把键盘焦点送回遮罩后面的搜索框。
      if (event.key === "/") {
        return;
      }
    }

    if (event.key === "/" && !isTyping && !battleOpen && elements.randomModal.hidden) {
      event.preventDefault();
      elements.searchInput.focus();
    }
    if (event.key === "Escape" && !elements.randomModal.hidden) {
      closeRandomWord();
    }
  });

  createListNav();
  createPartOptions();
  render();
})();
