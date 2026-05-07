// ==================== CONFIG ====================
const API_URL = "https://nd-lanches-api-b3gc.onrender.com/api";
const LOJA_SLUG = "nd-lanches";
const LOJA_ID = 1;
const CART_KEY = "ndlanches_cart_v2";
const LAST_ORDER_KEY = "ndlanches_last_order_v2";
const USER_DATA_KEY = "ndlanches_user_v2";
const DELIVERY_FEE = 5.00;
const CACHE_KEY_CARDAPIO = "nd_cardapio_cache";
const CACHE_TIME_MS = 5 * 60 * 1000; // 5 minutos

let products = [];
let extras = [];
let banners = [];
let cart = [];
let storeOpen = true;
let storeInfo = {};
let currentProduct = null;
let selectedExtras = {};
let selectedRemovals = [];
let productQty = 1;
let currentStep = 0;
let deliveryType = "RETIRADA";
let paymentMethod = "PIX";

// Pizza meio a meio (controles)
let pizzaHalfActive = false;
let pizzaSelectedSabor1 = null;
let pizzaSelectedSabor2 = null;

// Controle para cancelar renderização anterior
let cancelRender = null;

const productsContainer = document.getElementById('productsContainer');
const cartItemsList = document.getElementById('cartItemsList');
const cartSummary = document.getElementById('cartSummary');
const cartTotalAmt = document.getElementById('cartTotalAmount');
const cartSubtotal = document.getElementById('cartSubtotal');
const cartItemCount = document.getElementById('cartItemCount');
const repeatBtn = document.getElementById('repeatLastOrderBtn');
const clearCartBtn = document.getElementById('clearCartBtn');
const checkoutBtn = document.getElementById('checkoutBtn');
const cartModal = document.getElementById('cartModal');
const cartModalItemsList = document.getElementById('cartModalItemsList');
const cartModalSummary = document.getElementById('cartModalSummary');
const cartModalTotal = document.getElementById('cartModalTotalAmount');
const cartModalSubtotal = document.getElementById('cartModalSubtotal');
const fabCartTotal = document.getElementById('fabCartTotal');
const fabCart = document.getElementById('fabCart');
const repeatBtnModal = document.getElementById('repeatLastOrderBtnModal');
const clearCartBtnModal = document.getElementById('clearCartBtnModal');
const checkoutBtnModal = document.getElementById('checkoutBtnModal');
const productModal = document.getElementById('productModal');
const checkoutModal = document.getElementById('checkoutModal');
const toastEl = document.getElementById('toastMsg');
const bannersContainer = document.getElementById('bannersContainer');

function fmt(n) { return `R$ ${n.toFixed(2).replace('.', ',')}`; }
let toastTimer;
function showToast(msg, isError = false) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isError ? ' error' : '');
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

async function apiFetch(path, opts = {}) {
    try {
        const response = await fetch(API_URL + path, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
        });
        if (!response.ok && response.status !== 404) {
            showToast(`Erro ao conectar com o servidor (${response.status})`, true);
        }
        return response;
    } catch (error) {
        console.error("Erro de rede:", error);
        showToast("Falha de conexão com o servidor. Verifique sua internet.", true);
        throw error;
    }
}

function obterCardapioCache() {
    const cached = localStorage.getItem(CACHE_KEY_CARDAPIO);
    if (!cached) return null;
    try {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TIME_MS) {
            return data;
        }
        localStorage.removeItem(CACHE_KEY_CARDAPIO);
        return null;
    } catch {
        return null;
    }
}

function salvarCardapioCache(produtos, extras, banners) {
    const payload = {
        timestamp: Date.now(),
        data: { produtos, extras, banners }
    };
    localStorage.setItem(CACHE_KEY_CARDAPIO, JSON.stringify(payload));
}

function saveUserData() {
    const data = { 
        name: document.getElementById('customerName')?.value || '', 
        phone: document.getElementById('customerPhone')?.value || '', 
        street: document.getElementById('addressStreet')?.value || '', 
        neighborhood: document.getElementById('addressNeighborhood')?.value || '', 
        reference: document.getElementById('addressReference')?.value || '' 
    };
    localStorage.setItem(USER_DATA_KEY, JSON.stringify(data));
}
function loadUserData() {
    try {
        const d = JSON.parse(localStorage.getItem(USER_DATA_KEY) || '{}');
        if (d.name) setVal('customerName', d.name);
        if (d.phone) setVal('customerPhone', d.phone);
        if (d.street) setVal('addressStreet', d.street);
        if (d.neighborhood) setVal('addressNeighborhood', d.neighborhood);
        if (d.reference) setVal('addressReference', d.reference);
    } catch(e) {}
}
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

async function fetchBanners() {
    try {
        const res = await apiFetch(`/banners/loja/${LOJA_ID}`);
        if (res.ok) {
            banners = await res.json();
            const activeBanners = banners.filter(b => b.ativo === true);
            if (activeBanners.length) {
                bannersContainer.style.display = 'flex';
                bannersContainer.innerHTML = activeBanners.map(b => `
                    <div class="banner-card" style="border-left: 4px solid ${b.cor === 'amarelo' ? '#FFB703' : b.cor === 'verde' ? '#2D6A4F' : b.cor === 'vermelho' ? '#E63946' : '#40916C'}">
                        <div class="banner-emoji">${b.emoji || '📢'}</div>
                        <div class="banner-info">
                            <h4>${escapeHtml(b.titulo)}</h4>
                            <p>${escapeHtml(b.descricao || '')}</p>
                        </div>
                    </div>
                `).join('');
            } else {
                bannersContainer.style.display = 'none';
            }
        } else {
            bannersContainer.style.display = 'none';
        }
    } catch(e) { 
        console.warn("Erro banners:", e); 
        bannersContainer.style.display = 'none';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function saveCart() { localStorage.setItem(CART_KEY, JSON.stringify(cart)); updateCartUI(); }
function loadCart() { try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch(e) { cart = []; } updateCartUI(); }
function getCartTotal() { return cart.reduce((s, item) => { const extrasSum = (item.extras || []).reduce((a, e) => a + e.preco, 0); return s + (item.price + extrasSum) * item.quantity; }, 0); }
function getCartCount() { return cart.reduce((s, i) => s + i.quantity, 0); }

function clearCart() {
    if (cart.length === 0) return;
    if (confirm("Tem certeza que deseja limpar todo o carrinho?")) {
        cart = [];
        saveCart();
        showToast("Carrinho limpo");
    }
}

function updateCartUI() {
    const count = getCartCount();
    const total = getCartTotal();
    if (cartItemCount) cartItemCount.textContent = count;
    if (cartItemCount) cartItemCount.classList.add('bounce');
    setTimeout(() => cartItemCount?.classList.remove('bounce'), 500);
    if (document.getElementById('fabCartCount')) document.getElementById('fabCartCount').textContent = count;
    if (fabCartTotal) fabCartTotal.textContent = fmt(total);
    fabCart?.classList.add('bounce');
    setTimeout(() => fabCart?.classList.remove('bounce'), 300);
    if (cart.length === 0) {
        if (cartItemsList) cartItemsList.innerHTML = `<div class="cart-empty"><div class="cart-empty-icon">🛍️</div><p>Seu carrinho está vazio</p><small>Adicione itens para começar</small></div>`;
        if (cartSummary) cartSummary.style.display = 'none';
        if (repeatBtn) repeatBtn.style.display = 'none';
        if (clearCartBtn) clearCartBtn.style.display = 'none';
        if (repeatBtnModal) repeatBtnModal.style.display = 'none';
        if (clearCartBtnModal) clearCartBtnModal.style.display = 'none';
    } else {
        let html = '';
        cart.forEach((item, idx) => {
            const extrasSum = (item.extras || []).reduce((a, e) => a + e.preco, 0);
            const itemTotal = (item.price + extrasSum) * item.quantity;
            const imgUrl = item.imageUrl?.replace('/upload/', '/upload/w_80,f_webp,q_auto/');
            const imgHtml = imgUrl ? `<img src="${imgUrl}" alt="${item.name}" loading="lazy">` : (item.emoji || '🍔');
            let modsHtml = '';
            if (item.removals?.length) item.removals.forEach(r => modsHtml += `<span class="mod-chip removal">❌ Sem ${r}</span>`);
            if (item.extras?.length) item.extras.forEach(e => modsHtml += `<span class="mod-chip extra">➕ ${e.nome}</span>`);
            if (item.observation) modsHtml += `<span class="mod-chip">📝 ${item.observation}</span>`;
            html += `<div class="cart-item"><div class="cart-item-img">${typeof imgHtml === 'string' && imgHtml.startsWith('<img') ? imgHtml : `<span>${imgHtml}</span>`}</div><div class="cart-item-info"><div class="cart-item-title">${item.name}</div>${modsHtml ? `<div class="cart-item-mods">${modsHtml}</div>` : ''}<div class="cart-item-price">${fmt(itemTotal)}</div></div><div class="cart-item-controls"><div class="cart-qty-group"><button class="cart-qty-btn" onclick="updateQty(${idx},-1)">−</button><span class="cart-qty-val">${item.quantity}</span><button class="cart-qty-btn" onclick="updateQty(${idx},+1)">+</button></div><button class="cart-remove" onclick="removeItem(${idx})" title="Remover"><i class="fa-solid fa-trash-can fa-xs"></i></button></div></div>`;
        });
        if (cartItemsList) cartItemsList.innerHTML = html;
        if (cartSummary) cartSummary.style.display = 'block';
        const sub = total;
        const fee = deliveryType === 'ENTREGA' ? DELIVERY_FEE : 0;
        if (cartSubtotal) cartSubtotal.textContent = fmt(sub);
        const feeRow = document.getElementById('deliveryFeeRow');
        if (feeRow) feeRow.style.display = fee ? 'flex' : 'none';
        if (document.getElementById('deliveryFeeAmt')) document.getElementById('deliveryFeeAmt').textContent = fmt(fee);
        if (cartTotalAmt) cartTotalAmt.textContent = fmt(sub + fee);
        if (repeatBtn) repeatBtn.style.display = localStorage.getItem(LAST_ORDER_KEY) ? 'flex' : 'none';
        if (clearCartBtn) clearCartBtn.style.display = 'flex';
        if (repeatBtnModal) repeatBtnModal.style.display = localStorage.getItem(LAST_ORDER_KEY) ? 'flex' : 'none';
        if (clearCartBtnModal) clearCartBtnModal.style.display = 'flex';
    }
    if (cartModal && cartModal.classList.contains('open')) renderCartModal();
}

function renderCartModal() {
    if (cart.length === 0) {
        if (cartModalItemsList) cartModalItemsList.innerHTML = `<div class="cart-empty"><div class="cart-empty-icon">🛍️</div><p>Seu carrinho está vazio</p><small>Adicione itens para começar</small></div>`;
        if (cartModalSummary) cartModalSummary.style.display = 'none';
        if (repeatBtnModal) repeatBtnModal.style.display = 'none';
        if (clearCartBtnModal) clearCartBtnModal.style.display = 'none';
        return;
    }
    let html = '';
    cart.forEach((item, idx) => {
        const extrasSum = (item.extras || []).reduce((a, e) => a + e.preco, 0);
        const itemTotal = (item.price + extrasSum) * item.quantity;
        const imgHtml = item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}" loading="lazy" decoding="async">` : (item.emoji || '🍔');
        let modsHtml = '';
        if (item.removals?.length) item.removals.forEach(r => modsHtml += `<span class="mod-chip removal">❌ Sem ${r}</span>`);
        if (item.extras?.length) item.extras.forEach(e => modsHtml += `<span class="mod-chip extra">➕ ${e.nome}</span>`);
        if (item.observation) modsHtml += `<span class="mod-chip">📝 ${item.observation}</span>`;
        html += `<div class="cart-item"><div class="cart-item-img">${typeof imgHtml === 'string' && imgHtml.startsWith('<img') ? imgHtml : `<span>${imgHtml}</span>`}</div><div class="cart-item-info"><div class="cart-item-title">${item.name}</div>${modsHtml ? `<div class="cart-item-mods">${modsHtml}</div>` : ''}<div class="cart-item-price">${fmt(itemTotal)}</div></div><div class="cart-item-controls"><div class="cart-qty-group"><button class="cart-qty-btn" onclick="updateQty(${idx},-1)">−</button><span class="cart-qty-val">${item.quantity}</span><button class="cart-qty-btn" onclick="updateQty(${idx},+1)">+</button></div><button class="cart-remove" onclick="removeItem(${idx})" title="Remover"><i class="fa-solid fa-trash-can fa-xs"></i></button></div></div>`;
    });
    if (cartModalItemsList) cartModalItemsList.innerHTML = html;
    if (cartModalSummary) cartModalSummary.style.display = 'block';
    const sub = getCartTotal();
    const fee = deliveryType === 'ENTREGA' ? DELIVERY_FEE : 0;
    if (cartModalSubtotal) cartModalSubtotal.textContent = fmt(sub);
    const feeRowModal = document.getElementById('deliveryFeeRowModal');
    if (feeRowModal) feeRowModal.style.display = fee ? 'flex' : 'none';
    if (document.getElementById('deliveryFeeAmtModal')) document.getElementById('deliveryFeeAmtModal').textContent = fmt(fee);
    if (cartModalTotal) cartModalTotal.textContent = fmt(sub + fee);
    if (repeatBtnModal) repeatBtnModal.style.display = localStorage.getItem(LAST_ORDER_KEY) ? 'flex' : 'none';
    if (clearCartBtnModal) clearCartBtnModal.style.display = 'flex';
}

window.updateQty = (idx, delta) => {
    const newQ = cart[idx].quantity + delta;
    if (newQ < 1) return removeItem(idx);
    if (newQ > 99) { showToast("Quantidade máxima permitida: 99", true); return; }
    cart[idx].quantity = newQ;
    saveCart();
};
window.removeItem = (idx) => { cart.splice(idx, 1); saveCart(); showToast('Item removido do carrinho'); };
function repeatLastOrder() {
    try { const last = JSON.parse(localStorage.getItem(LAST_ORDER_KEY) || '[]'); if (last.length) { cart = last.map(i => ({ ...i })); saveCart(); showToast('🔄 Último pedido restaurado!'); } } catch(e) {}
}

async function fetchStoreStatus() {
    try {
        const r = await apiFetch(`/loja/${LOJA_SLUG}/status`);
        if (r.ok) storeOpen = await r.json();
        const sr = await apiFetch(`/loja/${LOJA_SLUG}`);
        if (sr.ok) storeInfo = await sr.json();
    } catch(e) {
        console.warn("Erro ao buscar status da loja:", e);
    }
    
    const ind = document.getElementById('statusIndicator');
    const txt = document.getElementById('statusText');
    const scheduleDiv = document.getElementById('storeSchedule');
    
    if (!scheduleDiv) return;
    
    if (storeOpen) {
        ind.className = 'status-pill open';
        txt.innerHTML = '<i class="fa-regular fa-circle-check"></i> Aberto agora';
        scheduleDiv.style.display = 'none';
        scheduleDiv.innerHTML = '';
    } else {
        ind.className = 'status-pill closed';
        txt.innerHTML = '<i class="fa-regular fa-circle-xmark"></i> Fechado no momento';
        
        let scheduleHtml = '';
        if (storeInfo.horarioFuncionamento) {
            scheduleHtml += `<span class="schedule-item"><i class="fa-regular fa-calendar-alt"></i> ${storeInfo.horarioFuncionamento}</span>`;
        }
        if (storeInfo.mensagemFechado) {
            if (scheduleHtml) scheduleHtml += ' · ';
            scheduleHtml += `<span class="schedule-item"><i class="fa-regular fa-bell"></i> ${storeInfo.mensagemFechado}</span>`;
        }
        
        if (scheduleHtml) {
            scheduleDiv.style.display = 'inline-flex';
            scheduleDiv.innerHTML = scheduleHtml;
        } else {
            scheduleDiv.style.display = 'none';
        }
    }
}

function showSkeletons() {
    productsContainer.innerHTML = `<div class="products-grid">${Array(4).fill(0).map(() => `<div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-body"><div class="sk" style="height:18px;width:70%;"></div><div class="sk" style="height:30px;width:100%;"></div><div class="sk" style="height:18px;width:45%;"></div></div></div>`).join('')}</div>`;
}

const CAT_META = {
    LANCHE: { emoji: '🍔', label: 'Lanches' },
    BEBIDA: { emoji: '🥤', label: 'Bebidas' },
    PASTEL: { emoji: '🥟', label: 'Pastéis' },
    BATATA: { emoji: '🍟', label: 'Batatas fritas' },
    PIZZA: { emoji: '🍕', label: 'Pizzas' },
    "CACHORRO QUENTE": { emoji: '🌭', label: 'Cachorro Quente' }
};

// Ordem fixa das categorias para a aba "Todos"
const CATEGORIA_ORDEM = [
    "LANCHE",
    "BEBIDA",
    "PASTEL",
    "BATATA",
    "PIZZA",
    "CACHORRO QUENTE"
];

// ========== RENDERIZAÇÃO INCREMENTAL CORRIGIDA ==========
function renderProducts(list, filter = 'TODOS') {
    // Cancela qualquer renderização anterior ainda em andamento
    if (cancelRender) {
        cancelRender();
        cancelRender = null;
    }

    // 1. Filtrar e deduplicar por ID (previne duplicatas da API)
    let filtered = filter === 'TODOS' ? list : list.filter(p => p.categoria === filter);
    const uniqueMap = new Map();
    filtered.forEach(p => uniqueMap.set(p.id, p));
    filtered = Array.from(uniqueMap.values());
    
    if (!filtered.length) {
        productsContainer.innerHTML = `<div class="empty-message"><div class="em-icon">🔍</div><p>Nenhum produto encontrado</p></div>`;
        return;
    }

    // 2. Agrupar por categoria
    const grouped = {};
    filtered.forEach(p => {
        const cat = p.categoria;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(p);
    });

    // 3. Ordenar as categorias conforme CATEGORIA_ORDEM
    const orderedCategories = [...CATEGORIA_ORDEM];
    // Adiciona categorias que não estão na ordem predefinida (caso existam) no final
    for (const cat in grouped) {
        if (!orderedCategories.includes(cat)) orderedCategories.push(cat);
    }

    // 4. Construir o HTML completo
    let fullHtml = '';
    for (const cat of orderedCategories) {
        const items = grouped[cat];
        if (!items) continue;
        const meta = CAT_META[cat] || { emoji: '🍽️', label: cat };
        fullHtml += `<div class="section-header"><div class="section-icon">${meta.emoji}</div><div class="section-title">${meta.label}</div><span class="section-count">${items.length} itens</span></div><div class="products-grid">`;
        items.forEach(p => {
            const price = p.preco.toFixed(2).replace('.', ',');
            const imgUrl = p.imagemUrl ? p.imagemUrl.replace('/upload/', '/upload/w_200,f_webp,q_auto/') : null;
            const imgHtml = imgUrl ? `<img src="${imgUrl}" alt="${p.nome}" loading="lazy" decoding="async">` : `<div class="emoji-placeholder">${p.emoji || meta.emoji}</div>`;
            const tagHtml = p.tagTexto ? `<div class="product-tag">${p.tagTexto}</div>` : '';
            const isDisponivel = p.ativo === true;
            const disabledAttr = !isDisponivel ? 'disabled' : '';
            const disableClass = !isDisponivel ? 'indisponivel' : '';
            const badgeIndisponivel = !isDisponivel ? '<div class="indisponivel-label">⚠️ INDISPONÍVEL</div>' : '';
            fullHtml += `<div class="product-card ${disableClass}" data-id="${p.id}">
                <div class="product-img">${imgHtml}${tagHtml}${badgeIndisponivel}<button class="product-fav" data-pid="${p.id}" onclick="toggleFav(event,${p.id})"><i class="fa-heart fa-solid"></i></button></div>
                <div class="product-info">
                    <div class="product-title">${escapeHtml(p.nome)}</div>
                    <div class="product-desc">${escapeHtml(p.descricao || '')}</div>
                    <div class="product-footer">
                        <div class="product-price"><span class="currency">R$ </span>${price}</div>
                        <button class="add-btn" data-id="${p.id}" aria-label="Adicionar ${p.nome}" ${disabledAttr}><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
            </div>`;
        });
        fullHtml += `</div>`;
    }

    // 5. Inserção em chunks (renderização incremental)
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = fullHtml;
    const fragment = document.createDocumentFragment();
    while (tempDiv.firstChild) fragment.appendChild(tempDiv.firstChild);

    const allCards = Array.from(fragment.querySelectorAll('.product-card'));
    const chunks = [];
    for (let i = 0; i < allCards.length; i += 10) {
        chunks.push(allCards.slice(i, i + 10));
    }

    // Limpa o container e cancela qualquer processo anterior
    productsContainer.innerHTML = '';
    let chunkIndex = 0;
    let isCancelled = false;
    
    // Armazena a função de cancelamento
    cancelRender = () => { isCancelled = true; };

    function renderNextChunk() {
        if (isCancelled || chunkIndex >= chunks.length) {
            if (chunkIndex >= chunks.length) cancelRender = null;
            return;
        }
        const chunk = chunks[chunkIndex];
        for (const card of chunk) {
            productsContainer.appendChild(card);
            // Reatribuir eventos (já que foram clonados)
            const id = +card.dataset.id;
            const product = filtered.find(p => p.id === id);
            const disponivel = product?.ativo === true;
            card.addEventListener('click', e => {
                if (!e.target.closest('.add-btn') && !e.target.closest('.product-fav') && disponivel) openProductModal(id);
                else if (!disponivel) showToast('Produto indisponível no momento', true);
            });
            const addBtn = card.querySelector('.add-btn');
            if (addBtn) {
                addBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    if (disponivel) openProductModal(id);
                    else showToast('Produto indisponível', true);
                });
            }
        }
        chunkIndex++;
        requestAnimationFrame(renderNextChunk);
    }
    requestAnimationFrame(renderNextChunk);
}

window.toggleFav = (e, id) => { e.stopPropagation(); const btn = e.currentTarget; btn.classList.toggle('active'); };

// ========== PRODUCT MODAL COM SUPORTE PARA MEIO A MEIO ==========
function openProductModal(id) {
    if (!storeOpen) { showToast('⛔ Loja fechada no momento', true); return; }
    const p = products.find(x => x.id === id);
    if (!p) return;
    if (p.ativo === false) { showToast('Produto indisponível no momento', true); return; }
    currentProduct = p;
    selectedExtras = {};
    selectedRemovals = [];
    productQty = 1;
    pizzaHalfActive = false;
    pizzaSelectedSabor1 = null;
    pizzaSelectedSabor2 = null;

    const hero = document.getElementById('modalHero');
    const emojiEl = document.getElementById('modalHeroEmoji');
    hero.querySelector('img')?.remove();
    if (p.imagemUrl) {
        const imgUrl = p.imagemUrl.replace('/upload/', '/upload/w_600,f_webp,q_auto/');
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = p.nome;
        hero.insertBefore(img, hero.querySelector('.modal-close') || null);
        emojiEl.style.display = 'none';
    } else {
        emojiEl.style.display = '';
        emojiEl.textContent = p.emoji || (CAT_META[p.categoria]?.emoji || '🍔');
    }
    document.getElementById('modalProductName').textContent = p.nome;
    document.getElementById('modalProductDesc').textContent = p.descricao || '';

    let removiveis = [];
    if (p.removiveis && Array.isArray(p.removiveis) && p.removiveis.length > 0) {
        removiveis = p.removiveis;
    }
    const chipsHtml = removiveis.length ? 
        `<div class="modal-section-label">Ingredientes — toque para remover</div>
         <div class="ingredients-chips">
            ${removiveis.map(ing => `<div class="ingredient-chip" data-ing="${ing}"><span class="chip-x"><i class="fa-solid fa-xmark"></i></span>${ing}</div>`).join('')}
         </div>` : '';
    
    const extrasHtml = (p.categoria === 'LANCHE' && extras.length) ? 
        `<div class="modal-section-label">Adicionais</div>
         <div class="extras-grid">
            ${extras.map(ext => `<div class="extra-card" data-id="${ext.id}"><span class="extra-emoji">${ext.emoji || '➕'}</span><div class="extra-info"><div class="extra-name">${ext.nome}</div><div class="extra-price">+ R$ ${ext.preco.toFixed(2).replace('.', ',')}</div></div><div class="extra-check"><i class="fa fa-check fa-xs"></i></div></div>`).join('')}
         </div>` : '';

    let pizzaHalfHtml = '';
    if (p.categoria === 'PIZZA') {
        const pizzasDisponiveis = products.filter(prod => prod.categoria === 'PIZZA' && prod.ativo === true);
        const optionsHtml = pizzasDisponiveis.map(prod => `<option value="${prod.id}" data-preco="${prod.preco}">${prod.nome} - R$ ${prod.preco.toFixed(2).replace('.', ',')}</option>`).join('');
        pizzaHalfHtml = `
            <div class="pizza-half">
                <label>
                    <input type="checkbox" id="pizzaHalfCheckbox"> Pedir meio a meio (dois sabores)
                </label>
                <div id="pizzaHalfOptions" style="display: none;">
                    <div class="pizza-half-row">
                        <div class="pizza-half-col">
                            <label>Primeiro sabor</label>
                            <select id="pizzaSabor1">
                                <option value="">Selecione</option>
                                ${optionsHtml}
                            </select>
                        </div>
                        <div class="pizza-half-col">
                            <label>Segundo sabor</label>
                            <select id="pizzaSabor2">
                                <option value="">Selecione</option>
                                ${optionsHtml}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    document.getElementById('modalProductBody').innerHTML = `${chipsHtml}${extrasHtml}${pizzaHalfHtml}
        <div class="qty-row"><span class="qty-label">Quantidade (máx 99)</span><div class="qty-control"><button class="qty-btn" id="qtyDec">−</button><span class="qty-val" id="qtyVal">1</span><button class="qty-btn" id="qtyInc">+</button></div></div>
        <div class="modal-section-label">Observações</div>
        <textarea class="obs-textarea" id="productObservation" rows="2" placeholder="Ex: sem cebola, ponto da carne..."></textarea>`;
    
    document.querySelectorAll('.ingredient-chip').forEach(chip => { chip.addEventListener('click', () => handleIngredientToggle(chip)); });
    document.querySelectorAll('.extra-card').forEach(card => { card.addEventListener('click', () => handleExtraToggle(card)); });
    
    document.getElementById('qtyDec').onclick = () => { if (productQty > 1) { productQty--; document.getElementById('qtyVal').textContent = productQty; updateModalTotal(); } };
    document.getElementById('qtyInc').onclick = () => { if (productQty < 99) { productQty++; document.getElementById('qtyVal').textContent = productQty; updateModalTotal(); } else { showToast("Quantidade máxima é 99", true); } };
    
    if (p.categoria === 'PIZZA') {
        const halfCheckbox = document.getElementById('pizzaHalfCheckbox');
        const halfOptions = document.getElementById('pizzaHalfOptions');
        const sabor1 = document.getElementById('pizzaSabor1');
        const sabor2 = document.getElementById('pizzaSabor2');
        
        const updatePizzaPrice = () => {
            if (halfCheckbox.checked && sabor1.value && sabor2.value) {
                const preco1 = parseFloat(sabor1.options[sabor1.selectedIndex]?.dataset?.preco || 0);
                const preco2 = parseFloat(sabor2.options[sabor2.selectedIndex]?.dataset?.preco || 0);
                const extrasSum = Object.values(selectedExtras).reduce((s, e) => s + e.preco, 0);
                const basePrice = Math.max(preco1, preco2);
                const total = (basePrice + extrasSum) * productQty;
                document.getElementById('modalTotalPrice').textContent = fmt(total);
            } else {
                updateModalTotal();
            }
        };
        
        halfCheckbox.addEventListener('change', () => {
            halfOptions.style.display = halfCheckbox.checked ? 'block' : 'none';
            if (!halfCheckbox.checked) {
                updateModalTotal();
            } else {
                updatePizzaPrice();
            }
        });
        sabor1.addEventListener('change', updatePizzaPrice);
        sabor2.addEventListener('change', updatePizzaPrice);
    }
    
    updateModalTotal();
    productModal.classList.add('open');
}

function handleIngredientToggle(chip) {
    const ing = chip.dataset.ing;
    if (selectedRemovals.includes(ing)) { selectedRemovals = selectedRemovals.filter(i => i !== ing); chip.classList.remove('removed'); }
    else { selectedRemovals.push(ing); chip.classList.add('removed'); }
    updateModalTotal();
}
function handleExtraToggle(card) {
    const id = +card.dataset.id;
    const extra = extras.find(e => e.id === id);
    if (selectedExtras[id]) { delete selectedExtras[id]; card.classList.remove('selected'); }
    else { selectedExtras[id] = extra; card.classList.add('selected'); }
    updateModalTotal();
}
function updateModalTotal() {
    if (!currentProduct) return;
    let basePrice = currentProduct.preco;
    const halfCheckbox = document.getElementById('pizzaHalfCheckbox');
    if (currentProduct.categoria === 'PIZZA' && halfCheckbox && halfCheckbox.checked) {
        const sabor1 = document.getElementById('pizzaSabor1');
        const sabor2 = document.getElementById('pizzaSabor2');
        if (sabor1 && sabor2 && sabor1.value && sabor2.value) {
            const preco1 = parseFloat(sabor1.options[sabor1.selectedIndex]?.dataset?.preco || 0);
            const preco2 = parseFloat(sabor2.options[sabor2.selectedIndex]?.dataset?.preco || 0);
            basePrice = Math.max(preco1, preco2);
        }
    }
    const extrasSum = Object.values(selectedExtras).reduce((s, e) => s + e.preco, 0);
    const total = (basePrice + extrasSum) * productQty;
    document.getElementById('modalTotalPrice').textContent = fmt(total);
}
function closeModal() { productModal.classList.remove('open'); }

document.getElementById('modalAddToCartBtn').onclick = () => {
    if (!currentProduct) return;
    if (currentProduct.ativo === false) { showToast('Produto indisponível', true); closeModal(); return; }
    
    let nomeProduto = currentProduct.nome;
    let precoProduto = currentProduct.preco;
    let observacao = document.getElementById('productObservation')?.value.trim() || '';
    
    const halfCheckbox = document.getElementById('pizzaHalfCheckbox');
    if (currentProduct.categoria === 'PIZZA' && halfCheckbox && halfCheckbox.checked) {
        const sabor1 = document.getElementById('pizzaSabor1');
        const sabor2 = document.getElementById('pizzaSabor2');
        if (!sabor1.value || !sabor2.value) {
            showToast('Selecione os dois sabores da pizza meio a meio.', true);
            return;
        }
        const pizza1 = products.find(p => p.id == sabor1.value);
        const pizza2 = products.find(p => p.id == sabor2.value);
        if (!pizza1 || !pizza2) return;
        nomeProduto = `Pizza Meia a Meia: ${pizza1.nome} + ${pizza2.nome}`;
        precoProduto = Math.max(pizza1.preco, pizza2.preco);
        observacao = (observacao ? observacao + ' | ' : '') + `Meio a meio: ${pizza1.nome} / ${pizza2.nome}`;
    }
    
    const extraList = Object.values(selectedExtras);
    cart.push({ 
        id: currentProduct.id, 
        name: nomeProduto, 
        price: precoProduto, 
        quantity: productQty, 
        extras: extraList, 
        removals: selectedRemovals, 
        observation: observacao, 
        imageUrl: currentProduct.imagemUrl || null, 
        emoji: currentProduct.emoji || null 
    });
    saveCart();
    closeModal();
    showToast(`✅ ${productQty}x ${nomeProduto} adicionado!`);
    const btn = document.querySelector(`.add-btn[data-id="${currentProduct.id}"]`);
    if (btn) { btn.classList.add('added'); btn.innerHTML = '<i class="fa-solid fa-check"></i>'; setTimeout(() => { btn.classList.remove('added'); btn.innerHTML = '<i class="fa-solid fa-plus"></i>'; }, 800); }
};

// ========== CHECKOUT ==========
function goStep(step) {
    if (step === 1 && !validateStep0()) return;
    if (step === 2 && !validateStep1()) return;
    currentStep = step;
    document.querySelectorAll('.checkout-step-content').forEach((el, i) => { el.classList.toggle('active', i === step); });
    ['sb0','sb1','sb2'].forEach((id, i) => {
        const el = document.getElementById(id);
        el.classList.remove('active','done');
        const item = el.closest('.step-item');
        item.classList.remove('active','done');
        if (i < step) { el.classList.add('done'); el.innerHTML = '✓'; item.classList.add('done'); }
        else if (i === step) { el.classList.add('active'); el.textContent = i+1; item.classList.add('active'); }
        else { el.textContent = i+1; }
    });
    ['sl0','sl1'].forEach((id,i) => { document.getElementById(id).classList.toggle('done', i < step); });
    if (step === 2) renderOrderReview();
}
function validateForm(fields) {
    for (const [id, label] of fields) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (!el.value.trim()) { el.focus(); el.style.borderColor = 'var(--red)'; setTimeout(() => el.style.borderColor = '', 2000); showToast(`⚠️ Preencha: ${label}`, true); return false; }
    }
    return true;
}
function validateStep0() { return validateForm([['customerName', 'Seu nome']]); }
function validateStep1() { if (deliveryType === 'ENTREGA') return validateForm([['addressStreet', 'Rua e número'], ['addressNeighborhood', 'Bairro']]); return true; }
window.goStep = goStep;
window.selectDelivery = (card) => {
    document.querySelectorAll('.delivery-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    deliveryType = card.dataset.val;
    document.getElementById('addressFields').classList.toggle('show', deliveryType === 'ENTREGA');
    updateCartUI();
};
window.selectPayment = (card) => {
    document.querySelectorAll('.payment-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    paymentMethod = card.dataset.val;
    document.getElementById('changeField').style.display = paymentMethod === 'DINHEIRO' ? 'block' : 'none';
    renderOrderReview();
};
function renderOrderReview() {
    const sub = getCartTotal();
    const fee = deliveryType === 'ENTREGA' ? DELIVERY_FEE : 0;
    const total = sub + fee;
    const el = document.getElementById('orderReview');
    let itemsHtml = cart.map(item => { const extS = (item.extras || []).reduce((a, e) => a + e.preco, 0); return `<div class="review-item"><span>${item.quantity}x ${item.name}</span><span>${fmt((item.price + extS) * item.quantity)}</span></div>`; }).join('');
    el.innerHTML = `<div class="review-title">📋 Resumo do Pedido</div>${itemsHtml}${fee ? `<div class="review-item"><span>Taxa de entrega</span><span>${fmt(fee)}</span></div>` : ''}<hr class="review-divider"><div class="review-total"><span class="review-total-label">Total a pagar</span><span class="review-total-value">${fmt(total)}</span></div>`;
}
function openCheckout() {
    if (!storeOpen) { showToast('⛔ Loja fechada no momento', true); return; }
    if (!cart.length) { showToast('🛒 Adicione itens primeiro', true); return; }
    loadUserData();
    currentStep = 0; goStep(0);
    deliveryType = 'RETIRADA';
    document.querySelectorAll('.delivery-card').forEach(c => c.classList.toggle('selected', c.dataset.val === 'RETIRADA'));
    document.getElementById('addressFields').classList.remove('show');
    document.querySelectorAll('.payment-card').forEach(c => c.classList.toggle('selected', c.dataset.val === 'PIX'));
    paymentMethod = 'PIX';
    document.getElementById('changeField').style.display = 'none';
    checkoutModal.classList.add('open');
}
function closeCheckoutModal() { checkoutModal.classList.remove('open'); }
function isValidPhone(phone) {
    if (!phone) return true;
    const phoneRegex = /^\(?[1-9]{2}\)? ?[9]?[0-9]{4}-?[0-9]{4}$/;
    return phoneRegex.test(phone);
}
document.getElementById('confirmOrderBtn').onclick = async () => {
    const nome = document.getElementById('customerName').value.trim();
    const phone = document.getElementById('customerPhone').value.trim();
    if (!nome) { showToast('⚠️ Digite seu nome', true); return; }
    if (phone && !isValidPhone(phone)) {
        showToast('⚠️ Telefone inválido. Use formato (11) 99999-9999', true);
        return;
    }
    const tipo = deliveryType;
    let endereco = '';
    if (tipo === 'ENTREGA') {
        const rua = document.getElementById('addressStreet').value.trim();
        const bairro = document.getElementById('addressNeighborhood').value.trim();
        if (!rua || !bairro) { showToast('⚠️ Preencha o endereço', true); goStep(1); return; }
        endereco = `📍 ${rua}, ${bairro}`;
        const ref = document.getElementById('addressReference').value.trim();
        if (ref) endereco += ` — Ref: ${ref}`;
    }
    let trocoInfo = '';
    if (paymentMethod === 'DINHEIRO') { const troco = document.getElementById('changeAmount').value; trocoInfo = troco ? `\n💵 Troco para R$ ${troco}` : '\n💵 Sem troco'; }
    const sub = getCartTotal(); const fee = tipo === 'ENTREGA' ? DELIVERY_FEE : 0; const total = sub + fee;
    let itensMsg = '';
    cart.forEach(item => { const extS = (item.extras || []).reduce((a, e) => a + e.preco, 0); const iTotal = (item.price + extS) * item.quantity; itensMsg += `▪️ ${item.quantity}x ${item.name} — ${fmt(iTotal)}\n`; if (item.removals?.length) itensMsg += `   ❌ Sem: ${item.removals.join(', ')}\n`; if (item.extras?.length) itensMsg += `   ➕ Extra: ${item.extras.map(e => e.nome).join(', ')}\n`; if (item.observation) itensMsg += `   📝 ${item.observation}\n`; });
    const msg = [`*NOVO PEDIDO — ND LANCHES*`, '', `*Cliente:* ${nome}${phone ? ` | ${phone}` : ''}`, `*Entrega:* ${tipo === 'ENTREGA' ? 'Delivery' : 'Retirada no local'}`, endereco, '', '━━━━━━━━━━━━━━━━━━', '*ITENS:*', itensMsg.trim(), '━━━━━━━━━━━━━━━━━━', fee ? `Subtotal: ${fmt(sub)}\nTaxa de entrega: ${fmt(fee)}` : '', `*TOTAL: ${fmt(total)}*`, '', `*Pagamento:* ${paymentMethod}${trocoInfo}`].filter(l => l).join('\n');
    saveUserData(); localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(cart));
    const btn = document.getElementById('confirmOrderBtn'); const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> Enviando...'; btn.disabled = true;
    try {
        await apiFetch('/pedidos', { method: 'POST', body: JSON.stringify({ nomeCliente: nome, total, status: 'RECEBIDO', itensJson: JSON.stringify(cart), observacao: `${tipo} | ${paymentMethod}`, loja: { id: LOJA_ID } }) });
    } catch(e) { /* silent */ }
    const wpp = storeInfo.whatsapp || '5517999999999'; window.open(`https://wa.me/${wpp}?text=${encodeURIComponent(msg)}`, '_blank');
    cart = []; saveCart(); closeCheckoutModal(); showToast('🎉 Pedido enviado! Abrindo WhatsApp...'); btn.innerHTML = orig; btn.disabled = false;
};

function openCartModal() { renderCartModal(); cartModal.classList.add('open'); }
function closeCartModal() { cartModal.classList.remove('open'); }
window.closeCartModal = closeCartModal;
fabCart?.addEventListener('click', openCartModal);
if (repeatBtnModal) repeatBtnModal.onclick = () => { repeatLastOrder(); closeCartModal(); };
if (clearCartBtn) clearCartBtn.onclick = () => { clearCart(); if (cartModal.classList.contains('open')) closeCartModal(); };
if (clearCartBtnModal) clearCartBtnModal.onclick = () => { clearCart(); closeCartModal(); };
if (checkoutBtnModal) checkoutBtnModal.onclick = () => { closeCartModal(); openCheckout(); };
if (checkoutBtn) checkoutBtn.onclick = openCheckout;
if (repeatBtn) repeatBtn.onclick = repeatLastOrder;
productModal.addEventListener('click', e => { if (e.target === productModal) closeModal(); });
checkoutModal.addEventListener('click', e => { if (e.target === checkoutModal) closeCheckoutModal(); });
cartModal.addEventListener('click', e => { if (e.target === cartModal) closeCartModal(); });
document.querySelectorAll('.tab-btn').forEach(btn => { btn.addEventListener('click', () => { document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); renderProducts(products, btn.dataset.cat); }); });

async function fetchCardapioCompleto() {
    try {
        const response = await apiFetch(`/public/cardapio/${LOJA_ID}`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        return {
            produtos: data.produtos,
            extras: data.adicionais,
            banners: data.banners
        };
    } catch (e) {
        console.warn(e);
        return null;
    }
}

async function init() {
    loadCart();
    await fetchStoreStatus();
    
    // Cancela qualquer render pendente antes de começar o init (segurança)
    if (cancelRender) cancelRender();
    
    // 1. Cache local
    const cache = obterCardapioCache();
    if (cache) {
        products = cache.produtos;
        extras = cache.extras;
        banners = cache.banners || banners;
        renderProducts(products);
    }
    
    // 2. Dados frescos da API
    const dadosNovos = await fetchCardapioCompleto();
    if (dadosNovos) {
        products = dadosNovos.produtos;
        extras = dadosNovos.extras;
        banners = dadosNovos.banners;
        renderProducts(products);
        salvarCardapioCache(products, extras, banners);
    }
    
    // 3. Fallback de banners (caso não venham no payload)
    if (!banners.length) await fetchBanners();
}
init();