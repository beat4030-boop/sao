// ===== SAO Trade - 메인 앱 =====
import { loadConfig, saveConfig } from './config.js';
import * as storage from './storage.js';
import * as sim from '../trading/simulator.js';
import * as marketData from '../api/market-data.js';
import { generateSignal, getBettingTier, TIERS } from '../trading/strategy.js';
import { calcAllIndicators } from '../trading/indicators.js';
import * as toast from '../ui/toast.js';
import { POPULAR_STOCKS } from '../api/kis.js';

let isTrading = false;
let tradeInterval = null;

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initSubTabs();
    initClock();
    initSakura();
    loadSettingsUI();
    refreshAll();
    initEvents();
});

// ===== 하단 네비게이션 =====
function initNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tab = document.getElementById('tab-' + btn.dataset.tab);
            if (tab) tab.classList.add('active');
        });
    });
}

function initSubTabs() {
    document.querySelectorAll('.sub-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const parent = btn.closest('.tab-content') || btn.closest('.card');
            parent.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
            parent.querySelectorAll('.sub-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const sub = parent.querySelector('#sub-' + btn.dataset.sub);
            if (sub) sub.classList.add('active');
        });
    });
}

// ===== 시계 =====
function initClock() {
    const update = () => {
        const now = new Date();
        const el = document.getElementById('clockDisplay');
        if (el) el.textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const h = now.getHours(), m = now.getMinutes();
        const isOpen = h >= 9 && (h < 15 || (h === 15 && m <= 30));
        const badge = document.getElementById('marketState');
        if (badge) {
            badge.textContent = isOpen ? '정상' : '장마감';
            badge.className = 'market-badge' + (isOpen ? '' : ' closed');
        }
    };
    update();
    setInterval(update, 10000);
}

// ===== 벚꽃 =====
function initSakura() {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = 'js/ui/sakura.js';
    document.body.appendChild(s);
}

// ===== 이벤트 =====
function initEvents() {
    document.getElementById('startBtn').addEventListener('click', startTrading);
    document.getElementById('stopBtn').addEventListener('click', stopTrading);
    document.getElementById('saveSettings').addEventListener('click', saveSettingsUI);
    document.getElementById('resetAccount').addEventListener('click', () => {
        if (confirm('계좌를 초기화하시겠습니까?')) { sim.resetAccount(); refreshAll(); toast.info('초기화 완료'); }
    });
    document.getElementById('exportCSV').addEventListener('click', exportCSV);
    document.getElementById('runBacktest').addEventListener('click', runBacktest);
    document.getElementById('runOptimal').addEventListener('click', runOptimalAnalysis);
    document.getElementById('trainPPO').addEventListener('click', trainPPOUI);
    document.getElementById('trainLSTM').addEventListener('click', trainLSTMUI);
    document.getElementById('positionCards').addEventListener('click', (e) => {
        if (e.target.classList.contains('pos-sell-btn')) {
            const sym = e.target.dataset.symbol;
            if (sym) manualSell(sym);
        }
    });
}

// ===== 전체 UI 갱신 =====
function refreshAll() {
    const summary = sim.getAccountSummary();
    // Summary bar
    setVal('realizedPnl', formatMoney(summary.realizedPnl), summary.realizedPnl);
    setVal('unrealizedPnl', formatMoney(summary.unrealizedPnl), summary.unrealizedPnl);
    setVal('winRate', summary.winRate + '%');
    setVal('posCount', summary.positions.length + '개');
    // Positions
    renderPositions(summary.positions);
    // Trades
    renderTradeHistory();
    // Daily
    renderDailyHistory();
    // AI info
    renderAIInfo();
}

function setVal(id, text, pnl) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (pnl !== undefined) {
        el.classList.remove('up', 'down');
        el.classList.add(pnl >= 0 ? 'up' : 'down');
    }
}

// ===== 포지션 카드 렌더링 (프로그레스바 포함) =====
function renderPositions(positions) {
    const container = document.getElementById('positionCards');
    if (!positions.length) {
        container.innerHTML = '<div class="empty-pos">보유 포지션 없음</div>';
        return;
    }
    const cfg = loadConfig();
    container.innerHTML = positions.map(pos => {
        const slPrice = Math.floor(pos.buyPrice * (1 - cfg.stopLoss / 100));
        const tpPrice = Math.ceil(pos.buyPrice * (1 + cfg.takeProfit / 100));
        const trailPrice = pos.highPrice ? Math.floor(pos.highPrice * (1 - cfg.trailingStop / 100)) : tpPrice;
        const curPrice = pos.currentPrice || pos.buyPrice;
        const pnl = pos.pnl || 0;
        const pnlPct = pos.pnlPct || 0;
        const isUp = pnl >= 0;
        const tier = pos.tier || '노멀';
        // 바 비율 계산
        const range = tpPrice - slPrice;
        const curPct = range > 0 ? Math.max(0, Math.min(100, ((curPrice - slPrice) / range) * 100)) : 50;
        const status = pnlPct > 1 ? '추격 매수!' : pnlPct > 0 ? '홀딩 중...' : '대기 중...';

        return `<div class="pos-card">
            <div class="pos-card-header">
                <div><span class="pos-card-name">${pos.name}</span><span class="pos-card-code">${pos.symbol}</span></div>
                <span class="tier-badge tier-${tier}">${tier}</span>
            </div>
            <div class="pos-card-status">${status}</div>
            <div style="text-align:right"><button class="pos-sell-btn" data-symbol="${pos.symbol}">매도</button></div>
            <div class="pos-bar-container">
                <div class="pos-bar">
                    <div class="pos-bar-sl" style="width:30%">${slPrice.toLocaleString()}</div>
                    <div class="pos-bar-mid"></div>
                    <div class="pos-bar-tp" style="width:15%">1차</div>
                    <div class="pos-bar-trail" style="width:15%">${tpPrice.toLocaleString()}</div>
                    <div class="pos-bar-current" style="left:${curPct}%"></div>
                </div>
                <div class="pos-bar-labels">
                    <span class="sl-label">손절 ${slPrice.toLocaleString()} (-${cfg.stopLoss}%)</span>
                    <span class="tp-label">익절 ${tpPrice.toLocaleString()} (${cfg.takeProfit}%)</span>
                    <span class="trail-label">트레일 ${trailPrice.toLocaleString()}</span>
                </div>
            </div>
            <div class="pos-info-row">
                <span class="pos-info-left">매수 ${pos.buyPrice.toLocaleString()} / 현재 ${curPrice.toLocaleString()} / ${pos.qty}주</span>
                <span class="pos-info-right ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${pnlPct.toFixed(2)}% ${isUp ? '+' : ''}${pnl.toLocaleString()}원</span>
            </div>
        </div>`;
    }).join('');
}

// ===== 거래 내역 =====
function renderTradeHistory() {
    const trades = storage.getTradeHistory().filter(t => t.type === 'sell').slice(-30).reverse();
    const list = document.getElementById('sellHistoryList');
    const aiLog = document.getElementById('aiTradeLog');
    if (!trades.length) {
        if (list) list.innerHTML = '<div class="empty-pos">매도 기록 없음</div>';
        if (aiLog) aiLog.innerHTML = '<div class="empty-pos">거래 기록 없음</div>';
        return;
    }
    const html = trades.map(t => {
        const isUp = (t.pnl || 0) >= 0;
        const tier = t.tier || '레어';
        const time = t.timestamp ? new Date(t.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
        return `<div class="trade-item">
            <span class="trade-badge sell">SEL</span>
            <div class="trade-item-info">
                <div class="trade-item-name">${t.name || t.symbol} <span class="tier-badge tier-${tier}">${tier}</span></div>
                <div class="trade-item-detail">${time} · ${(t.sellPrice||0).toLocaleString()}원 × ${t.qty}주 · ${t.reason||''}</div>
            </div>
            <div class="trade-item-pnl ${isUp ? 'up' : 'down'}">${isUp?'+':''}${(t.pnl||0).toLocaleString()}원<br><span class="trade-item-pct">${isUp?'+':''}${(t.pnlPct||0).toFixed(2)}%</span></div>
        </div>`;
    }).join('');
    if (list) list.innerHTML = html;
    if (aiLog) aiLog.innerHTML = html;

    // AI거래 요약
    const today = new Date().toISOString().slice(0, 10);
    const todayTrades = trades.filter(t => t.timestamp && t.timestamp.startsWith(today));
    const wins = todayTrades.filter(t => (t.pnl || 0) > 0).length;
    const losses = todayTrades.length - wins;
    const totalPnl = todayTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    setVal('atTrades', todayTrades.length + '건');
    setVal('atWinLoss', `${wins}승${losses}패`);
    setVal('atPnl', formatMoney(totalPnl), totalPnl);
    setVal('atTotal', storage.getTradeHistory().filter(t => t.type === 'sell').length + '건');
}

// ===== 일별 기록 =====
function renderDailyHistory() {
    const records = storage.getDailyRecords().slice(-14).reverse();
    const list = document.getElementById('dailyList');
    if (!records.length) { if (list) list.innerHTML = '<div class="empty-pos">기록 없음</div>'; return; }
    list.innerHTML = records.map(r => {
        const isUp = (r.pnl || 0) >= 0;
        return `<div class="daily-item">
            <div><div class="daily-date">${r.date}</div><div class="daily-record">${r.wins||0}W ${r.losses||0}L · ${r.winRate||0}%</div></div>
            <div style="text-align:right"><div class="daily-pnl ${isUp?'up':'down'}">${formatMoney(r.pnl||0)}</div><div class="daily-count">${r.trades||0}건</div></div>
        </div>`;
    }).join('');
}

// ===== 자동매매 =====
function startTrading() {
    isTrading = true;
    document.getElementById('startBtn').classList.add('hidden');
    document.getElementById('stopBtn').classList.remove('hidden');
    toast.success('자동매매 시작');

    runTradingCycle();
    tradeInterval = setInterval(runTradingCycle, 15000);
}

function stopTrading() {
    isTrading = false;
    if (tradeInterval) { clearInterval(tradeInterval); tradeInterval = null; }
    document.getElementById('startBtn').classList.remove('hidden');
    document.getElementById('stopBtn').classList.add('hidden');
    sim.resetDailyStats();
    refreshAll();
    toast.info('자동매매 중지');
}

async function runTradingCycle() {
    if (!isTrading) return;
    try {
        const cfg = loadConfig();
        const acct = sim.getAccount();

        // 1) 보유 포지션 청산 체크
        const prices = {};
        for (const pos of acct.positions) {
            prices[pos.symbol] = simulatePrice(pos.buyPrice);
        }
        const exits = sim.checkPositions(prices, cfg);
        for (const exit of exits) {
            sim.sell(exit.symbol, exit.price, exit.reason);
        }

        // 2) 신규 매수
        if (acct.positions.length < cfg.maxPositions) {
            const candidates = POPULAR_STOCKS.filter(s => !acct.positions.find(p => p.symbol === s.symbol));
            const pick = candidates[Math.floor(Math.random() * Math.min(candidates.length, 5))];
            if (pick) {
                const daily = marketData.generateMockDaily(100);
                const closes = daily.map(d => d.close);
                const volumes = daily.map(d => d.volume);

                let signal;
                try { signal = generateSignal(closes, volumes); } catch(e) { signal = null; }

                const price = closes[closes.length - 1];
                // 시그널 성공하면 등급별, 실패하면 노멀(10%)로 매수
                const betPct = (signal && signal.tier && signal.tier.betPct > 0) ? signal.tier.betPct : 10;
                const tierName = (signal && signal.tier) ? signal.tier.name : '노멀';
                const score = (signal) ? signal.finalScore : 50;

                const investAmt = Math.floor(acct.cash * (betPct / 100));
                const qty = Math.floor(investAmt / price);
                if (qty > 0 && price > 0) {
                    const result = sim.buy(pick.symbol, pick.name, price, qty, pick.market, score, tierName);
                    if (result.success) {
                        toast.success(result.message);
                    }
                }
            }
        }
    } catch(e) {
        console.error('Trading cycle error:', e);
        toast.error('매매 오류: ' + e.message);
    }

    refreshAll();
}

function manualSell(symbol) {
    const acct = sim.getAccount();
    const pos = acct.positions.find(p => p.symbol === symbol);
    if (!pos) return;
    const price = simulatePrice(pos.buyPrice);
    const result = sim.sell(symbol, price, '수동매도');
    if (result.success) toast.success(result.message);
    refreshAll();
}

function simulatePrice(base) {
    return Math.round(base * (1 + (Math.random() - 0.45) * 0.04));
}

// ===== 설정 =====
function loadSettingsUI() {
    const cfg = loadConfig();
    const map = {
        'cfg-takeProfit': cfg.takeProfit, 'cfg-stopLoss': cfg.stopLoss,
        'cfg-trailingStop': cfg.trailingStop, 'cfg-positionSize': cfg.positionSize,
        'cfg-maxPositions': cfg.maxPositions, 'cfg-dailyMaxLoss': cfg.dailyMaxLoss,
        'cfg-rsiPeriod': cfg.rsiPeriod, 'cfg-rsiBuy': cfg.rsiBuy, 'cfg-rsiSell': cfg.rsiSell,
        'cfg-bbPeriod': cfg.bbPeriod, 'cfg-capital': cfg.capital,
        'cfg-macd': `${cfg.macdFast},${cfg.macdSlow},${cfg.macdSignal}`,
    };
    for (const [id, val] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }
}

function saveSettingsUI() {
    const cfg = loadConfig();
    cfg.takeProfit = parseFloat(document.getElementById('cfg-takeProfit').value) || 2;
    cfg.stopLoss = parseFloat(document.getElementById('cfg-stopLoss').value) || 1;
    cfg.trailingStop = parseFloat(document.getElementById('cfg-trailingStop').value) || 1.5;
    cfg.positionSize = parseInt(document.getElementById('cfg-positionSize').value) || 10;
    cfg.maxPositions = parseInt(document.getElementById('cfg-maxPositions').value) || 5;
    cfg.dailyMaxLoss = parseFloat(document.getElementById('cfg-dailyMaxLoss').value) || 3;
    cfg.rsiPeriod = parseInt(document.getElementById('cfg-rsiPeriod').value) || 14;
    cfg.rsiBuy = parseInt(document.getElementById('cfg-rsiBuy').value) || 30;
    cfg.rsiSell = parseInt(document.getElementById('cfg-rsiSell').value) || 70;
    cfg.bbPeriod = parseInt(document.getElementById('cfg-bbPeriod').value) || 20;
    cfg.capital = parseInt(document.getElementById('cfg-capital').value) || 10000000;
    const macd = (document.getElementById('cfg-macd').value || '12,26,9').split(',');
    cfg.macdFast = parseInt(macd[0]) || 12;
    cfg.macdSlow = parseInt(macd[1]) || 26;
    cfg.macdSignal = parseInt(macd[2]) || 9;
    saveConfig(cfg);
    toast.success('설정 저장 완료');
}

// ===== 백테스트 =====
async function runBacktest() {
    const { backtest } = await import('../trading/engine.js');
    const daily = marketData.generateMockDaily(parseInt(document.getElementById('bt-period').value) || 90);
    const result = backtest(daily);
    const el = document.getElementById('backtestResult');
    el.classList.remove('hidden');
    el.innerHTML = `<div class="card"><div class="ai-stats">
        <div class="ai-stat"><div class="ai-stat-label">수익률</div><div class="ai-stat-val ${parseFloat(result.totalReturn)>=0?'up':'down'}">${result.totalReturn}%</div></div>
        <div class="ai-stat"><div class="ai-stat-label">승률</div><div class="ai-stat-val">${result.winRate}%</div></div>
        <div class="ai-stat"><div class="ai-stat-label">매매수</div><div class="ai-stat-val">${result.totalTrades}</div></div>
        <div class="ai-stat"><div class="ai-stat-label">최대낙폭</div><div class="ai-stat-val down">-${result.maxDrawdown}%</div></div>
    </div></div>`;
    toast.info('백테스트 완료: ' + result.totalReturn + '%');
}

// ===== 최적 분석 =====
async function runOptimalAnalysis() {
    const { findOptimalParams } = await import('../trading/optimizer.js');
    const result = findOptimalParams(7);
    const el = document.getElementById('optimalResult');
    if (!result.hasData) { el.innerHTML = '<p class="empty-pos">매매 데이터 부족</p>'; return; }
    el.innerHTML = `<div class="optimal-result">
        <div class="opt-card"><div class="opt-val down">-${result.optimal.stopLoss}%</div><div class="opt-label">최적 손절가</div><div class="opt-current">(현재 -${loadConfig().stopLoss}%)</div></div>
        <div class="opt-card"><div class="opt-val down">-${result.optimal.trailing}%</div><div class="opt-label">최적 트레일</div><div class="opt-current">(현재 -${loadConfig().trailingStop}%)</div></div>
    </div>
    <div class="ai-stats">
        <div class="ai-stat"><div class="ai-stat-label">실제손익</div><div class="ai-stat-val ${result.actualPnl>=0?'up':'down'}">${formatMoney(result.actualPnl)}</div></div>
        <div class="ai-stat"><div class="ai-stat-label">최적손익</div><div class="ai-stat-val ${result.optimalPnl>=0?'up':'down'}">${formatMoney(result.optimalPnl)}</div></div>
        <div class="ai-stat"><div class="ai-stat-label">차이</div><div class="ai-stat-val up">+${formatMoney(result.diff)}</div></div>
    </div>`;
    toast.info('최적 분석 완료');
}

// ===== AI =====
function renderAIInfo() {
    // PPO & Pattern info from storage
    const ppoMeta = storage.load('ppo_meta', { totalExperience: 0, winRate: '0', avgReward: '0', actionDist: [0,0,0,0,0,0] });
    setVal('ppoExp', (ppoMeta.totalExperience || 0) + '건');
    setVal('ppoWin', (ppoMeta.winRate || '0') + '%');
    setVal('ppoReward', (ppoMeta.avgReward || '0') + '%');

    const patterns = storage.load('patterns', []);
    const patWins = patterns.filter(p => p.result > 0).length;
    setVal('patternCount', patterns.length + '건');
    setVal('patternWin', patterns.length > 0 ? ((patWins/patterns.length)*100).toFixed(1) + '%' : '0%');
    setVal('patternAvg', patterns.length > 0 ? (patterns.reduce((s,p)=>s+p.result,0)/patterns.length).toFixed(2) + '%' : '0%');
    setVal('patternNum', Math.min(patterns.length, 10) + '개');
}

async function trainPPOUI() {
    toast.info('PPO 학습은 매매 경험 30건 이상 필요합니다');
    try {
        const ppo = await import('../ai/ppo.js');
        await ppo.train((e, t) => {});
        toast.success('PPO 학습 완료');
        renderAIInfo();
    } catch (e) { toast.error(e.message); }
}

async function trainLSTMUI() {
    const { train } = await import('../ai/model.js');
    const daily = marketData.generateMockDaily(365);
    const closes = daily.map(d => d.close);
    const volumes = daily.map(d => d.volume);
    try {
        showLoading('LSTM 학습중...');
        const result = await train(closes, volumes, (ep, total) => {
            document.getElementById('loadingText').textContent = `학습중 ${ep}/${total}`;
        });
        setVal('lstmStatus', '학습완료');
        setVal('lstmData', result.trainCount);
        setVal('lstmAcc', result.accuracy + '%');
        hideLoading();
        toast.success('LSTM 학습 완료: ' + result.accuracy + '%');
    } catch (e) { hideLoading(); toast.error(e.message); }
}

// ===== CSV =====
function exportCSV() {
    const trades = storage.getTradeHistory();
    if (!trades.length) { toast.info('데이터 없음'); return; }
    const header = '시간,구분,종목,수량,매수가,매도가,손익,수익률,등급,사유\n';
    const rows = trades.map(t => [t.timestamp, t.type, t.name||t.symbol, t.qty, t.buyPrice||t.price||'', t.sellPrice||'', t.pnl||'', (t.pnlPct||'')+'%', t.tier||'', t.reason||''].join(',')).join('\n');
    const blob = new Blob(['\ufeff'+header+rows], {type:'text/csv'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `sao_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    toast.success('CSV 다운로드');
}

// ===== 유틸 =====
function formatMoney(n) {
    if (n === undefined || n === null) return '0원';
    const abs = Math.abs(Math.round(n));
    return (n >= 0 ? '+' : '-') + abs.toLocaleString() + '원';
}
function showLoading(t) { document.getElementById('loadingOverlay').classList.remove('hidden'); document.getElementById('loadingText').textContent = t; }
function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }
