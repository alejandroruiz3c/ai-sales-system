/**
 * El perfil comercial de un corporate: las variables de las plantillas (F2.6).
 *
 * Regla permanente 3: las plantillas base son genéricas y **solo contienen
 * variables del perfil comercial**. Si al escribir una plantilla hace falta
 * saber qué vende el corporate, el dato que falta es un campo de este esquema,
 * no una frase en la plantilla.
 *
 * El perfil lo produce el onboarding (F3) a partir del deck, la web y el
 * argumentario del corporate, y vive en la base de datos de su tenant. En el
 * repositorio solo existe su **forma**, más dos perfiles de corporates
 * ficticios para los tests y el kit (`fixtures/perfiles`).
 *
 * Todos los campos de texto tienen longitud máxima. No es cosmético: el perfil
 * entero va en el bloque cacheado de cada llamada, y un perfil de cincuenta
 * mil caracteres encarecería miles de llamadas por tenant.
 */

import { z } from 'zod';

const texto = (max: number) => z.string().trim().min(1).max(max);

export const esquemaPerfilComercial = z.object({
  corporate: z.object({
    nombre: texto(120),
    sector: texto(160),
    /** Una frase: qué es el corporate, para presentarse. */
    descripcion: texto(400),
  }),
  propuestaDeValor: texto(600),
  oferta: z
    .array(
      z.object({
        nombre: texto(120),
        descripcion: texto(500),
        /** Solo si el corporate autoriza a mencionarlo. Texto libre: «desde…», «a medida». */
        precioOrientativo: texto(120).optional(),
      }),
    )
    .min(1)
    .max(12),
  clienteIdeal: z.object({
    sectores: z.array(texto(120)).min(1).max(12),
    cargos: z.array(texto(120)).min(1).max(12),
    tamano: texto(200),
    problemas: z.array(texto(300)).min(1).max(10),
  }),
  argumentos: z.array(texto(400)).min(1).max(12),
  objeciones: z.array(z.object({ objecion: texto(300), respuesta: texto(600) })).max(12),
  tono: z.object({
    tratamiento: z.enum(['usted', 'tú']),
    estilo: texto(300),
  }),
  /** Afirmaciones que el corporate no permite hacer nunca: garantías, cifras, comparativas. */
  prohibido: z.array(texto(300)).max(20),
  remitente: z.object({ nombre: texto(120), cargo: texto(120) }),
  idioma: z.enum(['es']),
});

export type PerfilComercial = z.infer<typeof esquemaPerfilComercial>;
