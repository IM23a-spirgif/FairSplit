import type { Expense, Person, Settlement } from "../lib/split-calculations";

export type NotificationType = "expense" | "group" | "settlement-request";

export type NotificationChannel = "in-app" | "email";

export type NotificationPreferences = {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  emailAddress: string;
};

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  channels: NotificationChannel[];
  recipientIds: string[];
  emailSubject: string;
  emailBody: string;
};

type NotificationInput = {
  type: NotificationType;
  title: string;
  body: string;
  recipientIds: string[];
  emailSubject: string;
  emailBody: string;
};

const createChannels = (
  preferences: NotificationPreferences
): NotificationChannel[] => {
  const channels: NotificationChannel[] = [];

  if (preferences.inAppEnabled) {
    channels.push("in-app");
  }

  if (preferences.emailEnabled && preferences.emailAddress.trim()) {
    channels.push("email");
  }

  return channels;
};

const createNotification = (
  input: NotificationInput,
  preferences: NotificationPreferences,
  now = new Date()
): AppNotification | null => {
  const channels = createChannels(preferences);

  if (channels.length === 0) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    ...input,
    createdAt: now.toISOString(),
    read: false,
    channels,
  };
};

export const createExpenseNotification = (
  expense: Expense,
  people: Person[],
  preferences: NotificationPreferences,
  action: "added" | "removed",
  now?: Date
): AppNotification | null => {
  const payer = people.find((person) => person.id === expense.payerId);
  const participantNames = expense.participantIds
    .map(
      (participantId) =>
        people.find((person) => person.id === participantId)?.name
    )
    .filter(Boolean)
    .join(", ");
  const actionLabel = action === "added" ? "erfasst" : "entfernt";
  const amount = new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    maximumFractionDigits: 2,
  }).format(expense.amount);

  return createNotification(
    {
      type: "expense",
      title: `Ausgabe ${actionLabel}: ${expense.title}`,
      body: `${payer?.name ?? "Ein Mitglied"} hat ${amount} für ${participantNames || "die Gruppe"} ${actionLabel}.`,
      recipientIds: expense.participantIds,
      emailSubject: `FairSplit: Ausgabe ${actionLabel}`,
      emailBody: `${expense.title}\nBetrag: ${amount}\nZahler: ${payer?.name ?? "Unbekannt"}\nBeteiligte: ${participantNames || "Keine"}`,
    },
    preferences,
    now
  );
};

export const createGroupChangeNotification = (
  message: string,
  people: Person[],
  preferences: NotificationPreferences,
  now?: Date
): AppNotification | null => {
  return createNotification(
    {
      type: "group",
      title: "Gruppe aktualisiert",
      body: message,
      recipientIds: people.map((person) => person.id),
      emailSubject: "FairSplit: Gruppe aktualisiert",
      emailBody: message,
    },
    preferences,
    now
  );
};

export const createSettlementRequestNotification = (
  settlement: Settlement,
  people: Person[],
  preferences: NotificationPreferences,
  now?: Date
): AppNotification | null => {
  const from = people.find((person) => person.id === settlement.fromId);
  const to = people.find((person) => person.id === settlement.toId);
  const amount = new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    maximumFractionDigits: 2,
  }).format(settlement.amount);

  return createNotification(
    {
      type: "settlement-request",
      title: `Ausgleich angefragt: ${amount}`,
      body: `${from?.name ?? "Ein Mitglied"} soll ${amount} an ${to?.name ?? "ein Mitglied"} zahlen.`,
      recipientIds: settlement.fromId ? [settlement.fromId] : [],
      emailSubject: "FairSplit: Ausgleich angefragt",
      emailBody: `Bitte begleiche ${amount} an ${to?.name ?? "das empfangende Mitglied"}.`,
    },
    preferences,
    now
  );
};
