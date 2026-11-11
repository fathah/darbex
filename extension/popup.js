(() => {
  "use strict";

  const button = document.querySelector("#hide-tdata");
  const status = document.querySelector("#status");
  let tabId;

  function showState(state) {
    document.body.removeAttribute("data-error");
    button.disabled = !state?.supported || state.hidden;
    if (!state?.supported) {
      status.textContent = "Open tanseek.ae, then refresh the page.";
    } else if (state.hidden) {
      status.textContent = state.matchedCount
        ? "TData hidden for this page. Refresh to restore."
        : "Waiting for invoice fields. They will hide when the page loads.";
    } else {
      status.textContent = "Hide TData for this page and its printout.";
    }
  }

  async function initialize() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return showState(null);
      tabId = tab.id;
      const state = await chrome.tabs.sendMessage(tabId, { type: "helper-tools:get-state" });
      showState(state);
    } catch {
      showState(null);
    }
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const state = await chrome.tabs.sendMessage(tabId, { type: "helper-tools:hide-tdata" });
      showState(state);
    } catch {
      document.body.setAttribute("data-error", "");
      status.textContent = "Refresh the page, then open Helper Tools again.";
    } finally {
      button.removeAttribute("aria-busy");
    }
  });

  initialize();
})();
