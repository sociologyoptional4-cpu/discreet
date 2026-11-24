/** Whole years between a birth date and `now`. Date-only maths in local time. */
export function ageOn(dob: Date, now: Date = new Date()): number {
  let years = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

export const MIN_AGE = 18;
export const isAdult = (dob: Date, now: Date = new Date()): boolean => ageOn(dob, now) >= MIN_AGE;

/** YYYY-MM-DD in local time, the format the database expects. */
export function toDateOnly(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
