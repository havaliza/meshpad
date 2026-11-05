export function createHUD(root, levels, actions) {
  const layer = document.createElement('div');
  layer.className = 'meshpad-hud';
  layer.innerHTML = `
    <header class="meshpad-top">
      <div class="meshpad-brand">MESHPAD <span>PLAYGROUND</span></div>
      <div class="meshpad-heading"><h1></h1><output class="meshpad-score"></output></div>
      <p class="meshpad-message" aria-live="polite"></p>
      <progress class="meshpad-progress" max="1" value="0" aria-label="Level progress" hidden></progress>
    </header>
    <footer class="meshpad-bottom">
      <p class="meshpad-hint"></p>
      <nav aria-label="Level navigation">
        <button type="button" data-action="previous" aria-label="Previous level">←</button>
        <label class="meshpad-picker"><span>LEVEL</span><select aria-label="Choose level"></select></label>
        <button type="button" data-action="next" aria-label="Next level">→</button>
        <button type="button" data-action="restart" aria-label="Restart level">↻</button>
      </nav>
    </footer>
    <section class="meshpad-overlay" hidden>
      <div class="meshpad-panel" role="dialog" aria-modal="true" aria-labelledby="meshpad-result-title" tabindex="-1">
        <span class="meshpad-result-icon" aria-hidden="true"></span>
        <h2 id="meshpad-result-title"></h2><p class="meshpad-result-message"></p>
        <button type="button" class="meshpad-primary"></button>
        <button type="button" class="meshpad-secondary">Try again</button>
      </div>
    </section>`;
  root.append(layer);
  const find = (selector) => layer.querySelector(selector);
  const select = find('select');
  levels.forEach((level, index) => select.add(new Option(`${String(index + 1).padStart(2, '0')} · ${level.name ?? `Level ${index + 1}`}`, String(index))));
  const listeners = new AbortController();
  const listen = (element, event, callback) => element.addEventListener(event, callback, { signal: listeners.signal });
  for (const name of ['previous', 'next', 'restart']) {
    listen(find(`[data-action="${name}"]`), 'click', actions[name]);
  }
  listen(select, 'change', () => actions.loadLevel(Number(select.value)));
  let resultAction = actions.restart;
  listen(find('.meshpad-primary'), 'click', () => resultAction());
  listen(find('.meshpad-secondary'), 'click', actions.restart);
  listen(find('.meshpad-panel'), 'keydown', (event) => {
    if (event.key !== 'Tab') return;
    const buttons = [...find('.meshpad-panel').querySelectorAll('button')].filter((button) => !button.hidden);
    if (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === find('.meshpad-panel'))) {
      event.preventDefault(); buttons[buttons.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
      event.preventDefault(); buttons[0].focus();
    }
  });
  let index = 0;
  let model;
  const update = (patch) => {
    model = { ...model, ...patch };
    for (const [key, selector] of Object.entries({ title: 'h1', score: '.meshpad-score', message: '.meshpad-message', hint: '.meshpad-hint' })) {
      find(selector).textContent = model[key] ?? '';
    }
    const progress = find('progress');
    progress.hidden = model.progress == null;
    progress.value = Number.isFinite(model.progress) ? Math.max(0, Math.min(1, model.progress)) : 0;
  };
  const hideResult = () => {
    if (find('.meshpad-panel').contains(document.activeElement)) select.focus();
    find('.meshpad-overlay').hidden = true;
    find('.meshpad-top').inert = false;
    find('.meshpad-bottom').inert = false;
  };
  return {
    update,
    reset(nextIndex) {
      index = nextIndex;
      model = {};
      select.value = String(index);
      find('[data-action="previous"]').disabled = index === 0;
      find('[data-action="next"]').disabled = index === levels.length - 1;
      hideResult();
      update({ title: levels[index].name ?? `Level ${index + 1}`, message: '', score: '', hint: '', progress: null });
    },
    result(status, message) {
      const won = status === 'won';
      const error = status === 'error';
      const hasNext = won && index < levels.length - 1;
      find('.meshpad-result-icon').textContent = won ? '✦' : error ? '!' : '↻';
      find('h2').textContent = won ? 'Level complete' : error ? 'Something went wrong' : 'Give it another go';
      find('.meshpad-result-message').textContent = message ?? (won ? 'Nicely done. Ready for the next one?' : 'A fresh start is one tap away.');
      find('.meshpad-primary').textContent = hasNext ? 'Next level →' : won ? 'Play again' : 'Retry';
      find('.meshpad-secondary').hidden = !hasNext;
      resultAction = hasNext ? actions.next : actions.restart;
      find('.meshpad-top').inert = true;
      find('.meshpad-bottom').inert = true;
      find('.meshpad-overlay').hidden = false;
      find('.meshpad-primary').focus({ preventScroll: true });
    },
    hideResult,
    dispose() { listeners.abort(); layer.remove(); },
  };
}
