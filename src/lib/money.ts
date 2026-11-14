/** Money helpers. All amounts inside the app are integer paise. */

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const toRupees = (paise: number): number => paise / 100;
export const formatINR = (paise: number): string => `₹${inr.format(paise / 100)}`;

/** Parse user input like "1,250.50" into paise; returns null when invalid. */
export function parseRupees(input: string): number | null {
  const n = Number(input.replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? toPaise(n) : null;
}

export const todayISO = (): string => {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};
