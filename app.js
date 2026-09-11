/* ===========================================================
   Fin Controller — lógica principal
   Armazenamento: IndexedDB (com cache em memória síncrona,
   necessário para funcionar corretamente como PWA instalado).
=========================================================== */

const DB_NAME = "fin-controller-db";
const DB_VERSION = 1;
const STORE = "state";
const STATE_KEY = "app-state";

const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

const GROUP_COLORS = ["#e8a0bb", "#b39ddb", "#e0c097", "#e8918a", "#8fc9d6", "#c9b3e8", "#9ed6b0", "#e8c1e0"];

let categoryFormColor = GROUP_COLORS[0]; // cor selecionada no formulário de nova categoria

let db = null;
let cache = null; // in-memory mirror of state, always source of truth for rendering
let current = new Date();
let currentYM = ymKey(current);
let activeTab = "tab-dashboard";

function ymKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function groupColor(index) {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

function defaultState() {
  return {
    groups: [],           // [{id, name, isCard}]
    items: [],             // [{id, groupId, name, type, fixedValue?, card?, installmentValue?, installments?, startYm?, categoryId?}]
    categories: [],         // [{id, name, color}]
    monthlyValues: {},     // { "itemId|YYYY-MM": number }  (overrides for tipo variável/fixo)
    monthlyIncome: {},     // { "YYYY-MM": number }
    extraIncome: {},       // { "YYYY-MM": [{id, desc, value}] }
    seeded: false           // whether the starter groups have been created yet
  };
}

/* Starter groups: vazio de propósito — o app abre sem nenhum grupo
   pré-cadastrado. O usuário cria os grupos que quiser pelo botão "+"
   na barra de baixo. */
const STARTER_GROUPS = [];

function seedStarterGroups() {
  STARTER_GROUPS.forEach((g) => {
    const groupId = uid();
    cache.groups.push({ id: groupId, name: g.name, isCard: !!g.isCard });
    (g.items || []).forEach((itemName) => {
      cache.items.push({ id: uid(), groupId, name: itemName, type: "variavel" });
    });
  });
  cache.seeded = true;
}

/* ---------------- IndexedDB layer ---------------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains(STORE)) {
        _db.createObjectStore(STORE);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e);
  });
}

function loadState() {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.get(STATE_KEY);
    req.onsuccess = () => {
      resolve(req.result || defaultState());
    };
    req.onerror = () => resolve(defaultState());
  });
}

function persist() {
  if (!db) return;
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(cache, STATE_KEY);
}

/* ---------------- Helpers ---------------- */

function fmtMoney(n) {
  n = Number(n) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtMonthLabel(d) {
  const m = MESES[d.getMonth()];
  return `${m.charAt(0).toUpperCase() + m.slice(1)} ${d.getFullYear()}`;
}

function findItem(itemId) {
  return cache.items.find((i) => i.id === itemId);
}

function monthDiff(ymA, ymB) {
  const [ya, ma] = ymA.split("-").map(Number);
  const [yb, mb] = ymB.split("-").map(Number);
  return (ya - yb) * 12 + (ma - mb);
}

/* getValue lida com os 3 tipos de item:
   - variavel: valor lançado mês a mês (comportamento original)
   - fixo: repete um valor padrão todo mês, mas pode ser sobrescrito num mês específico
   - parcelado: calculado automaticamente a partir do mês/valor/nº de parcelas, sem edição manual */
function getValue(itemId, ym) {
  const item = findItem(itemId);
  if (!item) return null;

  if (item.type === "parcelado") {
    if (!item.startYm || !item.installments) return null;
    const idx = monthDiff(ym, item.startYm);
    if (idx < 0 || idx >= Number(item.installments)) return null;
    return Number(item.installmentValue) || 0;
  }

  const override = cache.monthlyValues[`${itemId}|${ym}`];
  if (override !== undefined && override !== null && override !== "") {
    return Number(override);
  }

  if (item.type === "fixo" && item.fixedValue !== undefined && item.fixedValue !== null && item.fixedValue !== "") {
    return Number(item.fixedValue);
  }

  return null;
}

function setValue(itemId, ym, val) {
  const key = `${itemId}|${ym}`;
  if (val === "" || val === null || isNaN(val)) {
    delete cache.monthlyValues[key];
  } else {
    cache.monthlyValues[key] = Number(val);
  }
  persist();
}

function groupTotal(groupId, ym) {
  return cache.items
    .filter((it) => it.groupId === groupId)
    .reduce((sum, it) => sum + (getValue(it.id, ym) || 0), 0);
}

function monthExpenseTotal(ym) {
  return cache.items.reduce((sum, it) => sum + (getValue(it.id, ym) || 0), 0);
}

function monthIncomeTotal(ym) {
  const base = Number(cache.monthlyIncome[ym]) || 0;
  const extras = (cache.extraIncome[ym] || []).reduce((s, e) => s + Number(e.value || 0), 0);
  return base + extras;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- Rendering: shared ---------------- */

function render() {
  currentYM = ymKey(current);
  document.getElementById("monthLabel").textContent = fmtMonthLabel(current);

  renderNav();
  renderGroupPanels();
  renderDashboard();
  applyActiveTab();
}

function applyActiveTab() {
  // if the active tab no longer exists (group deleted), fall back to dashboard
  const exists = document.getElementById(activeTab);
  if (!exists) activeTab = "tab-dashboard";

  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === activeTab);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tab") === activeTab);
  });
}

function switchTab(tabId) {
  activeTab = tabId;
  applyActiveTab();
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ---------------- Rendering: bottom nav ---------------- */

function renderNav() {
  const nav = document.getElementById("bottomNav");
  nav.innerHTML = "";

  const home = document.createElement("button");
  home.className = "nav-btn";
  home.setAttribute("data-tab", "tab-dashboard");
  home.innerHTML = `<span class="nav-icon">⌂</span><span class="nav-label">Início</span>`;
  home.addEventListener("click", () => switchTab("tab-dashboard"));
  nav.appendChild(home);

  cache.groups.forEach((g, idx) => {
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.setAttribute("data-tab", `group-${g.id}`);
    const label = g.name.length > 10 ? g.name.slice(0, 9) + "…" : g.name;
    btn.innerHTML = `<span class="nav-dot" style="background:${groupColor(idx)}"></span><span class="nav-label">${escapeHtml(label)}</span>`;
    btn.addEventListener("click", () => switchTab(`group-${g.id}`));
    nav.appendChild(btn);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "nav-btn nav-add";
  addBtn.innerHTML = `<span class="nav-icon">+</span><span class="nav-label">Grupo</span>`;
  addBtn.addEventListener("click", openGroupModal);
  nav.appendChild(addBtn);
}

/* ---------------- Rendering: dashboard ---------------- */

function renderDashboard() {
  const income = monthIncomeTotal(currentYM);
  const expense = monthExpenseTotal(currentYM);
  const saldo = income - expense;

  const heroVal = document.getElementById("heroValue");
  heroVal.textContent = fmtMoney(saldo);
  heroVal.className = "hero-value display " + (saldo < 0 ? "negative" : "positive");

  document.getElementById("incomeTotalDisplay").textContent = fmtMoney(income);
  document.getElementById("expenseTotalDisplay").textContent = fmtMoney(expense);

  const incomeInput = document.getElementById("monthlyIncomeInput");
  if (document.activeElement !== incomeInput) {
    const baseIncome = cache.monthlyIncome[currentYM];
    incomeInput.value = baseIncome === undefined ? "" : baseIncome;
  }

  renderExtras();
  renderDonut(expense);
  renderGroupCards();
  renderHistory();
}

function renderExtras() {
  const list = document.getElementById("extraList");
  list.innerHTML = "";
  const extras = cache.extraIncome[currentYM] || [];
  extras.forEach((ex) => {
    const row = document.createElement("div");
    row.className = "extra-item";
    row.innerHTML = `
      <span class="desc">${escapeHtml(ex.desc)}</span>
      <span class="val">${fmtMoney(ex.value)}</span>
      <button class="tiny-x" data-extra="${ex.id}" aria-label="Remover">✕</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll("[data-extra]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-extra");
      cache.extraIncome[currentYM] = (cache.extraIncome[currentYM] || []).filter((e) => e.id !== id);
      persist();
      renderDashboard();
      toast("Entrada removida");
    });
  });
}

function renderDonut(expenseTotal) {
  const wrap = document.getElementById("donutWrap");
  wrap.innerHTML = "";

  const data = cache.groups
    .map((g, idx) => ({ name: g.name, total: groupTotal(g.id, currentYM), color: groupColor(idx) }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);

  if (data.length === 0) {
    wrap.innerHTML = `<p class="empty-hint">Nenhum gasto lançado neste mês ainda.</p>`;
    return;
  }

  let acc = 0;
  const stops = data.map((g) => {
    const pct = (g.total / expenseTotal) * 100;
    const start = acc;
    acc += pct;
    return `${g.color} ${start}% ${acc}%`;
  }).join(", ");

  const row = document.createElement("div");
  row.className = "donut-row";
  row.innerHTML = `
    <div class="donut" style="background:conic-gradient(${stops})">
      <div class="donut-hole">
        <span class="dh-label">Total</span>
        <span class="dh-value">${fmtMoney(expenseTotal)}</span>
      </div>
    </div>
    <div class="donut-legend">
      ${data.map((g) => `
        <div class="legend-row">
          <span class="legend-dot" style="background:${g.color}"></span>
          <span class="legend-name">${escapeHtml(g.name)}</span>
          <span class="legend-pct">${((g.total / expenseTotal) * 100).toFixed(0)}%</span>
        </div>
      `).join("")}
    </div>
  `;
  wrap.appendChild(row);
}

function renderGroupCards() {
  const wrap = document.getElementById("groupCardsWrap");
  wrap.innerHTML = "";

  if (cache.groups.length === 0) {
    wrap.innerHTML = `<p class="empty-hint">Nenhum grupo criado ainda. Toque em "+" na barra de baixo.</p>`;
    return;
  }

  cache.groups.forEach((g, idx) => {
    const total = groupTotal(g.id, currentYM);
    const card = document.createElement("button");
    card.className = "group-mini-card";
    card.innerHTML = `
      <div class="gm-name"><span class="nav-dot" style="background:${groupColor(idx)};margin:0;"></span>${escapeHtml(g.name)}</div>
      <div class="gm-value">${fmtMoney(total)}</div>
    `;
    card.addEventListener("click", () => switchTab(`group-${g.id}`));
    wrap.appendChild(card);
  });
}

function renderHistory() {
  const wrap = document.getElementById("historyWrap");
  wrap.innerHTML = "";

  /* Antes, os meses do histórico eram descobertos varrendo apenas chaves
     já salvas (renda, extras, lançamentos). Isso deixava de fora meses em
     que a única movimentação era um item fixo ou parcelado (calculados na
     hora, sem gravar chave nenhuma) — por isso o gasto "sumia" do
     histórico em meses futuros. Agora o período é sempre os 6 meses
     terminando no mês atual, calculados diretamente pela data, então
     fixos e parcelados aparecem corretamente. */
  const sorted = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(current.getFullYear(), current.getMonth() - i, 1);
    sorted.push(ymKey(d));
  }

  sorted.forEach((ym) => {
    const [y, m] = ym.split("-").map(Number);
    const saldo = monthIncomeTotal(ym) - monthExpenseTotal(ym);
    const row = document.createElement("div");
    row.className = "history-row";
    row.innerHTML = `
      <span class="hm">${MESES[m - 1]} de ${y}</span>
      <span class="hv ${saldo < 0 ? "negative" : "positive"}">${fmtMoney(saldo)}</span>
    `;
    wrap.appendChild(row);
  });
}

/* ---------------- Rendering: group tab panels ---------------- */

function renderGroupPanels() {
  const wrap = document.getElementById("groupPanelsWrap");
  wrap.innerHTML = "";

  cache.groups.forEach((g, idx) => {
    const items = cache.items.filter((it) => it.groupId === g.id);
    const total = groupTotal(g.id, currentYM);

    const panel = document.createElement("section");
    panel.className = "tab-panel";
    panel.id = `group-${g.id}`;

    panel.innerHTML = `
      <div class="group-panel-header">
        <span class="gph-title"><span class="nav-dot" style="background:${groupColor(idx)};margin:0;"></span>${escapeHtml(g.name)}</span>
        <span class="gph-total">${fmtMoney(total)}</span>
      </div>
      <div class="group-panel-actions">
        <button class="link-btn" data-rename="${g.id}">renomear grupo</button>
        <button class="link-btn" data-delete-group="${g.id}" style="color:var(--coral);">excluir grupo</button>
      </div>
      <div class="card">
        <div id="items-${g.id}"></div>
        <button class="link-btn" data-add-item="${g.id}">+ ${g.isCard ? "adicionar compra" : "adicionar item"}</button>
      </div>
    `;

    wrap.appendChild(panel);

    const itemsWrap = panel.querySelector(`#items-${g.id}`);
    if (items.length === 0) {
      itemsWrap.innerHTML = `<p class="empty-hint">${g.isCard ? "Nenhuma compra lançada neste cartão ainda." : "Sem itens neste grupo ainda."}</p>`;
    } else {
      items.forEach((it) => {
        const val = getValue(it.id, currentYM);
        const row = document.createElement("div");
        row.className = "item-row item-row-rich";

        const tags = [];
        if (g.isCard && it.card) tags.push(`<span class="item-tag tag-card">${escapeHtml(it.card)}</span>`);
        if (it.type === "fixo") tags.push(`<span class="item-tag tag-fixo">fixo</span>`);
        if (it.type === "parcelado") {
          const idx = it.startYm ? monthDiff(currentYM, it.startYm) : -1;
          const label = (idx >= 0 && idx < it.installments) ? `${idx + 1}/${it.installments}` : `${it.installments}x`;
          tags.push(`<span class="item-tag tag-parcelado">parcela ${label}</span>`);
        }
        if (it.categoryId) {
          const cat = cache.categories.find((c) => c.id === it.categoryId);
          if (cat) tags.push(`<span class="item-tag" style="background:${cat.color}2e;color:${cat.color};">${escapeHtml(cat.name)}</span>`);
        }

        const nameCol = `
          <button class="iname-btn" data-edit-item="${it.id}">
            <span class="iname">${escapeHtml(it.name)}</span>
            ${tags.length ? `<span class="item-tags">${tags.join("")}</span>` : ""}
          </button>
        `;

        let valueCol;
        if (it.type === "parcelado") {
          valueCol = `<span class="ival-static ${val === null ? "muted" : ""}">${val === null ? "—" : fmtMoney(val)}</span>`;
        } else {
          valueCol = `
            <span class="ival-wrap">
              <input type="number" inputmode="decimal" placeholder="${it.type === "fixo" && it.fixedValue ? Number(it.fixedValue).toFixed(2) : "0,00"}" step="0.01"
                value="${val === null ? "" : val}" data-item="${it.id}">
            </span>
          `;
        }

        row.innerHTML = `
          ${nameCol}
          ${valueCol}
          <button class="tiny-x" data-del-item="${it.id}" aria-label="Remover item">✕</button>
        `;
        itemsWrap.appendChild(row);
      });
    }

    panel.querySelectorAll("input[data-item]").forEach((inp) => {
      inp.addEventListener("input", () => {
        setValue(inp.getAttribute("data-item"), currentYM, inp.value);
        updateTotalsLive();
      });
    });
    panel.querySelectorAll("[data-del-item]").forEach((btn) => {
      btn.addEventListener("click", () => confirmDeleteItem(btn.getAttribute("data-del-item")));
    });
    panel.querySelectorAll("[data-edit-item]").forEach((btn) => {
      btn.addEventListener("click", () => openItemModal(g.id, btn.getAttribute("data-edit-item")));
    });
    panel.querySelector("[data-add-item]").addEventListener("click", () => openItemModal(g.id));
    panel.querySelector("[data-rename]").addEventListener("click", () => openRenameGroupModal(g.id));
    panel.querySelector("[data-delete-group]").addEventListener("click", () => confirmDeleteGroup(g.id));
  });
}

function updateTotalsLive() {
  // lightweight refresh of numbers without losing input focus
  const income = monthIncomeTotal(currentYM);
  const expense = monthExpenseTotal(currentYM);
  const saldo = income - expense;
  const heroVal = document.getElementById("heroValue");
  heroVal.textContent = fmtMoney(saldo);
  heroVal.className = "hero-value display " + (saldo < 0 ? "negative" : "positive");
  document.getElementById("expenseTotalDisplay").textContent = fmtMoney(expense);

  cache.groups.forEach((g) => {
    const panel = document.getElementById(`group-${g.id}`);
    if (panel) {
      const totalEl = panel.querySelector(".gph-total");
      if (totalEl) totalEl.textContent = fmtMoney(groupTotal(g.id, currentYM));
    }
  });

  renderDonut(expense);
  renderGroupCards();
}

/* ---------------- Toast ---------------- */

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------------- Modals ---------------- */

function openModal(title, fieldsHtml, onConfirm, opts = {}) {
  const backdrop = document.getElementById("modalBackdrop");
  const box = document.getElementById("modalBox");
  box.innerHTML = `
    <h3>${title}</h3>
    <div id="modalFields">${fieldsHtml}</div>
    <div class="modal-actions">
      <button class="modal-cancel" id="modalCancelBtn">Cancelar</button>
      <button class="modal-confirm ${opts.danger ? "modal-danger" : ""}" id="modalConfirmBtn">${opts.confirmLabel || "Salvar"}</button>
    </div>
  `;
  backdrop.classList.add("open");

  const close = () => backdrop.classList.remove("open");
  document.getElementById("modalCancelBtn").onclick = close;
  document.getElementById("modalConfirmBtn").onclick = () => {
    const ok = onConfirm();
    if (ok !== false) close();
  };
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };

  setTimeout(() => {
    const firstInput = box.querySelector("input");
    if (firstInput) firstInput.focus();
  }, 50);
}

function openGroupModal() {
  openModal(
    "Novo grupo",
    `<div class="field"><label>Nome do grupo</label><input type="text" id="fGroupName" placeholder="Ex: Moradia, Saúde, Cartão..."></div>
     <label class="checkbox-row">
       <input type="checkbox" id="fGroupIsCard">
       <span>Este grupo é de cartão de crédito</span>
     </label>
     <p class="empty-hint" style="margin-top:6px;">Marcando isso, cada item vira uma compra: você diz o cartão e se é única ou parcelada.</p>`,
    () => {
      const name = document.getElementById("fGroupName").value.trim();
      if (!name) { toast("Dê um nome ao grupo"); return false; }
      const isCard = document.getElementById("fGroupIsCard").checked;
      const newId = uid();
      cache.groups.push({ id: newId, name, isCard });
      persist();
      render();
      switchTab(`group-${newId}`);
      toast("Grupo criado");
    }
  );
}

function openRenameGroupModal(groupId) {
  const g = cache.groups.find((x) => x.id === groupId);
  if (!g) return;
  openModal(
    "Editar grupo",
    `<div class="field"><label>Nome do grupo</label><input type="text" id="fGroupRename" value="${escapeHtml(g.name)}"></div>
     <label class="checkbox-row">
       <input type="checkbox" id="fGroupRenameIsCard" ${g.isCard ? "checked" : ""}>
       <span>Este grupo é de cartão de crédito</span>
     </label>`,
    () => {
      const name = document.getElementById("fGroupRename").value.trim();
      if (!name) { toast("Dê um nome ao grupo"); return false; }
      g.name = name;
      g.isCard = document.getElementById("fGroupRenameIsCard").checked;
      persist();
      render();
      switchTab(`group-${groupId}`);
      toast("Grupo atualizado");
    }
  );
}

/* ---------------- Categorias: criar / editar / excluir ---------------- */

function colorSwatchesHtml(selected) {
  return GROUP_COLORS.map((c) => `
    <span class="color-swatch" data-color="${c}" style="display:inline-block;width:24px;height:24px;border-radius:50%;background:${c};margin:3px 5px 3px 0;cursor:pointer;border:2px solid ${c === selected ? "var(--text)" : "transparent"};"></span>
  `).join("");
}

/* Renderiza os círculos de cor num container e liga os cliques,
   religando de novo a cada escolha (já que o HTML é substituído). */
function renderCatSwatches(containerId, getSelected, onPick) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = colorSwatchesHtml(getSelected());
  container.querySelectorAll("[data-color]").forEach((sw) => {
    sw.addEventListener("click", () => {
      onPick(sw.getAttribute("data-color"));
      renderCatSwatches(containerId, getSelected, onPick);
    });
  });
}

function categoryRowsHtml() {
  if (!cache.categories.length) {
    return `<p class="empty-hint" style="margin:0 0 14px;">Nenhuma categoria criada ainda.</p>`;
  }
  return cache.categories.map((c) => `
    <div class="item-row" style="justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border);">
      <span class="iname" style="display:flex;align-items:center;gap:8px;color:var(--text);white-space:normal;">
        <span style="width:9px;height:9px;border-radius:50%;background:${c.color};display:inline-block;flex-shrink:0;"></span>
        ${escapeHtml(c.name)}
      </span>
      <span style="display:flex;gap:4px;flex-shrink:0;">
        <button type="button" class="link-btn" data-edit-cat="${c.id}" style="padding:2px 8px;">editar</button>
        <button type="button" class="link-btn" data-del-cat="${c.id}" style="padding:2px 8px;color:var(--coral);">excluir</button>
      </span>
    </div>
  `).join("");
}

function wireCatListEvents() {
  const box = document.getElementById("modalBox");
  box.querySelectorAll("[data-edit-cat]").forEach((btn) => {
    btn.addEventListener("click", () => openRenameCategoryModal(btn.getAttribute("data-edit-cat")));
  });
  box.querySelectorAll("[data-del-cat]").forEach((btn) => {
    btn.addEventListener("click", () => confirmDeleteCategory(btn.getAttribute("data-del-cat")));
  });
}

function openCategoryManagerModal() {
  categoryFormColor = GROUP_COLORS[cache.categories.length % GROUP_COLORS.length];
  openModal(
    "Gerenciar categorias",
    `<div id="catListArea">${categoryRowsHtml()}</div>
     <div class="field"><label>Nova categoria</label><input type="text" id="fNewCatName" placeholder="Ex: Farmácia, Mercado..."></div>
     <div class="field">
       <label>Cor</label>
       <div id="catColorSwatches"></div>
     </div>
     <button type="button" class="link-btn" id="addCategoryBtn">+ adicionar categoria</button>`,
    () => {}, // botão principal só fecha; criar/editar/excluir tem seus próprios botões
    { confirmLabel: "Fechar" }
  );
  wireCatListEvents();
  renderCatSwatches("catColorSwatches", () => categoryFormColor, (c) => { categoryFormColor = c; });
  document.getElementById("addCategoryBtn").addEventListener("click", addCategoryFromForm);
}

function addCategoryFromForm() {
  const nameInput = document.getElementById("fNewCatName");
  const name = nameInput.value.trim();
  if (!name) { toast("Dê um nome à categoria"); return; }
  cache.categories.push({ id: uid(), name, color: categoryFormColor });
  persist();
  toast("Categoria criada");
  nameInput.value = "";
  const area = document.getElementById("catListArea");
  if (area) { area.innerHTML = categoryRowsHtml(); wireCatListEvents(); }
  render();
}

function openRenameCategoryModal(catId) {
  const cat = cache.categories.find((c) => c.id === catId);
  if (!cat) return;
  let localColor = cat.color;
  openModal(
    "Editar categoria",
    `<div class="field"><label>Nome</label><input type="text" id="fCatRename" value="${escapeHtml(cat.name)}"></div>
     <div class="field"><label>Cor</label><div id="editCatColorSwatches"></div></div>`,
    () => {
      const name = document.getElementById("fCatRename").value.trim();
      if (!name) { toast("Dê um nome à categoria"); return false; }
      cat.name = name;
      cat.color = localColor;
      persist();
      render();
      toast("Categoria atualizada");
    },
    { confirmLabel: "Salvar" }
  );
  renderCatSwatches("editCatColorSwatches", () => localColor, (c) => { localColor = c; });
}

function confirmDeleteCategory(catId) {
  const cat = cache.categories.find((c) => c.id === catId);
  if (!cat) return;
  openModal(
    `Excluir categoria "${cat.name}"?`,
    `<p style="color:var(--muted);font-size:0.88rem;line-height:1.5;">Os itens que usam essa categoria voltam a ficar sem categoria. Essa ação não pode ser desfeita.</p>`,
    () => {
      cache.items.forEach((it) => { if (it.categoryId === catId) it.categoryId = null; });
      cache.categories = cache.categories.filter((c) => c.id !== catId);
      persist();
      render();
      toast("Categoria excluída");
    },
    { confirmLabel: "Excluir", danger: true }
  );
}

/* ---- Item modal: cobre criação e edição, com os 3 tipos e o campo de cartão ---- */

function monthLabelFromYm(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${MESES[m - 1]} de ${y}`;
}

function typeFieldsHtml(type, existing) {
  if (type === "fixo") {
    return `<div class="field"><label>Valor fixo mensal</label><input type="number" step="0.01" id="fItemFixed" placeholder="0,00" value="${existing && existing.fixedValue != null ? existing.fixedValue : ""}"></div>
      <p class="empty-hint" style="margin-top:-6px;">Esse valor se repete todo mês sozinho. Dá pra mudar em um mês específico direto na lista, sem afetar os outros.</p>`;
  }
  if (type === "parcelado") {
    const startLabel = existing && existing.startYm ? monthLabelFromYm(existing.startYm) : monthLabelFromYm(currentYM);
    return `
      <div class="field"><label>Valor da parcela</label><input type="number" step="0.01" id="fItemInstallVal" placeholder="0,00" value="${existing && existing.installmentValue != null ? existing.installmentValue : ""}"></div>
      <div class="field"><label>Número de parcelas</label><input type="number" min="1" step="1" id="fItemInstallCount" placeholder="Ex: 10" value="${existing && existing.installments ? existing.installments : ""}"></div>
      <p class="empty-hint" style="margin-top:-6px;">1ª parcela em ${startLabel}. As parcelas seguintes aparecem sozinhas nos próximos meses.</p>
    `;
  }
  return `<p class="empty-hint" style="margin:0;">O valor é lançado mês a mês, direto na lista do grupo.</p>`;
}

function openItemModal(groupId, itemId) {
  const group = cache.groups.find((g) => g.id === groupId);
  if (!group) return;
  const existing = itemId ? findItem(itemId) : null;
  let selectedType = existing ? existing.type : "variavel";

  const cardOptions = Array.from(new Set(
    cache.items.filter((i) => i.groupId === groupId && i.card).map((i) => i.card)
  ));
  const suggested = ["Santander", "Porto", "Mercado Pago", "Inter"].filter((c) => !cardOptions.includes(c));
  const allCardOptions = [...cardOptions, ...suggested];

  const cardField = group.isCard ? `
    <div class="field">
      <label>Cartão</label>
      <input type="text" id="fItemCard" list="cardSuggestions" placeholder="Ex: Santander" value="${existing && existing.card ? escapeHtml(existing.card) : ""}">
      <datalist id="cardSuggestions">
        ${allCardOptions.map((c) => `<option value="${escapeHtml(c)}">`).join("")}
      </datalist>
    </div>
  ` : "";

  const fieldsHtml = `
    <div class="field"><label>${group.isCard ? "Descrição da compra" : "Nome do item"}</label>
      <input type="text" id="fItemName" placeholder="${group.isCard ? "Ex: Notebook, Mercado..." : "Ex: Luz, Mercado, Prestação..."}" value="${existing ? escapeHtml(existing.name) : ""}"></div>
    ${cardField}
    <div class="field">
      <label>Tipo</label>
      <div class="type-toggle" id="typeToggle">
        <button type="button" class="type-opt${selectedType === "variavel" ? " active" : ""}" data-type="variavel">Variável</button>
        <button type="button" class="type-opt${selectedType === "fixo" ? " active" : ""}" data-type="fixo">Fixo</button>
        <button type="button" class="type-opt${selectedType === "parcelado" ? " active" : ""}" data-type="parcelado">Parcelado</button>
      </div>
    </div>
    <div id="typeFieldsWrap">${typeFieldsHtml(selectedType, existing)}</div>
    <div class="field">
      <label>Categoria <span style="color:var(--muted);font-weight:400;">(opcional)</span></label>
      <select id="fItemCategory">
        <option value="">Nenhuma</option>
        ${cache.categories.map((c) => `<option value="${c.id}" ${existing && existing.categoryId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
      </select>
    </div>
  `;

  openModal(
    existing ? "Editar item" : (group.isCard ? "Nova compra" : "Novo item"),
    fieldsHtml,
    () => {
      const name = document.getElementById("fItemName").value.trim();
      if (!name) { toast("Dê um nome"); return false; }

      const catVal = document.getElementById("fItemCategory").value;
      const payload = { name, type: selectedType, categoryId: catVal || null };

      if (group.isCard) {
        const card = document.getElementById("fItemCard").value.trim();
        if (!card) { toast("Diga a qual cartão pertence"); return false; }
        payload.card = card;
      }

      if (selectedType === "fixo") {
        const fv = parseFloat(document.getElementById("fItemFixed").value);
        payload.fixedValue = isNaN(fv) ? null : fv;
      } else if (selectedType === "parcelado") {
        const iv = parseFloat(document.getElementById("fItemInstallVal").value);
        const ic = parseInt(document.getElementById("fItemInstallCount").value, 10);
        if (isNaN(iv) || isNaN(ic) || ic < 1) { toast("Preencha valor e número de parcelas"); return false; }
        payload.installmentValue = iv;
        payload.installments = ic;
        payload.startYm = (existing && existing.startYm) ? existing.startYm : currentYM;
      }

      if (existing) {
        Object.assign(existing, payload);
        toast("Item atualizado");
      } else {
        cache.items.push({ id: uid(), groupId, ...payload });
        toast(group.isCard ? "Compra adicionada" : "Item adicionado");
      }
      persist();
      render();
      switchTab(`group-${groupId}`);
    }
  );

  document.getElementById("typeToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".type-opt");
    if (!btn) return;
    selectedType = btn.getAttribute("data-type");
    document.querySelectorAll("#typeToggle .type-opt").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("typeFieldsWrap").innerHTML = typeFieldsHtml(selectedType, existing);
  });
}

function openExtraModal() {
  openModal(
    "Entrada extra",
    `<div class="field"><label>Descrição</label><input type="text" id="fExtraDesc" placeholder="Ex: Freelance, presente..."></div>
     <div class="field"><label>Valor</label><input type="number" step="0.01" id="fExtraVal" placeholder="0,00"></div>`,
    () => {
      const desc = document.getElementById("fExtraDesc").value.trim();
      const val = parseFloat(document.getElementById("fExtraVal").value);
      if (!desc || isNaN(val)) { toast("Preencha descrição e valor"); return false; }
      if (!cache.extraIncome[currentYM]) cache.extraIncome[currentYM] = [];
      cache.extraIncome[currentYM].push({ id: uid(), desc, value: val });
      persist();
      renderDashboard();
      toast("Entrada adicionada");
    }
  );
}

function confirmDeleteGroup(groupId) {
  const g = cache.groups.find((x) => x.id === groupId);
  if (!g) return;
  openModal(
    `Excluir "${g.name}"?`,
    `<p style="color:var(--muted);font-size:0.88rem;line-height:1.5;">Isso vai remover o grupo e todos os itens e valores lançados nele, em todos os meses. Essa ação não pode ser desfeita.</p>`,
    () => {
      cache.items = cache.items.filter((it) => it.groupId !== groupId);
      cache.groups = cache.groups.filter((x) => x.id !== groupId);
      const remainingIds = new Set(cache.items.map((i) => i.id));
      Object.keys(cache.monthlyValues).forEach((k) => {
        const itemId = k.split("|")[0];
        if (!remainingIds.has(itemId)) delete cache.monthlyValues[k];
      });
      persist();
      activeTab = "tab-dashboard";
      render();
      toast("Grupo excluído");
    },
    { confirmLabel: "Excluir", danger: true }
  );
}

function confirmDeleteItem(itemId) {
  const it = cache.items.find((x) => x.id === itemId);
  if (!it) return;
  cache.items = cache.items.filter((x) => x.id !== itemId);
  Object.keys(cache.monthlyValues).forEach((k) => {
    if (k.startsWith(itemId + "|")) delete cache.monthlyValues[k];
  });
  persist();
  render();
  toast("Item removido");
}

/* ---------------- Report (print) ---------------- */

function buildReport() {
  const view = document.getElementById("reportView");
  const income = monthIncomeTotal(currentYM);
  const expense = monthExpenseTotal(currentYM);
  const saldo = income - expense;
  const extras = cache.extraIncome[currentYM] || [];
  const baseIncome = Number(cache.monthlyIncome[currentYM]) || 0;

  let html = `
    <h1>Fin Controller</h1>
    <div class="rsub">Relatório de ${fmtMonthLabel(current)}</div>
    <table>
      <tr><th>Receita</th><th style="text-align:right">Valor</th></tr>
      <tr><td>Renda mensal</td><td style="text-align:right">${fmtMoney(baseIncome)}</td></tr>
      ${extras.map((e) => `<tr><td>${escapeHtml(e.desc)}</td><td style="text-align:right">${fmtMoney(e.value)}</td></tr>`).join("")}
      <tr class="rtotal-row"><td>Total de receita</td><td style="text-align:right">${fmtMoney(income)}</td></tr>
    </table>
  `;

  cache.groups.forEach((g) => {
    const items = cache.items.filter((it) => it.groupId === g.id);
    if (items.length === 0) return;
    const total = groupTotal(g.id, currentYM);
    html += `<div class="rgroup-title">${escapeHtml(g.name)}</div><table>`;
    items.forEach((it) => {
      const v = getValue(it.id, currentYM);
      if (v === null) return;
      html += `<tr><td>${escapeHtml(it.name)}</td><td style="text-align:right">${fmtMoney(v)}</td></tr>`;
    });
    html += `<tr class="rtotal-row"><td>Subtotal</td><td style="text-align:right">${fmtMoney(total)}</td></tr></table>`;
  });

  html += `
    <table>
      <tr class="rtotal-row"><td>Total de despesas</td><td style="text-align:right">${fmtMoney(expense)}</td></tr>
      <tr class="rtotal-row"><td>Saldo do mês</td><td style="text-align:right">${fmtMoney(saldo)}</td></tr>
    </table>
  `;

  view.innerHTML = html;
}

function exportReport() {
  buildReport();
  setTimeout(() => window.print(), 80);
}

/* ---------------- Backup / restore ---------------- */

function exportBackup() {
  const payload = {
    app: "fin-controller",
    exportedAt: new Date().toISOString(),
    dados: cache
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fin-controller-backup-${ymKey(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Backup exportado");
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      const data = parsed.dados || parsed;
      if (!data.groups || !data.items) { toast("Arquivo inválido"); return; }
      cache = Object.assign(defaultState(), data);
      persist();
      activeTab = "tab-dashboard";
      render();
      toast("Backup restaurado");
    } catch (err) {
      toast("Erro ao ler o arquivo");
    }
  };
  reader.readAsText(file);
}

/* ---------------- Navigation (months) ---------------- */

function changeMonth(delta) {
  current = new Date(current.getFullYear(), current.getMonth() + delta, 1);
  render();
}

/* ---------------- Init ---------------- */

async function init() {
  db = await openDB();
  cache = await loadState();

  // compatibilidade: quem já tinha dados salvos antes das categorias existirem
  if (!cache.categories) cache.categories = [];

  if (!cache.seeded) {
    seedStarterGroups();
    persist();
  }

  document.getElementById("prevMonth").addEventListener("click", () => changeMonth(-1));
  document.getElementById("nextMonth").addEventListener("click", () => changeMonth(1));
  document.getElementById("manageCategoriesBtn").addEventListener("click", openCategoryManagerModal);

  document.getElementById("monthlyIncomeInput").addEventListener("input", (e) => {
    cache.monthlyIncome[currentYM] = e.target.value === "" ? undefined : Number(e.target.value);
    persist();
    const heroVal = document.getElementById("heroValue");
    const income = monthIncomeTotal(currentYM);
    const expense = monthExpenseTotal(currentYM);
    const saldo = income - expense;
    heroVal.textContent = fmtMoney(saldo);
    heroVal.className = "hero-value display " + (saldo < 0 ? "negative" : "positive");
    document.getElementById("incomeTotalDisplay").textContent = fmtMoney(income);
  });
  document.getElementById("monthlyIncomeInput").addEventListener("blur", () => renderDashboard());

  document.getElementById("addExtraBtn").addEventListener("click", openExtraModal);
  document.getElementById("reportBtn").addEventListener("click", exportReport);
  document.getElementById("backupBtn").addEventListener("click", exportBackup);
  document.getElementById("restoreInput").addEventListener("change", (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = "";
  });

  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
