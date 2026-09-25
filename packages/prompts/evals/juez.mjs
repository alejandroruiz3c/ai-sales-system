// Juez de `llm-rubric` para promptfoo: el modelo medio a través del router.
import { juzgar } from './soporte.ts';

export default class JuezSalesOs {
  id() {
    return 'sales-os-juez';
  }

  async callApi(prompt) {
    try {
      return await juzgar(typeof prompt === 'string' ? prompt : JSON.stringify(prompt));
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
