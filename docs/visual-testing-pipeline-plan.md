# Visual Testing Pipeline Plan: Legacy vs Managed Street Parity

## Goal

Automated **visual comparison** between the legacy Streetmix importer and the new Managed Street importer. The test captures screenshots from both import paths and compares them pixel-by-pixel.

---

## MVP Scope

| Decision | Choice |
|----------|--------|
| **Comparison type** | Visual only (screenshots) |
| **Test fixture** | `https://streetmix.net/kfarr/3/` |
| **Execution** | Manual only (no CI) |
| **DOM comparison** | Not needed - structures are intentionally different |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Playwright Test Runner                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Load legacy:    /#https://streetmix.net/kfarr/3/        │
│     └── Wait for scene loaded                               │
│     └── Set camera position                                 │
│     └── Capture screenshot → legacy.png                     │
│                                                             │
│  2. Load managed:   /?importer=managed#https://streetmix... │
│     └── Wait for scene loaded                               │
│     └── Set camera position (identical)                     │
│     └── Capture screenshot → managed.png                    │
│                                                             │
│  3. Compare with pixelmatch                                 │
│     └── Generate diff.png                                   │
│     └── Report pixel difference %                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Add URL Parameter for Import Mode

**File:** `src/json-utils_1.1.js`

**Change:** In the `set-loader-from-hash` component, check for `?importer=managed` URL parameter. If present, route Streetmix URLs to `managed-street` component instead of `streetmix-loader`.

```javascript
// Pseudocode for the change
const urlParams = new URLSearchParams(window.location.search);
const useManaged = urlParams.get('importer') === 'managed';

if (hash.includes('streetmix.net')) {
  if (useManaged) {
    // Create managed-street entity with sourceType: 'streetmix-url'
    AFRAME.INSPECTOR.execute('entitycreate', {
      components: {
        'managed-street': {
          sourceType: 'streetmix-url',
          sourceValue: streetmixUrl,
          synchronize: true
        }
      }
    });
  } else {
    // Existing legacy behavior
    el.setAttribute('streetmix-loader', 'streetmixStreetURL', streetmixUrl);
  }
}
```

### Step 2: Install Playwright

```bash
npm install -D @playwright/test
npx playwright install chromium
```

Add to `package.json`:
```json
{
  "scripts": {
    "test:visual": "playwright test test/parity/"
  }
}
```

### Step 3: Create Playwright Config

**File:** `playwright.config.js`

```javascript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/parity',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3333',
    viewport: { width: 1280, height: 720 },
    screenshot: 'on',
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3333',
    reuseExistingServer: true,
  },
});
```

### Step 4: Create Visual Test

**File:** `test/parity/visual-parity.spec.js`

```javascript
import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'fs';
import path from 'path';

const TEST_STREET = 'https://streetmix.net/kfarr/3/';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// Camera position for consistent comparison
const CAMERA_POSITION = { x: 0, y: 10, z: 30 };
const CAMERA_ROTATION = { x: -15, y: 0, z: 0 };

test.describe('Legacy vs Managed Street Visual Parity', () => {

  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
  });

  test('streetmix kfarr/3 renders identically', async ({ page }) => {
    // 1. Capture legacy version
    await page.goto(`/#${TEST_STREET}`);
    await waitForSceneLoaded(page);
    await setCameraPosition(page, CAMERA_POSITION, CAMERA_ROTATION);
    await page.waitForTimeout(2000); // Wait for assets to load

    const legacyPath = path.join(SCREENSHOT_DIR, 'legacy.png');
    await page.screenshot({ path: legacyPath });

    // 2. Capture managed version
    await page.goto(`/?importer=managed#${TEST_STREET}`);
    await waitForSceneLoaded(page);
    await setCameraPosition(page, CAMERA_POSITION, CAMERA_ROTATION);
    await page.waitForTimeout(2000);

    const managedPath = path.join(SCREENSHOT_DIR, 'managed.png');
    await page.screenshot({ path: managedPath });

    // 3. Compare screenshots
    const legacy = PNG.sync.read(fs.readFileSync(legacyPath));
    const managed = PNG.sync.read(fs.readFileSync(managedPath));
    const { width, height } = legacy;
    const diff = new PNG({ width, height });

    const numDiffPixels = pixelmatch(
      legacy.data,
      managed.data,
      diff.data,
      width,
      height,
      { threshold: 0.1 }
    );

    // Save diff image
    const diffPath = path.join(SCREENSHOT_DIR, 'diff.png');
    fs.writeFileSync(diffPath, PNG.sync.write(diff));

    // Calculate percentage
    const totalPixels = width * height;
    const diffPercent = (numDiffPixels / totalPixels) * 100;

    console.log(`
╔════════════════════════════════════════════════╗
║         VISUAL PARITY TEST RESULTS             ║
╠════════════════════════════════════════════════╣
║ Street: ${TEST_STREET.padEnd(35)}║
║ Total pixels:    ${totalPixels.toString().padEnd(25)}║
║ Different pixels: ${numDiffPixels.toString().padEnd(24)}║
║ Difference:      ${diffPercent.toFixed(2).padEnd(25)}%║
╠════════════════════════════════════════════════╣
║ Screenshots saved to: test/parity/screenshots/ ║
║   - legacy.png                                 ║
║   - managed.png                                ║
║   - diff.png                                   ║
╚════════════════════════════════════════════════╝
    `);

    // Fail if more than 5% different
    expect(diffPercent).toBeLessThan(5);
  });
});

async function waitForSceneLoaded(page) {
  await page.waitForFunction(() => {
    const scene = document.querySelector('a-scene');
    return scene && scene.hasLoaded;
  }, { timeout: 30000 });
}

async function setCameraPosition(page, position, rotation) {
  await page.evaluate(({ pos, rot }) => {
    const camera = document.querySelector('[camera]');
    if (camera) {
      camera.setAttribute('position', pos);
      camera.setAttribute('rotation', rot);
    }
  }, { pos: position, rot: rotation });
}
```

### Step 5: Add Dependencies

```bash
npm install -D pixelmatch pngjs
```

---

## File Structure

```
3dstreet/
├── playwright.config.js           # Playwright configuration
├── test/
│   └── parity/
│       ├── visual-parity.spec.js  # Main visual test
│       └── screenshots/           # Generated screenshots
│           ├── legacy.png
│           ├── managed.png
│           └── diff.png
```

---

## Usage

```bash
# Start dev server (in one terminal)
npm start

# Run visual test (in another terminal)
npm run test:visual

# Or run with headed browser to watch
npx playwright test --headed
```

---

## Output

When the test runs, it produces:

1. **`legacy.png`** - Screenshot from legacy importer
2. **`managed.png`** - Screenshot from managed-street importer
3. **`diff.png`** - Visual diff highlighting differences in red
4. **Console report** - Pixel difference percentage

Example output:
```
╔════════════════════════════════════════════════╗
║         VISUAL PARITY TEST RESULTS             ║
╠════════════════════════════════════════════════╣
║ Street: https://streetmix.net/kfarr/3/         ║
║ Total pixels:    921600                        ║
║ Different pixels: 15234                        ║
║ Difference:      1.65%                         ║
╠════════════════════════════════════════════════╣
║ Screenshots saved to: test/parity/screenshots/ ║
╚════════════════════════════════════════════════╝
```

---

## Future Enhancements (Post-MVP)

1. **Multiple test streets** - Add more Streetmix URLs to test different segment types
2. **Multiple camera angles** - Top-down, street-level, etc.
3. **Threshold configuration** - Adjust acceptable pixel difference per test
4. **HTML report** - Side-by-side image comparison in browser
5. **CI integration** - Run on PRs with visual diff in comments

---

## Implementation Order

1. **Step 1: URL parameter** (~1-2 hours)
   - Modify `src/json-utils_1.1.js`
   - Test manually in browser

2. **Step 2-5: Playwright setup** (~2-3 hours)
   - Install dependencies
   - Create config and test file
   - Run first comparison

**Total estimated time: 3-5 hours**

---

## Ready to Implement?

This plan is ready for implementation. The first step is modifying `src/json-utils_1.1.js` to add the `?importer=managed` URL parameter support.
