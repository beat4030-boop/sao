// ===== 모의투자 시뮬레이터 =====
// 증권사 API 없이 앱 내에서 가상 매수/매도 실행
// 실시간 시세 기반 페이퍼 트레이딩

import { loadConfig, calcProfit, calcBuyCost, calcSellCost } from '../core/config.js';
import * as storage from '../core/storage.js';

// ===== 가상 계좌 =====

export function getAccount() {
    return storage.load('sim_account', {
        cash: loadConfig().capital,
        positions: [],       // [{ symbol, name, qty, buyPrice, buyTime, market, score, tier }]
        todayPnl: 0,
        todayTrades: 0,
        todayWins: 0,
        todayLosses: 0,
        totalTrades: 0,
    });
}

export function saveAccount(acct) {
    storage.save('sim_account', acct);
}

export function resetAccount() {
    const cfg = loadConfig();
    const fresh = {
        cash: cfg.capital,
        positions: [],
        todayPnl: 0,
        todayTrades: 0,
        todayWins: 0,
        todayLosses: 0,
        totalTrades: 0,
    };
    saveAccount(fresh);
    return fresh;
}

// ===== 가상 매수 =====

/**
 * @param {string} symbol
 * @param {string} name
 * @param {number} price - 현재가
 * @param {number} qty - 수량
 * @param {string} market - 'kospi' | 'kosdaq'
 * @param {number} score - AI 스코어
 * @param {string} tier - 배팅 등급
 * @returns {{ success: boolean, message: string, position?: Object }}
 */
export function buy(symbol, name, price, qty, market = 'kospi', score = 0, tier = '노멀') {
    const acct = getAccount();

    // 이미 보유중인지 체크
    if (acct.positions.find(p => p.symbol === symbol)) {
        return { success: false, message: `${name} 이미 보유중` };
    }

    const totalCost = price * qty;
    const { commission } = calcBuyCost(totalCost);
    const needed = totalCost + commission;

    if (acct.cash < needed) {
        return { success: false, message: `잔고 부족 (필요: ${needed.toLocaleString()}, 보유: ${acct.cash.toLocaleString()})` };
    }

    const position = {
        symbol,
        name,
        qty,
        buyPrice: price,
        buyTime: new Date().toISOString(),
        market,
        score,
        tier,
        buyCommission: commission,
        highPrice: price,  // 트레일링용 최고가
    };

    acct.cash -= needed;
    acct.positions.push(position);
    acct.todayTrades++;
    acct.totalTrades++;
    saveAccount(acct);

    // 거래 기록
    storage.addTradeRecord({
        type: 'buy', symbol, name, qty, price, market,
        score, tier, commission,
        cash: acct.cash,
    });

    return { success: true, message: `매수: ${name} ${qty}주 @ ${price.toLocaleString()}원`, position };
}

// ===== 가상 매도 =====

/**
 * @param {string} symbol
 * @param {number} sellPrice - 매도가
 * @param {string} reason - 매도 사유 (익절/손절/트레일링/강제청산/수동)
 * @returns {{ success: boolean, message: string, pnl?: Object }}
 */
export function sell(symbol, sellPrice, reason = '수동') {
    const acct = getAccount();
    const idx = acct.positions.findIndex(p => p.symbol === symbol);

    if (idx === -1) {
        return { success: false, message: `${symbol} 보유하지 않음` };
    }

    const pos = acct.positions[idx];
    const pnl = calcProfit(pos.buyPrice, sellPrice, pos.qty, pos.market);

    // 계좌 업데이트
    const sellAmount = sellPrice * pos.qty;
    const { commission, tax } = calcSellCost(sellAmount, pos.market);
    acct.cash += sellAmount - commission - tax;
    acct.positions.splice(idx, 1);
    acct.todayTrades++;
    acct.todayPnl += pnl.net;
    if (pnl.net > 0) acct.todayWins++;
    else acct.todayLosses++;
    acct.totalTrades++;
    saveAccount(acct);

    // 거래 기록
    storage.addTradeRecord({
        type: 'sell', symbol, name: pos.name,
        qty: pos.qty, buyPrice: pos.buyPrice, sellPrice,
        pnl: pnl.net, pnlPct: pnl.returnPct,
        buyCost: pnl.buyCost, sellCost: pnl.sellCost,
        reason, market: pos.market,
        score: pos.score, tier: pos.tier,
        holdTime: Date.now() - new Date(pos.buyTime).getTime(),
        cash: acct.cash,
    });

    const pnlText = pnl.net >= 0
        ? `+${pnl.net.toLocaleString()}원 (+${pnl.returnPct.toFixed(2)}%)`
        : `${pnl.net.toLocaleString()}원 (${pnl.returnPct.toFixed(2)}%)`;

    return {
        success: true,
        message: `${reason}: ${pos.name} ${pos.qty}주 @ ${sellPrice.toLocaleString()}원 → ${pnlText}`,
        pnl,
        position: pos,
    };
}

// ===== 포지션 체크 (익절/손절/트레일링) =====

/**
 * 모든 포지션의 청산 조건 체크
 * @param {Object} currentPrices - { symbol: price }
 * @param {Object} cfg - 설정
 * @returns {Array} 청산할 포지션 목록
 */
export function checkPositions(currentPrices, cfg = null) {
    if (!cfg) cfg = loadConfig();
    const acct = getAccount();
    const actions = [];

    for (const pos of acct.positions) {
        const curPrice = currentPrices[pos.symbol];
        if (!curPrice) continue;

        // 최고가 업데이트 (트레일링용)
        if (curPrice > pos.highPrice) {
            pos.highPrice = curPrice;
        }

        const pnl = calcProfit(pos.buyPrice, curPrice, pos.qty, pos.market);

        // 익절 체크
        if (pnl.returnPct >= cfg.takeProfit) {
            actions.push({ symbol: pos.symbol, price: curPrice, reason: '익절', pnl });
            continue;
        }

        // 손절 체크
        if (pnl.returnPct <= -cfg.stopLoss) {
            actions.push({ symbol: pos.symbol, price: curPrice, reason: '손절', pnl });
            continue;
        }

        // 트레일링 스탑 (최고점 대비 하락률)
        if (cfg.trailingStop > 0 && pos.highPrice > pos.buyPrice) {
            const dropFromHigh = ((pos.highPrice - curPrice) / pos.highPrice) * 100;
            if (dropFromHigh >= cfg.trailingStop) {
                actions.push({ symbol: pos.symbol, price: curPrice, reason: '트레일링', pnl });
                continue;
            }
        }
    }

    // 최고가 저장
    saveAccount(acct);

    return actions;
}

// ===== 장마감 강제청산 =====

export function forceCloseAll(currentPrices) {
    const acct = getAccount();
    const results = [];

    for (const pos of [...acct.positions]) {
        const price = currentPrices[pos.symbol] || pos.buyPrice;
        const result = sell(pos.symbol, price, '강제청산');
        results.push(result);
    }

    return results;
}

// ===== 일일 리셋 =====

export function resetDailyStats() {
    const acct = getAccount();

    // 오늘 기록 저장
    if (acct.todayTrades > 0) {
        storage.saveDailyRecord({
            trades: acct.todayTrades,
            wins: acct.todayWins,
            losses: acct.todayLosses,
            pnl: acct.todayPnl,
            winRate: acct.todayTrades > 0
                ? ((acct.todayWins / (acct.todayWins + acct.todayLosses)) * 100).toFixed(1)
                : '0',
            returnPct: acct.cash > 0 ? (acct.todayPnl / acct.cash * 100) : 0,
            cash: acct.cash,
        });
    }

    acct.todayPnl = 0;
    acct.todayTrades = 0;
    acct.todayWins = 0;
    acct.todayLosses = 0;
    saveAccount(acct);
}

// ===== 계좌 요약 =====

export function getAccountSummary(currentPrices = {}) {
    const acct = getAccount();
    const cfg = loadConfig();

    let positionValue = 0;
    let unrealizedPnl = 0;

    const positionsWithPnl = acct.positions.map(pos => {
        const curPrice = currentPrices[pos.symbol] || pos.buyPrice;
        const pnl = calcProfit(pos.buyPrice, curPrice, pos.qty, pos.market);
        positionValue += curPrice * pos.qty;
        unrealizedPnl += pnl.net;

        return {
            ...pos,
            currentPrice: curPrice,
            pnl: pnl.net,
            pnlPct: pnl.returnPct,
            dropFromHigh: pos.highPrice > pos.buyPrice
                ? (((pos.highPrice - curPrice) / pos.highPrice) * 100).toFixed(2)
                : '0',
        };
    });

    const totalAsset = acct.cash + positionValue;
    const totalReturn = ((totalAsset - cfg.capital) / cfg.capital * 100);

    return {
        cash: acct.cash,
        positionValue,
        totalAsset,
        totalReturn,
        unrealizedPnl,
        realizedPnl: acct.todayPnl,
        positions: positionsWithPnl,
        todayTrades: acct.todayTrades,
        todayWins: acct.todayWins,
        todayLosses: acct.todayLosses,
        winRate: (acct.todayWins + acct.todayLosses) > 0
            ? ((acct.todayWins / (acct.todayWins + acct.todayLosses)) * 100).toFixed(1)
            : '0',
    };
}
