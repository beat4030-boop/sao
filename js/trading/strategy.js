// ===== 매매 전략 판단 =====

import { loadConfig } from '../core/config.js';
import { calcAllIndicators } from './indicators.js';

/**
 * 기술적 지표 기반 점수 계산
 * 각 지표별 0~100 점수를 매기고 가중평균
 *
 * @param {number[]} closes - 종가 배열
 * @param {number[]} volumes - 거래량 배열
 * @returns {Object} 점수 상세
 */
export function calcTechnicalScore(closes, volumes) {
    const cfg = loadConfig();
    const ind = calcAllIndicators(closes, volumes, cfg);

    // === RSI 점수 (0~100) ===
    // RSI 30 이하 = 매수 (100점), 50 = 중립 (50점), 70 이상 = 매도 (0점)
    let rsiScore = 50;
    if (ind.rsi.current !== null) {
        const r = ind.rsi.current;
        if (r <= cfg.rsiBuy) {
            rsiScore = 80 + (cfg.rsiBuy - r) / cfg.rsiBuy * 20; // 80~100
        } else if (r >= cfg.rsiSell) {
            rsiScore = 20 - (r - cfg.rsiSell) / (100 - cfg.rsiSell) * 20; // 0~20
        } else {
            // 30~70 구간: 선형 보간
            rsiScore = 80 - ((r - cfg.rsiBuy) / (cfg.rsiSell - cfg.rsiBuy)) * 60; // 20~80
        }
    }

    // === MACD 점수 ===
    let macdScore = 50;
    if (ind.macd.goldenCross) {
        macdScore = 90;
    } else if (ind.macd.deadCross) {
        macdScore = 10;
    } else if (ind.macd.currentHist !== null) {
        // 히스토그램 크기에 따라
        const h = ind.macd.currentHist;
        const prevH = ind.macd.prevHist || 0;
        if (h > 0 && h > prevH) macdScore = 75; // 양 + 증가
        else if (h > 0) macdScore = 60;          // 양 + 감소
        else if (h < 0 && h > prevH) macdScore = 40; // 음 + 회복
        else macdScore = 25;                      // 음 + 감소
    }

    // === 볼린저밴드 점수 ===
    let bbScore = 50;
    if (ind.bb.currentPercentB !== null) {
        const pB = ind.bb.currentPercentB;
        if (pB <= 0) bbScore = 95;       // 하단 이탈 (극과매도)
        else if (pB <= 0.2) bbScore = 80; // 하단 근접
        else if (pB >= 1) bbScore = 5;    // 상단 이탈 (극과매수)
        else if (pB >= 0.8) bbScore = 20; // 상단 근접
        else bbScore = 50 + (0.5 - pB) * 60; // 중간
    }

    // === 거래량 점수 ===
    let volScore = 50;
    if (ind.volume.currentRatio !== null) {
        const vr = ind.volume.currentRatio;
        if (vr >= 2.0) volScore = 90;       // 거래 폭발
        else if (vr >= 1.5) volScore = 75;   // 거래 급증
        else if (vr >= 1.0) volScore = 55;   // 평균 이상
        else if (vr >= 0.5) volScore = 35;   // 평균 이하
        else volScore = 20;                   // 거래 한산
    }

    // === 가중 평균 ===
    const weights = { rsi: 0.25, macd: 0.30, bb: 0.25, vol: 0.20 };
    const techScore =
        rsiScore * weights.rsi +
        macdScore * weights.macd +
        bbScore * weights.bb +
        volScore * weights.vol;

    return {
        rsi: Math.round(rsiScore),
        macd: Math.round(macdScore),
        bb: Math.round(bbScore),
        vol: Math.round(volScore),
        techScore: Math.round(techScore),
        indicators: ind,
    };
}

/**
 * 최종 매매 결정 (기술적 지표 + AI 점수 합산)
 * @param {number} techScore - 기술적 지표 점수 (0~100)
 * @param {number|null} aiScore - AI 예측 점수 (0~100, null이면 기술적만 사용)
 * @returns {{ finalScore: number, action: 'buy'|'sell'|'hold', confidence: number }}
 */
export function makeDecision(techScore, aiScore = null) {
    const cfg = loadConfig();

    let finalScore;
    if (aiScore !== null) {
        // AI 가중치 40%, 기술적 60%
        finalScore = Math.round(techScore * 0.6 + aiScore * 0.4);
    } else {
        finalScore = techScore;
    }

    let action = 'hold';
    let confidence = 0;

    if (finalScore >= cfg.aiBuyScore) {
        action = 'buy';
        confidence = Math.min(100, Math.round((finalScore - cfg.aiBuyScore) / (100 - cfg.aiBuyScore) * 100));
    } else if (finalScore <= cfg.aiSellScore) {
        action = 'sell';
        confidence = Math.min(100, Math.round((cfg.aiSellScore - finalScore) / cfg.aiSellScore * 100));
    } else {
        action = 'hold';
        confidence = 0;
    }

    return { finalScore, action, confidence };
}

/**
 * 매매 시그널 생성 (분석 결과 종합)
 */
export function generateSignal(closes, volumes, aiScore = null) {
    const tech = calcTechnicalScore(closes, volumes);
    const decision = makeDecision(tech.techScore, aiScore);

    return {
        ...decision,
        details: tech,
        aiScore,
        timestamp: new Date().toISOString(),
    };
}
