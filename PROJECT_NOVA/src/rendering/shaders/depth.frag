// Depth encoding fragment shader
// Encodes scene depth to a floating-point render target for Roberts Cross edge detection

precision highp float;

uniform float uNear;
uniform float uFar;

varying float vDepth;  // linear eye-space depth, passed from vertex shader

void main() {
  // Encode to [0, 1] range for texture storage
  float d = (vDepth - uNear) / (uFar - uNear);
  gl_FragColor = vec4(d, d, d, 1.0);
}
