(() => {
  "use strict";

  const ACTIVE = "data-darbex-active";
  const HIDDEN = "data-darbex-hidden";
  const PRINT_PATH = /^\/manager\/[^/]+\/invoices\/[^/]+\/print\/?$/;
  const VAT_COLUMN = /^vat included\s*\(\s*5\s*%\s*\)$/i;
  const VAT_SUMMARY = /^vat included$/i;
  const SUBTOTAL = /^subtotal excluding vat$/i;
  const MONEY = /^(?:AED\s*)?-?[\d,]+\.\d{2}(?:\s*AED)?$/i;
  const normalize = (value) => value.replace(/\s+/g, " ").trim();
  const isPrintPage = () => location.origin === "https://tanseek.ae"
    && PRINT_PATH.test(location.pathname);

  if (!isPrintPage()) return;

  let previousTargets = new Set();
  let previousLabels = new Map();
  let enabledForUrl = null;
  let queued = false;

  function collectColumn(table, targets) {
    const header = [...table.querySelectorAll("thead th")].find((cell) =>
      cell.closest("table") === table && VAT_COLUMN.test(normalize(cell.textContent))
    );
    if (!header) return;

    // Find the column by its label, so reordered tables remain safe.
    const headerCells = [...header.parentElement.cells];
    const column = headerCells.indexOf(header);
    if (headerCells.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)) return;

    for (const row of table.rows) {
      const cells = [...row.cells];
      // Do not hide full-width notes, subtotals, or other spanning rows.
      if (cells.length === headerCells.length
        && cells.every((cell) => cell.colSpan === 1 && cell.rowSpan === 1)) {
        targets.add(cells[column]);
      }
    }
  }

  function collectSummary(section, targets) {
    for (const label of section.querySelectorAll("span, div, p, dt, td, th")) {
      if (!VAT_SUMMARY.test(normalize(label.textContent))) continue;
      // Only consider the innermost label, not its wrappers.
      if ([...label.children].some((child) =>
        VAT_SUMMARY.test(normalize(child.textContent)))) continue;

      if (label.tagName === "DT" && label.nextElementSibling?.tagName === "DD"
        && MONEY.test(normalize(label.nextElementSibling.textContent))) {
        targets.add(label);
        targets.add(label.nextElementSibling);
        continue;
      }

      // The smallest label + amount container is the summary row.
      // Never hide a parent containing the Total / Paid / Balance rows.
      for (let row = label.parentElement; row && row !== section; row = row.parentElement) {
        const children = [...row.children];
        if (children.length !== 2) continue;
        const labelCell = children.find((child) => child === label || child.contains(label));
        const amountCell = children.find((child) => child !== labelCell);
        if (labelCell && VAT_SUMMARY.test(normalize(labelCell.textContent))
          && MONEY.test(normalize(amountCell.textContent))) {
          targets.add(row);
          break;
        }
      }
    }
  }

  function clean() {
    queued = false;
    const active = enabledForUrl === location.href && isPrintPage();
    if (!active) {
      enabledForUrl = null;
      observer.disconnect();
    }
    document.documentElement.toggleAttribute(ACTIVE, active);
    const targets = new Set();
    const labels = new Map();

    if (active) {
      for (const [node, change] of previousLabels) {
        if (node.isConnected && node.nodeValue === change.replacement
          && node.parentElement.closest(".ip-doc .ip-closing-grid")) {
          labels.set(node, change);
        }
      }
      // These containers were confirmed on the supported live invoice print page.
      for (const invoice of document.querySelectorAll(".ip-doc")) {
        for (const table of invoice.querySelectorAll("table.ip-table")) {
          collectColumn(table, targets);
        }
        for (const section of invoice.querySelectorAll(".ip-closing-grid")) {
          collectSummary(section, targets);
          const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (SUBTOTAL.test(normalize(node.nodeValue))) {
              labels.set(node, {
                original: node.nodeValue,
                replacement: node.nodeValue.replace(/subtotal\s+excluding\s+vat/i, "Subtotal")
              });
            }
          }
        }
      }
    }

    for (const element of previousTargets) {
      if (!targets.has(element)) element.removeAttribute(HIDDEN);
    }
    for (const element of targets) element.setAttribute(HIDDEN, "");
    previousTargets = targets;

    for (const [node, change] of previousLabels) {
      if (!labels.has(node) && node.nodeValue === change.replacement) {
        node.nodeValue = change.original;
      }
    }
    for (const [node, change] of labels) {
      if (node.nodeValue !== change.replacement) node.nodeValue = change.replacement;
    }
    previousLabels = labels;
    return { supported: isPrintPage(), hidden: active, matchedCount: targets.size + labels.size };
  }

  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(clean);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "helper-tools:get-state") {
      sendResponse(clean());
    } else if (message?.type === "helper-tools:hide-tdata") {
      if (isPrintPage()) {
        enabledForUrl = location.href;
        // Observe late rendering only after the user opts in for this page.
        observer.observe(document.documentElement, {
          childList: true, characterData: true, subtree: true
        });
      }
      sendResponse(clean());
    }
  });

  window.addEventListener("beforeprint", clean);
  window.addEventListener("popstate", clean);
  window.addEventListener("pageshow", clean);
  clean();
})();
