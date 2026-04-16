(function () {
  const STORAGE_KEYS = {
    profileStore: "resumeAutofill.profileStore",
    lastScan: "resumeAutofill.lastScan"
  };

  const PROFILE_FORM_SECTIONS = [];
  const REPEATABLE_SECTIONS = [];

  const SKIP_FIELD_KEYWORDS = [
    "搜索",
    "search",
    "keyword",
    "验证码",
    "captcha",
    "password",
    "密码",
    "coupon",
    "promo",
    "invite code"
  ];

  function createDateRangeGetter(startKey, endKey) {
    return function (item) {
      return formatDateRange(item?.[startKey], item?.[endKey]);
    };
  }

  function formatDateRange(startValue, endValue) {
    const start = compactText(startValue);
    const end = compactText(endValue);
    if (start && end) {
      return start + " ~ " + end;
    }
    return start || end || "";
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\s\r\n\t_\-:：/\\()[\]{}<>,，。、“”"'`]+/g, " ")
      .trim();
  }

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeStoredValue(value, multiline) {
    if (value == null) {
      return "";
    }
    const text = String(value);
    return multiline ? text.replace(/\r\n/g, "\n").trim() : compactText(text);
  }

  function unique(items) {
    return Array.from(new Set((items || []).filter(Boolean)));
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createProfileId() {
    return "profile-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  function getScalarFieldDefinitions() {
    return PROFILE_FORM_SECTIONS.flatMap((section) =>
      section.fields
        .filter((field) => field.autofill !== false)
        .map((field) => ({
          ...field,
          sectionKey: section.key,
          sectionTitle: section.title
        }))
    );
  }

  function getRepeatableFieldDefinitions() {
    return REPEATABLE_SECTIONS.flatMap((section) =>
      section.fields
        .filter((field) => field.autofill !== false)
        .map((field) => ({
          ...field,
          key: section.key + "[]." + field.key,
          sectionKey: section.key,
          sectionTitle: section.title
        }))
    );
  }

  function createDefaultProfileShape() {
    const profile = {
      id: "",
      profileName: "默认简历"
    };

    PROFILE_FORM_SECTIONS.forEach((section) => {
      section.fields.forEach((field) => {
        if (!(field.key in profile)) {
          profile[field.key] = field.defaultValue ?? "";
        }
      });
    });

    REPEATABLE_SECTIONS.forEach((section) => {
      profile[section.key] = [];
    });

    return profile;
  }

  function getRepeatableSection(sectionKey) {
    return REPEATABLE_SECTIONS.find((section) => section.key === sectionKey) || null;
  }

  function createEmptySectionItem(sectionOrKey, overrides) {
    const section = typeof sectionOrKey === "string" ? getRepeatableSection(sectionOrKey) : sectionOrKey;
    if (!section) {
      return {};
    }

    const item = {};
    section.fields.forEach((field) => {
      if (!field.render && typeof field.derived === "function") {
        return;
      }
      item[field.key] = field.defaultValue ?? "";
    });

    return {
      ...item,
      ...(overrides || {})
    };
  }

  function normalizeSectionItem(section, item) {
    const normalized = createEmptySectionItem(section, item);
    section.fields.forEach((field) => {
      if (!field.render && typeof field.derived === "function") {
        return;
      }
      normalized[field.key] = normalizeStoredValue(normalized[field.key], field.multiline || field.input === "textarea");
    });
    return normalized;
  }

  function ensureProfile(profile, index) {
    const safeIndex = typeof index === "number" ? index + 1 : 1;
    const merged = {
      ...DEFAULT_PROFILE,
      ...(profile || {})
    };

    PROFILE_FORM_SECTIONS.forEach((section) => {
      section.fields.forEach((field) => {
        merged[field.key] = normalizeStoredValue(merged[field.key], field.multiline || field.input === "textarea");
      });
    });

    REPEATABLE_SECTIONS.forEach((section) => {
      merged[section.key] = Array.isArray(profile?.[section.key])
        ? profile[section.key].map((item) => normalizeSectionItem(section, item))
        : [];
    });

    merged.id = profile?.id || createProfileId();
    merged.profileName = compactText(merged.profileName) || "简历" + safeIndex;

    return merged;
  }

  function createEmptyProfile(overrides) {
    return ensureProfile(
      {
        ...DEFAULT_PROFILE,
        ...(overrides || {}),
        id: overrides?.id || createProfileId()
      },
      0
    );
  }

  function normalizeProfileStore(profileStore) {
    const profiles =
      Array.isArray(profileStore?.profiles) && profileStore.profiles.length
        ? profileStore.profiles.map(ensureProfile)
        : [createEmptyProfile({ id: "default-profile", profileName: "默认简历" })];

    const activeProfileId = profiles.some((profile) => profile.id === profileStore?.activeProfileId)
      ? profileStore.activeProfileId
      : profiles[0].id;

    return {
      version: 2,
      activeProfileId,
      profiles
    };
  }

  function getProfileById(profileStore, profileId) {
    return profileStore?.profiles?.find((profile) => profile.id === profileId) || null;
  }

  function getActiveProfile(profileStore) {
    return getProfileById(profileStore, profileStore?.activeProfileId) || profileStore?.profiles?.[0] || createEmptyProfile();
  }

  function parseCustomFields(text) {
    const source = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!source) {
      return [];
    }

    return source
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[:=：]/);
        if (parts.length < 2) {
          return null;
        }
        const label = parts.shift().trim();
        const value = parts.join(":").trim();
        if (!label || !value) {
          return null;
        }
        return {
          key: "custom:" + normalizeText(label).replace(/\s+/g, "-"),
          baseKey: "custom:" + normalizeText(label).replace(/\s+/g, "-"),
          label,
          synonyms: [label],
          value
        };
      })
      .filter(Boolean);
  }

  function buildScalarEntries(profile) {
    return PROFILE_FORM_SECTIONS.flatMap((section) =>
      section.fields
        .filter((field) => field.autofill !== false)
        .map((field) => {
          const value = normalizeStoredValue(profile?.[field.key], field.multiline || field.input === "textarea");
          if (!value) {
            return null;
          }
          return {
            key: field.key,
            baseKey: field.key,
            label: field.label,
            synonyms: unique([field.label].concat(field.synonyms || [])),
            value,
            multiline: Boolean(field.multiline || field.input === "textarea"),
            directType: field.directType || null,
            repeatable: false,
            sectionKey: section.key,
            sectionTitle: section.title
          };
        })
        .filter(Boolean)
    );
  }

  function buildRepeatableEntries(profile) {
    return REPEATABLE_SECTIONS.flatMap((section) => {
      const items = Array.isArray(profile?.[section.key]) ? profile[section.key] : [];

      return items.flatMap((item, index) => {
        const order = index + 1;
        const sectionLabels = unique([section.title, section.itemTitle].concat(section.synonyms || []));
        const orderLabels = unique([
          "第" + order + "条" + section.itemTitle,
          section.itemTitle + order,
          section.title + order
        ]);

        return section.fields
          .map((field) => {
            const rawValue = typeof field.derived === "function" ? field.derived(item, index, profile) : item?.[field.key];
            const value = normalizeStoredValue(rawValue, field.multiline || field.input === "textarea");
            if (!value) {
              return null;
            }

            const fieldLabels = unique([field.label].concat(field.synonyms || []));
            const contextualSynonyms = sectionLabels
              .flatMap((sectionLabel) => fieldLabels.map((fieldLabel) => sectionLabel + " " + fieldLabel))
              .concat(orderLabels.flatMap((orderLabel) => fieldLabels.map((fieldLabel) => orderLabel + " " + fieldLabel)));

            return {
              key: section.key + "[" + index + "]." + field.key,
              baseKey: section.key + "." + field.key,
              label: section.itemTitle + order + " · " + field.label,
              synonyms: unique(fieldLabels.concat(sectionLabels, orderLabels, contextualSynonyms)),
              value,
              multiline: Boolean(field.multiline || field.input === "textarea"),
              repeatable: true,
              sectionKey: section.key,
              sectionTitle: section.title,
              sequenceGroup: section.key + "." + field.key,
              sequenceIndex: index,
              directType: field.directType || null
            };
          })
          .filter(Boolean);
      });
    });
  }

  function getProfileEntries(profile) {
    return buildScalarEntries(profile).concat(buildRepeatableEntries(profile), parseCustomFields(profile?.customFieldsText));
  }

  function keywordScore(source, keyword) {
    const normalizedSource = normalizeText(source);
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedSource || !normalizedKeyword) {
      return 0;
    }
    if (normalizedSource === normalizedKeyword) {
      return 120;
    }
    if (normalizedSource.startsWith(normalizedKeyword) || normalizedSource.endsWith(normalizedKeyword)) {
      return 75;
    }
    if (normalizedSource.includes(normalizedKeyword)) {
      return 58;
    }

    const sourceTokens = normalizedSource.split(" ");
    const keywordTokens = normalizedKeyword.split(" ");
    const overlap = keywordTokens.filter((token) => sourceTokens.includes(token)).length;
    return overlap ? overlap * 18 : 0;
  }

  function inferKeyFromType(fieldMeta) {
    const type = String(fieldMeta?.type || "").toLowerCase();
    if (type === "email") {
      return "email";
    }
    if (type === "tel") {
      return "phone";
    }
    return null;
  }

  function shouldSkipField(fieldMeta) {
    const source = normalizeText([
      fieldMeta?.label,
      fieldMeta?.placeholder,
      fieldMeta?.ariaLabel,
      fieldMeta?.name,
      fieldMeta?.id,
      fieldMeta?.sectionHint
    ].join(" "));

    return SKIP_FIELD_KEYWORDS.some((keyword) => source.includes(normalizeText(keyword)));
  }

  function scoreEntry(fieldMeta, entry, directKey, fieldText) {
    let score = 0;
    const keywords = unique([entry.label].concat(entry.synonyms || []));

    keywords.forEach((keyword) => {
      score = Math.max(score, keywordScore(fieldText, keyword));
    });

    if (entry.directType && entry.directType === directKey) {
      score += 65;
    }
    if ((fieldMeta.tagName === "TEXTAREA" || fieldMeta.isContentEditable) && entry.multiline) {
      score += 16;
    }
    if (fieldMeta.tagName === "SELECT" && !entry.multiline) {
      score += 10;
    }
    if (entry.repeatable) {
      score -= 8;
    }
    return score;
  }

  function rankEntriesForField(fieldMeta, profile) {
    if (!fieldMeta || shouldSkipField(fieldMeta)) {
      return [];
    }

    const directKey = inferKeyFromType(fieldMeta);
    const entries = getProfileEntries(profile);
    const fieldText = normalizeText([
      fieldMeta.label,
      fieldMeta.placeholder,
      fieldMeta.ariaLabel,
      fieldMeta.name,
      fieldMeta.id,
      fieldMeta.sectionHint,
      fieldMeta.optionText
    ].join(" "));

    if (!fieldText) {
      return [];
    }

    return entries
      .map((entry) => ({
        ...entry,
        score: scoreEntry(fieldMeta, entry, directKey, fieldText)
      }))
      .filter((entry) => entry.score >= 42)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.repeatable !== right.repeatable) {
          return left.repeatable ? 1 : -1;
        }
        return left.label.localeCompare(right.label);
      });
  }

  function selectRepeatableCandidate(candidates, groupUsage) {
    const preferred = [];
    const seenGroups = new Set();

    candidates.forEach((candidate) => {
      if (!candidate.repeatable || seenGroups.has(candidate.sequenceGroup)) {
        return;
      }

      const usedCount = groupUsage.get(candidate.sequenceGroup) || 0;
      const exactCandidate = candidates.find(
        (item) => item.sequenceGroup === candidate.sequenceGroup && item.sequenceIndex === usedCount
      );

      if (exactCandidate) {
        preferred.push(exactCandidate);
        seenGroups.add(candidate.sequenceGroup);
      }
    });

    preferred.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.sequenceIndex - right.sequenceIndex;
    });

    return preferred[0] || null;
  }

  function matchFields(fields, profile) {
    const groupUsage = new Map();

    return (fields || []).map((field) => {
      const candidates = rankEntriesForField(field, profile);
      const bestScalar = candidates.find((candidate) => !candidate.repeatable) || null;
      const bestRepeatable = selectRepeatableCandidate(candidates, groupUsage);

      let selected = null;

      if (bestRepeatable && (!bestScalar || bestRepeatable.score > bestScalar.score)) {
        selected = bestRepeatable;
      } else {
        selected = bestScalar || bestRepeatable || candidates[0] || null;
      }

      if (selected?.repeatable) {
        groupUsage.set(selected.sequenceGroup, (groupUsage.get(selected.sequenceGroup) || 0) + 1);
      }

      return {
        field,
        match: selected
          ? {
              key: selected.key,
              label: selected.label,
              value: selected.value,
              score: selected.score
            }
          : null
      };
    });
  }

  function matchField(fieldMeta, profile) {
    return matchFields([fieldMeta], profile)?.[0]?.match || null;
  }

  function describeField(fieldMeta) {
    return compactText(
      fieldMeta?.label ||
        fieldMeta?.placeholder ||
        fieldMeta?.ariaLabel ||
        fieldMeta?.name ||
        fieldMeta?.id ||
        "未命名字段"
    );
  }

  function scoreOption(value, optionText) {
    const normalizedValue = normalizeText(value);
    const normalizedOption = normalizeText(optionText);
    if (!normalizedValue || !normalizedOption) {
      return 0;
    }
    if (normalizedValue === normalizedOption) {
      return 150;
    }
    if (normalizedValue.includes(normalizedOption) || normalizedOption.includes(normalizedValue)) {
      return 100;
    }
    return normalizedValue
      .split(" ")
      .filter((token) => normalizedOption.includes(token)).length * 15;
  }

  function setNativeValue(element, value) {
    const prototype =
      element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : null;
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function triggerInputEvents(element) {
    ["input", "change", "blur"].forEach((eventName) => {
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    });
  }

  function fillElement(fieldMeta, value) {
    const element = fieldMeta?.element;
    if (!element || value == null) {
      return false;
    }

    const tagName = element.tagName;
    const inputType = String(element.type || "").toLowerCase();

    if (tagName === "SELECT") {
      const bestOption = Array.from(element.options || []).reduce((best, option) => {
        const score = Math.max(scoreOption(value, option.textContent), scoreOption(value, option.value));
        return !best || score > best.score ? { option, score } : best;
      }, null);

      if (bestOption?.option && bestOption.score >= 45) {
        element.value = bestOption.option.value;
        triggerInputEvents(element);
        return true;
      }
      return false;
    }

    if (inputType === "radio") {
      const optionLabel = normalizeText(fieldMeta.optionText || fieldMeta.label);
      const normalizedValue = normalizeText(value);
      if (!optionLabel || !normalizedValue) {
        return false;
      }
      if (optionLabel.includes(normalizedValue) || normalizedValue.includes(optionLabel)) {
        element.click();
        triggerInputEvents(element);
        return true;
      }
      return false;
    }

    if (inputType === "checkbox") {
      const truthy = ["true", "yes", "是", "需要", "同意"];
      const normalizedValue = normalizeText(value);
      if (truthy.some((item) => normalizedValue.includes(item))) {
        if (!element.checked) {
          element.click();
          triggerInputEvents(element);
        }
        return true;
      }
      return false;
    }

    if (tagName === "TEXTAREA" || tagName === "INPUT") {
      setNativeValue(element, value);
      triggerInputEvents(element);
      return true;
    }

    if (fieldMeta.isContentEditable) {
      element.focus();
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    return false;
  }

  function summarizeMatches(fields, profile) {
    const matchedFields = [];
    const ignoredFields = [];
    const matches = matchFields(fields, profile);

    matches.forEach(({ field, match }) => {
      const item = {
        fieldLabel: describeField(field),
        tagName: field.tagName,
        type: field.type || "",
        match
      };

      if (match) {
        matchedFields.push(item);
      } else {
        ignoredFields.push(item);
      }
    });

    return {
      totalFields: fields?.length || 0,
      matchedCount: matchedFields.length,
      matchedFields,
      ignoredFields
    };
  }

  function summarizeSectionItem(sectionOrKey, item, index) {
    const section = typeof sectionOrKey === "string" ? getRepeatableSection(sectionOrKey) : sectionOrKey;
    if (!section) {
      return "第 " + (index + 1) + " 条";
    }

    const parts = (section.summaryKeys || [])
      .map((key) => normalizeStoredValue(item?.[key], false))
      .filter(Boolean)
      .slice(0, 3);

    if (parts.length) {
      return parts.join(" / ");
    }

    return "第 " + (index + 1) + " 条" + section.itemTitle;
  }

  PROFILE_FORM_SECTIONS.push(
    {
      key: "profileSettings",
      title: "基础设置",
      description: "管理简历名称和少量通用配置。",
      fields: [
        {
          key: "profileName",
          label: "简历名称",
          input: "text",
          span: 6,
          autofill: false,
          placeholder: "例如：秋招主简历"
        }
      ]
    },
    {
      key: "personalInfo",
      title: "个人信息",
      description: "联系方式、身份信息和个人概况集中维护。",
      fields: [
        { key: "fullName", label: "姓名", input: "text", span: 3, synonyms: ["姓名", "名字", "真实姓名", "name", "full name"] },
        { key: "namePinyin", label: "姓名拼音", input: "text", span: 3, synonyms: ["姓名拼音", "拼音名", "pinyin", "romanized name"] },
        { key: "gender", label: "性别", input: "text", span: 2, synonyms: ["性别", "gender", "sex"] },
        { key: "birthDate", label: "出生日期", input: "text", span: 2, synonyms: ["出生日期", "生日", "出生年月", "birth date", "birthday"] },
        { key: "age", label: "年龄", input: "text", span: 2, synonyms: ["年龄", "age"] },

        { key: "phone", label: "电话", input: "text", span: 3, directType: "phone", synonyms: ["电话", "手机", "手机号码", "联系电话", "mobile", "phone", "tel"] },
        { key: "email", label: "邮箱", input: "email", span: 3, directType: "email", synonyms: ["邮箱", "电子邮箱", "邮件", "e-mail", "email", "mail"] },
        { key: "wechat", label: "微信号", input: "text", span: 3, synonyms: ["微信号", "微信", "即时通讯微信号", "wechat", "weixin"] },
        { key: "qq", label: "QQ号", input: "text", span: 3, synonyms: ["QQ号", "QQ", "qq number"] },

        { key: "currentCity", label: "当前城市", input: "text", span: 3, synonyms: ["当前城市", "所在地", "居住城市", "现居城市", "current city", "location", "city"] },
        { key: "address", label: "地址", input: "text", span: 9, synonyms: ["地址", "居住地址", "联系地址", "现居住地", "address", "residence"] },

        { key: "nationality", label: "国籍", input: "text", span: 3, synonyms: ["国籍", "nationality"] },
        { key: "ethnicity", label: "民族", input: "text", span: 3, synonyms: ["民族", "ethnicity"] },
        { key: "maritalStatus", label: "婚姻状况", input: "text", span: 3, synonyms: ["婚姻状况", "婚育情况", "marital status"] },
        { key: "politicalStatus", label: "政治面貌", input: "text", span: 3, synonyms: ["政治面貌", "political status"] },

        { key: "idType", label: "证件类型", input: "text", span: 3, synonyms: ["证件类型", "身份证件类型", "id type"] },
        { key: "idNumber", label: "身份证号", input: "text", span: 6, synonyms: ["身份证号", "证件号码", "身份证号码", "identity card", "id number"] },
        { key: "postalCode", label: "邮政编码", input: "text", span: 3, synonyms: ["邮政编码", "邮编", "postal code", "zip code"] },

        { key: "nativePlace", label: "籍贯", input: "text", span: 3, synonyms: ["籍贯", "origin place", "native place"] },
        { key: "studentOrigin", label: "生源地", input: "text", span: 3, synonyms: ["生源地", "student origin"] },
        { key: "hukouType", label: "户口性质", input: "text", span: 3, synonyms: ["户口性质", "hukou type"] },
        { key: "hukouLocation", label: "户口所在地", input: "text", span: 3, synonyms: ["户口所在地", "hukou location"] },

        { key: "healthStatus", label: "健康状况", input: "text", span: 3, synonyms: ["健康状况", "健康状态", "health"] },
        { key: "bloodType", label: "血型", input: "text", span: 3, synonyms: ["血型", "blood type"] },
        { key: "heightCm", label: "身高(cm)", input: "text", span: 3, synonyms: ["身高", "height", "height cm"] },
        { key: "weightKg", label: "体重(kg)", input: "text", span: 3, synonyms: ["体重", "weight", "weight kg"] },

        { key: "emergencyContactName", label: "紧急联系人姓名", input: "text", span: 4, synonyms: ["紧急联系人姓名", "紧急联系人", "emergency contact"] },
        { key: "emergencyContactRelation", label: "紧急联系人关系", input: "text", span: 4, synonyms: ["紧急联系人关系", "与紧急联系人关系", "emergency contact relation"] },
        { key: "emergencyContactPhone", label: "紧急联系电话", input: "text", span: 4, synonyms: ["紧急联系电话", "紧急联系人电话", "emergency contact phone"] }
      ]
    },
    {
      key: "educationOverview",
      title: "学历与学籍",
      description: "维护最高学历、毕业院校和基础学籍信息。",
      fields: [
        { key: "degree", label: "最高学历", input: "text", span: 3, synonyms: ["最高学历", "学历", "education level", "education"] },
        { key: "academicDegree", label: "学位", input: "text", span: 3, synonyms: ["学位", "degree type", "academic degree"] },
        { key: "school", label: "毕业院校", input: "text", span: 3, synonyms: ["毕业院校", "学校", "院校", "school", "university", "college"] },
        { key: "major", label: "专业", input: "text", span: 3, synonyms: ["专业", "所学专业", "major", "specialization"] },

        { key: "studyMode", label: "学习形式", input: "text", span: 3, synonyms: ["学习形式", "教育方式", "培养方式", "study mode"] },
        { key: "graduationYear", label: "毕业时间", input: "text", span: 3, synonyms: ["毕业时间", "毕业日期", "毕业年月", "graduation date", "graduation year"] },
        { key: "englishLevel", label: "英语等级", input: "text", span: 3, synonyms: ["英语等级", "英语水平", "english level"] },
        { key: "isFreshGraduate", label: "是否应届生", input: "text", span: 3, synonyms: ["是否应届生", "应届生", "fresh graduate"] },

        { key: "collegeEntranceExamDate", label: "高考时间", input: "text", span: 4, synonyms: ["高考时间", "高考日期", "college entrance exam date"] },
        { key: "collegeEntranceExamScore", label: "高考分数", input: "text", span: 4, synonyms: ["高考分数", "高考成绩", "college entrance exam score"] },
        { key: "collegeEntranceExamSubjects", label: "高考科目", input: "text", span: 4, synonyms: ["高考科目", "高考选科组合", "college entrance exam subjects"] },

        { key: "partyJoinDate", label: "入党时间", input: "text", span: 4, synonyms: ["入党时间", "加入党组织时间", "party join date"] },
        { key: "professionalTitle", label: "专业技术职级", input: "text", span: 4, synonyms: ["专业技术职级", "专业技术资格", "professional title"] },
        { key: "employmentStatus", label: "工作状态", input: "text", span: 4, synonyms: ["工作状态", "求职状态", "employment status"] },

        { key: "yearsExperience", label: "工作年限", input: "text", span: 4, synonyms: ["工作年限", "总工作年限", "工作经验", "experience", "years of experience"] },
        { key: "currentCompany", label: "当前公司", input: "text", span: 4, synonyms: ["当前公司", "所在公司", "current company", "company"] },
        { key: "currentTitle", label: "当前职位", input: "text", span: 4, synonyms: ["当前职位", "当前岗位", "current title", "title", "role"] },

        { key: "previousCompany", label: "上一家公司", input: "text", span: 6, synonyms: ["上一家公司", "最近工作单位", "上一份工作", "previous company"] }
      ]
    },
    {
      key: "jobIntent",
      title: "求职意向",
      description: "目标岗位、城市和薪资信息，优先展示当前求职偏好。",
      fields: [
        { key: "expectedRole", label: "目标岗位", input: "text", span: 4, synonyms: ["目标岗位", "期望职位", "目标职位", "position", "job title", "target role"] },
        { key: "expectedCity", label: "期望城市", input: "text", span: 4, synonyms: ["期望城市", "意向城市", "目标城市", "preferred city", "target city"] },
        { key: "interviewCity", label: "面试城市", input: "text", span: 4, synonyms: ["面试城市", "可参与面试城市", "interview city"] },

        { key: "availableStartDate", label: "预计入职时间", input: "text", span: 4, synonyms: ["预计入职时间", "预计到岗时间", "available start date"] },
        { key: "expectedSalary", label: "期望薪资", input: "text", span: 4, synonyms: ["期望薪资", "目标薪资", "薪资要求", "salary", "expected salary"] },
        { key: "currentSalary", label: "当前薪资", input: "text", span: 4, synonyms: ["当前薪资", "当前月薪", "current salary"] },

        { key: "acceptsAdjustment", label: "是否接受调剂", input: "text", span: 4, synonyms: ["是否接受调剂", "是否服从调剂", "accept adjustment"] },
        { key: "jobSearchNotes", label: "求职备注", input: "textarea", rows: 4, span: 8, multiline: true, synonyms: ["求职备注", "补充说明", "job search notes"] }
      ]
    },
    {
      key: "skillsAndSummary",
      title: "技能专长",
      description: "用大文本块集中维护技能内容，和插件端字段保持一致。",
      fields: [
        { key: "skills", label: "技术技能", input: "textarea", rows: 4, span: 6, multiline: true, synonyms: ["技术技能", "专业技术技能", "技能", "专业技能", "skills", "tech stack"] },
        { key: "languageAbilitySummary", label: "语言能力", input: "textarea", rows: 4, span: 6, multiline: true, synonyms: ["语言能力", "掌握的语言", "language ability"] },
        { key: "softwareSkills", label: "软件技能", input: "textarea", rows: 4, span: 6, multiline: true, synonyms: ["软件技能", "软件使用技能", "software skills"] },
        { key: "certificationsSummary", label: "证书认证", input: "textarea", rows: 4, span: 6, multiline: true, synonyms: ["证书认证", "获得的证书", "certifications"] },
        { key: "softSkills", label: "软技能", input: "textarea", rows: 4, span: 6, multiline: true, synonyms: ["软技能", "沟通能力", "soft skills"] },
        { key: "personalStrengths", label: "个人优势", input: "textarea", rows: 4, span: 6, multiline: true, synonyms: ["个人优势", "优势特长", "strengths"] },
        { key: "selfIntroduction", label: "自我介绍", input: "textarea", rows: 5, span: 12, multiline: true, synonyms: ["自我介绍", "个人介绍", "个人概况", "summary", "about me", "profile"] },
        { key: "hobbies", label: "兴趣爱好", input: "textarea", rows: 3, span: 6, multiline: true, synonyms: ["兴趣爱好", "爱好", "hobbies"] },
        { key: "workSummary", label: "工作经历摘要", input: "textarea", rows: 5, span: 6, multiline: true, synonyms: ["工作经历摘要", "工作经历", "工作经验", "employment history", "work history"] },
        { key: "projectSummary", label: "项目经历摘要", input: "textarea", rows: 5, span: 6, multiline: true, synonyms: ["项目经历摘要", "项目经历", "项目经验", "projects", "project summary"] },
        { key: "website", label: "个人网站", input: "url", span: 4, synonyms: ["个人网站", "网站", "主页", "website", "homepage", "blog"] },
        { key: "github", label: "GitHub", input: "url", span: 4, synonyms: ["github", "git hub", "代码仓库", "仓库地址"] },
        { key: "portfolio", label: "作品集", input: "url", span: 4, synonyms: ["作品集", "项目作品", "portfolio", "作品地址"] }
      ]
    },
    {
      key: "customFields",
      title: "自定义字段",
      description: "格式为每行一个字段，使用“字段名=值”或“字段名:值”。",
      fields: [
        {
          key: "customFieldsText",
          label: "自定义字段",
          input: "textarea",
          rows: 8,
          span: 12,
          multiline: true,
          autofill: false,
          synonyms: [],
          placeholder: "身份证号=310xxxxxxxxxxxxx\n求职状态=随时到岗\n英语水平=CET-6"
        }
      ]
    }
  );

  REPEATABLE_SECTIONS.push(
    {
      key: "educationRecords",
      title: "教育背景",
      itemTitle: "教育背景",
      description: "教育经历支持多条维护，保留插件原有的院校、证书、排名等字段。",
      emptyMessage: "当前还没有教育背景内容。",
      addLabel: "新增教育背景",
      synonyms: ["教育背景", "教育经历", "教育信息"],
      summaryKeys: ["school", "major", "educationLevel"],
      fields: [
        { key: "school", label: "学校", input: "text", span: 4, synonyms: ["学校", "学校名称", "school"] },
        { key: "department", label: "院系", input: "text", span: 4, synonyms: ["院系", "学院", "院系名称", "department"] },
        { key: "major", label: "专业", input: "text", span: 4, synonyms: ["专业", "专业名称", "major"] },
        { key: "schoolCity", label: "学校城市", input: "text", span: 4, synonyms: ["学校城市", "学校所在城市", "school city"] },
        { key: "educationLevel", label: "学历", input: "text", span: 4, synonyms: ["学历", "学历级别", "education level"] },
        { key: "degreeType", label: "学位", input: "text", span: 4, synonyms: ["学位", "学位类型", "degree type"] },
        { key: "startDate", label: "入学时间", input: "text", span: 4, synonyms: ["入学时间", "开始时间", "admission date"] },
        { key: "endDate", label: "毕业时间", input: "text", span: 4, synonyms: ["毕业时间", "结束时间", "graduation date"] },
        { key: "dateRange", label: "起止时间", span: 4, render: false, synonyms: ["起止时间", "时间范围", "time range"], derived: createDateRangeGetter("startDate", "endDate") },
        { key: "gpa", label: "GPA", input: "text", span: 3, synonyms: ["GPA", "gpa"] },
        { key: "schoolType", label: "学校类型", input: "text", span: 3, synonyms: ["学校类型", "院校类型", "school type"] },
        { key: "educationMode", label: "教育方式", input: "text", span: 3, synonyms: ["教育方式", "学习形式", "全日制", "education mode"] },
        { key: "classRank", label: "班级排名", input: "text", span: 3, synonyms: ["班级排名", "class rank"] },
        { key: "majorRank", label: "专业排名", input: "text", span: 3, synonyms: ["专业排名", "major rank"] },
        { key: "diplomaNumber", label: "学历证书编号", input: "text", span: 3, synonyms: ["学历证书编号", "毕业证编号", "diploma number"] },
        { key: "degreeCertificateNumber", label: "学位证书编号", input: "text", span: 3, synonyms: ["学位证书编号", "学位证编号", "degree certificate number"] },
        { key: "counselorName", label: "辅导员姓名", input: "text", span: 3, synonyms: ["辅导员姓名", "counselor name"] },
        { key: "counselorPhone", label: "辅导员联系方式", input: "text", span: 3, synonyms: ["辅导员联系方式", "辅导员电话", "counselor phone"] },
        { key: "isOverseasSchool", label: "是否海外学校", input: "text", span: 3, synonyms: ["是否海外学校", "海外学校", "overseas school"] },
        { key: "researchDirection", label: "研究方向", input: "text", span: 3, synonyms: ["研究方向", "research direction"] },
        { key: "thesisTitle", label: "毕业论文", input: "text", span: 6, synonyms: ["毕业论文", "论文题目", "thesis"] },
        { key: "majorDescription", label: "专业描述", input: "textarea", rows: 3, span: 6, multiline: true, synonyms: ["专业描述", "专业方向描述", "major description"] },
        { key: "coreCourses", label: "专业课程", input: "textarea", rows: 4, span: 6, multiline: true, synonyms: ["专业课程", "核心课程", "courses"] },
        { key: "educationDescription", label: "教育描述", input: "textarea", rows: 4, span: 6, multiline: true, synonyms: ["教育描述", "教育经历描述", "education description"] }
      ]
    },
    {
      key: "workRecords",
      title: "工作经历",
      itemTitle: "工作经历",
      description: "工作经历延续插件端字段，包括薪资、证明人和离职原因。",
      emptyMessage: "当前还没有工作经历内容。",
      addLabel: "新增工作经历",
      synonyms: ["工作经历", "工作经验", "职业经历"],
      summaryKeys: ["company", "title"],
      fields: [
        { key: "company", label: "公司", input: "text", span: 4, synonyms: ["公司", "公司名称", "company"] },
        { key: "title", label: "职位", input: "text", span: 4, synonyms: ["职位", "岗位", "职位名称", "title", "role"] },
        { key: "workCity", label: "工作城市", input: "text", span: 4, synonyms: ["工作城市", "城市", "work city"] },
        { key: "startDate", label: "开始时间", input: "text", span: 4, synonyms: ["开始时间", "入职时间", "start date"] },
        { key: "endDate", label: "结束时间", input: "text", span: 4, synonyms: ["结束时间", "离职时间", "end date"] },
        { key: "dateRange", label: "起止时间", span: 4, render: false, synonyms: ["起止时间", "时间范围", "time range"], derived: createDateRangeGetter("startDate", "endDate") },
        { key: "monthlySalary", label: "月薪", input: "text", span: 4, synonyms: ["月薪", "月薪收入", "monthly salary"] },
        { key: "annualSalary", label: "年薪薪资", input: "text", span: 4, synonyms: ["年薪薪资", "年薪收入", "annual salary"] },
        { key: "referenceName", label: "证明人姓名", input: "text", span: 4, synonyms: ["证明人姓名", "推荐人姓名", "reference name"] },
        { key: "referenceContact", label: "证明人联系方式", input: "text", span: 4, synonyms: ["证明人联系方式", "推荐人联系方式", "reference contact"] },
        { key: "referenceTitle", label: "证明人职位", input: "text", span: 4, synonyms: ["证明人职位", "推荐人职位", "reference title"] },
        { key: "jobDescription", label: "工作描述", input: "textarea", rows: 5, span: 8, multiline: true, synonyms: ["工作描述", "工作内容描述", "job description"] },
        { key: "leavingReason", label: "离职原因", input: "textarea", rows: 5, span: 4, multiline: true, synonyms: ["离职原因", "reason for leaving"] }
      ]
    },
    {
      key: "projectRecords",
      title: "项目经历",
      itemTitle: "项目经历",
      description: "保留项目说明、个人职责、链接和证明人等完整字段。",
      emptyMessage: "当前还没有项目经历内容。",
      addLabel: "新增项目经历",
      synonyms: ["项目经历", "项目经验", "科研项目"],
      summaryKeys: ["projectName", "role"],
      fields: [
        { key: "projectName", label: "项目名称", input: "text", span: 4, synonyms: ["项目名称", "project name"] },
        { key: "role", label: "项目职务", input: "text", span: 4, synonyms: ["项目职务", "项目角色", "项目中的角色", "project role"] },
        { key: "projectLocation", label: "项目地址", input: "text", span: 4, synonyms: ["项目地址", "项目所在地址", "project location"] },
        { key: "startDate", label: "开始时间", input: "text", span: 4, synonyms: ["开始时间", "项目开始时间", "start date"] },
        { key: "endDate", label: "结束时间", input: "text", span: 4, synonyms: ["结束时间", "项目结束时间", "end date"] },
        { key: "dateRange", label: "起止时间", span: 4, render: false, synonyms: ["起止时间", "时间范围", "time range"], derived: createDateRangeGetter("startDate", "endDate") },
        { key: "projectLink", label: "项目链接", input: "url", span: 6, synonyms: ["项目链接", "项目在线链接", "project link"] },
        { key: "referenceName", label: "证明人姓名", input: "text", span: 3, synonyms: ["证明人姓名", "项目证明人姓名", "reference name"] },
        { key: "referenceContact", label: "证明人联系方式", input: "text", span: 3, synonyms: ["证明人联系方式", "项目证明人联系方式", "reference contact"] },
        { key: "referenceTitle", label: "证明人职位", input: "text", span: 4, synonyms: ["证明人职位", "项目证明人职位", "reference title"] },
        { key: "projectDescription", label: "项目描述", input: "textarea", rows: 5, span: 6, multiline: true, synonyms: ["项目描述", "项目详细描述", "project description"] },
        { key: "responsibilities", label: "项目职责", input: "textarea", rows: 5, span: 3, multiline: true, synonyms: ["项目职责", "职责与贡献", "responsibilities"] },
        { key: "projectOutcome", label: "项目成果", input: "textarea", rows: 5, span: 3, multiline: true, synonyms: ["项目成果", "项目交付结果", "project outcome"] }
      ]
    },
    {
      key: "certificateRecords",
      title: "证书",
      itemTitle: "证书",
      description: "结构化维护执业资格、职业资格等资质证书信息。",
      emptyMessage: "当前还没有证书内容。",
      addLabel: "新增证书",
      synonyms: ["证书", "资格证书", "职业资格"],
      summaryKeys: ["certificateName", "issuer"],
      fields: [
        { key: "certificateName", label: "证书名称", input: "text", span: 4, synonyms: ["证书名称", "资格名称", "certificate name"] },
        { key: "issuer", label: "颁发机构", input: "text", span: 4, synonyms: ["颁发机构", "发证机构", "issuer"] },
        { key: "issueDate", label: "获证时间", input: "text", span: 4, synonyms: ["获证时间", "发证时间", "issue date"] },
        { key: "expiryDate", label: "到期时间", input: "text", span: 4, synonyms: ["到期时间", "有效期", "expiry date"] },
        { key: "certificateLevel", label: "证书级别", input: "text", span: 4, synonyms: ["证书级别", "certificate level"] },
        { key: "certificateNumber", label: "证书编号", input: "text", span: 4, synonyms: ["证书编号", "certificate number"] },
        { key: "description", label: "证书描述", input: "textarea", rows: 4, span: 12, multiline: true, synonyms: ["证书描述", "certificate description"] }
      ]
    },
    {
      key: "internshipRecords",
      title: "实习经历",
      itemTitle: "实习经历",
      description: "实习经历延续插件字段，适合校招场景快速维护。",
      emptyMessage: "当前还没有实习经历内容。",
      addLabel: "新增实习经历",
      synonyms: ["实习经历", "实习经验"],
      summaryKeys: ["company", "title"],
      fields: [
        { key: "company", label: "公司", input: "text", span: 4, synonyms: ["公司", "实习单位", "company"] },
        { key: "title", label: "职位", input: "text", span: 4, synonyms: ["职位", "岗位", "title"] },
        { key: "city", label: "工作城市", input: "text", span: 4, synonyms: ["工作城市", "城市", "city"] },
        { key: "startDate", label: "开始时间", input: "text", span: 4, synonyms: ["开始时间", "入职时间", "start date"] },
        { key: "endDate", label: "结束时间", input: "text", span: 4, synonyms: ["结束时间", "离职时间", "end date"] },
        { key: "dateRange", label: "起止时间", span: 4, render: false, synonyms: ["起止时间", "时间范围"], derived: createDateRangeGetter("startDate", "endDate") },
        { key: "description", label: "工作描述", input: "textarea", rows: 5, span: 12, multiline: true, synonyms: ["工作描述", "实习描述", "description"] }
      ]
    },
    {
      key: "foreignLanguageRecords",
      title: "外语能力",
      itemTitle: "外语能力",
      description: "适合维护语言考试和综合掌握程度。",
      emptyMessage: "当前还没有外语能力内容。",
      addLabel: "新增外语能力",
      synonyms: ["外语能力", "语言考试", "语言证书"],
      summaryKeys: ["language", "examName"],
      fields: [
        { key: "language", label: "语种", input: "text", span: 3, synonyms: ["语种", "语言", "language"] },
        { key: "examName", label: "考试名称", input: "text", span: 3, synonyms: ["考试名称", "考试", "exam name"] },
        { key: "score", label: "成绩", input: "text", span: 3, synonyms: ["成绩", "分数", "score"] },
        { key: "proficiency", label: "掌握程度", input: "text", span: 3, synonyms: ["掌握程度", "熟练程度", "proficiency"] },
        { key: "description", label: "备注", input: "textarea", rows: 4, span: 12, multiline: true, synonyms: ["备注", "说明", "description"] }
      ]
    },
    {
      key: "familyMembers",
      title: "家庭情况",
      itemTitle: "家庭成员",
      description: "覆盖家庭成员的基本信息、政治面貌和联系方式。",
      emptyMessage: "当前还没有家庭成员内容。",
      addLabel: "新增家庭成员",
      synonyms: ["家庭情况", "家庭成员"],
      summaryKeys: ["name", "relation"],
      fields: [
        { key: "name", label: "姓名", input: "text", span: 3, synonyms: ["姓名", "家庭成员姓名", "name"] },
        { key: "relation", label: "关系", input: "text", span: 3, synonyms: ["关系", "与本人关系", "relation"] },
        { key: "birthDate", label: "出生日期", input: "text", span: 3, synonyms: ["出生日期", "birth date"] },
        { key: "phone", label: "联系电话", input: "text", span: 3, synonyms: ["联系电话", "联系电话号码", "phone"] },
        { key: "company", label: "工作单位", input: "text", span: 4, synonyms: ["工作单位", "所在单位", "company"] },
        { key: "title", label: "职位", input: "text", span: 4, synonyms: ["职位", "职务", "title"] },
        { key: "politicalStatus", label: "政治面貌", input: "text", span: 4, synonyms: ["政治面貌", "political status"] },
        { key: "address", label: "联系地址", input: "text", span: 12, synonyms: ["联系地址", "居住地址", "address"] }
      ]
    },
    {
      key: "leadershipRecords",
      title: "干部任职经历",
      itemTitle: "干部任职",
      description: "适合校招或体制内表单，保留任职组织、内容与职责字段。",
      emptyMessage: "当前还没有干部任职经历内容。",
      addLabel: "新增干部任职",
      synonyms: ["干部任职经历", "学生干部经历", "任职经历"],
      summaryKeys: ["organization", "position"],
      fields: [
        { key: "organization", label: "任职组织", input: "text", span: 4, synonyms: ["任职组织", "组织名称", "organization"] },
        { key: "position", label: "职务", input: "text", span: 4, synonyms: ["职务", "职位", "position"] },
        { key: "startDate", label: "开始时间", input: "text", span: 4, synonyms: ["开始时间", "start date"] },
        { key: "endDate", label: "结束时间", input: "text", span: 4, synonyms: ["结束时间", "end date"] },
        { key: "dateRange", label: "起止时间", span: 4, render: false, synonyms: ["起止时间"], derived: createDateRangeGetter("startDate", "endDate") },
        { key: "responsibilities", label: "职责内容", input: "textarea", rows: 5, span: 12, multiline: true, synonyms: ["职责内容", "任职内容", "responsibilities"] }
      ]
    },
    {
      key: "awardRecords",
      title: "获奖经历",
      itemTitle: "获奖经历",
      description: "保留时间范围、级别和详细描述，适合校招与科研场景。",
      emptyMessage: "当前还没有获奖经历内容。",
      addLabel: "新增获奖经历",
      synonyms: ["获奖经历", "奖项", "奖励"],
      summaryKeys: ["awardName", "issuer"],
      fields: [
        { key: "awardName", label: "奖项名称", input: "text", span: 4, synonyms: ["奖项名称", "获奖名称", "award name"] },
        { key: "issuer", label: "颁发机构", input: "text", span: 4, synonyms: ["颁发机构", "颁奖机构", "issuer"] },
        { key: "awardDate", label: "获奖时间", input: "text", span: 4, synonyms: ["获奖时间", "award date"] },
        { key: "endDate", label: "结束时间", input: "text", span: 4, synonyms: ["结束时间", "end date"] },
        { key: "dateRange", label: "起止时间", span: 4, render: false, synonyms: ["起止时间"], derived: createDateRangeGetter("awardDate", "endDate") },
        { key: "awardLevel", label: "奖项级别", input: "text", span: 4, synonyms: ["奖项级别", "award level"] },
        { key: "awardType", label: "奖励类型", input: "text", span: 4, synonyms: ["奖励类型", "个人团体", "award type"] },
        { key: "awardGrade", label: "奖励等级", input: "text", span: 4, synonyms: ["奖励等级", "award grade"] },
        { key: "description", label: "获奖描述", input: "textarea", rows: 4, span: 12, multiline: true, synonyms: ["获奖描述", "奖励说明", "award description"] }
      ]
    },
    {
      key: "patentRecords",
      title: "专利信息",
      itemTitle: "专利",
      description: "适合技术简历或科研场景，覆盖申请号、状态和发明人。",
      emptyMessage: "当前还没有专利信息内容。",
      addLabel: "新增专利信息",
      synonyms: ["专利信息", "专利", "patent"],
      summaryKeys: ["patentName", "applicationNumber"],
      fields: [
        { key: "patentName", label: "专利名称", input: "text", span: 4, synonyms: ["专利名称", "patent name"] },
        { key: "applicationNumber", label: "申请号", input: "text", span: 4, synonyms: ["申请号", "专利号", "application number"] },
        { key: "patentStatus", label: "状态", input: "text", span: 4, synonyms: ["状态", "专利状态", "status"] },
        { key: "inventors", label: "发明人", input: "text", span: 4, synonyms: ["发明人", "inventors"] },
        { key: "applyDate", label: "申请时间", input: "text", span: 4, synonyms: ["申请时间", "apply date"] },
        { key: "authorizationDate", label: "授权时间", input: "text", span: 4, synonyms: ["授权时间", "authorization date"] },
        { key: "description", label: "专利描述", input: "textarea", rows: 4, span: 12, multiline: true, synonyms: ["专利描述", "patent description"] }
      ]
    },
    {
      key: "paperRecords",
      title: "论文发表",
      itemTitle: "论文",
      description: "适合科研简历，覆盖期刊、作者、DOI 与摘要信息。",
      emptyMessage: "当前还没有论文发表内容。",
      addLabel: "新增论文发表",
      synonyms: ["论文发表", "论文", "paper", "publication"],
      summaryKeys: ["title", "journal"],
      fields: [
        { key: "title", label: "论文标题", input: "text", span: 4, synonyms: ["论文标题", "title", "paper title"] },
        { key: "journal", label: "发表期刊", input: "text", span: 4, synonyms: ["发表期刊", "期刊", "会议", "journal"] },
        { key: "authors", label: "作者", input: "text", span: 4, synonyms: ["作者", "authors"] },
        { key: "publishDate", label: "发表时间", input: "text", span: 4, synonyms: ["发表时间", "publish date"] },
        { key: "doi", label: "DOI号", input: "text", span: 4, synonyms: ["DOI号", "DOI", "doi"] },
        { key: "link", label: "论文链接", input: "url", span: 4, synonyms: ["论文链接", "paper link"] },
        { key: "abstract", label: "论文摘要", input: "textarea", rows: 5, span: 12, multiline: true, synonyms: ["论文摘要", "摘要", "abstract"] }
      ]
    }
  );

  const FIELD_DEFINITIONS = Object.freeze(getScalarFieldDefinitions().concat(getRepeatableFieldDefinitions()));
  const DEFAULT_PROFILE = Object.freeze(createDefaultProfileShape());

  window.ResumeAutofillCore = {
    STORAGE_KEYS,
    DEFAULT_PROFILE,
    FIELD_DEFINITIONS,
    PROFILE_FORM_SECTIONS,
    REPEATABLE_SECTIONS,
    normalizeText,
    compactText,
    normalizeStoredValue,
    deepClone,
    createProfileId,
    ensureProfile,
    createEmptyProfile,
    createEmptySectionItem,
    getRepeatableSection,
    summarizeSectionItem,
    normalizeProfileStore,
    getProfileById,
    getActiveProfile,
    parseCustomFields,
    getProfileEntries,
    rankEntriesForField,
    matchField,
    matchFields,
    describeField,
    fillElement,
    summarizeMatches
  };
})();
