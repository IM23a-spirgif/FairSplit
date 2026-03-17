import { describe, expect, it } from "vitest";

import {
  sanitizeExpenseForPeople,
  type Expense,
  type Person,
} from "./expenses";

describe("expenses module", () => {
  it("sanitizes payer and participants against the current people list", () => {
    // Arrange
    const people: Person[] = [
      { id: "alex", name: "Alex" },
      { id: "mira", name: "Mira" },
    ];
    const expense: Expense = {
      id: "expense-1",
      title: "Abendessen",
      amount: 48,
      payerId: "unknown-person",
      participantIds: ["mira", "ghost", "mira"],
      category: "Allgemein",
      date: "2026-03-17",
      note: "",
    };

    // Act
    const sanitizedExpense = sanitizeExpenseForPeople(expense, people);

    // Assert
    expect(sanitizedExpense).toEqual({
      ...expense,
      payerId: "alex",
      participantIds: ["mira"],
    });
  });
});
