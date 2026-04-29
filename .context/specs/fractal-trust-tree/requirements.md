# Fractal Trust Tree — Requirements

## User Story
As a Circles user, I want to explore my trust network as an interactive fractal tree, so I can intuitively understand the depth, branching, and health of my trust graph through a beautiful organic visualisation.

## Functional Requirements
- FR1: On connect, fetch trust relations recursively (2-3 hops deep)
- FR2: Render as a fractal tree — user at root, trusted contacts as branches
- FR3: Branch angle determined by keccak256(contactAddr) → deterministic layout
- FR4: Branch thickness proportional to trust depth / mutual trust
- FR5: Leaf nodes show contact profile images (via Circles avatar API)
- FR6: Click a node to expand its sub-tree (lazy-load further hops)
- FR7: Animated growth — tree "grows" from root outward on load
- FR8: Zoom and pan (touch + mouse)
- FR9: Hover node shows: name, address, balance, mutual trust status
- FR10: Colour coding: mutual trust = green, one-way = amber, group = blue
- FR11: Download tree as PNG

## Non-Functional Requirements
- NFR1: Canvas 2D rendering — no WebGL
- NFR2: Max 200 visible nodes at once (prune distant nodes)
- NFR3: Smooth pan/zoom at 60fps
- NFR4: No backend — recursive trust fetch client-side
- NFR5: Load time < 5 seconds for initial tree (2 hops)

## Out of Scope
- WebGL/Three.js 3D rendering
- Real-time trust updates (websocket)
- Editing trust from the tree

## Acceptance Criteria
- [ ] Tree grows from root on wallet connect
- [ ] Nodes are interactive (click to expand, hover for info)
- [ ] Visual distinction between mutual/one-way/group trust
- [ ] Download as PNG works