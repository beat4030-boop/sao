// ===== 최적 손절/트레일링 분석기 =====
// 과거 매매 기록에서 최적 파라미터 찾기

import * as storage from '../core/storage.js';
import { calcProfit } from '../core/config.js';

/**
 * 과거 거래에서 최적 손절가/트레일링 계산
 * @param {number} days - 분석 기간 (일)
 * @returns {Object} 최적 분석 결과
 */
export function findOptimalParams(days = 7) {
    const trades = storage.getTradeHistory();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const recentSells = trades.filter(t =>
        t.type === 'sell' && t.timestamp >= cutoff && t.buyPrice && t.sellPrice
    );

    if (recentSells.length === 0) {
        return { hasData: false };
    }

    // 손절 범위: -0.5% ~ -5%, 0.5% 단위
    const slRange = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
    // 트레일링 범위: -0.5% ~ -3%, 0.5% 단위
    const trRange = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];

    let bestSl = 1.0;
    let bestTr = 1.5;
    let bestPnl = -Infinity;

    // 그리드 서치로 최적 조합 찾기
    for (const sl of slRange) {
        for (const tr of trRange) {
            let totalPnl = 0;
            for (const trade of recentSells) {
                const simPnl = simulateWithParams(trade, sl, tr);
                totalPnl += simPnl;
            }
            if (totalPnl > bestPnl) {
                bestPnl = totalPnl;
                bestSl = sl;
                bestTr = tr;
            }
        }
    }

    // 실제 손익 vs 최적 손익
    const actualPnl = recentSells.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const diff = bestPnl - actualPnl;

    // 종목별 실제 vs 최적 비교
    const perStock = recentSells.slice(-10).map(t => {
        const optimalPnl = simulateWithParams(t, bestSl, bestTr);
        return {
            symbol: t.symbol,
            name: t.name,
            reason: t.reason,
            actualPnlPct: t.pnlPct || 0,
            optimalPnlPct: t.buyPrice > 0 ? (optimalPnl / (t.buyPrice * t.qty) * 100) : 0,
            optimalPnl,
            diff: optimalPnl - (t.pnl || 0),
        };
    });

    return {
        hasData: true,
        tradeCount: recentSells.length,
        period: `${days}일`,
        optimal: {
            stopLoss: bestSl,
            trailing: bestTr,
        },
        actualPnl,
        optimalPnl: bestPnl,
        diff,
        perStock,
    };
}

/**
 * 특정 파라미터로 거래를 시뮬레이션
 */
function simulateWithParams(trade, stopLoss, trailing) {
    const { buyPrice, sellPrice, qty, market = 'kospi' } = trade;
    if (!buyPrice || !qty) return 0;

    // 간이 시뮬: 손절가에 걸렸을 경우
    const slPrice = Math.floor(buyPrice * (1 - stopLoss / 100));
    const trPrice = Math.floor(buyPrice * (1 - trailing / 100)); // 최고점 트레일링 간이

    let simSellPrice = sellPrice;

    // 실제 매도가가 손절가보다 낮았으면 → 손절가에서 팔았을 것
    if (sellPrice < slPrice) {
        simSellPrice = slPrice;
    }

    // 트레일링: 매도가가 트레일링 범위 안이면 유지
    if (simSellPrice > buyPrice && (buyPrice * (1 + 0.02) - simSellPrice) > 0) {
        // 수익 구간에서 트레일링 적용
        const trailPrice = Math.floor(simSellPrice * (1 - trailing / 100));
        simSellPrice = Math.max(simSellPrice, trailPrice);
    }

    const pnl = calcProfit(buyPrice, simSellPrice, qty, market);
    return pnl.net;
}

/**
 * 후회 분석: 각 거래에서 더 좋은 결정이 있었는지
 */
export function regretAnalysis() {
    const trades = storage.getTradeHistory().filter(t => t.type === 'sell');
    const recent = trades.slice(-20);

    return recent.map(t => {
        const couldHaveHeld = t.reason === '손절' && (t.pnlPct || 0) > -0.5;
        const soldTooLate = t.reason === '트레일링' || (t.reason === '강제청산' && (t.pnlPct || 0) < 0);
        const goodCall = (t.pnl || 0) > 0;

        let verdict = '적절';
        if (goodCall) verdict = '좋은 판단';
        else if (couldHaveHeld) verdict = '성급한 손절';
        else if (soldTooLate) verdict = '늦은 매도';

        return {
            ...t,
            verdict,
        };
    });
}
