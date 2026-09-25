/**
 * CORPORATE FICTICIO · perfiles comerciales de prueba.
 *
 * Los dos corporates de prueba del plan (§5B.2): **Clínica Aurora Demo**
 * (salud privada) y **Logística Norte Demo** (transporte B2B). No existen. Sus
 * precios, ofertas, clientes ideales y argumentos están inventados y son
 * conocidos de antemano, para poder comprobar que el sistema los usa bien.
 *
 * Regla permanente 3: esto es lo único con forma de negocio que hay en el
 * repositorio, está marcado y es ficticio. En producción el perfil lo genera el
 * onboarding (F3) y vive en la base del tenant.
 */

import type { PerfilComercial } from '../perfil.ts';

export const PERFIL_CLINICA_AURORA_DEMO: PerfilComercial = {
  corporate: {
    nombre: 'Clínica Aurora Demo',
    sector: 'Salud privada',
    descripcion:
      'Red ficticia de tres clínicas de medicina general, fisioterapia y salud laboral que ofrece planes de salud para los empleados de empresas.',
  },
  propuestaDeValor:
    'Que los empleados de una empresa tengan cita con un médico o un fisioterapeuta en menos de 48 horas, sin papeleo para la empresa y con un coste fijo por empleado.',
  oferta: [
    {
      nombre: 'Plan Bienestar Equipo',
      descripcion:
        'Medicina general y fisioterapia ilimitadas en las clínicas de la red, con cita en 48 horas.',
      precioOrientativo: 'desde 29 € por empleado y mes',
    },
    {
      nombre: 'Revisión anual de salud',
      descripcion:
        'Reconocimiento médico completo con analítica e informe individual para cada empleado.',
      precioOrientativo: '75 € por empleado',
    },
    {
      nombre: 'Taller de ergonomía',
      descripcion:
        'Sesión de dos horas en la oficina del cliente sobre postura y prevención de lesiones.',
    },
  ],
  clienteIdeal: {
    sectores: ['Despachos profesionales y asesorías', 'Empresas de servicios', 'Tecnología'],
    cargos: ['Director financiero', 'Directora de personas', 'Gerente'],
    tamano: 'Entre 20 y 250 empleados, con oficina en la misma ciudad que alguna clínica.',
    problemas: [
      'Bajas cortas por dolencias musculares que se podrían evitar o acortar.',
      'Empleados que pierden media mañana para ir al médico de cabecera.',
      'Beneficios sociales que cuestan mucho y los empleados apenas usan.',
    ],
  },
  argumentos: [
    'Coste fijo por empleado: la empresa sabe lo que paga desde el primer mes.',
    'La cita en 48 horas reduce las horas perdidas en esperas.',
    'Alta y baja de empleados en el mismo día, sin papeleo para la empresa.',
  ],
  objeciones: [
    {
      objecion: 'Ya tenemos un seguro médico.',
      respuesta:
        'El plan no sustituye al seguro: cubre lo que más se usa (medicina general y fisioterapia) con cita rápida y sin copagos.',
    },
    {
      objecion: 'Es caro.',
      respuesta:
        'Se compara con el coste de una sola baja de una semana, que suele superar el plan anual de varios empleados.',
    },
  ],
  tono: {
    tratamiento: 'usted',
    estilo: 'Profesional, cercano y tranquilo. Frases cortas. Sin jerga médica.',
  },
  prohibido: [
    'Prometer diagnósticos, curaciones o resultados de salud.',
    'Dar cifras de reducción de bajas o de absentismo.',
    'Decir que el plan sustituye a un seguro médico.',
  ],
  remitente: { nombre: 'Lucía Fernández', cargo: 'Responsable de empresas' },
  idioma: 'es',
};

export const PERFIL_LOGISTICA_NORTE_DEMO: PerfilComercial = {
  corporate: {
    nombre: 'Logística Norte Demo',
    sector: 'Transporte y logística B2B',
    descripcion:
      'Empresa ficticia de mensajería urgente y logística de última milla para empresas del norte de España, con flota propia de furgonetas eléctricas.',
  },
  propuestaDeValor:
    'Entregas urgentes el mismo día entre empresas del norte peninsular, con seguimiento en tiempo real y una única factura mensual.',
  oferta: [
    {
      nombre: 'Urgente Mismo Día',
      descripcion: 'Recogida en menos de dos horas y entrega el mismo día en la misma provincia.',
      precioOrientativo: 'desde 12 € por envío',
    },
    {
      nombre: 'Ruta Fija Semanal',
      descripcion:
        'Recogidas y entregas en días y horas fijos para clientes con envíos recurrentes.',
      precioOrientativo: 'a medida según volumen',
    },
    {
      nombre: 'Documentación Certificada',
      descripcion:
        'Entrega de documentación en mano con firma digital del destinatario y prueba de entrega.',
      precioOrientativo: 'desde 9 € por entrega',
    },
  ],
  clienteIdeal: {
    sectores: ['Despachos profesionales y asesorías', 'Distribución industrial', 'Laboratorios'],
    cargos: ['Director financiero', 'Responsable de operaciones', 'Office manager'],
    tamano: 'Entre 10 y 500 empleados, con al menos veinte envíos al mes.',
    problemas: [
      'Envíos urgentes que dependen de varios proveedores y se pagan con facturas sueltas.',
      'Documentación que tiene que llegar firmada el mismo día y no hay forma de probar que llegó.',
      'No saber dónde está un envío hasta que el cliente llama preguntando.',
    ],
  },
  argumentos: [
    'Una única factura mensual con todos los envíos desglosados.',
    'Prueba de entrega con firma digital, útil para documentación con plazo.',
    'Seguimiento en tiempo real que el propio cliente final puede consultar.',
  ],
  objeciones: [
    {
      objecion: 'Ya trabajamos con una mensajería.',
      respuesta:
        'Muchos clientes nos usan solo para lo urgente del mismo día, que es donde las grandes redes fallan más.',
    },
    {
      objecion: 'Tenemos pocos envíos.',
      respuesta:
        'La tarifa por envío no exige volumen mínimo; la ruta fija solo se propone cuando compensa.',
    },
  ],
  tono: {
    tratamiento: 'tú',
    estilo: 'Directo y práctico, como habla un jefe de tráfico. Sin tecnicismos logísticos.',
  },
  prohibido: [
    'Garantizar horas exactas de entrega.',
    'Comparar precios con otras mensajerías por su nombre.',
    'Prometer cobertura fuera del norte peninsular.',
  ],
  remitente: { nombre: 'Iker Etxeberria', cargo: 'Director comercial' },
  idioma: 'es',
};

export const PERFILES_DE_PRUEBA = {
  'clinica-aurora-demo': PERFIL_CLINICA_AURORA_DEMO,
  'logistica-norte-demo': PERFIL_LOGISTICA_NORTE_DEMO,
} as const;

export type IdDePerfilDePrueba = keyof typeof PERFILES_DE_PRUEBA;
