# Galaxy Explorer

A zoomable galaxy map of procedurally rendered worlds, connected by hyperlanes,
trade routes and wormholes. Click any world to fly in and see everything about it.

No build step and no dependencies: open `index.html` in a browser, or serve the folder:

```sh
cd galaxy-explorer && python3 -m http.server 8000   # then visit http://localhost:8000
```

## Features

- **Galaxy view**: a spiral galaxy with pan (drag), zoom (scroll wheel / pinch / +− buttons) and parallax stars.
- **Worlds**: 10 types (Terran, Ocean, Jungle, Desert, Ice, Volcanic, Gas Giant, Barren, Crystal, Toxic),
  each with a procedurally generated, rotating 3D-shaded surface, clouds, glowing lava/crystals, rings and moons.
- **World detail view**: population, climate, temperature, gravity, day length, diameter, moons, faction,
  resources, points of interest and every route out. Click a route to warp to the neighbouring world.
- **Paths**: hyperlanes, trade routes and wormholes with travel times in days.
- **Route planner**: finds the fastest path between any two worlds (Dijkstra), optionally avoiding wormholes,
  and animates it on the map.
- **Search** worlds by name, type or faction.
- **Edit mode**: double-click to add a world, drag to move, *Connect…* (or Shift+click) to add/remove routes,
  click a route to change its kind or travel time, Delete key to remove. Edit every detail of a world from its page.
- **Save & share**: changes are saved automatically in your browser (localStorage). Use the ⋯ menu to export/import
  the galaxy as JSON, or generate a brand-new random galaxy.

## Data format

```json
{
  "name": "Zuter Galaxy",
  "seed": 20261119,
  "worlds": [{ "id": "w1", "name": "Rhalu VII", "type": "Gas Giant", "x": -791, "y": -397, "size": 19,
               "seed": 123, "population": 0, "faction": "Unclaimed", "climate": "Storm-wracked",
               "temperature": -130, "gravity": 2.99, "dayLength": 10.4, "moons": 2, "rings": true,
               "description": "…", "resources": ["Hydrogen"], "poi": ["Port Ludor — the main spaceport"] }],
  "routes": [{ "id": "r1", "a": "w1", "b": "w2", "kind": "hyperlane", "days": 8 }]
}
```

`kind` is `hyperlane`, `trade` or `wormhole`. A world's `seed` determines its generated surface.
Missing fields are filled in with generated values when a file is imported.

## Code layout

- `index.html` – page structure
- `styles.css` – UI styling
- `app.js` – noise & planet texture generation, sphere renderer, galaxy generator, map rendering,
  input handling, route finding, editing and persistence
