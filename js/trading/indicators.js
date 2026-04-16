// ===== 기술적 지표 계산 =====

/**
 * SMA (단순이동평균)
 * @param {number[]} data - 종가 배열
 * @param {number} period
 * @returns {number[]}
 */
export function sma(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            result.push(null);
            continue;
        }
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += data[j];
        result.push(sum / period);
    }
    return result;
}

/**
 * EMA (지수이동평균)
 */
export function ema(data, period) {
    const result = [];
    const k = 2 / (period + 1);
    let prev = null;

    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            result.push(null);
            continue;
        }
        if (prev === null) {
            // 첫 EMA는 SMA로 계산
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += data[j];
            prev = sum / period;
        } else {
            prev = data[i] * k + prev * (1 - k);
        }
        result.push(prev);
    }
    return result;
}

/**
 * RSI (상대강도지수)
 * @param {number[]} closes - 종가 배열
 * @param {number} period - 기간 (기본 14)
 * @returns {number[]} RSI 값 (0~100)
 */
export function rsi(closes, period = 14) {
    const result = [];
    if (closes.length < period + 1) return result;

    const gains = [];
    const losses = [];

    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }

    // 첫 평균
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    // period까지는 null
    for (let i = 0; i < period; i++) result.push(null);

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));

    // 이후 Wilder's smoothing
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push(100 - 100 / (1 + rs));
    }
    return result;
}

/**
 * MACD
 * @param {number[]} closes
 * @param {number} fast - 빠른선 기간 (12)
 * @param {number} slow - 느린선 기간 (26)
 * @param {number} signal - 시그널 기간 (9)
 * @returns {{ macd: number[], signal: number[], histogram: number[] }}
 */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);

    const macdLine = [];
    for (let i = 0; i < closes.length; i++) {
        if (emaFast[i] === null || emaSlow[i] === null) {
            macdLine.push(null);
        } else {
            macdLine.push(emaFast[i] - emaSlow[i]);
        }
    }

    // MACD 시그널선 (MACD의 EMA)
    const validMacd = macdLine.filter(v => v !== null);
    const signalLine = [];
    const signalEma = ema(validMacd, signal);

    let si = 0;
    for (let i = 0; i < macdLine.length; i++) {
        if (macdLine[i] === null) {
            signalLine.push(null);
        } else {
            signalLine.push(signalEma[si] !== undefined ? signalEma[si] : null);
            si++;
        }
    }

    // 히스토그램
    const histogram = [];
    for (let i = 0; i < macdLine.length; i++) {
        if (macdLine[i] === null || signalLine[i] === null) {
            histogram.push(null);
        } else {
            histogram.push(macdLine[i] - signalLine[i]);
        }
    }

    return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * 볼린저 밴드
 * @param {number[]} closes
 * @param {number} period - 기간 (20)
 * @param {number} stdDev - 표준편차 배수 (2)
 * @returns {{ upper: number[], middle: number[], lower: number[], percentB: number[] }}
 */
export function bollingerBands(closes, period = 20, stdDev = 2) {
    const middle = sma(closes, period);
    const upper = [];
    const lower = [];
    const percentB = [];

    for (let i = 0; i < closes.length; i++) {
        if (middle[i] === null) {
            upper.push(null);
            lower.push(null);
            percentB.push(null);
            continue;
        }
        // 표준편차 계산
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sum += (closes[j] - middle[i]) ** 2;
        }
        const sd = Math.sqrt(sum / period);
        const u = middle[i] + stdDev * sd;
        const l = middle[i] - stdDev * sd;
        upper.push(u);
        lower.push(l);
        // %B: 현재가가 밴드 내 어디에 있는지 (0=하단, 1=상단)
        percentB.push(u !== l ? (closes[i] - l) / (u - l) : 0.5);
    }

    return { upper, middle, lower, percentB };
}

/**
 * 거래량 비율 (현재 거래량 / N일 평균 거래량)
 */
export function volumeRatio(volumes, period = 20) {
    const avg = sma(volumes, period);
    return volumes.map((v, i) => {
        if (avg[i] === null || avg[i] === 0) return null;
        return v / avg[i];
    });
}

/**
 * 이동평균선 정배열 여부
 * 5일선 > 20일선 > 60일선 이면 true
 */
export function isGoldenArrangement(closes) {
    if (closes.length < 60) return false;
    const sma5 = sma(closes, 5);
    const sma20 = sma(closes, 20);
    const sma60 = sma(closes, 60);
    const last = closes.length - 1;
    return sma5[last] > sma20[last] && sma20[last] > sma60[last];
}

/**
 * 모든 지표를 한번에 계산
 * @param {number[]} closes
 * @param {number[]} volumes
 * @param {Object} cfg - 지표 설정값
 */
export function calcAllIndicators(closes, volumes, cfg = {}) {
    const {
        rsiPeriod = 14,
        macdFast = 12,
        macdSlow = 26,
        macdSignal = 9,
        bbPeriod = 20,
    } = cfg;

    const rsiValues = rsi(closes, rsiPeriod);
    const macdResult = macd(closes, macdFast, macdSlow, macdSignal);
    const bbResult = bollingerBands(closes, bbPeriod);
    const volRatio = volumeRatio(volumes);

    const last = closes.length - 1;
    const prev = last - 1;

    return {
        rsi: {
            values: rsiValues,
            current: rsiValues[last],
            prev: rsiValues[prev],
        },
        macd: {
            ...macdResult,
            currentMacd: macdResult.macd[last],
            currentSignal: macdResult.signal[last],
            currentHist: macdResult.histogram[last],
            prevHist: macdResult.histogram[prev],
            // 골든크로스: 히스토그램이 음→양 전환
            goldenCross: macdResult.histogram[prev] < 0 && macdResult.histogram[last] >= 0,
            // 데드크로스: 히스토그램이 양→음 전환
            deadCross: macdResult.histogram[prev] > 0 && macdResult.histogram[last] <= 0,
        },
        bb: {
            ...bbResult,
            currentPercentB: bbResult.percentB[last],
            // 하단 이탈 (과매도)
            belowLower: closes[last] < bbResult.lower[last],
            // 상단 이탈 (과매수)
            aboveUpper: closes[last] > bbResult.upper[last],
        },
        volume: {
            ratio: volRatio,
            currentRatio: volRatio[last],
            spike: volRatio[last] > 1.5, // 거래량 급증
        },
        goldenArrangement: isGoldenArrangement(closes),
    };
}
