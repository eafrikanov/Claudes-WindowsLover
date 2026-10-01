import * as THREE from 'three';
import { MC } from './style-mc.js';

const cache = new Map();

// Чёрная оболочка, раздутая по нормалям и видимая только изнутри, рисует контур вокруг модели.
function outlineMaterial(thickness) {
  const key = thickness.toFixed(4);
  if (!cache.has(key)) {
    const m = new THREE.MeshBasicMaterial({ color: 0x1e1924, side: THREE.BackSide });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(normal) * ${key};`);
    };
    m.customProgramCacheKey = () => `outline${key}`;
    cache.set(key, m);
  }
  return cache.get(key);
}

export function addOutlines(root, thickness) {
  if (MC) return;
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && !o.material.transparent && !o.userData.noOutline && !o.userData.isOutline && o.material.type !== 'MeshBasicMaterial') meshes.push(o);
  });
  const mat = outlineMaterial(thickness);
  for (const m of meshes) {
    const shell = new THREE.Mesh(m.geometry, mat);
    shell.userData.isOutline = true;
    shell.frustumCulled = m.frustumCulled;
    m.add(shell);
  }
}
