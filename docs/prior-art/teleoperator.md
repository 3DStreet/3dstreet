# Teleoperator (Mindblown)

[Prior-art index](README.md)

- **Game:** https://mindblown.ai/games/teleoperator, published 2026-10-02 by
  Mindblown; shared on r/threejs by u/marina_sd20 as "real SF city running in
  the browser on WebGPU: fable + three.js" (about 286 upvotes two days in).
- **Read:** the game's landing page and the Reddit thread (pasted by Kieran on
  2026-10-13; Reddit blocks our research environment). **No source code is
  published** ("source code?" in the thread went unanswered), so nothing here
  comes from reading code.
- **License:** none published; closed product.

## What it is

A free browser multiplayer driving game set in San Francisco: open a room,
share the link, and everyone drives a robotaxi or a supercar with their name
over it. Three.js on WebGPU, phones and laptops. The landing page reported
22,648 plays.

## How it was made, per the author's replies

- **"My mindblown agent wrote most of it."** The author steered; a coding agent
  (an AI model, per the post title and replies) built it. "Honestly couldn't
  tell you much past that lol, i mostly steered and it built."
- **OSM for layout only.** "It uses openstreetmap for the street layout and
  builds the city from reusable components, roads are procedural too."
- **The look comes from reference photos.** "Openstreetmap gives the layout,
  and for the look the agent works off a lot of reference photos. For
  prominent spots i had it find real pictures and try to match them in the
  game." Asked where licence-free pictures came from, the author didn't say.
- **Coverage:** commenters note it seems to cover only the north of the city.

## What the thread says about the result

- Strong first impression: "surprisingly photorealistic" in motion,
  recognizable spots (the curved red street, read by a commenter as Lombard
  Street), long view distance.
- **Accuracy limits:** "the scale looks a bit off"; feedback lists driving
  physics, a cluttered UI and graphics as the things needing work.
- **Reach:** a game-portal publisher warns that WebGPU without a WebGL fallback
  loses players on phones and weak laptops.

## How it relates to our topics

- **The hybrid of the two approaches we've documented.** Layout from data
  (OSM), geometry from reusable procedural components, appearance matched to
  reference photos by an agent, prominent landmarks matched by hand-picked
  photos. Closer to [fable51-worlds](fable51-worlds.md) (agent works per place
  from photos) than to [buildings-generator](buildings-generator.md) (model
  only fills a recipe once per building), but with a component kit doing the
  geometry. Its visible weak spot, scale, is exactly what measured data
  (footprints, heights, lidar) fixes and what reference photos don't.
- **Impressive for a game, not a twin.** Facts aren't traceable to a source,
  per-building identity isn't exposed, and nothing can be edited. For #2090
  it's a reminder of how much visual quality a component kit plus good
  lighting buys, not a model for the data layer.
- **Photo provenance is the open question.** The author couldn't say where
  licence-free reference photos came from. If we ever use reference imagery to
  pick building styles (as buildings-generator does with Mapillary, CC BY-SA),
  record the source and licence per image.

## Related

- [San Francisco on WebGPU (ericrius1/SanFrancisco)](sanfrancisco-webgpu.md):
  an unrelated open-world SF in three.js WebGPU whose code we could read.
