// ===== SmartCollector - AI 패턴 학습 =====
// 과거 매매 데이터에서 반복되는 패턴을 수집하고 매칭

import * as storage from '../core/storage.js';
import { calcAllIndicators } from '../trading/indicators.js';

const MAX_PATTERNS = 500;
const PATTERN_LENGTH = 5; // 최근 5봉 패턴

let patterns = [];
let modelPerformance = 0;

/**
 * 현재 시장 상태를 패턴 벡터로 변환
 * @param {number[]} closes - 최근 종가 (최소 30개)
 * @param {number[]} volumes - 최근 거래량
 * @returns {number[]} 패턴 벡터
 */
export function createPatternVector(closes, volumes) {
    if (closes.length < 30) return null;

    const recent = closes.slice(-PATTERN_LENGTH);
    const base = recent[0];

    // 최근 5일 가격 변화 패턴 (정규화)
    const pricePattern = recent.map(p => ((p - base) / base) * 100);

    // 거래량 패턴
    const recentVol = volumes.slice(-PATTERN_LENGTH);
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const volPattern = recentVol.map(v => avgVol > 0 ? v / avgVol : 1);

    return [...pricePattern, ...volPattern]; // 10차원 벡터
}

/**
 * 매매 결과를 패턴으로 수집
 * @param {number[]} closes
 * @param {number[]} volumes
 * @param {number} resultPct - 매매 결과 수익률
 * @param {string} action - 'buy' | 'sell'
 */
export function collectPattern(closes, volumes, resultPct, action) {
    const vector = createPatternVector(closes, volumes);
    if (!vector) return;

    patterns.push({
        vector,
        result: resultPct,
        action,
        time: new Date().toISOString(),
    });

    // 크기 제한
    if (patterns.length > MAX_PATTERNS) {
        patterns = patterns.slice(-MAX_PATTERNS);
    }

    storage.save('patterns', patterns);
    updatePerformance();
}

/**
 * 현재 패턴과 유사한 과거 패턴 찾기
 * @param {number[]} closes
 * @param {number[]} volumes
 * @param {number} topK - 상위 K개
 * @returns {{ matches: Array, avgResult: number, winRate: number }}
 */
export function matchPattern(closes, volumes, topK = 10) {
    const current = createPatternVector(closes, volumes);
    if (!current || patterns.length < 5) {
        return { matches: [], avgResult: 0, winRate: 50, confidence: 0 };
    }

    // 코사인 유사도로 매칭
    const scored = patterns.map(p => ({
        ...p,
        similarity: cosineSimilarity(current, p.vector),
    })).sort((a, b) => b.similarity - a.similarity);

    const top = scored.slice(0, topK);
    const wins = top.filter(t => t.result > 0).length;
    const avgResult = top.reduce((s, t) => s + t.result, 0) / top.length;

    return {
        matches: top,
        avgResult: parseFloat(avgResult.toFixed(3)),
        winRate: parseFloat(((wins / top.length) * 100).toFixed(1)),
        confidence: Math.round(top[0]?.similarity * 100 || 0),
    };
}

/**
 * 패턴 기반 점수 (0~100)
 */
export function getPatternScore(closes, volumes) {
    const result = matchPattern(closes, volumes);
    if (result.matches.length === 0) return 50;

    // 평균 결과가 양이면 높은 점수, 음이면 낮은 점수
    let score = 50 + result.avgResult * 20; // ±5% → ±100 범위
    score = Math.max(0, Math.min(100, score));

    // 신뢰도 가중
    const confWeight = result.confidence / 100;
    score = 50 + (score - 50) * confWeight;

    return Math.round(score);
}

// ===== 학습 =====

/**
 * 저장된 거래 기록으로 패턴 일괄 학습
 * @param {Array} dailyDataMap - { symbol: dailyData[] } 종목별 일봉 데이터
 */
export function learnFromHistory(trades, dailyDataMap) {
    let learned = 0;

    for (const trade of trades) {
        if (trade.type !== 'sell') continue;

        const data = dailyDataMap[trade.symbol];
        if (!data || data.length < 30) continue;

        const closes = data.map(d => d.close);
        const volumes = data.map(d => d.volume);

        collectPattern(closes, volumes, trade.pnlPct || 0, 'sell');
        learned++;
    }

    return learned;
}

/**
 * 모델 성능 업데이트
 */
function updatePerformance() {
    if (patterns.length < 10) {
        modelPerformance = 0;
        return;
    }

    // 최근 매칭 정확도 계산 (간이)
    let correct = 0;
    const testSet = patterns.slice(-20);

    for (const p of testSet) {
        // 해당 패턴 제외하고 매칭
        const others = patterns.filter(o => o !== p);
        if (others.length < 5) continue;

        const similar = others
            .map(o => ({ ...o, sim: cosineSimilarity(p.vector, o.vector) }))
            .sort((a, b) => b.sim - a.sim)
            .slice(0, 5);

        const predictedPositive = similar.reduce((s, o) => s + o.result, 0) > 0;
        const actualPositive = p.result > 0;

        if (predictedPositive === actualPositive) correct++;
    }

    modelPerformance = parseFloat(((correct / testSet.length) * 100).toFixed(1));
}

// ===== 로드/초기화 =====

export function loadPatterns() {
    patterns = storage.load('patterns', []);
    updatePerformance();
    return patterns.length;
}

export function getInfo() {
    return {
        dataCount: patterns.length,
        patternCount: Math.min(patterns.length, 10),
        performance: modelPerformance,
        winRate: patterns.length > 0
            ? ((patterns.filter(p => p.result > 0).length / patterns.length) * 100).toFixed(1)
            : '0',
        avgResult: patterns.length > 0
            ? (patterns.reduce((s, p) => s + p.result, 0) / patterns.length).toFixed(2)
            : '0',
    };
}

// ===== 유틸 =====

function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}
