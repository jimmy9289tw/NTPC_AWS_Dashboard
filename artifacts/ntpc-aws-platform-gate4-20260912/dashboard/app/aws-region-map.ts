export type DistrictFeature = {
  properties: {TOWNNAME: string; COUNTYNAME: string};
  geometry: {type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][]};
};

/** Keep selectable districts only. The source also contains a final 全區 overlay. */
export function selectDistrictFeatures(geo: any, expectedNames: readonly string[]): DistrictFeature[] {
  const expected = new Set(expectedNames);
  if (expected.size !== 29 || expectedNames.length !== 29 || expected.has('全區') || expected.has('新北市') || !Array.isArray(geo?.features)) {
    throw new Error('行政區地圖清單不完整');
  }
  const features = geo.features.filter((feature: any) =>
    feature?.properties?.COUNTYNAME === '新北市'
    && expected.has(feature.properties.TOWNNAME)
    && ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
    && Array.isArray(feature.geometry.coordinates),
  ) as DistrictFeature[];
  if (features.length !== 29 || new Set(features.map(feature => feature.properties.TOWNNAME)).size !== 29) {
    throw new Error('行政區地圖須包含29個不重複行政區');
  }
  return features;
}
