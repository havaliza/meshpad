import { createGame, THREE, type LevelContext, type LevelHooks } from 'meshpad';

createGame({
  title: 'Hello, world',
  levels: [
    { name: 'Hello, world', setup: (context) => createLevel(context, 3, 0xf9c203) },
    { name: 'A little quicker', setup: (context) => createLevel(context, 5, 0xf02b1f) },
    { name: 'One last spin', setup: (context) => createLevel(context, 7, 0x09a8f8) },
  ],
});

function createLevel(
  { scene, camera, win, fail }: LevelContext,
  target: number,
  color: THREE.ColorRepresentation,
): LevelHooks {
  camera.position.set(4.8, 5.2, 8);
  camera.lookAt(0, 0.35, 0);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 1.55, 1.55, 1, 1, 1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.15 }),
  );
  cube.position.y = 0.35;
  scene.add(cube);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.7, 0.35, 64),
    new THREE.MeshStandardMaterial({ color: 0x4a40aa, roughness: 0.7 }),
  );
  platform.position.y = -1;
  scene.add(platform);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.25, 0.018, 8, 80),
    new THREE.MeshBasicMaterial({ color }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.81;
  scene.add(ring);

  const grid = new THREE.GridHelper(30, 30, 0x3a3388, 0x2e2868);
  grid.position.y = -1.19;
  scene.add(grid);
  scene.fog = new THREE.Fog(0x221e4e, 12, 28);

  let taps = 0;
  let timeLeft = 20;
  let spin = 0;

  return {
    debug: () => ({ taps, target, timeLeft }),
    update(dt, elapsed) {
      timeLeft = Math.max(0, timeLeft - dt);
      cube.rotation.y += dt * (0.3 + spin);
      cube.rotation.z = Math.sin(elapsed * 0.7) * 0.08;
      cube.position.y = 0.35 + Math.sin(elapsed * 1.8) * 0.12;
      spin *= Math.exp(-dt * 3);
      if (timeLeft === 0) fail();
    },
    pointer({ type, hits }) {
      if (type !== 'pointerdown' || hits([cube]).length === 0) return;
      taps += 1;
      spin = 9;
      if (taps >= target) win();
    },
  };
}
