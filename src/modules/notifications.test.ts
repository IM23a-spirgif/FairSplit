import { describe, expect, it, vi } from "vitest";

import {
  createExpenseNotification,
  createGroupChangeNotification,
  createSettlementRequestNotification,
  type NotificationPreferences,
} from "./notifications";

const preferences: NotificationPreferences = {
  inAppEnabled: true,
  emailEnabled: true,
  emailAddress: "team@example.com",
};

const people = [
  { id: "alex", name: "Alex" },
  { id: "mira", name: "Mira" },
];

describe("notifications module", () => {
  it("creates expense notifications for in-app and email channels", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001"
    );

    const notification = createExpenseNotification(
      {
        id: "expense-1",
        title: "Abendessen",
        amount: 64,
        payerId: "alex",
        participantIds: ["alex", "mira"],
        category: "Freizeit",
        date: "2026-05-26",
        note: "",
      },
      people,
      preferences,
      "added",
      new Date("2026-05-26T10:00:00.000Z")
    );

    expect(notification).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      type: "expense",
      title: "Ausgabe erfasst: Abendessen",
      read: false,
      channels: ["in-app", "email"],
      recipientIds: ["alex", "mira"],
      createdAt: "2026-05-26T10:00:00.000Z",
    });
    expect(notification?.emailBody).toContain("Abendessen");
  });

  it("does not create notifications when no delivery channel is enabled", () => {
    const notification = createGroupChangeNotification(
      "Mira wurde hinzugefuegt.",
      people,
      {
        inAppEnabled: false,
        emailEnabled: true,
        emailAddress: "",
      }
    );

    expect(notification).toBeNull();
  });

  it("targets settlement requests at the paying member", () => {
    const notification = createSettlementRequestNotification(
      { fromId: "mira", toId: "alex", amount: 15 },
      people,
      preferences,
      new Date("2026-05-26T10:00:00.000Z")
    );

    expect(notification).toMatchObject({
      type: "settlement-request",
      recipientIds: ["mira"],
      emailSubject: "FairSplit: Ausgleich angefragt",
    });
  });
});
