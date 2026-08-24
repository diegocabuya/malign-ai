import type { CountryId, ScenarioPopulationDemographic, SetupCardDefinition } from './m1-setup.js';
import type { M1CampaignCardRule } from './m1-adjudication.js';

export const M1_0_BASELINE_VERSIONS = {
  rulesetVersion: '0.1',
  scenarioVersion: '0.1',
  cardRegistryVersion: '0.1',
  engineContractVersion: '0.1',
  fixtureSchemaVersion: '0.1',
} as const;

export const BASE_2025_COUNTRIES = [
  { id: 'ARDEN', startingResources: 2, turnIncome: 2 },
  { id: 'FLUMA', startingResources: 2, turnIncome: 1 },
  { id: 'URSARIA', startingResources: 3, turnIncome: 2 },
  { id: 'PRESQUE', startingResources: 3, turnIncome: 2 },
  { id: 'DINESIA', startingResources: 4, turnIncome: 3 },
] as const satisfies readonly { readonly id: CountryId; readonly startingResources: number; readonly turnIncome: number }[];

const base2025PopulationDemographicDefinitions = [
  { id: 'PRESQUE_PD_1', hostCountryId: 'PRESQUE', localIndex: 1, gamebookLabel: '1', boardLabel: '1*', demographicTokenIds: ['SIZE:S', 'PARTY:CLEAN_EARTH_PARTY', 'RACE:BLACK', 'RELIGION:CHRISTIAN', 'EDUCATION:ADVANCED'], initialInfluence: { type: 'RESILIENCY', count: 1, attributionCountryId: 'PRESQUE' } },
  { id: 'PRESQUE_PD_2', hostCountryId: 'PRESQUE', localIndex: 2, gamebookLabel: '2', boardLabel: '2', demographicTokenIds: ['SIZE:M', 'PARTY:REPUBLICAN_FORUM', 'RACE:ASIAN', 'RELIGION:CHRISTIAN', 'EDUCATION:UNIVERSITY'], initialInfluence: { type: 'RESILIENCY', count: 2, attributionCountryId: 'PRESQUE' } },
  { id: 'PRESQUE_PD_3', hostCountryId: 'PRESQUE', localIndex: 3, gamebookLabel: '3', boardLabel: '3', demographicTokenIds: ['SIZE:L', 'PARTY:SOCIALIST_PARTY', 'RACE:WHITE', 'RELIGION:CHRISTIAN', 'EDUCATION:UNIVERSITY'], initialInfluence: { type: 'RESILIENCY', count: 6, attributionCountryId: 'PRESQUE' } },
  { id: 'DINESIA_PD_1', hostCountryId: 'DINESIA', localIndex: 1, gamebookLabel: '18', boardLabel: '4', demographicTokenIds: ['SIZE:M', 'PARTY:DINESIA_PEOPLES_PARTY', 'RACE:BLACK', 'RELIGION:NONE', 'EDUCATION:HIGH_SCHOOL'], initialInfluence: { type: 'MALIGN', count: 1, attributionCountryId: 'URSARIA' } },
  { id: 'DINESIA_PD_2', hostCountryId: 'DINESIA', localIndex: 2, gamebookLabel: '19', boardLabel: '5', demographicTokenIds: ['SIZE:L', 'PARTY:PEOPLES_DEMOCRATIC', 'RACE:ASIAN', 'RELIGION:CHRISTIAN', 'EDUCATION:ADVANCED'], initialInfluence: { type: 'RESILIENCY', count: 3, attributionCountryId: 'DINESIA' } },
  { id: 'DINESIA_PD_3', hostCountryId: 'DINESIA', localIndex: 3, gamebookLabel: '20', boardLabel: '6', demographicTokenIds: ['SIZE:S', 'PARTY:PEOPLES_DEMOCRATIC', 'RACE:WHITE', 'RELIGION:CHRISTIAN', 'EDUCATION:HIGH_SCHOOL'], initialInfluence: { type: 'MALIGN', count: 2, attributionCountryId: 'PRESQUE' } },
  { id: 'URSARIA_PD_1', hostCountryId: 'URSARIA', localIndex: 1, gamebookLabel: '4', boardLabel: '7', demographicTokenIds: ['SIZE:S', 'PARTY:URSARIA_PEOPLES_PARTY', 'RACE:WHITE', 'RELIGION:NONE', 'EDUCATION:LT_HIGH_SCHOOL'], initialInfluence: { type: 'MALIGN', count: 1, attributionCountryId: 'PRESQUE' } },
  { id: 'URSARIA_PD_2', hostCountryId: 'URSARIA', localIndex: 2, gamebookLabel: '5', boardLabel: '8', demographicTokenIds: ['SIZE:L', 'PARTY:URSARIA_PEOPLES_PARTY', 'RACE:ASIAN', 'RELIGION:CHRISTIAN', 'EDUCATION:UNIVERSITY'], initialInfluence: { type: 'RESILIENCY', count: 3, attributionCountryId: 'URSARIA' } },
  { id: 'URSARIA_PD_3', hostCountryId: 'URSARIA', localIndex: 3, gamebookLabel: '6', boardLabel: '9', demographicTokenIds: ['SIZE:M', 'PARTY:CENTRAL_PARTY', 'RACE:NATIVE', 'RELIGION:CHRISTIAN', 'EDUCATION:UNIVERSITY'], initialInfluence: { type: 'MALIGN', count: 1, attributionCountryId: 'ARDEN' } },
  { id: 'FLUMA_PD_1', hostCountryId: 'FLUMA', localIndex: 1, gamebookLabel: '7', boardLabel: '10', demographicTokenIds: ['SIZE:S', 'PARTY:WORKERS_FRONT', 'RACE:NATIVE', 'RELIGION:NONE', 'EDUCATION:HIGH_SCHOOL'], initialInfluence: { type: 'MALIGN', count: 1, attributionCountryId: 'URSARIA' } },
  { id: 'FLUMA_PD_2', hostCountryId: 'FLUMA', localIndex: 2, gamebookLabel: '8', boardLabel: '11', demographicTokenIds: ['SIZE:L', 'PARTY:LIBERTY_PARTY', 'RACE:NATIVE', 'RELIGION:CHRISTIAN', 'EDUCATION:UNIVERSITY'], initialInfluence: { type: 'RESILIENCY', count: 4, attributionCountryId: 'FLUMA' } },
  { id: 'ARDEN_PD_1', hostCountryId: 'ARDEN', localIndex: 1, gamebookLabel: '9', boardLabel: '12', demographicTokenIds: ['SIZE:S', 'PARTY:CITIZENS_DEMOCRAT', 'RACE:ASIAN', 'RELIGION:NONE', 'EDUCATION:ADVANCED'], initialInfluence: { type: 'RESILIENCY', count: 2, attributionCountryId: 'ARDEN' } },
  { id: 'ARDEN_PD_2', hostCountryId: 'ARDEN', localIndex: 2, gamebookLabel: '10', boardLabel: '13', demographicTokenIds: ['SIZE:M', 'PARTY:NEW_REPUBLICAN', 'RACE:BLACK', 'RELIGION:ISLAM', 'EDUCATION:HIGH_SCHOOL'], initialInfluence: { type: 'RESILIENCY', count: 1, attributionCountryId: 'ARDEN' } },
  { id: 'ARDEN_PD_3', hostCountryId: 'ARDEN', localIndex: 3, gamebookLabel: '11', boardLabel: '14', demographicTokenIds: ['SIZE:L', 'PARTY:NEW_REPUBLICAN', 'RACE:WHITE', 'RELIGION:CHRISTIAN', 'EDUCATION:UNIVERSITY'], initialInfluence: { type: 'RESILIENCY', count: 6, attributionCountryId: 'ARDEN' } },
] as const;

export const BASE_2025_POPULATION_DEMOGRAPHICS: readonly ScenarioPopulationDemographic[] =
  base2025PopulationDemographicDefinitions.map((pd) => ({
    ...pd,
    initialInfluence: { ...pd.initialInfluence, source: 'SCENARIO_SETUP' },
  }));

const cardNames = [
  'Acuerdos Comerciales', 'Agravios Históricos', 'Asesores Militares', 'Asociaciones Público-Privadas', 'Ataque de Denegación de Servicio', 'Atribución', 'Cabildos', 'Campaña de Alfabetización Mediática', '#Campaña', 'Campaña de Hostigamiento',
  'Acción Encubierta', 'Agente Doble', 'Apps de Chat', 'Aprendizaje basado en juegos', 'Astroturfing', 'Cámara de Eco', 'Censura Doméstica', 'Ciberseguridad', 'Cohesión Social', 'Comentaristas Políticos',
  'Contrainteligencia', 'Control Editorial', 'Descartar', 'Desinformación', 'Ejército de Bots', 'Filtraciones', 'Financiamiento Externo', 'Gestión de Crisis', 'Influencers', 'Intercambio de Inteligencia',
  'Ladrón Encubierto', 'Medidas Activas', 'Microtargeting', 'Noticias Falsas', 'Patrocinio educativo', 'Prensa Independiente', 'Sanciones Económicas', 'Seguridad Electoral', 'Think Tanks', 'Chantaje',
  'Ciberataque', 'Construcción de coalición', 'Contraataque Informático', 'Curso de Alfabetización Mediática', 'Deepfake', 'Desinformación Electoral', 'Desplataformización', 'Detección de Bots y Spam', 'Diásporas', 'Diplomacia Pública',
  'Doble Acción', 'Doxing', 'Efectos Nacionales', 'Ejercicios Militares', 'Emitir Códigos y Estándares', 'Espionaje', 'Foros en Línea', 'Fortalecer Instituciones', 'Giro de Política', 'Guerra Jurídica',
  'Identidades Falsas', 'Infraestructura de Información', 'Intención Libre', 'Interagencia', 'Leyes Anticorrupción', 'Lista Blanca', 'Manipulación Electoral', 'Memes Maliciosos', 'Movilización Militar', 'Movilización Popular',
  'Participación de la Sociedad Civil', 'Política Coordinada', 'Derecho preferente de compra', 'Presión Económica', 'Presupuesto Aumentado', 'Protestas Organizadas', 'Radicalización en Línea', 'Regulación de Plataformas', 'Restricciones de Viaje', 'Robar',
  'Robo Cibernético', 'Tarro de Miel', 'Teoría Conspirativa', 'Verificación de Hechos', 'Veto', 'Videos de Propaganda', '¡Impulso!', 'Corrupción', 'Organizaciones Internacionales', 'Operación de Desinformación',
  'Rastreo de Datos', 'Influencia Política', 'Política Prioritaria', 'Protocolos de Seguridad', 'Inteligencia Artificial', 'Inteligencia Artificial', 'Divisiones Sociales', 'Divisiones Sociales', 'Influencia Maligna', 'Influencia Maligna',
  'Influencia Maligna', 'Temas Divisivos', 'Temas Divisivos', 'Resiliencia', 'Resiliencia', 'Resiliencia', 'Políticas de identidad', 'Políticas de identidad',
] as const;

const starterSerials = new Set([59, 63, 75, 85, 93]);

export const BASE_2025_CARD_REGISTRY: readonly SetupCardDefinition[] = cardNames.map((canonicalName, index) => {
  const serialWithinCountrySet = index + 1;
  return {
    id: `BASE_CARD_${String(serialWithinCountrySet).padStart(3, '0')}`,
    serialWithinCountrySet,
    canonicalName,
    starter: starterSerials.has(serialWithinCountrySet),
  };
});

if (BASE_2025_CARD_REGISTRY.length !== 108 || BASE_2025_CARD_REGISTRY.filter(({ starter }) => starter).length !== 5) {
  throw new Error('BASE_2025 card registry invariant failed');
}

export const cardInstanceId = (countryId: CountryId, serialWithinCountrySet: number): string =>
  `${countryId}-CARD-${String(serialWithinCountrySet).padStart(3, '0')}`;

const campaignRule = (
  serial: number,
  alignment: M1CampaignCardRule['alignment'],
  influenceValueBySlot: M1CampaignCardRule['influenceValueBySlot'],
  options: Pick<M1CampaignCardRule, 'allowsAnyTargetDt' | 'pairBonusWithDefinitionId'> = {},
): M1CampaignCardRule => ({
  definitionId: `BASE_CARD_${String(serial).padStart(3, '0')}`,
  alignment,
  influenceValueBySlot,
  ...options,
});

/** The versioned card subset exercised by the approved M1-2 campaign slice. */
export const BASE_2025_M1_CAMPAIGN_CARD_RULES: Readonly<Record<string, M1CampaignCardRule>> = Object.fromEntries(
  [
    campaignRule(3, 'DUAL', { METHOD: 3, AMPLIFIER: 3 }),
    campaignRule(45, 'MALIGN', { METHOD: 6, AMPLIFIER: 6 }),
    campaignRule(86, 'MALIGN', { METHOD: 3, AMPLIFIER: 3 }, { pairBonusWithDefinitionId: 'BASE_CARD_045' }),
    campaignRule(97, 'MALIGN', { INTENT: 2 }, { allowsAnyTargetDt: true }),
    campaignRule(99, 'MALIGN', { INTENT: 1 }, { allowsAnyTargetDt: true }),
    campaignRule(100, 'MALIGN', { INTENT: 1 }, { allowsAnyTargetDt: true }),
    campaignRule(101, 'MALIGN', { INTENT: 1 }, { allowsAnyTargetDt: true }),
    campaignRule(102, 'MALIGN', { INTENT: 3 }, { allowsAnyTargetDt: true }),
    campaignRule(103, 'MALIGN', { INTENT: 3 }, { allowsAnyTargetDt: true }),
  ].map((rule) => [rule.definitionId, rule]),
);
