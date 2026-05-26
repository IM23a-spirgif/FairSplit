import { useEffect, useMemo, useState } from "react";
import {
  calculateBalances,
  calculateSettlements,
  type Expense,
  type GroupData,
  type Person,
} from "./lib/split-calculations";
import {
  createExpenseNotification,
  createGroupChangeNotification,
  createSettlementRequestNotification,
  type AppNotification,
  type NotificationPreferences,
} from "./modules/notifications";

const STORAGE_KEY = "fairsplit-data-v1";
const NOTIFICATION_STORAGE_KEY = "fairsplit-notifications-v1";
const NOTIFICATION_PREFERENCES_STORAGE_KEY =
  "fairsplit-notification-preferences-v1";

const defaultData: GroupData = {
  groupName: "FairSplit - Ausgaben-Splitter",
  people: [
    { id: crypto.randomUUID(), name: "Alex" },
    { id: crypto.randomUUID(), name: "Mira" },
    { id: crypto.randomUUID(), name: "Sam" },
  ],
  expenses: [],
};

const defaultNotificationPreferences: NotificationPreferences = {
  inAppEnabled: true,
  emailEnabled: false,
  emailAddress: "",
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

const loadNotifications = (): AppNotification[] => {
  const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as AppNotification[];
  } catch {
    return [];
  }
};

const loadNotificationPreferences = (): NotificationPreferences => {
  const raw = localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY);
  if (!raw) {
    return defaultNotificationPreferences;
  }

  try {
    return {
      ...defaultNotificationPreferences,
      ...(JSON.parse(raw) as Partial<NotificationPreferences>),
    };
  } catch {
    return defaultNotificationPreferences;
  }
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
    expense.note.replaceAll("\n", " "),
  ]);

  return [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(";")
    )
    .join("\n");
};

const App = () => {
  const [data, setData] = useState<GroupData>(() => loadData());
  const [newPerson, setNewPerson] = useState("");
  const [expenseDraft, setExpenseDraft] = useState<Expense>(() =>
    createEmptyExpense(data.people)
  );
  const [categoryFilter, setCategoryFilter] = useState("Alle");
  const [searchTerm, setSearchTerm] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    loadNotifications()
  );
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(() => loadNotificationPreferences());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    localStorage.setItem(
      NOTIFICATION_STORAGE_KEY,
      JSON.stringify(notifications)
    );
  }, [notifications]);

  useEffect(() => {
    localStorage.setItem(
      NOTIFICATION_PREFERENCES_STORAGE_KEY,
      JSON.stringify(notificationPreferences)
    );
  }, [notificationPreferences]);

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

  const totalSpent = useMemo(
    () => data.expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [data.expenses]
  );

  const peopleMap = useMemo(
    () => new Map(data.people.map((person) => [person.id, person.name])),
    [data.people]
  );

  const averageShare = data.people.length ? totalSpent / data.people.length : 0;
  const unreadNotifications = notifications.filter(
    (notification) => !notification.read
  ).length;

  const pushNotification = (notification: AppNotification | null) => {
    if (!notification) {
      return;
    }

    setNotifications((current) => [notification, ...current].slice(0, 20));
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
    pushNotification(
      createGroupChangeNotification(
        `${person.name} wurde zur Gruppe hinzugefügt.`,
        [...data.people, person],
        notificationPreferences
      )
    );
    setNewPerson("");
  };

  const removePerson = (personId: string) => {
    const person = data.people.find(
      (currentPerson) => currentPerson.id === personId
    );
    const nextPeople = data.people.filter(
      (currentPerson) => currentPerson.id !== personId
    );

    setData((current) => ({
      ...current,
      people: current.people.filter((person) => person.id !== personId),
      expenses: current.expenses.map((expense) => ({
        ...expense,
        participantIds: expense.participantIds.filter(
          (participantId) => participantId !== personId
        ),
      })),
    }));
    pushNotification(
      createGroupChangeNotification(
        `${person?.name ?? "Ein Mitglied"} wurde aus der Gruppe entfernt.`,
        nextPeople,
        notificationPreferences
      )
    );
  };

  const addExpense = () => {
    if (!expenseDraft.title.trim() || expenseDraft.amount <= 0) {
      return;
    }

    const savedExpense = { ...expenseDraft, id: crypto.randomUUID() };
    setData((current) => ({
      ...current,
      expenses: [...current.expenses, savedExpense],
    }));
    pushNotification(
      createExpenseNotification(
        savedExpense,
        data.people,
        notificationPreferences,
        "added"
      )
    );
    setExpenseDraft(createEmptyExpense(data.people));
  };

  const removeExpense = (expenseId: string) => {
    const expense = data.expenses.find(
      (currentExpense) => currentExpense.id === expenseId
    );

    setData((current) => ({
      ...current,
      expenses: current.expenses.filter((expense) => expense.id !== expenseId),
    }));

    if (expense) {
      pushNotification(
        createExpenseNotification(
          expense,
          data.people,
          notificationPreferences,
          "removed"
        )
      );
    }
  };

  const requestSettlement = (settlement: (typeof settlements)[number]) => {
    pushNotification(
      createSettlementRequestNotification(
        settlement,
        data.people,
        notificationPreferences
      )
    );
  };

  const markNotificationsRead = () => {
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, read: true }))
    );
  };

  const clearNotifications = () => {
    setNotifications([]);
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

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                FairSplit
              </p>
              <input
                aria-label="Gruppenname"
                className="w-full max-w-2xl border-0 bg-transparent p-0 text-3xl font-semibold leading-tight text-slate-950 outline-none ring-0 placeholder:text-slate-400 sm:text-4xl"
                value={data.groupName}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    groupName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[30rem]">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-500">Summe</p>
                <p className="mt-1 text-sm font-semibold text-slate-950 sm:text-base">
                  {currency.format(totalSpent)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-500">Personen</p>
                <p className="mt-1 text-sm font-semibold text-slate-950 sm:text-base">
                  {data.people.length}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-500">Pro Kopf</p>
                <p className="mt-1 text-sm font-semibold text-slate-950 sm:text-base">
                  {currency.format(averageShare)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:px-8">
        <section className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Teilnehmer & Rollen
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {data.people.length} aktive Mitglieder
                </p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <input
                  aria-label="Teilnehmername"
                  className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 sm:w-48"
                  placeholder="Name hinzufügen"
                  value={newPerson}
                  onChange={(event) => setNewPerson(event.target.value)}
                />
                <button
                  aria-label="Teilnehmer hinzufügen"
                  className="min-h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                  onClick={addPerson}
                >
                  Hinzufügen
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {data.people.map((person) => (
                <span
                  key={person.id}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-800"
                >
                  {person.name}
                  {data.people.length > 1 && (
                    <button
                      className="rounded text-slate-400 transition hover:text-rose-600"
                      onClick={() => removePerson(person.id)}
                      aria-label={`${person.name} entfernen`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <h2 className="text-base font-semibold text-slate-950">
                Ausgaben
              </h2>
              <span className="text-sm font-medium text-slate-500">
                {data.expenses.length} Einträge
              </span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-6">
              <input
                aria-label="Ausgabentitel"
                className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 md:col-span-3"
                placeholder="Titel, z.B. Abendessen"
                value={expenseDraft.title}
                onChange={(event) =>
                  setExpenseDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
              <input
                aria-label="Betrag"
                className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 md:col-span-3"
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
                aria-label="Zahler"
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 md:col-span-2"
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
                aria-label="Datum"
                className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 md:col-span-2"
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
                aria-label="Kategorie"
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 md:col-span-2"
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
                aria-label="Notiz"
                className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 md:col-span-6"
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

            <div className="mt-5">
              <p className="text-sm font-semibold text-slate-700">
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
                      className={`min-h-9 rounded-lg border px-3 text-sm font-medium transition ${
                        selected
                          ? "border-emerald-700 bg-emerald-700 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                      }`}
                      onClick={() => toggleParticipant(person.id)}
                    >
                      {person.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                aria-label="Ausgabe speichern"
                className="min-h-10 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                onClick={addExpense}
              >
                Ausgabe speichern
              </button>
              <button
                aria-label="Ausgabenformular leeren"
                className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() => setExpenseDraft(createEmptyExpense(data.people))}
              >
                Formular leeren
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <h2 className="text-base font-semibold text-slate-950">
                Ausgabenliste
              </h2>
              <div className="grid gap-2 sm:grid-cols-[12rem_minmax(12rem,1fr)]">
                <select
                  aria-label="Kategorie filtern"
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
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
                  aria-label="Ausgaben durchsuchen"
                  className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Suche"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 divide-y divide-slate-100">
              {filteredExpenses.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  Noch keine Ausgaben gespeichert.
                </div>
              ) : (
                filteredExpenses.map((expense) => (
                  <article
                    key={expense.id}
                    className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-950">
                          {expense.title}
                        </p>
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                          {expense.category}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {expense.date} · gezahlt von{" "}
                        {peopleMap.get(expense.payerId)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Beteiligte:{" "}
                        {expense.participantIds
                          .map((id) => peopleMap.get(id))
                          .join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <span className="text-base font-semibold text-slate-950">
                        {currency.format(expense.amount)}
                      </span>
                      <button
                        className="min-h-9 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => removeExpense(expense.id)}
                      >
                        Löschen
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>

        <aside className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Saldo</h2>
            <div className="mt-4 space-y-2">
              {balances.map((balance) => (
                <div
                  key={balance.personId}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {peopleMap.get(balance.personId)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        gezahlt {currency.format(balance.paid)} · Anteil{" "}
                        {currency.format(balance.owed)}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        balance.net >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {balance.net >= 0 ? "+" : "-"}
                      {currency.format(Math.abs(balance.net))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">
              Ausgleichsvorschlag
            </h2>
            <div className="mt-4 space-y-2">
              {settlements.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  Alles ausgeglichen.
                </div>
              ) : (
                settlements.map((settlement, index) => (
                  <div
                    key={`${settlement.fromId}-${settlement.toId}-${index}`}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950"
                  >
                    <p>
                      {peopleMap.get(settlement.fromId)} zahlt{" "}
                      {currency.format(settlement.amount)} an{" "}
                      {peopleMap.get(settlement.toId)}.
                    </p>
                    <button
                      className="mt-3 min-h-9 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950 transition hover:bg-amber-100"
                      onClick={() => requestSettlement(settlement)}
                    >
                      Ausgleich anfragen
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-950">
                Benachrichtigungen
              </h2>
              <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                {unreadNotifications} neu
              </span>
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              <label className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-slate-700">
                <input
                  type="checkbox"
                  checked={notificationPreferences.inAppEnabled}
                  onChange={(event) =>
                    setNotificationPreferences((current) => ({
                      ...current,
                      inAppEnabled: event.target.checked,
                    }))
                  }
                />
                In-App aktiv
              </label>
              <label className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-slate-700">
                <input
                  type="checkbox"
                  checked={notificationPreferences.emailEnabled}
                  onChange={(event) =>
                    setNotificationPreferences((current) => ({
                      ...current,
                      emailEnabled: event.target.checked,
                    }))
                  }
                />
                E-Mail aktiv
              </label>
              <input
                aria-label="E-Mail für Benachrichtigungen"
                className="min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                placeholder="team@example.com"
                type="email"
                value={notificationPreferences.emailAddress}
                onChange={(event) =>
                  setNotificationPreferences((current) => ({
                    ...current,
                    emailAddress: event.target.value,
                  }))
                }
              />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={markNotificationsRead}
              >
                Alle gelesen
              </button>
              <button
                className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={clearNotifications}
              >
                Leeren
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {notifications.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  Keine Benachrichtigungen vorhanden.
                </div>
              ) : (
                notifications.map((notification) => (
                  <article
                    key={notification.id}
                    className={`rounded-lg border px-3 py-3 text-sm ${
                      notification.read
                        ? "border-slate-200 bg-slate-50 text-slate-600"
                        : "border-emerald-200 bg-emerald-50 text-slate-950"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{notification.title}</p>
                      <span className="shrink-0 text-xs text-slate-500">
                        {notification.channels.join(" + ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {notification.body}
                    </p>
                    {notification.channels.includes("email") && (
                      <p className="mt-2 rounded-lg bg-white px-2 py-1 text-xs text-slate-500">
                        E-Mail bereit: {notification.emailSubject}
                      </p>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">
              Export & Import
            </h2>
            <div className="mt-4 grid gap-2 text-sm">
              <button
                aria-label="JSON exportieren"
                className="min-h-10 rounded-lg bg-slate-950 px-4 font-semibold text-white transition hover:bg-slate-800"
                onClick={exportJson}
              >
                JSON exportieren
              </button>
              <button
                aria-label="CSV exportieren"
                className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={exportCsv}
              >
                CSV exportieren
              </button>
              <label className="flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
                JSON importieren
                <input
                  aria-label="JSON importieren"
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
          </section>
        </aside>
      </main>
    </div>
  );
};

export default App;
