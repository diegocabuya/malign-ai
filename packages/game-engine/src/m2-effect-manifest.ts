export interface M2EffectManifestEntry {
  readonly effectId: string;
  readonly sourceDefinitionId: string;
}

/** Exact 59-effect inventory from the DEC-077 registry snapshot. Presence does not imply a handler. */
export const M2_EFFECT_MANIFEST: readonly M2EffectManifestEntry[] = [
  { effectId: 'CARD_EFFECT_BASE_2025_E001', sourceDefinitionId: 'CARD_DEF_BASE_2025_D001' },
  { effectId: 'CARD_EFFECT_BASE_2025_E002', sourceDefinitionId: 'CARD_DEF_BASE_2025_D002' },
  { effectId: 'CARD_EFFECT_BASE_2025_E003', sourceDefinitionId: 'CARD_DEF_BASE_2025_D008' },
  { effectId: 'CARD_EFFECT_BASE_2025_E004', sourceDefinitionId: 'CARD_DEF_BASE_2025_D009' },
  { effectId: 'CARD_EFFECT_BASE_2025_E005', sourceDefinitionId: 'CARD_DEF_BASE_2025_D010' },
  { effectId: 'CARD_EFFECT_BASE_2025_E006', sourceDefinitionId: 'CARD_DEF_BASE_2025_D012' },
  { effectId: 'CARD_EFFECT_BASE_2025_E007', sourceDefinitionId: 'CARD_DEF_BASE_2025_D013' },
  { effectId: 'CARD_EFFECT_BASE_2025_E008', sourceDefinitionId: 'CARD_DEF_BASE_2025_D015' },
  { effectId: 'CARD_EFFECT_BASE_2025_E009', sourceDefinitionId: 'CARD_DEF_BASE_2025_D017' },
  { effectId: 'CARD_EFFECT_BASE_2025_E010', sourceDefinitionId: 'CARD_DEF_BASE_2025_D018' },
  { effectId: 'CARD_EFFECT_BASE_2025_E011', sourceDefinitionId: 'CARD_DEF_BASE_2025_D020' },
  { effectId: 'CARD_EFFECT_BASE_2025_E012', sourceDefinitionId: 'CARD_DEF_BASE_2025_D021' },
  { effectId: 'CARD_EFFECT_BASE_2025_E013', sourceDefinitionId: 'CARD_DEF_BASE_2025_D023' },
  { effectId: 'CARD_EFFECT_BASE_2025_E014', sourceDefinitionId: 'CARD_DEF_BASE_2025_D026' },
  { effectId: 'CARD_EFFECT_BASE_2025_E015', sourceDefinitionId: 'CARD_DEF_BASE_2025_D028' },
  { effectId: 'CARD_EFFECT_BASE_2025_E016', sourceDefinitionId: 'CARD_DEF_BASE_2025_D031' },
  { effectId: 'CARD_EFFECT_BASE_2025_E017', sourceDefinitionId: 'CARD_DEF_BASE_2025_D032' },
  { effectId: 'CARD_EFFECT_BASE_2025_E018', sourceDefinitionId: 'CARD_DEF_BASE_2025_D033' },
  { effectId: 'CARD_EFFECT_BASE_2025_E019', sourceDefinitionId: 'CARD_DEF_BASE_2025_D037' },
  { effectId: 'CARD_EFFECT_BASE_2025_E020', sourceDefinitionId: 'CARD_DEF_BASE_2025_D038' },
  { effectId: 'CARD_EFFECT_BASE_2025_E021', sourceDefinitionId: 'CARD_DEF_BASE_2025_D042' },
  { effectId: 'CARD_EFFECT_BASE_2025_E022', sourceDefinitionId: 'CARD_DEF_BASE_2025_D043' },
  { effectId: 'CARD_EFFECT_BASE_2025_E023', sourceDefinitionId: 'CARD_DEF_BASE_2025_D046' },
  { effectId: 'CARD_EFFECT_BASE_2025_E024', sourceDefinitionId: 'CARD_DEF_BASE_2025_D049' },
  { effectId: 'CARD_EFFECT_BASE_2025_E025', sourceDefinitionId: 'CARD_DEF_BASE_2025_D051' },
  { effectId: 'CARD_EFFECT_BASE_2025_E026', sourceDefinitionId: 'CARD_DEF_BASE_2025_D054' },
  { effectId: 'CARD_EFFECT_BASE_2025_E027', sourceDefinitionId: 'CARD_DEF_BASE_2025_D055' },
  { effectId: 'CARD_EFFECT_BASE_2025_E028', sourceDefinitionId: 'CARD_DEF_BASE_2025_D056' },
  { effectId: 'CARD_EFFECT_BASE_2025_E029', sourceDefinitionId: 'CARD_DEF_BASE_2025_D057' },
  { effectId: 'CARD_EFFECT_BASE_2025_E030', sourceDefinitionId: 'CARD_DEF_BASE_2025_D058' },
  { effectId: 'CARD_EFFECT_BASE_2025_E031', sourceDefinitionId: 'CARD_DEF_BASE_2025_D059' },
  { effectId: 'CARD_EFFECT_BASE_2025_E032', sourceDefinitionId: 'CARD_DEF_BASE_2025_D060' },
  { effectId: 'CARD_EFFECT_BASE_2025_E033', sourceDefinitionId: 'CARD_DEF_BASE_2025_D061' },
  { effectId: 'CARD_EFFECT_BASE_2025_E034', sourceDefinitionId: 'CARD_DEF_BASE_2025_D063' },
  { effectId: 'CARD_EFFECT_BASE_2025_E035', sourceDefinitionId: 'CARD_DEF_BASE_2025_D064' },
  { effectId: 'CARD_EFFECT_BASE_2025_E036', sourceDefinitionId: 'CARD_DEF_BASE_2025_D065' },
  { effectId: 'CARD_EFFECT_BASE_2025_E037', sourceDefinitionId: 'CARD_DEF_BASE_2025_D066' },
  { effectId: 'CARD_EFFECT_BASE_2025_E038', sourceDefinitionId: 'CARD_DEF_BASE_2025_D068' },
  { effectId: 'CARD_EFFECT_BASE_2025_E039', sourceDefinitionId: 'CARD_DEF_BASE_2025_D069' },
  { effectId: 'CARD_EFFECT_BASE_2025_E040', sourceDefinitionId: 'CARD_DEF_BASE_2025_D073' },
  { effectId: 'CARD_EFFECT_BASE_2025_E041', sourceDefinitionId: 'CARD_DEF_BASE_2025_D074' },
  { effectId: 'CARD_EFFECT_BASE_2025_E042', sourceDefinitionId: 'CARD_DEF_BASE_2025_D075' },
  { effectId: 'CARD_EFFECT_BASE_2025_E043', sourceDefinitionId: 'CARD_DEF_BASE_2025_D077' },
  { effectId: 'CARD_EFFECT_BASE_2025_E044', sourceDefinitionId: 'CARD_DEF_BASE_2025_D078' },
  { effectId: 'CARD_EFFECT_BASE_2025_E045', sourceDefinitionId: 'CARD_DEF_BASE_2025_D080' },
  { effectId: 'CARD_EFFECT_BASE_2025_E046', sourceDefinitionId: 'CARD_DEF_BASE_2025_D081' },
  { effectId: 'CARD_EFFECT_BASE_2025_E047', sourceDefinitionId: 'CARD_DEF_BASE_2025_D082' },
  { effectId: 'CARD_EFFECT_BASE_2025_E048', sourceDefinitionId: 'CARD_DEF_BASE_2025_D085' },
  { effectId: 'CARD_EFFECT_BASE_2025_E049', sourceDefinitionId: 'CARD_DEF_BASE_2025_D086' },
  { effectId: 'CARD_EFFECT_BASE_2025_E050', sourceDefinitionId: 'CARD_DEF_BASE_2025_D087' },
  { effectId: 'CARD_EFFECT_BASE_2025_E051', sourceDefinitionId: 'CARD_DEF_BASE_2025_D088' },
  { effectId: 'CARD_EFFECT_BASE_2025_E052', sourceDefinitionId: 'CARD_DEF_BASE_2025_D090' },
  { effectId: 'CARD_EFFECT_BASE_2025_E053', sourceDefinitionId: 'CARD_DEF_BASE_2025_D093' },
  { effectId: 'CARD_EFFECT_BASE_2025_E054', sourceDefinitionId: 'CARD_DEF_BASE_2025_D094' },
  { effectId: 'CARD_EFFECT_BASE_2025_E055', sourceDefinitionId: 'CARD_DEF_BASE_2025_D096' },
  { effectId: 'CARD_EFFECT_BASE_2025_E056', sourceDefinitionId: 'CARD_DEF_BASE_2025_D097' },
  { effectId: 'CARD_EFFECT_BASE_2025_E057', sourceDefinitionId: 'CARD_DEF_BASE_2025_D098' },
  { effectId: 'CARD_EFFECT_BASE_2025_E058', sourceDefinitionId: 'CARD_DEF_BASE_2025_D099' },
  { effectId: 'CARD_EFFECT_BASE_2025_E059', sourceDefinitionId: 'CARD_DEF_BASE_2025_D100' },
] as const;

if (M2_EFFECT_MANIFEST.length !== 59 || new Set(M2_EFFECT_MANIFEST.map(({ effectId }) => effectId)).size !== 59) {
  throw new Error('M2 effect manifest must contain exactly 59 unique effect IDs');
}

export const m2EffectSourceDefinition = (effectId: string): string | undefined =>
  M2_EFFECT_MANIFEST.find((entry) => entry.effectId === effectId)?.sourceDefinitionId;
