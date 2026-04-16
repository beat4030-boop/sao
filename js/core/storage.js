// ===== localStorage 래퍼 =====
// positions, history, signals, ai model 등 데이터 저장

const PREFIX = 'sao_';

function getKey(key) { return PREFIX + key; }

export function save(key, data) {
    try {
        localStorage.setItem(getKey(key), JSON.stringify(data));
    } catch (e) {
        console.warn(`Storage save failed [${key}]:`, e);
    }
}

export function load(key, fallback = null) {
    try {
        const raw = localStorage.getItem(getKey(key));
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        console.warn(`Storage load failed [${key}]:`, e);
        return fallback;
    }
}

export function remove(key) {
    localStorage.removeItem(getKey(key));
}

export function clearAll() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
}

// ===== 포지션 관리 =====

export function getPositions() {
    return load('positions', []);
}

export function savePositions(positions) {
    save('positions', positions);
}

export function addPosition(pos) {
    const list = getPositions();
    list.push({ ...pos, openedAt: new Date().toISOString() });
    savePositions(list);
    return list;
}

export function removePosition(symbol) {
    const list = getPositions().filter(p => p.symbol !== symbol);
    savePositions(list);
    return list;
}

// ===== 매매 기록 =====

export function getTradeHistory() {
    return load('trade_history', []);
}

export function addTradeRecord(record) {
    const list = getTradeHistory();
    list.push({ ...record, timestamp: new Date().toISOString() });
    // 최근 1000건만 유지
    if (list.length > 1000) list.splice(0, list.length - 1000);
    save('trade_history', list);
    return list;
}

// ===== 일별 수익 기록 =====

export function getDailyRecords() {
    return load('daily_records', []);
}

export function saveDailyRecord(record) {
    const list = getDailyRecords();
    const today = new Date().toISOString().slice(0, 10);
    const idx = list.findIndex(r => r.date === today);
    const entry = { date: today, ...record };
    if (idx >= 0) {
        list[idx] = entry;
    } else {
        list.push(entry);
    }
    save('daily_records', list);
    return list;
}

// ===== 신호 로그 =====

export function getSignals() {
    return load('signals', []);
}

export function addSignal(signal) {
    const list = getSignals();
    list.unshift({ ...signal, time: new Date().toISOString() });
    if (list.length > 200) list.length = 200;
    save('signals', list);
    return list;
}

export function clearSignals() {
    save('signals', []);
}
