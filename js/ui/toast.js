// ===== 토스트 알림 =====

const el = () => document.getElementById('toast');
let timer = null;

export function show(msg, type = '', duration = 2500) {
    const t = el();
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast';
    if (type) t.classList.add(type);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => t.classList.add('hidden'), duration);
}

export function success(msg) { show(msg, 'success'); }
export function error(msg) { show(msg, 'error', 3500); }
export function info(msg) { show(msg); }
