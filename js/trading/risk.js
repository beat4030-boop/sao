// ===== 리스크 관리 =====

import { loadConfig, calcProfit } from '../core/config.js';
import { getPositions, getDailyRecords } from '../core/storage.js';

/**
 * 1회 투자 가능 금액 계산
 * @param {number} totalCapital - 총 자산
 * @returns {number} 투자 가능 금액
 */
export function calcPositionAmount(totalCapital) {
    const cfg = loadConfig();
    return Math.floor(totalCapital * (cfg.positionSize / 100));
}

/**
 * 매수 가능 수량 계산 (수수료 포함)
 * @param {number} capital - 투자 가능 금액
 * @param {number} price - 현재가
 * @returns {number} 매수 수��
 */
export function calcBuyQty(capital, price) {
    if (price <= 0) return 0;
    // 수수료 감안하여 약간 여유
    const adjustedCapital = capital * 0.999;
    return Math.floor(adjustedCapital / price);
}

/**
 * 익절가 계산
 * @param {number} buyPrice
 * @param {'kospi'|'kosdaq'} market
 * @returns {number} 목표 매도가 (수수료/세금 반영 후 실질 2% 수익)
 */
export function calcTakeProfitPrice(buyPrice, market = 'kospi') {
    const cfg = loadConfig();
    const targetPct = cfg.takeProfit / 100;

    // 수수료+세금을 고려한 실질 익절가
    // 순수익 = (매도가 - 매수가) * 수량 - 매수수수료 - 매도수수료 - 세금
    // 간소화: 매도가 = 매수가 * (1 + 목표% + 총비용%)
    // 총비용 ≈ 매수0.015% + 매도0.015% + 세금(0.33% 코스피 or 0.18% 코스닥)
    let totalFeeRate;
    if (market === 'kosdaq') {
        totalFeeRate = 0.00015 + 0.00015 + 0.0018; // 0.21%
    } else {
        totalFeeRate = 0.00015 + 0.00015 + 0.0018 + 0.0015; // 0.36%
    }

    return Math.ceil(buyPrice * (1 + targetPct + totalFeeRate));
}

/**
 * 손절가 계산
 */
export function calcStopLossPrice(buyPrice) {
    const cfg = loadConfig();
    return Math.floor(buyPrice * (1 - cfg.stopLoss / 100));
}

/**
 * 최대 동시 보유 가능 여부
 */
export function canOpenPosition() {
    const cfg = loadConfig();
    const positions = getPositions();
    return positions.length < cfg.maxPositions;
}

/**
 * 일일 최대 손실 한도 체크
 * @param {number} currentCapital - 현재 자산
 * @param {number} startCapital - 오늘 시작 자산
 * @returns {boolean} true면 매매 가능, false면 중단
 */
export function checkDailyLossLimit(currentCapital, startCapital) {
    const cfg = loadConfig();
    const lossPct = ((startCapital - currentCapital) / startCapital) * 100;
    return lossPct < cfg.dailyMaxLoss;
}

/**
 * 포지션 수익률 실시간 계산 (수수료/세금 포함)
 * @param {Object} position - { symbol, buyPrice, qty, market }
 * @param {number} currentPrice
 */
export function calcPositionPnl(position, currentPrice) {
    const { buyPrice, qty, market = 'kospi' } = position;
    return calcProfit(buyPrice, currentPrice, qty, market);
}

/**
 * 포지션별 청산 판단
 * @param {Object} position
 * @param {number} currentPrice
 * @returns {{ action: 'hold'|'take_profit'|'stop_loss', pnl: Object }}
 */
export function checkPositionExit(position, currentPrice) {
    const pnl = calcPositionPnl(position, currentPrice);
    const cfg = loadConfig();

    if (pnl.returnPct >= cfg.takeProfit) {
        return { action: 'take_profit', pnl };
    }
    if (pnl.returnPct <= -cfg.stopLoss) {
        return { action: 'stop_loss', pnl };
    }
    return { action: 'hold', pnl };
}

/**
 * 전체 리스크 상태 요약
 */
export function getRiskSummary(totalCapital, startDayCapital) {
    const cfg = loadConfig();
    const positions = getPositions();
    const dailyLossOk = checkDailyLossLimit(totalCapital, startDayCapital);

    return {
        positionCount: positions.length,
        maxPositions: cfg.maxPositions,
        canOpen: positions.length < cfg.maxPositions && dailyLossOk,
        dailyLossOk,
        currentLossPct: ((startDayCapital - totalCapital) / startDayCapital * 100).toFixed(2),
        dailyMaxLoss: cfg.dailyMaxLoss,
    };
}
