(() => {
  "use strict";

  const rawWords = Array.isArray(window.CET4_WORDS) ? window.CET4_WORDS : [];
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
    hideMeaning: false,
    visibleLimit: initialLimit,
  };

  const elements = {
    listNav: document.querySelector("#listNav"),
    searchInput: document.querySelector("#searchInput"),
    clearSearch: document.querySelector("#clearSearch"),
    partFilter: document.querySelector("#partFilter"),
    favoriteFilter: document.querySelector("#favoriteFilter"),
    favoriteCount: document.querySelector("#favoriteCount"),
    meaningToggle: document.querySelector("#meaningToggle"),
    resetFilters: document.querySelector("#resetFilters"),
    viewEyebrow: document.querySelector("#viewEyebrow"),
    viewTitle: document.querySelector("#viewTitle"),
    resultCount: document.querySelector("#resultCount"),
    wordList: document.querySelector("#wordList"),
    emptyState: document.querySelector("#emptyState"),
    emptyReset: document.querySelector("#emptyReset"),
    loadMoreWrap: document.querySelector("#loadMoreWrap"),
    loadMore: document.querySelector("#loadMore"),
  };

  const favorites = loadFavorites();
  const fragment = document.createDocumentFragment();

  function loadFavorites() {
    try {
      const stored = JSON.parse(localStorage.getItem("cet4-favorites") || "[]");
      return new Set(Array.isArray(stored) ? stored : []);
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem("cet4-favorites", JSON.stringify([...favorites]));
    } catch {
      // Browsing remains available if storage is disabled.
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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

  function renderWordRow(word, previousWord) {
    const isFavorite = favorites.has(word.id);
    const order = state.selectedList === "all" ? word.globalNumber : word.number;
    const startsNewList =
      state.selectedList === "all" && previousWord && word.list !== previousWord.list;
    const meaningHidden = state.hideMeaning;

    const row = document.createElement("li");
    row.className = "word-row";
    row.dataset.wordId = word.id;
    row.classList.toggle("is-new-list", Boolean(startsNewList));
    row.classList.toggle("meaning-hidden", meaningHidden);
    row.innerHTML = `
      <span class="word-order">${order}</span>
      <span class="word-name">${escapeHtml(word.word)}</span>
      <span class="part-badge ${partClass(word.partKeys)}">${escapeHtml(word.part)}</span>
      <span class="meaning">
        <span class="meaning-text">${escapeHtml(word.meaning)}</span>
        <span class="meaning-reveal-note">点击查看释义</span>
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
      fragment.append(renderWordRow(word, visibleWords[index - 1]));
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
    elements.meaningToggle.setAttribute(
      "aria-pressed",
      state.hideMeaning ? "true" : "false",
    );
    elements.meaningToggle.title = state.hideMeaning ? "显示中文释义" : "隐藏中文释义";
    elements.clearSearch.hidden = !state.query;

    updateHeading(filteredWords.length);
    updateListNav();
  }

  function resetFilterState() {
    state.selectedList = "all";
    state.query = "";
    state.part = "all";
    state.favoritesOnly = false;
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
    state.selectedList = button.dataset.list === "all" ? "all" : Number(button.dataset.list);
    state.visibleLimit = initialLimit;
    render();
  });

  elements.searchInput.addEventListener("input", (event) => {
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

  elements.wordList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="favorite"]');
    const row = event.target.closest(".word-row");
    if (!row) {
      return;
    }
    const word = words.find((item) => item.id === row.dataset.wordId);
    if (!word) {
      return;
    }

    if (button) {
      if (favorites.has(word.id)) {
        favorites.delete(word.id);
      } else {
        favorites.add(word.id);
      }
      saveFavorites();
      render();
      return;
    }

    if (state.hideMeaning) {
      row.classList.toggle("meaning-revealed");
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
