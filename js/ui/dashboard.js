// ===== 대시보드 UI 업데이트 =====

import { loadConfig, FEES } from '../core/config.js';
import * as storage from '../core/storage.js';
import { calcPositionPnl } from '../trading/risk.js';

/**
 * 오늘 요약 카드 업데이트
 */
export function updateSummary(todayReturnPct, totalAsset, tradeCount) {
    const elReturn = document.getElementById('todayReturn');
    const elAsset = document.getElementById('totalAsset');
    const elTrades = document.getElementById('todayTrades');

    if (elReturn) {
        elReturn.textContent = `${todayReturnPct >= 0 ? '+' : ''}${todayReturnPct.toFixed(2)}%`;
        elReturn.className = `value big ${todayReturnPct >= 0 ? 'up' : 'down'}`;
    }
    if (elAsset) elAsset.textContent = `₩${totalAsset.toLocaleString()}`;
    if (elTrades) elTrades.textContent = `${tradeCount}건`;
}

/**
 * AI 점수 요소 업데이트
 */
export function updateAiFactors(scores) {
    const factors = document.querySelectorAll('#aiFactors .factor');
    const keys = ['rsi', 'macd', 'bb', 'vol', 'ai'];

    factors.forEach((f, i) => {
        const key = keys[i];
        const val = scores[key];
        if (val === undefined || val === null) return;

        const fill = f.querySelector('.factor-fill');
        const valEl = f.querySelector('.factor-val');

        if (fill) {
            fill.style.width = `${val}%`;
            fill.className = 'factor-fill';
            if (key === 'ai') fill.classList.add('ai');
            else if (val >= 70) fill.classList.add('high');
            else if (val <= 30) fill.classList.add('low');
        }
        if (valEl) valEl.textContent = val;
    });
}

/**
 * AI 판단 결과 표��
 */
export function updateVerdict(action, score) {
    const el = document.getElementById('aiVerdict');
    if (!el) return;

    const labels = { buy: '매수 신호', sell: '매도 신호', hold: '관망' };
    el.textContent = labels[action] || '분석중';
    el.className = `ai-verdict ${action}`;
}

/**
 * 포지션 목록 업데이트
 */
export function updatePositions(positions, currentPrices = {}) {
    const list = document.getElementById('positionList');
    const countEl = document.getElementById('positionCount');
    if (!list) return;

    if (countEl) countEl.textContent = positions.length;

    if (positions.length === 0) {
        list.innerHTML = '<div class="empty-state small"><p>보유 종목 없음</p></div>';
        return;
    }

    list.innerHTML = positions.map(pos => {
        const curPrice = currentPrices[pos.symbol] || pos.buyPrice;
        const pnl = calcPositionPnl(pos, curPrice);
        const isUp = pnl.net >= 0;

        return `
            <div class="position-item">
                <div class="pos-left">
                    <div class="pos-name">${pos.name}</div>
                    <div class="pos-info">${pos.qty}주 | 매수 ${pos.buyPrice.toLocaleString()}원</div>
                    <div class="pos-info">수수료 ${pnl.buyCost.toLocaleString()} + ${pnl.sellCost.toLocaleString()}원</div>
                </div>
                <div class="pos-right">
                    <div class="pos-pnl ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${pnl.net.toLocaleString()}원</div>
                    <div class="pos-price ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${pnl.returnPct.toFixed(2)}%</div>
                </div>
                <button class="pos-sell-btn" data-symbol="${pos.symbol}">매도</button>
            </div>
        `;
    }).join('');
}

/**
 * 신호 로그 추가
 */
export function addSignalLog(signal) {
    const log = document.getElementById('signalLog');
    if (!log) return;

    // 빈 상태 제거
    const empty = log.querySelector('.empty-state');
    if (empty) empty.remove();

    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const typeClass = signal.type || 'info';
    const badgeHtml = signal.type === 'buy' || signal.type === 'sell'
        ? `<span class="signal-badge ${signal.type}">${signal.type === 'buy' ? '매수' : '매도'}</span>`
        : '';

    const item = document.createElement('div');
    item.className = `signal-item ${typeClass}`;
    item.innerHTML = `
        <span class="signal-time">${time}</span>
        <span class="signal-text">${signal.text}</span>
        ${badgeHtml}
    `;

    log.insertBefore(item, log.firstChild);

    // 최대 50개 유지
    while (log.children.length > 50) {
        log.removeChild(log.lastChild);
    }
}

/**
 * 연결 상태 바 업데이트
 */
export function updateConnectionBar(status, text) {
    const bar = document.getElementById('connectionBar');
    const textEl = document.getElementById('connText');
    if (bar) bar.className = `connection-bar ${status}`;
    if (textEl) textEl.textContent = text;
}

/**
 * AI 상태 업데이트
 */
export function updateAiStatus(status, label) {
    const el = document.getElementById('aiStatus');
    if (el) {
        el.className = `ai-status ${status}`;
        el.querySelector('.ai-label').textContent = label;
    }
}

/**
 * 수익현황 탭 업데이트
 */
export function updateHistory() {
    const records = storage.getDailyRecords();
    const trades = storage.getTradeHistory();
    const sellTrades = trades.filter(t => t.type === 'sell');
    const wins = sellTrades.filter(t => t.pnl > 0);

    const cumReturn = records.length > 0
        ? records.reduce((sum, r) => sum + (r.returnPct || 0), 0)
        : 0;

    const elCum = document.getElementById('cumReturn');
    const elCount = document.getElementById('totalTradeCount');
    const elWin = document.getElementById('overallWinRate');

    if (elCum) {
        elCum.textContent = `${cumReturn >= 0 ? '+' : ''}${cumReturn.toFixed(2)}%`;
        elCum.className = `value big ${cumReturn >= 0 ? 'up' : 'down'}`;
    }
    if (elCount) elCount.textContent = sellTrades.length;
    if (elWin) {
        const wr = sellTrades.length > 0 ? (wins.length / sellTrades.length * 100).toFixed(1) : '0';
        elWin.textContent = `${wr}%`;
    }

    // 일별 기록 리스트
    const listEl = document.getElementById('dailyHistory');
    if (listEl && records.length > 0) {
        listEl.innerHTML = records.slice().reverse().map(r => `
            <div class="history-item">
                <span class="h-date">${r.date}</span>
                <span class="h-trades">${r.trades || 0}건</span>
                <span class="h-return ${(r.returnPct || 0) >= 0 ? 'up' : 'down'}">
                    ${(r.returnPct || 0) >= 0 ? '+' : ''}${(r.returnPct || 0).toFixed(2)}%
                </span>
            </div>
        `).join('');
    }
}
