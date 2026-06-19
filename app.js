const STORAGE_KEY = "budgetAppDataV2";

const defaultData = {
  version: 2,
  currentBalance: 0,
  safeToSpend: 0,
  expectedEnd: 0,
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

function cloneDefaultData() {
  return JSON.parse(JSON.stringify(defaultData));
}

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    const fresh = cloneDefaultData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  try {
    const parsed = JSON.parse(saved);
    if (!parsed || parsed.version !== 2) {
      const fresh = cloneDefaultData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    if (!parsed.rules) parsed.rules = { monthlyExpenses: [], biWeeklyFixed: [], biWeeklyVariable: [] };
    if (!parsed.bills) parsed.bills = [];
    if (!parsed.categories) parsed.categories = [];
    if (!parsed.transactions) parsed.transactions = [];
    return parsed;
  } catch {
    const fresh = cloneDefaultData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }
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

function money(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(Number(n || 0)).toFixed(2);
}

function ensureRules() {
  if (!appData.rules) {
    appData.rules = {
      monthlyExpenses: [],
      biWeeklyFixed: [],
      biWeeklyVariable: []
    };
  }
  if (!appData.rules.monthlyExpenses) appData.rules.monthlyExpenses = [];
  if (!appData.rules.biWeeklyFixed) appData.rules.biWeeklyFixed = [];
  if (!appData.rules.biWeeklyVariable) appData.rules.biWeeklyVariable = [];
}

function calculateSafeToSpend() {
  const unpaidBillsTotal = (appData.bills || [])
    .filter(b => !b.paid)
    .reduce((sum, b) => sum + Number(b.amount || 0), 0);

  const remainingCategoriesTotal = (appData.categories || [])
    .reduce((sum, c) => sum + Number(c.remaining || 0), 0);

  const requiredEnd = Number(appData.cycle?.requiredEndBalance || 0);

  return Number(appData.currentBalance || 0) - unpaidBillsTotal - remainingCategoriesTotal - requiredEnd;
}

function getStatus() {
  const safe = calculateSafeToSpend();

  if (safe >= 100) {
    return {
      title: "ON TRACK",
      caption: "Available after bills, spending, and savings goal"
    };
  }

  if (safe >= 0) {
    return {
      title: "TIGHT MARGIN",
      caption: "Covered, but there is not much room"
    };
  }

  return {
    title: "DEFICIT",
    caption: `Short by ${money(Math.abs(safe))}`
  };
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
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
  const monthly = appData.rules.monthlyExpenses || [];
  const bills = [];

  monthly.forEach(rule => {
    const possibleMonths = [
      new Date(start.getFullYear(), start.getMonth(), 1),
      new Date(end.getFullYear(), end.getMonth(), 1)
    ];

    const seen = new Set();

    possibleMonths.forEach(monthDate => {
      const due = dateFromDueDay(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        rule.dueDay
      );

      const key = `${rule.id}-${formatDateWithYear(due)}`;
      if (seen.has(key)) return;
      seen.add(key);

      if (isDateInCycle(due, start, end)) {
        const existing = (appData.bills || []).find(b =>
          b.ruleId === rule.id &&
          b.dueDateISO === formatDateWithYear(due)
        );

        bills.push({
          id: existing?.id || crypto.randomUUID(),
          ruleId: rule.id,
          type: "monthly",
          name: rule.name,
          date: formatDate(due),
          dueDateISO: formatDateWithYear(due),
          amount: Number(rule.amount || 0),
          paid: existing?.paid || false
        });
      }
    });
  });

  return bills;
}

function fixedBillsForCycle() {
  ensureRules();
  const fixed = appData.rules.biWeeklyFixed || [];

  return fixed.map(rule => {
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
  const variable = appData.rules.biWeeklyVariable || [];

  return variable.map(rule => {
    const existing = (appData.categories || []).find(c => c.ruleId === rule.id);
    const oldBudget = Number(existing?.budget || rule.amount || 0);
    const newBudget = Number(rule.amount || 0);
    const spent = existing ? oldBudget - Number(existing.remaining || 0) : 0;

    return {
      id: existing?.id || crypto.randomUUID(),
      ruleId: rule.id,
      name: rule.name,
      budget: newBudget,
      remaining: newBudget - spent
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

function startNewCycle() {
  ensureRules();

  const value = prompt("Current account balance?", appData.currentBalance);
  if (value === null) return;

  const balance = Number(value);

  if (Number.isNaN(balance)) {
    alert("Enter a valid number.");
    return;
  }

  const start = new Date();
  const end = new Date();
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

  appData.transactions = [{
    id: crypto.randomUUID(),
    label: "New Cycle",
    note: `Started with ${money(balance)}`,
    amount: 0,
    date: new Date().toISOString()
  }];

  saveData();
  renderAll();
  switchTab("cycle");

  alert("New cycle generated from Setup rules.");
}

function renderDashboard() {
  const safe = calculateSafeToSpend();
  const status = getStatus();

  document.getElementById("statusTitle").textContent = status.title;
  document.querySelector(".hero-card .caption").textContent = status.caption;
  document.getElementById("safeToSpend").textContent = money(safe);
  document.getElementById("currentBalance").textContent = money(appData.currentBalance);
  document.getElementById("expectedEnd").textContent = money(safe + Number(appData.cycle?.requiredEndBalance || 0));

  document.getElementById("billList").innerHTML = (appData.bills || []).length
    ? appData.bills.map(b => `
      <div class="item bill-item ${b.paid ? "bill-paid" : ""}" data-id="${b.id}">
        <div><strong>${b.name}</strong><small>${b.date}${b.paid ? " · Paid" : " · Unpaid"}</small></div>
        <div class="amount">${money(b.amount)}</div>
      </div>
    `).join("")
    : `<div class="item"><div><strong>No bills loaded</strong><small>Add expenses in Setup, then start a cycle</small></div></div>`;

  document.querySelectorAll(".bill-item").forEach(row => {
    row.addEventListener("click", () => openBillModal(row.dataset.id));
  });

  document.getElementById("categoryList").innerHTML = (appData.categories || []).length
    ? appData.categories.map(c => {
      const percent = c.budget > 0 ? Math.round((c.remaining / c.budget) * 100) : 0;
      return `
        <div class="item">
          <div><strong>${c.name}</strong><small>${money(c.remaining)} left of ${money(c.budget)}</small></div>
          <div class="amount">${percent}%</div>
        </div>
      `;
    }).join("")
    : `<div class="item"><div><strong>No categories loaded</strong><small>Add variable budgets in Setup, then start a cycle</small></div></div>`;
}

function renderCycle() {
  const unpaidBillsTotal = (appData.bills || [])
    .filter(b => !b.paid)
    .reduce((sum, b) => sum + Number(b.amount || 0), 0);

  const remainingCategoriesTotal = (appData.categories || [])
    .reduce((sum, c) => sum + Number(c.remaining || 0), 0);

  const requiredEnd = Number(appData.cycle?.requiredEndBalance || 0);
  const safe = calculateSafeToSpend();

  const rows = [
    ["Current Balance", appData.currentBalance],
    ["Unpaid Bills", -unpaidBillsTotal],
    ["Remaining Categories", -remainingCategoriesTotal],
    ["Savings Goal", -requiredEnd],
    ["Safe To Spend", safe]
  ];

  document.querySelector("#cycle h1").textContent = `${appData.cycle?.startDate || "No cycle"} – ${appData.cycle?.endDate || "Not started"}`;

  document.getElementById("cycleSummary").innerHTML = rows.map(r => `
    <div class="money-row">
      <span>${r[0]}</span>
      <strong>${money(r[1])}</strong>
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
          <div><strong>${t.label}</strong><small>${t.note || "No note"}</small></div>
          <div class="amount ${Number(t.amount || 0) > 0 ? "positive" : ""}">${money(t.amount)}</div>
        </div>
      `).join("")
    : `<div class="item"><div><strong>No transactions yet</strong><small>Start a cycle or spend money later</small></div></div>`;
}

function renderSetup() {
  ensureRules();

  const monthly = appData.rules.monthlyExpenses || [];
  const fixed = appData.rules.biWeeklyFixed || [];
  const variable = appData.rules.biWeeklyVariable || [];

  document.getElementById("monthlyExpenseList").innerHTML = monthly.length
    ? monthly.map(item => `
      <div class="item setup-edit-item" data-type="monthly" data-id="${item.id}">
        <div><strong>${item.name}</strong><small>Due day ${item.dueDay}</small></div>
        <div class="amount">${money(item.amount)}</div>
      </div>
    `).join("")
    : `<div class="item"><div><strong>No monthly expenses</strong><small>Add one above</small></div></div>`;

  document.getElementById("fixedExpenseList").innerHTML = fixed.length
    ? fixed.map(item => `
      <div class="item setup-edit-item" data-type="fixed" data-id="${item.id}">
        <div><strong>${item.name}</strong><small>Fixed every cycle</small></div>
        <div class="amount">${money(item.amount)}</div>
      </div>
    `).join("")
    : `<div class="item"><div><strong>No fixed expenses</strong><small>Add one above</small></div></div>`;

  document.getElementById("variableExpenseList").innerHTML = variable.length
    ? variable.map(item => `
      <div class="item setup-edit-item" data-type="variable" data-id="${item.id}">
        <div><strong>${item.name}</strong><small>Variable budget</small></div>
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

  document.getElementById("editSavingsGoalRow").addEventListener("click", setCarryoverTarget);
}

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

  bill.paid = !bill.paid;

  appData.transactions.push({
    id: crypto.randomUUID(),
    label: bill.paid ? `Paid ${bill.name}` : `Unpaid ${bill.name}`,
    note: bill.paid ? "Bill marked paid" : "Bill marked unpaid",
    amount: bill.paid ? -Number(bill.amount || 0) : Number(bill.amount || 0),
    date: new Date().toISOString()
  });

  if (bill.paid) {
    appData.currentBalance = Number(appData.currentBalance || 0) - Number(bill.amount || 0);
  } else {
    appData.currentBalance = Number(appData.currentBalance || 0) + Number(bill.amount || 0);
  }

  saveData();
  renderAll();
  closeBillModal();
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
    alert("Name is required.");
    return;
  }

  if (Number.isNaN(amount)) {
    alert("Enter a valid amount.");
    return;
  }

  if (type === "monthly" && (Number.isNaN(dueDay) || dueDay < 1 || dueDay > 31)) {
    alert("Enter a valid due day from 1 to 31.");
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

  const confirmed = confirm("Delete this item?");
  if (!confirmed) return;

  const arr = getRuleArray(type);
  const index = arr.findIndex(x => x.id === id);

  if (index >= 0) {
    arr.splice(index, 1);
  }

  syncCurrentCycleFromRules();
  saveData();
  renderAll();
  closeSetupModal();
}

function setCarryoverTarget() {
  const amount = Number(prompt("Savings goal per cycle?", appData.cycle?.requiredEndBalance || 0));

  if (Number.isNaN(amount)) {
    alert("Enter a valid amount.");
    return;
  }

  appData.cycle.requiredEndBalance = amount;
  saveData();
  renderAll();
}

function spendMoney() {
  if (!appData.categories || appData.categories.length === 0) {
    alert("No spending categories found. Add variable expenses in Setup, then start a new cycle.");
    return;
  }

  const select = document.getElementById("spendCategorySelect");
  select.innerHTML = appData.categories.map((category, index) => `
    <option value="${index}">${category.name} — ${money(category.remaining)} left</option>
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
    alert("Invalid category.");
    return;
  }

  const amount = Number(document.getElementById("spendAmountInput").value);

  if (Number.isNaN(amount) || amount <= 0) {
    alert("Enter a valid amount.");
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

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

document.getElementById("fab").addEventListener("click", () => {
  document.getElementById("quickMenu").classList.toggle("open");
});


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
    alert("Enter a valid income amount.");
    return;
  }

  const note = document.getElementById("incomeNoteInput").value || "";

  appData.currentBalance = Number(appData.currentBalance || 0) + amount;

  appData.transactions.push({
    id: crypto.randomUUID(),
    label: "Income",
    note: note.trim() || "Income added",
    amount: amount,
    date: new Date().toISOString()
  });

  saveData();
  renderAll();
  closeIncomeModal();
}

document.querySelectorAll("#quickMenu button").forEach(btn => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;

    if (action === "spend") {
      spendMoney();
    } else if (action === "income") {
      addIncome();
    } else if (action === "balance") {
      const value = prompt("Current account balance?", appData.currentBalance);
      if (value !== null && !Number.isNaN(Number(value))) {
        appData.currentBalance = Number(value);
        saveData();
        renderAll();
      }
    } else if (action === "cycle") {
      startNewCycle();
    } else {
      alert(`${btn.textContent} will be wired in a later phase.`);
    }

    document.getElementById("quickMenu").classList.remove("open");
  });
});

document.getElementById("newCycleBtn").addEventListener("click", startNewCycle);

document.getElementById("addMonthlyExpenseBtn").addEventListener("click", () => openSetupModal("new", "monthly"));
document.getElementById("addFixedExpenseBtn").addEventListener("click", () => openSetupModal("new", "fixed"));
document.getElementById("addVariableExpenseBtn").addEventListener("click", () => openSetupModal("new", "variable"));
document.getElementById("setCarryoverBtn").addEventListener("click", setCarryoverTarget);

const setupActions = document.querySelector(".setup-actions");
const resetButton = document.createElement("button");
resetButton.className = "setup-action";
resetButton.innerHTML = `
  <span class="setup-icon">🧨</span>
  <span>
    <strong>Wipe Data</strong>
    <small>Restore app to fresh install</small>
  </span>
`;
resetButton.addEventListener("click", () => {
  const firstConfirm = confirm("Wipe all saved budget data? This cannot be undone.");
  if (!firstConfirm) return;

  const secondConfirm = confirm("Final confirmation: erase everything and restore the app to fresh out-of-the-box data?");
  if (!secondConfirm) return;

  resetData();
  alert("Data wiped. App restored to blank fresh install.");
});
setupActions.appendChild(resetButton);

document.getElementById("closeSpendModal").addEventListener("click", closeSpendModal);
document.getElementById("saveSpendBtn").addEventListener("click", saveSpendFromModal);
document.getElementById("spendModal").addEventListener("click", event => {
  if (event.target.id === "spendModal") closeSpendModal();
});

document.getElementById("closeSetupModal").addEventListener("click", closeSetupModal);
document.getElementById("saveSetupItemBtn").addEventListener("click", saveSetupItemFromModal);
document.getElementById("deleteSetupItemBtn").addEventListener("click", deleteSetupItemFromModal);
document.getElementById("setupModal").addEventListener("click", event => {
  if (event.target.id === "setupModal") closeSetupModal();
});

document.getElementById("closeBillModal").addEventListener("click", closeBillModal);
document.getElementById("toggleBillPaidBtn").addEventListener("click", toggleBillPaidFromModal);
document.getElementById("billModal").addEventListener("click", event => {
  if (event.target.id === "billModal") closeBillModal();
});

document.getElementById("closeIncomeModal").addEventListener("click", closeIncomeModal);
document.getElementById("saveIncomeBtn").addEventListener("click", saveIncomeFromModal);
document.getElementById("incomeModal").addEventListener("click", event => {
  if (event.target.id === "incomeModal") closeIncomeModal();
});

renderAll();
