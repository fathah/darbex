# Tanseek Helper Tools

Click the extension icon and choose **Hide TData** to hide the **Amount without VAT**
and **VAT included (5%)** columns, along with the **Subtotal excluding VAT** and
**VAT included** summary lines. The title changes from **TAX INVOICE** to **INVOICE**.
The screen and browser printout use the invoice's original unit prices, line
amounts, total, paid amount, and balance due.

[Download ZIP](https://github.com/fathah/darbex/raw/refs/heads/main/helper-tools.zip)
· [Download CRX](https://github.com/fathah/darbex/raw/refs/heads/main/helper-tools.crx)

## Install in Chrome

For ordinary Chrome installations on macOS and Windows, use the ZIP:

1. Download and extract `helper-tools.zip` into a folder you will keep.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Refresh the invoice print page.
5. Click the extension icon (pin it from Chrome's Extensions menu if desired),
   then click **Hide TData**.

Use **Print → Save as PDF** for a PDF with the adjusted layout. The website's
separate Download PDF button may generate its own output.

Chrome restricts direct installation of self-hosted CRX files on macOS and
Windows. The signed CRX is provided for environments that support that
distribution method; downloading it from GitHub does not remove Chrome's
installation restrictions. See [Chrome's distribution guidance](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux).

Invoice fields stay visible until you click **Hide TData**. The action applies
only to the current page, including content that finishes loading after the
click. Refreshing the page restores the original fields and title.
Other invoice tabs keep their original layout until you click the button there.

For an update, replace the extracted files, reload the extension in Chrome, and
refresh the invoice page. Refreshing clears any figures displayed by version 1.0.5. These downloads do not
provide automatic updates.

## Scope and privacy

The extension checks only the exact domain, with access to all its pages:

```text
*://tanseek.ae/*
```

**Hide TData** is available on any page on that domain, regardless of its path,
query string, or invoice variant. The [Chrome match pattern](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
covers HTTP and HTTPS. Other domains and subdomains are outside its scope.
The action changes only the supported English invoice elements when present,
including invoice content rendered later without a full page load. Refresh
already-open pages after installing or reloading the extension.

It reads page labels and invoice amounts locally to identify the columns and
summary rows to hide. It makes no network requests, stores no invoice data, uses no
analytics, and does not change saved invoice records. Original DOM nodes are
retained to preserve the website's rendering behavior.

## Development

Source files are in `extension/`. Node.js 22.13+ (or 24+) is needed only for
development; it is not needed to install the ZIP.

```sh
npm ci
npm test
npm run pack
```

`npm run pack` creates `helper-tools.crx`, `helper-tools.zip`, and
`SHA256SUMS.txt` at the project root. Only the `extension/` directory is packaged.
The script verifies the CRX3 signature and checks that its embedded ZIP matches
the standalone ZIP.

The private signing key is retained in `.local/helper-tools-signing.pem`, which
is excluded from Git. Keep a private backup and reuse it for future CRX updates.
The downloadable files contain no private signing key.

Automated DOM tests cover URL restrictions, reordered columns, delayed content,
preservation of invoice amounts, and restoration of the original invoice.
