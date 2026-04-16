// ===== TensorFlow.js AI 모델 =====
// LSTM 신경망으로 주가 방향 예측

/* global tf */

let model = null;
let isModelReady = false;
let modelMeta = { accuracy: 0, trainCount: 0, lastTrained: null };

const SEQUENCE_LENGTH = 20;  // 20일치 데이터 입력
const FEATURE_COUNT = 8;     // 입력 특성 수

/**
 * 모델 생성 (LSTM)
 */
function createModel() {
    const m = tf.sequential();

    // LSTM 레이어
    m.add(tf.layers.lstm({
        units: 64,
        inputShape: [SEQUENCE_LENGTH, FEATURE_COUNT],
        returnSequences: true,
    }));
    m.add(tf.layers.dropout({ rate: 0.2 }));

    m.add(tf.layers.lstm({
        units: 32,
        returnSequences: false,
    }));
    m.add(tf.layers.dropout({ rate: 0.2 }));

    // Dense 레이어
    m.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    m.add(tf.layers.dense({ units: 1, activation: 'sigmoid' })); // 0=하락, 1=상승

    m.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'binaryCrossentropy',
        metrics: ['accuracy'],
    });

    return m;
}

/**
 * 데이터 전처리: 종가/거래량 → 정규화된 특성 벡터
 * 특성: [종가변화율, 5일MA비율, 20일MA비율, RSI정규화,
 *        MACD정규화, 볼린저%B, 거래량비율, 캔들크기]
 */
function prepareFeatures(closes, volumes) {
    const features = [];

    for (let i = 1; i < closes.length; i++) {
        // 종가 변화율
        const priceChange = (closes[i] - closes[i-1]) / closes[i-1];

        // 5일 이동평균 대비
        let ma5Ratio = 0;
        if (i >= 5) {
            const ma5 = closes.slice(i-5, i).reduce((a,b) => a+b, 0) / 5;
            ma5Ratio = (closes[i] - ma5) / ma5;
        }

        // 20일 이동평균 대비
        let ma20Ratio = 0;
        if (i >= 20) {
            const ma20 = closes.slice(i-20, i).reduce((a,b) => a+b, 0) / 20;
            ma20Ratio = (closes[i] - ma20) / ma20;
        }

        // 간이 RSI (14일)
        let rsiVal = 0.5;
        if (i >= 15) {
            let gains = 0, losses = 0;
            for (let j = i-14; j < i; j++) {
                const diff = closes[j+1] - closes[j];
                if (diff > 0) gains += diff;
                else losses -= diff;
            }
            const rs = losses === 0 ? 100 : gains / losses;
            rsiVal = (100 - 100 / (1 + rs)) / 100; // 0~1 정규화
        }

        // 간이 MACD 정규화
        let macdNorm = 0;
        if (i >= 26) {
            const ema12 = closes.slice(i-12, i).reduce((a,b) => a+b, 0) / 12;
            const ema26 = closes.slice(i-26, i).reduce((a,b) => a+b, 0) / 26;
            macdNorm = (ema12 - ema26) / closes[i] * 100;
        }

        // 볼린저 %B
        let percentB = 0.5;
        if (i >= 20) {
            const ma = closes.slice(i-20, i).reduce((a,b) => a+b, 0) / 20;
            let sum = 0;
            for (let j = i-20; j < i; j++) sum += (closes[j] - ma) ** 2;
            const sd = Math.sqrt(sum / 20);
            const upper = ma + 2 * sd;
            const lower = ma - 2 * sd;
            percentB = upper !== lower ? (closes[i] - lower) / (upper - lower) : 0.5;
        }

        // 거래량 비율
        let volRatio = 1;
        if (i >= 20 && volumes[i]) {
            const avgVol = volumes.slice(i-20, i).reduce((a,b) => a+b, 0) / 20;
            volRatio = avgVol > 0 ? Math.min(volumes[i] / avgVol, 5) / 5 : 0.5;
        }

        // 캔들 크기 (변동성)
        const candleSize = Math.abs(priceChange);

        features.push([
            clamp(priceChange * 10, -1, 1),
            clamp(ma5Ratio * 10, -1, 1),
            clamp(ma20Ratio * 10, -1, 1),
            rsiVal,
            clamp(macdNorm, -1, 1),
            clamp(percentB, 0, 1),
            volRatio,
            clamp(candleSize * 20, 0, 1),
        ]);
    }
    return features;
}

/**
 * 학습 데이터 생성
 * @returns {{ xs: number[][][], ys: number[] }}
 */
function createTrainingData(closes, volumes) {
    const features = prepareFeatures(closes, volumes);
    const xs = [];
    const ys = [];

    for (let i = SEQUENCE_LENGTH; i < features.length - 1; i++) {
        // 입력: 최근 20일 특성
        xs.push(features.slice(i - SEQUENCE_LENGTH, i));
        // 출력: 다음날 상승(1) or 하락(0)
        const nextReturn = (closes[i + 2] - closes[i + 1]) / closes[i + 1];
        ys.push(nextReturn > 0 ? 1 : 0);
    }

    return { xs, ys };
}

/**
 * 모델 학습
 * @param {number[]} closes
 * @param {number[]} volumes
 * @param {Function} onProgress - 진행 콜백 (epoch, loss, accuracy)
 */
export async function train(closes, volumes, onProgress = null) {
    if (closes.length < 80) {
        throw new Error('학습 데이터 부족 (최소 80일 필요)');
    }

    const { xs, ys } = createTrainingData(closes, volumes);
    if (xs.length < 20) {
        throw new Error('유효한 학습 샘플 부족');
    }

    // 모델 생성
    if (model) model.dispose();
    model = createModel();

    // 텐서 변환
    const xTensor = tf.tensor3d(xs);
    const yTensor = tf.tensor2d(ys, [ys.length, 1]);

    // 학습
    const result = await model.fit(xTensor, yTensor, {
        epochs: 50,
        batchSize: 32,
        validationSplit: 0.2,
        shuffle: true,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                if (onProgress) {
                    onProgress(epoch + 1, 50, logs.loss, logs.acc || logs.accuracy);
                }
            }
        }
    });

    // 정리
    xTensor.dispose();
    yTensor.dispose();

    const lastEpoch = result.history;
    const acc = lastEpoch.val_acc?.[lastEpoch.val_acc.length-1]
             || lastEpoch.val_accuracy?.[lastEpoch.val_accuracy.length-1] || 0;

    modelMeta = {
        accuracy: (acc * 100).toFixed(1),
        trainCount: xs.length,
        lastTrained: new Date().toISOString(),
    };

    isModelReady = true;
    return modelMeta;
}

/**
 * 예측: 현재 데이터로 매수 점수 반환 (0~100)
 * @param {number[]} closes
 * @param {number[]} volumes
 * @returns {number} 점수 (0=매도, 100=매수)
 */
export function predict(closes, volumes) {
    if (!isModelReady || !model) return null;

    const features = prepareFeatures(closes, volumes);
    if (features.length < SEQUENCE_LENGTH) return null;

    const input = features.slice(-SEQUENCE_LENGTH);
    const tensor = tf.tensor3d([input]);
    const prediction = model.predict(tensor);
    const score = prediction.dataSync()[0];

    tensor.dispose();
    prediction.dispose();

    return Math.round(score * 100);
}

/**
 * 모델 상태
 */
export function getModelInfo() {
    return {
        isReady: isModelReady,
        ...modelMeta,
    };
}

/**
 * 모델 저장 (localStorage)
 */
export async function saveModel() {
    if (!model) return;
    await model.save('localstorage://sao-ai-model');
    localStorage.setItem('sao_ai_meta', JSON.stringify(modelMeta));
}

/**
 * 모델 로드
 */
export async function loadModel() {
    try {
        model = await tf.loadLayersModel('localstorage://sao-ai-model');
        const meta = localStorage.getItem('sao_ai_meta');
        if (meta) modelMeta = JSON.parse(meta);
        isModelReady = true;
        return true;
    } catch {
        return false;
    }
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}
