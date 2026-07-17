export const CLUSTER_PALETTE = [
  "#c9775b",
  "#769176",
  "#718aa2",
  "#ad8951",
  "#8c7896",
  "#918a7f",
];

export function clusterColor(id: number): string {
  if (id < 0) return "#918a7f";
  return CLUSTER_PALETTE[id % CLUSTER_PALETTE.length]!;
}

export function densityToRGB(
  density: number,
  clusterId: number,
  darkMode = false,
): [number, number, number] {
  if (clusterId < 0) {
    if (darkMode) {
      const v = 0.18 + density * 0.12;
      return [v, v * 0.98, v * 0.94];
    }
    const v = 0.58 + density * 0.12;
    return [v, v * 0.98, v * 0.94];
  }

  const hex = CLUSTER_PALETTE[clusterId % CLUSTER_PALETTE.length]!;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  if (darkMode) {
    const t = 0.42 + density * 0.58;
    const br = 0.10,
      bg_ = 0.095,
      bb = 0.085;
    return [r * t + br * (1 - t), g * t + bg_ * (1 - t), b * t + bb * (1 - t)];
  }

  const t = 0.32 + density * 0.68;
  return [
    r * t + (1 - t) * 0.97,
    g * t + (1 - t) * 0.96,
    b * t + (1 - t) * 0.93,
  ];
}

export function hexToRGB(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}
