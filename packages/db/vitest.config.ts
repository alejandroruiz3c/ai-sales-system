import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Levantar un Postgres embebido y aplicar siete migraciones tarda más que
    // un test de función pura. El límite por defecto de vitest no da.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Cada fichero levanta su propia base. En paralelo compiten por la CPU y
    // el tiempo total sube en vez de bajar.
    fileParallelism: false,
  },
});
