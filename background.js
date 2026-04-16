chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "resume-autofill:open-options") {
    return undefined;
  }

  chrome.tabs.create(
    {
      url: chrome.runtime.getURL("options.html")
    },
    () => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { ok: false, error: error.message } : { ok: true });
    }
  );

  return true;
});
