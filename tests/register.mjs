import { register } from 'node:module';

// Код игры импортирует three через importmap браузера; в Node подставляем те же файлы из vendor.
register('data:text/javascript,' + encodeURIComponent(`
const root = ${JSON.stringify(new URL('../vendor/three/', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: root + 'addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));
