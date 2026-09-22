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

  function normalizePartKeys(part) {
    const keys = new Set();
    String(part)
      .toLowerCase()
      .split("/")
      .map((item) => item.trim())
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

  const listSummaries = Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    const listWords = words.filter((word) => word.list === number);
    return {
      number,
      count: listWords.length,
      start: (number - 1) * 100 + 1,
      end: number * 100,
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
        <span class="nav-range">完整 1000 词</span>
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

  function updateHeading(filteredCount) {
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
  }

  function render() {
    const filteredWords = getFilteredWords();
    const visibleWords = filteredWords.slice(0, state.visibleLimit);
    fragment.replaceChildren();

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

    updateHeading(filteredWords.length);
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

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      elements.searchInput.focus();
    }
  });

  createListNav();
  createPartOptions();
  render();
})();
