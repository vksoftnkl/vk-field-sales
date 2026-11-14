// Types for the Drizzle-generated migrations.js (kept next to it so `drizzle-kit generate` won't overwrite it).
declare const migrations: {
  journal: { entries: { idx: number; when: number; tag: string; breakpoints: boolean }[] };
  migrations: Record<string, string>;
};
export default migrations;
