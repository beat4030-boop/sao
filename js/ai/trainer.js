// ===== AI 학습 관리 =====
// 학습 데이터 수집, 자동 재학습 트리거

import * as model from './model.js';
import * as marketData from '../api/market-data.js';
import { loadConfig } from '../core/config.js';
import * as storage from '../core/storage.js';

/**
 * 특정 종목 데이터로 AI 학습
 * @param {string} symbol - 종목코드
 * @param {boolean} useApi - API 사용 여부
 * @param {Function} onProgress
 */
export async function trainOnSymbol(symbol, useApi = false, onProgress = null) {
    let dailyData;
    if (useApi) {
        dailyData = await marketData.fetchDailyData(symbol, 365);
    } else {
        dailyData = marketData.generateMockDaily(365);
    }

    if (dailyData.length < 80) {
        throw new Error(`데이터 부족: ${dailyData.length}일 (최소 80일 필요)`);
    }

    const closes = marketData.extractCloses(dailyData);
    const volumes = marketData.extractVolumes(dailyData);

    const result = await model.train(closes, volumes, onProgress);
    await model.saveModel();

    return result;
}

/**
 * 여러 종목 데이터로 통합 학습
 * @param {string[]} symbols
 * @param {boolean} useApi
 * @param {Function} onProgress
 */
export async function trainOnMultiple(symbols, useApi = false, onProgress = null) {
    let allCloses = [];
    let allVolumes = [];

    for (let i = 0; i < symbols.length; i++) {
        try {
            let dailyData;
            if (useApi) {
                dailyData = await marketData.fetchDailyData(symbols[i], 365);
            } else {
                dailyData = marketData.generateMockDaily(365);
            }

            const closes = marketData.extractCloses(dailyData);
            const volumes = marketData.extractVolumes(dailyData);

            // 종목 간 구분을 위해 끝에 여유 추가
            allCloses = allCloses.concat(closes);
            allVolumes = allVolumes.concat(volumes);

            if (onProgress) {
                onProgress(-1, -1, 0, 0, `${symbols[i]} 데이터 수집 (${i+1}/${symbols.length})`);
            }
        } catch (e) {
            console.warn(`Data fetch failed for ${symbols[i]}:`, e.message);
        }
    }

    if (allCloses.length < 80) {
        throw new Error('통합 데이터 부족');
    }

    const result = await model.train(allCloses, allVolumes, onProgress);
    await model.saveModel();

    return result;
}

/**
 * 자동 재학습 체크 (매일 1회)
 */
export function shouldRetrain() {
    const cfg = loadConfig();
    if (!cfg.aiRetrain) return false;

    const info = model.getModelInfo();
    if (!info.lastTrained) return true;

    const lastTrained = new Date(info.lastTrained);
    const now = new Date();
    const hoursDiff = (now - lastTrained) / (1000 * 60 * 60);

    return hoursDiff >= 24; // 24시간마다 재학습
}

/**
 * 저장된 모델 불러오기 시도
 */
export async function tryLoadModel() {
    return model.loadModel();
}
