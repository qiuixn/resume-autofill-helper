(function () {
  if (window.top !== window.self) {
    return;
  }

  const Core = window.ResumeAutofillCore;
  const CONTENT_VERSION = "2026-04-16-04";
  const HOST_ID = "resume-autofill-sidebar-host";

  if (!Core) {
    return;
  }

  window.__resumeAutofillContentVersion = CONTENT_VERSION;

  if (typeof window.__resumeAutofillCleanup === "function") {
    try {
      window.__resumeAutofillCleanup();
    } catch (error) {
      console.warn("[resume-autofill] cleanup failed", error);
    }
  }

  const state = {
    profileStore: Core.normalizeProfileStore(null),
    lastFields: [],
    lastSummary: null,
    manualEntry: null,
    manualEntries: [],
    manualGroups: [],
    manualGroupKey: "",
    panelOpen: false
  };

  const elements = {};

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeLabelText(value) {
    return compactText(value)
      .replace(/^[*\s]+/, "")
      .replace(/[：:]+$/g, "")
      .replace(/\s+/g, " ");
  }

  function truncate(value, maxLength) {
    const text = compactText(value);
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, Math.max(0, maxLength - 3)) + "...";
  }

  function isInsideSidebar(node) {
    const host = elements.host;
    if (!host || !node) {
      return false;
    }
    if (host === node || host.contains(node)) {
      return true;
    }
    return node.getRootNode?.() === host.shadowRoot;
  }

  function isDateLikeField(fieldMetaOrElement) {
    const element = fieldMetaOrElement?.element || fieldMetaOrElement;
    const source = compactText(
      [
        fieldMetaOrElement?.label,
        fieldMetaOrElement?.placeholder,
        fieldMetaOrElement?.name,
        fieldMetaOrElement?.id,
        fieldMetaOrElement?.sectionHint,
        element?.getAttribute?.("aria-label"),
        element?.getAttribute?.("placeholder"),
        element?.getAttribute?.("name"),
        element?.id,
        element?.type
      ].join(" ")
    );

    return /日期|时间|生日|出生|date|time|birthday|month/.test(source) || String(element?.type || "").toLowerCase() === "date";
  }

  function normalizeDateValue(value) {
    const text = compactText(value)
      .replace(/年/g, "-")
      .replace(/月/g, "-")
      .replace(/日/g, "")
      .replace(/\//g, "-")
      .replace(/\./g, "-");

    const full = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s.*)?$/);
    if (full) {
      return [full[1], full[2].padStart(2, "0"), full[3].padStart(2, "0")].join("-");
    }

    const month = text.match(/^(\d{4})-(\d{1,2})$/);
    if (month) {
      return [month[1], month[2].padStart(2, "0")].join("-");
    }

    return text;
  }

  function isVisibleField(element) {
    if (!element || element.hidden || element.disabled || isInsideSidebar(element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    return element.getClientRects().length > 0 || element.isContentEditable;
  }

  function collectText(texts, value) {
    const text = normalizeLabelText(value);
    if (!text || text.length > 42) {
      return;
    }
    texts.add(text);
  }

  function collectNodeText(texts, node) {
    if (!node) {
      return;
    }
    if (node.matches?.("input, select, textarea, option")) {
      return;
    }
    if (node.querySelector?.("input, select, textarea, [contenteditable='true']")) {
      return;
    }
    collectText(texts, node.textContent);
  }

  function collectLabelTexts(element) {
    const texts = new Set();

    collectText(texts, element.getAttribute("aria-label"));
    collectText(texts, element.getAttribute("placeholder"));
    collectText(texts, element.getAttribute("name"));
    collectText(texts, element.id);

    if (element.id) {
      document.querySelectorAll("label[for='" + CSS.escape(element.id) + "']").forEach((label) => collectText(texts, label.textContent));
    }

    Array.from(element.labels || []).forEach((label) => collectText(texts, label.textContent));

    const wrappedLabel = element.closest("label");
    if (wrappedLabel) {
      collectText(texts, wrappedLabel.textContent);
    }

    let current = element;
    for (let depth = 0; current && depth < 4; depth += 1) {
      const parent = current.parentElement;
      if (!parent) {
        break;
      }

      Array.from(parent.children).forEach((child) => {
        if (child === current || child.contains(current)) {
          return;
        }
        collectNodeText(texts, child);
      });

      collectNodeText(texts, current.previousElementSibling);
      collectNodeText(texts, current.nextElementSibling);
      current = parent;
    }

    return Array.from(texts);
  }

  function collectSectionHint(element) {
    let current = element.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const directChildren = Array.from(current.children || []);
      const heading = directChildren.find((child) => /^H[1-6]$/.test(child.tagName) || child.matches?.("legend, .title, .section-title, .form-title"));
      if (heading) {
        const text = normalizeLabelText(heading.textContent);
        if (text && text.length <= 30) {
          return text;
        }
      }

      let sibling = current.previousElementSibling;
      let checked = 0;
      while (sibling && checked < 3) {
        const text = normalizeLabelText(sibling.textContent);
        if (text && text.length <= 30) {
          return text;
        }
        sibling = sibling.previousElementSibling;
        checked += 1;
      }

      current = current.parentElement;
    }

    return "";
  }

  function buildFieldMeta(element) {
    const labels = collectLabelTexts(element);
    const type = String(element.type || "").toLowerCase();

    return {
      element,
      tagName: element.tagName,
      type,
      label: labels[0] || "",
      optionText: type === "radio" || type === "checkbox" ? labels.join(" ") : "",
      placeholder: element.getAttribute("placeholder") || "",
      name: element.getAttribute("name") || "",
      id: element.id || "",
      sectionHint: collectSectionHint(element),
      isContentEditable: Boolean(element.isContentEditable)
    };
  }

  function collectFields() {
    const fields = [];
    const nodes = document.querySelectorAll("input, select, textarea, [contenteditable='true']");

    nodes.forEach((element) => {
      if (!isVisibleField(element)) {
        return;
      }

      const tagName = element.tagName;
      const type = String(element.type || "").toLowerCase();

      if (tagName === "INPUT" && /^(hidden|password|file|button|submit|reset|image|range|color)$/i.test(type)) {
        return;
      }

      if (element.readOnly && !isDateLikeField(element)) {
        return;
      }

      const fieldMeta = buildFieldMeta(element);
      const hasSignal = Boolean(
        fieldMeta.label ||
          fieldMeta.placeholder ||
          fieldMeta.name ||
          fieldMeta.id ||
          fieldMeta.optionText ||
          isDateLikeField(fieldMeta)
      );

      if (hasSignal) {
        fields.push(fieldMeta);
      }
    });

    return fields;
  }

  function getSelectedProfile() {
    return Core.getProfileById(state.profileStore, elements.profileSelect?.value) || Core.getActiveProfile(state.profileStore);
  }

  function renderProfileOptions() {
    if (!elements.profileSelect) {
      return;
    }

    elements.profileSelect.innerHTML = "";
    state.profileStore.profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.profileName;
      option.selected = profile.id === state.profileStore.activeProfileId;
      elements.profileSelect.appendChild(option);
    });
  }

  function renderProfileSummary() {
    if (!elements.profileMeta) {
      return;
    }

    const profile = getSelectedProfile();
    const chips = [];
    if (profile.targetPosition) {
      chips.push("目标: " + truncate(profile.targetPosition, 24));
    }
    if (profile.workYears) {
      chips.push("经验: " + truncate(profile.workYears, 10));
    }
    if (profile.phone) {
      chips.push("电话: " + truncate(profile.phone, 16));
    }

    if (!chips.length) {
      chips.push("当前简历已加载，可以直接开始填写。");
    }

    elements.profileMeta.innerHTML = "";
    chips.forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "meta-chip";
      chip.textContent = text;
      elements.profileMeta.appendChild(chip);
    });
  }

  function renderResults(summary) {
    const safeSummary = summary || { totalFields: 0, matchedCount: 0, matchedFields: [] };
    elements.totalFields.textContent = String(safeSummary.totalFields || 0);
    elements.matchedFields.textContent = String(safeSummary.matchedCount || 0);
    elements.resultTip.textContent = safeSummary.matchedCount ? "已命中" : "未命中";
    elements.resultsList.innerHTML = "";

    const rows = safeSummary.matchedFields?.length ? safeSummary.matchedFields.slice(0, 12) : [];
    if (!rows.length) {
      const item = document.createElement("li");
      item.className = "empty";
      item.textContent = "没有识别到可自动填写的字段。可以先补全资料，或刷新页面后重新扫描。";
      elements.resultsList.appendChild(item);
      return;
    }

    rows.forEach((row) => {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      const desc = document.createElement("span");
      title.textContent = row.fieldLabel;
      desc.textContent = row.match.label + " -> " + truncate(row.match.value, 40);
      item.appendChild(title);
      item.appendChild(desc);
      elements.resultsList.appendChild(item);
    });
  }

  function buildManualGroups(entries) {
    const groups = [];
    const groupMap = new Map();

    entries.forEach((entry, index) => {
      const groupKey = entry.sectionKey || entry.sectionTitle || "custom";
      if (!groupMap.has(groupKey)) {
        const group = {
          key: groupKey,
          title: entry.sectionTitle || "其他字段",
          rows: []
        };
        groupMap.set(groupKey, group);
        groups.push(group);
      }

      groupMap.get(groupKey).rows.push({ entry, index });
    });

    return groups;
  }

  function getActiveManualGroup(groups) {
    if (!groups.length) {
      state.manualGroupKey = "";
      return null;
    }

    const existing = groups.find((group) => group.key === state.manualGroupKey);
    if (existing) {
      return existing;
    }

    state.manualGroupKey = groups[0].key;
    return groups[0];
  }

  function renderManualEntries() {
    state.manualEntries = Core.getProfileEntries(getSelectedProfile()).filter((entry) => compactText(entry.value));
    state.manualGroups = buildManualGroups(state.manualEntries);

    if (!state.manualEntries.length) {
      elements.manualList.innerHTML = '<div class="manual-empty">当前简历还没有可复制内容。请先打开设置页填写资料，或导入自己的 JSON。</div>';
      elements.manualNav.innerHTML = "";
      return;
    }

    const activeGroup = getActiveManualGroup(state.manualGroups);

    elements.manualNav.innerHTML = "";
    state.manualGroups.forEach((group) => {
      const button = document.createElement("button");
      const label = document.createElement("span");
      const count = document.createElement("strong");
      button.type = "button";
      button.className = "manual-nav-btn" + (group.key === activeGroup?.key ? " active" : "");
      button.dataset.manualGroupKey = group.key;
      label.textContent = group.title;
      count.textContent = String(group.rows.length);
      button.appendChild(label);
      button.appendChild(count);
      elements.manualNav.appendChild(button);
    });

    elements.manualList.innerHTML = "";
    if (!activeGroup) {
      return;
    }

    const section = document.createElement("section");
    section.className = "manual-group";

    const heading = document.createElement("div");
    heading.className = "manual-group-title";
    heading.textContent = activeGroup.title + " (" + activeGroup.rows.length + ")";
    section.appendChild(heading);

    const chips = document.createElement("div");
    chips.className = "manual-chips";
    activeGroup.rows.forEach(({ entry, index }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "manual-chip";
      button.dataset.entryIndex = String(index);
      button.title = entry.label + ": " + entry.value;
      button.textContent = entry.label + ": " + truncate(entry.value, 18);
      chips.appendChild(button);
    });

    section.appendChild(chips);
    elements.manualList.appendChild(section);
  }

  function setStatus(message, tone) {
    if (!elements.status) {
      return;
    }
    elements.status.textContent = message || "";
    elements.status.dataset.tone = tone || "neutral";
  }

  function showToast(message) {
    if (!elements.toast) {
      return;
    }
    elements.toast.textContent = message;
    elements.toast.dataset.visible = "true";
    clearTimeout(showToast.timerId);
    showToast.timerId = window.setTimeout(() => {
      elements.toast.dataset.visible = "false";
    }, 2200);
  }

  async function loadProfileStore() {
    const stored = await chrome.storage.local.get(Core.STORAGE_KEYS.profileStore);
    state.profileStore = Core.normalizeProfileStore(stored[Core.STORAGE_KEYS.profileStore]);
  }

  async function persistActiveProfile() {
    state.profileStore.activeProfileId = elements.profileSelect.value;
    await chrome.storage.local.set({
      [Core.STORAGE_KEYS.profileStore]: state.profileStore
    });
    renderProfileSummary();
    renderManualEntries();
    await scanCurrentPage(false);
  }

  async function scanCurrentPage(announce) {
    const fields = collectFields();
    const summary = Core.summarizeMatches(fields, getSelectedProfile());
    state.lastFields = fields;
    state.lastSummary = summary;
    renderResults(summary);

    if (announce !== false) {
      setStatus(
        summary.matchedCount
          ? "扫描完成，识别到 " + summary.matchedCount + " 个可填写字段。"
          : "扫描完成，但当前页面还没有匹配到可填写字段。",
        summary.matchedCount ? "success" : "warn"
      );
    }

    return summary;
  }

  async function smartFillCurrentPage() {
    const fields = collectFields();
    const matches = Core.matchFields(fields, getSelectedProfile());
    let filledCount = 0;

    matches.forEach(({ field, match }) => {
      if (!match) {
        return;
      }
      const value = isDateLikeField(field) ? normalizeDateValue(match.value) : match.value;
      if (Core.fillElement(field, value)) {
        filledCount += 1;
      }
    });

    const summary = Core.summarizeMatches(fields, getSelectedProfile());
    state.lastFields = fields;
    state.lastSummary = summary;
    renderResults(summary);

    setStatus(
      filledCount
        ? "已智能填写 " + filledCount + " 个字段。"
        : "扫描到了 " + summary.totalFields + " 个字段，但没有成功填入内容。",
      filledCount ? "success" : "warn"
    );

    if (filledCount) {
      showToast("已完成智能填写");
    }

    return { ok: true, filledCount, summary };
  }

  function scrollToManualSection() {
    if (!state.panelOpen) {
      state.panelOpen = true;
      elements.panel.dataset.open = "true";
    }
    elements.manualSection?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async function armManualEntry(index) {
    const entry = state.manualEntries[index];
    if (!entry) {
      return;
    }

    state.manualEntry = entry;
    elements.manualHint.textContent = "已复制「" + entry.label + "」，请点击页面上的目标输入框。";
    elements.cancelManualBtn.hidden = false;
    setStatus("点选模式已开启，下一次点击页面字段时会直接填入。", "success");

    try {
      await navigator.clipboard.writeText(entry.value);
      showToast("已复制: " + truncate(entry.value, 18));
    } catch (error) {
      showToast("已进入点选填入模式");
    }
  }

  function cancelManualFill() {
    state.manualEntry = null;
    elements.manualHint.textContent = "点击下方任意字段，先复制，再点页面中的输入框即可填入。";
    elements.cancelManualBtn.hidden = true;
  }

  function findFillTarget(node) {
    if (!node) {
      return null;
    }
    if (node.matches?.("input, select, textarea, [contenteditable='true']")) {
      return node;
    }
    if (node.control) {
      return node.control;
    }
    const target = node.closest?.("input, select, textarea, [contenteditable='true'], label");
    return target?.matches?.("label") ? target.control || null : target || null;
  }

  function onDocumentClick(event) {
    if (!state.manualEntry || isInsideSidebar(event.target)) {
      return;
    }

    const element = findFillTarget(event.target);
    if (!element || isInsideSidebar(element)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const fieldMeta = buildFieldMeta(element);
    const value = isDateLikeField(fieldMeta) ? normalizeDateValue(state.manualEntry.value) : state.manualEntry.value;

    if (Core.fillElement(fieldMeta, value)) {
      showToast("已填入: " + state.manualEntry.label);
      setStatus("已通过点选模式填入「" + state.manualEntry.label + "」。", "success");
    } else {
      showToast("这个位置暂时无法填入");
      setStatus("目标字段暂时不支持自动填入，请换一个输入框试试。", "warn");
    }

    cancelManualFill();
  }

  function onMessage(message, sender, sendResponse) {
    if (!message?.type) {
      return undefined;
    }

    if (message.profile) {
      const nextStore = Core.deepClone(state.profileStore);
      const index = nextStore.profiles.findIndex((item) => item.id === message.profile.id);
      if (index >= 0) {
        nextStore.profiles[index] = message.profile;
      } else {
        nextStore.profiles.push(message.profile);
      }
      nextStore.activeProfileId = message.profile.id;
      state.profileStore = Core.normalizeProfileStore(nextStore);
      renderProfileOptions();
      renderProfileSummary();
      renderManualEntries();
    }

    if (message.type === "resume-autofill:scan" || message.type === "resume-autofill:scan-v2") {
      scanCurrentPage(true).then((summary) => sendResponse({ ok: true, summary }));
      return true;
    }

    if (message.type === "resume-autofill:smart-fill" || message.type === "resume-autofill:smart-fill-v2") {
      smartFillCurrentPage().then(sendResponse);
      return true;
    }

    return undefined;
  }

  function createSidebar() {
    document.getElementById(HOST_ID)?.remove();

    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .root { position: fixed; right: 18px; bottom: 18px; z-index: 2147483646; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #162033; }
        .launcher { width: 52px; height: 52px; border: 0; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; font-size: 26px; box-shadow: 0 18px 36px rgba(37, 99, 235, 0.28); cursor: pointer; }
        .panel { position: absolute; right: 0; bottom: 68px; width: 388px; max-height: 78vh; overflow: auto; padding: 18px; border: 1px solid rgba(210, 220, 235, 0.95); border-radius: 24px; background: rgba(255, 255, 255, 0.97); box-shadow: 0 30px 60px rgba(15, 23, 42, 0.18); backdrop-filter: blur(12px); }
        .panel[data-open="false"] { display: none; }
        .header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .badge { display: inline-flex; padding: 4px 10px; border-radius: 999px; background: #e1f5f2; color: #0f766e; font-size: 12px; font-weight: 700; }
        .title { margin: 8px 0 6px; font-size: 18px; font-weight: 800; }
        .desc { margin: 0; color: #5f718b; font-size: 13px; line-height: 1.6; }
        .icon-btn, .action, .manual-chip, select { border: 1px solid #d7e2ef; border-radius: 14px; font: inherit; }
        .icon-btn { width: 38px; height: 38px; background: #fff; cursor: pointer; }
        .label { display: block; margin: 0 0 8px; font-size: 13px; font-weight: 700; }
        select { width: 100%; height: 44px; padding: 0 12px; background: #fff; margin-bottom: 10px; }
        .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .meta-chip { padding: 7px 10px; border-radius: 999px; background: #eff6ff; color: #325582; font-size: 12px; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
        .action { min-height: 44px; padding: 0 12px; background: #fff; cursor: pointer; }
        .action.primary { background: #0f766e; border-color: transparent; color: #fff; font-weight: 700; grid-column: 1 / -1; }
        .status { padding: 12px 14px; border-radius: 16px; background: #f8fbff; border: 1px solid #d7e2ef; color: #5f718b; font-size: 13px; line-height: 1.6; }
        .status[data-tone="success"] { background: #e9f8f2; border-color: #b8e4cf; color: #116149; }
        .status[data-tone="warn"] { background: #fff6ea; border-color: #f1d2a7; color: #a75412; }
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
        .stat { padding: 12px; border-radius: 18px; background: #f8fafc; border: 1px solid #d7e2ef; }
        .stat span { display: block; color: #6b7a90; font-size: 12px; }
        .stat strong { display: block; margin-top: 6px; font-size: 22px; }
        .section { margin-top: 14px; }
        .section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; }
        .section-title { font-size: 16px; font-weight: 800; }
        .section-tip { color: #6b7a90; font-size: 12px; }
        .results { display: grid; gap: 8px; margin: 0; padding: 0; }
        .results li { list-style: none; padding: 10px 12px; border-radius: 14px; background: #fbfdff; border: 1px solid #d7e2ef; }
        .results strong { display: block; font-size: 13px; }
        .results span { display: block; margin-top: 4px; color: #5f718b; font-size: 12px; }
        .results .empty { color: #5f718b; }
        .manual-bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
        .manual-hint { color: #5f718b; font-size: 12px; line-height: 1.6; }
        .manual-layout { display: grid; grid-template-columns: 98px minmax(0, 1fr); gap: 10px; align-items: start; }
        .manual-nav { display: grid; gap: 8px; max-height: 330px; overflow: auto; padding-right: 2px; }
        .manual-nav-btn { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; min-height: 36px; padding: 7px 8px; border: 1px solid #d7e2ef; border-radius: 12px; background: #fff; color: #476078; cursor: pointer; font-size: 12px; text-align: left; }
        .manual-nav-btn span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .manual-nav-btn strong { flex: none; min-width: 22px; padding: 2px 5px; border-radius: 999px; background: #eef6ff; color: #235296; text-align: center; font-size: 11px; }
        .manual-nav-btn.active { background: #0f766e; border-color: #0f766e; color: #fff; }
        .manual-nav-btn.active strong { background: rgba(255, 255, 255, 0.2); color: #fff; }
        .manual-list { display: grid; gap: 10px; max-height: 330px; overflow: auto; padding-right: 2px; }
        .manual-group { padding: 12px; border-radius: 18px; border: 1px solid #d7e2ef; background: #fcfdff; }
        .manual-group-title { margin-bottom: 8px; font-size: 13px; font-weight: 800; }
        .manual-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .manual-chip { padding: 8px 10px; background: #eef6ff; color: #235296; cursor: pointer; font-size: 12px; }
        .manual-chip:hover { background: #dfeeff; }
        .manual-empty { padding: 12px 14px; border-radius: 16px; background: #f8fbff; border: 1px solid #d7e2ef; color: #5f718b; font-size: 12px; line-height: 1.7; }
        .toast { position: fixed; right: 26px; bottom: 86px; padding: 12px 16px; border-radius: 16px; background: rgba(74, 36, 10, 0.92); color: #fff; font-size: 13px; opacity: 0; transform: translateY(10px); transition: opacity 0.18s ease, transform 0.18s ease; pointer-events: none; }
        .toast[data-visible="true"] { opacity: 1; transform: translateY(0); }
      </style>
      <div class="root">
        <div class="panel" data-open="false">
          <div class="header">
            <div>
              <span class="badge">页面侧边栏</span>
              <div class="title">简历自动填写助手</div>
              <p class="desc">支持智能扫描和"复制 + 点选填入"，不打开扩展弹窗也能直接使用。</p>
            </div>
            <button class="icon-btn" id="closeBtn" type="button">x</button>
          </div>
          <label class="label" for="profileSelect">当前简历</label>
          <select id="profileSelect"></select>
          <div class="meta" id="profileMeta"></div>
          <div class="actions">
            <button class="action primary" id="smartFillBtn" type="button">智能填写</button>
            <button class="action" id="scanBtn" type="button">重新扫描</button>
            <button class="action" id="manualBtn" type="button">复制点选</button>
            <button class="action" id="openOptionsBtn" type="button">打开设置页</button>
          </div>
          <div class="status" id="status">正在准备侧边栏和扫描器...</div>
          <div class="stats">
            <div class="stat"><span>页面字段</span><strong id="totalFields">0</strong></div>
            <div class="stat"><span>已匹配字段</span><strong id="matchedFields">0</strong></div>
          </div>
          <section class="section">
            <div class="section-head">
              <div class="section-title">识别结果</div>
              <div class="section-tip" id="resultTip">未扫描</div>
            </div>
            <ul class="results" id="resultsList"></ul>
          </section>
          <section class="section" id="manualSection">
            <div class="section-head">
              <div class="section-title">复制 + 点选填入</div>
              <div class="section-tip">先复制，再点页面字段</div>
            </div>
            <div class="manual-bar">
              <div class="manual-hint" id="manualHint">点击下方任意字段，先复制，再点页面中的输入框即可填入。</div>
              <button class="action" id="cancelManualBtn" type="button" hidden>取消点选</button>
            </div>
            <div class="manual-layout">
              <nav class="manual-nav" id="manualNav" aria-label="manual fill sections"></nav>
              <div class="manual-list" id="manualList"></div>
            </div>
          </section>
        </div>
        <button class="launcher" id="launcher" type="button">⚡</button>
        <div class="toast" id="toast" data-visible="false"></div>
      </div>
    `;

    document.documentElement.appendChild(host);
    elements.host = host;
    elements.shadow = shadow;
    elements.panel = shadow.querySelector(".panel");
    elements.launcher = shadow.getElementById("launcher");
    elements.closeBtn = shadow.getElementById("closeBtn");
    elements.profileSelect = shadow.getElementById("profileSelect");
    elements.profileMeta = shadow.getElementById("profileMeta");
    elements.smartFillBtn = shadow.getElementById("smartFillBtn");
    elements.scanBtn = shadow.getElementById("scanBtn");
    elements.manualBtn = shadow.getElementById("manualBtn");
    elements.openOptionsBtn = shadow.getElementById("openOptionsBtn");
    elements.status = shadow.getElementById("status");
    elements.totalFields = shadow.getElementById("totalFields");
    elements.matchedFields = shadow.getElementById("matchedFields");
    elements.resultTip = shadow.getElementById("resultTip");
    elements.resultsList = shadow.getElementById("resultsList");
    elements.manualSection = shadow.getElementById("manualSection");
    elements.manualHint = shadow.getElementById("manualHint");
    elements.cancelManualBtn = shadow.getElementById("cancelManualBtn");
    elements.manualNav = shadow.getElementById("manualNav");
    elements.manualList = shadow.getElementById("manualList");
    elements.toast = shadow.getElementById("toast");
  }

  function openOptionsPage() {
    chrome.runtime.sendMessage({ type: "resume-autofill:open-options" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        window.open(chrome.runtime.getURL("options.html"), "_blank");
      }
    });
  }

  function bindEvents() {
    elements.launcher.addEventListener("click", () => {
      state.panelOpen = !state.panelOpen;
      elements.panel.dataset.open = String(state.panelOpen);
    });

    elements.closeBtn.addEventListener("click", () => {
      state.panelOpen = false;
      elements.panel.dataset.open = "false";
    });

    elements.profileSelect.addEventListener("change", persistActiveProfile);
    elements.smartFillBtn.addEventListener("click", smartFillCurrentPage);
    elements.scanBtn.addEventListener("click", () => scanCurrentPage(true));
    elements.manualBtn.addEventListener("click", scrollToManualSection);
    elements.openOptionsBtn.addEventListener("click", openOptionsPage);
    elements.cancelManualBtn.addEventListener("click", cancelManualFill);
    elements.manualList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-entry-index]");
      if (button) {
        armManualEntry(Number(button.dataset.entryIndex));
      }
    });
    elements.manualNav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-manual-group-key]");
      if (!button) {
        return;
      }
      state.manualGroupKey = button.dataset.manualGroupKey;
      renderManualEntries();
    });

    document.addEventListener("click", onDocumentClick, true);

    if (window.__resumeAutofillMessageHandler) {
      chrome.runtime.onMessage.removeListener(window.__resumeAutofillMessageHandler);
    }
    window.__resumeAutofillMessageHandler = onMessage;
    chrome.runtime.onMessage.addListener(onMessage);
  }

  async function init() {
    await loadProfileStore();
    createSidebar();
    renderProfileOptions();
    renderProfileSummary();
    renderManualEntries();
    bindEvents();
    setStatus("侧边栏已就绪，正在扫描当前页面字段...");
    await scanCurrentPage(false);
    setStatus("可以直接智能填写，也可以用“复制 + 点选填入”。");
    window.addEventListener("load", () => scanCurrentPage(false), { once: true });
    window.setTimeout(() => scanCurrentPage(false), 1200);
  }

  window.__resumeAutofillCleanup = function () {
    document.removeEventListener("click", onDocumentClick, true);
    if (window.__resumeAutofillMessageHandler) {
      chrome.runtime.onMessage.removeListener(window.__resumeAutofillMessageHandler);
      window.__resumeAutofillMessageHandler = null;
    }
    document.getElementById(HOST_ID)?.remove();
  };

  init();
})();
