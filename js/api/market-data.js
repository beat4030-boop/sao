// ===== 시세 데이터 가공 =====
// API에서 받은 원시 데이터를 지표 계산 및 차트에 맞게 가공

import * as kis from './kis.js';

/**
 * 종목의 최근 N일 일봉 데이터 가져오기
 * @param {string} symbol
 * @param {number} days
 * @returns {Promise<Array>}
 */
export async function fetchDailyData(symbol, days = 100) {
    const endDate = formatDate(new Date());
    const startDate = formatDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    return kis.getDailyChart(symbol, startDate, endDate);
}

/**
 * 종목의 당일 분봉 데이터
 */
export async function fetchMinuteData(symbol) {
    return kis.getMinuteChart(symbol);
}

/**
 * 여러 종목 현재가 동시 조회
 * @param {string[]} symbols
 */
export async function fetchMultiplePrices(symbols) {
    const results = {};
    // 순차 호출 (API 초당 제한 고려)
    for (const sym of symbols) {
        try {
            results[sym] = await kis.getPrice(sym);
            // API 초당 호출 제한 방지 (20건/초)
            await sleep(60);
        } catch (e) {
            console.warn(`Price fetch failed for ${sym}:`, e.message);
            results[sym] = null;
        }
    }
    return results;
}

/**
 * 종목 데이터에서 종가 배열만 추출
 */
export function extractCloses(dailyData) {
    return dailyData.map(d => d.close);
}

/**
 * 종목 데이터에서 거래량 배열만 추출
 */
export function extractVolumes(dailyData) {
    return dailyData.map(d => d.volume);
}

/**
 * 종목 데이터에서 OHLCV 추출
 */
export function extractOHLCV(dailyData) {
    return {
        opens: dailyData.map(d => d.open),
        highs: dailyData.map(d => d.high),
        lows: dailyData.map(d => d.low),
        closes: dailyData.map(d => d.close),
        volumes: dailyData.map(d => d.volume),
        dates: dailyData.map(d => d.date),
    };
}

// ===== 데모/모의 데이터 생성 =====
// API 연결 전 테스트용

/**
 * 가상의 일봉 데이터 생성 (테스트용)
 */
export function generateMockDaily(days = 100, basePrice = 70000) {
    const data = [];
    let price = basePrice;
    const now = new Date();

    for (let i = days; i >= 0; i--) {
        const date = new Date(now - i * 86400000);
        const dateStr = formatDate(date);

        const changeRate = (Math.random() - 0.48) * 0.04; // 약간의 상승 편향
        const open = price;
        const close = Math.round(price * (1 + changeRate));
        const high = Math.round(Math.max(open, close) * (1 + Math.random() * 0.015));
        const low = Math.round(Math.min(open, close) * (1 - Math.random() * 0.015));
        const volume = Math.round(1000000 + Math.random() * 5000000);

        data.push({ date: dateStr, open, high, low, close, volume });
        price = close;
    }
    return data;
}

/**
 * 가상의 현재가 데이터 생성
 */
export function generateMockPrice(symbol, name = '테스트종목') {
    const basePrice = 50000 + Math.round(Math.random() * 50000);
    const change = Math.round((Math.random() - 0.5) * basePrice * 0.04);
    return {
        symbol,
        name,
        price: basePrice,
        change,
        changePct: parseFloat(((change / (basePrice - change)) * 100).toFixed(2)),
        open: basePrice - Math.round(Math.random() * 1000),
        high: basePrice + Math.round(Math.random() * 2000),
        low: basePrice - Math.round(Math.random() * 2000),
        volume: Math.round(Math.random() * 10000000),
        marketCap: basePrice * 1000000,
        high52w: basePrice + Math.round(Math.random() * 20000),
        low52w: basePrice - Math.round(Math.random() * 20000),
        market: 'kospi',
    };
}

// ===== Utils =====

function formatDate(d) {
    return d.getFullYear() +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0');
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
