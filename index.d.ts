/// <reference types="vite/client" />
import type * as Three from 'three';
export * as THREE from 'three';

export interface GamePointer {
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';
  originalEvent: PointerEvent;
  /** Normalized device coordinates, from -1 to 1. */
  point: Three.Vector2;
  raycaster: Three.Raycaster;
  hits(objects?: Three.Object3D[]): Three.Intersection[];
}

export interface LevelHooks {
  /** Runs after play on restores the resource, without setting up the level again. */
  onPlayOn?(): void;
  /** Replace the default camera. Custom cameras own their projection by default. */
  camera?: Three.Camera;
  /** Automatically update a perspective camera's aspect on resize. */
  autoResizeCamera?: boolean;
  /** Seconds since the last frame and since this level started. */
  update?(dt: number, elapsed: number): void;
  /** Runs immediately before every draw, including resize and step(0). */
  beforeRender?(): void;
  /** Return JSON-serializable state for inspection and headless captures. */
  debug?(): unknown;
  pointer?(event: GamePointer): void;
  /** Use to update an orthographic camera or custom layout. */
  resize?(width: number, height: number): void;
  /** Dispose controls, audio, timers, or other non-scene resources. */
  dispose?(): void;
}

export interface LevelContext {
  scene: Three.Scene;
  camera: Three.PerspectiveCamera;
  renderer: Three.WebGLRenderer;
  level: Level;
  /** Zero-based level index. */
  index: number;
  /** Aborted on level exit, setup failure, or game disposal. */
  signal: AbortSignal;
  readonly width: number;
  readonly height: number;
  readonly failure: Readonly<FailureState>;
  win(): boolean;
  /** Fail immediately, regardless of the configured mode. */
  fail(): boolean;
  /** Lose one heart. Ignored outside hearts mode or active play. */
  mistake(): boolean;
  /** Spend one move. Check for a win before spending the final move. */
  move(): boolean;
}

export type FailureMode =
  | { type: 'default' }
  | { type: 'hearts'; hearts?: 3 | 4 | 5 }
  | { type: 'time'; seconds: number; playOnSeconds?: number }
  | { type: 'moves'; moves: number; playOnMoves?: number };

export interface FailureState {
  readonly type: FailureMode['type'];
  /** Null in default mode; seconds may be fractional. */
  readonly remaining: number | null;
  readonly initial: number | null;
  readonly playOnAmount: number | null;
}

export type LevelDifficulty = 'normal' | 'hard' | 'very-hard' | 'ultra-hard';

export interface Level {
  name?: string;
  /** Displayed in the level chooser. Defaults to normal. */
  difficulty?: LevelDifficulty;
  /** Overrides the game's failure mode for this level. */
  failure?: FailureMode;
  setup(context: LevelContext): LevelHooks | void | Promise<LevelHooks | void>;
}

export interface GameOptions {
  levels: Level[];
  /** Defaults to { type: 'default' }, with retry and no play on. */
  failure?: FailureMode;
  title?: string;
  /** Element or selector. Defaults to document.body. */
  root?: HTMLElement | string;
  /** Zero-based index. Defaults to 0. */
  initialLevel?: number;
  background?: Three.ColorRepresentation;
  /** Defaults to 2. */
  maxPixelRatio?: number;
  /** Portrait stage width cap in CSS pixels. Defaults to 540. */
  maxWidth?: number;
  renderer?: Three.WebGLRendererParameters;
  onError?(error: Error): void;
}

export interface GameState {
  readonly status: 'loading' | 'playing' | 'paused' | 'won' | 'failed' | 'error' | 'disposed';
  readonly index: number;
  readonly elapsed: number;
  readonly error: Error | null;
  readonly failure: Readonly<FailureState>;
}

export interface Game {
  readonly renderer: Three.WebGLRenderer;
  readonly scene: Three.Scene | undefined;
  readonly camera: Three.Camera | undefined;
  readonly state: GameState;
  /** Initial setup starts in a microtask. Rejects on setup failure. */
  ready: Promise<boolean>;
  /** Current level's debug snapshot, or null when no debug hook is available. */
  debug(): unknown;
  /** Resolves false if superseded by another load or disposal. */
  loadLevel(index: number): Promise<boolean>;
  restart(): Promise<boolean>;
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
  win(): boolean;
  fail(): boolean;
  mistake(): boolean;
  move(): boolean;
  /** Continue a failed non-default level, preserving its scene and elapsed time. */
  playOn(): boolean;
  pause(): void;
  resume(): void;
  /** Advance up to 60 seconds in fixed substeps, then draw. */
  step(seconds?: number): void;
  dispose(): void;
}

export function createGame(options: GameOptions): Game;
