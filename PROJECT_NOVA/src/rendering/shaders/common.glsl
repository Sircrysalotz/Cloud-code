// Shared GLSL utilities for the NOVA pixel art pipeline

// Bayer 2x2 dither matrix
// Returns offset in range [-0.5, 0.5] * strength for band boundary dithering
float bayer2(vec2 fragCoord, float strength) {
  vec2 pos = floor(fragCoord);
  int idx = int(mod(pos.x, 2.0)) + int(mod(pos.y, 2.0)) * 2;
  // Bayer 2x2: [0, 0.5, 0.75, 0.25]
  float vals[4];
  vals[0] = 0.0;
  vals[1] = 0.5;
  vals[2] = 0.75;
  vals[3] = 0.25;
  return (vals[idx] - 0.5) * strength;
}

// Snap a continuous value to N discrete bands (0..1 range)
float snapBands(float v, float nBands) {
  return floor(v * nBands) / (nBands - 1.0);
}

// Encode depth to a float texture (for Roberts Cross)
// Maps [near, far] to [0, 1] with high precision in near range
float encodeDepth(float z, float near, float far) {
  return (z - near) / (far - near);
}
