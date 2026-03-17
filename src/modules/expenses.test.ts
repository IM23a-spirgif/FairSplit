import { describe, expect, it } from "vitest";

import {
  sanitizeExpenseForPeople,
  type Expense,
  type Person,
} from "./expenses";

describe("sanitizeExpenseForPeople", () => {
  it("setzt ungültige payerId auf die erste Person und normalisiert Teilnehmer", () => {
    // Arrange
    const people: Person[] = [
      { id: "anna", name: "Anna" },
      { id: "ben", name: "Ben" },
    ];
    const expense: Expense = {
      id: "expense-1",
      title: "Pizza",
      amount: 42,
      payerId: "unknown",
      participantIds: ["ben", "ghost", "ben"],
      category: "Food",
      date: "2026-03-17",
      note: "Shared dinner",
    };

    // Act
    const result = sanitizeExpenseForPeople(expense, people);

    // Assert
    expect(result.payerId).toBe("anna");
    expect(result.participantIds).toEqual(["ben"]);
  });
});
