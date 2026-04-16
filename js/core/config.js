// ===== 설정 관리 =====
// 모든 설정값의 기본값과 localStorage 동기화

const DEFAULT_CONFIG = {
    // 키움 API
    appKey: '',
    appSecret: '',
    account: '',
    server: 'virtual',   // 'virtual' | 'real'
    proxyUrl: '',

    // 자본금
    capital: 10_000_000,

    // 매매 조건
    takeProfit: 2.0,      // 익절 %
    stopLoss: 1.0,        // 손절 %
    positionSize: 10,     // 1회 투자비율 %
    maxPositions: 5,      // 최대 동시보유
    dailyMaxLoss: 3.0,    // 일일 최대 손실 %

    // 기술적 지표
    rsiPeriod: 14,
    rsiBuy: 30,
    rsiSell: 70,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    bbPeriod: 20,

    // AI
    aiBuyScore: 70,
    aiSellScore: 30,
    aiRetrain: true,

    // 테마
    theme: 'dark',
};

// 수수료/세금 (2026년 기준, 변경 불가)
export const FEES = {
    // 키움증권 HTS/모바일 수수료
    buyCommission: 0.00015,     // 매수 수수료 0.015%
    sellCommission: 0.00015,    // 매도 수수료 0.015%

    // 증권거래세 + 농어촌특별세
    kospiTax: 0.0018,           // 코스피: 거래세 0.18%
    kospiFarmTax: 0.0015,       // 코스피: 농특세 0.15%
    kosdaqTax: 0.0018,          // 코스닥: 거래세 0.18%
    kosdaqFarmTax: 0,           // 코스닥: 농특세 없음
};

/**
 * 매도 시 총 비용 계산
 * @param {number} amount - 매도금액
 * @param {'kospi'|'kosdaq'} market - 시장 구분
 * @returns {{ commission: number, tax: number, total: number }}
 */
export function calcSellCost(amount, market = 'kospi') {
    const commission = Math.floor(amount * FEES.sellCommission);
    let tax;
    if (market === 'kosdaq') {
        tax = Math.floor(amount * FEES.kosdaqTax);
    } else {
        tax = Math.floor(amount * (FEES.kospiTax + FEES.kospiFarmTax));
    }
    return { commission, tax, total: commission + tax };
}

/**
 * 매수 시 총 비용 계산
 * @param {number} amount - 매수금액
 * @returns {{ commission: number, total: number }}
 */
export function calcBuyCost(amount) {
    const commission = Math.floor(amount * FEES.buyCommission);
    return { commission, total: commission };
}

/**
 * 순수익 계산 (매수→매도)
 * @param {number} buyPrice  - 매수 단가
 * @param {number} sellPrice - 매도 단가
 * @param {number} qty       - 수량
 * @param {'kospi'|'kosdaq'} market
 * @returns {{ gross: number, buyCost: number, sellCost: number, net: number, returnPct: number }}
 */
export function calcProfit(buyPrice, sellPrice, qty, market = 'kospi') {
    const buyAmount = buyPrice * qty;
    const sellAmount = sellPrice * qty;
    const gross = sellAmount - buyAmount;
    const buyCost = calcBuyCost(buyAmount).total;
    const sellCost = calcSellCost(sellAmount, market).total;
    const net = gross - buyCost - sellCost;
    const returnPct = buyAmount > 0 ? (net / buyAmount) * 100 : 0;
    return { gross, buyCost, sellCost, net, returnPct };
}

// ===== Config Load / Save =====

const STORAGE_KEY = 'sao_config';

export function loadConfig() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.warn('Config load failed:', e);
    }
    return { ...DEFAULT_CONFIG };
}

export function saveConfig(config) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
        console.warn('Config save failed:', e);
    }
}

export function resetConfig() {
    localStorage.removeItem(STORAGE_KEY);
    return { ...DEFAULT_CONFIG };
}

export { DEFAULT_CONFIG };
