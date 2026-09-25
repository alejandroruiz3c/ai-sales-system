/**
 * @sales-os/prompts
 *
 * Plantillas de prompt base, versionadas, con variables del perfil comercial
 * (F2.6), y sus evals de promptfoo (F2.7, carpeta `evals/`).
 *
 * Son la capa **base**: viven aquí, cambian con PR y pasan evals. La capa de
 * cada tenant vivirá en su base de datos y se editará desde el Estudio (F2B).
 */

export { esquemaPerfilComercial, type PerfilComercial } from './perfil.ts';
export {
  ErrorDePlantilla,
  huellaDePlantilla,
  neutralizarEtiquetas,
  renderizar,
  RUTAS_DEL_PERFIL,
  rutasDeEsquema,
  validarPlantilla,
  variablesDe,
  type Bloque,
  type DatosDeRenderizado,
  type Plantilla,
  type PromptRenderizado,
} from './plantilla.ts';
export {
  CATEGORIAS_DE_RESPUESTA,
  clasificarRespuesta,
  entradaClasificarRespuesta,
  salidaClasificarRespuesta,
  type CategoriaDeRespuesta,
  type ClasificacionDeRespuesta,
} from './plantillas/clasificar-respuesta.ts';
export {
  entradaRedactarEmail,
  redactarEmail,
  salidaRedactarEmail,
  type EmailRedactado,
} from './plantillas/redactar-email.ts';
export { esIdDePlantilla, IDS_DE_PLANTILLA, PLANTILLAS, type IdDePlantilla } from './registro.ts';

export interface PackageManifest {
  /** Nombre del paquete en el workspace. */
  readonly name: string;
  /** Qué resuelve este paquete. */
  readonly description: string;
  /** Fase del plan en la que se implementa. */
  readonly phase: string;
}

export const manifest: PackageManifest = {
  name: '@sales-os/prompts',
  description: 'Plantillas de prompt versionadas por agente y sus evals de promptfoo',
  phase: 'F2',
};
