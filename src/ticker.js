// Таймеры в скрытой вкладке браузер замедляет до раза в секунду, а через несколько минут и реже.
// Таймеры внутри Worker это не затрагивает, поэтому матч хоста и проверка связи идут через него.
const SOURCE = 'const t=new Map();onmessage=(e)=>{const[id,ms]=e.data;clearInterval(t.get(id));t.delete(id);if(ms)t.set(id,setInterval(()=>postMessage(id),ms));};';

let worker = null;
let seq = 0;
const handlers = new Map();

function getWorker() {
  if (worker !== null) return worker;
  worker = false;
  try {
    if (typeof Worker === 'function' && typeof Blob === 'function') {
      worker = new Worker(URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' })));
      worker.onmessage = (e) => handlers.get(e.data)?.();
    }
  } catch {
    worker = false;
  }
  return worker;
}

// Возвращает функцию остановки
export function every(ms, fn) {
  const w = getWorker();
  if (!w) {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }
  const id = ++seq;
  handlers.set(id, fn);
  w.postMessage([id, ms]);
  return () => {
    if (!handlers.delete(id)) return;
    w.postMessage([id, 0]);
  };
}
