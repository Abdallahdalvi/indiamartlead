# LeadSync for IndiaMART

> **Production-ready Chrome Extension (MV3)** — Automatically import IndiaMART leads into Google Sheets with SHA-256 deduplication, Google OAuth 2.0, and a polished React UI.

---

## Features at a Glance

| Feature | Details |
|---|---|
| **Lead extraction** | Buyer Name, Company, Mobile, Email, Product, Quantity, Budget, Requirement, City, State, Lead Date, Source URL |
| **Deduplication** | SHA-256 hash stored in column A — reads only that column, O(1) lookup, never re-imports |
| **Auth** | Google OAuth 2.0 via `chrome.identity` — tokens stored securely in `chrome.storage.session` |
| **Sheet safety** | `INSERT_ROWS` append — never overwrites existing data, preserves formulas/filters/formatting |
| **Rate limiting** | Exponential backoff (1 s → 32 s) with `Retry-After` header support, max 5 retries |
| **SPA support** | `MutationObserver` + history API patching detects IndiaMART's React-based SPA navigation |
| **Side panel** | Chrome native `sidePanel` API (Chrome 114+) with editable lead form before import |
| **Auto-sync** | Toggle to automatically sync leads while browsing IndiaMART |
| **Import log** | Rolling 500-entry history with status, lead summary, timestamp |

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| npm | ≥ 9 |
| Chrome | ≥ 114 (for Side Panel API) |
| Google Cloud account | Free tier is sufficient |

---

## 1. Google Cloud Setup

> [!IMPORTANT]
> You **must** complete this step before the extension can authenticate. The OAuth Client ID links your extension to your Google Cloud project.

### Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project → New Project**
3. Name it `LeadSync for IndiaMART`, click **Create**

### Step 2 — Enable required APIs

In your project, go to **APIs & Services → Library** and enable:

- **Google Sheets API**
- **Google Drive API**

### Step 3 — Create an OAuth 2.0 Client ID

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. Select application type: **Chrome Extension**
4. Enter the extension ID (see note below) or use `*` for development
5. Click **Create** — copy the **Client ID**

> [!NOTE]
> **Finding your Extension ID**: Load the unpacked extension once (step 3 below), then copy the ID from `chrome://extensions`. Come back and enter it here.

### Step 4 — Configure the Client ID

Open `public/manifest.json` and replace the placeholder:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

---

## 2. Installation

```bash
# Clone or download the project
cd leadsync-indiamart

# Install dependencies
npm install

# Build the extension
npm run build
```

The `dist/` folder is now ready to load into Chrome.

---

## 3. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder inside this project

The LeadSync icon will appear in your Chrome toolbar.

---

## 4. First-time Setup

1. **Click the LeadSync icon** in the toolbar
2. Click **Connect Google Account** → sign in and grant permissions
3. Under **Spreadsheet**, click Refresh and select your target spreadsheet
4. Under **Worksheet**, select the tab where leads should be imported
5. Navigate to an IndiaMART lead page — the extension auto-detects it

---

## 5. Development Workflow

```bash
# Watch mode (rebuilds on every change)
npm run dev

# Type-check only (no output)
npm run type-check

# Production build
npm run build
```

After any code change in watch mode, go to `chrome://extensions` and click the **↻ refresh** button on the LeadSync card.

---

## Project Structure

```
leadsync-indiamart/
├── public/
│   ├── manifest.json          ← MV3 manifest (edit Client ID here)
│   └── icons/                 ← Extension icons (16, 32, 48, 128 px)
├── popup.html                 ← Popup entry point
├── sidepanel.html             ← Side panel entry point
├── vite.config.ts             ← Main Vite build (popup, sidepanel, background)
├── vite.content.config.ts     ← Separate IIFE build for content script
└── src/
    ├── background/
    │   ├── index.ts           ← Service worker entry + message router
    │   ├── auth.ts            ← OAuth 2.0 (chrome.identity)
    │   ├── sheets.ts          ← Google Sheets & Drive API service
    │   ├── dedup.ts           ← SHA-256 dedup index (in-memory Set)
    │   ├── sync.ts            ← Lead sync orchestrator
    │   └── rateLimit.ts       ← Exponential backoff + apiRequest()
    ├── content/
    │   ├── index.ts           ← Content script entry (IIFE bundle)
    │   ├── extractor.ts       ← Multi-strategy lead scraper
    │   └── observer.ts        ← SPA navigation watcher
    ├── hooks/
    │   ├── useAuth.ts         ← Google auth state hook
    │   ├── useSheets.ts       ← Spreadsheet/worksheet config hook
    │   └── useLeads.ts        ← Lead sync + stats + log hook
    ├── components/
    │   ├── AuthButton.tsx
    │   ├── SpreadsheetPicker.tsx
    │   ├── WorksheetPicker.tsx
    │   ├── SyncButton.tsx
    │   ├── ImportLog.tsx
    │   ├── LeadCard.tsx
    │   └── StatusBadge.tsx
    ├── popup/
    │   ├── App.tsx            ← Main popup UI
    │   └── main.tsx
    ├── sidepanel/
    │   ├── App.tsx            ← Side panel UI
    │   └── main.tsx
    ├── types/index.ts         ← All shared TypeScript types
    ├── constants.ts           ← Sheet columns, API URLs, storage keys
    ├── utils/
    │   ├── hash.ts            ← SHA-256 via Web Crypto API
    │   ├── storage.ts         ← Typed chrome.storage wrappers
    │   └── logger.ts          ← Import log persistence
    └── styles/index.css       ← TailwindCSS + global styles
```

---

## Sheet Layout

| Col | Field | Notes |
|-----|-------|-------|
| **A** | Lead ID | SHA-256 hash — used for deduplication. Can be hidden. |
| B | Buyer Name | |
| C | Company | |
| D | Mobile | |
| E | Email | |
| F | Product | |
| G | Quantity | |
| H | Budget | |
| I | Requirement | |
| J | City | |
| K | State | |
| L | Lead Date | |
| M | Source URL | |
| N | Imported At | ISO 8601 timestamp |

---

## How Deduplication Works

```
On sync:
  1. Compute SHA256(phone + "|" + company + "|" + product)
       └─ Fallback: SHA256("fb:" + name + "|" + company + "|" + product)
  2. Fetch column A only → build in-memory Set<string>  [one API call]
  3. Check if hash is in Set → skip if true
  4. Append row with INSERT_ROWS → never overwrites existing data
  5. Add new hash to Set → subsequent leads skip the API call
```

---

## Permissions Explained

| Permission | Reason |
|---|---|
| `identity` | OAuth 2.0 token acquisition via `chrome.identity.getAuthToken` |
| `storage` | Persist config, auth state, import log, sync stats |
| `tabs` | Read active tab URL to show "IndiaMART active" indicator |
| `sidePanel` | Open the native Chrome side panel |
| `scripting` | For future scripted extraction (currently unused) |
| `alarms` | Keep-alive alarm to prevent MV3 service worker from being killed |
| `notifications` | Optional: auto-sync result notifications |

---

## Troubleshooting

### "Authentication failed" on sign-in
- Verify the Client ID in `public/manifest.json` is correct
- Ensure your Google Cloud project has **Sheets API** and **Drive API** enabled
- Make sure the extension ID in the OAuth credential matches your loaded extension's ID

### No leads extracted on IndiaMART
- IndiaMART periodically updates their DOM structure — the extractor uses fallback selectors but may need updating
- Open Chrome DevTools on the IndiaMART page, inspect the buyer name element, and add its CSS class to `src/content/extractor.ts → SELECTORS.buyerName`

### "No active tab" error on Sync All
- Make sure you're on an IndiaMART tab (not the popup)
- The popup sends the "SYNC_ALL_LEADS" message to the active IndiaMART tab's content script

### Side panel doesn't open
- Chrome 114+ is required for the `sidePanel` API
- Click "View & Edit Lead Details" in the popup to open it

### Rate limit errors (429)
- The extension automatically retries with exponential backoff (up to 32 s)
- If you're doing large bulk imports, increase `RATE_LIMIT.BASE_DELAY_MS` in `src/constants.ts`

---

## Tech Stack

- **React 18** + **TypeScript 5**
- **Vite 5** (two-config build: ES module + IIFE)
- **TailwindCSS 3** + **Lucide React** icons
- **Chrome Extension Manifest V3**
- **Google Sheets API v4** + **Drive API v3**
- **Web Crypto API** (SHA-256, no external dependencies)

---

## License

MIT — use freely, attribute appreciated.
