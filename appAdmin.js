// ==================== CONFIG ====================
const API_URL = "https://nd-lanches-api-b3gc.onrender.com/api";
const LOJA_SLUG = "nd-lanches";
const LOJA_ID_NUM = 1;
const REFRESH_INTERVAL = 30;
const BRAZIL_TIMEZONE = "America/Sao_Paulo";
const PRODUCT_DRAFT_KEY = "nd_admin_produto_draft";
const ADMIN_CACHE_KEY = "nd_admin_cache";
const ADMIN_CACHE_TIME = 5 * 60 * 1000; // 5 minutos

const CURRENCY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
});

const STATUS_PROX = { RECEBIDO: "PREPARO", PREPARO: "PRONTO", PRONTO: "ENTREGUE", ENTREGUE: "ENTREGUE", CANCELADO: "CANCELADO" };
const STATUS_LABEL = { RECEBIDO: "Recebido", PREPARO: "Em preparo", PRONTO: "Pronto", ENTREGUE: "Entregue", CANCELADO: "Cancelado" };
const emojiPorCategoria = { LANCHE: "🍔", BEBIDA: "🥤", PASTEL: "🥟", BATATA: "🍟", PIZZA: "🍕", "CACHORRO QUENTE": "🌭" };

const state = {
    lojaAberta: false,
    filtroPedidos: "hoje",
    filtroStatusPedidos: "TODOS",
    todosProdutos: [],
    todosPedidos: [],
    adicionais: [],
    banners: [],
    selectedImageFile: null,
    currentRemoviveis: [],
    dragSourceId: null,
    ultimosPedidosIds: new Set(),
    countdownTimerId: null,
    refreshTimerId: null,
    refreshCountdown: REFRESH_INTERVAL,
    lastSyncAt: null,
    edit: { produtoId: null, adicionalId: null, bannerId: null }
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
}

function formatMoney(value) {
    return CURRENCY.format(Number(value) || 0);
}

function formatDateTime(value) {
    if (!value) return "--";
    try {
        const parts = DATE_TIME.formatToParts(new Date(value));
        const get = (type) => parts.find((part) => part.type === type)?.value || "";
        return `${get("day")}/${get("month")}/${get("year")} às ${get("hour")}:${get("minute")}`;
    } catch {
        return "--";
    }
}

function formatTime(value) {
    if (!value) return "--:--";
    try {
        return new Intl.DateTimeFormat("pt-BR", {
            timeZone: BRAZIL_TIMEZONE,
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(value));
    } catch {
        return "--:--";
    }
}

function salvarAdminCache(produtos, adicionais, banners) {
    localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        produtos, adicionais, banners
    }));
}

function obterAdminCache() {
    const raw = localStorage.getItem(ADMIN_CACHE_KEY);
    if (!raw) return null;
    try {
        const { timestamp, produtos, adicionais, banners } = JSON.parse(raw);
        if (Date.now() - timestamp < ADMIN_CACHE_TIME) {
            return { produtos, adicionais, banners };
        }
        localStorage.removeItem(ADMIN_CACHE_KEY);
        return null;
    } catch { return null; }
}

function toggleButtonLoading(button, isLoading, label) {
    if (!button) return;
    if (isLoading) {
        button.disabled = true;
        button.dataset.originalText = button.innerHTML;
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>${label}`;
        return;
    }
    button.disabled = false;
    if (button.dataset.originalText) {
        button.innerHTML = button.dataset.originalText;
        delete button.dataset.originalText;
    }
}

function toast(message, ok = true) {
    const el = $("#feedback");
    const msg = $("#feedbackMsg");
    const icon = el?.querySelector("i");
    if (!el || !msg || !icon) return;
    msg.textContent = message;
    el.className = `feedback ${ok ? "ok" : "err"} show`;
    icon.className = ok ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation";
    clearTimeout(toast.timeoutId);
    toast.timeoutId = setTimeout(() => el.classList.remove("show"), 3000);
}

async function showConfirm(message) {
    const modal = $("#confirmModal");
    const msg = $("#confirmMessage");
    if (!modal || !msg) return window.confirm(message);
    msg.textContent = message;
    modal.classList.add("show");
    return new Promise((resolve) => {
        const cleanup = () => {
            $("#confirmYesBtn")?.removeEventListener("click", onYes);
            $("#confirmNoBtn")?.removeEventListener("click", onNo);
        };
        const onYes = () => { cleanup(); modal.classList.remove("show"); resolve(true); };
        const onNo = () => { cleanup(); modal.classList.remove("show"); resolve(false); };
        $("#confirmYesBtn")?.addEventListener("click", onYes, { once: true });
        $("#confirmNoBtn")?.addEventListener("click", onNo, { once: true });
    });
}

function getAdminKey() {
    return sessionStorage.getItem("admin_key") || "";
}

async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    const adminKey = getAdminKey();
    if (adminKey) headers["Admin-Key"] = adminKey;
    const response = await fetch(url, { ...options, headers });
    if (response.status === 403) {
        sessionStorage.removeItem("admin_authenticated");
        sessionStorage.removeItem("admin_key");
        $("#loginOverlay")?.classList.remove("hidden");
        $("#mainContent")?.classList.remove("visible");
        toast("Sessão expirada. Faça login novamente.", false);
        throw new Error("Sessão expirada");
    }
    return response;
}

async function verificarSenha(senha) {
    try {
        const response = await fetch(`${API_URL}/admin/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: senha })
        });
        if (!response.ok) return false;
        const data = await response.json();
        return data.valid === true;
    } catch {
        return false;
    }
}

function updateTopbarStatus(message) {
    const el = $("#topbarStatus");
    if (el) el.textContent = message;
}

function updateHeroSummary() {
    const prodEl = $("#heroProdutos");
    if (prodEl) prodEl.textContent = String(state.todosProdutos.length);
    const pedEl = $("#heroPedidos");
    if (pedEl) pedEl.textContent = String(state.todosPedidos.length);
    const lojaEl = $("#heroLoja");
    if (lojaEl) lojaEl.textContent = state.lojaAberta ? "Aberta" : "Fechada";
    const receitaEl = $("#heroReceita");
    if (receitaEl) receitaEl.textContent = $("#pedidos-receita")?.textContent || "R$ 0,00";
    const bannersEl = $("#heroBanners");
    if (bannersEl) bannersEl.textContent = String(state.banners.filter((item) => item.ativo).length);
    const adicionaisEl = $("#heroAdicionais");
    if (adicionaisEl) adicionaisEl.textContent = String(state.adicionais.length);
    const refreshEl = $("#heroRefresh");
    if (refreshEl) refreshEl.textContent = `${state.refreshCountdown}s`;
}

function atualizarBotaoStatus() {
    const btn = $("#btnStatus");
    const led = $("#statusLed");
    const label = $("#statusLabel");
    const sub = $("#statusSub");
    if (!btn || !led || !label || !sub) return;
    led.className = `status-led ${state.lojaAberta ? "on" : "off"}`;
    label.textContent = state.lojaAberta ? "Loja aberta" : "Loja fechada";
    sub.textContent = state.lojaAberta ? "Aceitando pedidos agora" : "Loja fora do atendimento";
    btn.className = `btn-toggle ${state.lojaAberta ? "fechar" : "abrir"}`;
    btn.disabled = false;
    btn.textContent = state.lojaAberta ? "Fechar loja" : "Abrir loja";
    updateTopbarStatus(state.lojaAberta ? "Loja aberta para pedidos" : "Loja fechada no momento");
    updateHeroSummary();
}

function setLastSync(source = "Painel sincronizado") {
    state.lastSyncAt = new Date().toISOString();
    updateTopbarStatus(`${source} • ${formatTime(state.lastSyncAt)}`);
}

function getProdutoDraftPayload() {
    return {
        nome: $("#nome")?.value || "",
        descricao: $("#descricao")?.value || "",
        preco: $("#preco")?.value || "",
        categoria: $("#categoria")?.value || "LANCHE",
        emoji: $("#emoji")?.value || "",
        ativoProduto: $("#ativoProduto")?.value || "true",
        imagemUrl: $("#imagemUrl")?.value || "",
        removiveis: [...state.currentRemoviveis]
    };
}

function updateDraftIndicator(visible) {
    const draftEl = $("#produtoDraftState");
    if (draftEl) draftEl.classList.toggle("hidden", !visible);
}

function saveProdutoDraft() {
    if (state.edit.produtoId) return;
    const payload = getProdutoDraftPayload();
    const hasContent = Boolean(
        String(payload.nome || "").trim() ||
        String(payload.descricao || "").trim() ||
        String(payload.preco || "").trim() ||
        String(payload.emoji || "").trim() ||
        String(payload.imagemUrl || "").trim() ||
        (Array.isArray(payload.removiveis) && payload.removiveis.length)
    );
    if (!hasContent) {
        localStorage.removeItem(PRODUCT_DRAFT_KEY);
        updateDraftIndicator(false);
        return;
    }
    localStorage.setItem(PRODUCT_DRAFT_KEY, JSON.stringify(payload));
    updateDraftIndicator(true);
}

function clearProdutoDraft() {
    localStorage.removeItem(PRODUCT_DRAFT_KEY);
    updateDraftIndicator(false);
}

function restoreProdutoDraft() {
    if (state.edit.produtoId) return;
    try {
        const raw = localStorage.getItem(PRODUCT_DRAFT_KEY);
        if (!raw) return updateDraftIndicator(false);
        const draft = JSON.parse(raw);
        $("#nome").value = draft.nome || "";
        $("#descricao").value = draft.descricao || "";
        $("#preco").value = draft.preco || "";
        $("#categoria").value = draft.categoria || "LANCHE";
        $("#emoji").value = draft.emoji || "";
        $("#ativoProduto").value = draft.ativoProduto || "true";
        $("#imagemUrl").value = draft.imagemUrl || "";
        setRemoviveisFromArray(draft.removiveis || []);
        syncImagePreviewFromUrl();
        updateDraftIndicator(true);
    } catch {
        clearProdutoDraft();
    }
}

function syncImagePreviewFromUrl() {
    const imageUrl = ($("#imagemUrl")?.value || "").trim();
    const container = $("#previewImagemDiv");
    if (!container || state.selectedImageFile) return;
    if (!imageUrl) {
        container.innerHTML = "";
        return;
    }
    container.innerHTML = `<img src="${escapeHtml(imageUrl)}" alt="Imagem informada por URL">`;
}

async function exportarPainel() {
    const payload = {
        exportedAt: new Date().toISOString(),
        loja: {
            slug: LOJA_SLUG,
            whatsapp: $("#lojaWhatsapp")?.value || "",
            mensagemFechado: $("#lojaMensagemFechado")?.value || "",
            horarioFuncionamento: $("#horarioFuncionamento")?.value || "",
            aberta: state.lojaAberta
        },
        produtos: state.todosProdutos,
        adicionais: state.adicionais,
        banners: state.banners,
        pedidos: state.todosPedidos
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `nd-lanches-admin-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast("Exportação gerada com sucesso.", true);
}

async function logout() {
    const shouldLogout = await showConfirm("Deseja encerrar a sessão do painel?");
    if (!shouldLogout) return;
    clearInterval(state.countdownTimerId);
    clearInterval(state.refreshTimerId);
    sessionStorage.removeItem("admin_authenticated");
    sessionStorage.removeItem("admin_key");
    $("#mainContent")?.classList.remove("visible");
    $("#loginOverlay")?.classList.remove("hidden");
    $("#accessPassword").value = "";
    $("#accessPassword").focus();
    updateTopbarStatus("Sessão encerrada");
}

async function refreshAllData(silent = false) {
    const button = $("#btnRefreshAll");
    toggleButtonLoading(button, true, "Atualizando");
    try {
        const ok = await carregarDados();
        if (!silent) toast(ok ? "Painel atualizado." : "Não foi possível atualizar o painel.", ok);
    } catch {
        if (!silent) toast("Não foi possível atualizar o painel.", false);
    } finally {
        toggleButtonLoading(button, false, "");
    }
}

function updatePreview() {
    const nameEl = $("#previewName");
    if (nameEl) nameEl.textContent = ($("#nome")?.value || "").trim() || "Produto";
    const priceEl = $("#previewPrice");
    if (priceEl) priceEl.textContent = formatMoney($("#preco")?.value);
    const emojiEl = $("#previewEmoji");
    if (emojiEl) emojiEl.textContent = ($("#emoji")?.value || "").trim() || "🍔";
}

function autoEmojiPorCategoria() {
    const categoria = $("#categoria")?.value;
    const emoji = $("#emoji");
    if (!emoji || !categoria) return;
    if (!emoji.value.trim()) {
        emoji.value = emojiPorCategoria[categoria] || "🍽️";
        updatePreview();
    }
}

function setRemoviveisFromArray(items) {
    state.currentRemoviveis = Array.isArray(items) ? [...new Set(items.map((item) => String(item).trim()).filter(Boolean))] : [];
    renderTags();
}

function renderTags() {
    const list = $("#tagsList");
    if (!list) return;
    if (!state.currentRemoviveis.length) {
        list.innerHTML = `<span class="helper">Nenhum ingrediente removível adicionado.</span>`;
        return;
    }
    list.innerHTML = state.currentRemoviveis.map((tag, index) => `
        <span class="tag">${escapeHtml(tag)}
            <button type="button" class="tag-remove" data-index="${index}" aria-label="Remover ${escapeHtml(tag)}">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </span>
    `).join("");
}

function addTagFromInput() {
    const input = $("#removiveisInput");
    const value = input?.value.trim();
    if (!input || !value) return;
    const exists = state.currentRemoviveis.some((item) => item.toLowerCase() === value.toLowerCase());
    if (exists) return toast("Esse ingrediente já foi adicionado.", false);
    state.currentRemoviveis.push(value);
    input.value = "";
    renderTags();
    saveProdutoDraft();
}

function previewImagem(input) {
    const container = $("#previewImagemDiv");
    if (!container) return;
    state.selectedImageFile = input.files?.[0] || null;
    container.innerHTML = "";
    if (!state.selectedImageFile) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        container.innerHTML = `<img src="${event.target?.result}" alt="Prévia da imagem do produto">`;
    };
    reader.readAsDataURL(state.selectedImageFile);
}

async function fazerUpload(file) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiFetch(`${API_URL}/upload/imagem`, { method: "POST", body: formData });
    if (!response.ok) throw new Error("Falha ao enviar imagem");
    const data = await response.json();
    return data.url;
}

function resetProdutoForm() {
    state.edit.produtoId = null;
    state.selectedImageFile = null;
    $("#nome").value = "";
    $("#descricao").value = "";
    $("#preco").value = "";
    $("#categoria").value = "LANCHE";
    $("#emoji").value = "";
    $("#ativoProduto").value = "true";
    $("#imagemUrl").value = "";
    $("#imagemFile").value = "";
    $("#previewImagemDiv").innerHTML = "";
    const titleEl = $("#formTitle");
    if (titleEl) titleEl.textContent = "Novo Produto";
    const btnLabel = $("#btnSalvarLabel");
    if (btnLabel) btnLabel.textContent = "Salvar";
    const cancelBtn = $("#btnCancelarProduto");
    if (cancelBtn) cancelBtn.classList.add("hidden");
    const editBanner = $("#editBanner");
    if (editBanner) editBanner.classList.remove("vis");
    setRemoviveisFromArray([]);
    autoEmojiPorCategoria();
    clearProdutoDraft();
    updatePreview();
}

function preencherProdutoForm(produto) {
    state.edit.produtoId = produto.id;
    $("#nome").value = produto.nome || "";
    $("#descricao").value = produto.descricao || "";
    $("#preco").value = produto.preco || "";
    $("#categoria").value = produto.categoria || "LANCHE";
    $("#emoji").value = produto.emoji || "";
    $("#ativoProduto").value = String(produto.ativo !== false);
    $("#imagemUrl").value = produto.imagemUrl || "";
    $("#imagemFile").value = "";
    $("#previewImagemDiv").innerHTML = produto.imagemUrl ? `<img src="${escapeHtml(produto.imagemUrl)}" alt="Imagem atual do produto">` : "";
    const titleEl = $("#formTitle");
    if (titleEl) titleEl.textContent = produto.nome || "Editar produto";
    const btnLabel = $("#btnSalvarLabel");
    if (btnLabel) btnLabel.textContent = "Salvar alterações";
    const cancelBtn = $("#btnCancelarProduto");
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    const editBanner = $("#editBanner");
    if (editBanner) editBanner.classList.add("vis");
    state.selectedImageFile = null;
    setRemoviveisFromArray(produto.removiveis || []);
    updateDraftIndicator(false);
    updatePreview();
}

function resetAdicionalForm() {
    state.edit.adicionalId = null;
    $("#adicNome").value = "";
    $("#adicPreco").value = "";
    $("#adicEmoji").value = "";
    const titleEl = $("#adicFormTitle");
    if (titleEl) titleEl.textContent = "Novo Adicional";
    const btnLabel = $("#adicBtnLabel");
    if (btnLabel) btnLabel.textContent = "Salvar";
    const cancelBtn = $("#adicCancelar");
    if (cancelBtn) cancelBtn.classList.add("hidden");
    const editBanner = $("#adicEditBanner");
    if (editBanner) editBanner.classList.remove("vis");
}

function preencherAdicionalForm(item) {
    state.edit.adicionalId = item.id;
    $("#adicNome").value = item.nome || "";
    $("#adicPreco").value = item.preco || "";
    $("#adicEmoji").value = item.emoji || "";
    const titleEl = $("#adicFormTitle");
    if (titleEl) titleEl.textContent = item.nome || "Editar adicional";
    const btnLabel = $("#adicBtnLabel");
    if (btnLabel) btnLabel.textContent = "Salvar alterações";
    const cancelBtn = $("#adicCancelar");
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    const editBanner = $("#adicEditBanner");
    if (editBanner) editBanner.classList.add("vis");
}

function resetBannerForm() {
    state.edit.bannerId = null;
    $("#bannerTitulo").value = "";
    $("#bannerDesc").value = "";
    $("#bannerCor").value = "amarelo";
    $("#bannerEmoji").value = "";
    $("#bannerAtivo").checked = false;
    const titleEl = $("#bannerFormTitle");
    if (titleEl) titleEl.textContent = "Novo Banner";
    const btnLabel = $("#bannerBtnLabel");
    if (btnLabel) btnLabel.textContent = "Publicar";
    const cancelBtn = $("#bannerCancelar");
    if (cancelBtn) cancelBtn.classList.add("hidden");
    const editBanner = $("#bannerEditBanner");
    if (editBanner) editBanner.classList.remove("vis");
}

function preencherBannerForm(item) {
    state.edit.bannerId = item.id;
    $("#bannerTitulo").value = item.titulo || "";
    $("#bannerDesc").value = item.descricao || "";
    $("#bannerCor").value = item.cor || "amarelo";
    $("#bannerEmoji").value = item.emoji || "";
    $("#bannerAtivo").checked = item.ativo === true;
    const titleEl = $("#bannerFormTitle");
    if (titleEl) titleEl.textContent = item.titulo || "Editar banner";
    const btnLabel = $("#bannerBtnLabel");
    if (btnLabel) btnLabel.textContent = "Salvar alterações";
    const cancelBtn = $("#bannerCancelar");
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    const editBanner = $("#bannerEditBanner");
    if (editBanner) editBanner.classList.add("vis");
}

function renderizarProdutos() {
    const lista = $("#lista-produtos-admin");
    const categoria = $("#filtroCategoria")?.value || "TODOS";
    const busca = ($("#buscaProduto")?.value || "").trim().toLowerCase();
    const mostrarIndisponiveis = $("#mostrarIndisponiveis")?.checked === true;
    const ordenacao = $("#ordenarProdutos")?.value || "ordem";
    let filtrados = [...state.todosProdutos];

    if (categoria !== "TODOS") filtrados = filtrados.filter((produto) => produto.categoria === categoria);
    if (busca) filtrados = filtrados.filter((produto) => String(produto.nome || "").toLowerCase().includes(busca) || String(produto.descricao || "").toLowerCase().includes(busca));
    if (!mostrarIndisponiveis) filtrados = filtrados.filter((produto) => produto.ativo === true);
    filtrados.sort((a, b) => {
        if (ordenacao === "nome") return String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
        if (ordenacao === "preco-asc") return (Number(a.preco) || 0) - (Number(b.preco) || 0);
        if (ordenacao === "preco-desc") return (Number(b.preco) || 0) - (Number(a.preco) || 0);
        return (Number(a.ordem) || 0) - (Number(b.ordem) || 0);
    });

    const prodCountEl = $("#prodCount");
    if (prodCountEl) prodCountEl.textContent = String(filtrados.length);
    if (!lista) return;
    if (!filtrados.length) {
        lista.innerHTML = `<div class="empty-adm"><i class="fa-solid fa-box-open"></i><p>Nenhum produto encontrado com esses filtros.</p></div>`;
        updateHeroSummary();
        return;
    }

    const labels = { LANCHE: "🍔 Lanches", BEBIDA: "🥤 Bebidas", PASTEL: "🥟 Pastéis", BATATA: "🍟 Batatas", PIZZA: "🍕 Pizzas", "CACHORRO QUENTE": "🌭 Cachorro-quente" };
    const grupos = filtrados.reduce((acc, produto) => {
        const key = produto.categoria || "OUTROS";
        if (!acc[key]) acc[key] = [];
        acc[key].push(produto);
        return acc;
    }, {});

    lista.innerHTML = Object.entries(grupos).map(([cat, items]) => `
        <div class="sec-div"><span>${labels[cat] || escapeHtml(cat)}</span></div>
        ${items.map((produto) => {
            const disponivel = produto.ativo === true;
            const removiveis = Array.isArray(produto.removiveis) && produto.removiveis.length
                ? `<span class="removiveis-preview"><i class="fa-solid fa-minus"></i>${escapeHtml(produto.removiveis.join(", "))}</span>`
                : "";
            // Imagem miniatura otimizada (se existir)
            const imagemMiniatura = produto.imagemUrl
                ? `<img src="${produto.imagemUrl.replace('/upload/', '/upload/w_48,f_webp,q_auto/')}" style="width:48px;height:48px;object-fit:contain;" loading="lazy" alt="${escapeHtml(produto.nome)}">`
                : escapeHtml(produto.emoji || "🍽️");
            return `
                <article class="prod-item" draggable="true" data-id="${produto.id}">
                    <div class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></div>
                    <div class="prod-emoji">${imagemMiniatura}</div>
                    <div class="prod-info">
                        <strong title="${escapeHtml(produto.nome || "")}">${escapeHtml(produto.nome || "Produto sem nome")}</strong>
                        <div class="prod-meta">
                            <span class="prod-price">${formatMoney(produto.preco)}</span>
                            <span class="prod-cat">${escapeHtml(produto.categoria || "Categoria")}</span>
                            ${!disponivel ? `<span class="indisponivel-badge"><i class="fa-solid fa-ban"></i>Indisponível</span>` : ""}
                            ${removiveis}
                        </div>
                    </div>
                    <div class="prod-actions">
                        <button class="btn-ic toggle-ativo ${!disponivel ? "indisponivel" : ""}" type="button" data-action="toggle-produto" data-id="${produto.id}"><i class="fa-solid ${disponivel ? "fa-box-open" : "fa-check"}"></i></button>
                        <button class="btn-ic edit" type="button" data-action="editar-produto" data-id="${produto.id}"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn-ic duplicate" type="button" data-action="duplicar-produto" data-id="${produto.id}"><i class="fa-solid fa-copy"></i></button>
                        <button class="btn-ic del" type="button" data-action="excluir-produto" data-id="${produto.id}"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </article>
            `;
        }).join("")}
    `).join("");

    bindDragAndDrop();
    updateHeroSummary();
}

function renderizarAdicionais() {
    const lista = $("#lista-adicionais");
    const busca = ($("#buscaAdicional")?.value || "").trim().toLowerCase();
    const adicionaisFiltrados = busca
        ? state.adicionais.filter((item) => String(item.nome || "").toLowerCase().includes(busca))
        : [...state.adicionais];
    
    const adicCountEl = $("#adicCount");
    if (adicCountEl) adicCountEl.textContent = String(adicionaisFiltrados.length);
    
    if (!lista) return;
    if (!adicionaisFiltrados.length) {
        lista.innerHTML = `<div class="empty-adm"><i class="fa-solid fa-circle-plus"></i><p>${busca ? "Nenhum adicional encontrado." : "Nenhum adicional cadastrado."}</p></div>`;
        updateHeroSummary();
        return;
    }
    lista.innerHTML = adicionaisFiltrados.map((item) => `
        <article class="adic-item">
            <div class="adic-em">${escapeHtml(item.emoji || "➕")}</div>
            <div class="adic-info-col"><strong>${escapeHtml(item.nome || "Adicional")}</strong><span>+ ${formatMoney(item.preco)}</span></div>
            <div class="prod-actions">
                <button class="btn-ic duplicate" type="button" data-action="duplicar-adicional" data-id="${item.id}"><i class="fa-solid fa-copy"></i></button>
                <button class="btn-ic edit" type="button" data-action="editar-adicional" data-id="${item.id}"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-ic del" type="button" data-action="excluir-adicional" data-id="${item.id}"><i class="fa-solid fa-trash"></i></button>
            </div>
        </article>
    `).join("");
    updateHeroSummary();
}

function renderizarBanners() {
    const lista = $("#lista-banners");
    const busca = ($("#buscaBanner")?.value || "").trim().toLowerCase();
    const bannersFiltrados = busca
        ? state.banners.filter((item) => `${item.titulo || ""} ${item.descricao || ""}`.toLowerCase().includes(busca))
        : [...state.banners];
    const bannerCountEl = $("#bannerCount");
    if (bannerCountEl) bannerCountEl.textContent = String(bannersFiltrados.length);
    if (!lista) return;
    if (!bannersFiltrados.length) {
        lista.innerHTML = `<div class="empty-adm"><i class="fa-solid fa-bullhorn"></i><p>${busca ? "Nenhum banner encontrado." : "Nenhum banner cadastrado."}</p></div>`;
        updateHeroSummary();
        return;
    }
    lista.innerHTML = bannersFiltrados.map((item) => `
        <article class="banner-item">
            <div class="banner-item-em">${escapeHtml(item.emoji || "📢")}</div>
            <div class="banner-info"><strong>${escapeHtml(item.titulo || "Banner")}</strong><span>${escapeHtml(item.descricao || "Sem descrição")}</span></div>
            <div class="prod-actions">
                <span class="banner-ativo-pill ${item.ativo ? "status-PRONTO" : "status-ENTREGUE"}">${item.ativo ? "Ativo" : "Inativo"}</span>
                <button class="btn-ic toggle-banner" type="button" data-action="toggle-banner" data-id="${item.id}"><i class="fa-solid ${item.ativo ? "fa-eye" : "fa-eye-slash"}"></i></button>
                <button class="btn-ic duplicate" type="button" data-action="duplicar-banner" data-id="${item.id}"><i class="fa-solid fa-copy"></i></button>
                <button class="btn-ic edit" type="button" data-action="editar-banner" data-id="${item.id}"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-ic del" type="button" data-action="excluir-banner" data-id="${item.id}"><i class="fa-solid fa-trash"></i></button>
            </div>
        </article>
    `).join("");
    updateHeroSummary();
}

function renderResumoPedidosStatus(pedidos) {
    const container = $("#pedidoStatusResumo");
    if (!container) return;
    const counts = { RECEBIDO: 0, PREPARO: 0, PRONTO: 0, ENTREGUE: 0, CANCELADO: 0 };
    pedidos.forEach((pedido) => {
        if (counts[pedido.status] !== undefined) counts[pedido.status] += 1;
    });
    container.innerHTML = `
        <div class="status-summary-card"><span>Recebidos</span><strong>${counts.RECEBIDO}</strong></div>
        <div class="status-summary-card"><span>Preparo</span><strong>${counts.PREPARO}</strong></div>
        <div class="status-summary-card"><span>Prontos</span><strong>${counts.PRONTO}</strong></div>
        <div class="status-summary-card"><span>Entregues</span><strong>${counts.ENTREGUE}</strong></div>
        <div class="status-summary-card"><span>Cancelados</span><strong>${counts.CANCELADO}</strong></div>
    `;
}

function parsePedidoItens(pedido) {
    if (pedido.itensJson) {
        try { return typeof pedido.itensJson === "string" ? JSON.parse(pedido.itensJson) : pedido.itensJson; }
        catch { return []; }
    }
    return Array.isArray(pedido.itens) ? pedido.itens : [];
}

function tocarNotificacaoNovoPedido() {
    try {
        const audio = new Audio("https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3");
        audio.play().catch(() => {});
    } catch {}
}

function notificarDesktop(pedidos) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    pedidos.forEach((pedido) => {
        new Notification(`Novo pedido #${pedido.id}`, { body: `${pedido.nomeCliente || "Cliente"} • ${formatMoney(pedido.total)}` });
    });
}

function renderizarPedidos() {
    let pedidosFiltrados = [...state.todosPedidos];
    if (state.filtroStatusPedidos !== "TODOS") pedidosFiltrados = pedidosFiltrados.filter((pedido) => pedido.status === state.filtroStatusPedidos);
    const busca = ($("#buscaPedido")?.value || "").trim().toLowerCase();
    if (busca) {
        pedidosFiltrados = pedidosFiltrados.filter((pedido) => {
            const base = `${pedido.id || ""} ${pedido.nomeCliente || ""} ${pedido.observacao || ""} ${pedido.status || ""}`.toLowerCase();
            return base.includes(busca);
        });
    }
    const receita = pedidosFiltrados.reduce((acc, pedido) => acc + (Number(pedido.total) || 0), 0);
    const pedidosQtdEl = $("#pedidos-qtd");
    if (pedidosQtdEl) pedidosQtdEl.textContent = String(pedidosFiltrados.length);
    const pedidosReceitaEl = $("#pedidos-receita");
    if (pedidosReceitaEl) pedidosReceitaEl.textContent = formatMoney(receita);
    renderResumoPedidosStatus(pedidosFiltrados);

    const novosIds = new Set(state.todosPedidos.map((pedido) => pedido.id));
    const novos = state.todosPedidos.filter((pedido) => !state.ultimosPedidosIds.has(pedido.id) && state.ultimosPedidosIds.size > 0);
    state.ultimosPedidosIds = novosIds;
    if (novos.length) {
        toast(`${novos.length} novo(s) pedido(s) recebido(s)!`, true);
        tocarNotificacaoNovoPedido();
        notificarDesktop(novos);
    }

    const lista = $("#lista-pedidos");
    if (!lista) return;
    if (!pedidosFiltrados.length) {
        lista.innerHTML = `<div class="empty-adm"><i class="fa-solid fa-receipt"></i><p>Nenhum pedido para este filtro.</p></div>`;
        updateHeroSummary();
        return;
    }

    lista.innerHTML = pedidosFiltrados.map((pedido) => {
        const itens = parsePedidoItens(pedido);
        const itensHtml = itens.map((item) => {
            const nome = item.nomeProduto || item.nome || item.name || "Produto";
            const quantidade = Number(item.quantidade || item.qtd || item.quantity || 1);
            const preco = Number(item.precoUnitario || item.preco || item.price || 0);
            const subtotal = quantidade * preco;
            const removidos = Array.isArray(item.removals || item.removidos) ? (item.removals || item.removidos) : [];
            const adicionais = Array.isArray(item.extras || item.adicionais) ? (item.extras || item.adicionais) : [];
            const observacao = item.observation || item.obs || "";
            const chips = [];
            if (removidos.length) chips.push(`<span class="mod-chip">🚫 Sem: ${escapeHtml(removidos.join(", "))}</span>`);
            adicionais.forEach((extra) => {
                const nomeExtra = typeof extra === "string" ? extra : extra.nome || "Extra";
                const precoExtra = typeof extra === "object" && extra?.preco ? ` (${formatMoney(extra.preco)})` : "";
                chips.push(`<span class="mod-chip">➕ ${escapeHtml(nomeExtra)}${escapeHtml(precoExtra)}</span>`);
            });
            if (observacao) chips.push(`<span class="mod-chip">💬 ${escapeHtml(observacao)}</span>`);
            return `
                <div>
                    <div class="pedido-item-linha"><span style="font-weight:800">${quantidade}x</span><span>${escapeHtml(nome)}</span><span style="margin-left:auto;font-weight:800">${formatMoney(subtotal)}</span></div>
                    ${chips.length ? `<div class="pedido-item-mods">${chips.join("")}</div>` : ""}
                </div>
            `;
        }).join("");

        return `
            <article class="pedido-card">
                <div class="pedido-top">
                    <div class="pedido-headline">
                        <span class="pedido-id">#${pedido.id}</span>
                        <span class="pedido-hora">${formatDateTime(pedido.criadoEm)}</span>
                        ${pedido.nomeCliente ? `<span class="pedido-client">${escapeHtml(pedido.nomeCliente)}</span>` : ""}
                    </div>
                    <div class="pedido-actions">
                        <span class="pedido-valor">${formatMoney(pedido.total)}</span>
                        <button class="status-badge status-${pedido.status}" type="button" data-action="avancar-status" data-id="${pedido.id}" data-status="${pedido.status}">${escapeHtml(STATUS_LABEL[pedido.status] || pedido.status || "Status")}</button>
                        <button class="btn-del-pedido" type="button" data-action="excluir-pedido" data-id="${pedido.id}"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="pedido-itens">${itensHtml}</div>
                ${pedido.observacao ? `<div class="pedido-obs">💬 ${escapeHtml(pedido.observacao)}</div>` : ""}
            </article>
        `;
    }).join("");
    updateHeroSummary();
}

async function carregarPedidos() {
    const url = state.filtroPedidos === "hoje" ? `${API_URL}/pedidos/loja/${LOJA_ID_NUM}/hoje` : `${API_URL}/pedidos/loja/${LOJA_ID_NUM}`;
    try {
        const response = await apiFetch(url);
        state.todosPedidos = response.ok ? await response.json() : [];
        renderizarPedidos();
        setLastSync("Pedidos atualizados");
    } catch {
        toast("Não foi possível atualizar os pedidos.", false);
    }
}

async function carregarDados() {
    updateTopbarStatus("Carregando painel");
    
    // Tenta usar cache primeiro
    const cache = obterAdminCache();
    if (cache) {
        state.todosProdutos = cache.produtos;
        state.adicionais = cache.adicionais;
        state.banners = cache.banners;
        renderizarProdutos();
        renderizarAdicionais();
        renderizarBanners();
        updateTopbarStatus("Dados do cache (rápido)");
    }
    
    try {
        const [statusRes, lojaRes, produtosRes, adicionaisRes, bannersRes] = await Promise.all([
            apiFetch(`${API_URL}/loja/${LOJA_SLUG}/status`),
            apiFetch(`${API_URL}/loja/${LOJA_SLUG}`),
            apiFetch(`${API_URL}/produtos/admin/loja/${LOJA_ID_NUM}`),
            apiFetch(`${API_URL}/adicionais/loja/${LOJA_ID_NUM}`),
            apiFetch(`${API_URL}/banners/admin/loja/${LOJA_ID_NUM}`)
        ]);

        state.lojaAberta = statusRes.ok ? await statusRes.json() : false;
        atualizarBotaoStatus();

        if (lojaRes.ok) {
            const loja = await lojaRes.json();
            $("#lojaWhatsapp").value = loja.whatsapp || "";
            $("#lojaMensagemFechado").value = loja.mensagemFechado || "";
            $("#horarioFuncionamento").value = loja.horarioFuncionamento || "";
        }

        state.todosProdutos = produtosRes.ok ? await produtosRes.json() : [];
        state.adicionais = adicionaisRes.ok ? await adicionaisRes.json() : [];
        state.banners = bannersRes.ok ? await bannersRes.json() : [];

        renderizarProdutos();
        renderizarAdicionais();
        renderizarBanners();
        await carregarPedidos();
        iniciarAutoRefresh();
        setLastSync("Painel sincronizado");
        
        // Atualiza cache após buscar da API
        salvarAdminCache(state.todosProdutos, state.adicionais, state.banners);
        return true;
    } catch (error) {
        console.error(error);
        toast("Erro ao carregar os dados da loja.", false);
        updateTopbarStatus("Falha ao sincronizar");
        return false;
    }
}

async function alternarStatus() {
    const btn = $("#btnStatus");
    toggleButtonLoading(btn, true, "Atualizando");
    try {
        const novoStatus = !state.lojaAberta;
        const response = await apiFetch(`${API_URL}/loja/status`, { method: "PUT", body: JSON.stringify(novoStatus) });
        if (!response.ok) throw new Error();
        state.lojaAberta = novoStatus;
        atualizarBotaoStatus();
        toast(`Loja ${novoStatus ? "aberta" : "fechada"} com sucesso.`, true);
    } catch {
        toast("Não foi possível alterar o status da loja.", false);
    } finally {
        toggleButtonLoading(btn, false, "");
    }
}

async function salvarConfigLoja() {
    const button = $("#btnSalvarConfig");
    toggleButtonLoading(button, true, "Salvando");
    try {
        const payload = {
            whatsapp: $("#lojaWhatsapp").value.trim(),
            mensagemFechado: $("#lojaMensagemFechado").value.trim(),
            horarioFuncionamento: $("#horarioFuncionamento").value.trim()
        };
        const response = await apiFetch(`${API_URL}/loja/${LOJA_SLUG}`, { method: "PUT", body: JSON.stringify(payload) });
        if (!response.ok) throw new Error();
        toast("Configurações salvas com sucesso.", true);
    } catch {
        toast("Erro ao salvar configurações da loja.", false);
    } finally {
        toggleButtonLoading(button, false, "");
    }
}

async function salvarProduto() {
    const nome = $("#nome").value.trim();
    const preco = Number($("#preco").value);
    const categoria = $("#categoria").value;
    const button = $("#btnSalvarProduto");
    if (!nome || Number.isNaN(preco)) return toast("Preencha nome e preço do produto.", false);
    toggleButtonLoading(button, true, "Salvando");
    try {
        let imagemUrl = $("#imagemUrl").value.trim();
        if (state.selectedImageFile) imagemUrl = await fazerUpload(state.selectedImageFile);
        const ordemAtual = state.edit.produtoId ? state.todosProdutos.find((produto) => produto.id === state.edit.produtoId)?.ordem || 0 : state.todosProdutos.length + 1;
        const payload = {
            nome,
            preco,
            categoria,
            ativo: $("#ativoProduto").value === "true",
            ordem: ordemAtual,
            descricao: $("#descricao").value.trim(),
            emoji: $("#emoji").value.trim() || emojiPorCategoria[categoria] || "🍽️",
            imagemUrl: imagemUrl || null,
            removiveis: state.currentRemoviveis,
            loja: { id: LOJA_ID_NUM }
        };
        const url = state.edit.produtoId ? `${API_URL}/produtos/${state.edit.produtoId}` : `${API_URL}/produtos`;
        const response = await apiFetch(url, { method: state.edit.produtoId ? "PUT" : "POST", body: JSON.stringify(payload) });
        if (!response.ok) throw new Error();
        toast(state.edit.produtoId ? "Produto atualizado." : "Produto cadastrado.", true);
        clearProdutoDraft();
        resetProdutoForm();
        await carregarDados();
    } catch (error) {
        toast(error?.message || "Erro ao salvar produto.", false);
    } finally {
        toggleButtonLoading(button, false, "");
    }
}

async function toggleAtivoProduto(id) {
    const produto = state.todosProdutos.find((item) => item.id === id);
    if (!produto) return;
    try {
        const response = await apiFetch(`${API_URL}/produtos/${id}`, { method: "PUT", body: JSON.stringify({ ...produto, ativo: produto.ativo !== true }) });
        if (!response.ok) throw new Error();
        toast(produto.ativo ? "Produto marcado como indisponível." : "Produto disponibilizado.", true);
        await carregarDados();
    } catch {
        toast("Não foi possível atualizar a disponibilidade do produto.", false);
    }
}

async function duplicarProduto(id) {
    const original = state.todosProdutos.find((item) => item.id === id);
    if (!original) return;
    try {
        const copia = { ...original, nome: `${original.nome} (cópia)`, ativo: true, ordem: state.todosProdutos.length + 1, loja: { id: LOJA_ID_NUM } };
        delete copia.id;
        const response = await apiFetch(`${API_URL}/produtos`, { method: "POST", body: JSON.stringify(copia) });
        if (!response.ok) throw new Error();
        toast("Produto duplicado com sucesso.", true);
        await carregarDados();
    } catch {
        toast("Erro ao duplicar produto.", false);
    }
}

async function excluirProduto(id) {
    if (!(await showConfirm("Excluir este produto do cardápio?"))) return;
    try {
        const response = await apiFetch(`${API_URL}/produtos/${id}`, { method: "DELETE" });
        if (!response.ok) throw new Error();
        toast("Produto removido.", true);
        await carregarDados();
    } catch {
        toast("Erro ao excluir produto.", false);
    }
}

async function salvarAdicional() {
    const nome = $("#adicNome").value.trim();
    const preco = Number($("#adicPreco").value);
    const button = $("#btnSalvarAdic");
    if (!nome || Number.isNaN(preco)) return toast("Preencha nome e preço do adicional.", false);
    toggleButtonLoading(button, true, "Salvando");
    try {
        const payload = { nome, preco, emoji: $("#adicEmoji").value.trim() || "➕", ativo: true, loja: { id: LOJA_ID_NUM } };
        const url = state.edit.adicionalId ? `${API_URL}/adicionais/${state.edit.adicionalId}` : `${API_URL}/adicionais`;
        const response = await apiFetch(url, { method: state.edit.adicionalId ? "PUT" : "POST", body: JSON.stringify(payload) });
        if (!response.ok) throw new Error();
        toast(state.edit.adicionalId ? "Adicional atualizado." : "Adicional cadastrado.", true);
        resetAdicionalForm();
        await carregarDados();
    } catch {
        toast("Erro ao salvar adicional.", false);
    } finally {
        toggleButtonLoading(button, false, "");
    }
}

async function excluirAdicional(id) {
    if (!(await showConfirm("Excluir este adicional?"))) return;
    try {
        const response = await apiFetch(`${API_URL}/adicionais/${id}`, { method: "DELETE" });
        if (!response.ok) throw new Error();
        toast("Adicional removido.", true);
        await carregarDados();
    } catch {
        toast("Erro ao excluir adicional.", false);
    }
}

async function duplicarAdicional(id) {
    const original = state.adicionais.find((item) => item.id === id);
    if (!original) return;
    try {
        const payload = { ...original, nome: `${original.nome} (cópia)`, loja: { id: LOJA_ID_NUM } };
        delete payload.id;
        const response = await apiFetch(`${API_URL}/adicionais`, { method: "POST", body: JSON.stringify(payload) });
        if (!response.ok) throw new Error();
        toast("Adicional duplicado.", true);
        await carregarDados();
    } catch {
        toast("Erro ao duplicar adicional.", false);
    }
}

async function salvarBanner() {
    const titulo = $("#bannerTitulo").value.trim();
    const button = $("#btnSalvarBanner");
    if (!titulo) return toast("Preencha o título do banner.", false);
    toggleButtonLoading(button, true, "Salvando");
    try {
        const payload = {
            titulo,
            descricao: $("#bannerDesc").value.trim(),
            cor: $("#bannerCor").value,
            emoji: $("#bannerEmoji").value.trim() || "🔥",
            ativo: $("#bannerAtivo").checked,
            loja: { id: LOJA_ID_NUM }
        };
        const url = state.edit.bannerId ? `${API_URL}/banners/${state.edit.bannerId}` : `${API_URL}/banners`;
        const response = await apiFetch(url, { method: state.edit.bannerId ? "PUT" : "POST", body: JSON.stringify(payload) });
        if (!response.ok) throw new Error();
        toast(state.edit.bannerId ? "Banner atualizado." : "Banner publicado.", true);
        resetBannerForm();
        await carregarDados();
    } catch {
        toast("Erro ao salvar banner.", false);
    } finally {
        toggleButtonLoading(button, false, "");
    }
}

async function toggleBanner(id) {
    const banner = state.banners.find((b) => b.id === id);
    if (!banner) return;
    const novoEstado = !banner.ativo;
    banner.ativo = novoEstado;
    renderizarBanners();
    try {
        const response = await apiFetch(`${API_URL}/banners/${id}/toggle`, { method: "PATCH" });
        if (!response.ok) throw new Error();
        toast(`Banner ${novoEstado ? "ativado" : "desativado"}.`, true);
        await carregarDados();
    } catch {
        banner.ativo = !novoEstado;
        renderizarBanners();
        toast("Erro ao atualizar banner.", false);
    }
}

async function duplicarBanner(id) {
    const original = state.banners.find((item) => item.id === id);
    if (!original) return;
    try {
        const payload = { ...original, titulo: `${original.titulo} (cópia)`, ativo: false, loja: { id: LOJA_ID_NUM } };
        delete payload.id;
        const response = await apiFetch(`${API_URL}/banners`, { method: "POST", body: JSON.stringify(payload) });
        if (!response.ok) throw new Error();
        toast("Banner duplicado.", true);
        await carregarDados();
    } catch {
        toast("Erro ao duplicar banner.", false);
    }
}

async function excluirBanner(id) {
    if (!(await showConfirm("Excluir este banner?"))) return;
    try {
        const response = await apiFetch(`${API_URL}/banners/${id}`, { method: "DELETE" });
        if (!response.ok) throw new Error();
        toast("Banner removido.", true);
        await carregarDados();
    } catch {
        toast("Erro ao excluir banner.", false);
    }
}

async function avancarStatus(id, statusAtual) {
    const proximo = STATUS_PROX[statusAtual];
    if (!proximo || proximo === statusAtual) return;
    try {
        const response = await apiFetch(`${API_URL}/pedidos/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: proximo }) });
        if (!response.ok) throw new Error();
        toast(`Pedido #${id} atualizado para ${STATUS_LABEL[proximo]}.`, true);
        await carregarPedidos();
    } catch {
        toast("Não foi possível atualizar o status do pedido.", false);
    }
}

async function excluirPedido(id) {
    if (!(await showConfirm("Remover este pedido?"))) return;
    try {
        const response = await apiFetch(`${API_URL}/pedidos/${id}`, { method: "DELETE" });
        if (!response.ok) throw new Error();
        toast("Pedido removido.", true);
        await carregarPedidos();
    } catch {
        toast("Erro ao excluir pedido.", false);
    }
}

function bindDragAndDrop() {
    $$(".prod-item").forEach((item) => {
        item.addEventListener("dragstart", handleDragStart);
        item.addEventListener("dragover", handleDragOver);
        item.addEventListener("dragenter", handleDragEnter);
        item.addEventListener("dragleave", handleDragLeave);
        item.addEventListener("drop", handleDrop);
        item.addEventListener("dragend", handleDragEnd);
    });
}

function handleDragStart(event) {
    const card = event.currentTarget;
    state.dragSourceId = Number(card.dataset.id);
    card.classList.add("dragging");
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", card.dataset.id);
    }
}

function handleDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function handleDragEnter(event) {
    event.preventDefault();
    const card = event.currentTarget;
    if (Number(card.dataset.id) !== state.dragSourceId) card.style.borderTop = "2px solid var(--primary)";
}

function handleDragLeave(event) {
    event.currentTarget.style.borderTop = "";
}

async function handleDrop(event) {
    event.preventDefault();
    const targetId = Number(event.currentTarget.dataset.id);
    event.currentTarget.style.borderTop = "";
    if (!state.dragSourceId || state.dragSourceId === targetId) return;
    await reorderProducts(state.dragSourceId, targetId);
}

function handleDragEnd(event) {
    event.currentTarget.classList.remove("dragging");
    $$(".prod-item").forEach((item) => {
        item.style.borderTop = "";
        item.classList.remove("dragging");
    });
    state.dragSourceId = null;
}

async function reorderProducts(sourceId, targetId) {
    const sourceIndex = state.todosProdutos.findIndex((item) => item.id === sourceId);
    const targetIndex = state.todosProdutos.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextProducts = [...state.todosProdutos];
    const [moved] = nextProducts.splice(sourceIndex, 1);
    nextProducts.splice(targetIndex, 0, moved);
    nextProducts.forEach((item, index) => { item.ordem = index + 1; });
    state.todosProdutos = nextProducts;
    renderizarProdutos();
    try {
        await Promise.all(nextProducts.map((produto) => apiFetch(`${API_URL}/produtos/${produto.id}`, { method: "PUT", body: JSON.stringify(produto) })));
        toast("Ordem dos produtos atualizada.", true);
    } catch {
        toast("Não foi possível salvar a nova ordem.", false);
        await carregarDados();
    }
}

function iniciarAutoRefresh() {
    clearInterval(state.countdownTimerId);
    clearInterval(state.refreshTimerId);
    state.refreshCountdown = REFRESH_INTERVAL;
    state.countdownTimerId = window.setInterval(() => {
        state.refreshCountdown -= 1;
        if (state.refreshCountdown <= 0) state.refreshCountdown = REFRESH_INTERVAL;
        const refreshLabel = $("#refreshLabel");
        if (refreshLabel) refreshLabel.textContent = `Atualiza em ${state.refreshCountdown}s`;
        updateHeroSummary();
    }, 1000);
    state.refreshTimerId = window.setInterval(async () => {
        state.refreshCountdown = REFRESH_INTERVAL;
        await carregarPedidos();
    }, REFRESH_INTERVAL * 1000);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}

function filtrarPedidos(scope) {
    state.filtroPedidos = scope;
    $$(".filtro-btn").forEach((button) => {
        button.classList.toggle("ativo", button.dataset.scope === scope);
        button.classList.toggle("inativo", button.dataset.scope !== scope);
    });
    carregarPedidos();
}

function filtrarPorStatus(status) {
    state.filtroStatusPedidos = status;
    $$(".status-filter-btn").forEach((button) => button.classList.toggle("active", button.dataset.status === status));
    renderizarPedidos();
}

async function initLogin() {
    const loginOverlay = $("#loginOverlay");
    const mainContent = $("#mainContent");
    const passwordInput = $("#accessPassword");
    const errorDiv = $("#loginError");
    const button = $("#loginButton");

    const unlock = async () => {
        const password = passwordInput.value.trim();
        if (!password) return void (errorDiv.textContent = "Digite a senha para continuar.");
        toggleButtonLoading(button, true, "Validando");
        errorDiv.textContent = "";
        const valido = await verificarSenha(password);
        toggleButtonLoading(button, false, "");
        if (!valido) {
            errorDiv.textContent = "Senha incorreta ou indisponibilidade na API.";
            passwordInput.value = "";
            passwordInput.focus();
            return;
        }
        sessionStorage.setItem("admin_authenticated", "true");
        sessionStorage.setItem("admin_key", password);
        loginOverlay.classList.add("hidden");
        mainContent.classList.add("visible");
        await carregarDados();
    };

    if (sessionStorage.getItem("admin_authenticated") === "true" && getAdminKey()) {
        loginOverlay.classList.add("hidden");
        mainContent.classList.add("visible");
        return carregarDados();
    }

    button.addEventListener("click", unlock);
    passwordInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") unlock();
    });
}

function bindEvents() {
    $("#btnStatus")?.addEventListener("click", alternarStatus);
    $("#btnRefreshAll")?.addEventListener("click", () => refreshAllData());
    $("#btnExportar")?.addEventListener("click", exportarPainel);
    $("#btnLogout")?.addEventListener("click", logout);
    $("#btnRefreshPedidos")?.addEventListener("click", carregarPedidos);
    $("#btnSalvarConfig")?.addEventListener("click", salvarConfigLoja);
    $("#btnSalvarProduto")?.addEventListener("click", salvarProduto);
    $("#btnCancelarProduto")?.addEventListener("click", resetProdutoForm);
    $("#btnLimparFiltrosProduto")?.addEventListener("click", () => {
        $("#filtroCategoria").value = "TODOS";
        $("#buscaProduto").value = "";
        $("#ordenarProdutos").value = "ordem";
        $("#mostrarIndisponiveis").checked = true;
        renderizarProdutos();
    });

    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    $("#buscaProduto")?.addEventListener('input', debounce(renderizarProdutos, 300));
    $("#buscaAdicional")?.addEventListener('input', debounce(renderizarAdicionais, 300));
    $("#buscaBanner")?.addEventListener('input', debounce(renderizarBanners, 300));
    $("#buscaPedido")?.addEventListener('input', debounce(renderizarPedidos, 300));
    $("#btnSalvarAdic")?.addEventListener("click", salvarAdicional);
    $("#adicCancelar")?.addEventListener("click", resetAdicionalForm);
    $("#btnSalvarBanner")?.addEventListener("click", salvarBanner);
    $("#bannerCancelar")?.addEventListener("click", resetBannerForm);
    $("#addTagBtn")?.addEventListener("click", addTagFromInput);
    $("#removiveisInput")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); addTagFromInput(); }
    });
    $("#tagsList")?.addEventListener("click", (event) => {
        const button = event.target.closest(".tag-remove");
        if (!button) return;
        const index = Number(button.dataset.index);
        if (Number.isNaN(index)) return;
        state.currentRemoviveis.splice(index, 1);
        renderTags();
        saveProdutoDraft();
    });
    $("#imagemFile")?.addEventListener("change", (event) => previewImagem(event.currentTarget));
    ["#nome", "#preco", "#emoji"].forEach((selector) => $(selector)?.addEventListener("input", updatePreview));
    ["#nome", "#descricao", "#preco", "#emoji", "#imagemUrl"].forEach((selector) => $(selector)?.addEventListener("input", saveProdutoDraft));
    $("#categoria")?.addEventListener("change", () => {
        autoEmojiPorCategoria();
        saveProdutoDraft();
    });
    $("#ativoProduto")?.addEventListener("change", saveProdutoDraft);
    $("#imagemUrl")?.addEventListener("input", syncImagePreviewFromUrl);
    $("#filtroCategoria")?.addEventListener("change", renderizarProdutos);
    $("#buscaProduto")?.addEventListener("input", renderizarProdutos);
    $("#ordenarProdutos")?.addEventListener("change", renderizarProdutos);
    $("#mostrarIndisponiveis")?.addEventListener("change", renderizarProdutos);
    $("#buscaAdicional")?.addEventListener("input", renderizarAdicionais);
    $("#buscaBanner")?.addEventListener("input", renderizarBanners);
    $("#buscaPedido")?.addEventListener("input", renderizarPedidos);
    $$(".filtro-btn").forEach((button) => button.addEventListener("click", () => filtrarPedidos(button.dataset.scope)));
    $$(".status-filter-btn").forEach((button) => button.addEventListener("click", () => filtrarPorStatus(button.dataset.status)));

    $("#lista-produtos-admin")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const action = button.dataset.action;
        const id = Number(button.dataset.id);
        const produto = state.todosProdutos.find((item) => item.id === id);
        if (action === "editar-produto" && produto) preencherProdutoForm(produto);
        if (action === "toggle-produto") toggleAtivoProduto(id);
        if (action === "duplicar-produto") duplicarProduto(id);
        if (action === "excluir-produto") excluirProduto(id);
    });

    $("#lista-adicionais")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const action = button.dataset.action;
        const id = Number(button.dataset.id);
        const item = state.adicionais.find((entry) => entry.id === id);
        if (action === "editar-adicional" && item) preencherAdicionalForm(item);
        if (action === "duplicar-adicional") duplicarAdicional(id);
        if (action === "excluir-adicional") excluirAdicional(id);
    });

    $("#lista-banners")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const action = button.dataset.action;
        const id = Number(button.dataset.id);
        const item = state.banners.find((entry) => entry.id === id);
        if (action === "editar-banner" && item) preencherBannerForm(item);
        if (action === "toggle-banner") toggleBanner(id);
        if (action === "duplicar-banner") duplicarBanner(id);
        if (action === "excluir-banner") excluirBanner(id);
    });

    $("#lista-pedidos")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const action = button.dataset.action;
        const id = Number(button.dataset.id);
        const status = button.dataset.status;
        if (action === "avancar-status") avancarStatus(id, status);
        if (action === "excluir-pedido") excluirPedido(id);
    });

    window.addEventListener("beforeunload", () => {
        clearInterval(state.countdownTimerId);
        clearInterval(state.refreshTimerId);
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    resetProdutoForm();
    resetAdicionalForm();
    resetBannerForm();
    restoreProdutoDraft();
    renderTags();
    updatePreview();
    await initLogin();
});