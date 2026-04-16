(function () {
  const Core = window.ResumeAutofillCore;
  const state = {
    persistedStore: null,
    draftStore: null,
    dirty: false
  };

  const refs = {
    form: document.getElementById("profileForm"),
    formSections: document.getElementById("formSections"),
    profileSelect: document.getElementById("profileSelect"),
    resetBtn: document.getElementById("resetBtn"),
    newProfileBtn: document.getElementById("newProfileBtn"),
    duplicateProfileBtn: document.getElementById("duplicateProfileBtn"),
    deleteProfileBtn: document.getElementById("deleteProfileBtn"),
    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    importInput: document.getElementById("importInput"),
    saveStatus: document.getElementById("saveStatus")
  };

  function setStatus(message) {
    refs.saveStatus.textContent = message;
  }

  function refreshDirtyFlag() {
    state.dirty = JSON.stringify(state.draftStore) !== JSON.stringify(state.persistedStore);
    return state.dirty;
  }

  function markDirty(message) {
    state.dirty = true;
    if (message) {
      setStatus(message);
    }
  }

  function getSelectedProfile(store = state.draftStore) {
    return Core.getProfileById(store, store?.activeProfileId) || Core.getActiveProfile(store);
  }

  function getSavedSelectedProfile() {
    return Core.getProfileById(state.persistedStore, state.draftStore?.activeProfileId);
  }

  function createFieldControl(field, value, extraDataset) {
    const wrapper = document.createElement("label");
    wrapper.className = "form-field span-" + (field.span || 12);

    const label = document.createElement("span");
    label.textContent = field.label;
    wrapper.appendChild(label);

    const control = field.input === "textarea" ? document.createElement("textarea") : document.createElement("input");
    if (field.input !== "textarea") {
      control.type = field.input || "text";
    } else {
      control.rows = field.rows || 4;
    }

    control.value = value || "";
    control.placeholder = field.placeholder || "";
    control.dataset.fieldKey = field.key;

    Object.entries(extraDataset || {}).forEach(([key, datasetValue]) => {
      control.dataset[key] = String(datasetValue);
    });

    wrapper.appendChild(control);
    return wrapper;
  }

  function renderScalarSection(section, profile) {
    const card = document.createElement("section");
    card.className = "schema-card";

    const header = document.createElement("div");
    header.className = "section-head";
    header.innerHTML = "<div><h2>" + section.title + "</h2><p>" + (section.description || "") + "</p></div>";
    card.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "schema-grid";

    section.fields.forEach((field) => {
      grid.appendChild(createFieldControl(field, profile?.[field.key], { scope: "scalar" }));
    });

    card.appendChild(grid);
    return card;
  }

  function renderRepeatableItem(section, item, index) {
    const card = document.createElement("article");
    card.className = "record-card";

    const header = document.createElement("div");
    header.className = "record-head";
    header.innerHTML =
      '<div><strong>第 ' +
      (index + 1) +
      " 条 " +
      section.itemTitle +
      "</strong><p>" +
      Core.summarizeSectionItem(section, item, index) +
      "</p></div>";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "danger ghost-inline";
    removeBtn.textContent = "删除";
    removeBtn.dataset.action = "remove-item";
    removeBtn.dataset.sectionKey = section.key;
    removeBtn.dataset.itemIndex = String(index);
    header.appendChild(removeBtn);
    card.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "schema-grid";

    section.fields
      .filter((field) => field.render !== false)
      .forEach((field) => {
        grid.appendChild(
          createFieldControl(field, item?.[field.key], {
            scope: "repeatable",
            sectionKey: section.key,
            itemIndex: index
          })
        );
      });

    card.appendChild(grid);
    return card;
  }

  function renderRepeatableSection(section, profile) {
    const card = document.createElement("section");
    card.className = "schema-card";

    const header = document.createElement("div");
    header.className = "section-head";
    header.innerHTML =
      "<div><h2>" +
      section.title +
      "</h2><p>" +
      (section.description || "") +
      "</p></div>";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "ghost-inline";
    addBtn.textContent = section.addLabel || "新增";
    addBtn.dataset.action = "add-item";
    addBtn.dataset.sectionKey = section.key;
    header.appendChild(addBtn);
    card.appendChild(header);

    const items = Array.isArray(profile?.[section.key]) ? profile[section.key] : [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-records";
      empty.textContent = section.emptyMessage || "当前还没有内容。";
      card.appendChild(empty);
      return card;
    }

    const list = document.createElement("div");
    list.className = "records-list";
    items.forEach((item, index) => {
      list.appendChild(renderRepeatableItem(section, item, index));
    });
    card.appendChild(list);

    return card;
  }

  function renderProfileList() {
    refs.profileSelect.innerHTML = "";
    (state.draftStore?.profiles || []).forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.profileName;
      option.selected = profile.id === state.draftStore.activeProfileId;
      refs.profileSelect.appendChild(option);
    });
  }

  function renderForm(profile) {
    refs.formSections.innerHTML = "";
    Core.PROFILE_FORM_SECTIONS.forEach((section) => {
      refs.formSections.appendChild(renderScalarSection(section, profile));
    });
    Core.REPEATABLE_SECTIONS.forEach((section) => {
      refs.formSections.appendChild(renderRepeatableSection(section, profile));
    });
  }

  function syncDraftFromForm() {
    if (!state.draftStore) {
      return;
    }

    const profile = getSelectedProfile();
    if (!profile) {
      return;
    }

    Core.PROFILE_FORM_SECTIONS.forEach((section) => {
      section.fields.forEach((field) => {
        const control = refs.form.querySelector(
          '[data-scope="scalar"][data-field-key="' + field.key + '"]'
        );
        profile[field.key] = control ? control.value : profile[field.key];
      });
    });

    Core.REPEATABLE_SECTIONS.forEach((section) => {
      const items = Array.isArray(profile[section.key]) ? profile[section.key] : [];
      profile[section.key] = items.map((item, index) => {
        const nextItem = Core.createEmptySectionItem(section, item);
        section.fields
          .filter((field) => field.render !== false)
          .forEach((field) => {
            const selector =
              '[data-scope="repeatable"][data-section-key="' +
              section.key +
              '"][data-item-index="' +
              index +
              '"][data-field-key="' +
              field.key +
              '"]';
            const control = refs.form.querySelector(selector);
            nextItem[field.key] = control ? control.value : nextItem[field.key];
          });
        return nextItem;
      });
    });

    state.draftStore = Core.normalizeProfileStore(state.draftStore);
    refreshDirtyFlag();
  }

  async function loadProfileStore() {
    const stored = await chrome.storage.local.get(Core.STORAGE_KEYS.profileStore);
    const normalized = Core.normalizeProfileStore(stored[Core.STORAGE_KEYS.profileStore]);
    state.persistedStore = Core.deepClone(normalized);
    state.draftStore = Core.deepClone(normalized);
    state.dirty = false;
    renderProfileList();
    renderForm(getSelectedProfile());
  }

  async function persistDraftStore() {
    syncDraftFromForm();
    state.draftStore = Core.normalizeProfileStore(state.draftStore);
    await chrome.storage.local.set({
      [Core.STORAGE_KEYS.profileStore]: state.draftStore
    });
    state.persistedStore = Core.deepClone(state.draftStore);
    state.dirty = false;
    renderProfileList();
    renderForm(getSelectedProfile());
    setStatus("当前简历已保存。");
  }

  function exportProfiles() {
    syncDraftFromForm();
    const blob = new Blob([JSON.stringify(state.draftStore, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "resume-autofill-profiles.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("已导出 JSON。");
  }

  async function importProfiles(file) {
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    const normalized = Array.isArray(parsed?.profiles)
      ? Core.normalizeProfileStore(parsed)
      : Core.normalizeProfileStore({
          profiles: [Core.createEmptyProfile(parsed)]
        });

    state.persistedStore = Core.deepClone(normalized);
    state.draftStore = Core.deepClone(normalized);
    state.dirty = false;
    await chrome.storage.local.set({
      [Core.STORAGE_KEYS.profileStore]: normalized
    });
    renderProfileList();
    renderForm(getSelectedProfile());
    setStatus("导入完成。");
  }

  function createProfile() {
    syncDraftFromForm();
    const profile = Core.createEmptyProfile({
      profileName: "新简历" + (state.draftStore.profiles.length + 1)
    });
    state.draftStore.profiles.push(profile);
    state.draftStore.activeProfileId = profile.id;
    renderProfileList();
    renderForm(profile);
    markDirty("已新建一份简历，记得保存。");
  }

  function duplicateProfile() {
    syncDraftFromForm();
    const current = getSelectedProfile();
    const duplicated = Core.createEmptyProfile({
      ...current,
      id: Core.createProfileId(),
      profileName: current.profileName + " - 副本"
    });
    state.draftStore.profiles.push(duplicated);
    state.draftStore.activeProfileId = duplicated.id;
    renderProfileList();
    renderForm(duplicated);
    markDirty("已复制当前简历，记得保存。");
  }

  function deleteProfile() {
    if (state.draftStore.profiles.length <= 1) {
      setStatus("至少保留一份简历。");
      return;
    }

    syncDraftFromForm();
    const current = getSelectedProfile();
    if (!window.confirm('确定删除“' + current.profileName + "”吗？")) {
      return;
    }

    state.draftStore.profiles = state.draftStore.profiles.filter((profile) => profile.id !== current.id);
    state.draftStore.activeProfileId = state.draftStore.profiles[0].id;
    renderProfileList();
    renderForm(getSelectedProfile());
    markDirty("已删除当前简历，记得保存。");
  }

  function resetCurrentProfile() {
    syncDraftFromForm();
    const savedProfile = getSavedSelectedProfile();
    if (!savedProfile) {
      setStatus("当前简历还没有已保存版本，暂时无法重置。");
      return;
    }
    state.draftStore.profiles = state.draftStore.profiles.map((profile) =>
      profile.id === savedProfile.id ? Core.deepClone(savedProfile) : profile
    );
    renderProfileList();
    renderForm(getSelectedProfile());
    refreshDirtyFlag();
    setStatus("表单已恢复为上次保存的内容。");
  }

  function addRepeatableItem(sectionKey) {
    syncDraftFromForm();
    const section = Core.getRepeatableSection(sectionKey);
    if (!section) {
      return;
    }
    const profile = getSelectedProfile();
    profile[section.key] = Array.isArray(profile[section.key]) ? profile[section.key] : [];
    profile[section.key].push(Core.createEmptySectionItem(section));
    renderForm(profile);
    markDirty("已新增一条“" + section.title + "”，记得保存。");
  }

  function removeRepeatableItem(sectionKey, itemIndex) {
    syncDraftFromForm();
    const section = Core.getRepeatableSection(sectionKey);
    if (!section) {
      return;
    }
    const profile = getSelectedProfile();
    profile[section.key] = (profile[section.key] || []).filter((_, index) => index !== itemIndex);
    renderForm(profile);
    markDirty("已删除一条“" + section.title + "”，记得保存。");
  }

  function bindEvents() {
    refs.form.addEventListener("submit", async function (event) {
      event.preventDefault();
      await persistDraftStore();
    });

    refs.form.addEventListener("input", function () {
      markDirty("检测到未保存的修改。");
    });

    refs.resetBtn.addEventListener("click", resetCurrentProfile);
    refs.newProfileBtn.addEventListener("click", createProfile);
    refs.duplicateProfileBtn.addEventListener("click", duplicateProfile);
    refs.deleteProfileBtn.addEventListener("click", deleteProfile);
    refs.exportBtn.addEventListener("click", exportProfiles);

    refs.importBtn.addEventListener("click", function () {
      refs.importInput.click();
    });

    refs.importInput.addEventListener("change", async function (event) {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      try {
        await importProfiles(file);
      } catch (_error) {
        setStatus("导入失败，请检查 JSON 格式。");
      } finally {
        refs.importInput.value = "";
      }
    });

    refs.profileSelect.addEventListener("change", function () {
      syncDraftFromForm();
      state.draftStore.activeProfileId = refs.profileSelect.value;
      renderProfileList();
      renderForm(getSelectedProfile());
      setStatus("已切换当前简历。");
    });

    refs.formSections.addEventListener("click", function (event) {
      const actionTarget = event.target.closest("[data-action]");
      if (!actionTarget) {
        return;
      }

      const action = actionTarget.dataset.action;
      const sectionKey = actionTarget.dataset.sectionKey;
      const itemIndex = Number(actionTarget.dataset.itemIndex || "-1");

      if (action === "add-item") {
        addRepeatableItem(sectionKey);
      }
      if (action === "remove-item" && itemIndex >= 0) {
        removeRepeatableItem(sectionKey, itemIndex);
      }
    });
  }

  async function init() {
    await loadProfileStore();
    bindEvents();
  }

  init();
})();
