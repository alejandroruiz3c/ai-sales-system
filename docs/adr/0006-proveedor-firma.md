# ADR 0006 · Proveedor de firma electrónica

- **Estado:** Propuesto
- **Fecha:** 2026-09-16
- **Decide:** Alejandro Ruiz
- **Autor:** Claude Code
- **Tarea del plan:** F0.12 · se implementa en F10.4

---

## Contexto

El paquete de cierre (F10) incluye un NDA que el cliente firma antes de empezar.
El volumen esperado es bajo al principio y creciente: una firma por cierre, por
cada tenant. El plan deja la elección entre **Docuseal** (open source,
autoalojable) y **Signaturit** (proveedor de la UE), y la remite a este ADR.

Lo que importa aquí no es la firma en sí: es qué pasa dentro de tres años si hay
que demostrar que un documento se firmó. Y, en el día a día, que el coste por
firma no crezca en proporción al número de cierres.

## Decisión propuesta

**Docuseal autoalojado como proveedor por defecto, detrás de una interfaz
`ESignAdapter`, con Signaturit como adaptador alternativo activable por tenant.**

```
ESignAdapter
  createEnvelope(template, signers, fields)
  send(envelopeId, channel)
  getStatus(envelopeId)
  download(envelopeId)          documento firmado + pista de auditoría
  onWebhook(event)              enviado, visto, firmado, rechazado, caducado
```

**Docuseal por defecto** porque:

1. **Sin coste por firma.** En un sistema donde cada cierre dispara una firma y
   el número de tenants crece, un precio por sobre firmado se convierte en un
   impuesto sobre el éxito del producto.
2. **Autoalojable junto a los workers de Hetzner**, en la UE, con los documentos
   en el Storage de Supabase del tenant. Los documentos de cada corporate no
   salen de nuestra infraestructura.
3. **Es código abierto**: si el proyecto se abandona, se puede seguir operando
   la versión que tengamos.

**Signaturit como alternativa por tenant** porque hay un caso real que Docuseal
no cubre: un corporate que necesite firma **cualificada** o **avanzada** con
certificado reconocido, o que exija un tercero de confianza establecido en la UE
por política interna. Eso no se resuelve autoalojando; se resuelve con un
prestador cualificado.

La elección es **por tenant**, no global: el valor por defecto es Docuseal y un
tenant puede configurarse con Signaturit si su caso lo requiere.

## Lo que hay que verificar antes de aceptar este ADR (F10.4)

| Punto                                         | Por qué importa                                                                           | Cómo se comprueba                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Validez de la firma para un NDA B2B en España | Un NDA admite firma electrónica simple o avanzada; el nivel exigible depende del contrato | **Lo confirma el asesor legal de Alex**, no este documento                                      |
| Pista de auditoría                            | Hay que poder demostrar quién firmó, cuándo, desde dónde y que el documento no cambió     | Descargar el certificado de auditoría de una firma de prueba y revisarlo                        |
| Sellado de tiempo                             | Da fecha demostrable frente a terceros                                                    | Comprobar si Docuseal lo incluye en la versión autoalojada y, si no, con qué autoridad se añade |
| Conservación a largo plazo                    | Un NDA se puede tener que exhibir años después                                            | Definir retención y copia del documento firmado en Storage (F13.7)                              |
| Modo de prueba                                | El sandbox de staging exige que nada se firme de verdad                                   | Firma en modo test verificable en el kit de F10                                                 |
| Coste real de Signaturit                      | Solo aplica al tenant que lo pida                                                         | Presupuesto al llegar el primer caso                                                            |

## Consecuencias

**A favor**

- Coste marginal por firma cero en el caso general.
- Los documentos de cada corporate permanecen en infraestructura propia en la UE.
- Un tenant con requisitos de firma cualificada se atiende sin cambiar el sistema.

**En contra, y asumido**

- **Autoalojar es operar**: actualizaciones, copias de seguridad y disponibilidad
  de un servicio más en Hetzner. Va al runbook de F14 y a las alertas de F14.8.
- **El valor probatorio de una firma simple es menor** que el de una cualificada.
  Mitigación: es el asesor legal quien fija el nivel exigible para el NDA, y si
  pide más, Signaturit está disponible desde el primer día por configuración.
- **Dos proveedores que mantener.** Se acepta porque el segundo solo se activa
  cuando un tenant lo pide, y ambos comparten la misma interfaz y los mismos
  tests de contrato.

## Alternativas consideradas

1. **DocuSign o Adobe Sign.** El estándar del mercado y el más caro por sobre, con datos fuera de la UE según plan. Se descarta salvo exigencia de un corporate concreto, que se atendería como tercer adaptador.
2. **Signaturit como único proveedor.** Más simple de operar y con coste por firma en todos los cierres, incluidos los tenants que no lo necesitan. Se descarta como valor por defecto, no como opción.
3. **"Firma" por aceptación en email o por casilla en el checkout de Stripe.** Barato y sin pista de auditoría seria. Para un NDA no es suficiente: precisamente el documento que se firma es el que puede acabar discutiéndose.
4. **Firma con certificado propio sin proveedor.** Implementar PAdES y sellado de tiempo a mano no es lo que construye SALES OS.

## Pendiente de decisión de Alex

- Nivel de firma exigible para el NDA, confirmado por el asesor legal (simple, avanzada o cualificada).
- Si se autoaloja Docuseal en el mismo servidor Hetzner de los workers o en uno propio.
- Confirmar que la alternativa Signaturit se activa por tenant y solo cuando se pida.
