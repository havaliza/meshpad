export function createHUD(root, levels, actions) {
  const layer = document.createElement('div');
  layer.className = 'meshpad-hud';
  layer.innerHTML = `
    <header class="meshpad-top">
      <nav aria-label="Level navigation">
        <button type="button" data-action="previous" aria-label="Previous level">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path class="meshpad-icon-outline" d="M19 12H5m6 6-6-6 6-6" />
            <path d="M19 12H5m6 6-6-6 6-6" />
          </svg>
        </button>
        <h1 aria-live="polite" aria-atomic="true" tabindex="-1"></h1>
        <button type="button" data-action="next" aria-label="Next level">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path class="meshpad-icon-outline" d="M5 12h14m-6-6 6 6-6 6" />
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </button>
      </nav>
    </header>
    <section class="meshpad-overlay" hidden>
      <div class="meshpad-panel" role="dialog" aria-modal="true" aria-labelledby="meshpad-result-title" tabindex="-1">
        <h2 id="meshpad-result-title"></h2>
        <button type="button" class="meshpad-primary"><span class="meshpad-button-label"></span></button>
      </div>
    </section>`;
  root.append(layer);
  const find = (selector) => layer.querySelector(selector);
  const top = find('.meshpad-top');
  const heading = find('h1');
  const previous = find('[data-action="previous"]');
  const next = find('[data-action="next"]');
  const overlay = find('.meshpad-overlay');
  const panel = find('.meshpad-panel');
  const primary = find('.meshpad-primary');
  const primaryLabel = find('.meshpad-button-label');
  const listeners = new AbortController();
  const listen = (element, event, callback) => element.addEventListener(event, callback, { signal: listeners.signal });
  listen(previous, 'click', actions.previous);
  listen(next, 'click', actions.next);
  let resultAction = actions.restart;
  listen(primary, 'click', () => resultAction());
  listen(panel, 'keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      primary.focus();
    }
  });
  let index = 0;
  let returnFocus;
  const hideResult = () => {
    const restoreFocus = panel.contains(document.activeElement);
    overlay.hidden = true;
    top.inert = false;
    if (restoreFocus) {
      const target = top.contains(returnFocus) && !returnFocus.disabled ? returnFocus : !next.disabled ? next : !previous.disabled ? previous : heading;
      target.focus({ preventScroll: true });
    }
  };
  return {
    reset(nextIndex) {
      index = nextIndex;
      heading.textContent = `Level ${index + 1}`;
      previous.disabled = index === 0;
      next.disabled = index === levels.length - 1;
      hideResult();
    },
    result(status) {
      const won = status === 'won';
      const hasNext = won && index < levels.length - 1;
      find('h2').textContent = won ? 'Level complete!' : status === 'error' ? 'Something went wrong' : 'Try again!';
      primaryLabel.textContent = hasNext ? 'Next level' : won ? 'Play again' : 'Retry';
      resultAction = hasNext ? actions.next : actions.restart;
      returnFocus = document.activeElement;
      top.inert = true;
      overlay.hidden = false;
      primary.focus({ preventScroll: true });
    },
    dispose() { listeners.abort(); layer.remove(); },
  };
}
