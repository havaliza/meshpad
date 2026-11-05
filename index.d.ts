/// <reference types="vite/client" />
import type * as Three from 'three';
export * as THREE from 'three';

export interface HUDState {
  title?: string;
  message?: string;
  score?: string | number;
  /** A number from 0 to 1; null hides the progress bar. */
  progress?: number | null;
  hint?: string;
}

export interface GamePointer {
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';
  originalEvent: PointerEvent;
  /** Normalized device coordinates, from -1 to 1. */
  point: Three.Vector2;
  raycaster: Three.Raycaster;
  hits(objects?: Three.Object3D[]): Three.Intersection[];
}

export interface LevelHooks {
  /** Seconds since the last frame and since this level started. */
  update?(dt: number, elapsed: number): void;
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
  hud(patch: HUDState): void;
  win(message?: string): boolean;
  fail(message?: string): boolean;
}

export interface Level {
  name?: string;
  setup(context: LevelContext): LevelHooks | void | Promise<LevelHooks | void>;
}

export interface GameOptions {
  levels: Level[];
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
}

export interface Game {
  readonly renderer: Three.WebGLRenderer;
  readonly scene: Three.Scene;
  readonly camera: Three.PerspectiveCamera;
  readonly state: GameState;
  /** Rejects on initial setup failure. */
  ready: Promise<boolean>;
  /** Resolves false if superseded by another load or disposal. */
  loadLevel(index: number): Promise<boolean>;
  restart(): Promise<boolean>;
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
  win(message?: string): boolean;
  fail(message?: string): boolean;
  pause(): void;
  resume(): void;
  /** Advance up to 60 seconds in fixed substeps, then draw. */
  step(seconds?: number): void;
  dispose(): void;
}

export function createGame(options: GameOptions): Game;
