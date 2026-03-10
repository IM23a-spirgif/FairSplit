import { useEffect, useMemo, useState } from "react";
import {
  addExpenseToGroup,
  deleteExpenseFromGroup,
  sanitizeExpenseForPeople,
  syncExpensesWithPeople,
  type Expense,
  type Person,
  updateExpenseInGroup,
} from "./modules/expenses";

type GroupData = {
  groupName: string;
  people: Person[];
  expenses: Expense[];
};

type Balance = {
  personId: string;
  paid: number;
  owed: number;
  net: number;
};

type Settlement = {
  fromId: string;
  toId: string;
  amount: number;
};

const STORAGE_KEY = "fairsplit-data-v1";

const defaultData: GroupData = {
  groupName: "FairSplit - Ausgaben-Splitter",
  people: [
    { id: crypto.randomUUID(), name: "Alex" },
    { id: crypto.randomUUID(), name: "Mira" },
    { id: crypto.randomUUID(), name: "Sam" },
  ],
  expenses: [],
};

const currency = new Intl.NumberFormat("de-CH", {
  style: "currency",
  currency: "CHF",
  maximumFractionDigits: 2,
});

const categories = [
  "Allgemein",
  "Lebensmittel",
  "Transport",
  "Unterkunft",
  "Freizeit",
  "Sonstiges",
];

const createEmptyExpense = (people: Person[]): Expense => ({
  id: crypto.randomUUID(),
  title: "",
  amount: 0,
  payerId: people[0]?.id ?? "",
  participantIds: people.map((person) => person.id),
  category: categories[0],
  date: new Date().toISOString().slice(0, 10),
  note: "",
});

const loadData = (): GroupData => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultData;
  }
  try {
    const parsed = JSON.parse(raw) as GroupData;
    return {
      groupName: parsed.groupName || defaultData.groupName,
      people: parsed.people ?? [],
      expenses: parsed.expenses ?? [],
    };
  } catch {
    return defaultData;
  }
};

const calculateBalances = (
  people: Person[],
  expenses: Expense[]
): Balance[] => {
  const balances: Balance[] = people.map((person) => ({
    personId: person.id,
    paid: 0,
    owed: 0,
    net: 0,
  }));

  const balanceMap = new Map(
    balances.map((balance) => [balance.personId, balance])
  );

  expenses.forEach((expense) => {
    const share = expense.participantIds.length
      ? expense.amount / expense.participantIds.length
      : 0;
    const payerBalance = balanceMap.get(expense.payerId);
    if (payerBalance) {
      payerBalance.paid += expense.amount;
    }
    expense.participantIds.forEach((participantId) => {
      const participantBalance = balanceMap.get(participantId);
      if (participantBalance) {
        participantBalance.owed += share;
      }
    });
  });

  balances.forEach((balance) => {
    balance.net = balance.paid - balance.owed;
  });

  return balances;
};

const calculateSettlements = (balances: Balance[]): Settlement[] => {
  const creditors = balances
    .filter((balance) => balance.net > 0.01)
    .map((balance) => ({ ...balance }));
  const debtors = balances
    .filter((balance) => balance.net < -0.01)
    .map((balance) => ({ ...balance, net: Math.abs(balance.net) }));

  const settlements: Settlement[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = Math.min(creditor.net, debtor.net);

    settlements.push({
      fromId: debtor.personId,
      toId: creditor.personId,
      amount,
    });

    creditor.net -= amount;
    debtor.net -= amount;

    if (creditor.net <= 0.01) {
      creditorIndex += 1;
    }
    if (debtor.net <= 0.01) {
      debtorIndex += 1;
    }
  }

  return settlements;
};

const downloadFile = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const toCsv = (data: GroupData) => {
  const headers = [
    "Titel",
    "Betrag",
    "Zahler",
    "Beteiligte",
    "Datum",
    "Kategorie",
    "Notiz",
  ];
  const peopleMap = new Map(
    data.people.map((person) => [person.id, person.name])
  );
  const rows = data.expenses.map((expense) => [
    expense.title,
    expense.amount.toFixed(2),
    peopleMap.get(expense.payerId) ?? "",
    expense.participantIds
      .map((participantId) => peopleMap.get(participantId) ?? "")
      .join("|"),
    expense.date,
    expense.category,
    expense.note.replace(/\n/g, " "),
  ]);
  const body = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(";"))
    .join("\n");
  return body;
};

const App = () => {
  const [data, setData] = useState<GroupData>(() => loadData());
  const [newPerson, setNewPerson] = useState("");
  const [expenseDraft, setExpenseDraft] = useState<Expense>(() =>
    createEmptyExpense(data.people)
  );
  const [categoryFilter, setCategoryFilter] = useState("Alle");
  const [searchTerm, setSearchTerm] = useState("");
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    setExpenseDraft((current) => ({
      ...current,
      payerId: data.people[0]?.id ?? "",
      participantIds: data.people.map((person) => person.id),
    }));
  }, [data.people]);

  const balances = useMemo(
    () => calculateBalances(data.people, data.expenses),
    [data.people, data.expenses]
  );

  const settlements = useMemo(() => calculateSettlements(balances), [balances]);

  const filteredExpenses = useMemo(() => {
    return data.expenses.filter((expense) => {
      if (categoryFilter !== "Alle" && expense.category !== categoryFilter) {
        return false;
      }
      if (!searchTerm.trim()) {
        return true;
      }
      const search = searchTerm.toLowerCase();
      return (
        expense.title.toLowerCase().includes(search) ||
        expense.note.toLowerCase().includes(search)
      );
    });
  }, [data.expenses, categoryFilter, searchTerm]);

  const updateGroupName = (value: string) => {
    setData((current) => ({ ...current, groupName: value }));
  };

  const addPerson = () => {
    if (!newPerson.trim()) {
      return;
    }
    const person = { id: crypto.randomUUID(), name: newPerson.trim() };
    setData((current) => ({
      ...current,
      people: [...current.people, person],
    }));
    setNewPerson("");
  };

  const removePerson = (personId: string) => {
    setData((current) => ({
      ...current,
      people: current.people.filter((person) => person.id !== personId),
      expenses: syncExpensesWithPeople(
        current.expenses,
        current.people.filter((person) => person.id !== personId)
      ),
    }));
  };

  const saveExpense = () => {
    if (!expenseDraft.title.trim() || expenseDraft.amount <= 0) {
      return;
    }

    const sanitizedExpense = sanitizeExpenseForPeople(expenseDraft, data.people);

    setData((current) => ({
      ...current,
      expenses: editingExpenseId
        ? updateExpenseInGroup(current.expenses, sanitizedExpense, current.people)
        : addExpenseToGroup(
            current.expenses,
            { ...sanitizedExpense, id: crypto.randomUUID() },
            current.people
          ),
    }));

    setEditingExpenseId(null);
    setExpenseDraft(createEmptyExpense(data.people));
  };

  const removeExpense = (expenseId: string) => {
    setData((current) => ({
      ...current,
      expenses: deleteExpenseFromGroup(current.expenses, expenseId),
    }));

    if (editingExpenseId === expenseId) {
      setEditingExpenseId(null);
      setExpenseDraft(createEmptyExpense(data.people));
    }
  };

  const editExpense = (expense: Expense) => {
    setExpenseDraft(expense);
    setEditingExpenseId(expense.id);
  };

  const resetExpenseForm = () => {
    setEditingExpenseId(null);
    setExpenseDraft(createEmptyExpense(data.people));
  };

  const toggleParticipant = (personId: string) => {
    setExpenseDraft((current) => {
      const isSelected = current.participantIds.includes(personId);
      const participantIds = isSelected
        ? current.participantIds.filter((id) => id !== personId)
        : [...current.participantIds, personId];
      return {
        ...current,
        participantIds,
      };
    });
  };

  const exportJson = () => {
    downloadFile(
      JSON.stringify(data, null, 2),
      "fairsplit-export.json",
      "application/json"
    );
  };

  const exportCsv = () => {
    downloadFile(toCsv(data), "fairsplit-expenses.csv", "text/csv");
  };

  const importJson = (file: File) => {
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as GroupData;
        setData({
          groupName: parsed.groupName || defaultData.groupName,
          people: parsed.people ?? [],
          expenses: parsed.expenses ?? [],
        });
      } catch {
        alert("Import fehlgeschlagen. Bitte JSON prüfen.");
      }
    });
  };

  const peopleMap = useMemo(
    () => new Map(data.people.map((person) => [person.id, person.name])),
    [data.people]
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-400">
              Projektantrag
            </p>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-2xl font-semibold text-slate-900 shadow-sm"
              value={data.groupName}
              onChange={(event) => updateGroupName(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-slate-600">
            <div className="rounded-full bg-slate-100 px-3 py-1">
              SPA · React · Vite
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-1">
              Speicherung lokal
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[2fr_1fr]">
        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              Teilnehmer & Rollen
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Teilnehmer hinzufügen, entfernen und als Zahler auswählen.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {data.people.map((person) => (
                <div
                  key={person.id}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm"
                >
                  <span>{person.name}</span>
                  {data.people.length > 1 && (
                    <button
                      className="text-slate-400 hover:text-slate-600"
                      onClick={() => removePerson(person.id)}
                      aria-label={`${person.name} entfernen`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Name hinzufügen"
                value={newPerson}
                onChange={(event) => setNewPerson(event.target.value)}
              />
              <button
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                onClick={addPerson}
              >
                Hinzufügen
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Ausgaben</h2>
            <p className="mt-1 text-sm text-slate-500">
              Belege erfassen, Zahler wählen und Beteiligte definieren.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Titel (z.B. Einkauf)"
                value={expenseDraft.title}
                onChange={(event) =>
                  setExpenseDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
              <input
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Betrag"
                type="number"
                min="0"
                step="0.01"
                value={expenseDraft.amount || ""}
                onChange={(event) =>
                  setExpenseDraft((current) => ({
                    ...current,
                    amount: Number(event.target.value),
                  }))
                }
              />
              <select
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={expenseDraft.payerId}
                onChange={(event) =>
                  setExpenseDraft((current) => ({
                    ...current,
                    payerId: event.target.value,
                  }))
                }
              >
                {data.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    Zahler: {person.name}
                  </option>
                ))}
              </select>
              <input
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                type="date"
                value={expenseDraft.date}
                onChange={(event) =>
                  setExpenseDraft((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
              />
              <select
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={expenseDraft.category}
                onChange={(event) =>
                  setExpenseDraft((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <input
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Notiz"
                value={expenseDraft.note}
                onChange={(event) =>
                  setExpenseDraft((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
              />
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium text-slate-600">
                Beteiligte auswählen
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.people.map((person) => {
                  const selected = expenseDraft.participantIds.includes(
                    person.id
                  );
                  return (
                    <button
                      key={person.id}
                      className={`rounded-full border px-3 py-1 text-sm ${
                        selected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                      onClick={() => toggleParticipant(person.id)}
                    >
                      {person.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white"
                onClick={saveExpense}
              >
                {editingExpenseId ? "Änderung speichern" : "Ausgabe speichern"}
              </button>
              <button
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={resetExpenseForm}
              >
                {editingExpenseId ? "Bearbeitung abbrechen" : "Formular leeren"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Ausgabenliste
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Filtere nach Kategorie oder suche Stichworte.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  {["Alle", ...categories].map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Suche"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {filteredExpenses.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                  Noch keine Ausgaben gespeichert.
                </div>
              ) : (
                filteredExpenses.map((expense) => (
                  <div
                    key={expense.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {expense.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {expense.date} · {expense.category} ·{" "}
                        {peopleMap.get(expense.payerId)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Beteiligte:{" "}
                        {expense.participantIds
                          .map((id) => peopleMap.get(id))
                          .join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-semibold text-slate-900">
                        {currency.format(expense.amount)}
                      </span>
                      <button
                        className="text-xs text-slate-400 hover:text-slate-600"
                        onClick={() => editExpense(expense)}
                      >
                        Bearbeiten
                      </button>
                      <button
                        className="text-xs text-slate-400 hover:text-slate-600"
                        onClick={() => removeExpense(expense.id)}
                      >
                        Löschen
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Saldo</h2>
            <p className="mt-1 text-sm text-slate-500">
              Übersicht über gezahlte und geschuldete Beträge.
            </p>
            <div className="mt-4 space-y-3">
              {balances.map((balance) => (
                <div
                  key={balance.personId}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-semibold text-slate-800">
                      {peopleMap.get(balance.personId)}
                    </p>
                    <p className="text-xs text-slate-500">
                      gezahlt {currency.format(balance.paid)} · Anteil{" "}
                      {currency.format(balance.owed)}
                    </p>
                  </div>
                  <span
                    className={`font-semibold ${
                      balance.net >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {balance.net >= 0 ? "+" : "-"}
                    {currency.format(Math.abs(balance.net))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              Ausgleichsvorschlag
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Wenige Transaktionen für einen fairen Ausgleich.
            </p>
            <div className="mt-4 space-y-3">
              {settlements.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                  Alles ausgeglichen.
                </div>
              ) : (
                settlements.map((settlement, index) => (
                  <div
                    key={`${settlement.fromId}-${settlement.toId}-${index}`}
                    className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  >
                    {peopleMap.get(settlement.fromId)} zahlt{" "}
                    {currency.format(settlement.amount)} an{" "}
                    {peopleMap.get(settlement.toId)}.
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              Export & Import
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Speichere den aktuellen Stand lokal oder importiere ein JSON.
            </p>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <button
                className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white"
                onClick={exportJson}
              >
                JSON exportieren
              </button>
              <button
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700"
                onClick={exportCsv}
              >
                CSV exportieren
              </button>
              <label className="flex cursor-pointer flex-col rounded-lg border border-dashed border-slate-200 px-4 py-2 text-center text-sm text-slate-500">
                JSON importieren
                <input
                  className="hidden"
                  type="file"
                  accept="application/json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      importJson(file);
                      event.target.value = "";
                    }
                  }}
                />
              </label>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default App;
