// TC24 — نظام إدارة الطلبات والتحصيلات
const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");

const state = {
  me: null,
  users: [],
  month: new Date().toISOString().slice(0, 7),
};

const STATUS = { pending: "قيد التنفيذ", completed: "منفذ", cancelled: "ملغي" };
const METHOD = { cash: "نقدي", transfer: "تحويل بنكي", card: "بطاقة / شبكة" };

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const isAdmin = () => state.me?.role === "admin";
const monthLabel = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric" });
};

async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("auth/")) {
    state.me = null;
    render();
  }
  if (!res.ok) throw new Error(data.error || "حدث خطأ");
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 2600);
}

const icons = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  coll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.6 3 5.2"/></svg>',
};

// ---------- modal ----------
function openModal({ title, fields, submitLabel = "حفظ", onSubmit, danger }) {
  const dlg = $("#modal");
  const form = $("#modal-form");
  form.innerHTML = `
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">✕</button></div>
    <div class="modal-body">${fields}<p class="error" id="modal-err"></p></div>
    <div class="modal-foot">
      <button class="btn" type="submit" value="ok">${esc(submitLabel)}</button>
      <button class="btn ghost" type="button" data-close>إلغاء</button>
      ${danger ? `<button class="btn danger" type="button" data-danger style="margin-inline-start:auto">${esc(danger.label)}</button>` : ""}
    </div>`;
  form.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => dlg.close()));
  if (danger) form.querySelector("[data-danger]").onclick = async () => {
    if (!confirm(danger.confirm)) return;
    try { await danger.action(); dlg.close(); } catch (e) { $("#modal-err").textContent = e.message; }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)), form);
      dlg.close();
    } catch (err) {
      $("#modal-err").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
  dlg.showModal();
  form.querySelector("input, select, textarea")?.focus();
}

const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
const employeeSelect = (selected) =>
  isAdmin()
    ? field(
        "الموظف",
        `<select name="employeeId">${state.users
          .filter((u) => u.active || u.id === selected)
          .map((u) => `<option value="${u.id}" ${u.id === (selected ?? state.me.id) ? "selected" : ""}>${esc(u.name)}</option>`)
          .join("")}</select>`,
      )
    : "";

// ---------- auth screens ----------
function authLayout(inner) {
  app.innerHTML = `
    <div class="auth">
      <section class="auth-hero">
        <div class="mark">TC<b>24</b></div>
        <div>
          <h1>كل طلب، كل تحصيل،<br/><em>في دفتر واحد.</em></h1>
          <p>سجّل الطلبات وتابع تنفيذها، وثبّت التحصيلات لحظة استلامها، واحصل على تقرير أداء الموظفين الشهري تلقائياً.</p>
        </div>
        <div class="ledger">
          <div><strong>01</strong>الطلبات</div>
          <div><strong>02</strong>التحصيلات</div>
          <div><strong>03</strong>تقرير الأداء</div>
        </div>
      </section>
      <section class="auth-panel"><div class="auth-card">${inner}</div></section>
    </div>`;
}

function renderLogin() {
  authLayout(`
    <div class="welcome"><span>👋</span><div><strong>مرحباً بك في TC24</strong><small>نظام إدارة الطلبات والتحصيلات — سعداء بعودتك</small></div></div>
    <h2>تسجيل الدخول</h2>
    <p class="sub">أدخل بيانات حسابك للمتابعة</p>
    <form id="login">
      ${field("اسم المستخدم", '<input name="username" autocomplete="username" required />')}
      ${field("كلمة المرور", '<input name="password" type="password" autocomplete="current-password" required />')}
      <p class="error" id="err"></p>
      <button class="btn block">دخول</button>
    </form>`);
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const { user } = await api("auth/login", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
      state.me = user;
      await boot();
    } catch (err) {
      $("#err").textContent = err.message;
      btn.disabled = false;
    }
  };
}

function renderSetup() {
  authLayout(`
    <h2>إعداد النظام</h2>
    <p class="sub">أنشئ حساب مدير النظام للبدء. يمكنك إضافة الموظفين لاحقاً.</p>
    <form id="setup">
      ${field("الاسم", '<input name="name" value="مدير النظام" required />')}
      ${field("اسم المستخدم", '<input name="username" value="Ta24" autocomplete="username" required />')}
      ${field("كلمة المرور", '<input name="password" type="password" minlength="6" autocomplete="new-password" required />')}
      <p class="error" id="err"></p>
      <button class="btn block gold">إنشاء الحساب والدخول</button>
    </form>`);
  $("#setup").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { user } = await api("auth/setup", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
      state.me = user;
      await boot();
    } catch (err) {
      $("#err").textContent = err.message;
    }
  };
}

// ---------- shell ----------
const routes = {
  "": { title: "الرئيسية", icon: "home", view: viewDashboard },
  orders: { title: "الطلبات", icon: "orders", view: viewOrders },
  collections: { title: "التحصيلات", icon: "coll", view: viewCollections },
  report: { title: "تقرير العملاء", icon: "report", view: viewReport },
  users: { title: "الموظفون", icon: "users", view: viewUsers, admin: true },
};

function currentRoute() {
  const key = location.hash.replace(/^#\/?/, "");
  const r = routes[key];
  return r && (!r.admin || isAdmin()) ? key : "";
}

function renderShell() {
  const active = currentRoute();
  app.innerHTML = `
    <div class="shell">
      <aside class="side">
        <div class="brand">TC<b>24</b><small>الطلبات والتحصيلات</small></div>
        <nav class="nav">
          ${Object.entries(routes)
            .filter(([, r]) => !r.admin || isAdmin())
            .map(([k, r]) => `<a href="#/${k}" class="${k === active ? "active" : ""}">${icons[r.icon]}<span>${r.title}</span></a>`)
            .join("")}
        </nav>
        <div class="me">
          <strong>${esc(state.me.name)}</strong>
          <span>${esc(state.me.username)} · ${isAdmin() ? "مدير" : "موظف"}</span><br/>
          <button id="logout">خروج</button>
        </div>
      </aside>
      <main id="main"></main>
    </div>`;
  $("#logout").onclick = async () => {
    await api("auth/logout", { method: "POST" }).catch(() => {});
    state.me = null;
    render();
  };
  routes[active].view($("#main"));
}

const monthPicker = () => `<input type="month" id="month" value="${state.month}" aria-label="الشهر" />`;
function bindMonth(root, rerender) {
  const el = $("#month", root);
  if (el) el.onchange = () => { if (el.value) { state.month = el.value; rerender(); } };
}

// ---------- dashboard ----------
async function viewDashboard(root) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? "صباح الخير" : "مساء الخير";
  root.innerHTML = `<div class="view">
    <div class="welcome-banner"><strong>${greet}، ${esc(state.me.name)}!</strong> مرحباً بك في TC24 — نتمنى لك يوماً موفقاً ومليئاً بالإنجازات.</div>
    <div class="page-head">
      <div><h1>أهلاً بك، ${esc(state.me.name)} 👋</h1><p>ملخص ${esc(monthLabel(state.month))}</p></div>
      <div class="toolbar">${monthPicker()}
        <button class="btn" id="q-order">+ طلب جديد</button>
        <button class="btn gold" id="q-coll">+ تحصيل</button>
      </div>
    </div>
    <div id="dash"><div class="card"><div class="empty">جاري التحميل…</div></div></div>
  </div>`;
  bindMonth(root, () => viewDashboard(root));
  $("#q-order").onclick = () => orderForm(null, () => viewDashboard(root));
  $("#q-coll").onclick = () => collectionForm(null, () => viewDashboard(root));

  const data = await api(`report?month=${state.month}`);
  const t = data.rows.reduce(
    (a, r) => ({
      orders: a.orders + r.orders,
      completed: a.completed + r.completedOrders,
      sales: a.sales + r.sales,
      coll: a.coll + r.collectionsValue,
      collN: a.collN + r.collectionsCount,
    }),
    { orders: 0, completed: 0, sales: 0, coll: 0, collN: 0 },
  );
  const rate = t.sales ? Math.round((t.coll / t.sales) * 100) : 0;
  const ranked = [...data.rows].sort((a, b) => b.sales - a.sales).slice(0, 6);
  const maxSales = Math.max(1, ...ranked.map((r) => r.sales));

  $("#dash", root).innerHTML = `
    <div class="stats">
      <div class="stat feature"><div class="label">المبيعات (الطلبات المنفذة)</div><div class="value num">${money(t.sales)}<small>ر.س</small></div><div class="hint">${t.completed} طلب منفذ</div></div>
      <div class="stat"><div class="label">قيمة التحصيلات</div><div class="value num">${money(t.coll)}<small>ر.س</small></div><div class="hint">${t.collN} عملية تحصيل · ${rate}% من المبيعات</div></div>
      <div class="stat"><div class="label">إجمالي الطلبات</div><div class="value num">${t.orders}</div><div class="hint">${t.orders ? Math.round((t.completed / t.orders) * 100) : 0}% نسبة التنفيذ</div></div>
      <div class="stat"><div class="label">طلبات قيد التنفيذ</div><div class="value num">${data.pending.count}</div><div class="hint">بقيمة <span class="num">${money(data.pending.value)}</span> ر.س</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>الحركة اليومية</h3>
          <div class="legend"><span><i style="background:var(--ink-2)"></i>مبيعات</span><span><i style="background:var(--gold)"></i>تحصيلات</span></div>
        </div>
        <div class="card-body">${chart(data.daily, state.month)}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${isAdmin() ? "ترتيب الموظفين بالمبيعات" : "أدائي هذا الشهر"}</h3><a href="#/report" class="muted">التقرير الكامل ←</a></div>
        <div class="card-body">
          ${ranked.length ? `<ul class="leader">${ranked.map((r, i) => `
            <li><span class="rank">${i + 1}</span>
              <div><div>${esc(r.employeeName)}</div><div class="meter"><span style="width:${(r.sales / maxSales) * 100}%"></span></div></div>
              <span class="amt num">${money(r.sales)}</span></li>`).join("")}</ul>` : `<div class="empty">لا توجد بيانات</div>`}
        </div>
      </div>
    </div>`;
  bindChartTips(root);
}

function chart(daily, month) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const W = 640, H = 220, pad = { t: 10, r: 8, b: 22, l: 44 };
  const vals = [];
  for (let d = 1; d <= days; d++) vals.push([daily.sales[d] || 0, daily.collections[d] || 0]);
  const max = Math.max(1, ...vals.flat());
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const slot = iw / days, bw = Math.max(2, slot / 2 - 1.5);
  // RTL: day 1 on the right
  const x = (i) => W - pad.r - (i + 1) * slot;
  const yv = (v) => pad.t + ih - (v / max) * ih;
  let s = "";
  [0, 0.5, 1].forEach((f) => {
    const yy = pad.t + ih - f * ih;
    s += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="axis" x="${pad.l - 6}" y="${yy + 3}" text-anchor="end">${money(max * f)}</text>`;
  });
  vals.forEach(([sv, cv], i) => {
    const d = i + 1;
    const tip = `يوم ${d}: مبيعات ${money(sv)} · تحصيلات ${money(cv)} ر.س`;
    if (sv) s += `<rect class="bar-s" data-tip="${tip}" x="${x(i) + slot / 2}" y="${yv(sv)}" width="${bw}" height="${pad.t + ih - yv(sv)}" rx="1.5"/>`;
    if (cv) s += `<rect class="bar-c" data-tip="${tip}" x="${x(i) + slot / 2 - bw - 1}" y="${yv(cv)}" width="${bw}" height="${pad.t + ih - yv(cv)}" rx="1.5"/>`;
    if (d === 1 || d % 5 === 0) s += `<text class="axis" x="${x(i) + slot / 2}" y="${H - 6}" text-anchor="middle">${d}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="مخطط المبيعات والتحصيلات اليومية">${s}</svg>`;
}

function bindChartTips(root) {
  let tip = $(".chart-tip");
  if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; document.body.append(tip); }
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.onmousemove = (e) => { tip.textContent = el.dataset.tip; tip.style.left = e.clientX + 12 + "px"; tip.style.top = e.clientY - 36 + "px"; tip.style.opacity = 1; };
    el.onmouseleave = () => (tip.style.opacity = 0);
  });
}

// ---------- orders ----------
function orderForm(o, done) {
  openModal({
    title: o ? `تعديل الطلب #${o.id}` : "طلب جديد",
    fields: `
      <div class="row2">
        ${field("اسم العميل", `<input name="customerName" value="${esc(o?.customerName)}" required />`)}
        ${field("جوال العميل", `<input name="customerPhone" value="${esc(o?.customerPhone)}" inputmode="tel" dir="ltr" />`)}
      </div>
      ${field("كود العميل", `<input name="customerCode" value="${esc(o?.customerCode)}" dir="ltr" placeholder="مثال: C-1024" />`)}
      <div class="row3">
        ${field("عدد السبليت", `<input name="splitCount" type="number" min="0" step="1" value="${esc(o?.splitCount ?? 0)}" dir="ltr" />`)}
        ${field("عدد الدكت", `<input name="ductCount" type="number" min="0" step="1" value="${esc(o?.ductCount ?? 0)}" dir="ltr" />`)}
        ${field("عدد الفلاتر", `<input name="filterCount" type="number" min="0" step="1" value="${esc(o?.filterCount ?? 0)}" dir="ltr" />`)}
      </div>
      ${field("تفاصيل الطلب", `<textarea name="description">${esc(o?.description)}</textarea>`)}
      <div class="row2">
        ${field("المبلغ (ر.س)", `<input name="amount" type="number" min="0" step="0.01" value="${esc(o?.amount ?? "")}" required dir="ltr" />`)}
        ${field("تاريخ الطلب", `<input name="orderDate" type="date" value="${esc(o?.orderDate ?? today())}" required />`)}
      </div>
      <div class="row2">
        ${field("الحالة", `<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === (o?.status ?? "pending") ? "selected" : ""}>${v}</option>`).join("")}</select>`)}
        ${employeeSelect(o?.employeeId)}
      </div>`,
    onSubmit: async (v) => {
      await api(o ? `orders/${o.id}` : "orders", { method: o ? "PATCH" : "POST", body: v });
      toast(o ? "تم تحديث الطلب" : "تمت إضافة الطلب");
      done();
    },
    danger: o && {
      label: "حذف",
      confirm: "هل تريد حذف هذا الطلب؟",
      action: async () => { await api(`orders/${o.id}`, { method: "DELETE" }); toast("تم حذف الطلب"); done(); },
    },
  });
}

async function viewOrders(root) {
  const filter = viewOrders.filter || (viewOrders.filter = { status: "", employeeId: "", q: "" });
  root.innerHTML = `<div class="view">
    <div class="page-head">
      <div><h1>الطلبات</h1><p>${filter.q ? `نتائج البحث عن «${esc(filter.q)}» في كل الأشهر` : esc(monthLabel(state.month))}</p></div>
      <div class="toolbar">
        <input type="search" id="f-q" class="search" placeholder="ابحث بكود العميل…" value="${esc(filter.q)}" dir="auto" />
        ${monthPicker()}
        <select id="f-status"><option value="">كل الحالات</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${filter.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <button class="btn" id="new">+ طلب جديد</button>
      </div>
    </div>
    <div class="card"><div class="table-wrap" id="list"><div class="empty">جاري التحميل…</div></div></div>
  </div>`;
  const reload = () => viewOrders(root);
  bindMonth(root, reload);
  $("#f-status").onchange = (e) => { filter.status = e.target.value; reload(); };
  $("#new").onclick = () => orderForm(null, reload);
  let searchTimer;
  $("#f-q").oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      filter.q = e.target.value.trim();
      await reload();
      const inp = $("#f-q");
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 350);
  };

  const q = new URLSearchParams({ month: state.month, ...(filter.q && { q: filter.q }), ...(filter.status && { status: filter.status }) });
  const rows = await api(`orders?${q}`);
  const list = $("#list", root);
  if (!rows.length) {
    list.innerHTML = filter.q
      ? `<div class="empty"><strong>لا توجد نتائج</strong>لا يوجد طلب بكود العميل «${esc(filter.q)}»</div>`
      : `<div class="empty"><strong>لا توجد طلبات</strong>أضف أول طلب لهذا الشهر</div>`;
    return;
  }
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  const totalColl = rows.reduce((a, r) => a + Number(r.collected), 0);
  const units = rows.reduce((a, r) => ({ s: a.s + (r.splitCount || 0), d: a.d + (r.ductCount || 0), f: a.f + (r.filterCount || 0) }), { s: 0, d: 0, f: 0 });
  list.innerHTML = `<table>
    <thead><tr><th>#</th><th>التاريخ</th><th>العميل</th><th>التفاصيل</th><th>سبليت</th><th>دكت</th><th>فلاتر</th>${isAdmin() ? "<th>الموظف</th>" : ""}<th>المبلغ</th><th>المحصّل</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${rows.map((r) => {
      const pct = Number(r.amount) ? Math.min(100, (Number(r.collected) / Number(r.amount)) * 100) : 0;
      return `<tr data-id="${r.id}">
        <td class="num muted">${r.id}</td>
        <td class="num">${esc(r.orderDate)}</td>
        <td>${esc(r.customerName)}${r.customerCode ? `<span class="code-tag num" dir="ltr">${esc(r.customerCode)}</span>` : ""}${r.customerPhone ? `<div class="muted num">${esc(r.customerPhone)}</div>` : ""}</td>
        <td class="muted">${esc(r.description).slice(0, 60) || "—"}</td>
        <td class="num">${r.splitCount || 0}</td>
        <td class="num">${r.ductCount || 0}</td>
        <td class="num">${r.filterCount || 0}</td>
        ${isAdmin() ? `<td>${esc(r.employeeName)}</td>` : ""}
        <td class="num"><strong>${money(r.amount)}</strong></td>
        <td><div class="progress"><div class="track"><span class="${pct >= 100 ? "full" : ""}" style="width:${pct}%"></span></div><span class="num muted">${money(r.collected)}</span></div></td>
        <td><select class="status-select ${r.status}" data-status>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        <td class="actions">
          <button class="btn ghost sm" data-collect>تحصيل</button>
          <button class="icon-btn" data-edit aria-label="تعديل">✎</button>
        </td>
      </tr>`;
    }).join("")}</tbody>
    <tfoot><tr><td colspan="4">الإجمالي (${rows.length} طلب)</td><td class="num">${units.s}</td><td class="num">${units.d}</td><td class="num">${units.f}</td>${isAdmin() ? "<td></td>" : ""}<td class="num">${money(total)}</td><td class="num">${money(totalColl)}</td><td colspan="2"></td></tr></tfoot>
  </table>`;
  list.querySelectorAll("tr[data-id]").forEach((tr) => {
    const r = rows.find((x) => x.id === Number(tr.dataset.id));
    $("[data-edit]", tr).onclick = () => orderForm(r, reload);
    $("[data-collect]", tr).onclick = () =>
      collectionForm({ customerName: r.customerName, orderId: r.id, amount: Math.max(0, Number(r.amount) - Number(r.collected)) || "", employeeId: r.employeeId }, reload, rows);
    $("[data-status]", tr).onchange = async (e) => {
      try {
        await api(`orders/${r.id}`, { method: "PATCH", body: { status: e.target.value } });
        e.target.className = `status-select ${e.target.value}`;
        toast("تم تحديث الحالة");
      } catch (err) { toast(err.message, true); }
    };
  });
}

// ---------- collections ----------
async function collectionForm(c, done, ordersHint) {
  const editing = Boolean(c?.id);
  let orderOptions = ordersHint;
  if (!orderOptions) orderOptions = await api(`orders?month=${state.month}`).catch(() => []);
  if (c?.orderId && !orderOptions.some((o) => o.id === c.orderId)) orderOptions = [{ id: c.orderId, customerName: c.customerName, amount: "" }, ...orderOptions];
  openModal({
    title: editing ? `تعديل التحصيل #${c.id}` : "تسجيل تحصيل",
    fields: `
      ${field("اسم العميل", `<input name="customerName" value="${esc(c?.customerName)}" required />`)}
      <div class="row2">
        ${field("المبلغ المحصّل (ر.س)", `<input name="amount" type="number" min="0" step="0.01" value="${esc(c?.amount ?? "")}" required dir="ltr" />`)}
        ${field("تاريخ التحصيل", `<input name="collectionDate" type="date" value="${esc(c?.collectionDate ?? today())}" required />`)}
      </div>
      <div class="row2">
        ${field("طريقة الدفع", `<select name="method">${Object.entries(METHOD).map(([k, v]) => `<option value="${k}" ${k === (c?.method ?? "cash") ? "selected" : ""}>${v}</option>`).join("")}</select>`)}
        ${field("مرتبط بطلب (اختياري)", `<select name="orderId"><option value="">— بدون —</option>${orderOptions.map((o) => `<option value="${o.id}" ${o.id === c?.orderId ? "selected" : ""}>#${o.id} · ${esc(o.customerName)}${o.customerCode ? ` (${esc(o.customerCode)})` : ""}${o.amount ? ` · ${money(o.amount)}` : ""}</option>`).join("")}</select>`)}
      </div>
      ${employeeSelect(c?.employeeId)}
      ${field("ملاحظات", `<textarea name="notes">${esc(c?.notes)}</textarea>`)}`,
    onSubmit: async (v) => {
      await api(editing ? `collections/${c.id}` : "collections", { method: editing ? "PATCH" : "POST", body: v });
      toast(editing ? "تم تحديث التحصيل" : "تم تسجيل التحصيل");
      done();
    },
    danger: editing && {
      label: "حذف",
      confirm: "هل تريد حذف هذا التحصيل؟",
      action: async () => { await api(`collections/${c.id}`, { method: "DELETE" }); toast("تم حذف التحصيل"); done(); },
    },
  });
  // Selecting an order pre-fills the customer name
  const sel = $('#modal-form select[name="orderId"]');
  sel.onchange = () => {
    const o = orderOptions.find((x) => String(x.id) === sel.value);
    const name = $('#modal-form input[name="customerName"]');
    if (o && !name.value) name.value = o.customerName;
  };
}

async function viewCollections(root) {
  const filter = viewCollections.filter || (viewCollections.filter = { employeeId: "" });
  root.innerHTML = `<div class="view">
    <div class="page-head">
      <div><h1>التحصيلات</h1><p>${esc(monthLabel(state.month))}</p></div>
      <div class="toolbar">
        ${monthPicker()}
        <button class="btn gold" id="new">+ تسجيل تحصيل</button>
      </div>
    </div>
    <div class="card"><div class="table-wrap" id="list"><div class="empty">جاري التحميل…</div></div></div>
  </div>`;
  const reload = () => viewCollections(root);
  bindMonth(root, reload);
  $("#new").onclick = () => collectionForm(null, reload);

  const q = new URLSearchParams({ month: state.month });
  const rows = await api(`collections?${q}`);
  const list = $("#list", root);
  if (!rows.length) {
    list.innerHTML = `<div class="empty"><strong>لا توجد تحصيلات</strong>سجّل أول تحصيل لهذا الشهر</div>`;
    return;
  }
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  list.innerHTML = `<table>
    <thead><tr><th>#</th><th>التاريخ</th><th>العميل</th><th>الطلب</th>${isAdmin() ? "<th>الموظف</th>" : ""}<th>الطريقة</th><th>المبلغ</th><th>ملاحظات</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-id="${r.id}">
      <td class="num muted">${r.id}</td>
      <td class="num">${esc(r.collectionDate)}</td>
      <td>${esc(r.customerName)}</td>
      <td class="num muted">${r.orderId ? `#${r.orderId}` : "—"}</td>
      ${isAdmin() ? `<td>${esc(r.employeeName)}</td>` : ""}
      <td>${METHOD[r.method] || r.method}</td>
      <td class="num"><strong>${money(r.amount)}</strong></td>
      <td class="muted">${esc(r.notes).slice(0, 50) || "—"}</td>
      <td class="actions"><button class="icon-btn" data-edit aria-label="تعديل">✎</button></td>
    </tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="${isAdmin() ? 6 : 5}">الإجمالي (${rows.length} عملية)</td><td class="num">${money(total)}</td><td colspan="2"></td></tr></tfoot>
  </table>`;
  list.querySelectorAll("tr[data-id]").forEach((tr) => {
    const r = rows.find((x) => x.id === Number(tr.dataset.id));
    $("[data-edit]", tr).onclick = () => collectionForm(r, reload);
  });
}

// ---------- report ----------
async function viewReport(root) {
  const now = new Date();
  const reportDate = now.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { year: "numeric", month: "long", day: "numeric" });
  const reportTime = now.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
  root.innerHTML = `<div class="view">
    <div class="page-head">
      <div><h1>تقرير تحصيلات العملاء</h1><p>${esc(monthLabel(state.month))}</p></div>
      <div class="toolbar">
        ${monthPicker()}
        <a class="btn gold" href="/api/customer-report?month=${state.month}&format=csv" download>تصدير CSV</a>
        <button class="btn ghost" id="print">طباعة</button>
      </div>
    </div>
    <div class="card print-sheet">
      <header class="print-head">
        <div class="print-logo"><span class="logo-mark">24</span><div><strong>TC<b>24</b></strong><small>الطلبات والتحصيلات</small></div></div>
        <div class="print-title"><h2>تقرير تحصيلات العملاء</h2><p>شهر ${esc(monthLabel(state.month))}</p></div>
        <div class="print-date"><span>تاريخ التقرير</span><strong class="num">${esc(reportDate)}</strong><small class="num">${esc(reportTime)}</small></div>
      </header>
      <div class="table-wrap" id="list"><div class="empty">جاري التحميل…</div></div>
      <footer class="print-foot"><span>TC24 — نظام إدارة الطلبات والتحصيلات</span><span class="num">${esc(reportDate)}</span></footer>
    </div>
  </div>`;
  bindMonth(root, () => viewReport(root));
  $("#print", root).onclick = () => window.print();
  const { rows } = await api(`customer-report?month=${state.month}`);
  const list = $("#list", root);
  if (!rows.length) { list.innerHTML = `<div class="empty"><strong>لا توجد تحصيلات في هذا الشهر</strong></div>`; return; }
  const total = rows.reduce((a, r) => a + r.collected, 0);
  const payments = rows.reduce((a, r) => a + r.payments, 0);
  list.innerHTML = `<table class="customers-table">
    <thead><tr><th>م</th><th>كود العميل</th><th>اسم العميل</th><th>عدد الدفعات</th><th>المبلغ المحصل (ر.س)</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <td class="num muted">${i + 1}</td>
      <td class="num"><span class="code-tag" dir="ltr">${esc(r.customerCode || "—")}</span></td>
      <td><strong>${esc(r.customerName)}</strong></td>
      <td class="num">${r.payments}</td>
      <td class="num"><strong>${money(r.collected)}</strong></td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="3">الإجمالي (${rows.length} عميل)</td><td class="num">${payments}</td><td class="num">${money(total)}</td></tr></tfoot>
  </table>`;
}

// ---------- users ----------
function userForm(u, done) {
  openModal({
    title: u ? `تعديل: ${u.name}` : "إضافة موظف",
    fields: `
      ${field("الاسم", `<input name="name" value="${esc(u?.name)}" required />`)}
      ${u ? "" : field("اسم المستخدم", `<input name="username" required dir="ltr" autocomplete="off" />`)}
      ${field(u ? "كلمة مرور جديدة (اتركها فارغة لعدم التغيير)" : "كلمة المرور", `<input name="password" type="password" minlength="6" ${u ? "" : "required"} autocomplete="new-password" />`)}
      <div class="row2">
        ${field("الصلاحية", `<select name="role"><option value="employee">موظف</option><option value="admin" ${u?.role === "admin" ? "selected" : ""}>مدير</option></select>`)}
        ${u ? field("الحالة", `<select name="active"><option value="1">نشط</option><option value="" ${u.active ? "" : "selected"}>موقوف</option></select>`) : ""}
      </div>`,
    onSubmit: async (v) => {
      if (u) v.active = Boolean(v.active);
      if (u && !v.password) delete v.password;
      await api(u ? `users/${u.id}` : "users", { method: u ? "PATCH" : "POST", body: v });
      toast(u ? "تم تحديث الموظف" : "تمت إضافة الموظف");
      await loadUsers();
      done();
    },
  });
}

async function viewUsers(root) {
  root.innerHTML = `<div class="view">
    <div class="page-head">
      <div><h1>الموظفون</h1><p>إدارة الحسابات والصلاحيات</p></div>
      <div class="toolbar"><button class="btn" id="new">+ إضافة موظف</button></div>
    </div>
    <div class="card"><div class="table-wrap" id="list"></div></div>
  </div>`;
  const reload = () => viewUsers(root);
  $("#new").onclick = () => userForm(null, reload);
  await loadUsers();
  const list = $("#list", root);
  list.innerHTML = `<table>
    <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الصلاحية</th><th>الحالة</th><th>تاريخ الإضافة</th><th></th></tr></thead>
    <tbody>${state.users.map((u) => `<tr data-id="${u.id}">
      <td><strong>${esc(u.name)}</strong>${u.id === state.me.id ? ' <span class="muted">(أنت)</span>' : ""}</td>
      <td class="num">${esc(u.username)}</td>
      <td><span class="pill ${u.role}">${u.role === "admin" ? "مدير" : "موظف"}</span></td>
      <td>${u.active ? '<span class="pill completed">نشط</span>' : '<span class="pill off">موقوف</span>'}</td>
      <td class="num muted">${esc(String(u.createdAt).slice(0, 10))}</td>
      <td class="actions"><button class="icon-btn" data-edit aria-label="تعديل">✎</button></td>
    </tr>`).join("")}</tbody>
  </table>`;
  list.querySelectorAll("tr[data-id]").forEach((tr) => {
    const u = state.users.find((x) => x.id === Number(tr.dataset.id));
    $("[data-edit]", tr).onclick = () => userForm(u, reload);
  });
}

// ---------- boot ----------
async function loadUsers() {
  state.users = await api("users").catch(() => []);
}

async function boot() {
  await loadUsers();
  render();
}

function render() {
  if (!state.me) {
    api("auth/setup-status")
      .then((s) => (s.needsSetup ? renderSetup() : renderLogin()))
      .catch(() => renderLogin());
    return;
  }
  renderShell();
}

window.addEventListener("hashchange", () => state.me && renderShell());
window.addEventListener("unhandledrejection", (e) => toast(e.reason?.message || "حدث خطأ", true));

(async () => {
  try {
    const { user } = await api("auth/me");
    state.me = user;
    await boot();
  } catch {
    render();
  }
})();
