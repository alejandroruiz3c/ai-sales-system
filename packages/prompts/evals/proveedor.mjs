// Proveedor de promptfoo: ejecuta un caso a través del router de SALES OS.
// La lógica está en `soporte.ts`; este fichero solo adapta la interfaz.
import { ejecutarCaso } from './soporte.ts';

export default class ProveedorSalesOs {
  constructor(opciones) {
    this.etiqueta = opciones?.label ?? 'sales-os';
  }

  id() {
    return this.etiqueta;
  }

  async callApi(_prompt, contexto) {
    try {
      return await ejecutarCaso(contexto?.vars ?? {});
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
