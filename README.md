# Terrain Surf

A browser-based Marswalk planner and virtual rover scout for **Interplanetary Survival Guide: Martian Map**, NASA Space Apps 2026.

Plan a science visit in Jezero Crater, inspect measured terrain and route alternatives, scout the route, review archived NASA observations, and save a sourced field notebook. The synchronized 3D view and orbital map connect a local route to its elevation, position, and available environmental evidence.

[Open the explorer](index.html) · [Watch the 30-second overview](demo.html) · [Read the seven-page guide](guide.pdf) · [Data and resource credits](SOURCES.md)

## Try a Marswalk

1. Open **Tutorial → Guide my first stop**. Choose **Begin excursion here** to mark your return point.
2. Select a science stop and **Plan this stop**. Inspect distance, elevation and the assumed slope limit before choosing **Scout this route**.
3. At the stopped arrival, open the **NASA observation**, inspect its image, close it and record your own note.
4. Choose **Review regional weather** in the tutorial, or **Regional weather** beside the map. Change the historical date, inspect its source bin and check coverage over both terrain fields.
5. Continue to the other stop, plan the return, then **Export mission brief**. Export before refreshing: notes are held in the current browser page.

For free exploration, click the orbital map to choose a destination. **W/S** drive, **A/D** steer and **Space** brakes. Drag the 3D view to orbit and scroll to zoom. **1/2** or **C** change chase/rover camera views. The camera panel offers a 1280 × 960 preview and a 5120 × 3840 virtual capture. The complete controls tour explains the remaining panels and prerequisites.

## What the data supports

- Two registered Jezero terrain fields use USGS/NASA HiRISE elevation and optical products. Slope and route profiles are derived from the elevation data.
- Máaz and Yeehgo stops link Perseverance SuperCam evidence to approximate rover observation stations using PDS records.
- Historical MEDA pressure and air temperature are **point observations**, with source times, gaps and location separation visible.
- Regional dust history uses 26 dated MRO/MCS-derived maps. Both small Jezero fields lie in one coarse 6° × 5° source bin. This does not establish different weather at individual stops.
- Red dashed routes show a direct route rejected by the selected slope assumption; green lines show a proposed alternative when one is found.

The rover follows terrain **kinematically**. This prototype does not validate wheel slip, soil strength, energy, rock clearance, astronaut safety, radiation dose, forecasts or live Mars conditions. Fine grain shading, lighting and the concept rover are illustrative. Camera resolution cannot recover detail absent from the source data.

## Run locally

Use a current browser with WebGL 2 support. Serve this folder over HTTP, rather than opening `index.html` as a file:

```sh
python -m http.server 8080 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8080/`. On Windows, `py -m http.server 8080 --bind 127.0.0.1` is an alternative. There is no backend, account, API key or npm installation step. Pinned browser modules are included; `.nojekyll` preserves their paths on GitHub Pages.

## Project and submission information

Henri conceived and directed this project, reusing a pre-existing rover visual and lunar navigation ideas. The Mars data integration, browser workflows and tutorials were developed for this prototype. [AI assistance](AI_DISCLOSURE.md), [asset and software notices](LICENSES.md), [security scope](SECURITY.md) and [submission mapping](REQUIREMENTS.md) distinguish the team's contribution, external resources and limits.

The video is an actual app capture with waits and travel compressed to 30 seconds; it has no audio. The PDF explains the controls, scientific interpretation and route comparison in seven pages. These are project materials; hosting them does not submit the team entry for judging.

The intended custom domain is **terrain.surf**. This release must be published and its public links verified before those links are entered in the team form. No NASA endorsement is implied.
