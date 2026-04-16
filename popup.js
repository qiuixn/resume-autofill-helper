(function () {
  const Core = window.ResumeAutofillCore;
  const CONTENT_SCRIPT_VERSION = "2026-04-16-05";

  const state = {
    profileStore: null
  };

  const elements = {
    profileSelect: document.getElementById("profileSelect"),
    smartFillBtn: document.getElementById("smartFillBtn"),
    openOptionsBtn: document.getElementById("openOptionsBtn"),
    status: document.getElementById("status"),
    totalFields: document.getElementById("totalFields"),
    matchedFields: document.getElementById("matchedFields"),
    resultTip: document.getElementById("resultTip"),
    resultsList: document.getElementById("resultsList")
  };

  function setStatus(message) {
    elements.status.textContent = message;
  }

  function renderProfiles() {
    elements.profileSelect.innerHTML = "";
    (state.profileStore?.profiles || []).forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.profileName;
      option.selected = profile.id === state.profileStore.activeProfileId;
      elements.profileSelect.appendChild(option);
    });
  }

  function renderResults(summary) {
    elements.totalFields.textContent = String(summary?.totalFields || 0);
    elements.matchedFields.textContent = String(summary?.matchedCount || 0);
    elements.resultTip.textContent = summary?.matchedCount ? "已执行" : "未命中";
    elements.resultsList.innerHTML = "";

    if (!summary?.matchedFields?.length) {
      elements.resultsList.classList.add("empty");
      const item = document.createElement("li");
      item.textContent = "没有识别到可自动填写的字段。可以先补全资料，或刷新页面后再试。";
      elements.resultsList.appendChild(item);
      return;
    }

    elements.resultsList.classList.remove("empty");
    summary.matchedFields.forEach((row) => {
      const item = document.createElement("li");
      const field = document.createElement("span");
      const match = document.createElement("span");
      field.className = "field";
      match.className = "match";
      field.textContent = row.fieldLabel;
      match.textContent = "匹配到：" + row.match.label + " -> " + row.match.value.slice(0, 48);
      item.appendChild(field);
      item.appendChild(match);
      elements.resultsList.appendChild(item);
    });
  }

  async function loadProfileStore() {
    const stored = await chrome.storage.local.get(Core.STORAGE_KEYS.profileStore);
    state.profileStore = Core.normalizeProfileStore(stored[Core.STORAGE_KEYS.profileStore]);
    renderProfiles();
  }

  async function persistActiveProfile() {
    state.profileStore.activeProfileId = elements.profileSelect.value;
    await chrome.storage.local.set({
      [Core.STORAGE_KEYS.profileStore]: state.profileStore
    });
  }

  function getSelectedProfile() {
    return Core.getProfileById(state.profileStore, elements.profileSelect.value) || Core.getActiveProfile(state.profileStore);
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  async function getContentScriptVersion(tabId) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__resumeAutofillContentVersion || null
    });
    return result?.result || null;
  }

  async function ensureContentScripts(tabId) {
    const currentVersion = await getContentScriptVersion(tabId);
    if (currentVersion === CONTENT_SCRIPT_VERSION) {
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["core.js", "content.js"]
    });
  }

  async function sendToTab(type) {
    const tab = await getActiveTab();
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
      throw new Error("请先切到招聘网站或在线表单页面。");
    }

    await ensureContentScripts(tab.id);

    return chrome.tabs.sendMessage(tab.id, {
      type,
      profile: getSelectedProfile()
    });
  }

  function openOptionsPage() {
    chrome.runtime.sendMessage({ type: "resume-autofill:open-options" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        chrome.runtime.openOptionsPage();
      }
    });
  }

  async function smartFillCurrentPage() {
    setStatus("正在智能识别并填写当前页面...");
    try {
      const response = await sendToTab("resume-autofill:smart-fill-v2");
      if (!response?.ok) {
        throw new Error("智能填写失败。");
      }
      renderResults(response.summary);
      setStatus("已完成智能填写，共填写 " + response.filledCount + " 个字段。");
    } catch (error) {
      renderResults(null);
      setStatus(error.message || "无法连接当前页面，请刷新页面后重试。");
    }
  }

  function bindEvents() {
    elements.profileSelect.addEventListener("change", persistActiveProfile);
    elements.smartFillBtn.addEventListener("click", smartFillCurrentPage);
    elements.openOptionsBtn.addEventListener("click", openOptionsPage);
  }

  async function init() {
    await loadProfileStore();
    bindEvents();
  }

  init();
})();
