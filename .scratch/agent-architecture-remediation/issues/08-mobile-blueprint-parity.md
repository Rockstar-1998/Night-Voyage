# 08: Mobile Blueprint 8-Node Forms & Asset Modals Parity (C7 Dual-Platform)

**What to build:** Achieve full dual-platform feature parity on mobile by implementing configuration forms for all 8 agent blueprint nodes (`inspector`, `querier`, `writer`, `banned_words_config`, `scriptwriter_pipeline`, `agent_mode_switch`, `director_config`, `actor_definition`) in `MobileNodeConfigForms.tsx`, and providing mobile-native modals for Schema Editor, UI Designer, and Action Whitelists in `MobilePresetDetailView.tsx`.

**Blocked by:** 02: Blueprint-Driven Initial State & Genre-Neutral Engine Models, 07: Dynamic Scriptwriter Pipeline Stages & Schema Beat Extraction

**Status:** ready-for-agent

- [ ] Mobile `MobileNodeConfigForms.tsx` renders dedicated, functional configuration forms for all 8 previously missing node variants.
- [ ] Mobile creators can inspect, configure, and save parameters for all 8 node types on mobile devices without encountering empty panels.
- [ ] Mobile `MobilePresetDetailView.tsx` provides accessible buttons and responsive modal flows for `SchemaEditorModal`, `UiDesignerModal`, and `PresetActionWhitelistModal`.
- [ ] Preset modifications made on mobile serialize faithfully to the unified preset schema.
