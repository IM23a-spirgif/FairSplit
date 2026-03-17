import { describe, expect, it } from "vitest";

import type { Expense, Person } from "./expenses";
import { sanitizeExpenseForPeople } from "./expenses";

describe("sanitizeExpenseForPeople", () => {
  it("uses fallback payer and removes invalid participants", () => {
    // Arrange
    const people: Person[] = [
      { id: "p1", name: "Ada" },
      { id: "p2", name: "Linus" },
    ];

    const expense: Expense = {
      id: "e1",
      title: "Dinner",
      amount: 40,
      payerId: "unknown-payer",
      participantIds: ["p2", "unknown-participant", "p2"],
      category: "Food",
      date: "2026-03-16",
      note: "Team event",
    };

    // Act
    const result = sanitizeExpenseForPeople(expense, people);

    // Assert
    expect(result.payerId).toBe("p1");
    expect(result.participantIds).toEqual(["p2"]);
  });
});
