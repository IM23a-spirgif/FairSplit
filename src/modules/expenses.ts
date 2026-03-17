export type Person = {
  id: string;
  name: string;
};

export type Expense = {
  id: string;
  title: string;
  amount: number;
  payerId: string;
  participantIds: string[];
  category: string;
  date: string;
  note: string;
};

const normalizeParticipants = (
  participantIds: string[],
  validPersonIds: Set<string>
): string[] => {
  const uniqueParticipants = new Set<string>();
  participantIds.forEach((participantId) => {
    if (validPersonIds.has(participantId)) {
      uniqueParticipants.add(participantId);
    }
  });

  return [...uniqueParticipants];
};

export const sanitizeExpenseForPeople = (
  expense: Expense,
  people: Person[]
): Expense => {
  const validPersonIds = new Set(people.map((person) => person.id));
  const fallbackPayerId = people[0]?.id ?? "";

  const normalizedParticipants = normalizeParticipants(
    expense.participantIds,
    validPersonIds
  );

  return {
    ...expense,
    payerId: validPersonIds.has(expense.payerId)
      ? expense.payerId
      : fallbackPayerId,
    participantIds:
      normalizedParticipants.length > 0
        ? normalizedParticipants
        : expense.payerId
          ? [expense.payerId]
          : fallbackPayerId
            ? [fallbackPayerId]
            : [],
  };
};

export const addExpenseToGroup = (
  expenses: Expense[],
  newExpense: Expense,
  people: Person[]
): Expense[] => {
  return [...expenses, sanitizeExpenseForPeople(newExpense, people)];
};

export const updateExpenseInGroup = (
  expenses: Expense[],
  updatedExpense: Expense,
  people: Person[]
): Expense[] => {
  return expenses.map((expense) => {
    if (expense.id !== updatedExpense.id) {
      return expense;
    }

    return sanitizeExpenseForPeople(updatedExpense, people);
  });
};

export const deleteExpenseFromGroup = (
  expenses: Expense[],
  expenseId: string
): Expense[] => {
  return expenses.filter((expense) => expense.id !== expenseId);
};

export const syncExpensesWithPeople = (
  expenses: Expense[],
  people: Person[]
): Expense[] => {
  return expenses.map((expense) => sanitizeExpenseForPeople(expense, people));
};
