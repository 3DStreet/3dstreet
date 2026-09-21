// The editor grid is a raw ShaderMaterial drawn into a scene that renders
// with a logarithmic depth buffer (index.html). Without three's logdepthbuf
// chunks its depth is written on the plain gl_FragCoord.z scale while every
// built-in material writes log depth, so the grid never occludes geometry
// below y = 0 and objects beneath the ground draw over the lines (#1988).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import InfiniteGridHelper from '@/editor/lib/InfiniteGridHelper.js';

describe('InfiniteGridHelper', () => {
  const grid = new InfiniteGridHelper(1, 10, new THREE.Color(0xffffff), 500);
  const { vertexShader, fragmentShader } = grid.material;

  it('writes logarithmic depth so it depth-tests against built-in materials', () => {
    expect(vertexShader).toContain('#include <common>');
    expect(vertexShader).toContain('#include <logdepthbuf_pars_vertex>');
    expect(fragmentShader).toContain('#include <common>');
    expect(fragmentShader).toContain('#include <logdepthbuf_pars_fragment>');
    expect(fragmentShader).toContain('#include <logdepthbuf_fragment>');
  });

  it('samples gl_Position.w after gl_Position is set', () => {
    const assign = vertexShader.indexOf('gl_Position =');
    const include = vertexShader.indexOf('#include <logdepthbuf_vertex>');
    expect(assign).toBeGreaterThan(-1);
    expect(include).toBeGreaterThan(assign);
  });

  it('writes gl_FragDepth before any discard', () => {
    const include = fragmentShader.indexOf('#include <logdepthbuf_fragment>');
    const discard = fragmentShader.indexOf('discard');
    expect(include).toBeGreaterThan(-1);
    expect(discard).toBeGreaterThan(include);
  });

  it('keeps the grid transparent, double-sided and depth-tested', () => {
    expect(grid.material.transparent).toBe(true);
    expect(grid.material.side).toBe(THREE.DoubleSide);
    expect(grid.material.depthTest).toBe(true);
    expect(grid.frustumCulled).toBe(false);
  });
});
