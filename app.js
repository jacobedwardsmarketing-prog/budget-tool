const STORAGE_KEY = "budgetAppDataV2";

const defaultData = {
  version: 2,
  currentBalance: 0,
  cycle: {
    startDate: "No cycle",
    endDate: "Not started",
    requiredEndBalance: 0
  },
  rules: {
    monthlyExpenses: [],
    biWeeklyFixed: [],
    biWeeklyVariable: []
  },
  bills: [],
  categories: [],
  transactions: [],
  lastUpdated: new Date().toISOString()
};

let appData = loadData();
let actionModalState = null;

function cloneDefaultData() {
  return JSON.parse(JSON.stringify(defaultData));
}

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  let data;

  try {
    data = saved ? JSON.parse(saved) : cloneDefaultData();
  } catch {
    data = cloneDefaultData();
  }

  if (!data || data.version !== 2) data = cloneDefaultData();

  data.currentBalance = Number(data.currentBalance || 0);
  if (!data.cycle) data.cycle = cloneDefaultData().cycle;
  if (typeof data.cycle.requiredEndBalance === "undefined") data.cycle.requiredEndBalance = 0;

  if (!data.rules) data.rules = {};
  if (!Array.isArray(data.rules.monthlyExpenses)) data.rules.monthlyExpenses = [];
  if (!Array.isArray(data.rules.biWeeklyFixed)) data.rules.biWeeklyFixed = [];
  if (!Array.isArray(data.rules.biWeeklyVariable)) data.rules.biWeeklyVariable = [];

  if (!Array.isArray(data.bills)) data.bills = [];
  if (!Array.isArray(data.categories)) data.categories = [];
  if (!Array.isArray(data.transactions)) data.transactions = [];

  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function saveData() {
  appData.lastUpdated = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

function resetData() {
  localStorage.removeItem(STORAGE_KEY);
  appData = cloneDefaultData();
  saveData();
  renderAll();
}

function ensureRules() {
  if (!appData.rules) appData.rules = {};
  if (!Array.isArray(appData.rules.monthlyExpenses)) appData.rules.monthlyExpenses = [];
  if (!Array.isArray(appData.rules.biWeeklyFixed)) appData.rules.biWeeklyFixed = [];
  if (!Array.isArray(appData.rules.biWeeklyVariable)) appData.rules.biWeeklyVariable = [];
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(n) {
  const value = Number(n || 0);
  const sign = value < 0 ? "-" : "";
  return sign + "$" + Math.abs(value).toFixed(2);
}

function calculateSafeToSpend() {
  const unpaidBillsTotal = (appData.bills || [])
    .filter(b => !b.paid)
    .reduce((sum, b) => sum + Number(b.amount || 0), 0);

  const remainingCategoriesTotal = (appData.categories || [])
    .reduce((sum, c) => sum + Number(c.remaining || 0), 0);

  const savingsGoal = Number(appData.cycle?.requiredEndBalance || 0);

  return Number(appData.currentBalance || 0) - unpaidBillsTotal - remainingCategoriesTotal - savingsGoal;
}

function getBudgetState() {
  const safe = calculateSafeToSpend();

  if (safe < 0) {
    return {
      key: "deficit",
      title: "DEFICIT",
      caption: `Short by ${money(Math.abs(safe))}`,
      safe
    };
  }

  if (safe <= 100) {
    return {
      key: "onTrack",
      title: "ON TRACK",
      caption: "Budget balances inside the safe margin",
      safe
    };
  }

  return {
    key: "surplus",
    title: "SURPLUS",
    caption: `${money(safe)} available after obligations`,
    safe
  };
}

function getStatus() {
  const state = getBudgetState();
  return {
    title: state.title,
    caption: state.caption
  };
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateWithYear(date) {
  return date.toISOString().slice(0, 10);
}

function dateFromDueDay(year, monthIndex, dueDay) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const safeDay = Math.min(Math.max(Number(dueDay || 1), 1), lastDay);
  return new Date(year, monthIndex, safeDay);
}

function isDateInCycle(date, start, end) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return d >= s && d <= e;
}

function hasActiveCycle() {
  return !!(appData.cycle && appData.cycle.startDateISO && appData.cycle.endDateISO);
}

function monthlyBillsForCycle(start, end) {
  ensureRules();
  const bills = [];

  appData.rules.monthlyExpenses.forEach(rule => {
    const possibleMonths = [
      new Date(start.getFullYear(), start.getMonth(), 1),
      new Date(end.getFullYear(), end.getMonth(), 1)
    ];

    const seen = new Set();

    possibleMonths.forEach(monthDate => {
      const due = dateFromDueDay(monthDate.getFullYear(), monthDate.getMonth(), rule.dueDay);
      const dueISO = formatDateWithYear(due);
      const key = `${rule.id}-${dueISO}`;

      if (seen.has(key)) return;
      seen.add(key);

      if (!isDateInCycle(due, start, end)) return;

      const existing = (appData.bills || []).find(b =>
        b.ruleId === rule.id &&
        b.dueDateISO === dueISO
      );

      bills.push({
        id: existing?.id || crypto.randomUUID(),
        ruleId: rule.id,
        type: "monthly",
        name: rule.name,
        date: formatDate(due),
        dueDateISO: dueISO,
        amount: Number(rule.amount || 0),
        paid: existing?.paid || false
      });
    });
  });

  return bills;
}

function fixedBillsForCycle() {
  ensureRules();

  return appData.rules.biWeeklyFixed.map(rule => {
    const existing = (appData.bills || []).find(b => b.ruleId === rule.id && b.type === "fixed");

    return {
      id: existing?.id || crypto.randomUUID(),
      ruleId: rule.id,
      type: "fixed",
      name: rule.name,
      date: "This cycle",
      amount: Number(rule.amount || 0),
      paid: existing?.paid || false
    };
  });
}

function variableCategoriesForCycle() {
  ensureRules();

  return appData.rules.biWeeklyVariable.map(rule => {
    const existing = (appData.categories || []).find(c => c.ruleId === rule.id);
    const previousBudget = Number(existing?.budget || rule.amount || 0);
    const newBudget = Number(rule.amount || 0);
    const alreadySpent = existing ? previousBudget - Number(existing.remaining || 0) : 0;

    return {
      id: existing?.id || crypto.randomUUID(),
      ruleId: rule.id,
      name: rule.name,
      budget: newBudget,
      remaining: newBudget - alreadySpent
    };
  });
}

function syncCurrentCycleFromRules() {
  if (!hasActiveCycle()) return;

  const start = new Date(appData.cycle.startDateISO + "T00:00:00");
  const end = new Date(appData.cycle.endDateISO + "T00:00:00");

  appData.bills = [
    ...monthlyBillsForCycle(start, end),
    ...fixedBillsForCycle()
  ];

  appData.categories = variableCategoriesForCycle();
}

function renderDashboard() {
  const safe = calculateSafeToSpend();
  const status = getStatus();

  document.getElementById("statusTitle").textContent = status.title;
  document.querySelector(".hero-card .caption").textContent = status.caption;
  const safeToSpendEl = document.getElementById("safeToSpend");
  safeToSpendEl.textContent = money(safe);
  safeToSpendEl.classList.remove("safe-green", "safe-yellow", "safe-red");
  safeToSpendEl.classList.add(safe < 0 ? "safe-red" : safe <= 100 ? "safe-yellow" : "safe-green");
  document.getElementById("currentBalance").textContent = money(appData.currentBalance);

  const projectedEnd = safe + Number(appData.cycle?.requiredEndBalance || 0);
  document.getElementById("expectedEnd").textContent = money(projectedEnd);

  document.getElementById("billList").innerHTML = (appData.bills || []).length
    ? appData.bills.map(b => `
      <div class="item bill-item dashboard-editable ${b.paid ? "bill-paid" : ""}" data-id="${escapeHTML(b.id)}">
        <div><strong>${escapeHTML(b.name)}</strong><small>${escapeHTML(b.date)} · ${b.paid ? "Paid" : "Unpaid"}</small></div>
        <div class="amount">${money(b.amount)}</div>
      </div>
    `).join("")
    : `<div class="item"><div><strong>No bills loaded</strong><small>Add expenses in Setup, then start a cycle</small></div></div>`;

  document.querySelectorAll(".bill-item").forEach(row => {
    row.addEventListener("click", () => openDashboardBillEditModal(row.dataset.id));
  });

  document.getElementById("categoryList").innerHTML = (appData.categories || []).length
    ? appData.categories.map(c => {
      const percent = c.budget > 0 ? Math.round((Number(c.remaining || 0) / Number(c.budget || 0)) * 100) : 0;
      return `
        <div class="item category-item dashboard-editable" data-id="${escapeHTML(c.id)}">
          <div><strong>${escapeHTML(c.name)}</strong><small>${money(c.remaining)} left of ${money(c.budget)}</small></div>
          <div class="amount">${percent}%</div>
        </div>
      `;
    }).join("")
    : `<div class="item"><div><strong>No categories loaded</strong><small>Add variable budgets in Setup, then start a cycle</small></div></div>`;

  document.querySelectorAll(".category-item").forEach(row => {
    row.addEventListener("click", () => openDashboardCategoryEditModal(row.dataset.id));
  });
}

function renderCycle() {
  const unpaidBillsTotal = (appData.bills || [])
    .filter(b => !b.paid)
    .reduce((sum, b) => sum + Number(b.amount || 0), 0);

  const remainingBudgetsTotal = (appData.categories || [])
    .reduce((sum, c) => sum + Number(c.remaining || 0), 0);

  const savingsGoal = Number(appData.cycle?.requiredEndBalance || 0);
  const currentBalance = Number(appData.currentBalance || 0);
  const safeToSpend = calculateSafeToSpend();

  document.querySelector("#cycle h1").textContent =
    `${appData.cycle?.startDate || "No cycle"} – ${appData.cycle?.endDate || "Not started"}`;

  const rows = [
    {
      label: "Current Account Balance",
      value: currentBalance,
      note: "Actual cash in the account right now",
      type: "positive"
    },
    {
      label: "Unpaid Bills",
      value: -unpaidBillsTotal,
      note: "Bills still due this cycle",
      type: "negative"
    },
    {
      label: "Remaining Spending Budgets",
      value: -remainingBudgetsTotal,
      note: "Category money still reserved",
      type: "negative"
    },
    {
      label: "Savings Goal Per Cycle",
      value: -savingsGoal,
      note: "Target balance to preserve",
      type: "negative"
    },
    {
      label: "Safe To Spend",
      value: safeToSpend,
      note: "Money not already spoken for",
      type: safeToSpend < 0 ? "danger" : "total"
    }
  ];

  document.getElementById("cycleSummary").innerHTML = rows.map(row => `
    <div class="money-row cycle-math-row ${row.type}">
      <span>
        ${row.label}
        <small>${row.note}</small>
      </span>
      <strong>${money(row.value)}</strong>
    </div>
  `).join("");
}

function renderTransactions() {
  document.getElementById("transactionList").innerHTML = (appData.transactions || []).length
    ? appData.transactions
      .slice()
      .reverse()
      .map(t => `
        <div class="item">
          <div><strong>${escapeHTML(t.label)}</strong><small>${escapeHTML(t.note || "No note")}</small></div>
          <div class="amount ${Number(t.amount || 0) > 0 ? "positive" : ""}">${money(t.amount)}</div>
        </div>
      `).join("")
    : `<div class="item"><div><strong>No transactions yet</strong><small>Start a cycle or spend money later</small></div></div>`;
}

function renderSetup() {
  ensureRules();

  const monthly = appData.rules.monthlyExpenses;
  const fixed = appData.rules.biWeeklyFixed;
  const variable = appData.rules.biWeeklyVariable;

  document.getElementById("monthlyExpenseList").innerHTML = monthly.length
    ? monthly.map(item => `
      <div class="item setup-edit-item" data-type="monthly" data-id="${escapeHTML(item.id)}">
        <div><strong>${escapeHTML(item.name)}</strong><small>Due day ${escapeHTML(item.dueDay)}</small></div>
        <div class="amount">${money(item.amount)}</div>
      </div>
    `).join("")
    : `<div class="item"><div><strong>No monthly expenses</strong><small>Add one above</small></div></div>`;

  document.getElementById("fixedExpenseList").innerHTML = fixed.length
    ? fixed.map(item => `
      <div class="item setup-edit-item" data-type="fixed" data-id="${escapeHTML(item.id)}">
        <div><strong>${escapeHTML(item.name)}</strong><small>Fixed every cycle</small></div>
        <div class="amount">${money(item.amount)}</div>
      </div>
    `).join("")
    : `<div class="item"><div><strong>No fixed expenses</strong><small>Add one above</small></div></div>`;

  document.getElementById("variableExpenseList").innerHTML = variable.length
    ? variable.map(item => `
      <div class="item setup-edit-item" data-type="variable" data-id="${escapeHTML(item.id)}">
        <div><strong>${escapeHTML(item.name)}</strong><small>Variable budget</small></div>
        <div class="amount">${money(item.amount)}</div>
      </div>
    `).join("")
    : `<div class="item"><div><strong>No variable expenses</strong><small>Add one above</small></div></div>`;

  document.getElementById("carryoverTargetDisplay").innerHTML = `
    <div class="item" id="editSavingsGoalRow">
      <div><strong>Savings Goal</strong><small>Target end balance for each cycle</small></div>
      <div class="amount">${money(appData.cycle?.requiredEndBalance || 0)}</div>
    </div>
  `;

  document.querySelectorAll(".setup-edit-item").forEach(row => {
    row.addEventListener("click", () => openSetupModal("edit", row.dataset.type, row.dataset.id));
  });

  document.getElementById("editSavingsGoalRow").addEventListener("click", setSavingsGoal);
}

function renderAll() {
  renderDashboard();
  renderCycle();
  renderTransactions();
  renderSetup();
}

function switchTab(tabName) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(tabName).classList.add("active");

  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tabName}"]`)?.classList.add("active");

  document.getElementById("quickMenu").classList.remove("open");
}

function getRuleArray(type) {
  ensureRules();
  if (type === "monthly") return appData.rules.monthlyExpenses;
  if (type === "fixed") return appData.rules.biWeeklyFixed;
  if (type === "variable") return appData.rules.biWeeklyVariable;
  return [];
}

/* Generic branded action modal */

function addOneTimeExpenseRow(name = "", amount = "") {
  const list = document.getElementById("oneTimeExpenseList");
  if (!list) return;

  const row = document.createElement("div");
  row.className = "one-time-row";
  row.innerHTML = `
    <input class="field one-time-name" type="text" placeholder="Expense name" value="${escapeHTML(name)}" />
    <input class="field one-time-amount" type="number" inputmode="decimal" placeholder="Amount" value="${escapeHTML(amount)}" />
    <button type="button" class="one-time-remove" aria-label="Remove one-time expense">×</button>
  `;

  row.querySelector(".one-time-remove").addEventListener("click", () => {
    row.remove();
  });

  list.appendChild(row);
}

function readOneTimeExpenseRows() {
  const rows = Array.from(document.querySelectorAll("#oneTimeExpenseList .one-time-row"));
  const expenses = [];

  for (const row of rows) {
    const name = row.querySelector(".one-time-name").value.trim();
    const rawAmount = row.querySelector(".one-time-amount").value;
    const amount = Number(rawAmount);

    if (!name && !rawAmount) continue;

    if (!name || Number.isNaN(amount) || amount <= 0) {
      showNotice("Invalid One-Time Expense", "Each one-time expense needs a name and valid amount, or delete the row.");
      return null;
    }

    expenses.push({ name, amount });
  }

  return expenses;
}

function openActionModal(config) {
  actionModalState = {
    config,
    choice: config.choices && config.choices.length ? config.choices[0].id : null
  };

  document.getElementById("actionModalKicker").textContent = config.kicker || "Action";
  document.getElementById("actionModalTitle").textContent = config.title || "Action";
  document.getElementById("actionModalMessage").textContent = config.message || "";
  document.getElementById("actionModalCancel").textContent = config.dangerText || "Cancel";
  document.getElementById("actionModalConfirm").textContent = config.confirmText || "Continue";

  const actionFieldsEl = document.getElementById("actionModalFields");
  actionFieldsEl.innerHTML = (config.fields || []).map(field => `
    <label class="field-label">${escapeHTML(field.label)}</label>
    <input
      id="action-field-${escapeHTML(field.id)}"
      class="field"
      type="${escapeHTML(field.type || "text")}"
      inputmode="${field.type === "number" ? "decimal" : "text"}"
      value="${escapeHTML(field.value ?? "")}"
      placeholder="${escapeHTML(field.placeholder || "")}"
    />
  `).join("");

  if (config.oneTimeExpenses) {
    actionFieldsEl.innerHTML += `
      <div class="one-time-expense-block">
        <div class="one-time-head">
          <label class="field-label">One-Time Expenses</label>
          <button type="button" class="mini-add-btn" id="addOneTimeExpenseBtn">Add One-Time Expense</button>
        </div>
        <div id="oneTimeExpenseList"></div>
      </div>
    `;
  }

  const choicesWrap = document.getElementById("actionModalChoices");
  choicesWrap.innerHTML = (config.choices || []).map((choice, index) => `
    <button class="choice-button ${index === 0 ? "selected" : ""}" data-choice="${escapeHTML(choice.id)}">
      <strong>${escapeHTML(choice.title)}</strong>
      <small>${escapeHTML(choice.subtitle || "")}</small>
    </button>
  `).join("");

  choicesWrap.querySelectorAll(".choice-button").forEach(button => {
    button.addEventListener("click", () => {
      actionModalState.choice = button.dataset.choice;
      choicesWrap.querySelectorAll(".choice-button").forEach(b => b.classList.remove("selected"));
      button.classList.add("selected");
    });
  });

  const addOneTimeBtn = document.getElementById("addOneTimeExpenseBtn");
  if (addOneTimeBtn) {
    addOneTimeBtn.addEventListener("click", () => addOneTimeExpenseRow());
  }

  document.getElementById("actionModal").classList.add("open");

  const firstField = document.querySelector("#actionModalFields .field");
  if (firstField) setTimeout(() => firstField.focus(), 80);
}

function closeActionModal() {
  document.getElementById("actionModal").classList.remove("open");
  actionModalState = null;
}

function confirmActionModal() {
  if (!actionModalState) return;

  const config = actionModalState.config;
  const values = { choice: actionModalState.choice };

  (config.fields || []).forEach(field => {
    values[field.id] = document.getElementById(`action-field-${field.id}`).value;
  });

  if (config.oneTimeExpenses) {
    const oneTimeExpenses = readOneTimeExpenseRows();
    if (oneTimeExpenses === null) return;
    values.oneTimeExpenses = oneTimeExpenses;
  }

  const shouldClose = config.onConfirm ? config.onConfirm(values) : true;

  if (shouldClose !== false) {
    closeActionModal();
  }
}

function showNotice(title, message) {
  openActionModal({
    kicker: "Notice",
    title,
    message,
    confirmText: "OK",
    dangerText: "Close",
    onConfirm: () => true
  });
}


function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function dateFromISOInput(value) {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3) return null;

  const [year, month, day] = parts;
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

/* New Cycle */
function startNewCycle() {
  openActionModal({
    kicker: "New Cycle",
    title: "Start New Cycle",
    message: "Enter your account balance and choose the cycle start date. The app will build a 14-day budget from that date.",
    fields: [
      { id: "newCycleBalance", label: "Current Account Balance", type: "number", value: appData.currentBalance || "" },
      { id: "newCycleStartDate", label: "Cycle Start Date", type: "date", value: todayISODate() }
    ],
    oneTimeExpenses: true,
    confirmText: "Generate Cycle",
    dangerText: "Cancel",
    onConfirm: values => {
      const balance = Number(values.newCycleBalance);
      const start = dateFromISOInput(values.newCycleStartDate);

      if (Number.isNaN(balance)) {
        showNotice("Invalid Amount", "Enter a valid account balance.");
        return false;
      }

      if (!start || Number.isNaN(start.getTime())) {
        showNotice("Invalid Date", "Choose a valid cycle start date.");
        return false;
      }

      const end = new Date(start);
      end.setDate(start.getDate() + 14);

      appData.currentBalance = balance;
      appData.cycle = {
        startDate: formatDate(start),
        endDate: formatDate(end),
        startDateISO: formatDateWithYear(start),
        endDateISO: formatDateWithYear(end),
        requiredEndBalance: Number(appData.cycle?.requiredEndBalance || 0),
        createdAt: new Date().toISOString()
      };

      appData.bills = [];
      appData.categories = [];
      syncCurrentCycleFromRules();

      const oneTimeExpenses = Array.isArray(values.oneTimeExpenses) ? values.oneTimeExpenses : [];

      oneTimeExpenses.forEach(expense => {
        appData.bills.push({
          id: crypto.randomUUID(),
          ruleId: null,
          type: "oneTime",
          name: expense.name,
          date: "This cycle",
          amount: expense.amount,
          paid: false
        });
      });

      appData.transactions = [{
        id: crypto.randomUUID(),
        label: "New Cycle",
        note: `Started ${formatDate(start)} with ${money(balance)}`,
        amount: 0,
        date: new Date().toISOString()
      }];

      saveData();
      renderAll();
      switchTab("cycle");
      closeActionModal();
      openBudgetBriefing();
      return false;
    }
  });
}

/* Setup Modal */
function openSetupModal(mode, type, id = "") {
  const isMonthly = type === "monthly";
  const labels = {
    monthly: "Monthly Expense",
    fixed: "Bi-Weekly Fixed",
    variable: "Bi-Weekly Variable"
  };

  const arr = getRuleArray(type);
  const item = id ? arr.find(x => x.id === id) : null;

  document.getElementById("setupEditMode").value = mode;
  document.getElementById("setupEditType").value = type;
  document.getElementById("setupEditId").value = id || "";
  document.getElementById("setupModalKicker").textContent = mode === "edit" ? "Edit Rule" : "New Rule";
  document.getElementById("setupModalTitle").textContent = labels[type] || "Setup Item";
  document.getElementById("setupNameInput").value = item?.name || "";
  document.getElementById("setupAmountInput").value = item?.amount ?? "";
  document.getElementById("setupDueDayInput").value = item?.dueDay ?? "";
  document.getElementById("setupDueDayWrap").style.display = isMonthly ? "block" : "none";
  document.getElementById("deleteSetupItemBtn").style.display = mode === "edit" ? "block" : "none";

  document.getElementById("setupModal").classList.add("open");
  setTimeout(() => document.getElementById("setupNameInput").focus(), 80);
}

function closeSetupModal() {
  document.getElementById("setupModal").classList.remove("open");
}

function saveSetupItemFromModal() {
  const mode = document.getElementById("setupEditMode").value;
  const type = document.getElementById("setupEditType").value;
  const id = document.getElementById("setupEditId").value;

  const name = document.getElementById("setupNameInput").value.trim();
  const amount = Number(document.getElementById("setupAmountInput").value);
  const dueDay = Number(document.getElementById("setupDueDayInput").value);

  if (!name) {
    showNotice("Missing Name", "Name is required.");
    return;
  }

  if (Number.isNaN(amount)) {
    showNotice("Invalid Amount", "Enter a valid amount.");
    return;
  }

  if (type === "monthly" && (Number.isNaN(dueDay) || dueDay < 1 || dueDay > 31)) {
    showNotice("Invalid Due Day", "Enter a valid due day from 1 to 31.");
    return;
  }

  const arr = getRuleArray(type);

  if (mode === "edit") {
    const item = arr.find(x => x.id === id);
    if (!item) return;

    item.name = name;
    item.amount = amount;
    if (type === "monthly") item.dueDay = dueDay;
  } else {
    arr.push({
      id: crypto.randomUUID(),
      name,
      amount,
      ...(type === "monthly" ? { dueDay } : {})
    });
  }

  syncCurrentCycleFromRules();
  saveData();
  renderAll();
  closeSetupModal();
}

function deleteSetupItemFromModal() {
  const type = document.getElementById("setupEditType").value;
  const id = document.getElementById("setupEditId").value;

  openActionModal({
    kicker: "Delete Rule",
    title: "Delete This Item?",
    message: "This removes it from your setup rules and updates the current cycle.",
    confirmText: "Delete",
    dangerText: "Cancel",
    onConfirm: () => {
      const arr = getRuleArray(type);
      const index = arr.findIndex(x => x.id === id);

      if (index >= 0) arr.splice(index, 1);

      syncCurrentCycleFromRules();
      saveData();
      renderAll();
      closeSetupModal();
      return true;
    }
  });
}

function setSavingsGoal() {
  openActionModal({
    kicker: "Setup",
    title: "Savings Goal Per Cycle",
    message: "Set the amount you want preserved at the end of each cycle.",
    fields: [
      { id: "savingsGoal", label: "Savings Goal", type: "number", value: appData.cycle?.requiredEndBalance || 0 }
    ],
    confirmText: "Save Goal",
    dangerText: "Cancel",
    onConfirm: values => {
      const amount = Number(values.savingsGoal);

      if (Number.isNaN(amount)) {
        showNotice("Invalid Amount", "Enter a valid savings goal.");
        return false;
      }

      appData.cycle.requiredEndBalance = amount;
      saveData();
      renderAll();
      return true;
    }
  });
}

/* Spend Modal */
function spendMoney() {
  if (!appData.categories || appData.categories.length === 0) {
    showNotice("No Categories", "Add variable expenses in Setup, then start a new cycle.");
    return;
  }

  const select = document.getElementById("spendCategorySelect");
  select.innerHTML = appData.categories.map((category, index) => `
    <option value="${index}">${escapeHTML(category.name)} — ${money(category.remaining)} left</option>
  `).join("");

  document.getElementById("spendAmountInput").value = "";
  document.getElementById("spendNoteInput").value = "";
  document.getElementById("spendModal").classList.add("open");
  setTimeout(() => document.getElementById("spendAmountInput").focus(), 80);
}

function closeSpendModal() {
  document.getElementById("spendModal").classList.remove("open");
}

function saveSpendFromModal() {
  const index = Number(document.getElementById("spendCategorySelect").value);
  const category = appData.categories[index];

  if (!category) {
    showNotice("Invalid Category", "Choose a valid spending category.");
    return;
  }

  const amount = Number(document.getElementById("spendAmountInput").value);

  if (Number.isNaN(amount) || amount <= 0) {
    showNotice("Invalid Amount", "Enter a valid amount.");
    return;
  }

  const note = document.getElementById("spendNoteInput").value || "";

  category.remaining = Number(category.remaining || 0) - amount;
  appData.currentBalance = Number(appData.currentBalance || 0) - amount;

  appData.transactions.push({
    id: crypto.randomUUID(),
    label: category.name,
    note: note.trim() || "Expense",
    amount: -amount,
    date: new Date().toISOString()
  });

  saveData();
  renderAll();
  closeSpendModal();
}

/* Income Modal */
function addIncome() {
  document.getElementById("incomeAmountInput").value = "";
  document.getElementById("incomeNoteInput").value = "";
  document.getElementById("incomeModal").classList.add("open");
  setTimeout(() => document.getElementById("incomeAmountInput").focus(), 80);
}

function closeIncomeModal() {
  document.getElementById("incomeModal").classList.remove("open");
}

function saveIncomeFromModal() {
  const amount = Number(document.getElementById("incomeAmountInput").value);

  if (Number.isNaN(amount) || amount <= 0) {
    showNotice("Invalid Amount", "Enter a valid income amount.");
    return;
  }

  const note = document.getElementById("incomeNoteInput").value || "";

  appData.currentBalance = Number(appData.currentBalance || 0) + amount;

  appData.transactions.push({
    id: crypto.randomUUID(),
    label: "Income",
    note: note.trim() || "Income added",
    amount,
    date: new Date().toISOString()
  });

  saveData();
  renderAll();
  closeIncomeModal();
}

/* Bill Modal */
function openBillModal(billId) {
  const bill = (appData.bills || []).find(b => b.id === billId);
  if (!bill) return;

  document.getElementById("billEditId").value = bill.id;
  document.getElementById("billModalTitle").textContent = bill.name;
  document.getElementById("billModalStatus").textContent = bill.paid ? "Paid" : "Unpaid";
  document.getElementById("billModalAmount").textContent = money(bill.amount);
  document.getElementById("toggleBillPaidBtn").textContent = bill.paid ? "Mark Unpaid" : "Mark Paid";

  document.getElementById("billModal").classList.add("open");
}

function closeBillModal() {
  document.getElementById("billModal").classList.remove("open");
}

function toggleBillPaidFromModal() {
  const billId = document.getElementById("billEditId").value;
  const bill = (appData.bills || []).find(b => b.id === billId);

  if (!bill) return;

  const amount = Number(bill.amount || 0);
  bill.paid = !bill.paid;

  if (bill.paid) {
    appData.currentBalance = Number(appData.currentBalance || 0) - amount;
  } else {
    appData.currentBalance = Number(appData.currentBalance || 0) + amount;
  }

  appData.transactions.push({
    id: crypto.randomUUID(),
    label: bill.paid ? `Paid ${bill.name}` : `Unpaid ${bill.name}`,
    note: bill.paid ? "Bill marked paid" : "Bill marked unpaid",
    amount: bill.paid ? -amount : amount,
    date: new Date().toISOString()
  });

  saveData();
  renderAll();
  closeBillModal();
}

function openBillPickerFromMenu() {
  const bills = appData.bills || [];

  if (bills.length === 0) {
    showNotice("No Bills Found", "There are no bills in the current cycle.");
    return;
  }

  const unpaid = bills.filter(b => !b.paid);
  const billList = unpaid.length ? unpaid : bills;

  openActionModal({
    kicker: "Bill Control",
    title: unpaid.length ? "Mark Bill Paid" : "All Bills Paid",
    message: unpaid.length
      ? "Choose a bill to open its control panel."
      : "All bills are already marked paid. Choose one if you need to review or reverse it.",
    choices: billList.map(bill => ({
      id: bill.id,
      title: bill.name,
      subtitle: `${money(bill.amount)} · ${bill.paid ? "Paid" : "Unpaid"} · ${bill.date}`
    })),
    confirmText: "Open Bill",
    dangerText: "Cancel",
    onConfirm: values => {
      if (!values.choice) {
        showNotice("No Bill Selected", "Choose a bill first.");
        return false;
      }

      closeActionModal();
      openBillModal(values.choice);
      return false;
    }
  });
}


/* Dashboard Amount Editor */
function openDashboardBillEditModal(billId) {
  const bill = (appData.bills || []).find(b => b.id === billId);
  if (!bill) return;

  document.getElementById("dashboardEditType").value = "bill";
  document.getElementById("dashboardEditId").value = bill.id;
  document.getElementById("dashboardEditKicker").textContent = "Bill";
  document.getElementById("dashboardEditTitle").textContent = bill.name;
  document.getElementById("dashboardEditAmountLabel").textContent = "Bill Amount";
  document.getElementById("dashboardEditAmountInput").value = Number(bill.amount || 0);
  document.getElementById("markDashboardBillPaidBtn").style.display = "block";
  document.getElementById("markDashboardBillPaidBtn").textContent = bill.paid ? "Mark Bill Unpaid" : "Mark Bill Paid";
  document.getElementById("dashboardEditModal").classList.add("open");
}

function openDashboardCategoryEditModal(categoryId) {
  const category = (appData.categories || []).find(c => c.id === categoryId);
  if (!category) return;

  document.getElementById("dashboardEditType").value = "category";
  document.getElementById("dashboardEditId").value = category.id;
  document.getElementById("dashboardEditKicker").textContent = "Spending Budget";
  document.getElementById("dashboardEditTitle").textContent = category.name;
  document.getElementById("dashboardEditAmountLabel").textContent = "Remaining Amount";
  document.getElementById("dashboardEditAmountInput").value = Number(category.remaining || 0);
  document.getElementById("markDashboardBillPaidBtn").style.display = "none";
  document.getElementById("dashboardEditModal").classList.add("open");
}

function closeDashboardEditModal() {
  document.getElementById("dashboardEditModal").classList.remove("open");
}

function saveDashboardEditFromModal() {
  const type = document.getElementById("dashboardEditType").value;
  const id = document.getElementById("dashboardEditId").value;
  const amount = Number(document.getElementById("dashboardEditAmountInput").value);

  if (Number.isNaN(amount) || amount < 0) {
    showNotice("Invalid Amount", "Enter a valid amount.");
    return;
  }

  if (type === "bill") {
    const bill = (appData.bills || []).find(b => b.id === id);
    if (!bill) {
      showNotice("Bill Not Found", "This bill could not be found.");
      return;
    }

    bill.amount = amount;

    appData.transactions.push({
      id: crypto.randomUUID(),
      label: "Adjusted Bill",
      note: `${bill.name} amount set to ${money(amount)} for this cycle only`,
      amount: 0,
      date: new Date().toISOString()
    });
  }

  if (type === "category") {
    const category = (appData.categories || []).find(c => c.id === id);
    if (!category) {
      showNotice("Category Not Found", "This spending category could not be found.");
      return;
    }

    const spent = Number(category.budget || 0) - Number(category.remaining || 0);

    category.remaining = amount;
    category.budget = Math.max(amount, amount + Math.max(0, spent));

    appData.transactions.push({
      id: crypto.randomUUID(),
      label: "Adjusted Budget",
      note: `${category.name} remaining set to ${money(amount)} for this cycle only`,
      amount: 0,
      date: new Date().toISOString()
    });
  }

  saveData();
  renderAll();
  closeDashboardEditModal();
}

function markDashboardBillPaidFromModal() {
  const type = document.getElementById("dashboardEditType").value;
  const id = document.getElementById("dashboardEditId").value;

  if (type !== "bill") return;

  const bill = (appData.bills || []).find(b => b.id === id);
  if (!bill) {
    showNotice("Bill Not Found", "This bill could not be found.");
    return;
  }

  const amount = Number(bill.amount || 0);
  bill.paid = !bill.paid;

  if (bill.paid) {
    appData.currentBalance = Number(appData.currentBalance || 0) - amount;
  } else {
    appData.currentBalance = Number(appData.currentBalance || 0) + amount;
  }

  appData.transactions.push({
    id: crypto.randomUUID(),
    label: bill.paid ? `Paid ${bill.name}` : `Unpaid ${bill.name}`,
    note: bill.paid ? "Bill marked paid" : "Bill marked unpaid",
    amount: bill.paid ? -amount : amount,
    date: new Date().toISOString()
  });

  saveData();
  renderAll();
  closeDashboardEditModal();
}


/* Correct Balance */
function openCorrectBalanceModal() {
  openActionModal({
    kicker: "Quick Action",
    title: "Correct Balance",
    message: "Set the account balance to match reality.",
    fields: [
      { id: "currentBalance", label: "Current Account Balance", type: "number", value: appData.currentBalance || 0 }
    ],
    confirmText: "Save Balance",
    dangerText: "Cancel",
    onConfirm: values => {
      const value = Number(values.currentBalance);

      if (Number.isNaN(value)) {
        showNotice("Invalid Amount", "Enter a valid account balance.");
        return false;
      }

      appData.currentBalance = value;
      saveData();
      renderAll();
      return true;
    }
  });
}

/* Budget Doctor */
function getDoctorCutPlan(deficit) {
  const categories = (appData.categories || [])
    .filter(c => Number(c.remaining || 0) > 0)
    .sort((a, b) => Number(b.remaining || 0) - Number(a.remaining || 0));

  let remainingDeficit = deficit;
  const cuts = [];

  categories.forEach(category => {
    if (remainingDeficit <= 0) return;

    const available = Number(category.remaining || 0);
    const cut = Math.min(available, remainingDeficit);

    if (cut > 0) {
      cuts.push({ categoryId: category.id, name: category.name, amount: cut });
      remainingDeficit -= cut;
    }
  });

  return { cuts, remainingAfterCuts: remainingDeficit };
}

function applyDoctorCutPlan(plan) {
  plan.cuts.forEach(cut => {
    const category = (appData.categories || []).find(c => c.id === cut.categoryId);
    if (!category) return;

    category.remaining = Number(category.remaining || 0) - cut.amount;
    category.budget = Math.max(0, Number(category.budget || 0) - cut.amount);
  });

  appData.transactions.push({
    id: crypto.randomUUID(),
    label: "Budget Doctor",
    note: "Reduced spending budgets to cover deficit",
    amount: 0,
    date: new Date().toISOString()
  });

  saveData();
  renderAll();
}

function applyDoctorSavingsReduction(deficit) {
  const savingsGoal = Number(appData.cycle?.requiredEndBalance || 0);
  const reduction = Math.min(savingsGoal, deficit);

  appData.cycle.requiredEndBalance = savingsGoal - reduction;

  appData.transactions.push({
    id: crypto.randomUUID(),
    label: "Budget Doctor",
    note: `Reduced savings goal by ${money(reduction)}`,
    amount: 0,
    date: new Date().toISOString()
  });

  saveData();
  renderAll();
}

function applyDoctorIncome(deficit) {
  appData.currentBalance = Number(appData.currentBalance || 0) + deficit;

  appData.transactions.push({
    id: crypto.randomUUID(),
    label: "Income",
    note: "Budget Doctor recovery income",
    amount: deficit,
    date: new Date().toISOString()
  });

  saveData();
  renderAll();
}

function openBudgetBriefing() {
  const state = getBudgetState();
  const safe = state.safe;

  if (state.key === "surplus") {
    openActionModal({
      kicker: "Budget Briefing",
      title: "SURPLUS",
      message: `You're clear. After bills, spending budgets, and savings goal, you still have ${money(safe)} available.`,
      confirmText: "Good",
      dangerText: "Close",
      onConfirm: () => true
    });
    return;
  }

  if (state.key === "onTrack") {
    openActionModal({
      kicker: "Budget Briefing",
      title: "ON TRACK",
      message: `The cycle works. You have ${money(safe)} of margin after everything is accounted for.`,
      confirmText: "Good",
      dangerText: "Close",
      onConfirm: () => true
    });
    return;
  }

  const deficit = Math.abs(safe);
  const cutPlan = getDoctorCutPlan(deficit);
  const cutSubtitle = cutPlan.cuts.length
    ? cutPlan.cuts.map(c => `${c.name} -${money(c.amount)}`).join(" · ") + (cutPlan.remainingAfterCuts > 0 ? ` · Still short ${money(cutPlan.remainingAfterCuts)}` : " · Budget recovered")
    : "No variable spending available to cut";

  const savingsGoal = Number(appData.cycle?.requiredEndBalance || 0);
  const savingsReduction = Math.min(savingsGoal, deficit);
  const savingsSubtitle = savingsReduction > 0
    ? `Reduce savings goal by ${money(savingsReduction)}${deficit > savingsReduction ? ` · Still short ${money(deficit - savingsReduction)}` : " · Budget recovered"}`
    : "No savings goal available to reduce";

  openActionModal({
    kicker: "Budget Doctor",
    title: "DEFICIT DETECTED",
    message: `You are short ${money(deficit)} this cycle. Choose a recovery plan.`,
    choices: [
      { id: "cut", title: "Option 1: Cut Spending Budgets", subtitle: cutSubtitle },
      { id: "savings", title: "Option 2: Reduce Savings Goal", subtitle: savingsSubtitle },
      { id: "income", title: "Option 3: Add Recovery Income", subtitle: `Add ${money(deficit)} income to make the cycle work` }
    ],
    confirmText: "Apply Plan",
    dangerText: "Not Now",
    onConfirm: values => {
      if (values.choice === "cut") {
        if (!cutPlan.cuts.length) {
          showNotice("No Cuts Available", "There are no variable spending budgets to cut.");
          return false;
        }

        applyDoctorCutPlan(cutPlan);
        closeActionModal();
        showNotice("Plan Applied", "Spending budgets were reduced.");
        return false;
      }

      if (values.choice === "savings") {
        if (savingsReduction <= 0) {
          showNotice("No Savings Goal", "There is no savings goal available to reduce.");
          return false;
        }

        applyDoctorSavingsReduction(deficit);
        closeActionModal();
        showNotice("Plan Applied", "Savings goal was reduced.");
        return false;
      }

      if (values.choice === "income") {
        applyDoctorIncome(deficit);
        closeActionModal();
        showNotice("Plan Applied", `${money(deficit)} income was added.`);
        return false;
      }

      return true;
    }
  });
}

/* Events */
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

document.getElementById("fab").addEventListener("click", () => {
  document.getElementById("quickMenu").classList.toggle("open");
});

document.querySelectorAll("#quickMenu button").forEach(btn => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    document.getElementById("quickMenu").classList.remove("open");

    if (action === "spend") spendMoney();
    else if (action === "income") addIncome();
    else if (action === "bill") openBillPickerFromMenu();
    else if (action === "balance") openCorrectBalanceModal();
    else if (action === "cycle") startNewCycle();
    else if (action === "doctor") openBudgetBriefing();
    else showNotice("Coming Soon", `${btn.textContent} will be wired later.`);
  });
});

document.getElementById("newCycleBtn").addEventListener("click", startNewCycle);

document.getElementById("addMonthlyExpenseBtn").addEventListener("click", () => openSetupModal("new", "monthly"));
document.getElementById("addFixedExpenseBtn").addEventListener("click", () => openSetupModal("new", "fixed"));
document.getElementById("addVariableExpenseBtn").addEventListener("click", () => openSetupModal("new", "variable"));
document.getElementById("setCarryoverBtn").addEventListener("click", setSavingsGoal);

const setupActions = document.querySelector(".setup-actions");
const wipeButton = document.createElement("button");
wipeButton.className = "setup-action";
wipeButton.innerHTML = `
  <span class="setup-icon">🧨</span>
  <span>
    <strong>Wipe Data</strong>
    <small>Restore app to fresh install</small>
  </span>
`;
wipeButton.addEventListener("click", () => {
  openActionModal({
    kicker: "Danger Zone",
    title: "Wipe All Data?",
    message: "This will erase all saved budget data and restore the app to a blank fresh install.",
    confirmText: "Continue",
    dangerText: "Cancel",
    onConfirm: () => {
      closeActionModal();

      openActionModal({
        kicker: "Final Confirmation",
        title: "Are You Absolutely Sure?",
        message: "This cannot be undone. All setup rules, cycle data, transactions, bills, and categories will be wiped.",
        confirmText: "Wipe Everything",
        dangerText: "Cancel",
        onConfirm: () => {
          resetData();
          closeActionModal();
          showNotice("Data Wiped", "The app has been restored to a blank fresh install.");
          return false;
        }
      });

      return false;
    }
  });
});
setupActions.appendChild(wipeButton);

document.getElementById("closeActionModal").addEventListener("click", closeActionModal);
document.getElementById("actionModalCancel").addEventListener("click", closeActionModal);
document.getElementById("actionModalConfirm").addEventListener("click", confirmActionModal);
document.getElementById("actionModal").addEventListener("click", event => {
  if (event.target.id === "actionModal") closeActionModal();
});

document.getElementById("closeSetupModal").addEventListener("click", closeSetupModal);
document.getElementById("saveSetupItemBtn").addEventListener("click", saveSetupItemFromModal);
document.getElementById("deleteSetupItemBtn").addEventListener("click", deleteSetupItemFromModal);
document.getElementById("setupModal").addEventListener("click", event => {
  if (event.target.id === "setupModal") closeSetupModal();
});

document.getElementById("closeSpendModal").addEventListener("click", closeSpendModal);
document.getElementById("saveSpendBtn").addEventListener("click", saveSpendFromModal);
document.getElementById("spendModal").addEventListener("click", event => {
  if (event.target.id === "spendModal") closeSpendModal();
});

document.getElementById("closeIncomeModal").addEventListener("click", closeIncomeModal);
document.getElementById("saveIncomeBtn").addEventListener("click", saveIncomeFromModal);
document.getElementById("incomeModal").addEventListener("click", event => {
  if (event.target.id === "incomeModal") closeIncomeModal();
});

document.getElementById("closeBillModal").addEventListener("click", closeBillModal);
document.getElementById("toggleBillPaidBtn").addEventListener("click", toggleBillPaidFromModal);
document.getElementById("billModal").addEventListener("click", event => {
  if (event.target.id === "billModal") closeBillModal();
});

document.getElementById("closeDashboardEditModal").addEventListener("click", closeDashboardEditModal);
document.getElementById("saveDashboardEditBtn").addEventListener("click", saveDashboardEditFromModal);
document.getElementById("dashboardEditModal").addEventListener("click", event => {
  if (event.target.id === "dashboardEditModal") closeDashboardEditModal();
});

document.getElementById("markDashboardBillPaidBtn").addEventListener("click", markDashboardBillPaidFromModal);
renderAll();
