/**
 * Migration 005: sort_order as bigint
 *
 * Clients set sort_order to Date.now() (milliseconds) when adding a custom source
 * or collection. That overflows a 32-bit integer, so every push containing such a
 * row failed with "out of range for type integer", which aborted the whole sync
 * (and with it all file uploads) on that device.
 */
export const up = (pgm) => {
  pgm.sql(`
    alter table sources alter column sort_order type bigint;
    alter table collections alter column sort_order type bigint;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    alter table sources alter column sort_order type integer;
    alter table collections alter column sort_order type integer;
  `);
};
