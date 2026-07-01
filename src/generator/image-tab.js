/**
 * Image Tab Controller
 *
 * The Image tab is a single medium-based tab that hosts both the Create and
 * Modify image generators (previously separate top-level tabs). Create and
 * Modify are now an in-tab mode toggle; each mode is still driven by its own
 * GeneratorTabBase instance mounted into #create-tab / #modify-tab, so no
 * generation functionality changes here — this module only shows/hides the
 * relevant panel and keeps the toggle buttons in sync.
 */

const ImageTab = {
  // Default landing mode for the Image tab
  defaultMode: 'create',

  elements: {
    toggle: null,
    buttons: [],
    panels: {}
  },

  init() {
    this.elements.toggle = document.getElementById('image-mode-toggle');
    if (!this.elements.toggle) {
      console.error('Image Tab: mode toggle not found');
      return;
    }

    this.elements.buttons = Array.from(
      this.elements.toggle.querySelectorAll('.image-mode-button')
    );
    this.elements.panels = {
      create: document.getElementById('create-tab'),
      modify: document.getElementById('modify-tab')
    };

    this.elements.buttons.forEach((button) => {
      button.addEventListener('click', () => {
        this.setMode(button.dataset.mode);
      });
    });

    // Support legacy #create / #modify deep links by mapping them onto the
    // Image tab's mode. The main tab router falls back to the Image tab for
    // these hashes; here we select the matching mode.
    const hash = window.location.hash.slice(1).replace('-tab', '');
    const initialMode =
      hash === 'create' || hash === 'modify' ? hash : this.defaultMode;

    this.setMode(initialMode);
  },

  setMode(mode) {
    if (mode !== 'create' && mode !== 'modify') return;

    this.elements.buttons.forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
    });

    Object.entries(this.elements.panels).forEach(([panelMode, panel]) => {
      if (!panel) return;
      panel.classList.toggle('hidden', panelMode !== mode);
    });
  }
};

export default ImageTab;
