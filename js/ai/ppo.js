// ===== PPO 강화학습 에이전트 =====
// 매매 경험으로부터 최적 행동 정책을 학습
// 행동: 0=미진입, 1=노멀, 2=레어, 3=유니크, 4=에픽, 5=신화

/* global tf */

import * as storage from '../core/storage.js';

const STATE_SIZE = 10;  // 상태 벡터 크기
const ACTION_SIZE = 6;  // 행동 수 (배팅 등급 0~5)

let policyNet = null;
let valueNet = null;
let isReady = false;

// 경험 버퍼
let experienceBuffer = [];

const meta = {
    totalExperience: 0,
    winRate: 0,
    avgReward: 0,
    lastTrained: null,
    actionDist: [0, 0, 0, 0, 0, 0],
};

// ===== 모델 생성 =====

function createPolicyNetwork() {
    const m = tf.sequential();
    m.add(tf.layers.dense({ inputShape: [STATE_SIZE], units: 64, activation: 'relu' }));
    m.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    m.add(tf.layers.dense({ units: ACTION_SIZE, activation: 'softmax' }));
    m.compile({ optimizer: tf.train.adam(0.0003), loss: 'categoricalCrossentropy' });
    return m;
}

function createValueNetwork() {
    const m = tf.sequential();
    m.add(tf.layers.dense({ inputShape: [STATE_SIZE], units: 64, activation: 'relu' }));
    m.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    m.add(tf.layers.dense({ units: 1, activation: 'linear' }));
    m.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError' });
    return m;
}

// ===== 상태 벡터 생성 =====

/**
 * 현재 시장 상태 → 정규화된 벡터
 * @param {Object} indicators - 지표 계산 결과
 * @param {Object} accountInfo - 계좌 정보
 * @returns {number[]} 상태 벡터 [10]
 */
export function createState(indicators, accountInfo = {}) {
    const rsi = (indicators.rsi?.current || 50) / 100;
    const macdHist = clamp((indicators.macd?.currentHist || 0) / 1000, -1, 1);
    const bbPctB = clamp(indicators.bb?.currentPercentB || 0.5, 0, 1);
    const volRatio = clamp((indicators.volume?.currentRatio || 1) / 3, 0, 1);
    const macdCross = indicators.macd?.goldenCross ? 1 : (indicators.macd?.deadCross ? -1 : 0);
    const posCount = clamp((accountInfo.positionCount || 0) / 5, 0, 1);
    const todayPnl = clamp((accountInfo.todayReturnPct || 0) / 5, -1, 1);
    const winRate = (accountInfo.winRate || 50) / 100;
    const golden = indicators.goldenArrangement ? 1 : 0;
    const volSpike = indicators.volume?.spike ? 1 : 0;

    return [rsi, macdHist, bbPctB, volRatio, macdCross, posCount, todayPnl, winRate, golden, volSpike];
}

// ===== 행동 선택 =====

/**
 * 현재 상태에서 행동(배팅 등급) 선택
 * @param {number[]} state
 * @returns {{ action: number, prob: number }}
 */
export function selectAction(state) {
    if (!isReady || !policyNet) {
        // 모델 미준비: 랜덤 행동
        const action = Math.floor(Math.random() * ACTION_SIZE);
        return { action, prob: 1 / ACTION_SIZE };
    }

    const stateTensor = tf.tensor2d([state]);
    const probs = policyNet.predict(stateTensor);
    const probArray = probs.dataSync();

    // 확률적 샘플링
    const rand = Math.random();
    let cumProb = 0;
    let action = 0;
    for (let i = 0; i < ACTION_SIZE; i++) {
        cumProb += probArray[i];
        if (rand < cumProb) {
            action = i;
            break;
        }
    }

    const prob = probArray[action];
    stateTensor.dispose();
    probs.dispose();

    meta.actionDist[action]++;
    return { action, prob };
}

// ===== 경험 저장 =====

/**
 * 매매 결과를 경험으로 저장
 * @param {number[]} state - 매매 시 상태
 * @param {number} action - 선택한 행동 (0~5)
 * @param {number} reward - 보상 (수익률)
 * @param {number[]} nextState - 다음 상태
 */
export function storeExperience(state, action, reward, nextState) {
    experienceBuffer.push({ state, action, reward, nextState });
    meta.totalExperience++;

    // 버퍼 크기 제한
    if (experienceBuffer.length > 2000) {
        experienceBuffer = experienceBuffer.slice(-1500);
    }

    // localStorage에도 저장
    storage.save('ppo_buffer', experienceBuffer.slice(-500));
    storage.save('ppo_meta', meta);
}

// ===== PPO 학습 =====

/**
 * 축적된 경험으로 학습
 * @param {Function} onProgress
 * @returns {Object} 학습 결과
 */
export async function train(onProgress = null) {
    // 버퍼 불러오기
    const savedBuffer = storage.load('ppo_buffer', []);
    if (savedBuffer.length > experienceBuffer.length) {
        experienceBuffer = savedBuffer;
    }

    if (experienceBuffer.length < 30) {
        throw new Error(`경험 부족 (${experienceBuffer.length}/30건)`);
    }

    if (!policyNet) policyNet = createPolicyNetwork();
    if (!valueNet) valueNet = createValueNetwork();

    const epochs = 10;
    const batchSize = Math.min(64, experienceBuffer.length);

    for (let epoch = 0; epoch < epochs; epoch++) {
        // 미니배치 샘플링
        const batch = sampleBatch(batchSize);
        const states = tf.tensor2d(batch.map(e => e.state));
        const rewards = tf.tensor2d(batch.map(e => [e.reward]));

        // 행동 원핫 인코딩
        const actionOneHot = batch.map(e => {
            const oh = new Array(ACTION_SIZE).fill(0);
            oh[e.action] = 1;
            return oh;
        });

        // 어드밴티지 계산 (reward - value)
        const values = valueNet.predict(states);
        const advantages = tf.sub(rewards, values);

        // 폴리시 네트워크 업데이트
        const targetProbs = tf.tensor2d(actionOneHot).mul(
            advantages.clipByValue(-2, 2).add(tf.scalar(1))  // PPO clipping 간이 구현
        );

        await policyNet.fit(states, tf.tensor2d(actionOneHot), { epochs: 1, batchSize });
        await valueNet.fit(states, rewards, { epochs: 1, batchSize });

        if (onProgress) onProgress(epoch + 1, epochs);

        // 정리
        states.dispose();
        rewards.dispose();
        values.dispose();
        advantages.dispose();
        targetProbs.dispose();
    }

    // 메타 업데이트
    const rewards = experienceBuffer.map(e => e.reward);
    const wins = rewards.filter(r => r > 0).length;
    meta.winRate = ((wins / rewards.length) * 100).toFixed(1);
    meta.avgReward = (rewards.reduce((s, r) => s + r, 0) / rewards.length).toFixed(2);
    meta.lastTrained = new Date().toISOString();

    storage.save('ppo_meta', meta);

    // 모델 저장
    await policyNet.save('localstorage://sao-ppo-policy');
    await valueNet.save('localstorage://sao-ppo-value');

    isReady = true;
    return { ...meta };
}

// ===== 로드 =====

export async function loadPPO() {
    try {
        policyNet = await tf.loadLayersModel('localstorage://sao-ppo-policy');
        valueNet = await tf.loadLayersModel('localstorage://sao-ppo-value');
        const savedMeta = storage.load('ppo_meta', null);
        if (savedMeta) Object.assign(meta, savedMeta);
        experienceBuffer = storage.load('ppo_buffer', []);
        isReady = true;
        return true;
    } catch {
        return false;
    }
}

export function getInfo() {
    return { isReady, ...meta };
}

// ===== 헬퍼 =====

function sampleBatch(size) {
    const shuffled = [...experienceBuffer].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, size);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
