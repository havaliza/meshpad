import { createGame, THREE, type Game, type Level } from 'meshpad';
import { Vector3 } from 'meshpad/three';

const level: Level = {
  name: 'Typed level',
  difficulty: 'very-hard',
  failure: { type: 'moves', moves: 15, playOnMoves: 5 },
  async setup({ scene, camera, signal, win, move, mistake, failure }) {
    const remaining: number | null = failure.remaining;
    if (remaining === 0) { move(); mistake(); }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    camera.lookAt(new Vector3());
    window.addEventListener('click', () => win(), { signal });
    return {
      update(dt, elapsed) { mesh.rotation.y += dt + elapsed * 0; },
      pointer({ type, hits }) { if (type === 'pointerdown' && hits([mesh]).length) win(); },
      resize(width, height) { camera.aspect = width / height; },
      onPlayOn() {},
      dispose() {},
    };
  },
};
const game: Game = createGame({ levels: [level], failure: { type: 'hearts', hearts: 5 }, renderer: { antialias: false } });
await game.ready;
await game.loadLevel(0);
game.mistake(); game.move(); game.playOn();
const remaining: number | null = game.state.failure.remaining;
// @ts-expect-error Hearts are limited to 3–5.
createGame({ levels: [level], failure: { type: 'hearts', hearts: 6 } });
// @ts-expect-error Time mode requires starting seconds.
createGame({ levels: [level], failure: { type: 'time' } });
game.pause(); game.resume(); game.step(1); game.dispose();
// @ts-expect-error Level indexes are numeric.
game.loadLevel('first');

// @ts-expect-error Difficulty is one of the four supported values.
createGame({ levels: [{ difficulty: 'extreme', setup() {} }] });
