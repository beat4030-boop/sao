// ===== 키움증권 REST API 모듈 =====
// 모의투자/실전투자 모드 지원
// 참고: 브라우저에서 직접 호출 시 CORS 프록시 필요

import { loadConfig } from '../core/config.js';

const BASE_URL = {
    virtual: 'https://openapivts.koreainvestment.com:29443',  // 모의투자
    real: 'https://openapi.koreainvestment.com:9443',          // 실전투자
};

let accessToken = null;
let tokenExpiry = 0;

function getBaseUrl() {
    const cfg = loadConfig();
    return cfg.proxyUrl || BASE_URL[cfg.server] || BASE_URL.virtual;
}

function getHeaders(needAuth = true) {
    const cfg = loadConfig();
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'appkey': cfg.appKey,
        'appsecret': cfg.appSecret,
    };
    if (needAuth && accessToken) {
        headers['authorization'] = `Bearer ${accessToken}`;
    }
    return headers;
}

async function request(method, path, body = null, extraHeaders = {}) {
    const url = `${getBaseUrl()}${path}`;
    const options = {
        method,
        headers: { ...getHeaders(), ...extraHeaders },
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API ${res.status}: ${errText}`);
    }
    return res.json();
}

// ===== 인증 =====

export async function getToken() {
    const cfg = loadConfig();
    const data = await request('POST', '/oauth2/tokenP', {
        grant_type: 'client_credentials',
        appkey: cfg.appKey,
        appsecret: cfg.appSecret,
    });
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // 1분 여유
    return accessToken;
}

export async function ensureToken() {
    if (!accessToken || Date.now() >= tokenExpiry) {
        await getToken();
    }
    return accessToken;
}

export function isConnected() {
    return !!accessToken && Date.now() < tokenExpiry;
}

// ===== 시세 조회 =====

/**
 * 주식 현재가 조회
 * @param {string} symbol - 종목코드 (예: '005930')
 * @returns {Promise<Object>} 시세 데이터
 */
export async function getPrice(symbol) {
    await ensureToken();
    const cfg = loadConfig();
    const isVirtual = cfg.server === 'virtual';
    const trId = isVirtual ? 'FHKST01010100' : 'FHKST01010100';

    const data = await request('GET',
        `/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}`,
        null,
        { 'tr_id': trId }
    );
    const o = data.output;
    return {
        symbol,
        name: o.hts_kor_isnm || symbol,
        price: parseInt(o.stck_prpr) || 0,
        change: parseInt(o.prdy_vrss) || 0,
        changePct: parseFloat(o.prdy_ctrt) || 0,
        open: parseInt(o.stck_oprc) || 0,
        high: parseInt(o.stck_hgpr) || 0,
        low: parseInt(o.stck_lwpr) || 0,
        volume: parseInt(o.acml_vol) || 0,
        marketCap: parseInt(o.hts_avls) || 0,
        high52w: parseInt(o.stck_dryy_hgpr) || 0,
        low52w: parseInt(o.stck_dryy_lwpr) || 0,
        market: (o.rprs_mrkt_kor_name || '').includes('코스닥') ? 'kosdaq' : 'kospi',
    };
}

/**
 * 일봉 차트 데이터 조회
 * @param {string} symbol - 종목코드
 * @param {string} startDate - 시작일 YYYYMMDD
 * @param {string} endDate - 종료일 YYYYMMDD
 */
export async function getDailyChart(symbol, startDate, endDate) {
    await ensureToken();
    const data = await request('GET',
        `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}&FID_INPUT_DATE_1=${startDate}&FID_INPUT_DATE_2=${endDate}&FID_PERIOD_DIV_CODE=D&FID_ORG_ADJ_PRC=0`,
        null,
        { 'tr_id': 'FHKST03010100' }
    );
    return (data.output2 || []).map(d => ({
        date: d.stck_bsop_date,
        open: parseInt(d.stck_oprc) || 0,
        high: parseInt(d.stck_hgpr) || 0,
        low: parseInt(d.stck_lwpr) || 0,
        close: parseInt(d.stck_clpr) || 0,
        volume: parseInt(d.acml_vol) || 0,
    })).reverse(); // 오래된 순서로
}

/**
 * 분봉 데이터 조회 (당일)
 * @param {string} symbol
 */
export async function getMinuteChart(symbol) {
    await ensureToken();
    const now = new Date();
    const time = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + '00';

    const data = await request('GET',
        `/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}&FID_INPUT_HOUR_1=${time}&FID_PW_DATA_INCU_YN=N`,
        null,
        { 'tr_id': 'FHKST03010200' }
    );
    return (data.output2 || []).map(d => ({
        time: d.stck_cntg_hour,
        open: parseInt(d.stck_oprc) || 0,
        high: parseInt(d.stck_hgpr) || 0,
        low: parseInt(d.stck_lwpr) || 0,
        close: parseInt(d.stck_prpr) || 0,
        volume: parseInt(d.cntg_vol) || 0,
    })).reverse();
}

// ===== 주문 =====

/**
 * 매수 주문
 * @param {string} symbol - 종목코드
 * @param {number} qty - 수량
 * @param {number} price - 가격 (0이면 시장가)
 */
export async function buyOrder(symbol, qty, price = 0) {
    await ensureToken();
    const cfg = loadConfig();
    const isVirtual = cfg.server === 'virtual';
    const trId = isVirtual ? 'VTTC0802U' : 'TTTC0802U';
    const ordType = price === 0 ? '01' : '00'; // 01=시장가, 00=지정가

    return request('POST', '/uapi/domestic-stock/v1/trading/order-cash', {
        CANO: cfg.account.split('-')[0],
        ACNT_PRDT_CD: cfg.account.split('-')[1] || '01',
        PDNO: symbol,
        ORD_DVSN: ordType,
        ORD_QTY: String(qty),
        ORD_UNPR: String(price),
    }, { 'tr_id': trId });
}

/**
 * 매도 주문
 */
export async function sellOrder(symbol, qty, price = 0) {
    await ensureToken();
    const cfg = loadConfig();
    const isVirtual = cfg.server === 'virtual';
    const trId = isVirtual ? 'VTTC0801U' : 'TTTC0801U';
    const ordType = price === 0 ? '01' : '00';

    return request('POST', '/uapi/domestic-stock/v1/trading/order-cash', {
        CANO: cfg.account.split('-')[0],
        ACNT_PRDT_CD: cfg.account.split('-')[1] || '01',
        PDNO: symbol,
        ORD_DVSN: ordType,
        ORD_QTY: String(qty),
        ORD_UNPR: String(price),
    }, { 'tr_id': trId });
}

// ===== 잔고 조회 =====

/**
 * 계좌 잔고 조회
 */
export async function getBalance() {
    await ensureToken();
    const cfg = loadConfig();
    const isVirtual = cfg.server === 'virtual';
    const trId = isVirtual ? 'VTTC8434R' : 'TTTC8434R';
    const acnt = cfg.account.split('-');

    const data = await request('GET',
        `/uapi/domestic-stock/v1/trading/inquire-balance?CANO=${acnt[0]}&ACNT_PRDT_CD=${acnt[1] || '01'}&AFHR_FLPR_YN=N&OFL_YN=&INQR_DVSN=02&UNPR_DVSN=01&FUND_STTL_ICLD_YN=N&FNCG_AMT_AUTO_RDPT_YN=N&PRCS_DVSN=00&CTX_AREA_FK100=&CTX_AREA_NK100=`,
        null,
        { 'tr_id': trId }
    );

    const holdings = (data.output1 || []).map(h => ({
        symbol: h.pdno,
        name: h.prdt_name,
        qty: parseInt(h.hldg_qty) || 0,
        avgPrice: parseInt(h.pchs_avg_pric) || 0,
        currentPrice: parseInt(h.prpr) || 0,
        pnl: parseInt(h.evlu_pfls_amt) || 0,
        pnlPct: parseFloat(h.evlu_pfls_rt) || 0,
    }));

    const summary = data.output2?.[0] || {};
    return {
        holdings,
        totalDeposit: parseInt(summary.dnca_tot_amt) || 0,
        totalEval: parseInt(summary.tot_evlu_amt) || 0,
        totalPnl: parseInt(summary.evlu_pfls_smtl_amt) || 0,
    };
}

// ===== 종목 검색 (간이) =====
// 키움 API에는 종목 검색이 별도로 없으므로 로컬 데이터 사용
const POPULAR_STOCKS = [
    { symbol: '005930', name: '삼성전자', market: 'kospi' },
    { symbol: '000660', name: 'SK하이닉스', market: 'kospi' },
    { symbol: '373220', name: 'LG에너지솔루션', market: 'kospi' },
    { symbol: '005380', name: '현대차', market: 'kospi' },
    { symbol: '035420', name: 'NAVER', market: 'kospi' },
    { symbol: '000270', name: '기아', market: 'kospi' },
    { symbol: '068270', name: '셀트리온', market: 'kospi' },
    { symbol: '035720', name: '카카오', market: 'kospi' },
    { symbol: '051910', name: 'LG화학', market: 'kospi' },
    { symbol: '006400', name: '삼성SDI', market: 'kospi' },
    { symbol: '055550', name: '신한지주', market: 'kospi' },
    { symbol: '003670', name: '포스코퓨처엠', market: 'kospi' },
    { symbol: '247540', name: '에코프로비엠', market: 'kosdaq' },
    { symbol: '086520', name: '에코프로', market: 'kosdaq' },
    { symbol: '196170', name: '알테오젠', market: 'kosdaq' },
    { symbol: '403870', name: '한빛레이저', market: 'kosdaq' },
    { symbol: '066570', name: 'LG전자', market: 'kospi' },
    { symbol: '028260', name: '삼성물산', market: 'kospi' },
    { symbol: '105560', name: 'KB금융', market: 'kospi' },
    { symbol: '012330', name: '현대모비스', market: 'kospi' },
];

export function searchStocks(query) {
    if (!query) return POPULAR_STOCKS.slice(0, 10);
    const q = query.toLowerCase();
    return POPULAR_STOCKS.filter(s =>
        s.symbol.includes(q) || s.name.toLowerCase().includes(q)
    );
}

export function getStockMarket(symbol) {
    const found = POPULAR_STOCKS.find(s => s.symbol === symbol);
    return found ? found.market : 'kospi';
}

export { POPULAR_STOCKS };
