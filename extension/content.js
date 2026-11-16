(() => {
  "use strict";

  const ACTIVE = "data-darbex-active";
  const HIDDEN = "data-darbex-hidden";
  const TITLE = "data-darbex-title";
  const VAT_COLUMN = /^vat included\s*\(\s*5\s*%\s*\)$/i;
  const VAT_SUMMARY = /^vat included$/i;
  const WITHOUT_VAT = /^(?:amount|subtotal) (?:without|excluding) vat$/i;
  const TAX_TITLE = /^tax invoice$/i;
  const MONEY = /^(?:AED\s*)?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?:\s*AED)?$/i;
  const normalize = (value) => value.replace(/\s+/g, " ").trim();
  const isSupportedSite = () => location.hostname === "tanseek.ae";

  if (!isSupportedSite()) return;

  let previousTargets = new Set();
  let previousTitles = new Set();
  let previousText = new Map();
  let enabledForUrl = null;

  // Read the site's last value, even when this node currently shows our edit.
  function originalText(node) {
    const previous = previousText.get(node);
    return previous && node.nodeValue === previous.replacement ? previous.original : node.nodeValue;
  }

  function textNodes(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function sourceLabel(element) {
    return normalize(textNodes(element).map(originalText).join(""));
  }

  function replaceLabel(element, replacement, edits) {
    for (const node of textNodes(element)) {
      const original = originalText(node);
      if (!original.trim()) continue;
      edits.set(node, { original, replacement: original.replace(original.trim(), replacement) });
      replacement = "";
    }
  }

  function collectColumns(table, targets) {
    for (const headerRow of table.tHead?.rows ?? []) {
      const headers = [...headerRow.cells];
      if (headers.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)) continue;
      const columns = headers.filter((cell) => {
        const label = normalize(cell.textContent);
        return VAT_COLUMN.test(label) || WITHOUT_VAT.test(label);
      }).map((cell) => cell.cellIndex);
      if (!columns.length) continue;

      for (const row of table.rows) {
        const cells = [...row.cells];
        // A spanning note or grouped row does not share the header's column indexes.
        if (cells.length !== headers.length
          || cells.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)) continue;
        for (const column of columns) targets.add(cells[column]);
      }
    }
  }

  function collectSummary(section, targets) {
    for (const label of section.querySelectorAll("*")) {
      const name = normalize(label.textContent);
      if (!VAT_SUMMARY.test(name) && !WITHOUT_VAT.test(name)) continue;

      const row = label.parentElement;
      const definition = label.tagName === "DT" && label.nextElementSibling?.tagName === "DD";
      if (!definition && row.children.length !== 2) continue;
      const amount = definition ? label.nextElementSibling : label.nextElementSibling || label.previousElementSibling;
      if (!amount || !MONEY.test(normalize(amount.textContent))) continue;
      if (definition) {
        targets.add(label);
        targets.add(amount);
      } else {
        targets.add(row);
      }
    }
  }

  function updateMarkers(attribute, previous, current) {
    for (const element of previous) {
      if (!current.has(element)) element.removeAttribute(attribute);
    }
    for (const element of current) element.toggleAttribute(attribute, true);
  }

  function clean() {
    acceptSiteEdits(observer.takeRecords());
    const active = enabledForUrl === location.href && isSupportedSite();
    if (!active) {
      enabledForUrl = null;
      observer.disconnect();
    }
    document.documentElement.toggleAttribute(ACTIVE, active);
    const targets = new Set();
    const titles = new Set();
    const edits = new Map();

    if (active) {
      for (const invoice of document.querySelectorAll(".ip-doc")) {
        for (const heading of invoice.querySelectorAll(".ip-head, .ip-head *")) {
          if (!TAX_TITLE.test(sourceLabel(heading))) continue;
          if ([...heading.children].some((child) => TAX_TITLE.test(sourceLabel(child)))) continue;
          replaceLabel(heading, "Invoice", edits);
          titles.add(heading);
        }
        for (const table of invoice.querySelectorAll("table.ip-table")) {
          collectColumns(table, targets);
        }
        for (const section of invoice.querySelectorAll(".ip-closing-grid")) {
          collectSummary(section, targets);
        }
      }
    }

    updateMarkers(HIDDEN, previousTargets, targets);
    updateMarkers(TITLE, previousTitles, titles);
    previousTargets = targets;
    previousTitles = titles;

    for (const [node, change] of previousText) {
      if (!edits.has(node) && node.nodeValue === change.replacement) {
        node.nodeValue = change.original;
      }
    }
    for (const [node, change] of edits) {
      if (node.nodeValue !== change.replacement) node.nodeValue = change.replacement;
    }
    previousText = edits;
    // Ignore our title edit when observing the site for later updates.
    observer.takeRecords();
    return { supported: isSupportedSite(), hidden: active, matchedCount: targets.size + edits.size };
  }

  function acceptSiteEdits(records) {
    for (const record of records) {
      if (record.type === "characterData") previousText.delete(record.target);
    }
  }

  const observer = new MutationObserver((records) => {
    acceptSiteEdits(records);
    clean();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "helper-tools:get-state") {
      sendResponse(clean());
    } else if (message?.type === "helper-tools:hide-tdata") {
      if (isSupportedSite()) {
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
