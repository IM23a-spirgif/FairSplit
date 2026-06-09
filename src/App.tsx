import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  calculateBalances,
  calculateSettlements,
  type Expense,
  type GroupData,
  type Person,
} from "./lib/split-calculations";
import {
  loginAccount,
  normalizeEmail,
  registerAccount,
  resolveSessionUser,
  type AuthSession,
  type AuthUser,
  type StoredAccount,
} from "./modules/auth";
import {
  createExpenseNotification,
  createGroupChangeNotification,
  createSettlementRequestNotification,
  type AppNotification,
  type NotificationPreferences,
} from "./modules/notifications";

const STORAGE_KEY = "fairsplit-data-v2";
const LEGACY_STORAGE_KEY = "fairsplit-data-v1";
const NOTIFICATION_STORAGE_KEY = "fairsplit-notifications-v2";
const NOTIFICATION_PREFERENCES_STORAGE_KEY =
  "fairsplit-notification-preferences-v2";
const ACCOUNT_STORAGE_KEY = "fairsplit-accounts-v1";
const SESSION_STORAGE_KEY = "fairsplit-session-v1";

const defaultNotificationPreferences: NotificationPreferences = {
  inAppEnabled: true,
  emailEnabled: false,
  emailAddress: "",
};

const emptyData: GroupData = { groupName: "", people: [], expenses: [] };

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

const today = () => new Date().toISOString().slice(0, 10);

const createDefaultData = (user: AuthUser): GroupData => ({
  groupName: "Neue Abrechnung",
  people: [{ id: user.id, name: user.name }],
  expenses: [],
});

const accountToPerson = (account: AuthUser): Person => ({
  id: account.id,
  name: account.name,
});

const createFreePerson = (name: string): Person => ({
  id: `local-${crypto.randomUUID()}`,
  name,
});

const createEmptyExpense = (people: Person[]): Expense => ({
  id: crypto.randomUUID(),
  title: "",
  amount: 0,
  payerId: people[0]?.id ?? "",
  participantIds: people.map((person) => person.id),
  category: categories[0],
  date: today(),
  note: "",
});

const userStorageKey = (userId: string, key: string) => `${key}:${userId}`;

const loadJson = <T,>(key: string, fallback: T): T => {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const loadAccounts = (): StoredAccount[] =>
  loadJson<StoredAccount[]>(ACCOUNT_STORAGE_KEY, []);

const saveAccounts = (accounts: StoredAccount[]) => {
  localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(accounts));
};

const loadSession = (): AuthSession | null =>
  loadJson<AuthSession | null>(SESSION_STORAGE_KEY, null);

const saveSession = (user: AuthUser) => {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: user.id })
  );
};

const clearSession = () => localStorage.removeItem(SESSION_STORAGE_KEY);

const loadAuthenticatedUser = () =>
  resolveSessionUser(loadAccounts(), loadSession());

const normalizeGroupData = (
  data: GroupData,
  fallback: GroupData,
  accounts: StoredAccount[],
  currentUser: AuthUser
): GroupData => {
  const registeredPeople = new Map(
    accounts.map((account) => [account.id, accountToPerson(account)])
  );
  registeredPeople.set(currentUser.id, accountToPerson(currentUser));

  const peopleSource = Array.isArray(data.people)
    ? data.people
    : fallback.people;
  const people = peopleSource.reduce<Person[]>((registeredMembers, person) => {
    const registeredPerson = registeredPeople.get(person.id);
    const alreadyAdded = registeredMembers.some(
      (member) => member.id === person.id
    );

    if (alreadyAdded) {
      return registeredMembers;
    }

    if (registeredPerson) {
      registeredMembers.push(registeredPerson);
      return registeredMembers;
    }

    if (person.id.startsWith("local-") && person.name.trim()) {
      registeredMembers.push({
        id: person.id,
        name: person.name.trim(),
      });
    }

    return registeredMembers;
  }, []);

  if (!people.some((person) => person.id === currentUser.id)) {
    people.unshift(accountToPerson(currentUser));
  }

  const validPersonIds = new Set(people.map((person) => person.id));
  const fallbackPayerId = people[0]?.id ?? "";
  const expenses = (Array.isArray(data.expenses) ? data.expenses : [])
    .map((expense) => {
      const participantIds = expense.participantIds.filter((participantId) =>
        validPersonIds.has(participantId)
      );
      const payerId = validPersonIds.has(expense.payerId)
        ? expense.payerId
        : fallbackPayerId;

      return {
        ...expense,
        payerId,
        participantIds:
          participantIds.length > 0 ? participantIds : payerId ? [payerId] : [],
      };
    })
    .filter((expense) => expense.payerId && expense.participantIds.length > 0);

  return {
    groupName: data.groupName?.trim() || fallback.groupName,
    people,
    expenses,
  };
};

const loadData = (user: AuthUser, accounts = loadAccounts()): GroupData => {
  const fallback = createDefaultData(user);
  const legacyData = loadJson<GroupData>(LEGACY_STORAGE_KEY, fallback);
  const data = loadJson<GroupData>(
    userStorageKey(user.id, STORAGE_KEY),
    legacyData
  );

  return normalizeGroupData(data, fallback, accounts, user);
};

const loadNotifications = (userId: string): AppNotification[] =>
  loadJson<AppNotification[]>(
    userStorageKey(userId, NOTIFICATION_STORAGE_KEY),
    []
  );

const loadNotificationPreferences = (
  userId: string
): NotificationPreferences => ({
  ...defaultNotificationPreferences,
  ...loadJson<Partial<NotificationPreferences>>(
    userStorageKey(userId, NOTIFICATION_PREFERENCES_STORAGE_KEY),
    {}
  ),
});

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
      .filter(Boolean)
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

type AuthMode = "login" | "register";
const App = () => {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() =>
    loadAuthenticatedUser()
  );
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [authError, setAuthError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [accounts, setAccounts] = useState<StoredAccount[]>(() =>
    loadAccounts()
  );
  const [data, setData] = useState<GroupData>(() =>
    authUser ? loadData(authUser) : emptyData
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [freePersonName, setFreePersonName] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [expenseDraft, setExpenseDraft] = useState<Expense>(() =>
    createEmptyExpense(data.people)
  );
  const [expenseError, setExpenseError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Alle");
  const [searchTerm, setSearchTerm] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    authUser ? loadNotifications(authUser.id) : []
  );
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(() =>
      authUser
        ? loadNotificationPreferences(authUser.id)
        : defaultNotificationPreferences
    );

  useEffect(() => {
    if (!authUser) return;
    localStorage.setItem(
      userStorageKey(authUser.id, STORAGE_KEY),
      JSON.stringify(data)
    );
  }, [authUser, data]);

  useEffect(() => {
    if (!authUser) return;
    localStorage.setItem(
      userStorageKey(authUser.id, NOTIFICATION_STORAGE_KEY),
      JSON.stringify(notifications)
    );
  }, [authUser, notifications]);

  useEffect(() => {
    if (!authUser) return;
    localStorage.setItem(
      userStorageKey(authUser.id, NOTIFICATION_PREFERENCES_STORAGE_KEY),
      JSON.stringify(notificationPreferences)
    );
  }, [authUser, notificationPreferences]);

  useEffect(() => {
    setExpenseDraft((current) => {
      const validPersonIds = new Set(data.people.map((person) => person.id));
      const payerId = validPersonIds.has(current.payerId)
        ? current.payerId
        : (data.people[0]?.id ?? "");
      const participantIds = current.participantIds.filter((personId) =>
        validPersonIds.has(personId)
      );

      return {
        ...current,
        payerId,
        participantIds:
          participantIds.length > 0
            ? participantIds
            : data.people.map((person) => person.id),
      };
    });
  }, [data.people]);

  const balances = useMemo(
    () => calculateBalances(data.people, data.expenses),
    [data.people, data.expenses]
  );
  const settlements = useMemo(() => calculateSettlements(balances), [balances]);
  const peopleMap = useMemo(
    () => new Map(data.people.map((person) => [person.id, person.name])),
    [data.people]
  );
  const totalSpent = useMemo(
    () => data.expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [data.expenses]
  );
  const averageShare = data.people.length ? totalSpent / data.people.length : 0;
  const unreadNotifications = notifications.filter(
    (notification) => !notification.read
  ).length;
  const biggestExpense = data.expenses.reduce<Expense | null>(
    (largest, expense) => {
      if (!largest || expense.amount > largest.amount) return expense;
      return largest;
    },
    null
  );

  const sortedExpenses = useMemo(() => {
    return [...data.expenses].sort((left, right) => {
      const dateCompare = right.date.localeCompare(left.date);
      return dateCompare || right.id.localeCompare(left.id);
    });
  }, [data.expenses]);

  const filteredExpenses = useMemo(() => {
    return sortedExpenses.filter((expense) => {
      if (categoryFilter !== "Alle" && expense.category !== categoryFilter) {
        return false;
      }
      if (!searchTerm.trim()) return true;

      const search = searchTerm.toLowerCase();
      return (
        expense.title.toLowerCase().includes(search) ||
        expense.note.toLowerCase().includes(search) ||
        expense.category.toLowerCase().includes(search)
      );
    });
  }, [sortedExpenses, categoryFilter, searchTerm]);

  const nextAction = (() => {
    if (data.people.length < 2)
      return "Füge mindestens eine weitere Person hinzu.";
    if (data.expenses.length === 0)
      return "Erfasse die erste Ausgabe der Gruppe.";
    if (settlements.length > 0) return "Prüfe den Ausgleichsvorschlag.";
    return "Alles ausgeglichen. Neue Ausgaben können jederzeit erfasst werden.";
  })();

  const pushNotification = (notification: AppNotification | null) => {
    if (!notification) return;
    setNotifications((current) => [notification, ...current].slice(0, 20));
  };

  const hydrateForUser = (user: AuthUser, availableAccounts = accounts) => {
    const userData = loadData(user, availableAccounts);
    setAuthUser(user);
    setData(userData);
    setExpenseDraft(createEmptyExpense(userData.people));
    setNotifications(loadNotifications(user.id));
    setNotificationPreferences(loadNotificationPreferences(user.id));
  };

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    setIsAuthenticating(true);

    try {
      const accounts = loadAccounts();
      const result =
        authMode === "register"
          ? await registerAccount(accounts, authForm)
          : await loginAccount(accounts, authForm);

      if (!result.ok) {
        setAuthError(result.error);
        return;
      }

      saveAccounts(result.accounts);
      setAccounts(result.accounts);
      saveSession(result.user);
      hydrateForUser(result.user, result.accounts);
      setAuthForm({ name: "", email: "", password: "" });
    } catch {
      setAuthError("Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const logout = () => {
    clearSession();
    setAuthUser(null);
    setData(emptyData);
    setExpenseDraft(createEmptyExpense([]));
    setNotifications([]);
    setNotificationPreferences(defaultNotificationPreferences);
    setAuthError("");
    setExpenseError("");
    setInviteError("");
    setFreePersonName("");
  };

  const addFreePerson = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setInviteError("");

    const name = freePersonName.trim();
    if (!name) return;

    const alreadyExists = data.people.some(
      (person) => person.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (alreadyExists) {
      setInviteError("Diese Person ist bereits in der Gruppe.");
      return;
    }

    const person = createFreePerson(name);
    const nextPeople = [...data.people, person];
    setData((current) => ({ ...current, people: nextPeople }));
    setExpenseDraft((current) => ({
      ...current,
      participantIds: current.participantIds.includes(person.id)
        ? current.participantIds
        : [...current.participantIds, person.id],
    }));
    pushNotification(
      createGroupChangeNotification(
        `${person.name} wurde zur Gruppe hinzugefügt.`,
        nextPeople,
        notificationPreferences
      )
    );
    setFreePersonName("");
  };

  const inviteRegisteredUser = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setInviteError("");

    const email = normalizeEmail(inviteEmail);
    if (!email) return;

    const account = accounts.find((current) => current.email === email);
    if (!account) {
      setInviteError("Dieser Benutzer ist noch nicht registriert.");
      return;
    }

    const alreadyExists = data.people.some(
      (person) => person.id === account.id
    );
    if (alreadyExists) {
      setInviteError("Dieser Benutzer ist bereits in der Gruppe.");
      return;
    }

    const person = accountToPerson(account);
    const nextPeople = [...data.people, person];
    setData((current) => ({ ...current, people: nextPeople }));
    setExpenseDraft((current) => ({
      ...current,
      participantIds: current.participantIds.includes(person.id)
        ? current.participantIds
        : [...current.participantIds, person.id],
    }));
    pushNotification(
      createGroupChangeNotification(
        `${person.name} wurde zur Gruppe hinzugefügt.`,
        nextPeople,
        notificationPreferences
      )
    );
    setInviteEmail("");
  };

  const removePerson = (personId: string) => {
    if (personId === authUser?.id) {
      setInviteError("Du kannst dich nicht selbst aus der Gruppe entfernen.");
      return;
    }

    const person = data.people.find(
      (currentPerson) => currentPerson.id === personId
    );
    const nextPeople = data.people.filter(
      (currentPerson) => currentPerson.id !== personId
    );
    const fallbackPayerId = nextPeople[0]?.id ?? "";

    setData((current) => ({
      ...current,
      people: nextPeople,
      expenses: current.expenses.map((expense) => {
        const participantIds = expense.participantIds.filter(
          (participantId) => participantId !== personId
        );
        return {
          ...expense,
          payerId:
            expense.payerId === personId ? fallbackPayerId : expense.payerId,
          participantIds:
            participantIds.length > 0
              ? participantIds
              : fallbackPayerId
                ? [fallbackPayerId]
                : [],
        };
      }),
    }));
    pushNotification(
      createGroupChangeNotification(
        `${person?.name ?? "Ein Mitglied"} wurde aus der Gruppe entfernt.`,
        nextPeople,
        notificationPreferences
      )
    );
  };
  const addExpense = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setExpenseError("");

    if (data.people.length === 0) {
      setExpenseError("Füge zuerst mindestens eine Person hinzu.");
      return;
    }
    if (!expenseDraft.title.trim()) {
      setExpenseError("Gib der Ausgabe einen Titel.");
      return;
    }
    if (!Number.isFinite(expenseDraft.amount) || expenseDraft.amount <= 0) {
      setExpenseError("Der Betrag muss größer als 0 sein.");
      return;
    }
    if (!expenseDraft.payerId) {
      setExpenseError("Wähle aus, wer bezahlt hat.");
      return;
    }
    if (expenseDraft.participantIds.length === 0) {
      setExpenseError("Wähle mindestens eine beteiligte Person aus.");
      return;
    }

    const savedExpense = {
      ...expenseDraft,
      id: crypto.randomUUID(),
      title: expenseDraft.title.trim(),
      note: expenseDraft.note.trim(),
    };

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

  const clearNotifications = () => setNotifications([]);

  const toggleParticipant = (personId: string) => {
    setExpenseDraft((current) => {
      const isSelected = current.participantIds.includes(personId);
      const participantIds = isSelected
        ? current.participantIds.filter((id) => id !== personId)
        : [...current.participantIds, personId];
      return { ...current, participantIds };
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
    if (!authUser) return;

    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as GroupData;
        const importedData = normalizeGroupData(
          parsed,
          createDefaultData(authUser),
          accounts,
          authUser
        );
        setData(importedData);
        setExpenseDraft(createEmptyExpense(importedData.people));
      } catch {
        alert("Import fehlgeschlagen. Bitte JSON prüfen.");
      }
    });
  };

  if (!authUser) {
    const isRegistering = authMode === "register";

    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#d9f99d_0,#f8fafc_34%,#e2e8f0_100%)] px-4 py-10 text-slate-950">
        <main className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_28rem]">
          <section className="rounded-[2rem] border border-white/80 bg-white/75 p-8 shadow-xl shadow-slate-200/70 backdrop-blur sm:p-10">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
              FairSplit
            </p>
            <h1 className="mt-5 max-w-2xl text-4xl font-black leading-tight sm:text-6xl">
              Kosten teilen, ohne am Ende Tabellen zu entziffern.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
              Erstelle eine Gruppe, erfasse Ausgaben und sieh sofort, wer wem
              wie viel schuldet. Deine lokalen Daten sind an deinen Account im
              Browser gebunden.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {["Gruppe", "Ausgaben", "Ausgleich"].map((step, index) => (
                <div
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                  key={step}
                >
                  <p className="text-xs font-bold text-emerald-700">
                    Schritt {index + 1}
                  </p>
                  <p className="mt-2 text-sm font-bold text-slate-950">
                    {step}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/80 bg-white p-6 shadow-xl shadow-slate-200/70">
            <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1 text-sm font-bold">
              <button
                className={`min-h-10 rounded-xl transition ${
                  !isRegistering
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500"
                }`}
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                }}
                type="button"
              >
                Einloggen
              </button>
              <button
                className={`min-h-10 rounded-xl transition ${
                  isRegistering
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500"
                }`}
                onClick={() => {
                  setAuthMode("register");
                  setAuthError("");
                }}
                type="button"
              >
                Registrieren
              </button>
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleAuthSubmit}>
              {isRegistering && (
                <label className="grid gap-2 text-sm font-bold text-slate-700">
                  Name
                  <input
                    aria-label="Name"
                    className="min-h-12 rounded-2xl border border-slate-300 px-4 text-sm font-normal outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    placeholder="Dein Name"
                    value={authForm.name}
                    onChange={(event) =>
                      setAuthForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
              )}

              <label className="grid gap-2 text-sm font-bold text-slate-700">
                E-Mail
                <input
                  aria-label="E-Mail"
                  autoComplete="email"
                  className="min-h-12 rounded-2xl border border-slate-300 px-4 text-sm font-normal outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  placeholder="du@example.com"
                  type="email"
                  value={authForm.email}
                  onChange={(event) =>
                    setAuthForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="grid gap-2 text-sm font-bold text-slate-700">
                Passwort
                <input
                  aria-label="Passwort"
                  autoComplete={
                    isRegistering ? "new-password" : "current-password"
                  }
                  className="min-h-12 rounded-2xl border border-slate-300 px-4 text-sm font-normal outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  placeholder="Mindestens 8 Zeichen"
                  type="password"
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                />
              </label>

              {authError && (
                <p
                  className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
                  role="alert"
                >
                  {authError}
                </p>
              )}

              <button
                className="min-h-12 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isAuthenticating}
                type="submit"
              >
                {isAuthenticating
                  ? "Bitte warten..."
                  : isRegistering
                    ? "Account erstellen"
                    : "Einloggen"}
              </button>
            </form>
          </section>
        </main>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[#f3f1ea] text-slate-950">
      <header className="border-b border-slate-200 bg-[#102015] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-7 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div className="space-y-3">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-lime-300">
                FairSplit Workspace
              </p>
              <input
                aria-label="Gruppenname"
                className="w-full max-w-3xl border-0 bg-transparent p-0 text-4xl font-black leading-tight text-white outline-none ring-0 placeholder:text-white/50 sm:text-5xl"
                placeholder="Gruppenname"
                value={data.groupName}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    groupName: event.target.value,
                  }))
                }
              />
              <p className="max-w-2xl text-sm leading-6 text-white/70">
                {nextAction}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:min-w-80">
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                <p className="text-xs font-semibold text-white/60">Account</p>
                <p className="mt-1 truncate text-sm font-bold">
                  {authUser.name}
                </p>
              </div>
              <button
                className="min-h-12 rounded-2xl border border-white/15 bg-white px-4 text-sm font-black text-slate-950 transition hover:bg-lime-100"
                onClick={logout}
                type="button"
              >
                Logout
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-3xl bg-lime-300 p-5 text-slate-950">
              <p className="text-xs font-black uppercase tracking-[0.16em]">
                Gesamt
              </p>
              <p className="mt-3 text-3xl font-black">
                {currency.format(totalSpent)}
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/10 p-5">
              <p className="text-xs font-semibold text-white/60">Personen</p>
              <p className="mt-3 text-3xl font-black">{data.people.length}</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/10 p-5">
              <p className="text-xs font-semibold text-white/60">Pro Kopf</p>
              <p className="mt-3 text-3xl font-black">
                {currency.format(averageShare)}
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/10 p-5">
              <p className="text-xs font-semibold text-white/60">
                Größte Ausgabe
              </p>
              <p className="mt-3 truncate text-3xl font-black">
                {biggestExpense ? currency.format(biggestExpense.amount) : "-"}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_25rem] lg:px-8">
        <section className="space-y-6">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                  Neue Ausgabe
                </p>
                <h2 className="mt-2 text-2xl font-black text-slate-950">
                  Wer hat was bezahlt?
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Erfasse nur den Beleg. FairSplit berechnet den Ausgleich.
                </p>
              </div>
              {data.people.length < 2 && (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                  Mit nur einer Person gibt es noch nichts zu splitten.
                </p>
              )}
            </div>

            <form className="mt-6 grid gap-4" onSubmit={addExpense}>
              <div className="grid gap-3 md:grid-cols-6">
                <label className="grid gap-2 text-sm font-bold text-slate-700 md:col-span-3">
                  Titel
                  <input
                    aria-label="Ausgabentitel"
                    className="min-h-12 rounded-2xl border border-slate-300 px-4 text-sm font-normal outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    placeholder="z.B. Abendessen, Hotel, Taxi"
                    value={expenseDraft.title}
                    onChange={(event) =>
                      setExpenseDraft((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm font-bold text-slate-700 md:col-span-3">
                  Betrag
                  <input
                    aria-label="Betrag"
                    className="min-h-12 rounded-2xl border border-slate-300 px-4 text-sm font-normal outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    placeholder="0.00"
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
                </label>
                <label className="grid gap-2 text-sm font-bold text-slate-700 md:col-span-2">
                  Bezahlt von
                  <select
                    aria-label="Zahler"
                    className="min-h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-normal outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
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
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-bold text-slate-700 md:col-span-2">
                  Datum
                  <input
                    aria-label="Datum"
                    className="min-h-12 rounded-2xl border border-slate-300 px-4 text-sm font-normal outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    type="date"
                    value={expenseDraft.date}
                    onChange={(event) =>
                      setExpenseDraft((current) => ({
                        ...current,
                        date: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm font-bold text-slate-700 md:col-span-2">
                  Kategorie
                  <select
                    aria-label="Kategorie"
                    className="min-h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-normal outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
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
                </label>
                <label className="grid gap-2 text-sm font-bold text-slate-700 md:col-span-6">
                  Notiz
                  <input
                    aria-label="Notiz"
                    className="min-h-12 rounded-2xl border border-slate-300 px-4 text-sm font-normal outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    placeholder="Optional, z.B. Belegnummer oder Kontext"
                    value={expenseDraft.note}
                    onChange={(event) =>
                      setExpenseDraft((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <p className="text-sm font-black text-slate-800">
                    Beteiligte Personen
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                      onClick={() =>
                        setExpenseDraft((current) => ({
                          ...current,
                          participantIds: data.people.map(
                            (person) => person.id
                          ),
                        }))
                      }
                      type="button"
                    >
                      Alle
                    </button>
                    <button
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                      onClick={() =>
                        setExpenseDraft((current) => ({
                          ...current,
                          participantIds: [current.payerId].filter(Boolean),
                        }))
                      }
                      type="button"
                    >
                      Nur Zahler
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.people.map((person) => {
                    const selected = expenseDraft.participantIds.includes(
                      person.id
                    );
                    return (
                      <button
                        key={person.id}
                        className={`min-h-10 rounded-2xl border px-4 text-sm font-bold transition ${
                          selected
                            ? "border-emerald-800 bg-emerald-800 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                        }`}
                        onClick={() => toggleParticipant(person.id)}
                        type="button"
                      >
                        {person.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {expenseError && (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  {expenseError}
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  aria-label="Ausgabe speichern"
                  className="min-h-12 rounded-2xl bg-emerald-800 px-5 text-sm font-black text-white transition hover:bg-emerald-900"
                  type="submit"
                >
                  Ausgabe speichern
                </button>
                <button
                  aria-label="Ausgabenformular leeren"
                  className="min-h-12 rounded-2xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                  onClick={() => {
                    setExpenseDraft(createEmptyExpense(data.people));
                    setExpenseError("");
                  }}
                  type="button"
                >
                  Formular leeren
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                  Verlauf
                </p>
                <h2 className="mt-2 text-2xl font-black text-slate-950">
                  {data.expenses.length} Ausgaben
                </h2>
              </div>
              <div className="grid gap-2 sm:grid-cols-[12rem_minmax(14rem,1fr)]">
                <select
                  aria-label="Kategorie filtern"
                  className="min-h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
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
                  className="min-h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  placeholder="Suche nach Titel, Notiz oder Kategorie"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {filteredExpenses.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  Noch keine passende Ausgabe vorhanden.
                </div>
              ) : (
                filteredExpenses.map((expense) => (
                  <article
                    key={expense.id}
                    className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-black text-slate-950">
                          {expense.title}
                        </p>
                        <span className="rounded-full bg-lime-100 px-3 py-1 text-xs font-black text-lime-900">
                          {expense.category}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        {expense.date} · bezahlt von{" "}
                        {peopleMap.get(expense.payerId) ?? "Unbekannt"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Beteiligte:{" "}
                        {expense.participantIds
                          .map((id) => peopleMap.get(id))
                          .filter(Boolean)
                          .join(", ") || "Keine"}
                      </p>
                      {expense.note && (
                        <p className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          {expense.note}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <span className="text-xl font-black text-slate-950">
                        {currency.format(expense.amount)}
                      </span>
                      <button
                        className="min-h-10 rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => removeExpense(expense.id)}
                        type="button"
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
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                  Gruppe
                </p>
                <h2 className="mt-2 text-xl font-black text-slate-950">
                  Mitglieder
                </h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                {data.people.length}
              </span>
            </div>

            <form className="mt-4 grid gap-2" onSubmit={addFreePerson}>
              <div className="flex gap-2">
                <input
                  aria-label="Freien Teilnehmernamen hinzufügen"
                  className="min-h-11 min-w-0 flex-1 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  placeholder="Name hinzufügen"
                  value={freePersonName}
                  onChange={(event) => setFreePersonName(event.target.value)}
                />
                <button
                  aria-label="Freien Teilnehmer hinzufügen"
                  className="min-h-11 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800"
                  type="submit"
                >
                  Hinzufügen
                </button>
              </div>
              <p className="text-xs leading-5 text-slate-500">
                Für einfache Splits kannst du freie Namen verwenden.
              </p>
            </form>

            <form className="mt-4 grid gap-2" onSubmit={inviteRegisteredUser}>
              <div className="flex gap-2">
                <input
                  aria-label="Registrierte E-Mail einladen"
                  className="min-h-11 min-w-0 flex-1 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  placeholder="user@example.com"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
                <button
                  aria-label="Registrierten Benutzer einladen"
                  className="min-h-11 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800"
                  type="submit"
                >
                  Einladen
                </button>
              </div>
              <p className="text-xs leading-5 text-slate-500">
                Optional: registrierte Accounts per E-Mail hinzufügen, wenn die
                Person selbst einloggen soll.
              </p>
              {inviteError && (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {inviteError}
                </p>
              )}
            </form>

            <div className="mt-4 grid gap-2">
              {data.people.map((person) => (
                <div
                  key={person.id}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800"
                >
                  <span className="truncate">{person.name}</span>
                  {person.id !== authUser.id && (
                    <button
                      className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => removePerson(person.id)}
                      aria-label={`${person.name} entfernen`}
                      type="button"
                    >
                      Entfernen
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              Saldo
            </p>
            <div className="mt-4 space-y-2">
              {balances.length === 0 ? (
                <p className="rounded-3xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  Noch keine Mitglieder vorhanden.
                </p>
              ) : (
                balances.map((balance) => (
                  <div
                    key={balance.personId}
                    className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">
                          {peopleMap.get(balance.personId)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          gezahlt {currency.format(balance.paid)} · Anteil{" "}
                          {currency.format(balance.owed)}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-black ${balance.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                      >
                        {balance.net >= 0 ? "+" : "-"}
                        {currency.format(Math.abs(balance.net))}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-[#102015] p-5 text-white shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-300">
              Ausgleich
            </p>
            <div className="mt-4 space-y-2">
              {settlements.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-8 text-center text-sm text-white/70">
                  Alles ausgeglichen.
                </div>
              ) : (
                settlements.map((settlement, index) => (
                  <div
                    key={`${settlement.fromId}-${settlement.toId}-${index}`}
                    className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4 text-sm"
                  >
                    <p className="font-semibold">
                      {peopleMap.get(settlement.fromId)} zahlt{" "}
                      {currency.format(settlement.amount)} an{" "}
                      {peopleMap.get(settlement.toId)}.
                    </p>
                    <button
                      className="mt-3 min-h-10 rounded-2xl bg-lime-300 px-4 text-xs font-black text-slate-950 transition hover:bg-lime-200"
                      onClick={() => requestSettlement(settlement)}
                      type="button"
                    >
                      Erinnerung erzeugen
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-black text-slate-950">Aktivität</h2>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
                {unreadNotifications} neu
              </span>
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              <label className="flex min-h-10 items-center gap-2 rounded-2xl border border-slate-200 px-3 text-slate-700">
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
              <label className="flex min-h-10 items-center gap-2 rounded-2xl border border-slate-200 px-3 text-slate-700">
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
                E-Mail vorbereiten
              </label>
              <input
                aria-label="E-Mail für Benachrichtigungen"
                className="min-h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
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
                className="min-h-10 rounded-2xl border border-slate-300 px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                onClick={markNotificationsRead}
                type="button"
              >
                Alle gelesen
              </button>
              <button
                className="min-h-10 rounded-2xl border border-slate-300 px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                onClick={clearNotifications}
                type="button"
              >
                Leeren
              </button>
            </div>

            <div className="mt-4 max-h-72 space-y-2 overflow-auto pr-1">
              {notifications.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  Noch keine Aktivität.
                </div>
              ) : (
                notifications.map((notification) => (
                  <article
                    key={notification.id}
                    className={`rounded-3xl border px-4 py-3 text-sm ${notification.read ? "border-slate-200 bg-slate-50 text-slate-600" : "border-emerald-200 bg-emerald-50 text-slate-950"}`}
                  >
                    <p className="font-black">{notification.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {notification.body}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-slate-950">Daten</h2>
            <div className="mt-4 grid gap-2 text-sm">
              <button
                aria-label="JSON exportieren"
                className="min-h-11 rounded-2xl bg-slate-950 px-4 font-black text-white transition hover:bg-slate-800"
                onClick={exportJson}
                type="button"
              >
                JSON exportieren
              </button>
              <button
                aria-label="CSV exportieren"
                className="min-h-11 rounded-2xl border border-slate-300 px-4 font-bold text-slate-700 transition hover:bg-slate-50"
                onClick={exportCsv}
                type="button"
              >
                CSV exportieren
              </button>
              <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-slate-300 px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50">
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
