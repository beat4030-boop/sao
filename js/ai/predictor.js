// ===== AI 예측 래퍼 =====
// 실시간 예측 점수를 매매 엔진에 제공

import * as model from './model.js';

/**
 * AI 매수 점수 반환 (0~100)
 * 매매 엔진에서 콜백으로 사용
 *
 * @param {number[]} closes
 * @param {number[]} volumes
 * @returns {Promise<number|null>}
 */
export async function getAiScore(closes, volumes) {
    const info = model.getModelInfo();
    if (!info.isReady) return null;

    return model.predict(closes, volumes);
}

/**
 * AI 모델 상태 확인
 */
export function isReady() {
    return model.getModelInfo().isReady;
}

/**
 * AI 모델 정보
 */
export function getInfo() {
    return model.getModelInfo();
}
