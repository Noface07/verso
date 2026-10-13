import { useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, dirty, type SettingsRow } from '../db';

export interface ReadingGoals {
  dailyMinutes: number;
  yearlyBooks: number;
}

export const DEFAULT_GOALS: ReadingGoals = {
  dailyMinutes: 30,
  yearlyBooks: 20,
};

export async function getReadingGoals(): Promise<ReadingGoals> {
  const row = await db.settings.get('reading_goals');
  if (!row || !row.data) return DEFAULT_GOALS;
  const data = row.data as Partial<ReadingGoals>;
  return {
    dailyMinutes: typeof data.dailyMinutes === 'number' && data.dailyMinutes > 0 ? data.dailyMinutes : DEFAULT_GOALS.dailyMinutes,
    yearlyBooks: typeof data.yearlyBooks === 'number' && data.yearlyBooks > 0 ? data.yearlyBooks : DEFAULT_GOALS.yearlyBooks,
  };
}

export async function setReadingGoals(goals: Partial<ReadingGoals>): Promise<void> {
  const current = await getReadingGoals();
  const updated: ReadingGoals = {
    dailyMinutes: goals.dailyMinutes ?? current.dailyMinutes,
    yearlyBooks: goals.yearlyBooks ?? current.yearlyBooks,
  };

  const record: SettingsRow = {
    id: 'reading_goals',
    data: updated as unknown as Record<string, unknown>,
    deleted_at: null,
    ...dirty(),
  };
  await db.settings.put(record);
}

export function useReadingGoals(): {
  goals: ReadingGoals;
  updateGoals: (goals: Partial<ReadingGoals>) => Promise<void>;
} {
  const row = useLiveQuery(() => db.settings.get('reading_goals'), []);

  const goals: ReadingGoals = {
    dailyMinutes:
      typeof row?.data?.dailyMinutes === 'number' && (row.data.dailyMinutes as number) > 0
        ? (row.data.dailyMinutes as number)
        : DEFAULT_GOALS.dailyMinutes,
    yearlyBooks:
      typeof row?.data?.yearlyBooks === 'number' && (row.data.yearlyBooks as number) > 0
        ? (row.data.yearlyBooks as number)
        : DEFAULT_GOALS.yearlyBooks,
  };

  const updateGoals = useCallback(async (newGoals: Partial<ReadingGoals>) => {
    await setReadingGoals(newGoals);
  }, []);

  return { goals, updateGoals };
}
