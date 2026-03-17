import { describe, expect, it } from "vitest";

import {
  calculateBalances,
  calculateSettlements,
  type Expense,
  type Person,
} from "./split-calculations";

describe("split calculations", () => {
  it("creates fair settlements for shared expenses", () => {
    // Arrange
    const people: Person[] = [
      { id: "alex", name: "Alex" },
      { id: "mira", name: "Mira" },
      { id: "sam", name: "Sam" },
    ];
    const expenses: Expense[] = [
      {
        id: "expense-1",
        title: "Einkauf",
        amount: 90,
        payerId: "alex",
        participantIds: ["alex", "mira", "sam"],
        category: "Lebensmittel",
        date: "2026-03-17",
        note: "",
      },
      {
        id: "expense-2",
        title: "Taxi",
        amount: 30,
        payerId: "mira",
        participantIds: ["mira", "sam"],
        category: "Transport",
        date: "2026-03-17",
        note: "",
      },
    ];

    // Act
    const balances = calculateBalances(people, expenses);
    const settlements = calculateSettlements(balances);

    // Assert
    expect(balances).toHaveLength(3);
    expect(balances).toEqual([
      { personId: "alex", paid: 90, owed: 30, net: 60 },
      { personId: "mira", paid: 30, owed: 45, net: -15 },
      { personId: "sam", paid: 0, owed: 45, net: -45 },
    ]);
    expect(settlements).toEqual([
      { fromId: "mira", toId: "alex", amount: 15 },
      { fromId: "sam", toId: "alex", amount: 45 },
    ]);
  });
});
