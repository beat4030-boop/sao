// ===== 자동매매 엔진 =====
// 메인 매매 루프: 시세 조회 → 지표 분석 → AI 예측 → 매매 실행

import { loadConfig, calcProfit } from '../core/config.js';
import * as storage from '../core/storage.js';
import * as kis from '../api/kis.js';
import * as marketData from '../api/market-data.js';
import { generateSignal } from './strategy.js';
import { checkPositionExit, calcPositionAmount, calcBuyQty, canOpenPosition, checkDailyLossLimit } from './risk.js';

let isRunning = false;
let intervalId = null;
let startDayCapital = 0;

// 콜백 등록
let onSignal = null;
let onPositionUpdate = null;
let onError = null;

export function setCallbacks({ onSignalCb, onPositionUpdateCb, onErrorCb }) {
    onSignal = onSignalCb;
    onPositionUpdate = onPositionUpdateCb;
    onError = onErrorCb;
}

/**
 * 자동매매 시작
 * @param {string[]} watchlist - 감시 종목 코드 목록
 * @param {Function|null} getAiScore - AI 점수 함수 (closes, volumes) => number
 */
export function start(watchlist, getAiScore = null) {
    if (isRunning) return;

    const cfg = loadConfig();
    startDayCapital = cfg.capital;
    isRunning = true;

    emit('signal', { type: 'info', text: `자동매매 시작 - ${watchlist.length}개 종목 감시중` });

    // 30초마다 분석/매매 실행
    runCycle(watchlist, getAiScore);
    intervalId = setInterval(() => runCycle(watchlist, getAiScore), 30000);
}

export function stop() {
    isRunning = false;
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    emit('signal', { type: 'info', text: '자동매매 중지' });
}

export function getIsRunning() { return isRunning; }

// ===== 매매 사이클 =====

async function runCycle(watchlist, getAiScore) {
    if (!isRunning) return;

    try {
        const cfg = loadConfig();
        const useApi = kis.isConnected();

        // 1. 보유 포지션 청산 체크
        await checkExitPositions(useApi);

        // 2. 일일 손실 한도 체크
        const currentCapital = calcCurrentCapital();
        if (!checkDailyLossLimit(currentCapital, startDayCapital)) {
            emit('signal', { type: 'sell', text: `일일 최대 손실 ${cfg.dailyMaxLoss}% 도달 - 매매 중단` });
            stop();
            return;
        }

        // 3. 신규 매수 검토
        if (canOpenPosition()) {
            for (const symbol of watchlist) {
                if (!isRunning) break;
                await analyzeAndTrade(symbol, useApi, getAiScore);
                await sleep(100); // API 호출 간격
            }
        }
    } catch (e) {
        console.error('Trading cycle error:', e);
        emit('error', e.message);
    }
}

/**
 * 보유 포지션 청산 체크
 */
async function checkExitPositions(useApi) {
    const positions = storage.getPositions();

    for (const pos of positions) {
        try {
            let currentPrice;
            if (useApi) {
                const priceData = await kis.getPrice(pos.symbol);
                currentPrice = priceData.price;
            } else {
                // 모의: 약간의 변동 시뮬레이션
                currentPrice = simulatePrice(pos.buyPrice);
            }

            const { action, pnl } = checkPositionExit(pos, currentPrice);

            if (action === 'take_profit') {
                await executeExit(pos, currentPrice, pnl, '익절', useApi);
            } else if (action === 'stop_loss') {
                await executeExit(pos, currentPrice, pnl, '손절', useApi);
            } else {
                // 포지션 현재 상태 업데이트
                emit('positionUpdate', { ...pos, currentPrice, pnl });
            }
        } catch (e) {
            console.warn(`Exit check failed for ${pos.symbol}:`, e.message);
        }
    }
}

/**
 * 종목 분석 및 매수 실행
 */
async function analyzeAndTrade(symbol, useApi, getAiScore) {
    try {
        // 이미 보유중인 종목은 스킵
        const positions = storage.getPositions();
        if (positions.find(p => p.symbol === symbol)) return;

        // 일봉 데이터 가져오기
        let dailyData;
        if (useApi) {
            dailyData = await marketData.fetchDailyData(symbol, 100);
        } else {
            dailyData = marketData.generateMockDaily(100);
        }

        if (dailyData.length < 30) return; // 데이터 부족

        const closes = marketData.extractCloses(dailyData);
        const volumes = marketData.extractVolumes(dailyData);

        // AI 점수 (있으면)
        let aiScore = null;
        if (getAiScore) {
            try {
                aiScore = await getAiScore(closes, volumes);
            } catch (e) {
                console.warn('AI score failed:', e.message);
            }
        }

        // 매매 시그널 생성
        const signal = generateSignal(closes, volumes, aiScore);

        emit('signal', {
            type: signal.action === 'buy' ? 'buy' : signal.action === 'sell' ? 'sell' : 'info',
            text: `[${symbol}] 점수 ${signal.finalScore} → ${signal.action.toUpperCase()} (신뢰도 ${signal.confidence}%)`,
            details: signal,
        });

        // 매수 실행
        if (signal.action === 'buy' && signal.confidence >= 30) {
            const cfg = loadConfig();
            const currentPrice = closes[closes.length - 1];
            const investAmount = calcPositionAmount(cfg.capital);
            const qty = calcBuyQty(investAmount, currentPrice);

            if (qty > 0) {
                await executeBuy(symbol, qty, currentPrice, useApi, signal);
            }
        }
    } catch (e) {
        console.warn(`Analysis failed for ${symbol}:`, e.message);
    }
}

/**
 * 매수 실행
 */
async function executeBuy(symbol, qty, price, useApi, signal) {
    try {
        if (useApi) {
            await kis.buyOrder(symbol, qty, 0); // 시장가
        }

        const market = kis.getStockMarket(symbol);
        const position = {
            symbol,
            name: kis.POPULAR_STOCKS.find(s => s.symbol === symbol)?.name || symbol,
            buyPrice: price,
            qty,
            market,
            signal: signal.finalScore,
        };

        storage.addPosition(position);

        // 자본금 차감
        const cfg = loadConfig();
        const { saveConfig } = await import('../core/config.js');
        cfg.capital -= price * qty;
        saveConfig(cfg);

        emit('signal', {
            type: 'buy',
            text: `매수 체결: ${position.name} ${qty}주 @ ${price.toLocaleString()}원`,
        });

        storage.addTradeRecord({
            type: 'buy', symbol, name: position.name,
            qty, price, market, score: signal.finalScore,
        });

        emit('positionUpdate', position);
    } catch (e) {
        emit('error', `매수 실패 [${symbol}]: ${e.message}`);
    }
}

/**
 * 매도 실행
 */
async function executeExit(position, currentPrice, pnl, reason, useApi) {
    try {
        if (useApi) {
            await kis.sellOrder(position.symbol, position.qty, 0); // 시장가
        }

        storage.removePosition(position.symbol);

        // 자본금 복원 (매도금액 - 비용)
        const cfg = loadConfig();
        const { saveConfig } = await import('../core/config.js');
        const sellAmount = currentPrice * position.qty;
        cfg.capital += sellAmount - pnl.sellCost;
        saveConfig(cfg);

        const pnlText = pnl.net >= 0
            ? `+${pnl.net.toLocaleString()}원 (+${pnl.returnPct.toFixed(2)}%)`
            : `${pnl.net.toLocaleString()}원 (${pnl.returnPct.toFixed(2)}%)`;

        emit('signal', {
            type: 'sell',
            text: `${reason}: ${position.name} ${position.qty}주 @ ${currentPrice.toLocaleString()}원 → ${pnlText}`,
        });

        storage.addTradeRecord({
            type: 'sell', symbol: position.symbol, name: position.name,
            qty: position.qty, buyPrice: position.buyPrice,
            sellPrice: currentPrice, pnl: pnl.net, pnlPct: pnl.returnPct,
            reason, market: position.market,
            buyCost: pnl.buyCost, sellCost: pnl.sellCost,
        });

        emit('positionUpdate', null);
    } catch (e) {
        emit('error', `매도 실패 [${position.symbol}]: ${e.message}`);
    }
}

// ===== 헬퍼 =====

function calcCurrentCapital() {
    const cfg = loadConfig();
    const positions = storage.getPositions();
    let posValue = 0;
    for (const p of positions) {
        posValue += p.buyPrice * p.qty; // 간이 계산
    }
    return cfg.capital + posValue;
}

function simulatePrice(basePrice) {
    // 모의투자용 가격 시뮬레이션 (-2% ~ +3%)
    const change = (Math.random() - 0.45) * 0.04;
    return Math.round(basePrice * (1 + change));
}

function emit(type, data) {
    if (type === 'signal' && onSignal) onSignal(data);
    if (type === 'positionUpdate' && onPositionUpdate) onPositionUpdate(data);
    if (type === 'error' && onError) onError(data);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== 백테스트 =====

/**
 * 과거 데이터로 전략 백테스트
 * @param {Array} dailyData - 일봉 데이터
 * @param {Function|null} getAiScore
 * @returns {Object} 백테스트 결과
 */
export function backtest(dailyData, getAiScore = null) {
    const cfg = loadConfig();
    let capital = cfg.capital;
    const startCapital = capital;
    let position = null;
    const trades = [];
    let maxCapital = capital;
    let maxDrawdown = 0;
    const equityCurve = [];

    for (let i = 60; i < dailyData.length; i++) {
        const closes = dailyData.slice(0, i + 1).map(d => d.close);
        const volumes = dailyData.slice(0, i + 1).map(d => d.volume);
        const currentPrice = dailyData[i].close;
        const date = dailyData[i].date;

        // 보유중이면 청산 체크
        if (position) {
            const pnl = calcProfit(position.buyPrice, currentPrice, position.qty, 'kospi');

            if (pnl.returnPct >= cfg.takeProfit) {
                capital += currentPrice * position.qty - pnl.sellCost;
                trades.push({
                    date, type: 'sell', reason: '익절',
                    buyPrice: position.buyPrice, sellPrice: currentPrice,
                    qty: position.qty, pnl: pnl.net, pnlPct: pnl.returnPct,
                });
                position = null;
            } else if (pnl.returnPct <= -cfg.stopLoss) {
                capital += currentPrice * position.qty - pnl.sellCost;
                trades.push({
                    date, type: 'sell', reason: '손절',
                    buyPrice: position.buyPrice, sellPrice: currentPrice,
                    qty: position.qty, pnl: pnl.net, pnlPct: pnl.returnPct,
                });
                position = null;
            }
        }

        // 미보유면 매수 검토
        if (!position && closes.length >= 30) {
            const signal = generateSignal(closes, volumes, null);

            if (signal.action === 'buy' && signal.confidence >= 30) {
                const investAmount = Math.floor(capital * (cfg.positionSize / 100));
                const qty = Math.floor(investAmount / currentPrice);
                if (qty > 0) {
                    capital -= currentPrice * qty;
                    position = { buyPrice: currentPrice, qty };
                    trades.push({ date, type: 'buy', price: currentPrice, qty, score: signal.finalScore });
                }
            }
        }

        // 자산 평가
        const equity = capital + (position ? position.qty * currentPrice : 0);
        equityCurve.push({ date, equity });
        maxCapital = Math.max(maxCapital, equity);
        const dd = ((maxCapital - equity) / maxCapital) * 100;
        maxDrawdown = Math.max(maxDrawdown, dd);
    }

    // 마지막 포지션 강제 청산
    if (position) {
        const lastPrice = dailyData[dailyData.length - 1].close;
        const pnl = calcProfit(position.buyPrice, lastPrice, position.qty, 'kospi');
        capital += lastPrice * position.qty - pnl.sellCost;
        trades.push({
            date: dailyData[dailyData.length - 1].date,
            type: 'sell', reason: '기간종료',
            buyPrice: position.buyPrice, sellPrice: lastPrice,
            qty: position.qty, pnl: pnl.net, pnlPct: pnl.returnPct,
        });
    }

    const sellTrades = trades.filter(t => t.type === 'sell');
    const wins = sellTrades.filter(t => t.pnl > 0);
    const losses = sellTrades.filter(t => t.pnl <= 0);

    return {
        totalReturn: ((capital - startCapital) / startCapital * 100).toFixed(2),
        winRate: sellTrades.length > 0 ? ((wins.length / sellTrades.length) * 100).toFixed(1) : '0',
        totalTrades: sellTrades.length,
        maxDrawdown: maxDrawdown.toFixed(2),
        avgWin: wins.length > 0 ? (wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length).toFixed(2) : '0',
        avgLoss: losses.length > 0 ? (losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length).toFixed(2) : '0',
        trades,
        equityCurve,
        finalCapital: Math.round(capital),
    };
}
