// Cel/toon fragment shader — 5-component lighting for pixel art
// Produces discrete color bands with hue-shifted palette

precision highp float;

uniform vec3 uLightDir;       // normalized light direction (world space)
uniform vec3 uViewDir;        // normalized view direction (world space)

// Palette colors (crimson aesthetic, hue-shifted)
uniform vec3 uColorShadowDeep;  // #380c20
uniform vec3 uColorShadow;      // #681424
uniform vec3 uColorMid;         // #b8281c
uniform vec3 uColorBright;      // #e86024
uniform vec3 uColorHighlight;   // #ffa840
uniform vec3 uColorPeak;        // #ffe088
uniform vec3 uColorOutline;     // #1c0814

// Lighting controls
uniform float uSpecStrength;    // specular intensity (default 0.8)
uniform float uRimStrength;     // rim light intensity (default 0.6)
uniform float uAOStrength;      // ambient occlusion intensity (default 0.4)
uniform float uDitherAmt;       // dither strength (default 0.15)
uniform vec2 uResolution;       // render target size (for Bayer coords)

varying vec3 vNormal;
varying vec3 vWorldPos;

// Bayer 2x2 dither
float bayer2(vec2 fragCoord) {
  vec2 pos = floor(fragCoord);
  int idx = int(mod(pos.x, 2.0)) * 1 + int(mod(pos.y, 2.0)) * 2;
  if (idx == 0) return 0.0;
  if (idx == 1) return 0.5;
  if (idx == 2) return 0.75;
  return 0.25;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(uViewDir);

  // 1. Multi-band Lambert (main form)
  float intensity = max(0.0, dot(N, L));

  // 2. Specular (Blinn-Phong, hard-stepped)
  vec3 H = normalize(L + V);
  float spec = pow(max(0.0, dot(N, H)), 32.0) * uSpecStrength;
  float specBand = step(0.65, spec);

  // 3. Rim light (fresnel, hard-stepped)
  float rim = 1.0 - max(0.0, dot(N, V));
  rim = pow(rim, 2.5);
  float rimBand = step(0.55, rim) * uRimStrength;

  // 4. Vertex-down ambient occlusion
  float ao = 1.0 - uAOStrength * smoothstep(0.0, -1.0, N.y) * 0.5;

  // 5. Bayer 2x2 dither at band boundaries
  float dither = (bayer2(gl_FragCoord.xy) - 0.5) * uDitherAmt * (1.0 / 5.0);

  // Compose: max of [lambert, rim, spec]
  float final = max(intensity, max(rimBand, specBand));
  final = final * ao + dither;
  final = clamp(final, 0.0, 1.0);

  // Map to discrete palette color (5 bands)
  vec3 color;
  if (final < 0.18)      color = uColorShadowDeep;
  else if (final < 0.40) color = uColorShadow;
  else if (final < 0.62) color = uColorMid;
  else if (final < 0.84) color = uColorBright;
  else                   color = uColorHighlight;

  // Peak highlight overlay (spec only)
  if (specBand > 0.5 && intensity > 0.7) color = uColorPeak;

  gl_FragColor = vec4(color, 1.0);
}
