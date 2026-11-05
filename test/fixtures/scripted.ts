import { createGame, THREE } from 'meshpad';
import { BufferGeometryUtils } from 'meshpad/addons';

createGame({
  maxPixelRatio: 1, // Explicit capture DPR should override even this lower cap.
  levels: [0, 1].map(() => ({
    setup({ scene, win }) {
      const token = new Token(); // This class is intentionally declared below createGame.
      scene.add(token.mesh);
      const camera = new THREE.OrthographicCamera(-3, 3, 6, -6, 0.1, 100);
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const position = new THREE.Vector3();
      let dragging = false;
      const events: string[] = [];
      return {
        camera,
        debug: () => ({ x: token.mesh.position.x, dragging, events: [...events] }),
        pointer({ type, hits, raycaster }) {
          events.push(type);
          if (type === 'pointerdown') dragging = hits([token.mesh]).length > 0;
          if (type === 'pointermove' && dragging && raycaster.ray.intersectPlane(plane, position)) token.mesh.position.copy(position);
          if (type === 'pointerup') {
            dragging = false;
            if (token.mesh.position.x > 0.9) win();
          }
        },
      };
    },
  })),
});

class Token {
  mesh = new THREE.Mesh(
    BufferGeometryUtils.mergeVertices(new THREE.BoxGeometry()),
    new THREE.MeshBasicMaterial({ color: 'yellow' }),
  );
  constructor() { this.mesh.position.x = -1; }
}
