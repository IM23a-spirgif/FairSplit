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

export type GroupData = {
  groupName: string;
  people: Person[];
  expenses: Expense[];
};

export type Balance = {
  personId: string;
  paid: number;
  owed: number;
  net: number;
};

export type Settlement = {
  fromId: string;
  toId: string;
  amount: number;
};

export const calculateBalances = (
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
    balances.map((balance) => [balance.personId, balance] as const)
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

export const calculateSettlements = (balances: Balance[]): Settlement[] => {
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
