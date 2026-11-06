let hudId = 0;

const icon = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true"><g class="meshpad-icon-outline">${paths}</g>${paths}</svg>`;
const heart = icon('<path d="M12 21 3.4 12.6a5.5 5.5 0 0 1 7.8-7.8l.8.8.8-.8a5.5 5.5 0 0 1 7.8 7.8Z"/>');
const difficultyLabels = { normal: 'Normal', hard: 'Hard', 'very-hard': 'Very hard', 'ultra-hard': 'Ultra hard' };

export function createHUD(root, levels, actions) {
  const titleId = `meshpad-result-title-${++hudId}`;
  const layer = document.createElement('div');
  layer.className = 'meshpad-hud';
  layer.innerHTML = `
    <header class="meshpad-top">
      <nav aria-label="Level navigation">
        <h1 aria-live="polite" aria-atomic="true"><button type="button" class="meshpad-level-chooser" data-action="levels" aria-haspopup="dialog" aria-expanded="false"><span class="meshpad-level-label"></span>${icon('<path d="m6 9 6 6 6-6"/>')}</button></h1>
        <div class="meshpad-resource" hidden></div>
        <div class="meshpad-hud-actions">
          <button type="button" data-action="restart" aria-label="Restart level">
            ${icon('<path d="M4 10a8 8 0 1 1 1.8 7M4 4v6h6"/>')}
          </button>
        </div>
      </nav>
    </header>
    <section class="meshpad-overlay" hidden>
      <div class="meshpad-panel" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
        <h2 id="${titleId}"></h2>
        <p class="meshpad-result-detail" hidden></p>
        <div class="meshpad-levels" hidden></div>
        <button type="button" class="meshpad-primary"><span class="meshpad-button-label"></span></button>
        <button type="button" class="meshpad-secondary" hidden><span class="meshpad-button-label">Retry</span></button>
      </div>
    </section>`;
  root.append(layer);
  const find = (selector) => layer.querySelector(selector);
  const top = find('.meshpad-top');
  const levelLabel = find('.meshpad-level-label');
  const levelsButton = find('[data-action="levels"]');
  const restart = find('[data-action="restart"]');
  const resource = find('.meshpad-resource');
  const overlay = find('.meshpad-overlay');
  const panel = find('.meshpad-panel');
  const title = find('h2');
  const detail = find('.meshpad-result-detail');
  const levelList = find('.meshpad-levels');
  levelList.id = `meshpad-levels-${hudId}`;
  levelsButton.setAttribute('aria-controls', levelList.id);
  const primary = find('.meshpad-primary');
  const secondary = find('.meshpad-secondary');
  const primaryLabel = find('.meshpad-button-label');
  const listeners = new AbortController();
  const listen = (element, event, callback) => element.addEventListener(event, callback, { signal: listeners.signal });
  let index = 0;
  let returnFocus;
  let showingLevels = false;
  let resultAction = actions.restart;
  let resourceKey;
  const hideResult = () => {
    const restoreFocus = panel.contains(document.activeElement);
    overlay.hidden = true;
    levelsButton.setAttribute('aria-expanded', 'false');
    top.inert = false;
    if (restoreFocus) {
      const target = top.contains(returnFocus) && !returnFocus.disabled ? returnFocus : restart;
      target.focus({ preventScroll: true });
    }
  };
  const show = () => {
    if (overlay.hidden) returnFocus = document.activeElement;
    top.inert = true;
    overlay.hidden = false;
    primary.focus({ preventScroll: true });
  };
  const closeLevels = () => {
    showingLevels = false;
    hideResult();
    actions.closeLevels();
  };
  listen(restart, 'click', actions.restart);
  listen(primary, 'click', () => resultAction());
  listen(secondary, 'click', actions.restart);
  listen(levelsButton, 'click', () => {
    actions.openLevels();
    showingLevels = true;
    panel.dataset.view = 'levels';
    levelsButton.setAttribute('aria-expanded', 'true');
    title.textContent = 'Choose a level';
    detail.hidden = true;
    levelList.hidden = false;
    secondary.hidden = true;
    primaryLabel.textContent = 'Back to game';
    resultAction = closeLevels;
    show();
    const selected = levelList.querySelector('[aria-current]');
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: 'nearest' });
  });
  levels.forEach((level, levelIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Level ${levelIndex + 1}${level.name ? `: ${level.name}` : ''}`);
    const info = document.createElement('span');
    info.className = 'meshpad-level-info';
    const number = document.createElement('span');
    number.className = 'meshpad-level-number';
    number.textContent = `Level ${levelIndex + 1}`;
    info.append(number);
    if (level.name) {
      const name = document.createElement('span');
      name.className = 'meshpad-level-name';
      name.textContent = level.name;
      name.title = level.name;
      info.append(name);
    }
    const difficulty = document.createElement('span');
    difficulty.id = `meshpad-difficulty-${hudId}-${levelIndex}`;
    difficulty.className = 'meshpad-difficulty';
    difficulty.dataset.difficulty = level.difficulty ?? 'normal';
    difficulty.textContent = difficultyLabels[difficulty.dataset.difficulty];
    button.setAttribute('aria-describedby', difficulty.id);
    button.append(info, difficulty);
    listen(button, 'click', () => actions.loadLevel(levelIndex));
    levelList.append(button);
  });
  listen(panel, 'keydown', (event) => {
    if (event.key === 'Escape' && showingLevels) { event.preventDefault(); closeLevels(); }
    if (event.key === 'Tab') {
      const buttons = [...panel.querySelectorAll('button')].filter((button) => button.offsetParent !== null && !button.disabled);
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault(); first.focus();
      }
    }
  });
  const updateResource = (failure) => {
    const { type, remaining, initial } = failure;
    resource.hidden = type === 'default';
    top.dataset.mode = type;
    if (type === 'default') { resourceKey = undefined; return; }
    const seconds = Math.ceil(Math.max(0, remaining - 1e-9));
    const display = type === 'time' ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : String(remaining);
    const key = `${type}:${initial}:${display}`;
    if (resourceKey === key) return;
    resourceKey = key;
    resource.className = `meshpad-resource meshpad-resource-${type}`;
    resource.dataset.low = String(type === 'hearts' ? remaining <= 1 : remaining <= (type === 'time' ? 10 : 3));
    resource.setAttribute('role', type === 'time' ? 'timer' : 'img');
    resource.setAttribute('aria-label', type === 'hearts' ? `${remaining} of ${initial} hearts` : type === 'time' ? `${display} remaining` : `${remaining} moves remaining`);
    if (type === 'hearts') {
      resource.innerHTML = Array.from({ length: initial }, (_, i) => `<span class="meshpad-heart${i >= remaining ? ' meshpad-heart-empty' : ''}" aria-hidden="true">${heart}</span>`).join('');
    } else {
      resource.innerHTML = `<span class="meshpad-resource-label">${type === 'time' ? 'Time' : 'Moves'}</span><span class="meshpad-resource-value">${display}</span>`;
    }
  };
  return {
    hideResult,
    resource: updateResource,
    reset(nextIndex, failure) {
      index = nextIndex;
      showingLevels = false;
      levelLabel.textContent = `Level ${index + 1}`;
      levelsButton.setAttribute('aria-label', `Level ${index + 1}, choose level`);
      [...levelList.children].forEach((button, i) => {
        if (i === index) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      });
      updateResource(failure);
      hideResult();
    },
    result(status, failure) {
      showingLevels = false;
      panel.dataset.view = 'result';
      levelsButton.setAttribute('aria-expanded', 'false');
      levelList.hidden = true;
      const won = status === 'won';
      const hasNext = won && index < levels.length - 1;
      const canPlayOn = status === 'failed' && failure && failure.type !== 'default';
      title.textContent = won ? 'Level complete!' : status === 'error' ? 'Something went wrong' : failure?.remaining === 0 ? ({ hearts: 'Out of hearts!', time: 'Time’s up!', moves: 'Out of moves!' }[failure.type]) : 'Try again!';
      detail.hidden = !canPlayOn;
      if (canPlayOn) detail.textContent = failure.type === 'hearts' ? 'Refill your hearts and keep going.' : `Keep going with +${failure.playOnAmount} ${failure.type === 'time' ? 'seconds' : 'moves'}.`;
      primaryLabel.textContent = canPlayOn ? 'Play on' : hasNext ? 'Next level' : won ? 'Play again' : 'Retry';
      secondary.hidden = !canPlayOn;
      resultAction = canPlayOn ? actions.playOn : hasNext ? actions.next : actions.restart;
      show();
    },
    dispose() { listeners.abort(); layer.remove(); },
  };
}
