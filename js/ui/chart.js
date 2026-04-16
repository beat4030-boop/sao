// ===== Canvas 차트 렌더링 =====

/**
 * 라인 차트 그리기
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} data - 값 배열
 * @param {Object} opts
 */
export function drawLineChart(canvas, data, opts = {}) {
    if (!canvas || !data.length) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 10, right: 10, bottom: 20, left: 50 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const {
        color = '#6c5ce7',
        fillColor = 'rgba(108,92,231,0.1)',
        lineWidth = 2,
        labels = [],
        showGrid = true,
        title = '',
    } = opts;

    // 데이터 범위
    const min = Math.min(...data) * 0.998;
    const max = Math.max(...data) * 1.002;
    const range = max - min || 1;

    // 배경 클리어
    ctx.clearRect(0, 0, w, h);

    // 그리드
    if (showGrid) {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + (chartH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();

            // Y축 라벨
            const val = max - (range / 4) * i;
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(formatNum(val), pad.left - 6, y + 3);
        }
    }

    // 데이터 좌표
    const points = data.map((v, i) => ({
        x: pad.left + (i / (data.length - 1)) * chartW,
        y: pad.top + ((max - v) / range) * chartH,
    }));

    // Fill
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length-1].x, pad.top + chartH);
    ctx.lineTo(points[0].x, pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // 마지막 값 표시
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // 타이틀
    if (title) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(title, pad.left, pad.top - 2);
    }
}

/**
 * AI 점수 게이지 그리기
 * @param {HTMLCanvasElement} canvas
 * @param {number} score - 0~100
 */
export function drawGauge(canvas, score) {
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = 200 * dpr;
    canvas.height = 120 * dpr;
    ctx.scale(dpr, dpr);

    const cx = 100, cy = 100, r = 80;
    const startAngle = Math.PI;
    const endAngle = 2 * Math.PI;
    const scoreAngle = startAngle + (score / 100) * Math.PI;

    ctx.clearRect(0, 0, 200, 120);

    // 배경 아크
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 점수 아크
    const gradient = ctx.createLinearGradient(20, 0, 180, 0);
    gradient.addColorStop(0, '#ff5252');
    gradient.addColorStop(0.5, '#ffd740');
    gradient.addColorStop(1, '#00e676');

    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, scoreAngle);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 점수 텍스트
    ctx.fillStyle = '#e8e8f0';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(score.toString(), cx, cy - 15);

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px sans-serif';
    ctx.fillText('/ 100', cx, cy + 2);
}

/**
 * 백테스트 수익 차트
 */
export function drawEquityCurve(canvas, equityCurve) {
    if (!equityCurve.length) return;
    const data = equityCurve.map(e => e.equity);
    const startVal = data[0];
    const endVal = data[data.length - 1];
    const isProfit = endVal >= startVal;

    drawLineChart(canvas, data, {
        color: isProfit ? '#00e676' : '#ff5252',
        fillColor: isProfit ? 'rgba(0,230,118,0.1)' : 'rgba(255,82,82,0.1)',
        title: '자산 추이',
    });
}

function formatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
    return n.toFixed(0);
}
