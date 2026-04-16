// ===== 메인 앱 컨트롤러 =====

import { loadConfig, saveConfig, resetConfig, FEES } from './config.js';
import * as storage from './storage.js';
import * as kiwoom from '../api/kiwoom.js';
import * as marketData from '../api/market-data.js';
import * as engine from '../trading/engine.js';
import * as aiModel from '../ai/model.js';
import * as trainer from '../ai/trainer.js';
import { getAiScore } from '../ai/predictor.js';
import { drawGauge, drawLineChart, drawEquityCurve } from '../ui/chart.js';
import * as dash from '../ui/dashboard.js';
import * as toast from '../ui/toast.js';
import { backtest } from '../trading/engine.js';

// ===== 초기화 =====

document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initTheme();
    loadSettingsUI();
    initEventListeners();
    dash.updateHistory();

    // AI 모델 로드 시도
    const loaded = await trainer.tryLoadModel();
    if (loaded) {
        const info = aiModel.getModelInfo();
        dash.updateAiStatus('active', `AI 준비 (${info.accuracy}%)`);
        updateModelStatusUI(info);
    }

    // 매매 엔진 콜백 설정
    engine.setCallbacks({
        onSignalCb: (signal) => {
            dash.addSignalLog(signal);
            storage.addSignal(signal);
        },
        onPositionUpdateCb: () => {
            refreshPositions();
        },
        onErrorCb: (msg) => {
            toast.error(msg);
            dash.addSignalLog({ type: 'info', text: `오류: ${msg}` });
        },
    });

    // 연결 상태 초기 표시
    const cfg = loadConfig();
    if (cfg.appKey) {
        dash.updateConnectionBar('disconnected', '키움 미연결 (설정탭에서 연결)');
    } else {
        dash.updateConnectionBar('virtual', '모의투자 모드');
    }

    // 초기 자산 표시
    dash.updateSummary(0, cfg.capital, 0);
    drawGauge(document.getElementById('scoreGauge'), 50);

    console.log('SAO Trade initialized');
});

// ===== 탭 관리 =====

function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });
}

// ===== 테마 =====

function initTheme() {
    const cfg = loadConfig();
    if (cfg.theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    }
    document.getElementById('themeToggle').addEventListener('click', () => {
        const cfg = loadConfig();
        cfg.theme = cfg.theme === 'dark' ? 'light' : 'dark';
        saveConfig(cfg);
        if (cfg.theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    });
}

// ===== 이벤트 리스너 =====

function initEventListeners() {
    // 검색
    document.getElementById('searchBtn').addEventListener('click', handleSearch);
    document.getElementById('searchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // 자동매매 시작/중지
    document.getElementById('startTrading').addEventListener('click', startAutoTrading);
    document.getElementById('stopTrading').addEventListener('click', stopAutoTrading);

    // 전략 저장
    document.getElementById('saveStrategy').addEventListener('click', saveStrategy);

    // API 설정
    document.getElementById('saveApiSettings').addEventListener('click', saveApiSettings);
    document.getElementById('testConnection').addEventListener('click', testApiConnection);
    document.getElementById('connectBtn').addEventListener('click', testApiConnection);

    // 백테스트
    document.getElementById('runBacktest').addEventListener('click', runBacktestUI);

    // AI 학습
    document.getElementById('trainModel').addEventListener('click', trainModelUI);

    // 수익현황
    document.getElementById('exportData').addEventListener('click', exportCSV);

    // 데이터 초기화
    const clearBtn = document.getElementById('clearAllData');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (confirm('모든 데이터를 초기화하시겠습니까?')) {
                storage.clearAll();
                toast.info('데이터 초기화 완료');
                location.reload();
            }
        });
    }

    // 포지션 매도 버튼 (이벤트 위임)
    document.getElementById('positionList').addEventListener('click', (e) => {
        if (e.target.classList.contains('pos-sell-btn')) {
            const symbol = e.target.dataset.symbol;
            if (confirm(`${symbol} 전량 매도하시겠습니까?`)) {
                manualSell(symbol);
            }
        }
    });
}

// ===== 검색 =====

function handleSearch() {
    const query = document.getElementById('searchInput').value.trim();
    const results = kiwoom.searchStocks(query);
    const container = document.getElementById('searchResults');

    if (results.length === 0) {
        container.classList.add('hidden');
        toast.info('검색 결과 없음');
        return;
    }

    container.innerHTML = results.map(s => `
        <div class="search-result-item" data-symbol="${s.symbol}" data-name="${s.name}">
            <span class="sr-name">${s.name}</span>
            <span class="sr-code">${s.symbol} | ${s.market.toUpperCase()}</span>
        </div>
    `).join('');

    container.classList.remove('hidden');

    container.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const symbol = item.dataset.symbol;
            const name = item.dataset.name;
            container.classList.add('hidden');
            document.getElementById('searchInput').value = `${name} (${symbol})`;
            toast.info(`${name} 선택됨 - 자동매매 시작 시 감시 목록에 추가됩니다`);
        });
    });
}

// ===== 자동매매 =====

function startAutoTrading() {
    const cfg = loadConfig();
    const searchVal = document.getElementById('searchInput').value;

    // 감시 종목: 검색된 종목 + 인기 종목 상위 5개
    let watchlist = kiwoom.POPULAR_STOCKS.slice(0, 5).map(s => s.symbol);

    // 검색에서 선택된 종목이 있으면 우선 추가
    const match = searchVal.match(/\((\d{6})\)/);
    if (match) {
        watchlist.unshift(match[1]);
        watchlist = [...new Set(watchlist)]; // 중복 제거
    }

    const aiScoreFn = aiModel.getModelInfo().isReady ? getAiScore : null;
    engine.start(watchlist, aiScoreFn);

    document.getElementById('startTrading').classList.add('hidden');
    document.getElementById('stopTrading').classList.remove('hidden');

    dash.updateConnectionBar(
        kiwoom.isConnected() ? 'connected' : 'virtual',
        kiwoom.isConnected() ? '키움 연결 - 자동매매중' : '모의투자 - 자동매매중'
    );
    dash.updateAiStatus(aiScoreFn ? 'active' : '', aiScoreFn ? 'AI 가동중' : 'AI 미사용');

    toast.success('자동매매 시작');
}

function stopAutoTrading() {
    engine.stop();

    document.getElementById('startTrading').classList.remove('hidden');
    document.getElementById('stopTrading').classList.add('hidden');

    // 오늘 수익 저장
    saveTodayRecord();

    toast.info('자동매매 중지');
}

function manualSell(symbol) {
    // 간이 수동 매도 (모의투자용)
    const positions = storage.getPositions();
    const pos = positions.find(p => p.symbol === symbol);
    if (!pos) return;

    const simulatedPrice = Math.round(pos.buyPrice * (1 + (Math.random() - 0.4) * 0.04));
    const { calcProfit } = loadConfig().constructor ? {} : { calcProfit: null };

    // 직접 import 사용
    import('./config.js').then(({ calcProfit }) => {
        const pnl = calcProfit(pos.buyPrice, simulatedPrice, pos.qty, pos.market || 'kospi');
        storage.removePosition(symbol);

        const cfg = loadConfig();
        cfg.capital += simulatedPrice * pos.qty - pnl.sellCost;
        saveConfig(cfg);

        storage.addTradeRecord({
            type: 'sell', symbol, name: pos.name,
            qty: pos.qty, buyPrice: pos.buyPrice,
            sellPrice: simulatedPrice, pnl: pnl.net, pnlPct: pnl.returnPct,
            reason: '수동매도', market: pos.market,
            buyCost: pnl.buyCost, sellCost: pnl.sellCost,
        });

        refreshPositions();
        toast.success(`${pos.name} 매도 완료: ${pnl.net >= 0 ? '+' : ''}${pnl.net.toLocaleString()}원`);
    });
}

function refreshPositions() {
    const positions = storage.getPositions();
    dash.updatePositions(positions);

    const cfg = loadConfig();
    const trades = storage.getTradeHistory();
    const todayTrades = trades.filter(t => t.timestamp?.startsWith(new Date().toISOString().slice(0, 10)));
    dash.updateSummary(0, cfg.capital, todayTrades.length);
}

// ===== 전략 설정 =====

function loadSettingsUI() {
    const cfg = loadConfig();
    const fields = {
        'cfg-takeProfit': cfg.takeProfit,
        'cfg-stopLoss': cfg.stopLoss,
        'cfg-positionSize': cfg.positionSize,
        'cfg-maxPositions': cfg.maxPositions,
        'cfg-dailyMaxLoss': cfg.dailyMaxLoss,
        'cfg-rsiPeriod': cfg.rsiPeriod,
        'cfg-rsiBuy': cfg.rsiBuy,
        'cfg-rsiSell': cfg.rsiSell,
        'cfg-macdFast': cfg.macdFast,
        'cfg-macdSlow': cfg.macdSlow,
        'cfg-macdSignal': cfg.macdSignal,
        'cfg-bbPeriod': cfg.bbPeriod,
        'cfg-aiBuyScore': cfg.aiBuyScore,
        'cfg-aiSellScore': cfg.aiSellScore,
        'cfg-appKey': cfg.appKey,
        'cfg-appSecret': cfg.appSecret,
        'cfg-account': cfg.account,
        'cfg-server': cfg.server,
        'cfg-proxyUrl': cfg.proxyUrl,
        'cfg-capital': cfg.capital,
    };

    for (const [id, val] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }

    const retrain = document.getElementById('cfg-aiRetrain');
    if (retrain) retrain.checked = cfg.aiRetrain;
}

function saveStrategy() {
    const cfg = loadConfig();
    cfg.takeProfit = parseFloat(document.getElementById('cfg-takeProfit').value) || 2;
    cfg.stopLoss = parseFloat(document.getElementById('cfg-stopLoss').value) || 1;
    cfg.positionSize = parseInt(document.getElementById('cfg-positionSize').value) || 10;
    cfg.maxPositions = parseInt(document.getElementById('cfg-maxPositions').value) || 5;
    cfg.dailyMaxLoss = parseFloat(document.getElementById('cfg-dailyMaxLoss').value) || 3;
    cfg.rsiPeriod = parseInt(document.getElementById('cfg-rsiPeriod').value) || 14;
    cfg.rsiBuy = parseInt(document.getElementById('cfg-rsiBuy').value) || 30;
    cfg.rsiSell = parseInt(document.getElementById('cfg-rsiSell').value) || 70;
    cfg.macdFast = parseInt(document.getElementById('cfg-macdFast').value) || 12;
    cfg.macdSlow = parseInt(document.getElementById('cfg-macdSlow').value) || 26;
    cfg.macdSignal = parseInt(document.getElementById('cfg-macdSignal').value) || 9;
    cfg.bbPeriod = parseInt(document.getElementById('cfg-bbPeriod').value) || 20;
    cfg.aiBuyScore = parseInt(document.getElementById('cfg-aiBuyScore').value) || 70;
    cfg.aiSellScore = parseInt(document.getElementById('cfg-aiSellScore').value) || 30;
    cfg.aiRetrain = document.getElementById('cfg-aiRetrain').checked;
    saveConfig(cfg);
    toast.success('전략 저장 완료');
}

function saveApiSettings() {
    const cfg = loadConfig();
    cfg.appKey = document.getElementById('cfg-appKey').value.trim();
    cfg.appSecret = document.getElementById('cfg-appSecret').value.trim();
    cfg.account = document.getElementById('cfg-account').value.trim();
    cfg.server = document.getElementById('cfg-server').value;
    cfg.proxyUrl = document.getElementById('cfg-proxyUrl').value.trim();
    cfg.capital = parseInt(document.getElementById('cfg-capital').value) || 10000000;
    saveConfig(cfg);
    toast.success('API 설정 저장 완료');
    dash.updateSummary(0, cfg.capital, 0);
}

async function testApiConnection() {
    const cfg = loadConfig();
    if (!cfg.appKey || !cfg.appSecret) {
        toast.error('App Key / Secret을 입력하세요 (설정 탭)');
        return;
    }

    showLoading('키움 API 연결중...');
    try {
        await kiwoom.getToken();
        dash.updateConnectionBar('connected', `키움 연결됨 (${cfg.server === 'virtual' ? '모의' : '실전'})`);
        toast.success('키움 API 연결 성공!');

        // 잔고 조회 테스트
        try {
            const balance = await kiwoom.getBalance();
            cfg.capital = balance.totalDeposit + balance.totalEval;
            saveConfig(cfg);
            dash.updateSummary(0, cfg.capital, 0);
        } catch (e) {
            console.warn('Balance fetch failed:', e);
        }
    } catch (e) {
        dash.updateConnectionBar('disconnected', '연결 실패');
        toast.error(`연결 실패: ${e.message}`);
    }
    hideLoading();
}

// ===== 백테스트 =====

async function runBacktestUI() {
    const symbol = document.getElementById('bt-symbol').value.trim() || '005930';
    const days = parseInt(document.getElementById('bt-period').value) || 90;

    showLoading('백테스트 실행중...');

    try {
        let dailyData;
        if (kiwoom.isConnected()) {
            dailyData = await marketData.fetchDailyData(symbol, days + 60);
        } else {
            dailyData = marketData.generateMockDaily(days + 60);
        }

        const result = backtest(dailyData);

        // 결과 표시
        document.getElementById('backtestResult').classList.remove('hidden');
        document.getElementById('bt-return').textContent = `${result.totalReturn}%`;
        document.getElementById('bt-return').className = `value big ${parseFloat(result.totalReturn) >= 0 ? 'up' : 'down'}`;
        document.getElementById('bt-winrate').textContent = `${result.winRate}%`;
        document.getElementById('bt-trades').textContent = result.totalTrades;
        document.getElementById('bt-drawdown').textContent = `-${result.maxDrawdown}%`;

        // 차트
        drawEquityCurve(document.getElementById('btChart'), result.equityCurve);

        // 매매 로그
        const logEl = document.getElementById('btLog');
        if (logEl) {
            logEl.innerHTML = result.trades.slice(-30).map(t => {
                if (t.type === 'buy') {
                    return `<div class="signal-item buy">
                        <span class="signal-time">${t.date}</span>
                        <span class="signal-text">매수 ${t.qty}주 @ ${t.price.toLocaleString()}</span>
                        <span class="signal-badge buy">매수</span>
                    </div>`;
                } else {
                    return `<div class="signal-item sell">
                        <span class="signal-time">${t.date}</span>
                        <span class="signal-text">${t.reason} ${t.qty}주 ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%</span>
                        <span class="signal-badge sell">매도</span>
                    </div>`;
                }
            }).join('');
        }

        toast.success(`백테스트 완료: ${result.totalReturn}% 수익률`);
    } catch (e) {
        toast.error(`백테스트 실패: ${e.message}`);
    }

    hideLoading();
}

// ===== AI 학습 =====

async function trainModelUI() {
    const symbol = document.getElementById('bt-symbol').value.trim() || '005930';

    showLoading('AI 학습 준비중...');
    dash.updateAiStatus('training', 'AI 학습중');

    try {
        const result = await trainer.trainOnSymbol(
            symbol,
            kiwoom.isConnected(),
            (epoch, total, loss, acc) => {
                document.getElementById('loadingText').textContent =
                    `AI 학습중... ${epoch}/${total} (정확도: ${(acc * 100).toFixed(1)}%)`;
            }
        );

        updateModelStatusUI(result);
        dash.updateAiStatus('active', `AI 준비 (${result.accuracy}%)`);
        toast.success(`AI 학습 완료! 정확도: ${result.accuracy}%`);
    } catch (e) {
        dash.updateAiStatus('', 'AI 학습실패');
        toast.error(`학습 실패: ${e.message}`);
    }

    hideLoading();
}

function updateModelStatusUI(info) {
    const status = document.getElementById('modelStatus');
    const count = document.getElementById('trainDataCount');
    const acc = document.getElementById('modelAccuracy');

    if (status) status.textContent = info.isReady !== false ? '학습완료' : '미학습';
    if (count) count.textContent = info.trainCount || 0;
    if (acc) acc.textContent = info.accuracy ? `${info.accuracy}%` : '-';
}

// ===== 수익 기록 =====

function saveTodayRecord() {
    const trades = storage.getTradeHistory();
    const today = new Date().toISOString().slice(0, 10);
    const todayTrades = trades.filter(t => t.timestamp?.startsWith(today) && t.type === 'sell');
    const totalPnl = todayTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const cfg = loadConfig();

    storage.saveDailyRecord({
        trades: todayTrades.length,
        pnl: totalPnl,
        returnPct: cfg.capital > 0 ? (totalPnl / cfg.capital * 100) : 0,
    });

    dash.updateHistory();
}

// ===== CSV 내보내기 =====

function exportCSV() {
    const trades = storage.getTradeHistory();
    if (trades.length === 0) {
        toast.info('내보낼 데이터 없음');
        return;
    }

    const header = '시간,구분,종목,수량,매수가,매도가,수수료(매수),수수료+세금(매도),순수익,수익률,사유\n';
    const rows = trades.map(t => {
        return [
            t.timestamp, t.type === 'buy' ? '매수' : '매도',
            `${t.name}(${t.symbol})`, t.qty,
            t.buyPrice || t.price || '', t.sellPrice || '',
            t.buyCost || '', t.sellCost || '',
            t.pnl || '', t.pnlPct ? t.pnlPct.toFixed(2) + '%' : '',
            t.reason || '',
        ].join(',');
    }).join('\n');

    const blob = new Blob(['\ufeff' + header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sao_trades_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('CSV 다운로드 완료');
}

// ===== 로딩 =====

function showLoading(text = '처리중...') {
    const el = document.getElementById('loadingOverlay');
    const textEl = document.getElementById('loadingText');
    if (el) el.classList.remove('hidden');
    if (textEl) textEl.textContent = text;
}

function hideLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.classList.add('hidden');
}
