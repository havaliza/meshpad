import { createGame, THREE, type Game, type Level } from 'meshpad';
import { Vector3 } from 'meshpad/three';

const level: Level = {
  name: 'Typed level',
  async setup({ scene, camera, signal, win }) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    camera.lookAt(new Vector3());
    window.addEventListener('click', () => win(), { signal });
    return {
      update(dt, elapsed) { mesh.rotation.y += dt + elapsed * 0; },
      pointer({ type, hits }) { if (type === 'pointerdown' && hits([mesh]).length) win(); },
      resize(width, height) { camera.aspect = width / height; },
      dispose() {},
    };
  },
};
const game: Game = createGame({ levels: [level], renderer: { antialias: false } });
await game.ready;
await game.loadLevel(0);
game.pause(); game.resume(); game.step(1); game.dispose();
// @ts-expect-error Level indexes are numeric.
game.loadLevel('first');
