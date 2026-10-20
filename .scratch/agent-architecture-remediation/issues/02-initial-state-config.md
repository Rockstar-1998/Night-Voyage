# 02: Blueprint-Driven Initial State & Genre-Neutral Engine Models

**What to build:** Allow tabletop scenario creators to configure arbitrary initial stats (e.g. `sanity`, `credits`, `fuel`) and starting inventory items via a dedicated `InitialStateConfig` blueprint node, completely eliminating hardcoded fantasy RPG default stats (`hp`, `mp`, `gold`, `weight`) from core engine models.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Core game state initialization no longer hardcodes fantasy defaults (`hp`, `mp`, `gold`, `weight`) and starts from an empty attribute map when unconfigured.
- [ ] An `InitialStateConfig` blueprint node and schema are defined, supporting custom stat definitions (initial, min, max), starting inventory items, and custom flags.
- [ ] Scenarios using custom attributes initialize and render correctly in game state without injecting fantasy properties.
- [ ] PC and mobile blueprint configuration panels allow creators to define and edit initial stats and items visually.
