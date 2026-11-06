import * as THREE from 'three';
import { createHUD } from './hud.js';
import { disposeScene } from './dispose.js';
import { createFailure } from './failure.js';

/** Create a mobile-first game. Every level gets its own scene and lifetime. */
export function createGame(options = {}) {
  const levels = options.levels;
  if (!Array.isArray(levels) || levels.length === 0 || levels.some((level) => typeof level?.setup !== 'function')) {
    throw new TypeError('Provide at least one level with a setup(context) function.');
  }
  if (levels.some((level) => level.difficulty !== undefined && !['normal', 'hard', 'very-hard', 'ultra-hard'].includes(level.difficulty))) {
    throw new TypeError('Level difficulty must be normal, hard, very-hard, or ultra-hard.');
  }
  const initial = options.initialLevel ?? 0;
  if (!Number.isInteger(initial) || initial < 0 || initial >= levels.length) throw new RangeError('initialLevel is out of range.');
  const defaultFailure = createFailure(options.failure);
  const failures = levels.map((level) => level.failure === undefined ? { ...defaultFailure } : createFailure(level.failure));
  const maxPixelRatio = options.maxPixelRatio ?? 2;
  const maxWidth = options.maxWidth ?? 540;
  if (!(Number.isFinite(maxPixelRatio) && maxPixelRatio > 0 && Number.isFinite(maxWidth) && maxWidth > 0)) {
    throw new RangeError('maxPixelRatio and maxWidth must be positive finite numbers.');
  }
  const root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root ?? document.body;
  if (!(root instanceof HTMLElement)) throw new Error('Game root was not found.');
  if (root.querySelector('.meshpad-stage')) throw new Error('This root already contains a Meshpad game.');
  const stage = document.createElement('main');
  stage.className = 'meshpad-stage';
  root.classList.add('meshpad-root');
  root.append(stage);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', ...options.renderer });
  } catch (error) {
    stage.remove(); root.classList.remove('meshpad-root');
    throw new Error('Meshpad needs a browser with WebGL 2 enabled.', { cause: error });
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = 'meshpad-canvas';
  renderer.domElement.setAttribute('aria-label', options.title ?? '3D game');
  stage.append(renderer.domElement);
  if (options.title) document.title = options.title;

  const params = new URLSearchParams(location.search);
  const capture = params.has('__meshpad_capture');
  const captureDpr = capture ? Number(params.get('__meshpad_dpr')) : 0;
  const lifetime = new AbortController();
  const listen = (target, type, handler, extra = {}) => target.addEventListener(type, handler, { ...extra, signal: lifetime.signal });
  let current;
  let status = 'loading';
  let disposed = false;
  let contextLost = false;
  let elapsed = 0;
  let previousTime;
  let frame = 0;
  let resizeFrame = 0;
  let generation = 0;
  let width = 1;
  let height = 1;
  let manuallyPaused = false;
  let levelMenuOpen = false;
  let lastError = null;
  const invoke = (callback) => { Promise.resolve().then(callback).catch(() => {}); };
  const hud = createHUD(stage, levels, {
    next: () => invoke(() => game.next()),
    restart: () => invoke(() => game.restart()),
    playOn: () => game.playOn(),
    loadLevel: (index) => invoke(() => game.loadLevel(index)),
    openLevels() {
      levelMenuOpen = true;
      if (status === 'playing') status = 'paused';
      stopLoop();
    },
    closeLevels() {
      levelMenuOpen = false;
      if (status === 'paused' && !manuallyPaused) status = 'playing';
      startLoop();
    },
  });
  const isCurrent = (session) => Boolean(session) && !disposed && current === session && !session.controller.signal.aborted;
  const report = (error, session = current) => {
    if (!isCurrent(session)) return;
    lastError = error instanceof Error ? error : new Error(String(error));
    status = 'error';
    levelMenuOpen = false;
    stopLoop();
    hud.result('error');
    options.onError?.(lastError);
  };
  const draw = () => {
    if (current?.hooks && !contextLost && !disposed) {
      try {
        current.hooks.beforeRender?.();
        renderer.render(current.scene, current.camera);
      } catch (error) { report(error); }
    }
  };
  const advance = (dt) => {
    if (status !== 'playing') return;
    elapsed += dt;
    try { current.hooks?.update?.(dt, elapsed); } catch (error) { report(error); }
    if (status === 'playing' && current.failure.type === 'time') {
      current.failure.remaining = Math.max(0, current.failure.remaining - dt);
      // Absorb floating point residue from fixed simulation substeps.
      if (current.failure.remaining < 1e-9) current.failure.remaining = 0;
      hud.resource(current.failure);
      if (current.failure.remaining === 0) finish(current, 'failed');
    }
  };
  function stopLoop() { cancelAnimationFrame(frame); frame = 0; previousTime = undefined; }
  const shouldRun = () => !capture && !disposed && !contextLost && !document.hidden && !manuallyPaused && status === 'playing';
  const tick = (time) => {
    frame = 0;
    if (!shouldRun()) return;
    const dt = previousTime == null ? 0 : Math.min((time - previousTime) / 1000, 0.05);
    previousTime = time;
    advance(dt);
    draw();
    if (shouldRun()) frame = requestAnimationFrame(tick);
  };
  const startLoop = () => { if (!frame && shouldRun()) frame = requestAnimationFrame(tick); };
  const finish = (session, outcome) => {
    if (!isCurrent(session) || !['playing', 'paused'].includes(status)) return false;
    status = outcome;
    levelMenuOpen = false;
    stopLoop();
    hud.result(outcome, session.failure);
    return true;
  };
  const consume = (session, type) => {
    if (!isCurrent(session) || status !== 'playing' || session.failure.type !== type) return false;
    session.failure.remaining = Math.max(0, session.failure.remaining - 1);
    hud.resource(session.failure);
    if (session.failure.remaining === 0) finish(session, 'failed');
    return true;
  };
  const resize = () => {
    if (disposed) return;
    const viewport = window.visualViewport;
    const fullPage = root === document.body;
    const bounds = root.getBoundingClientRect();
    const availableWidth = fullPage ? viewport?.width ?? innerWidth : bounds.width;
    height = Math.max(1, Math.round(fullPage ? viewport?.height ?? innerHeight : bounds.height));
    width = Math.max(1, Math.round(Math.min(availableWidth, maxWidth, height * 9 / 16)));
    if (fullPage) {
      root.style.height = `${height}px`;
      root.style.width = `${availableWidth}px`;
      root.style.top = `${viewport?.offsetTop ?? 0}px`;
      root.style.left = `${viewport?.offsetLeft ?? 0}px`;
    }
    stage.style.width = `${width}px`;
    renderer.setPixelRatio(captureDpr > 0 && captureDpr <= 4 ? captureDpr : Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    renderer.setSize(width, height, false);
    if (current) {
      if (current.autoResizeCamera && current.camera.isPerspectiveCamera) {
        current.camera.aspect = width / height;
        current.camera.updateProjectionMatrix();
      }
      try { current.hooks?.resize?.(width, height); draw(); } catch (error) { report(error); }
    }
  };
  const scheduleResize = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resize);
  };
  const cleanup = (session) => {
    if (!session) return;
    session.controller.abort();
    if (session.hooks && !session.hooksDisposed) {
      session.hooksDisposed = true;
      try { session.hooks.dispose?.(); } catch (error) { console.error('Level cleanup failed:', error); }
    }
    disposeScene(session.scene);
  };
  const loadLevel = async (index) => {
    if (disposed) throw new Error('This game has been disposed.');
    if (!Number.isInteger(index) || index < 0 || index >= levels.length) throw new RangeError('Level index is out of range.');
    const version = ++generation;
    stopLoop();
    cleanup(current);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(options.background ?? '#221e4e');
    scene.add(new THREE.HemisphereLight(0xefe3ff, 0x30245e, 2.5));
    const light = new THREE.DirectionalLight(0xfff4d8, 3);
    light.position.set(4, 8, 5);
    scene.add(light);
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 200);
    camera.position.set(5, 6, 9);
    camera.lookAt(0, 0, 0);
    const session = { index, scene, camera, failure: { ...failures[index] }, autoResizeCamera: true, controller: new AbortController(), hooks: null };
    current = session;
    status = 'loading'; elapsed = 0; lastError = null;
    levelMenuOpen = false;
    hud.reset(index, session.failure);
    const context = {
      scene, camera, renderer, level: levels[index], index,
      signal: session.controller.signal,
      get width() { return width; }, get height() { return height; },
      get failure() { return Object.freeze({ ...session.failure }); },
      win: () => finish(session, 'won'),
      fail: () => finish(session, 'failed'),
      mistake: () => consume(session, 'hearts'),
      move: () => consume(session, 'moves'),
    };
    try {
      const hooks = await levels[index].setup(context);
      session.hooks = hooks ?? {};
      if (disposed || version !== generation) {
        cleanup(session);
        return false;
      }
      session.camera = session.hooks.camera ?? camera;
      session.autoResizeCamera = session.hooks.autoResizeCamera ?? !session.hooks.camera;
      status = manuallyPaused || levelMenuOpen ? 'paused' : 'playing';
      resize();
      startLoop();
      return true;
    } catch (error) {
      if (!isCurrent(session)) { cleanup(session); return false; }
      report(error, session);
      cleanup(session);
      throw error;
    }
  };
  const game = {
    renderer,
    get scene() { return current?.scene; },
    get camera() { return current?.camera; },
    get state() { return Object.freeze({ status, index: current?.index ?? initial, elapsed, error: lastError,
      failure: Object.freeze({ ...(current?.failure ?? failures[initial]) }),
    }); },
    debug: () => isCurrent(current) ? current.hooks?.debug?.() ?? null : null,
    loadLevel,
    restart: () => loadLevel(current?.index ?? initial),
    next: () => loadLevel(Math.min((current?.index ?? initial) + 1, levels.length - 1)),
    previous: () => loadLevel(Math.max((current?.index ?? initial) - 1, 0)),
    win: () => finish(current, 'won'),
    fail: () => finish(current, 'failed'),
    mistake: () => consume(current, 'hearts'),
    move: () => consume(current, 'moves'),
    playOn() {
      if (!isCurrent(current) || status !== 'failed' || current.failure.type === 'default') return false;
      const failure = current.failure;
      failure.remaining = failure.type === 'hearts' ? failure.initial : failure.remaining + failure.playOnAmount;
      status = manuallyPaused ? 'paused' : 'playing';
      hud.resource(failure);
      hud.hideResult();
      try { current.hooks?.onPlayOn?.(); } catch (error) { report(error); return false; }
      draw();
      startLoop();
      return true;
    },
    pause() { manuallyPaused = true; if (status === 'playing') status = 'paused'; stopLoop(); },
    resume() { manuallyPaused = false; if (status === 'paused' && !levelMenuOpen) status = 'playing'; startLoop(); },
    step(seconds = 1 / 60) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new RangeError('step seconds must be between 0 and 60.');
      if (disposed) throw new Error('This game has been disposed.');
      const steps = Math.ceil(seconds * 60);
      for (let i = 0; i < steps; i++) advance(seconds / steps);
      draw();
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; status = 'disposed';
      stopLoop(); cancelAnimationFrame(resizeFrame);
      lifetime.abort(); observer.disconnect(); cleanup(current); hud.dispose();
      renderer.dispose(); renderer.forceContextLoss(); stage.remove();
      root.classList.remove('meshpad-root');
      for (const [property, value] of Object.entries(originalStyle)) root.style[property] = value;
      if (window.__MESHPAD__ === game) delete window.__MESHPAD__;
    },
  };
  const originalStyle = Object.fromEntries(['height', 'width', 'top', 'left'].map((key) => [key, root.style[key]]));
  const observer = new ResizeObserver(scheduleResize);
  observer.observe(root);
  for (const event of ['resize', 'orientationchange', 'pageshow']) listen(window, event, scheduleResize, { passive: true });
  for (const event of ['resize', 'scroll']) if (window.visualViewport) listen(window.visualViewport, event, scheduleResize, { passive: true });
  listen(document, 'visibilitychange', () => { stopLoop(); startLoop(); });
  listen(window, 'pagehide', stopLoop);
  listen(window, 'pageshow', startLoop);
  for (const event of ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'dragstart']) listen(stage, event, (e) => e.preventDefault(), { passive: false });
  listen(stage, 'touchmove', (event) => { if (event.touches.length > 1) event.preventDefault(); }, { passive: false });
  listen(renderer.domElement, 'webglcontextlost', (event) => {
    event.preventDefault(); contextLost = true; stopLoop();
  });
  listen(renderer.domElement, 'webglcontextrestored', () => {
    contextLost = false; resize(); startLoop();
  });
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) listen(renderer.domElement, type, (event) => {
    if (status !== 'playing') return;
    if (type === 'pointerdown') renderer.domElement.setPointerCapture(event.pointerId);
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    current.camera.updateMatrixWorld(); current.scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, current.camera);
    try {
      current.hooks?.pointer?.({ type, originalEvent: event, point: pointer.clone(), raycaster, hits: (objects = current.scene.children) => raycaster.intersectObjects(objects, true) });
    } catch (error) { report(error); }
  });
  resize();
  // The capture tool uses the same runtime and setup code as the interactive game.
  window.__MESHPAD__ = game;
  // Let the entry module finish initializing classes and constants. Explicit loads
  // or disposal before this microtask supersede the deferred initial load.
  game.ready = Promise.resolve().then(() => !disposed && generation === 0 ? loadLevel(initial) : false);
  game.ready.catch(() => {});
  return game;
}
