// A level owns its scene resources. Deduplicate shared resources within a scene.
export function disposeScene(scene) {
  const resources = new Set();
  const textures = new Set();
  const collect = (value) => {
    if (value?.isTexture) textures.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
  };
  scene.traverse((object) => {
    if (object.geometry) resources.add(object.geometry);
    if (object.skeleton) resources.add(object.skeleton);
    if (object.shadow) resources.add(object.shadow);
    for (const material of [object.material].flat().filter(Boolean)) {
      resources.add(material);
      Object.values(material).forEach(collect);
      Object.values(material.uniforms ?? {}).forEach((uniform) => collect(uniform.value));
    }
  });
  collect(scene.background);
  collect(scene.environment);
  for (const texture of textures) texture.dispose();
  for (const resource of resources) resource.dispose();
  scene.clear();
  scene.background = null;
  scene.environment = null;
}
