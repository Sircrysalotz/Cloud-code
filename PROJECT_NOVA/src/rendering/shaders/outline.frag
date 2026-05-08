// Roberts Cross edge detection fragment shader
// Applied as a post-process over the depth buffer to produce 1px outlines.
//
// Roberts Cross kernel:
//   Gx = [[1, 0], [0, -1]]
//   Gy = [[0, 1], [-1, 0]]
//
// Applied at RENDER resolution (not screen resolution) for 1px thickness.

precision highp float;

uniform sampler2D uDepthMap;    // depth render target
uniform sampler2D uColorMap;    // color render target (toon output)
uniform vec2 uResolution;       // render target size (e.g. 64x64)
uniform float uDepthThreshold;  // edge sensitivity (default 0.10)
uniform vec3 uOutlineColor;     // outline color (#1c0814)
uniform float uBackgroundDepth; // depth value for background/transparent pixels (1.0)

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 texel = 1.0 / uResolution;

  float d_self = texture2D(uDepthMap, uv).r;

  // Skip background pixels
  if (d_self >= uBackgroundDepth - 0.001) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); // transparent
    return;
  }

  // Sample 4 neighbors for Roberts Cross
  float d_r  = texture2D(uDepthMap, uv + vec2( texel.x, 0.0)).r;
  float d_d  = texture2D(uDepthMap, uv + vec2(0.0,  texel.y)).r;
  float d_dr = texture2D(uDepthMap, uv + vec2( texel.x,  texel.y)).r;

  // Roberts Cross gradient magnitude
  float gx = d_self - d_dr;
  float gy = d_r    - d_d;
  float grad = sqrt(gx * gx + gy * gy);

  // Check for silhouette (adjacent to background)
  bool isSilhouette = (
    d_r  >= uBackgroundDepth - 0.001 ||
    d_d  >= uBackgroundDepth - 0.001 ||
    d_dr >= uBackgroundDepth - 0.001 ||
    texture2D(uDepthMap, uv + vec2(-texel.x, 0.0)).r >= uBackgroundDepth - 0.001 ||
    texture2D(uDepthMap, uv + vec2(0.0, -texel.y)).r >= uBackgroundDepth - 0.001
  );

  vec3 baseColor = texture2D(uColorMap, uv).rgb;

  if (isSilhouette || grad > uDepthThreshold) {
    gl_FragColor = vec4(uOutlineColor, 1.0);
  } else {
    gl_FragColor = vec4(baseColor, 1.0);
  }
}
