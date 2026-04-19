// ===== localStorage 관리 =====
const PREFIX = 'parcel_';

function save(key, data) { try { localStorage.setItem(PREFIX+key, JSON.stringify(data)); } catch(e) {} }
function load(key, fallback) { try { const r = localStorage.getItem(PREFIX+key); return r ? JSON.parse(r) : fallback; } catch(e) { return fallback; } }
function remove(key) { localStorage.removeItem(PREFIX+key); }

// 주문
function getOrders() { return load('orders', []); }
function saveOrders(orders) { save('orders', orders); }
function addOrder(order) {
    const orders = getOrders();
    order.id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    order.timestamp = new Date().toISOString();
    order.status = 'pending'; // pending, packed, done
    order.trackingNo = '';
    orders.unshift(order);
    saveOrders(orders);
    return order;
}
function updateOrder(id, updates) {
    const orders = getOrders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx >= 0) { Object.assign(orders[idx], updates); saveOrders(orders); }
    return orders;
}
function deleteOrder(id) {
    const orders = getOrders().filter(o => o.id !== id);
    saveOrders(orders);
    return orders;
}

// 상품
function getProducts() { return load('products', []); }
function saveProducts(products) { save('products', products); }
function addProductItem(name) {
    const products = getProducts();
    if (!products.includes(name)) { products.push(name); saveProducts(products); }
    return products;
}
function removeProduct(name) {
    const products = getProducts().filter(p => p !== name);
    saveProducts(products);
    return products;
}

// 보내는 사람 (사장 정보)
function getSender() {
    return load('sender', { name: '', phone: '', addr: '' });
}
function saveSender(sender) { save('sender', sender); }

// 역할
function getRole() { return load('role', null); }
function setRole(role) { save('role', role); }
function clearRole() { remove('role'); }
