(() => {
  "use strict";

  const ACTIVE = "data-darbex-active";
  const HIDDEN = "data-darbex-hidden";
  const VAT_COLUMN = /^vat included\s*\(\s*5\s*%\s*\)$/i;
  const VAT_SUMMARY = /^vat included$/i;
  const SUBTOTAL = /^subtotal excluding vat$/i;
  const TAX_TITLE = /^tax invoice$/i;
  const UNIT_PRICE = /^unit price\s*\(\s*incl\.?\s+vat\s*\)$/i;
  const MONEY = /^(?:AED\s*)?(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?:\s*AED)?$/i;
  const SUMMARY_FIELDS = [
    ["vat", VAT_SUMMARY],
    ["subtotal", SUBTOTAL],
    ["total", /^(?:grand )?total$/i],
    ["paid", /^(?:paid(?: amount)?|amount paid)$/i],
    ["balance", /^(?:balance(?: due)?|amount due)$/i]
  ];
  const normalize = (value) => value.replace(/\s+/g, " ").trim();
  const isSupportedSite = () => location.hostname === "tanseek.ae";

  if (!isSupportedSite()) return;

  let previousTargets = new Set();
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

  function readMoney(cell) {
    if (!cell) return null;
    const nodes = textNodes(cell);
    const match = MONEY.exec(normalize(nodes.map(originalText).join("")));
    if (!match) return null;
    const token = match[1];
    const cents = Number(token.replace(/[,.]/g, ""));
    const node = nodes.find((part) => originalText(part).includes(token));
    return node && Number.isSafeInteger(cents) ? { node, token, cents } : null;
  }

  function setMoney(money, cents, edits) {
    if (money.cents === cents || !Number.isSafeInteger(cents)) return;
    const amount = (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: money.token.includes(",")
    });
    const original = originalText(money.node);
    edits.set(money.node, { original, replacement: original.replace(money.token, amount) });
  }

  function collectColumn(table, targets, edits) {
    const header = [...table.querySelectorAll("thead th")].find((cell) =>
      cell.closest("table") === table && VAT_COLUMN.test(normalize(cell.textContent))
    );
    if (!header) return;

    const headerCells = [...header.parentElement.cells];
    if (headerCells.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)) return;
    const vatColumn = headerCells.indexOf(header);
    const columns = headerCells.map(sourceLabel);
    const amountColumn = columns.findIndex((label) => /^amount$/i.test(label));
    const qtyColumn = columns.findIndex((label) => /^(?:qty|quantity)$/i.test(label));
    const unitColumn = columns.findIndex((label) => UNIT_PRICE.test(label));
    if (unitColumn >= 0 && qtyColumn >= 0) {
      replaceLabel(headerCells[unitColumn], "Unit price", edits);
    }

    for (const row of table.rows) {
      const cells = [...row.cells];
      // Skip full-width notes and other spanning rows.
      if (cells.length !== columns.length
        || cells.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)) continue;
      targets.add(cells[vatColumn]);
      if (row.parentElement.tagName !== "TBODY") continue;
      const vat = readMoney(cells[vatColumn]);
      if (!vat) continue;
      const amount = readMoney(cells[amountColumn]);
      if (amount) setMoney(amount, amount.cents - vat.cents, edits);
      const unit = readMoney(cells[unitColumn]);
      const qty = Number(cells[qtyColumn]?.textContent.trim().replaceAll(",", ""));
      if (unit && Number.isFinite(qty) && qty !== 0) {
        setMoney(unit, Math.round(unit.cents - vat.cents / qty), edits);
      }
    }
  }

  function collectSummary(section, targets, edits) {
    const fields = new Map();
    // Each invoice variant pairs its labels and amounts in rows or a definition list.
    for (const label of section.querySelectorAll("*")) {
      const name = sourceLabel(label);
      const field = SUMMARY_FIELDS.find(([, pattern]) => pattern.test(name))?.[0];
      if (!field) continue;
      if (field === "subtotal") replaceLabel(label, "Subtotal", edits);
      const row = label.parentElement;
      const definition = label.tagName === "DT" && label.nextElementSibling?.tagName === "DD";
      if (!definition && row.children.length !== 2) continue;
      const cell = definition ? label.nextElementSibling : label.nextElementSibling || label.previousElementSibling;
      const money = readMoney(cell);
      if (!money) continue;
      fields.set(field, money);
      if (field === "vat") {
        targets.add(definition ? label : row);
        if (definition) targets.add(cell);
      }
    }

    const total = fields.get("total");
    if (!total) return;
    const vat = fields.get("vat");
    const net = vat ? total.cents - vat.cents : fields.get("subtotal")?.cents;
    if (net === undefined) return;
    setMoney(total, net, edits);

    const balance = fields.get("balance");
    if (balance) {
      const paid = fields.get("paid");
      const due = paid ? net - paid.cents : balance.cents - (total.cents - net);
      setMoney(balance, balance.cents < 0 ? due : Math.max(0, due), edits);
    }
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
    const edits = new Map();

    if (active) {
      for (const invoice of document.querySelectorAll(".ip-doc")) {
        for (const heading of invoice.querySelectorAll(".ip-head :is(h1, h2, h3)")) {
          if (TAX_TITLE.test(sourceLabel(heading))) replaceLabel(heading, "INVOICE", edits);
        }
        for (const table of invoice.querySelectorAll("table.ip-table")) {
          collectColumn(table, targets, edits);
        }
        for (const section of invoice.querySelectorAll(".ip-closing-grid")) {
          collectSummary(section, targets, edits);
        }
      }
    }

    for (const element of previousTargets) {
      if (!targets.has(element)) element.removeAttribute(HIDDEN);
    }
    for (const element of targets) element.setAttribute(HIDDEN, "");
    previousTargets = targets;

    for (const [node, change] of previousText) {
      if (!edits.has(node) && node.nodeValue === change.replacement) {
        node.nodeValue = change.original;
      }
    }
    for (const [node, change] of edits) {
      if (node.nodeValue !== change.replacement) node.nodeValue = change.replacement;
    }
    previousText = edits;
    // Discard our synchronous text writes so they never become new invoice inputs.
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
