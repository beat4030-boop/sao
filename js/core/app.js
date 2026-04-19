// ===== 배송파셀 메인 앱 =====

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    const role = getRole();
    if (role) login(role);
    loadProductDatalist();

    // 사진 업로드 이벤트
    document.getElementById('photoInput').addEventListener('change', handlePhotoUpload);
});

// ===== 로그인 =====
function login(role) {
    setRole(role);
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    if (role === 'worker') {
        document.getElementById('page-worker').classList.add('active');
        refreshWorkerOrders();
    } else {
        document.getElementById('page-boss').classList.add('active');
        refreshBossOrders();
    }
}

function logout() {
    clearRole();
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-login').classList.add('active');
}

// ===== 알바: 주문 입력 =====
function handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const preview = document.getElementById('photoPreview');
    preview.classList.remove('hidden');
    const reader = new FileReader();
    reader.onload = (ev) => {
        preview.innerHTML = `<img src="${ev.target.result}">`;
    };
    reader.readAsDataURL(file);
}

function submitOrder() {
    const name = document.getElementById('recipientName').value.trim();
    const phone = document.getElementById('recipientPhone').value.trim();
    const addr = document.getElementById('recipientAddr').value.trim();
    const addr2 = document.getElementById('recipientAddr2').value.trim();
    const zip = document.getElementById('recipientZip').value.trim();
    const product = document.getElementById('productName').value.trim();
    const qty = parseInt(document.getElementById('productQty').value) || 1;
    const memo = document.getElementById('orderMemo').value.trim();

    if (!name) { showToast('이름을 입력하세요', 'error'); return; }
    if (!phone) { showToast('전화번호를 입력하세요', 'error'); return; }
    if (!addr) { showToast('주소를 입력하세요', 'error'); return; }
    if (!product) { showToast('상품명을 입력하세요', 'error'); return; }

    const order = addOrder({
        recipientName: name,
        recipientPhone: phone,
        recipientAddr: addr,
        recipientAddr2: addr2,
        recipientZip: zip,
        productName: product,
        qty,
        memo,
        worker: '알바',
    });

    // 상품 자동 등록
    addProductItem(product);
    loadProductDatalist();

    // 폼 초기화
    document.getElementById('recipientName').value = '';
    document.getElementById('recipientPhone').value = '';
    document.getElementById('recipientAddr').value = '';
    document.getElementById('recipientAddr2').value = '';
    document.getElementById('recipientZip').value = '';
    document.getElementById('productName').value = '';
    document.getElementById('productQty').value = '1';
    document.getElementById('orderMemo').value = '';
    document.getElementById('photoPreview').classList.add('hidden');
    document.getElementById('photoInput').value = '';

    showToast('주문 전송 완료!', 'success');
    refreshWorkerOrders();
}

function refreshWorkerOrders() {
    const today = new Date().toISOString().slice(0, 10);
    const orders = getOrders().filter(o => o.timestamp && o.timestamp.startsWith(today));
    document.getElementById('workerOrderCount').textContent = orders.length;
    const list = document.getElementById('workerOrderList');
    if (!orders.length) { list.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px">오늘 전송한 주문 없음</div>'; return; }
    list.innerHTML = orders.map(o => `
        <div class="order-item">
            <div class="order-header">
                <span class="order-name">${o.recipientName}</span>
                <span class="order-product">${o.productName} x${o.qty}</span>
            </div>
            <div class="order-info">${o.recipientAddr} ${o.recipientAddr2||''}</div>
            <div class="order-time">${new Date(o.timestamp).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
    `).join('');
}

// ===== 사장: 주문 관리 =====
function refreshBossOrders() {
    const orders = getOrders();
    const today = new Date().toISOString().slice(0, 10);
    const todayOrders = orders.filter(o => o.timestamp && o.timestamp.startsWith(today));
    const pending = todayOrders.filter(o => o.status === 'pending').length;
    const done = todayOrders.filter(o => o.status === 'done').length;

    document.getElementById('bossTotal').textContent = todayOrders.length + '건';
    document.getElementById('bossPending').textContent = pending + '건';
    document.getElementById('bossDone').textContent = done + '건';

    const list = document.getElementById('bossOrderList');
    if (!todayOrders.length) { list.innerHTML = '<div style="text-align:center;color:#aaa;padding:30px">오늘 주문 없음</div>'; return; }

    list.innerHTML = todayOrders.map(o => {
        const statusClass = o.status === 'done' ? 'status-done' : o.status === 'packed' ? 'status-packed' : 'status-pending';
        const statusText = o.status === 'done' ? '발송완료' : o.status === 'packed' ? '포장완료' : '대기';
        return `
        <div class="order-item">
            <div class="order-header">
                <span class="order-name">${o.recipientName}</span>
                <span class="order-status ${statusClass}">${statusText}</span>
            </div>
            <div class="order-product">${o.productName} x${o.qty}</div>
            <div class="order-info">${o.recipientPhone}<br>${o.recipientAddr} ${o.recipientAddr2||''}</div>
            ${o.trackingNo ? `<div class="order-tracking">송장: ${o.trackingNo}</div>` : ''}
            ${o.memo ? `<div class="order-info" style="color:#888">메모: ${o.memo}</div>` : ''}
            <div class="order-actions">
                ${o.status === 'pending' ? `<button onclick="setStatus('${o.id}','packed')">📦 포장완료</button>` : ''}
                ${o.status === 'packed' ? `<button onclick="setStatus('${o.id}','done')">✅ 발송완료</button>` : ''}
                <button onclick="printLabel('${o.id}')">🖨 송장</button>
                <button onclick="deleteOrderUI('${o.id}')">🗑</button>
            </div>
        </div>`;
    }).join('');
}

function setStatus(id, status) {
    updateOrder(id, { status });
    refreshBossOrders();
    showToast(status === 'packed' ? '포장 완료!' : '발송 완료!', 'success');
}

function deleteOrderUI(id) {
    if (confirm('삭제하시겠습니까?')) {
        deleteOrder(id);
        refreshBossOrders();
    }
}

// ===== 로이스파셀 엑셀 다운로드 =====
function downloadExcel() {
    const orders = getOrders().filter(o => {
        const today = new Date().toISOString().slice(0, 10);
        return o.timestamp && o.timestamp.startsWith(today);
    });

    if (!orders.length) { showToast('오늘 주문이 없습니다', 'error'); return; }

    // 로이스파셀 대량접수 양식
    const data = orders.map(o => ({
        '받는분성명': o.recipientName,
        '받는분전화번호': o.recipientPhone,
        '받는분우편번호': o.recipientZip || '',
        '받는분주소': o.recipientAddr + ' ' + (o.recipientAddr2 || ''),
        '상품명': o.productName,
        '수량': o.qty,
        '배송메시지': o.memo || '',
        '주문번호': o.id,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '대량접수');
    XLSX.writeFile(wb, `로이스파셀_${new Date().toISOString().slice(0,10)}.xlsx`);

    showToast('엑셀 다운로드 완료!', 'success');
}

// ===== 송장번호 업로드 =====
function uploadTrackingNumbers(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);

        let matched = 0;
        for (const row of rows) {
            const orderId = row['주문번호'] || '';
            const tracking = row['송장번호'] || row['운송장번호'] || '';
            if (orderId && tracking) {
                updateOrder(orderId, { trackingNo: String(tracking) });
                matched++;
            }
        }

        refreshBossOrders();
        showToast(`송장번호 ${matched}건 매칭 완료!`, 'success');
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
}

// ===== 5인치 송장 출력 =====
function printLabel(orderId) {
    const order = getOrders().find(o => o.id === orderId);
    if (!order) return;
    printLabels([order]);
}

function printAllLabels() {
    const today = new Date().toISOString().slice(0, 10);
    const orders = getOrders().filter(o => o.timestamp && o.timestamp.startsWith(today) && o.status !== 'done');
    if (!orders.length) { showToast('출력할 주문 없음', 'error'); return; }
    printLabels(orders);
}

function printLabels(orders) {
    const area = document.getElementById('printArea');
    area.innerHTML = orders.map(o => `
        <div class="label-5inch">
            <div class="label-header">
                <span class="label-logo">📦 배송파셀</span>
                <span class="label-tracking">${o.trackingNo || '송장미발행'}</span>
            </div>
            <div class="label-section">
                <div class="label-section-title">받는 분</div>
                <div class="label-name">${o.recipientName}</div>
                <div class="label-phone">${o.recipientPhone}</div>
                <div class="label-addr">${o.recipientZip ? '['+o.recipientZip+'] ' : ''}${o.recipientAddr} ${o.recipientAddr2||''}</div>
            </div>
            <div class="label-product">${o.productName}</div>
            <div class="label-qty">수량: ${o.qty}개</div>
            ${o.memo ? `<div class="label-memo">메모: ${o.memo}</div>` : ''}
            <div class="label-barcode">${o.trackingNo || o.id}</div>
        </div>
    `).join('');

    area.style.display = 'block';
    setTimeout(() => { window.print(); area.style.display = 'none'; }, 300);
}

// ===== 상품 관리 =====
function loadProductDatalist() {
    const products = getProducts();
    const dl = document.getElementById('productList');
    if (dl) dl.innerHTML = products.map(p => `<option value="${p}">`).join('');
}

function showProductManager() {
    document.getElementById('productModal').classList.remove('hidden');
    renderProductList();
}

function closeProductModal() {
    document.getElementById('productModal').classList.add('hidden');
}

function addProduct() {
    const name = document.getElementById('newProductName').value.trim();
    if (!name) return;
    addProductItem(name);
    document.getElementById('newProductName').value = '';
    renderProductList();
    loadProductDatalist();
    showToast('상품 추가됨', 'success');
}

function renderProductList() {
    const products = getProducts();
    const list = document.getElementById('productManagerList');
    list.innerHTML = products.map(p => `
        <div class="product-item">
            <span>${p}</span>
            <button class="product-delete" onclick="removeProductUI('${p}')">삭제</button>
        </div>
    `).join('');
}

function removeProductUI(name) {
    removeProduct(name);
    renderProductList();
    loadProductDatalist();
}

// ===== Toast =====
let toastTimer;
function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + type;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}
