# 03: Dual-Platform Visual Macro Subgraph Editor & Pin System

**What to build:** In both PC (`src/`) and mobile (`src-mobile/`) frontends, provide a visual Macro Subgraph Editor. Creators can create, rename, and manage macros in a Macro Drawer; double-clicking a macro instance on the canvas navigates into its isolated subgraph with breadcrumb navigation. The boundary `Inputs` and `Outputs` nodes allow dynamically adding and configuring Exec pins and color-coded typed Data pins. Macro instances can be dragged into parent graphs with pin sockets supporting type-safe wire dragging.

**Blocked by:** 02: UE5 Blueprint Macro Schema & Inline Expansion Engine

**Status:** ready-for-agent

- [ ] Macro Drawer in desktop and mobile interfaces allows creating, editing, and deleting macro definitions.
- [ ] Double-clicking a Macro node opens its subgraph canvas with breadcrumb navigation back to the parent graph.
- [ ] Dedicated `Inputs` and `Outputs` boundary nodes allow adding, editing, and deleting custom Exec and Data pins (Number, String, Boolean, Object).
- [ ] Canvas renders distinct visual sockets (white triangles for Exec, color-coded circles for Data pins) and enforces drag-and-drop type compatibility.
- [ ] Desktop (`src/`) and Mobile (`src-mobile/`) implementations remain strictly independent per C5 while maintaining 100% feature parity per C7.
